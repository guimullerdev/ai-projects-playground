'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Notification, ipcMain, dialog, shell } = require('electron');
const { menubar } = require('menubar');
const { readLatest, freshnessLabel, countdownLabel, watchLatest, STATUSBAR_DIR } = require('./bridge');
const { analyze, prune } = require('./burnRate');
const { loadReport } = require('./usage/indexer');
const { serializeFor, defaultFileName } = require('./usage/exporter');
const configStore = require('./config');

// Below this the window is too young for a slope to extrapolate honestly — a
// burst at 4% projects an ETA that the next quiet minute invalidates.
const BURN_NOTIFY_FLOOR = 25;
const NOTIFIED_PATH = path.join(STATUSBAR_DIR, 'notified.json');
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;

// Thresholds, tray title, report window and the pace warning come from here now
// (~/.claude/statusbar/config.json), edited in the preferences window.
let config = configStore.load();

const mb = menubar({
  index: `file://${path.join(__dirname, 'popover', 'index.html')}`,
  icon: path.join(__dirname, 'popover', 'iconTemplate.png'),
  browserWindow: {
    width: 320,
    height: 302,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'popover', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  },
  preloadWindow: true,
  showDockIcon: false,
});

let lastResult = null;
let lastBurn = null;
let lastReport = null;
let reportWindow = null;
let prefsWindow = null;

mb.on('ready', () => {
  applyLoginItem();
  pruneHistory();
  render(readLatest());
  refreshUsage();
  watchLatest(render);
  // Local countdowns/freshness age independently of new bridge writes —
  // refresh the label every 30s even with no new data.
  setInterval(() => render(lastResult ?? readLatest()), 30 * 1000);
  // The transcript index is incremental (see usage/indexer.js), so a refresh is
  // milliseconds after the first one — but it still reads the disk, so it stays
  // on its own slow interval instead of running on every render.
  setInterval(refreshUsage, 5 * 60 * 1000);
  // Retention only advances while the app runs. The bridge keeps appending
  // whether it's open or not, so the first launch after a long gap is the one
  // that does the catching up — which is exactly what the startup call above is.
  setInterval(pruneHistory, PRUNE_EVERY_MS);
});

mb.on('after-create-window', () => {
  mb.window.webContents.on('did-finish-load', () => {
    if (lastResult) pushToWindow(lastResult);
  });
});

// The popover is what the user looks at most; re-index when it opens so "hoje"
// is current the moment it's read.
mb.on('show', () => refreshUsage());

ipcMain.on('statusbar:open-report', openReport);
ipcMain.on('statusbar:open-prefs', openPrefs);
ipcMain.handle('statusbar:prefs', () => ({
  config,
  defaults: configStore.DEFAULTS,
  configPath: configStore.CONFIG_PATH,
  // In dev (`npm start`) the login item registers the Electron binary, not a
  // real .app — the preferences window says so instead of promising otherwise.
  packaged: app.isPackaged,
}));
ipcMain.handle('statusbar:save-prefs', (_event, patch) => savePrefs(patch));
ipcMain.handle('statusbar:open-project', (_event, dir) => openProject(dir));
ipcMain.handle('statusbar:report', () => lastReport ?? refreshUsage());
ipcMain.handle('statusbar:refresh-report', () => refreshUsage());
ipcMain.handle('statusbar:export-report', () => exportReport());

function pruneHistory() {
  const result = prune();
  if (result.status === 'pruned') {
    console.log(`rate-limits.jsonl: dropped ${result.dropped} samples past retention (${Math.round(result.freed / 1024)} KB)`);
  } else if (result.status === 'failed') {
    // Retention is housekeeping: failing to trim the history is not a reason to
    // interfere with an app whose job is showing a percentage.
    console.error('rate-limits.jsonl prune failed:', result.error);
  }
}

function refreshUsage() {
  try {
    lastReport = loadReport({ days: config.reportDays });
  } catch (err) {
    // The index is a nice-to-have next to the rate-limit bridge: if the
    // transcripts can't be read, the app keeps showing the percentage.
    console.error('usage index failed:', err.message);
  }
  if (mb.window && !mb.window.isDestroyed() && lastResult) pushToWindow(lastResult);
  if (reportWindow && !reportWindow.isDestroyed() && lastReport) {
    reportWindow.webContents.send('statusbar:report-update', lastReport);
  }
  return lastReport;
}

// Opens a project folder in Finder. The path comes from the transcripts' own
// `cwd`, walked up to the git root by the indexer — so it's a directory the user
// already worked in, not input from anywhere else. It's still checked before
// opening: a repo that was moved or deleted since the session should say so
// instead of failing silently.
async function openProject(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
    return { ok: false, error: 'caminho inválido' };
  }
  if (!fs.existsSync(dir)) return { ok: false, error: 'pasta não existe mais' };
  const error = await shell.openPath(dir);
  return error ? { ok: false, error } : { ok: true };
}

// Every preference applies to the running app right away: the tray redraws with
// the new title mode, the next render notifies by the new thresholds, and a
// changed report window re-indexes. Nothing here needs a restart.
function savePrefs(patch) {
  const previous = config;
  try {
    config = configStore.save(patch);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  render(lastResult ?? readLatest());
  if (config.reportDays !== previous.reportDays) refreshUsage();
  if (config.openAtLogin !== previous.openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: config.openAtLogin });
  }
  return { ok: true, config };
}

// Re-registers the login item on startup when the preference is on, so the
// entry survives a move or a reinstall of the app.
//
// Deliberately one-way, and only in the "on" direction. Reading the current
// state back is not an option: `getLoginItemSettings().openAtLogin` reports
// true on a dev run where nothing was ever registered, so trusting it would
// flip the preference on by itself. And applying the "off" case on startup
// would mean deleting a login item on every launch of an app whose default is
// off — work with nothing to gain. Turning the checkbox off unregisters it
// right there in savePrefs, which is where the user actually asked for it.
function applyLoginItem() {
  if (!config.openAtLogin) return;
  try {
    app.setLoginItemSettings({ openAtLogin: true });
  } catch (err) {
    // A login item that can't be registered is not a reason to fail to start.
    console.error('login item failed:', err.message);
  }
}

function openPrefs() {
  if (prefsWindow && !prefsWindow.isDestroyed()) {
    app.focus({ steal: true });
    prefsWindow.show();
    prefsWindow.focus();
    return;
  }

  prefsWindow = new BrowserWindow({
    width: 420,
    // Measured against the form at its tallest (dev build, where the login item
    // carries an extra note); the packaged app leaves ~40px of air at the bottom.
    height: 770,
    // Content size, not window size: the form is a fixed height and the title
    // bar would otherwise eat the config path line at the bottom.
    useContentSize: true,
    resizable: false,
    title: 'Claude Statusbar — Preferências',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'prefs', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  prefsWindow.loadFile(path.join(__dirname, 'prefs', 'index.html'));
  prefsWindow.once('ready-to-show', () => {
    app.focus({ steal: true });
    prefsWindow.show();
  });
  prefsWindow.on('closed', () => {
    prefsWindow = null;
  });
}

// Exports the report that's on screen — not a fresh scan. The file has to match
// the numbers the user was looking at when they clicked.
async function exportReport() {
  const report = lastReport ?? refreshUsage();
  if (!report) return { ok: false, error: 'sem relatório para exportar' };

  const options = {
    title: 'Exportar relatório de uso',
    defaultPath: path.join(app.getPath('downloads'), defaultFileName(report, 'csv')),
    filters: [
      { name: 'CSV (planilha)', extensions: ['csv'] },
      { name: 'JSON (relatório completo)', extensions: ['json'] },
    ],
  };
  // With the report window alive the dialog becomes its sheet, instead of a
  // loose window from an app that has no dock icon.
  const { canceled, filePath } = reportWindow && !reportWindow.isDestroyed()
    ? await dialog.showSaveDialog(reportWindow, options)
    : await dialog.showSaveDialog(options);
  if (canceled || !filePath) return { canceled: true };

  try {
    const out = serializeFor(filePath, report);
    fs.writeFileSync(out.filePath, out.content, 'utf8');
    return { ok: true, filePath: out.filePath, format: out.format };
  } catch (err) {
    // Back to the renderer instead of an error dialog: the button that fired it
    // is where the user is looking.
    return { ok: false, error: err.message };
  }
}

function openReport() {
  if (reportWindow && !reportWindow.isDestroyed()) {
    app.focus({ steal: true });
    reportWindow.show();
    reportWindow.focus();
    return;
  }

  reportWindow = new BrowserWindow({
    width: 780,
    height: 780,
    minWidth: 700,
    minHeight: 520,
    title: 'Claude Statusbar — Relatório',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'report', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  reportWindow.loadFile(path.join(__dirname, 'report', 'index.html'));
  reportWindow.once('ready-to-show', () => {
    // The dock icon is hidden (menu-bar app), so the window doesn't come to the
    // front on its own — the app has to take focus first.
    app.focus({ steal: true });
    reportWindow.show();
  });
  reportWindow.webContents.on('did-finish-load', () => refreshUsage());
  reportWindow.on('closed', () => {
    reportWindow = null;
  });
}

function render(result) {
  lastResult = result;
  lastBurn = analyze(result);
  mb.tray.setTitle(trayTitle(result));
  mb.tray.setToolTip(trayTooltip(result));
  if (mb.window && !mb.window.isDestroyed()) pushToWindow(result);
  maybeNotify(result, lastBurn);
}

function pushToWindow(result) {
  mb.window.webContents.send('statusbar:update', serialize(result));
}

function serialize(result) {
  return {
    ...result,
    today: lastReport ? lastReport.today : null,
    capturedAt: result.capturedAt ? result.capturedAt.toISOString() : null,
    fiveHour: {
      pct: result.fiveHour.pct,
      resetsAt: result.fiveHour.resetsAt ? result.fiveHour.resetsAt.toISOString() : null,
      countdown: countdownLabel(result.fiveHour.resetsAt),
    },
    sevenDay: {
      pct: result.sevenDay.pct,
      resetsAt: result.sevenDay.resetsAt ? result.sevenDay.resetsAt.toISOString() : null,
      countdown: countdownLabel(result.sevenDay.resetsAt),
    },
    freshnessLabel: freshnessLabel(result),
    burnRate: lastBurn
      ? { ...lastBurn, etaAt: lastBurn.etaAt ? lastBurn.etaAt.toISOString() : null }
      : null,
  };
}

function trayTitle(result) {
  const { pct, resetsAt } = result.fiveHour;
  if (pct === null || result.freshness === 'dead') return '◐ --';
  if (config.trayTitle === 'reset') {
    // The countdown label is written for the popover ("reseta em 1h12"); the
    // tray has room for the number alone.
    const countdown = countdownLabel(resetsAt);
    return countdown ? `◐ ${countdown.replace('reseta em ', '')}` : `◐ ${Math.round(pct)}%`;
  }
  return `◐ ${Math.round(pct)}%`;
}

function trayTooltip(result) {
  if (!result.ok) return result.reason || 'claude-statusbar: sem dado';
  const parts = [];
  if (result.fiveHour.pct !== null) parts.push(`5h: ${Math.round(result.fiveHour.pct)}%`);
  if (result.sevenDay.pct !== null) parts.push(`7d: ${Math.round(result.sevenDay.pct)}%`);
  if (lastBurn && lastBurn.state === 'projecting') parts.push(lastBurn.label);
  parts.push(freshnessLabel(result));
  return parts.join(' · ');
}

function loadNotified() {
  try {
    return JSON.parse(fs.readFileSync(NOTIFIED_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveNotified(state) {
  try {
    fs.mkdirSync(STATUSBAR_DIR, { recursive: true });
    fs.writeFileSync(NOTIFIED_PATH, JSON.stringify(state));
  } catch {
    // best-effort — a missed persisted notification state just means a
    // possible duplicate notification after an app restart, not a crash.
  }
}

function maybeNotify(result, burn) {
  if (!Notification.isSupported()) return;
  if (!result.ok || result.freshness === 'dead') return;
  const { pct, resetsAt } = result.fiveHour;
  if (pct === null || !resetsAt) return;

  // Only the current window's state is tracked — a new resets_at means a new
  // window, so any older entry is stale and can be dropped.
  const windowKey = resetsAt.toISOString();
  const stored = loadNotified();
  const state = stored.windowKey === windowKey
    ? { burnNotified: false, thresholds: [], ...stored }
    : { windowKey, thresholds: [], burnNotified: false };

  // Stored ascending, fired high-to-low: one notification per window, and the
  // one that gets shown is the worst threshold just crossed.
  for (const threshold of [...config.thresholds].sort((a, b) => b - a)) {
    if (pct >= threshold && !state.thresholds.includes(threshold)) {
      new Notification({
        title: 'Claude — limite de 5h',
        body: `Você já usou ${Math.round(pct)}% da janela atual (${countdownLabel(resetsAt)}).`,
      }).show();
      saveNotified({ ...state, thresholds: [...state.thresholds, threshold] });
      return; // only the highest newly-crossed threshold per render
    }
  }

  // The pace warning is the one that arrives while there's still time to act on
  // it: at 12%/h you're told at 40% that 100% lands before the reset, instead of
  // finding out at 90% when the decision is already made for you.
  if (config.burnNotify && !state.burnNotified && pct >= BURN_NOTIFY_FLOOR && burn && burn.hitsBeforeReset) {
    new Notification({
      title: 'Claude — ritmo de consumo',
      body: `${burn.label}, antes do reset (${countdownLabel(resetsAt)}). Trocar de modelo ou baixar o effort agora dá pra chegar até lá.`,
    }).show();
    saveNotified({ ...state, burnNotified: true });
  }
}

app.on('window-all-closed', (e) => e.preventDefault());
