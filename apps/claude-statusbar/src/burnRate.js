'use strict';

const fs = require('fs');
const path = require('path');

const { STATUSBAR_DIR, safeDate } = require('./bridge');

const HISTORY_PATH = path.join(STATUSBAR_DIR, 'rate-limits.jsonl');

// The bridge only appends, so never read the whole file to project: the
// projection looks at the current 5h window, which lives in the last few KB.
// `prune()` below is what keeps the file from growing without end.
const TAIL_BYTES = 256 * 1024;

// A day of heavy use is a few hundred KB, and nothing reads past the current
// window — 30 days is already far more history than the projection needs, kept
// only so the file can answer "how did last month look" by hand.
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const RECENT_MS = 90 * 60 * 1000; // preferred lookback for "no ritmo atual"
const MIN_SPAN_MS = 10 * 60 * 1000; // shortest span that yields a usable slope
const IDLE_AFTER_MS = 20 * 60 * 1000; // no new sample for this long = not burning
const MIN_MARGIN_MS = 15 * 60 * 1000; // ETA has to beat the reset by this to count
const FLAT_PCT_PER_HOUR = 0.5; // below this the slope is noise, not a trend
const MIN_SAMPLES = 2;
const WINDOW_MATCH_MS = 60 * 1000; // tolerance when matching resets_at values

/**
 * Reads the tail of rate-limits.jsonl into `{at, pct, resetsAt}` samples of the
 * 5h window, oldest first. Never throws: a missing file, a half-written last
 * line or a payload whose shape changed all degrade to "fewer samples".
 */
function readSamples(filePath = HISTORY_PATH) {
  let raw;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const { size } = fs.fstatSync(fd);
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      raw = buf.toString('utf8');
      // Starting mid-file almost certainly lands mid-line; drop that fragment.
      if (start > 0) raw = raw.slice(raw.indexOf('\n') + 1);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }

  const samples = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // the bridge appends without locking — a torn line is expected
    }
    const at = safeDate(entry.at);
    const win = entry.five_hour;
    const pct = win && typeof win.used_percentage === 'number' && Number.isFinite(win.used_percentage)
      ? win.used_percentage
      : null;
    if (!at || pct === null) continue;
    samples.push({ at, pct, resetsAt: safeDate(win.resets_at, true) });
  }

  samples.sort((a, b) => a.at - b.at);
  return samples;
}

/**
 * Drops samples older than the retention window from rate-limits.jsonl.
 *
 * The cut is "everything up to and including the last sample older than the
 * retention window". Nothing recent can be lost that way, and torn lines — the
 * bridge appends without locking, so a crash mid-write leaves one — go along
 * with the old samples around them instead of blocking the cut forever. A line
 * that can't be read is never what decides the boundary, in either direction.
 *
 * The file is append-ordered by time, so the scan stops at the first readable
 * sample inside the window, and everything from the cut on is copied byte for
 * byte — no reserialization, nothing rewritten that didn't have to be.
 *
 * @param {{filePath?: string, now?: number, retentionMs?: number}} [options]
 * @returns {{status: 'pruned'|'kept'|'missing'|'failed', dropped?: number, freed?: number, error?: string}}
 */
function prune(options = {}) {
  const { filePath = HISTORY_PATH, now = Date.now(), retentionMs = RETENTION_MS } = options;
  const cutoff = now - retentionMs;

  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (err) {
    return err.code === 'ENOENT'
      ? { status: 'missing' }
      : { status: 'failed', error: err.message };
  }

  let cut = 0;
  let dropped = 0;
  let seen = 0;
  let scan = 0;
  while (scan < buf.length) {
    const nl = buf.indexOf(0x0a, scan);
    if (nl === -1) break; // last line still being written — not ours to judge
    seen += 1;
    const age = ageOf(buf.toString('utf8', scan, nl), cutoff);
    if (age === 'recent') break; // from here on it's inside the window
    if (age === 'old') {
      cut = nl + 1;
      dropped = seen;
    }
    scan = nl + 1; // 'unreadable' — keep scanning; it doesn't decide the cut
  }
  const offset = cut;
  if (offset === 0) return { status: 'kept', dropped: 0 };

  try {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, buf.subarray(offset));
    // The bridge appends without locking, so a sample written between the read
    // above and the rename below would go to the old inode and vanish. Copy
    // whatever arrived in the meantime into the temp file first — that narrows
    // the loss window to the rename itself.
    const after = fs.statSync(filePath);
    if (after.size > buf.length) {
      const fd = fs.openSync(filePath, 'r');
      try {
        const delta = Buffer.alloc(after.size - buf.length);
        fs.readSync(fd, delta, 0, delta.length, buf.length);
        fs.appendFileSync(tmp, delta);
      } finally {
        fs.closeSync(fd);
      }
    }
    fs.renameSync(tmp, filePath);
  } catch (err) {
    return { status: 'failed', error: err.message };
  }

  return { status: 'pruned', dropped, freed: offset };
}

/**
 * Where a line falls relative to the retention window: 'old', 'recent', or
 * 'unreadable' for a blank, torn or shape-changed line, which is carried by the
 * samples around it rather than judged on its own.
 */
function ageOf(line, cutoff) {
  if (!line.trim()) return 'unreadable';
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return 'unreadable';
  }
  const at = safeDate(entry.at);
  if (!at) return 'unreadable';
  return at.getTime() < cutoff ? 'old' : 'recent';
}

/**
 * Projects when the current 5h window runs out at the pace measured from the
 * history file — the "no ritmo atual, estoura às 16h40" line.
 *
 * @param {object} current result from bridge.readLatest()
 * @param {{now?: Date, samples?: Array, path?: string}} [options]
 * @returns {{
 *   state: 'projecting'|'flat'|'idle'|'insufficient'|'missing'|'exhausted',
 *   label: string,
 *   pctPerHour: number|null,
 *   etaAt: Date|null,
 *   hitsBeforeReset: boolean,
 *   samples: number,
 *   spanMs: number,
 * }}
 */
function analyze(current, options = {}) {
  const now = options.now ? options.now.getTime() : Date.now();
  const samples = options.samples || readSamples(options.path);
  const pct = current && current.fiveHour ? current.fiveHour.pct : null;
  const resetsAt = current && current.fiveHour ? current.fiveHour.resetsAt : null;

  if (!samples.length) return result('missing', 'ritmo: sem histórico ainda');

  const windowSamples = sameWindow(samples, resetsAt);
  if (windowSamples.length < MIN_SAMPLES) {
    return result('insufficient', 'ritmo: amostra curta nesta janela');
  }

  // A rate measured from samples that stopped an hour ago isn't a rate — it's
  // the memory of one. Nothing is burning while no session is running.
  const last = windowSamples[windowSamples.length - 1];
  const idleMs = now - last.at.getTime();
  if (idleMs > IDLE_AFTER_MS) {
    return result('idle', `sem consumo há ${humanDuration(idleMs)}`, { samples: windowSamples.length });
  }

  const fit = pickFit(windowSamples);
  if (!fit) return result('insufficient', 'ritmo: amostra curta nesta janela');

  const base = { pctPerHour: fit.slope, samples: fit.points.length, spanMs: fit.spanMs };
  if (fit.slope < FLAT_PCT_PER_HOUR) {
    return result('flat', 'ritmo: consumo praticamente parado', base);
  }

  const currentPct = pct === null ? last.pct : pct;
  const remaining = 100 - currentPct;
  if (remaining <= 0) return result('exhausted', 'janela esgotada', base);

  const etaAt = new Date(now + (remaining / fit.slope) * 3600 * 1000);
  const rate = formatRate(fit.slope);

  // Three outcomes, not two: an ETA that lands within a few minutes of the
  // reset is a coin flip, and calling that "reseta antes" is a reassurance the
  // data doesn't support.
  const marginMs = resetsAt ? resetsAt.getTime() - etaAt.getTime() : null;
  const hitsBeforeReset = marginMs !== null && marginMs > MIN_MARGIN_MS;
  let label;
  if (marginMs === null) label = `ritmo ${rate} · estoura ${formatEta(etaAt, now)}`;
  else if (hitsBeforeReset) label = `ritmo ${rate} · estoura ${formatEta(etaAt, now)}`;
  else if (marginMs > -MIN_MARGIN_MS) label = `ritmo ${rate} · estoura em cima do reset`;
  else label = `ritmo ${rate} · reseta antes de estourar`;

  return result('projecting', label, { ...base, etaAt, hitsBeforeReset });
}

/**
 * Keeps only the samples belonging to the window that is currently open —
 * across a reset the percentage drops back to ~0, and a slope fitted through
 * that cliff is meaningless (or negative).
 */
function sameWindow(samples, resetsAt) {
  let key = resetsAt ? resetsAt.getTime() : null;
  if (key === null) {
    const withReset = samples.filter((s) => s.resetsAt);
    key = withReset.length ? withReset[withReset.length - 1].resetsAt.getTime() : null;
  }
  if (key === null) return samples; // no window info at all — treat as one window
  return samples.filter((s) => s.resetsAt && Math.abs(s.resetsAt.getTime() - key) <= WINDOW_MATCH_MS);
}

/**
 * Fits the last ~90 min when that stretch is long enough to mean something,
 * and the whole window otherwise. "Ritmo atual" should react to a burst that
 * started 20 minutes ago, not average it away against a quiet morning.
 */
function pickFit(windowSamples) {
  const lastAt = windowSamples[windowSamples.length - 1].at.getTime();
  const recent = windowSamples.filter((s) => lastAt - s.at.getTime() <= RECENT_MS);
  if (recent.length >= MIN_SAMPLES && span(recent) >= MIN_SPAN_MS) return fitPoints(recent);
  if (span(windowSamples) >= MIN_SPAN_MS) return fitPoints(windowSamples);
  return null;
}

/** Least-squares slope in percentage points per hour. */
function fitPoints(points) {
  const t0 = points[0].at.getTime();
  const xs = points.map((p) => (p.at.getTime() - t0) / 3600000);
  const ys = points.map((p) => p.pct);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;

  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i += 1) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null; // every sample at the same instant

  return { slope: num / den, points, spanMs: span(points) };
}

function span(points) {
  if (points.length < 2) return 0;
  return points[points.length - 1].at.getTime() - points[0].at.getTime();
}

function result(state, label, extra = {}) {
  return {
    state,
    label,
    pctPerHour: null,
    etaAt: null,
    hitsBeforeReset: false,
    samples: 0,
    spanMs: 0,
    ...extra,
  };
}

function formatRate(pctPerHour) {
  const rounded = pctPerHour >= 10 ? Math.round(pctPerHour) : Math.round(pctPerHour * 10) / 10;
  return `${rounded}%/h`;
}

function formatEta(etaAt, now) {
  const sameDay = new Date(now).toDateString() === etaAt.toDateString();
  if (!sameDay) return `em ${humanDuration(etaAt.getTime() - now)}`;
  return `às ${etaAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function humanDuration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h >= 24) return `${Math.round(h / 24)}d`;
  const rest = min % 60;
  return rest === 0 ? `${h}h` : `${h}h${String(rest).padStart(2, '0')}`;
}

module.exports = {
  analyze,
  readSamples,
  prune,
  HISTORY_PATH,
  RETENTION_MS,
};
