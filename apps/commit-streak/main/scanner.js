// Repo discovery + git log reading + the "what day does this commit belong
// to" logic. No Electron dependency here on purpose — easy to test standalone
// with plain `node`.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/** Walk `roots` up to `maxDepth`, collecting directories that contain a `.git`. */
function discoverRepos(roots, ignoredDirNames = [], maxDepth = 3) {
  const found = [];
  const ignored = new Set(ignoredDirNames);

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // permission denied, gone, etc — skip silently
    }
    const hasGit = entries.some((e) => e.isDirectory() && e.name === '.git');
    if (hasGit) {
      found.push(dir);
      return; // don't descend into a repo looking for nested repos
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || ignored.has(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  }

  for (const root of roots) walk(root, 0);
  return found;
}

/**
 * Shift a wall-clock date backward by one day when the hour is before
 * `dayStartHour` — a 01:30 commit with dayStartHour=4 belongs to "yesterday".
 * Pure date-string arithmetic (UTC-noon trick) so no local-timezone surprises.
 */
function logicalDate(year, month, day, hour, dayStartHour) {
  const d = new Date(Date.UTC(year, month - 1, day, 12));
  if (hour < dayStartHour) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function logicalToday(dayStartHour, now = new Date()) {
  return logicalDate(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
    now.getHours(),
    dayStartHour
  );
}

const AUTHOR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;

/** Read commits from one repo, already reduced to {hash, date, msg}. */
function scanRepo(repoPath, authors, sinceISO, { countMerges = false } = {}) {
  return new Promise((resolve) => {
    const args = [
      '-C',
      repoPath,
      'log',
      '--all',
      '--pretty=format:%H%x09%ad%x09%s',
      '--date=iso-strict',
    ];
    if (!countMerges) args.splice(3, 0, '--no-merges');
    if (sinceISO) args.push(`--since=${sinceISO}`);
    for (const a of authors) args.push(`--author=${a}`);

    execFile('git', args, { maxBuffer: 1024 * 1024 * 32 }, (err, stdout) => {
      if (err || !stdout) return resolve([]); // not a repo / no matching commits
      const repo = path.basename(repoPath);
      const out = [];
      for (const line of stdout.split('\n')) {
        if (!line) continue;
        const [hash, ad, msg] = line.split('\t');
        const m = AUTHOR_DATE_RE.exec(ad || '');
        if (!m) continue;
        const [, y, mo, d, h] = m;
        out.push({
          hash,
          date: logicalDate(+y, +mo, +d, +h, 0), // caller re-buckets with dayStartHour
          rawHour: +h,
          rawY: +y,
          rawMo: +mo,
          rawD: +d,
          msg,
          repo,
        });
      }
      resolve(out);
    });
  });
}

/** Re-bucket a flat commit list with the configured dayStartHour, then dedupe by hash globally. */
function buildCommitMap(allCommits, dayStartHour) {
  const seen = new Set();
  const map = new Map(); // date -> [{repo, hash, msg}]
  for (const c of allCommits) {
    if (seen.has(c.hash)) continue; // same commit visible from >1 clone/worktree
    seen.add(c.hash);
    const date = logicalDate(c.rawY, c.rawMo, c.rawD, c.rawHour, dayStartHour);
    if (!map.has(date)) map.set(date, []);
    map.get(date).push({ repo: c.repo, hash: c.hash, msg: c.msg });
  }
  return map;
}

/** `iso` shifted by `n` days (n may be negative). UTC-noon anchored, so no DST edge cases. */
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday-first weekday index: 0=segunda ... 6=domingo. */
function weekdayMondayFirst(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return (d.getUTCDay() + 6) % 7;
}

/** The Monday of the week containing `iso` (itself if already a Monday). */
function mondayOf(iso) {
  return addDays(iso, -weekdayMondayFirst(iso));
}

/** current streak (ending today or yesterday) + longest streak, skipping rest days. */
function computeStreaks(commitMap, restDays, todayLogical) {
  const restSet = new Set(restDays);
  const hasCommit = (d) => (commitMap.get(d) || []).length > 0;

  // current streak: walk backward from today; today itself only counts if
  // it already has a commit, otherwise start from yesterday.
  let cursor = hasCommit(todayLogical) ? todayLogical : addDays(todayLogical, -1);
  let current = 0;
  // safety cap so a bug can't spin forever
  for (let i = 0; i < 3650; i++) {
    if (hasCommit(cursor)) {
      current++;
      cursor = addDays(cursor, -1);
    } else if (restSet.has(cursor)) {
      cursor = addDays(cursor, -1); // rest day: skip without breaking
    } else {
      break;
    }
  }

  // longest streak over the whole known range
  const dates = [...commitMap.keys()].sort();
  let longest = 0;
  if (dates.length) {
    let run = 0;
    let d = dates[0];
    const last = todayLogical;
    while (d <= last) {
      if (hasCommit(d) || restSet.has(d)) {
        if (hasCommit(d)) run++;
        if (run > longest) longest = run;
      } else {
        run = 0;
      }
      d = addDays(d, 1);
    }
  }

  return { current, longest };
}

/** Earliest known logical date with a commit, or null if the map is empty. */
function firstCommitDate(commitMap) {
  const dates = [...commitMap.keys()].sort();
  return dates.length ? dates[0] : null;
}

/**
 * The five KPI-row numbers from the plan: current streak, longest streak,
 * days-with-commit in the last 365, coverage %, and days lost this month.
 */
function computeKPIs(commitMap, restDays, todayLogical) {
  const streaks = computeStreaks(commitMap, restDays, todayLogical);
  const hasCommit = (d) => (commitMap.get(d) || []).length > 0;

  let daysWithCommit365 = 0;
  for (let i = 0; i < 365; i++) {
    if (hasCommit(addDays(todayLogical, -i))) daysWithCommit365++;
  }
  const coveragePct = Math.round((daysWithCommit365 / 365) * 100);

  const monthPrefix = todayLogical.slice(0, 7); // 'YYYY-MM'
  const restSet = new Set(restDays);
  let daysLostThisMonth = 0;
  let d = `${monthPrefix}-01`;
  while (d.startsWith(monthPrefix) && d <= todayLogical) {
    if (!hasCommit(d) && !restSet.has(d)) daysLostThisMonth++;
    d = addDays(d, 1);
  }

  return {
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    daysWithCommit365,
    coveragePct,
    daysLostThisMonth,
  };
}

/**
 * Consecutive empty (non-rest) days, grouped into runs — "quebras de streak" —
 * most recent first. Only looks at the past (up to and including today).
 */
function computeGaps(commitMap, restDays, todayLogical, { limit = 20 } = {}) {
  const restSet = new Set(restDays);
  const hasCommit = (d) => (commitMap.get(d) || []).length > 0;
  const first = firstCommitDate(commitMap) || todayLogical;

  const gaps = [];
  let runStart = null;
  let d = first;
  while (d <= todayLogical) {
    const empty = !hasCommit(d) && !restSet.has(d);
    if (empty) {
      if (runStart === null) runStart = d;
    } else if (runStart !== null) {
      gaps.push({ start: runStart, end: addDays(d, -1) });
      runStart = null;
    }
    d = addDays(d, 1);
  }
  if (runStart !== null) gaps.push({ start: runStart, end: addDays(todayLogical, 0) });

  gaps.reverse(); // most recent first
  return gaps.slice(0, limit).map((g) => ({
    ...g,
    days: Math.round((new Date(`${g.end}T12:00:00Z`) - new Date(`${g.start}T12:00:00Z`)) / 86400000) + 1,
  }));
}

/** Bucket a raw commit count into the 5-step sequential ramp (0, 1-2, 3-5, 6-9, 10+). */
function bucketForCount(count) {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

/**
 * Grid data for the 53-week heatmap: an array of 53 weeks, each an array of
 * 7 day cells (Monday -> Sunday), ending on the Sunday of the current week.
 * Each cell: { date, count, bucket, repos, status }, status one of
 * 'before-first' | 'normal' | 'future' — the zero-day ring only applies to
 * 'normal' (see plan.md § Design do heatmap).
 */
function buildHeatmapWeeks(commitMap, restDays, todayLogical, firstDate, weeksCount = 53) {
  const restSet = new Set(restDays);
  const endMonday = mondayOf(todayLogical);
  const startMonday = addDays(endMonday, -(weeksCount - 1) * 7);

  const days = [];
  let cursor = startMonday;
  for (let i = 0; i < weeksCount * 7; i++) {
    const entries = commitMap.get(cursor) || [];
    const count = entries.length;
    const isRest = restSet.has(cursor);
    let status = 'normal';
    if (cursor > todayLogical) status = 'future';
    else if (firstDate && cursor < firstDate) status = 'before-first';
    else if (isRest) status = 'rest';

    const byRepo = new Map();
    for (const e of entries) byRepo.set(e.repo, (byRepo.get(e.repo) || 0) + 1);

    days.push({
      date: cursor,
      count,
      bucket: bucketForCount(count),
      repos: [...byRepo.entries()].map(([repo, n]) => ({ repo, count: n })),
      status,
    });
    cursor = addDays(cursor, 1);
  }

  const weeks = [];
  for (let w = 0; w < weeksCount; w++) weeks.push(days.slice(w * 7, w * 7 + 7));
  return weeks;
}

/** Run `tasks` (zero-arg functions returning promises) with at most `limit` in flight. */
async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

const FULL_SCAN_SINCE = '13 months ago';
const FULL_RESCAN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // weekly
const INCREMENTAL_OVERLAP_DAYS = 2; // re-fetch a small overlap to catch amends/rebases

/**
 * Discover repos and refresh the cache: full `git log` on first sight or once
 * a week, an incremental `--since` window otherwise. Returns the updated
 * cache object (mutates `cache.repos` in place) plus the merged commit map.
 */
async function refreshCache(config, cache, { force = false } = {}) {
  const repoPaths = discoverRepos(config.roots, config.ignoredDirNames, config.maxDepth);
  const now = Date.now();

  const tasks = repoPaths.map((repoPath) => async () => {
    const prev = cache.repos[repoPath];
    const needsFull =
      force || !prev || now - new Date(prev.lastScan).getTime() > FULL_RESCAN_INTERVAL_MS;

    let since = FULL_SCAN_SINCE;
    if (!needsFull && prev.lastScan) {
      const overlap = new Date(prev.lastScan);
      overlap.setDate(overlap.getDate() - INCREMENTAL_OVERLAP_DAYS);
      since = overlap.toISOString();
    }

    const fresh = await scanRepo(repoPath, config.authors, since, {
      countMerges: config.countMerges,
    });

    const merged = needsFull ? fresh : mergeByHash(prev.commits || [], fresh);
    cache.repos[repoPath] = { lastScan: new Date().toISOString(), commits: merged };
  });

  await pool(tasks, 4);

  // drop repos that no longer exist on disk
  for (const known of Object.keys(cache.repos)) {
    if (!repoPaths.includes(known)) delete cache.repos[known];
  }

  const disabled = new Set(config.ignoredDirRepos || []);
  const all = [];
  for (const [repoPath, entry] of Object.entries(cache.repos)) {
    if (disabled.has(path.basename(repoPath))) continue;
    all.push(...entry.commits);
  }

  const commitMap = buildCommitMap(all, config.dayStartHour);
  return { cache, commitMap, repoPaths };
}

function mergeByHash(oldCommits, freshCommits) {
  const byHash = new Map(oldCommits.map((c) => [c.hash, c]));
  for (const c of freshCommits) byHash.set(c.hash, c);
  return [...byHash.values()];
}

module.exports = {
  discoverRepos,
  scanRepo,
  buildCommitMap,
  computeStreaks,
  logicalDate,
  logicalToday,
  refreshCache,
  addDays,
  weekdayMondayFirst,
  mondayOf,
  firstCommitDate,
  computeKPIs,
  bucketForCount,
  buildHeatmapWeeks,
  computeGaps,
};
