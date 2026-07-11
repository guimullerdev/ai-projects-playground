'use strict';

const els = {
  freshness: document.getElementById('freshness'),
  fiveHourPct: document.getElementById('five-hour-pct'),
  fiveHourBar: document.getElementById('five-hour-bar'),
  fiveHourReset: document.getElementById('five-hour-reset'),
  sevenDayPct: document.getElementById('seven-day-pct'),
  sevenDayBar: document.getElementById('seven-day-bar'),
  sevenDayReset: document.getElementById('seven-day-reset'),
  today: document.getElementById('today'),
  openReport: document.getElementById('open-report'),
};

window.claudeStatusbar.onUpdate((payload) => render(payload));
els.openReport.addEventListener('click', () => window.claudeStatusbar.openReport());

function render(payload) {
  els.freshness.textContent = payload.freshnessLabel;
  els.freshness.classList.toggle('is-stale', payload.freshness !== 'live');

  renderWindow(payload.fiveHour, els.fiveHourPct, els.fiveHourBar, els.fiveHourReset);
  renderWindow(payload.sevenDay, els.sevenDayPct, els.sevenDayBar, els.sevenDayReset);

  els.today.textContent = todayLine(payload.today);
}

function renderWindow(win, pctEl, barEl, resetEl) {
  if (win.pct === null) {
    pctEl.textContent = '--%';
    barEl.style.width = '0%';
    barEl.classList.remove('is-warn', 'is-danger');
    resetEl.textContent = 'sem dado';
    return;
  }
  const pct = Math.max(0, Math.min(100, win.pct));
  pctEl.textContent = `${Math.round(pct)}%`;
  barEl.style.width = `${pct}%`;
  barEl.classList.toggle('is-warn', pct >= 70 && pct < 90);
  barEl.classList.toggle('is-danger', pct >= 90);
  resetEl.textContent = win.countdown || 'sem dado';
}

function todayLine(today) {
  if (!today || !today.ok) return 'uso de hoje: sem dado';
  const tokensStr = formatTokens(today.tokens);
  const sessionsStr = today.sessions === 1 ? '1 sessão' : `${today.sessions} sessões`;
  const modelStr = today.topModel ? ` · ${today.topModel}` : '';
  return `hoje: ${tokensStr} tokens · ${sessionsStr}${modelStr}`;
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
