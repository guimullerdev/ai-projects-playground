const { app, Tray, Menu, BrowserWindow, ipcMain, Notification, nativeImage, powerMonitor, shell } = require('electron');
const path = require('path');
const { execFile } = require('child_process');

const store = require('./store');
const scanner = require('./scanner');
const scheduler = require('./scheduler');
const pending = require('./pending');

// Menu-bar only app: no dock icon, no app menu, no main window.
app.dock?.hide();

const TICK_MS = 60 * 1000;
const RESCAN_MS = 5 * 60 * 1000; // cheap incremental rescan, in the background

const ICONS = { done: '●', rest: '◆', ok: '○', late: '⊙' };

let tray = null;
let popover = null;
let mainWindow = null;
let config = null;
let data = null;
let commitMap = new Map();
let userDataDir = null;
let lastRepoPaths = [];

function todayLogical() {
  return scanner.logicalToday(config.dayStartHour);
}

/** Repo paths from the last scan, minus whatever the user toggled off. */
function enabledRepoPaths() {
  const disabled = new Set(config.ignoredDirRepos || []);
  return lastRepoPaths.filter((p) => !disabled.has(path.basename(p)));
}

async function runScan({ force = false } = {}) {
  const result = await scanner.refreshCache(config, data, { force });
  commitMap = result.commitMap;
  lastRepoPaths = result.repoPaths;
  store.saveData(userDataDir, data);
  pushState();
}

function computeState() {
  const today = todayLogical();
  const committedToday = (commitMap.get(today) || []).length > 0;
  const isRestDay = config.restDays.includes(today);
  const streaks = scanner.computeStreaks(commitMap, config.restDays, today);
  const todayFlags = data.notifyFlags[today] || {};

  const { iconState, toFire } = scheduler.evaluate(
    config,
    todayFlags,
    { committedToday, isRestDay, snoozedUntil: data.snoozeUntil },
    new Date()
  );

  return {
    today,
    committedToday,
    isRestDay,
    iconState,
    toFire,
    streak: streaks.current,
    longestStreak: streaks.longest,
    todayCommits: commitMap.get(today) || [],
    lastScan: new Date().toISOString(),
  };
}

/** Full data for the main window: KPI row + 53-week heatmap grid. */
function computeHistory() {
  const today = todayLogical();
  const kpis = scanner.computeKPIs(commitMap, config.restDays, today);
  const firstDate = scanner.firstCommitDate(commitMap);
  const weeks = scanner.buildHeatmapWeeks(commitMap, config.restDays, today, firstDate);
  return { today, kpis, weeks, theme: config.theme };
}

/**
 * Gap list (streak breaks, most recent first) with today's pending work
 * attached as a hint on each gap it plausibly explains — an unpushed commit,
 * a dirty file, or a stash whose date falls inside (or right at the edge of)
 * the gap. This is read-only context, never a "fill this day in" action.
 */
async function computeGapsWithPending() {
  const today = todayLogical();
  const gaps = scanner.computeGaps(commitMap, config.restDays, today, { limit: 15 });
  const pendingList = await pending.getPendingForRepos(enabledRepoPaths());

  const overlaps = (date, gap) => date >= gap.start && date <= scanner.addDays(gap.end, 1);

  for (const gap of gaps) {
    gap.hints = [];
    for (const p of pendingList) {
      const lines = [];
      if (p.dirtyCount > 0 && p.oldestDirtyDate && overlaps(p.oldestDirtyDate, gap)) {
        lines.push(`${p.dirtyCount} arquivo${p.dirtyCount === 1 ? '' : 's'} não commitado${p.dirtyCount === 1 ? '' : 's'} desde ${p.oldestDirtyDate}`);
      }
      const unpushedInGap = p.unpushedCommits.filter((c) => c.date && overlaps(c.date, gap));
      if (unpushedInGap.length) {
        lines.push(`${unpushedInGap.length} commit${unpushedInGap.length === 1 ? '' : 's'} não pushado${unpushedInGap.length === 1 ? '' : 's'}`);
      }
      const stashInGap = p.stashes.filter((s) => s.date && overlaps(s.date, gap));
      if (stashInGap.length) {
        lines.push(`${stashInGap.length} stash de ${stashInGap[0].date}`);
      }
      if (lines.length) gap.hints.push({ repo: p.repo, repoPath: p.repoPath, lines });
    }
  }

  return gaps;
}

/** Pending-work list for the popover's "hoje está vazio" panel. */
async function computePendingToday() {
  const state = computeState();
  if (state.committedToday || state.isRestDay) return [];
  return pending.getPendingForRepos(enabledRepoPaths());
}

/** Repo table: name, commits in the scanned period, last commit date, enabled toggle. */
function computeRepoList() {
  const disabled = new Set(config.ignoredDirRepos || []);
  const perRepo = new Map(); // repo -> {commits, lastDate}
  for (const [date, entries] of commitMap.entries()) {
    for (const e of entries) {
      const cur = perRepo.get(e.repo) || { commits: 0, lastDate: null };
      cur.commits += 1;
      if (!cur.lastDate || date > cur.lastDate) cur.lastDate = date;
      perRepo.set(e.repo, cur);
    }
  }
  return lastRepoPaths
    .map((repoPath) => {
      const repo = path.basename(repoPath);
      const stats = perRepo.get(repo) || { commits: 0, lastDate: null };
      return { repo, repoPath, ...stats, enabled: !disabled.has(repo) };
    })
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

function openInEditor(repoPath) {
  execFile('open', ['-a', 'Visual Studio Code', repoPath], (err) => {
    if (err) shell.openPath(repoPath); // VS Code not found/installed — reveal in Finder instead
  });
}

function updateTray(state) {
  if (!tray) return;
  const glyph = ICONS[state.iconState] || ICONS.ok;
  tray.setTitle(` ${glyph} ${state.streak}`);
  const tip = state.committedToday
    ? `Commit Streak — commitou hoje (streak: ${state.streak})`
    : `Commit Streak — sem commit hoje (streak: ${state.streak})`;
  tray.setToolTip(tip);
}

function fireNotificationIfDue(state) {
  if (!state.toFire) return;
  const today = state.today;
  data.notifyFlags[today] = data.notifyFlags[today] || {};
  if (data.notifyFlags[today][state.toFire.time]) return; // already fired

  const body =
    state.streak > 0
      ? `Nenhum commit hoje ainda. Streak de ${state.streak} dias em jogo.`
      : 'Nenhum commit hoje ainda.';

  const notification = new Notification({
    title: state.toFire.tone === 'urgent' ? 'Commit Streak — última chamada' : 'Commit Streak',
    body,
    silent: false,
  });
  notification.show();

  data.notifyFlags[today][state.toFire.time] = true;
  store.saveData(userDataDir, data);
}

function pushState() {
  const state = computeState();
  updateTray(state);
  fireNotificationIfDue(state);
  if (popover && !popover.isDestroyed()) {
    popover.webContents.send('state:update', state);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history:update', computeHistory());
  }
  return state;
}

function createPopover() {
  popover = new BrowserWindow({
    width: 380,
    height: 420,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  popover.loadFile(path.join(__dirname, '..', 'renderer', 'popover.html'));
  popover.on('blur', () => popover.hide());
}

function togglePopover() {
  if (!popover) return;
  if (popover.isVisible()) {
    popover.hide();
    return;
  }
  const trayBounds = tray.getBounds();
  const winBounds = popover.getBounds();
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
  const y = Math.round(trayBounds.y + trayBounds.height);
  popover.setPosition(x, y, false);
  popover.show();
  popover.focus();
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    title: 'Commit Streak',
    backgroundColor: '#fcfcfb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle(` ${ICONS.ok} 0`);
  tray.on('click', togglePopover);

  const menu = Menu.buildFromTemplate([
    { label: 'Abrir janela completa', click: () => createMainWindow() },
    { type: 'separator' },
    { label: 'Rescan agora', click: () => runScan({ force: false }) },
    { label: 'Rescan completo', click: () => runScan({ force: true }) },
    { type: 'separator' },
    { label: 'Sair', role: 'quit' },
  ]);
  tray.on('right-click', () => tray.popUpContextMenu(menu));
}

app.whenReady().then(async () => {
  userDataDir = app.getPath('userData');
  config = store.loadConfig(userDataDir);
  data = store.loadData(userDataDir);

  app.setLoginItemSettings({ openAtLogin: !!config.loginItem });

  createTray();
  createPopover();

  await runScan({ force: false });

  setInterval(() => pushState(), TICK_MS);
  setInterval(() => runScan({ force: false }), RESCAN_MS);

  // laptop woke up: the wall clock jumped, re-check right away instead of
  // waiting up to 60s (or missing a notification entirely if it was asleep
  // through the whole window).
  powerMonitor.on('resume', () => pushState());
});

ipcMain.handle('state:get', () => computeState());

ipcMain.handle('scan:rescan', async () => {
  await runScan({ force: false });
  return computeState();
});

ipcMain.handle('notify:snooze', () => {
  data.snoozeUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  store.saveData(userDataDir, data);
  return pushState();
});

ipcMain.handle('history:get', () => computeHistory());

ipcMain.handle('window:openMain', () => {
  createMainWindow();
});

ipcMain.handle('theme:set', (_event, theme) => {
  config.theme = theme;
  store.saveConfig(userDataDir, config);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history:update', computeHistory());
  }
  return { theme: config.theme };
});

ipcMain.handle('gaps:get', () => computeGapsWithPending());

ipcMain.handle('pending:getForToday', () => computePendingToday());

ipcMain.handle('repos:list', () => computeRepoList());

ipcMain.handle('repos:toggle', async (_event, repo, enabled) => {
  const disabled = new Set(config.ignoredDirRepos || []);
  if (enabled) disabled.delete(repo);
  else disabled.add(repo);
  config.ignoredDirRepos = [...disabled];
  store.saveConfig(userDataDir, config);
  await runScan({ force: false }); // toggling changes which commits count — recompute
  return computeRepoList();
});

ipcMain.handle('restday:markGap', async (_event, { start, end }) => {
  const restSet = new Set(config.restDays);
  let d = start;
  while (d <= end) {
    restSet.add(d);
    d = scanner.addDays(d, 1);
  }
  config.restDays = [...restSet];
  store.saveConfig(userDataDir, config);
  pushState();
  return computeGapsWithPending();
});

ipcMain.handle('editor:open', (_event, repoPath) => {
  openInEditor(repoPath);
});

// menu-bar app: don't quit when the (only, hidden) window loses focus
app.on('window-all-closed', (e) => e.preventDefault());
