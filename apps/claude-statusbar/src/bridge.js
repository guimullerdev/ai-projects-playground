'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATUSBAR_DIR = path.join(os.homedir(), '.claude', 'statusbar');
const LATEST_PATH = path.join(STATUSBAR_DIR, 'latest.json');

const STALE_AFTER_MS = 15 * 60 * 1000; // dimmed "stale" past this
const DEAD_AFTER_MS = 6 * 60 * 60 * 1000; // treated as "no data" past this

/**
 * Reads and normalizes the latest statusline payload dumped by the bridge
 * script. Never throws — the payload format can change between Claude Code
 * versions, and a missing/malformed field should degrade to "no data",
 * never crash the app.
 *
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   capturedAt?: Date,
 *   ageMs?: number,
 *   freshness: 'live'|'stale'|'dead'|'missing',
 *   fiveHour: {pct: number|null, resetsAt: Date|null},
 *   sevenDay: {pct: number|null, resetsAt: Date|null},
 *   model?: string,
 * }}
 */
function readLatest() {
  let raw;
  try {
    raw = fs.readFileSync(LATEST_PATH, 'utf8');
  } catch (err) {
    return emptyResult('missing', err.code === 'ENOENT'
      ? 'no bridge data yet — run scripts/install-bridge.sh and open a Claude Code session'
      : `can't read ${LATEST_PATH}: ${err.message}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return emptyResult('missing', `latest.json is malformed: ${err.message}`);
  }

  const capturedAt = safeDate(data.captured_at);
  const ageMs = capturedAt ? Date.now() - capturedAt.getTime() : null;
  const freshness = classifyFreshness(ageMs);

  return {
    ok: true,
    capturedAt,
    ageMs,
    freshness,
    fiveHour: extractWindow(data, 'five_hour'),
    sevenDay: extractWindow(data, 'seven_day'),
    model: safeString(data, ['model', 'display_name']),
  };
}

function classifyFreshness(ageMs) {
  if (ageMs === null) return 'missing';
  if (ageMs < STALE_AFTER_MS) return 'live';
  if (ageMs < DEAD_AFTER_MS) return 'stale';
  return 'dead';
}

function extractWindow(data, key) {
  const win = data && data.rate_limits && data.rate_limits[key];
  const pctRaw = win && win.used_percentage;
  const pct = typeof pctRaw === 'number' && Number.isFinite(pctRaw) ? pctRaw : null;
  const resetsAt = win ? safeDate(win.resets_at, true) : null;
  return { pct, resetsAt };
}

function safeDate(value, epochSeconds) {
  if (value === undefined || value === null || value === '') return null;
  const ms = epochSeconds ? Number(value) * 1000 : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function safeString(data, pathParts) {
  let cur = data;
  for (const part of pathParts) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : null;
}

function emptyResult(freshness, reason) {
  return {
    ok: false,
    reason,
    freshness,
    fiveHour: { pct: null, resetsAt: null },
    sevenDay: { pct: null, resetsAt: null },
  };
}

/** Human label for how stale the data is, e.g. "atualizado agora" / "há 8 min". */
function freshnessLabel(result) {
  if (!result.ok || result.ageMs === null) return 'sem dado';
  const min = Math.round(result.ageMs / 60000);
  if (min < 1) return 'atualizado agora';
  if (min < 60) return `atualizado há ${min} min`;
  const hours = Math.round(min / 60);
  const elapsed = hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
  if (result.freshness === 'dead') return `há ${elapsed} — sem sessão aberta`;
  return `atualizado há ${elapsed}`;
}

/** Human countdown to a reset timestamp, e.g. "reseta em 1h12". */
function countdownLabel(resetsAt) {
  if (!resetsAt) return null;
  const diffMs = resetsAt.getTime() - Date.now();
  if (diffMs <= 0) return 'janela nova — sem dado ainda';
  const totalMin = Math.round(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `reseta em ${m}min`;
  return `reseta em ${h}h${String(m).padStart(2, '0')}`;
}

function watchLatest(onChange) {
  fs.mkdirSync(STATUSBAR_DIR, { recursive: true });
  // Watch the directory rather than the file: the bridge writes via a
  // temp-file + rename, which replaces the inode and can break a
  // file-level watch on some platforms.
  let debounce = null;
  const watcher = fs.watch(STATUSBAR_DIR, { persistent: true }, (eventType, filename) => {
    if (filename && filename !== 'latest.json') return;
    clearTimeout(debounce);
    debounce = setTimeout(() => onChange(readLatest()), 150);
  });
  return () => watcher.close();
}

module.exports = {
  readLatest,
  freshnessLabel,
  countdownLabel,
  watchLatest,
  STATUSBAR_DIR,
  LATEST_PATH,
};
