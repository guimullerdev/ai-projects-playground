'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Notification, ipcMain } = require('electron');
const { menubar } = require('menubar');
const { readLatest, freshnessLabel, countdownLabel, watchLatest, STATUSBAR_DIR } = require('./bridge');
const { analyze } = require('./burnRate');
const { loadReport } = require('./usage/indexer');

const NOTIFY_THRESHOLDS = [90, 70]; // checked high-to-low, one notification per window
// Below this the window is too young for a slope to extrapolate honestly — a
// burst at 4% projects an ETA that the next quiet minute invalidates.
const BURN_NOTIFY_FLOOR = 25;
const NOTIFIED_PATH = path.join(STATUSBAR_DIR, 'notified.json');
const REPORT_DAYS = 30;

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

mb.on('ready', () => {
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
ipcMain.handle('statusbar:report', () => lastReport ?? refreshUsage());
ipcMain.handle('statusbar:refresh-report', () => refreshUsage());

function refreshUsage() {
  try {
    lastReport = loadReport({ days: REPORT_DAYS });
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
  const pct = result.fiveHour.pct;
  if (pct === null || result.freshness === 'dead') return '◐ --%';
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

  for (const threshold of NOTIFY_THRESHOLDS) {
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
  if (!state.burnNotified && pct >= BURN_NOTIFY_FLOOR && burn && burn.hitsBeforeReset) {
    new Notification({
      title: 'Claude — ritmo de consumo',
      body: `${burn.label}, antes do reset (${countdownLabel(resetsAt)}). Trocar de modelo ou baixar o effort agora dá pra chegar até lá.`,
    }).show();
    saveNotified({ ...state, burnNotified: true });
  }
}

app.on('window-all-closed', (e) => e.preventDefault());
