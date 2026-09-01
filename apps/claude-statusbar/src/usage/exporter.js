'use strict';

// Serializes the usage report into a file the user keeps: CSV to open in a
// spreadsheet, JSON for anything programmatic.
//
// No Electron import, for the same reason as indexer.js: these are pure string
// functions, runnable and checkable with plain `node` without starting the app.

const path = require('path');

// `;`, not `,` — same choice as the export in pocs/financing-simulator: Excel
// in pt-BR splits columns on the semicolon.
const SEPARATOR = ';';
const COLUMNS = ['secao', 'chave', 'tokens', 'custo_usd', 'tokens_sem_preco'];

const MIX_LABELS = {
  cacheRead: 'cache read',
  cacheWrite: 'cache creation',
  output: 'output',
  input: 'input',
};

/**
 * Long format (one row per bucket, with a `secao` column) instead of a wide
 * sheet: the report is four different tables — day, project, model, entrypoint —
 * plus the token mix. Wide would mean four files or one ragged sheet; long is a
 * single table any pivot filters by `secao`.
 *
 * `tokens_sem_preco` is blank on `dia` rows: the indexer only tracks what fell
 * outside the cost by project, model and entrypoint, not per day. Blank here
 * means "not measured at this granularity", not zero.
 *
 * Totals are left out on purpose: they're the sum of the `dia` rows, which the
 * spreadsheet does in one cell. Repeating them would only invite summing the
 * whole column and counting everything twice. Sessions and request count, which
 * aren't additive, go in the JSON export.
 *
 * @param {object} report report as `buildReport` returns it
 * @returns {string} CSV with a trailing newline
 */
function toCsv(report) {
  const rows = [COLUMNS];

  for (const day of report.byDay || []) {
    rows.push(['dia', day.day, day.tokens, money(day.cost), '']);
  }
  for (const [section, list] of [
    ['projeto', report.byProject],
    ['modelo', report.byModel],
    ['entrypoint', report.byEntrypoint],
  ]) {
    for (const entry of list || []) {
      rows.push([section, entry.name, entry.tokens, money(entry.cost), entry.unpriced]);
    }
  }
  for (const [key, label] of Object.entries(MIX_LABELS)) {
    const value = report.mix ? report.mix[key] : undefined;
    if (value === undefined) continue;
    // Cost blank, not zero: the mix is token counts only, and a zero here would
    // claim a measured cost that doesn't exist.
    rows.push(['composicao', label, value, '', '']);
  }

  return rows.map((row) => row.map(field).join(SEPARATOR)).join('\n') + '\n';
}

/**
 * JSON with the whole report — including what doesn't fit the CSV (totals,
 * sessions, pricing table version, scan stats).
 *
 * @param {object} report
 * @param {{now?: number}} options
 * @returns {string}
 */
function toJson(report, { now = Date.now() } = {}) {
  const { generatedAt, ...rest } = report;
  return `${JSON.stringify({
    exportedAt: new Date(now).toISOString(),
    // The report carries epoch ms; a readable date is worth more on the way out.
    generatedAt: new Date(generatedAt).toISOString(),
    ...rest,
  }, null, 2)}\n`;
}

/**
 * Serializes according to the extension picked in the save dialog.
 *
 * An unknown extension (or none, when the user types the name by hand) falls
 * back to CSV — the button's format — and the corrected path comes back, so a
 * `.txt` never silently ends up holding CSV.
 *
 * @param {string} filePath
 * @param {object} report
 * @param {{now?: number}} options
 * @returns {{filePath: string, format: 'csv'|'json', content: string}}
 */
function serializeFor(filePath, report, options = {}) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    return { filePath, format: 'json', content: toJson(report, options) };
  }
  const corrected = ext === '.csv' ? filePath : `${filePath}.csv`;
  return { filePath: corrected, format: 'csv', content: toCsv(report) };
}

/**
 * Suggested name: `claude-usage-30d-2026-09-01.csv`. The report's generation
 * date, not today's — the file describes the window it holds.
 *
 * @param {object} report
 * @param {'csv'|'json'} format
 * @returns {string}
 */
function defaultFileName(report, format = 'csv') {
  const at = new Date(report && report.generatedAt ? report.generatedAt : Date.now());
  const day = [
    at.getFullYear(),
    String(at.getMonth() + 1).padStart(2, '0'),
    String(at.getDate()).padStart(2, '0'),
  ].join('-');
  const days = report && report.days ? report.days : 30;
  return `claude-usage-${days}d-${day}.${format}`;
}

/** Raw numbers, decimal point: formatting is the UI's job, and the spreadsheet
 * has to be able to sum the column. */
function money(value) {
  if (value === null || value === undefined) return '';
  return Number(value).toFixed(4);
}

function field(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (text.includes(SEPARATOR) || text.includes('"') || /[\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

module.exports = { toCsv, toJson, serializeFor, defaultFileName, SEPARATOR, COLUMNS };
