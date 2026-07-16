const gridEl = document.getElementById('heatmap-grid');
const monthRowEl = document.getElementById('month-row');
const tooltipEl = document.getElementById('cell-tooltip');
const tableBody = document.getElementById('table-body');
const btnTableToggle = document.getElementById('btn-table-toggle');
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const heatmapSection = document.getElementById('heatmap-section');
const tableSection = document.getElementById('table-section');
const gapListEl = document.getElementById('gap-list');
const btnGapsRefresh = document.getElementById('btn-gaps-refresh');
const repoBodyEl = document.getElementById('repo-body');

const kpiEls = {
  current: document.getElementById('kpi-current'),
  longest: document.getElementById('kpi-longest'),
  days365: document.getElementById('kpi-days365'),
  coverage: document.getElementById('kpi-coverage'),
  lostMonth: document.getElementById('kpi-lost-month'),
};

const THEME_CYCLE = ['system', 'light', 'dark'];
const THEME_ICON = { system: '🌓', light: '☀️', dark: '🌙' };

function applyTheme(theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  btnThemeToggle.textContent = THEME_ICON[theme] || '🌓';
  btnThemeToggle.title = `Tema: ${theme}`;
}

function renderKpis(kpis) {
  kpiEls.current.textContent = kpis.currentStreak;
  kpiEls.longest.textContent = kpis.longestStreak;
  kpiEls.days365.textContent = kpis.daysWithCommit365;
  kpiEls.coverage.textContent = `${kpis.coveragePct}%`;
  kpiEls.lostMonth.textContent = kpis.daysLostThisMonth;
}

function renderTable(weeks) {
  const days = weeks.flat().filter((d) => d.status !== 'future');
  days.reverse();
  tableBody.innerHTML = '';
  for (const day of days) {
    const tr = document.createElement('tr');
    const weekday = window.Heatmap.WEEKDAY_NAMES[(new Date(`${day.date}T12:00:00Z`).getUTCDay() + 6) % 7];
    const repos = day.repos.map((r) => `${r.repo} (${r.count})`).join(', ') || '—';
    tr.innerHTML = `
      <td>${window.Heatmap.formatDatePt(day.date)}</td>
      <td>${weekday}</td>
      <td>${day.status === 'rest' ? 'folga' : day.count}</td>
      <td>${day.status === 'rest' ? '—' : repos}</td>
    `;
    tableBody.appendChild(tr);
  }
}

function render(history) {
  renderKpis(history.kpis);
  window.Heatmap.renderHeatmap({ weeks: history.weeks, gridEl, monthRowEl, tooltipEl });
  renderTable(history.weeks);
}

function loadGaps() {
  btnGapsRefresh.disabled = true;
  btnGapsRefresh.textContent = 'Verificando…';
  window.commitStreak.getGaps().then((gaps) => {
    window.Gaps.renderGaps(gaps, gapListEl, {
      onMarkRest: (gap) => window.commitStreak.markGapAsRest(gap).then(loadGaps),
      onOpenEditor: (repoPath) => window.commitStreak.openInEditor(repoPath),
    });
    btnGapsRefresh.disabled = false;
    btnGapsRefresh.textContent = 'Atualizar';
  });
}

function loadRepos() {
  window.commitStreak.getRepos().then((repos) => {
    window.Gaps.renderRepos(repos, repoBodyEl, {
      onToggle: (repo, enabled) => window.commitStreak.toggleRepo(repo, enabled).then(loadRepos),
    });
  });
}

window.commitStreak.getHistory().then((history) => {
  applyTheme(history.theme || 'system');
  render(history);
});
window.commitStreak.onHistoryUpdate(render);
loadGaps();
loadRepos();
btnGapsRefresh.addEventListener('click', loadGaps);

btnTableToggle.addEventListener('click', () => {
  const showingTable = !tableSection.hidden;
  tableSection.hidden = showingTable;
  heatmapSection.hidden = !showingTable;
  btnTableToggle.setAttribute('aria-pressed', String(!showingTable));
  btnTableToggle.textContent = showingTable ? 'Ver como tabela' : 'Ver como grade';
});

btnThemeToggle.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme || 'system';
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
  applyTheme(next);
  window.commitStreak.setTheme(next);
});
