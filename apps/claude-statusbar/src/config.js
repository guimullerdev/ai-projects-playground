'use strict';

// User preferences: what the tray title shows, when the app notifies, how long
// a window the report covers.
//
// Stored in ~/.claude/statusbar/config.json, next to latest.json and
// notified.json, instead of Electron's userData directory: everything this app
// owns already lives in that one folder, and a JSON the user can open and edit
// by hand beats one buried in Application Support.
//
// No Electron import, same as the other data modules — this is fs plus
// validation, runnable and checkable with plain `node`.

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATUSBAR_DIR = path.join(os.homedir(), '.claude', 'statusbar');
const CONFIG_PATH = path.join(STATUSBAR_DIR, 'config.json');

const TRAY_TITLES = ['percent', 'reset'];
const MAX_THRESHOLDS = 4;

const DEFAULTS = {
  trayTitle: 'percent', // 'percent' = ◐ 42% · 'reset' = ◐ 1h12
  thresholds: [70, 90], // ascending; main.js fires the highest crossed one
  burnNotify: true,
  reportDays: 30,
  openAtLogin: false,
};

/**
 * Reads the config, filling in anything missing or invalid with the default.
 * Never throws: a truncated or hand-edited file degrades to defaults, because
 * the app failing to start over a preference would be worse than ignoring it.
 *
 * @returns {typeof DEFAULTS}
 */
function load() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { ...DEFAULTS };
  }
  return normalize(raw);
}

/**
 * Merges a patch into the stored config and writes it back.
 *
 * Writes atomically (tmp + rename) for the same reason the bridge does: the
 * app reads this file on its own schedule, and a half-written config read
 * mid-save would look like a corrupt one.
 *
 * @param {object} patch fields to change
 * @returns {typeof DEFAULTS} the config as it was actually saved
 */
function save(patch) {
  const next = normalize({ ...load(), ...patch });
  fs.mkdirSync(STATUSBAR_DIR, { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
  return next;
}

/**
 * Coerces whatever is in the file into something the app can run on. Every
 * field falls back to its default on its own — one bad value shouldn't reset
 * the other preferences the user did set.
 *
 * @param {object} raw
 * @returns {typeof DEFAULTS}
 */
function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    trayTitle: TRAY_TITLES.includes(source.trayTitle) ? source.trayTitle : DEFAULTS.trayTitle,
    thresholds: thresholds(source.thresholds),
    burnNotify: typeof source.burnNotify === 'boolean' ? source.burnNotify : DEFAULTS.burnNotify,
    reportDays: integer(source.reportDays, 1, 365, DEFAULTS.reportDays),
    // Intent only — the OS holds the real login item, and main.js reconciles the
    // two at startup with the OS winning.
    openAtLogin: typeof source.openAtLogin === 'boolean' ? source.openAtLogin : DEFAULTS.openAtLogin,
  };
}

/**
 * An empty list is a legitimate answer — it means "don't notify on thresholds"
 * — so it's kept instead of falling back to the default. Only a value that
 * isn't a list at all goes back to the default.
 */
function thresholds(value) {
  if (!Array.isArray(value)) return [...DEFAULTS.thresholds];
  const cleaned = [...new Set(
    value
      .map((entry) => integer(entry, 1, 100, null))
      .filter((entry) => entry !== null),
  )].sort((a, b) => a - b);
  return cleaned.slice(0, MAX_THRESHOLDS);
}

function integer(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

module.exports = { load, save, normalize, DEFAULTS, TRAY_TITLES, CONFIG_PATH };
