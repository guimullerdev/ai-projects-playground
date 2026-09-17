'use strict';

(() => {
  const rateFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  // Num dia parado a faixa toda cabe em meio centavo — com 3 casas os quatro
  // rótulos do eixo sairiam iguais.
  const axisFmt = (digits) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const pctFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' });
  const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
  const weekdayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });

  const el = (id) => document.getElementById(id);
  const money = (value) => (value === null || value === undefined ? '—' : `R$ ${rateFmt.format(value)}`);

  const refreshBtn = el('refresh');
  const loginItem = el('login-item');

  function render(state) {
    renderQuote(state);
    renderIntraday(state);
    renderDaily(state);
    loginItem.checked = Boolean(state.openAtLogin);
    // O conteúdo muda de altura (aviso de erro, estado vazio do gráfico do
    // dia), então é ele quem dita o tamanho da janela, e não o contrário.
    window.cambio.resize(document.querySelector('.popover').getBoundingClientRect().height);
  }

  function renderQuote(state) {
    const banner = el('banner');
    // Erro de rede com cotação em tela é um aviso; sem cotação nenhuma, é o
    // único conteúdo que o popover tem pra mostrar.
    banner.hidden = !state.error;
    if (state.error) {
      banner.textContent = state.quote
        ? `Última atualização falhou (${state.error}). Mostrando a cotação anterior.`
        : `Não foi possível carregar a cotação: ${state.error}`;
    }

    const freshness = el('freshness');
    if (!state.quote) {
      freshness.textContent = state.error ? 'sem dado' : 'carregando…';
      freshness.classList.toggle('is-stale', Boolean(state.error));
      return;
    }

    const quoteTime = timeFmt.format(new Date(state.quote.t * 1000));
    freshness.textContent = state.stale ? `desatualizado · ${quoteTime}` : `cotação de ${quoteTime}`;
    freshness.classList.toggle('is-stale', Boolean(state.stale));

    el('bid').textContent = money(state.quote.bid);
    el('ask').textContent = money(state.quote.ask);
    el('high').textContent = money(state.quote.high);
    el('low').textContent = money(state.quote.low);

    const change = el('change');
    const pct = state.quote.pctChange;
    change.textContent = pct === null ? '' : `${pctFmt.format(pct)}% hoje`;
    change.classList.toggle('is-up', pct > 0);
    change.classList.toggle('is-down', pct < 0);
  }

  function renderIntraday(state) {
    const samples = state.session.samples || [];
    const note = el('intraday-note');
    const empty = el('intraday-empty');
    const today = new Date().toLocaleDateString('en-CA');

    // Fim de semana e feriado: o pregão mais recente não é hoje, e o gráfico
    // diz de quando ele é em vez de fingir que é a trajetória de agora.
    if (state.session.date && state.session.date !== today) {
      const when = new Date(`${state.session.date}T12:00:00`);
      note.textContent = `último pregão · ${weekdayFmt.format(when)}`;
    } else if (samples.length) {
      note.textContent = `${samples.length} cotações`;
    } else {
      note.textContent = '';
    }

    empty.hidden = samples.length >= 2;
    renderChart({
      svg: el('intraday-chart'),
      tooltip: el('intraday-tooltip'),
      points: samples.map((s) => ({ date: new Date(s.t * 1000), bid: s.bid, ask: s.ask })),
      timeScale: true,
      formatX: (date) => timeFmt.format(date),
    });
  }

  function renderDaily(state) {
    el('daily-title').textContent = `Últimos ${state.dailyDays} dias`;
    renderChart({
      svg: el('daily-chart'),
      tooltip: el('daily-tooltip'),
      points: (state.daily || []).map((s) => ({ date: new Date(s.t * 1000), bid: s.bid, ask: s.ask })),
      timeScale: false,
      formatX: (date) => dayFmt.format(date),
    });
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }

  // Um único renderizador serve aos dois gráficos: o do dia (eixo X pelo horário
  // real, porque as cotações chegam em intervalos irregulares) e o dos 30 dias
  // (um ponto por pregão). Só a compra vira linha — na escala de qualquer um
  // dos dois o spread pra venda é fino demais pra virar uma segunda linha
  // legível, então ela aparece no tooltip e no topo do popover.
  function renderChart({ svg, tooltip, points, timeScale, formatX }) {
    svg.innerHTML = '';
    tooltip.hidden = true;
    // Sem série não há o que desenhar, e um SVG vazio só deixaria um buraco do
    // tamanho do gráfico no meio do popover.
    svg.classList.toggle('is-empty', points.length < 2);
    if (points.length < 2) return;

    const [width, height] = svg.getAttribute('viewBox').split(' ').slice(2).map(Number);
    const pad = { top: 8, right: 6, bottom: 14, left: 42 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const values = points.map((p) => p.bid);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // Faixa própria pra série achatada (intradiário costuma variar centavos):
    // sem a folga mínima, o ruído vira uma montanha.
    const margin = (max - min) * 0.15 || max * 0.0005;
    const yMin = min - margin;
    const yMax = max + margin;

    const t0 = points[0].date.getTime();
    const span = points[points.length - 1].date.getTime() - t0 || 1;
    const x = (i) => pad.left + (timeScale
      ? ((points[i].date.getTime() - t0) / span)
      : (i / (points.length - 1))) * plotW;
    const y = (v) => pad.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

    const axis = axisFmt(yMax - yMin < 0.02 ? 4 : 3);
    for (let g = 0; g <= 3; g++) {
      const gy = pad.top + (g / 3) * plotH;
      svg.appendChild(svgEl('line', { class: 'grid-line', x1: pad.left, x2: width - pad.right, y1: gy, y2: gy }));
      const label = svgEl('text', { class: 'axis-label', x: pad.left - 5, y: gy + 3, 'text-anchor': 'end' });
      label.textContent = axis.format(yMax - (g / 3) * (yMax - yMin));
      svg.appendChild(label);
    }

    const path = (key) => points.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(2)} ${y(p[key]).toFixed(2)}`).join(' ');

    const lastIndex = points.length - 1;
    const base = pad.top + plotH;
    svg.appendChild(svgEl('path', {
      class: 'area',
      d: `${path('bid')} L ${x(lastIndex).toFixed(2)} ${base} L ${x(0).toFixed(2)} ${base} Z`,
    }));
    svg.appendChild(svgEl('path', { class: 'line line--buy', d: path('bid') }));
    svg.appendChild(svgEl('circle', { class: 'point point--buy', cx: x(lastIndex), cy: y(points[lastIndex].bid), r: 2.5 }));

    // No intradiário o eixo X é o horário real, então os pontos se amontoam nos
    // trechos de pregão movimentado — espaçar por índice colaria um rótulo no
    // outro. Cada candidato é aceito pela largura que o texto ocupa de fato, e
    // o último tem preferência: é a cotação que importa.
    const CHAR_W = 4.6; // largura média de um dígito em .axis-label (8px)
    const GUTTER = 6;
    const extent = (i, anchor) => {
      const w = formatX(points[i].date).length * CHAR_W;
      if (anchor === 'start') return [x(i), x(i) + w];
      if (anchor === 'end') return [x(i) - w, x(i)];
      return [x(i) - w / 2, x(i) + w / 2];
    };

    const step = Math.max(Math.ceil(points.length / 5), 1);
    const lastExtent = extent(lastIndex, 'end');
    const labelled = [[lastIndex, 'end']];
    let taken = null;
    for (let i = 0; i < lastIndex; i += step) {
      const anchor = i === 0 ? 'start' : 'middle';
      const [left, right] = extent(i, anchor);
      if (taken && left - taken < GUTTER) continue;
      if (lastExtent[0] - right < GUTTER) continue;
      labelled.push([i, anchor]);
      taken = right;
    }

    labelled.forEach(([i, anchor]) => {
      const label = svgEl('text', { class: 'axis-label', x: x(i), y: height - 3, 'text-anchor': anchor });
      label.textContent = formatX(points[i].date);
      svg.appendChild(label);
    });

    const crosshair = svgEl('line', { class: 'crosshair', y1: pad.top, y2: pad.top + plotH });
    const hoverBuy = svgEl('circle', { class: 'point point--buy hover-point', r: 3 });
    const target = svgEl('rect', { class: 'hover-target', x: pad.left, y: pad.top, width: plotW, height: plotH });
    svg.append(crosshair, hoverBuy, target);

    target.addEventListener('mousemove', (event) => {
      const rect = svg.getBoundingClientRect();
      const localX = ((event.clientX - rect.left) / rect.width) * width;
      let idx = 0;
      for (let i = 1; i < points.length; i++) {
        if (Math.abs(x(i) - localX) < Math.abs(x(idx) - localX)) idx = i;
      }
      const p = points[idx];

      crosshair.setAttribute('x1', x(idx));
      crosshair.setAttribute('x2', x(idx));
      crosshair.setAttribute('opacity', 1);
      hoverBuy.setAttribute('cx', x(idx));
      hoverBuy.setAttribute('cy', y(p.bid));
      hoverBuy.setAttribute('opacity', 1);

      tooltip.hidden = false;
      tooltip.innerHTML = `
        <p class="tooltip__when">${formatX(p.date)}</p>
        <p>Compra ${money(p.bid)}</p>
        <p>Venda ${money(p.ask)}</p>`;
      tooltip.style.left = `${(x(idx) / width) * rect.width}px`;
      tooltip.style.top = `${(y(p.bid) / height) * rect.height}px`;
    });

    target.addEventListener('mouseleave', () => {
      crosshair.setAttribute('opacity', 0);
      hoverBuy.setAttribute('opacity', 0);
      tooltip.hidden = true;
    });
  }

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Atualizando…';
    try {
      render(await window.cambio.refresh());
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Atualizar';
    }
  });

  loginItem.addEventListener('change', async () => {
    loginItem.checked = await window.cambio.setLoginItem(loginItem.checked);
  });

  el('quit').addEventListener('click', () => window.cambio.quit());

  window.cambio.onUpdate(render);
  window.cambio.getState().then(render);
})();
