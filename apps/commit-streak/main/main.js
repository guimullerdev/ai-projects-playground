const { app, Tray, Menu, BrowserWindow, ipcMain, Notification, nativeImage, powerMonitor } = require('electron');
const path = require('path');

const store = require('./store');
const scanner = require('./scanner');
const scheduler = require('./scheduler');

// Menu-bar only app: no dock icon, no app menu, no main window.
app.dock?.hide();

const TICK_MS = 60 * 1000;
const RESCAN_MS = 5 * 60 * 1000; // cheap incremental rescan, in the background

const ICONS = { done: '●', rest: '◆', ok: '○', late: '⊙' };

let tray = null;
let popover = null;
let config = null;
let data = null;
let commitMap = new Map();
let userDataDir = null;

function todayLogical() {
  return scanner.logicalToday(config.dayStartHour);
}

async function runScan({ force = false } = {}) {
  const result = await scanner.refreshCache(config, data, { force });
  commitMap = result.commitMap;
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

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle(` ${ICONS.ok} 0`);
  tray.on('click', togglePopover);

  const menu = Menu.buildFromTemplate([
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

// menu-bar app: don't quit when the (only, hidden) window loses focus
app.on('window-all-closed', (e) => e.preventDefault());
