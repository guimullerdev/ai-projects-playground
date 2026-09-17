'use strict';

const path = require('path');
const { app, ipcMain } = require('electron');
const { menubar } = require('menubar');
const { fetchAll, DAILY_DAYS } = require('./quotes');
const { merge, latestSession } = require('./store');

// Cotação de câmbio anda em minutos, não em segundos: 5 min mantém a barra
// honesta sem martelar a API pública o dia inteiro.
const REFRESH_MS = 5 * 60 * 1000;
// Acima disso o número na barra deixa de ser "a cotação agora" e vira um valor
// velho que ninguém pediu — o popover e o tooltip passam a dizer isso.
const STALE_MS = 15 * 60 * 1000;

// Altura inicial só pra janela não nascer torta — quem manda é o conteúdo, que
// avisa a altura real assim que renderiza (ipc 'cambio:resize').
const WIDTH = 380;
const MIN_HEIGHT = 320;
const MAX_HEIGHT = 640;

const mb = menubar({
  index: `file://${path.join(__dirname, 'popover', 'index.html')}`,
  icon: path.join(__dirname, 'popover', 'iconTemplate.png'),
  browserWindow: {
    width: WIDTH,
    height: 462,
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

let state = { quote: null, daily: [], session: { date: null, samples: [] }, fetchedAt: null, error: null };
let refreshing = null;

mb.on('ready', () => {
  renderTray();
  refresh();
  setInterval(refresh, REFRESH_MS);
  // O rótulo "há X min" envelhece sozinho, sem depender de dado novo.
  setInterval(renderTray, 60 * 1000);
});

mb.on('after-create-window', () => {
  mb.window.webContents.on('did-finish-load', () => push());
});

// Quem abre o popover quer o número de agora, não o do último ciclo.
mb.on('show', () => refresh());

ipcMain.handle('cambio:state', () => serialize());
ipcMain.handle('cambio:refresh', async () => {
  await refresh();
  return serialize();
});
ipcMain.handle('cambio:login-item', (_event, openAtLogin) => {
  if (typeof openAtLogin === 'boolean') {
    app.setLoginItemSettings({ openAtLogin, openAsHidden: true });
  }
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.on('cambio:resize', (_event, height) => {
  if (!mb.window || mb.window.isDestroyed() || !Number.isFinite(height)) return;
  mb.window.setSize(WIDTH, Math.min(Math.max(Math.ceil(height), MIN_HEIGHT), MAX_HEIGHT));
});
ipcMain.on('cambio:quit', () => app.quit());

function refresh() {
  // O timer de 5 min e o clique no popover podem cair juntos; a segunda chamada
  // acompanha a primeira em vez de disparar outra rodada de requests.
  if (refreshing) return refreshing;
  refreshing = fetchAll()
    .then(({ quote, daily, ticks }) => {
      // O histórico guarda só o que o gráfico usa; o resto da última cotação
      // (máxima, mínima, variação) só vale pra tela de agora.
      const samples = merge([...ticks, { t: quote.t, bid: quote.bid, ask: quote.ask }]);
      state = { quote, daily, session: latestSession(samples), fetchedAt: Date.now(), error: null };
    })
    .catch((err) => {
      // Falha de rede não apaga a tela: mantém a última cotação e marca o erro.
      state = { ...state, error: err.message };
    })
    .finally(() => {
      refreshing = null;
      renderTray();
      push();
    });
  return refreshing;
}

function isStale() {
  return !state.fetchedAt || Date.now() - state.fetchedAt > STALE_MS;
}

const rateFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const pctFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

function renderTray() {
  if (!mb.tray) return;
  mb.tray.setTitle(trayTitle());
  mb.tray.setToolTip(trayTooltip());
}

function trayTitle() {
  if (!state.quote) return '$ --';
  const arrow = state.quote.pctChange > 0 ? '▲' : state.quote.pctChange < 0 ? '▼' : '·';
  return `$ ${rateFmt.format(state.quote.bid)} ${arrow}`;
}

function trayTooltip() {
  if (!state.quote) return state.error ? `Câmbio AI: ${state.error}` : 'Câmbio AI: carregando cotação…';
  const parts = [
    `Compra R$ ${rateFmt.format(state.quote.bid)}`,
    `venda R$ ${rateFmt.format(state.quote.ask)}`,
  ];
  if (state.quote.pctChange !== null) parts.push(`${pctFmt.format(state.quote.pctChange)}% hoje`);
  parts.push(isStale() ? 'desatualizado' : `atualizado às ${timeFmt.format(new Date(state.quote.t * 1000))}`);
  return parts.join(' · ');
}

function push() {
  if (!mb.window || mb.window.isDestroyed()) return;
  mb.window.webContents.send('cambio:update', serialize());
}

function serialize() {
  return {
    quote: state.quote,
    daily: state.daily,
    dailyDays: DAILY_DAYS,
    session: state.session,
    fetchedAt: state.fetchedAt,
    stale: isStale(),
    error: state.error,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
  };
}

// Fechar o popover não pode encerrar o app — ele vive na barra de menu.
app.on('window-all-closed', (e) => e.preventDefault());
