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

/** current streak (ending today or yesterday) + longest streak, skipping rest days. */
function computeStreaks(commitMap, restDays, todayLogical) {
  const restSet = new Set(restDays);
  const hasCommit = (d) => (commitMap.get(d) || []).length > 0;
  const addDays = (iso, n) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

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
};
