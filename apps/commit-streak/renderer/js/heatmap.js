// Renders the 53-week grid: month row, day cells, hover tooltip and
// keyboard navigation (arrow keys move focus between cells). Pure DOM, no
// framework — `weeks` is the array-of-53-arrays-of-7 shape from
// scanner.buildHeatmapWeeks (see plan.md § Design do heatmap).

const WEEKDAY_NAMES = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function formatDatePt(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

function cellLabel(day) {
  const wd = WEEKDAY_NAMES[(new Date(`${day.date}T12:00:00Z`).getUTCDay() + 6) % 7];
  const base = `${formatDatePt(day.date)}, ${wd}`;
  if (day.status === 'future') return `${base} — ainda não chegou`;
  if (day.status === 'before-first') return `${base} — antes do primeiro commit`;
  if (day.status === 'rest') return `${base} — dia de folga`;
  return day.count === 0
    ? `${base} — sem commit`
    : `${base} — ${day.count} commit${day.count === 1 ? '' : 's'}`;
}

function renderHeatmap({ weeks, gridEl, monthRowEl, tooltipEl }) {
  gridEl.innerHTML = '';
  monthRowEl.innerHTML = '';

  let lastMonth = null;
  const cells = [];

  weeks.forEach((week, weekIdx) => {
    // month label: this week's Monday starts a new month vs the previous week
    const monthLabel = document.createElement('div');
    monthLabel.className = 'month-label';
    const mondayMonth = week[0].date.slice(0, 7);
    if (mondayMonth !== lastMonth) {
      const [, m] = week[0].date.split('-');
      monthLabel.textContent = MONTH_ABBR[Number(m) - 1];
      lastMonth = mondayMonth;
    }
    monthRowEl.appendChild(monthLabel);

    week.forEach((day, dayIdx) => {
      const cell = document.createElement('div');
      cell.className = `heat-cell status-${day.status} bucket-${day.bucket}`;
      cell.setAttribute('role', 'gridcell');
      cell.dataset.week = String(weekIdx);
      cell.dataset.day = String(dayIdx);
      cell.dataset.date = day.date;

      const interactive = day.status === 'normal' || day.status === 'rest';
      if (interactive) {
        cell.tabIndex = -1;
        cell.setAttribute('aria-label', cellLabel(day));
        cell.addEventListener('mouseenter', (e) => showTooltip(tooltipEl, day, e.currentTarget));
        cell.addEventListener('mouseleave', () => hideTooltip(tooltipEl));
        cell.addEventListener('focus', (e) => showTooltip(tooltipEl, day, e.currentTarget));
        cell.addEventListener('blur', () => hideTooltip(tooltipEl));
        cell.addEventListener('keydown', (e) => onCellKeydown(e, weeks, cells));
        cells.push(cell);
      } else {
        cell.setAttribute('aria-hidden', 'true');
      }

      gridEl.appendChild(cell);
    });
  });

  // exactly one cell in the tab order; arrow keys move a roving -1/0 tabindex
  const firstFocusable = cells.find((c) => c.dataset.date === weeks[weeks.length - 1][0].date) || cells[cells.length - 1];
  if (firstFocusable) firstFocusable.tabIndex = 0;
}

function onCellKeydown(e, weeks, cells) {
  const deltas = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };
  const delta = deltas[e.key];
  if (!delta) return;
  e.preventDefault();

  const cell = e.currentTarget;
  let week = Number(cell.dataset.week) + delta[0];
  let day = Number(cell.dataset.day) + delta[1];
  if (week < 0 || week >= weeks.length || day < 0 || day > 6) return;

  const target = cells.find((c) => Number(c.dataset.week) === week && Number(c.dataset.day) === day);
  if (!target) return;

  cell.tabIndex = -1;
  target.tabIndex = 0;
  target.focus();
}

function showTooltip(tooltipEl, day, targetEl) {
  const parts = [`<strong>${formatDatePt(day.date)}</strong>`];
  if (day.status === 'rest') {
    parts.push('Dia de folga');
  } else {
    parts.push(day.count === 0 ? 'Sem commit' : `${day.count} commit${day.count === 1 ? '' : 's'}`);
    for (const r of day.repos) parts.push(`${r.repo}: ${r.count}`);
  }
  tooltipEl.innerHTML = parts.join('<br>');
  tooltipEl.hidden = false;

  const rect = targetEl.getBoundingClientRect();
  const wrapRect = tooltipEl.offsetParent.getBoundingClientRect();
  tooltipEl.style.left = `${rect.left - wrapRect.left + rect.width / 2}px`;
  tooltipEl.style.top = `${rect.top - wrapRect.top - 8}px`;
}

function hideTooltip(tooltipEl) {
  tooltipEl.hidden = true;
}

window.Heatmap = { renderHeatmap, formatDatePt, WEEKDAY_NAMES };
