'use strict';

// Report window. Charts are hand-rolled inline SVG — same approach as the
// other projects in this repo, and it keeps the app dependency-free.
//
// Color rules followed here: the daily chart and the ranked bars are a single
// series each, so they use one hue and carry no legend (the title already says
// what's plotted). The token mix is the only categorical chart, and its four
// hues are assigned in fixed slot order and never cycled. Every segment's value
// also appears in the legend and in the table view, so nothing is readable by
// color alone.

const els = {
  subtitle: document.getElementById('subtitle'),
  refresh: document.getElementById('refresh'),
  totalTokens: document.getElementById('total-tokens'),
  totalExact: document.getElementById('total-exact'),
  totalCost: document.getElementById('total-cost'),
  totalSessions: document.getElementById('total-sessions'),
  totalRequests: document.getElementById('total-requests'),
  dailyAverage: document.getElementById('daily-average'),
  busiestDay: document.getElementById('busiest-day'),
  dailyChart: document.getElementById('daily-chart'),
  dailyTable: document.getElementById('daily-table'),
  mixChart: document.getElementById('mix-chart'),
  mixLegend: document.getElementById('mix-legend'),
  byProject: document.getElementById('by-project'),
  byModel: document.getElementById('by-model'),
  byEntrypoint: document.getElementById('by-entrypoint'),
  footer: document.getElementById('footer'),
  tooltip: document.getElementById('tooltip'),
};

const SVG_NS = 'http://www.w3.org/2000/svg';

const DAILY = {
  width: 700,
  height: 210,
  padding: { top: 18, right: 10, bottom: 24, left: 50 },
};

const MIX_SERIES = [
  { key: 'cacheRead', name: 'cache read', color: 'var(--series-1)' },
  { key: 'cacheWrite', name: 'cache creation', color: 'var(--series-2)' },
  { key: 'output', name: 'output', color: 'var(--series-3)' },
  { key: 'input', name: 'input', color: 'var(--series-4)' },
];

const integer = new Intl.NumberFormat('pt-BR');
const oneDecimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' });

window.claudeStatusbar.onReport(render);

els.refresh.addEventListener('click', async () => {
  els.refresh.disabled = true;
  els.refresh.textContent = 'Atualizando…';
  try {
    render(await window.claudeStatusbar.refreshReport());
  } finally {
    els.refresh.disabled = false;
    els.refresh.textContent = 'Atualizar';
  }
});

window.claudeStatusbar.getReport().then(render);

function render(report) {
  if (!report) return;
  renderTiles(report);
  renderDaily(report.byDay);
  renderDailyTable(report.byDay);
  renderMix(report.mix, report.totals.tokens);
  renderRanks(els.byProject, report.byProject, report.totals.tokens);
  renderRanks(els.byModel, report.byModel, report.totals.tokens);
  renderRanks(els.byEntrypoint, report.byEntrypoint, report.totals.tokens);
  renderFooter(report);

  const at = new Date(report.generatedAt);
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  els.subtitle.textContent = `últimos ${report.days} dias · atualizado às ${time}`;
}

function renderTiles(report) {
  const { totals, byDay } = report;
  els.totalTokens.textContent = compact(totals.tokens);
  els.totalExact.textContent = `${integer.format(totals.tokens)} tokens`;
  els.totalCost.textContent = totals.tokens > 0 ? `~${usd.format(totals.cost)}` : '—';
  els.totalSessions.textContent = integer.format(totals.sessions);
  els.totalRequests.textContent = `${integer.format(totals.requests)} respostas`;

  const activeDays = byDay.filter((day) => day.tokens > 0).length;
  els.dailyAverage.textContent = activeDays > 0
    ? compact(Math.round(totals.tokens / activeDays))
    : '—';

  const busiest = byDay.reduce((top, day) => (day.tokens > (top?.tokens ?? 0) ? day : top), null);
  els.busiestDay.textContent = busiest && busiest.tokens > 0
    ? `em ${activeDays} dias ativos · pico ${dayLabel(busiest.day)}`
    : 'sem dado nos últimos 30 dias';
}

function renderDaily(byDay) {
  const svg = els.dailyChart;
  svg.replaceChildren();
  const max = Math.max(0, ...byDay.map((day) => day.tokens));
  if (max <= 0) {
    showEmpty(svg.parentElement, svg, 'Nenhum token registrado nos últimos 30 dias.');
    return;
  }
  clearEmpty(svg.parentElement, svg);

  const { width, height, padding } = DAILY;
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const top = niceCeil(max);
  const baseline = padding.top + plotH;
  const y = (value) => baseline - (value / top) * plotH;

  for (const ratio of [0, 0.5, 1]) {
    const gy = Math.round(y(top * ratio)) + 0.5;
    svg.appendChild(el('line', {
      class: 'grid-line', x1: padding.left, x2: width - padding.right, y1: gy, y2: gy,
    }));
    svg.appendChild(text(padding.left - 8, gy + 3, compact(top * ratio), {
      class: 'axis-label', 'text-anchor': 'end',
    }));
  }

  const band = plotW / byDay.length;
  const barW = Math.min(24, band - 2); // never fill the band — the leftover is the 2px gap plus air
  const busiestIndex = byDay.reduce((best, day, i) => (day.tokens > byDay[best].tokens ? i : best), 0);

  byDay.forEach((day, i) => {
    const x = padding.left + i * band + (band - barW) / 2;
    if (day.tokens > 0) {
      const barTop = y(day.tokens);
      const bar = el('path', { class: 'bar', d: barPath(x, barTop, barW, baseline - barTop) });
      bar.dataset.day = day.day;
      svg.appendChild(bar);

      // Exactly one direct label: the peak. The rest is carried by the axis,
      // the hover tooltip and the table view.
      if (i === busiestIndex) {
        const labelX = clamp(x + barW / 2, padding.left + 14, width - padding.right - 14);
        svg.appendChild(text(labelX, Math.max(barTop - 6, 10), compact(day.tokens), {
          class: 'value-label', 'text-anchor': 'middle',
        }));
      }
    }

    if (i % 5 === 0 || i === byDay.length - 1) {
      svg.appendChild(text(x + barW / 2, height - 6, dayLabel(day.day), {
        class: 'axis-label', 'text-anchor': 'middle',
      }));
    }
  });

  // Hit targets last, so they sit above the marks and cover the whole column —
  // a 2px-tall bar is impossible to hover otherwise.
  byDay.forEach((day, i) => {
    const hit = el('rect', {
      class: 'bar-hit',
      x: padding.left + i * band,
      y: padding.top,
      width: band,
      height: plotH,
    });
    const bar = svg.querySelector(`.bar[data-day="${day.day}"]`);
    hit.addEventListener('mousemove', (event) => {
      if (bar) bar.classList.add('is-hovered');
      showTooltip(event, `${dayLabel(day.day)} · ${integer.format(day.tokens)} tokens`,
        day.tokens > 0 ? `~${usd.format(day.cost)}` : 'sem consumo');
    });
    hit.addEventListener('mouseleave', () => {
      if (bar) bar.classList.remove('is-hovered');
      hideTooltip();
    });
    svg.appendChild(hit);
  });
}

function renderDailyTable(byDay) {
  els.dailyTable.replaceChildren();
  for (const day of [...byDay].reverse()) {
    const row = document.createElement('tr');
    row.appendChild(cell(dayLabel(day.day)));
    row.appendChild(cell(integer.format(day.tokens)));
    row.appendChild(cell(day.tokens > 0 ? `~${usd.format(day.cost)}` : '—'));
    els.dailyTable.appendChild(row);
  }
}

function renderMix(mix, total) {
  const svg = els.mixChart;
  svg.replaceChildren();
  els.mixLegend.replaceChildren();
  if (!total) {
    showEmpty(svg.parentElement, svg, 'Sem tokens para compor.');
    return;
  }
  clearEmpty(svg.parentElement, svg);

  const segments = MIX_SERIES
    .map((series) => ({ ...series, value: mix[series.key] || 0 }))
    .filter((series) => series.value > 0);

  const gap = 2; // the surface gap does the separating — never a stroke
  const available = 700 - gap * (segments.length - 1);
  const widths = segments.map((segment) => Math.max(3, (segment.value / total) * available));
  // The minimum width has to come from somewhere, or the bar overflows: take it
  // off the widest segment, which can spare it without changing what it reads as.
  const overflow = widths.reduce((sum, w) => sum + w, 0) - available;
  if (overflow > 0) {
    const widest = widths.indexOf(Math.max(...widths));
    widths[widest] -= overflow;
  }

  let x = 0;
  segments.forEach((segment, i) => {
    const w = widths[i];
    const path = el('path', {
      d: segmentPath(x, 2, w, 24, i === 0, i === segments.length - 1),
      fill: segment.color,
    });
    const share = (segment.value / total) * 100;
    path.addEventListener('mousemove', (event) => {
      showTooltip(event, `${segment.name} · ${oneDecimal.format(share)}%`,
        `${integer.format(segment.value)} tokens`);
    });
    path.addEventListener('mouseleave', hideTooltip);
    svg.appendChild(path);
    x += w + gap;

    const item = document.createElement('li');
    item.className = 'legend__item';
    const swatch = document.createElement('span');
    swatch.className = 'legend__swatch';
    swatch.style.background = segment.color;
    const name = document.createElement('span');
    name.className = 'legend__name';
    name.textContent = segment.name;
    const value = document.createElement('span');
    value.className = 'legend__value';
    value.textContent = `${compact(segment.value)} · ${oneDecimal.format(share)}%`;
    item.append(swatch, name, value);
    els.mixLegend.appendChild(item);
  });
}

function renderRanks(container, rows, total) {
  container.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'sem dado';
    container.appendChild(empty);
    return;
  }

  const limit = 8;
  const visible = rows.slice(0, limit);
  const rest = rows.slice(limit);
  if (rest.length) {
    visible.push({
      name: `outros (${rest.length})`,
      tokens: rest.reduce((sum, row) => sum + row.tokens, 0),
      cost: rest.reduce((sum, row) => sum + row.cost, 0),
    });
  }

  const max = Math.max(...visible.map((row) => row.tokens));
  for (const row of visible) {
    const share = total > 0 ? (row.tokens / total) * 100 : 0;
    const node = document.createElement('div');
    node.className = 'rank';
    node.title = `${integer.format(row.tokens)} tokens · ~${usd.format(row.cost)} · ${oneDecimal.format(share)}% do total`;

    const head = document.createElement('div');
    head.className = 'rank__head';
    const name = document.createElement('span');
    name.className = 'rank__name';
    name.textContent = row.name;
    const value = document.createElement('span');
    value.className = 'rank__value';
    value.textContent = `${compact(row.tokens)} · ${Math.round(share)}%`;
    head.append(name, value);

    const track = document.createElement('div');
    track.className = 'rank__track';
    const fill = document.createElement('div');
    fill.className = 'rank__fill';
    fill.style.width = `${Math.max((row.tokens / max) * 100, 1)}%`;
    track.appendChild(fill);

    node.append(head, track);
    container.appendChild(node);
  }
}

function renderFooter(report) {
  const parts = [
    `custo é estimativa — assinatura não cobra por token (tabela de preço ${report.meta.pricingVersion})`,
  ];
  if (report.scan) {
    parts.push(`${integer.format(report.scan.files)} arquivos indexados em ${report.scan.ms} ms`);
  }
  if (report.meta.unpricedModels.length) {
    parts.push(`sem preço: ${report.meta.unpricedModels.join(', ')} (${compact(report.totals.unpricedTokens)} tokens fora do custo)`);
  }
  els.footer.textContent = parts.join(' · ');
}

/* Helpers ---------------------------------------------------------------- */

function el(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function text(x, y, content, attrs) {
  const node = el('text', { x, y, ...attrs });
  node.textContent = content;
  return node;
}

function cell(content) {
  const td = document.createElement('td');
  td.textContent = content;
  return td;
}

/** Column with a 4px rounded cap and a square baseline. */
function barPath(x, y, width, height) {
  const r = Math.min(4, width / 2, height);
  return [
    `M ${x} ${y + height}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height}`,
    'Z',
  ].join(' ');
}

/** Stacked-bar segment: only the outer ends of the whole bar are rounded. */
function segmentPath(x, y, width, height, roundStart, roundEnd) {
  const r = Math.min(4, width / 2, height / 2);
  const left = roundStart ? r : 0;
  const right = roundEnd ? r : 0;
  return [
    `M ${x + left} ${y}`,
    `L ${x + width - right} ${y}`,
    right ? `Q ${x + width} ${y} ${x + width} ${y + right}` : '',
    `L ${x + width} ${y + height - right}`,
    right ? `Q ${x + width} ${y + height} ${x + width - right} ${y + height}` : '',
    `L ${x + left} ${y + height}`,
    left ? `Q ${x} ${y + height} ${x} ${y + height - left}` : '',
    `L ${x} ${y + left}`,
    left ? `Q ${x} ${y} ${x + left} ${y}` : '',
    'Z',
  ].filter(Boolean).join(' ');
}

function niceCeil(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

function compact(n) {
  if (n >= 1e9) return `${oneDecimal.format(n / 1e9)}B`;
  if (n >= 1e6) return `${oneDecimal.format(n / 1e6)}M`;
  if (n >= 1e3) return `${oneDecimal.format(n / 1e3)}k`;
  return integer.format(Math.round(n));
}

function dayLabel(day) {
  const [, month, date] = day.split('-');
  return `${date}/${month}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function showTooltip(event, title, detail) {
  els.tooltip.hidden = false;
  els.tooltip.replaceChildren();
  const strong = document.createElement('div');
  strong.textContent = title;
  const small = document.createElement('div');
  small.className = 'tooltip__value';
  small.textContent = detail;
  els.tooltip.append(strong, small);

  const box = els.tooltip.getBoundingClientRect();
  const x = clamp(event.clientX + 12, 8, window.innerWidth - box.width - 8);
  const y = clamp(event.clientY - box.height - 12, 8, window.innerHeight - box.height - 8);
  els.tooltip.style.left = `${x}px`;
  els.tooltip.style.top = `${y}px`;
}

function hideTooltip() {
  els.tooltip.hidden = true;
}

function showEmpty(card, svg, message) {
  svg.style.display = 'none';
  let empty = card.querySelector('.empty');
  if (!empty) {
    empty = document.createElement('p');
    empty.className = 'empty';
    card.appendChild(empty);
  }
  empty.textContent = message;
}

function clearEmpty(card, svg) {
  svg.style.display = '';
  const empty = card.querySelector('.empty');
  if (empty) empty.remove();
}
