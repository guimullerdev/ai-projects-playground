'use strict';

// Source B — the transcripts in ~/.claude/projects/<slug>/<sessionId>.jsonl.
//
// Two things make a naive scan wrong or slow, and both are handled here:
//
// 1. DUPLICATES. Resume, session fork and sidechains copy earlier history into
//    the new file, so the same assistant turn appears in several files. On this
//    machine that was 46% of the usage lines — counting them twice nearly
//    doubles every number. Dedup is by (message.id, requestId), globally, not
//    per file, which is why the cache below stores per-record keys instead of
//    per-file totals.
// 2. SIZE. Tens of MB of JSONL that only ever grow at the end. The cache keeps
//    a byte offset per file and reads just the tail, so a rescan costs
//    milliseconds after the first one.
//
// What comes out is tokens, never a percentage of the plan limit — that number
// only exists in Source A (bridge.js). Cost here is an estimate; see pricing.js.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { PRICING_VERSION, estimateCost, isPriced } = require('./pricing');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const CACHE_PATH = path.join(os.homedir(), '.claude', 'statusbar', 'usage-index.json');

const CACHE_VERSION = 1;
const RETENTION_DAYS = 90; // older records are dropped when the cache is written

/**
 * Scans the transcripts incrementally and returns every usage record known,
 * deduplicated. Never throws: an unreadable file is skipped, a corrupt cache is
 * rebuilt from scratch.
 *
 * @returns {{records: Array, stats: {files: number, filesRescanned: number, bytesRead: number, ms: number}}}
 */
function scan() {
  const startedAt = Date.now();
  const cache = loadCache();
  const knownFiles = Object.keys(cache.files).length;
  const files = listJsonlFiles(PROJECTS_DIR);
  const nextFiles = {};
  let filesRescanned = 0;
  let bytesRead = 0;

  for (const file of files) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue; // deleted between listing and stat — just drop it from the cache
    }

    const cached = cache.files[file];
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      nextFiles[file] = cached; // untouched since the last scan
      continue;
    }

    // A JSONL transcript only grows, so an append is read from the stored
    // offset. A file smaller than that offset was rewritten, and the offset is
    // meaningless — it has to be read from the top again.
    const reusable = cached && stat.size >= cached.offset;
    const from = reusable ? cached.offset : 0;
    const records = reusable ? cached.records : [];

    filesRescanned += 1;
    const tail = readFrom(file, from);
    if (tail === null) continue;
    bytesRead += tail.bytesRead;

    const parsed = parseLines(tail.text);
    nextFiles[file] = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      offset: from + tail.bytesRead - parsed.trailingPartialBytes,
      records: records.concat(parsed.records),
    };
  }

  cache.files = nextFiles;

  // Dedup is global — the same turn can live in several files after a resume.
  const byKey = new Map();
  for (const entry of Object.values(nextFiles)) {
    for (const rec of entry.records) {
      if (!byKey.has(rec.k)) byKey.set(rec.k, rec);
    }
  }

  // Rewriting the cache costs a multi-MB write, so it only happens when
  // something actually moved — the popover re-indexing on every open shouldn't
  // hit the disk for nothing.
  if (filesRescanned > 0 || knownFiles !== Object.keys(nextFiles).length) saveCache(cache);

  return {
    records: [...byKey.values()].map(expand),
    stats: {
      files: files.length,
      filesRescanned,
      bytesRead,
      ms: Date.now() - startedAt,
    },
  };
}

/** Parses a chunk of JSONL into compact records, ignoring an incomplete last line. */
function parseLines(text) {
  const endsClean = text.endsWith('\n');
  const lines = text.split('\n');
  const trailingPartial = endsClean ? '' : lines.pop() ?? '';
  const records = [];

  for (const line of lines) {
    // Cheap pre-filter before JSON.parse: only assistant turns carry usage.
    if (!line || !line.includes('"usage"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const rec = toRecord(entry);
    if (rec) records.push(rec);
  }

  return { records, trailingPartialBytes: Buffer.byteLength(trailingPartial, 'utf8') };
}

/** Compact on-disk record — short keys because this file holds tens of thousands of them. */
function toRecord(entry) {
  const msg = entry && entry.message;
  const usage = msg && msg.usage;
  if (!usage || typeof entry.timestamp !== 'string') return null;

  const key = `${msg.id || ''}|${entry.requestId || ''}`;
  if (key === '|') return null; // nothing stable to dedupe on — skip over risking a double count

  const ts = Date.parse(entry.timestamp);
  if (!Number.isFinite(ts)) return null;

  // cache_creation splits the write by TTL, and the two are priced differently
  // (1.25x vs 2x input). When it's absent, everything counts as the 5m rate.
  const creation = usage.cache_creation || null;
  const write1h = creation ? num(creation.ephemeral_1h_input_tokens) : 0;
  const write5mRaw = creation ? num(creation.ephemeral_5m_input_tokens) : 0;
  const writeTotal = num(usage.cache_creation_input_tokens);
  const write5m = creation ? write5mRaw : writeTotal;

  return {
    k: key,
    t: ts,
    p: entry.cwd || null,
    m: (msg.model && String(msg.model)) || null,
    e: entry.entrypoint || null,
    s: entry.sessionId || null,
    i: num(usage.input_tokens),
    o: num(usage.output_tokens),
    w5: write5m,
    w1: write1h,
    r: num(usage.cache_read_input_tokens),
  };
}

function expand(rec) {
  return {
    key: rec.k,
    at: rec.t,
    cwd: rec.p,
    project: projectName(rec.p),
    model: rec.m,
    entrypoint: rec.e,
    sessionId: rec.s,
    input: rec.i,
    output: rec.o,
    cacheWrite5m: rec.w5,
    cacheWrite1h: rec.w1,
    cacheRead: rec.r,
    get tokens() {
      return this.input + this.output + this.cacheWrite5m + this.cacheWrite1h + this.cacheRead;
    },
  };
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Turns a session's cwd into a project name. The cwd is often a subdirectory of
 * a repo (a session opened in apps/foo), so walking up to the git root keeps
 * those from showing up as separate projects.
 */
const projectNameCache = new Map();
function projectName(cwd) {
  if (!cwd) return 'desconhecido';
  if (projectNameCache.has(cwd)) return projectNameCache.get(cwd);

  let dir = cwd;
  let name = path.basename(cwd);
  while (dir && dir !== path.dirname(dir)) {
    try {
      if (fs.existsSync(path.join(dir, '.git'))) {
        name = path.basename(dir);
        break;
      }
    } catch {
      break;
    }
    dir = path.dirname(dir);
  }

  projectNameCache.set(cwd, name);
  return name;
}

function readFrom(file, offset) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(fd);
    const length = size - offset;
    if (length <= 0) return { text: '', bytesRead: 0 };
    const buf = Buffer.allocUnsafe(length);
    const bytesRead = fs.readSync(fd, buf, 0, length, offset);
    return { text: buf.toString('utf8', 0, bytesRead), bytesRead };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // nothing useful to do — the fd goes away with the process anyway
      }
    }
  }
}

function listJsonlFiles(dir) {
  const result = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listJsonlFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(full);
  }
  return result;
}

function loadCache() {
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    if (cache && cache.version === CACHE_VERSION && cache.files) return cache;
  } catch {
    // no cache, unreadable or from an older layout — rebuild from scratch
  }
  return { version: CACHE_VERSION, files: {} };
}

function saveCache(cache) {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = {};
  for (const [file, entry] of Object.entries(cache.files)) {
    // Pruning old records keeps the cache from growing forever, but the offset
    // stays where it is: those bytes are still read and their records dropped
    // again, never re-counted.
    files[file] = { ...entry, records: entry.records.filter((rec) => rec.t >= cutoff) };
  }

  const payload = JSON.stringify({ version: CACHE_VERSION, files });
  const tmp = `${CACHE_PATH}.tmp`;
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, CACHE_PATH);
  } catch {
    // best-effort: without the cache the next scan is just slower, not wrong
  }
}

function localDay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Aggregates records into everything the report window draws.
 *
 * @param {Array} records
 * @param {{days?: number, now?: number}} options
 */
function buildReport(records, { days = 30, now = Date.now() } = {}) {
  const today = localDay(new Date(now));
  const dayKeys = [];
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (days - 1));
  const windowStart = cursor.getTime();
  for (let i = 0; i < days; i += 1) {
    dayKeys.push(localDay(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const byDay = new Map(dayKeys.map((day) => [day, { day, tokens: 0, cost: 0 }]));
  const byProject = new Map();
  const byModel = new Map();
  const byEntrypoint = new Map();
  const mix = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  const sessions = new Set();
  const todaySessions = new Set();
  const todayModelTokens = new Map();
  const unpricedModels = new Set();

  let tokens = 0;
  let cost = 0;
  let unpricedTokens = 0;
  let todayTokens = 0;
  let todayCost = 0;

  for (const rec of records) {
    if (rec.at < windowStart) continue;
    const day = localDay(new Date(rec.at));
    const bucket = byDay.get(day);
    if (!bucket) continue; // future timestamp (clock skew) — outside the window

    const recTokens = rec.tokens;
    const recCost = estimateCost(rec);
    tokens += recTokens;
    if (recCost === null) {
      unpricedTokens += recTokens;
      // A model with no tokens (a synthetic turn) isn't worth reporting as an
      // unpriced model — it would claim a gap the numbers don't have.
      if (rec.model && recTokens > 0) unpricedModels.add(rec.model);
    } else {
      cost += recCost;
    }

    bucket.tokens += recTokens;
    bucket.cost += recCost || 0;

    add(byProject, rec.project || 'desconhecido', recTokens, recCost);
    add(byModel, rec.model || 'desconhecido', recTokens, recCost);
    add(byEntrypoint, entrypointLabel(rec.entrypoint), recTokens, recCost);

    mix.input += rec.input;
    mix.output += rec.output;
    mix.cacheWrite += rec.cacheWrite5m + rec.cacheWrite1h;
    mix.cacheRead += rec.cacheRead;

    if (rec.sessionId) sessions.add(rec.sessionId);

    if (day === today) {
      todayTokens += recTokens;
      todayCost += recCost || 0;
      if (rec.sessionId) todaySessions.add(rec.sessionId);
      if (rec.model) todayModelTokens.set(rec.model, (todayModelTokens.get(rec.model) || 0) + recTokens);
    }
  }

  return {
    ok: true,
    generatedAt: now,
    days,
    totals: {
      tokens,
      cost,
      unpricedTokens,
      sessions: sessions.size,
      requests: records.length,
    },
    byDay: dayKeys.map((day) => byDay.get(day)),
    byProject: rank(byProject),
    byModel: rank(byModel),
    byEntrypoint: rank(byEntrypoint),
    mix,
    today: {
      ok: true,
      tokens: todayTokens,
      cost: todayCost,
      sessions: todaySessions.size,
      topModel: topKey(todayModelTokens),
    },
    meta: {
      pricingVersion: PRICING_VERSION,
      unpricedModels: [...unpricedModels],
    },
  };
}

function add(map, key, tokens, cost) {
  const current = map.get(key) || { name: key, tokens: 0, cost: 0, unpriced: 0 };
  current.tokens += tokens;
  if (cost === null) current.unpriced += tokens;
  else current.cost += cost;
  map.set(key, current);
}

function rank(map) {
  return [...map.values()]
    .filter((entry) => entry.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
}

function topKey(map) {
  let top = null;
  let best = -1;
  for (const [key, value] of map) {
    if (value > best) {
      top = key;
      best = value;
    }
  }
  return top;
}

function entrypointLabel(entrypoint) {
  if (entrypoint === 'claude-desktop') return 'app desktop';
  if (entrypoint === 'cli') return 'CLI';
  return entrypoint || 'desconhecido';
}

/** Convenience wrapper: scan + aggregate in one call. */
function loadReport(options = {}) {
  const { records, stats } = scan();
  const report = buildReport(records, options);
  report.scan = stats;
  return report;
}

function emptyReport(days = 30) {
  return buildReport([], { days });
}

module.exports = { scan, buildReport, loadReport, emptyReport, isPriced, CACHE_PATH, PROJECTS_DIR };
