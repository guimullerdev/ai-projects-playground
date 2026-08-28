// Gráficos em <canvas> puro (sem bibliotecas). Os dois gráficos leem as
// cores atuais do tema via CSS custom properties, então acompanham
// automaticamente a troca claro/escuro.

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Prepara um canvas para desenho nítido em telas HiDPI, e retorna o
// contexto 2D já escalado (para desenhar em coordenadas "CSS px").
function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function formatBRLShort(value) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}k`;
  return `R$ ${value.toFixed(0)}`;
}

// Gráfico de linha: evolução do saldo devedor. Se `rowsBaseline` for
// passado (tabela sem amortizações extras) e for diferente do real,
// desenha uma segunda linha tracejada para comparação visual.
export function drawSaldoChart(canvas, rows, rowsBaseline) {
  const { ctx, width, height } = prepareCanvas(canvas);
  if (!rows.length) return;

  const padding = { top: 16, right: 16, bottom: 28, left: 64 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const allSeries = rowsBaseline && rowsBaseline.length ? [rows, rowsBaseline] : [rows];
  const maxSaldo = Math.max(...allSeries.flatMap((s) => s.map((r) => r.saldoInicial)));
  const maxN = Math.max(...allSeries.map((s) => s.length));

  const grid = cssVar('--grid-line');
  const muted = cssVar('--muted');
  const accent = cssVar('--accent');
  const down = cssVar('--down');

  ctx.strokeStyle = grid;
  ctx.fillStyle = muted;
  ctx.font = '11px -apple-system, sans-serif';
  ctx.lineWidth = 1;

  const ySteps = 4;
  for (let s = 0; s <= ySteps; s++) {
    const y = padding.top + (plotH * s) / ySteps;
    const val = maxSaldo * (1 - s / ySteps);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + plotW, y);
    ctx.stroke();
    ctx.fillText(formatBRLShort(val), 4, y + 4);
  }

  function drawLine(series, color, dashed) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dashed ? [5, 4] : []);
    series.forEach((row, idx) => {
      const x = padding.left + (plotW * idx) / (maxN - 1 || 1);
      const y = padding.top + plotH * (1 - row.saldoFinal / maxSaldo);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (rowsBaseline && rowsBaseline.length && rowsBaseline.length !== rows.length) {
    drawLine(rowsBaseline, down, true);
  }
  drawLine(rows, accent, false);

  // eixo X: rótulos de início, meio e fim
  ctx.fillStyle = muted;
  ctx.textAlign = 'left';
  ctx.fillText(`parcela 1`, padding.left, height - 8);
  ctx.textAlign = 'right';
  ctx.fillText(`parcela ${maxN}`, padding.left + plotW, height - 8);
  ctx.textAlign = 'left';
}

// Gráfico de barras empilhadas: composição juros x amortização por
// parcela. Quando há muitas parcelas, agrupa por ano para manter a
// leitura possível.
export function drawComposicaoChart(canvas, rows) {
  const { ctx, width, height } = prepareCanvas(canvas);
  if (!rows.length) return;

  const groupByYear = rows.length > 60;
  const buckets = [];
  if (groupByYear) {
    for (let idx = 0; idx < rows.length; idx += 12) {
      const chunk = rows.slice(idx, idx + 12);
      buckets.push({
        label: `${Math.floor(idx / 12) + 1}`,
        juros: chunk.reduce((s, r) => s + r.juros, 0),
        amortizacao: chunk.reduce((s, r) => s + r.amortizacao, 0),
      });
    }
  } else {
    for (const row of rows) {
      buckets.push({ label: String(row.numero), juros: row.juros, amortizacao: row.amortizacao });
    }
  }

  const padding = { top: 16, right: 16, bottom: 28, left: 64 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const maxTotal = Math.max(...buckets.map((b) => b.juros + b.amortizacao));
  const grid = cssVar('--grid-line');
  const muted = cssVar('--muted');
  const accent = cssVar('--accent');
  const warn = cssVar('--warn');

  ctx.strokeStyle = grid;
  ctx.fillStyle = muted;
  ctx.font = '11px -apple-system, sans-serif';
  ctx.lineWidth = 1;

  const ySteps = 4;
  for (let s = 0; s <= ySteps; s++) {
    const y = padding.top + (plotH * s) / ySteps;
    const val = maxTotal * (1 - s / ySteps);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + plotW, y);
    ctx.stroke();
    ctx.fillText(formatBRLShort(val), 4, y + 4);
  }

  const gap = buckets.length > 80 ? 0 : 2;
  const barW = Math.max(0.6, plotW / buckets.length - gap);

  buckets.forEach((b, idx) => {
    const x = padding.left + (plotW * idx) / buckets.length + gap / 2;
    const amortH = plotH * (b.amortizacao / maxTotal);
    const jurosH = plotH * (b.juros / maxTotal);
    const baseY = padding.top + plotH;

    ctx.fillStyle = accent;
    ctx.fillRect(x, baseY - amortH, barW, amortH);
    ctx.fillStyle = warn;
    ctx.fillRect(x, baseY - amortH - jurosH, barW, jurosH);
  });

  ctx.fillStyle = muted;
  ctx.textAlign = 'left';
  ctx.fillText(groupByYear ? 'ano 1' : 'parcela 1', padding.left, height - 8);
  ctx.textAlign = 'right';
  ctx.fillText(groupByYear ? `ano ${buckets.length}` : `parcela ${buckets.length}`, padding.left + plotW, height - 8);
  ctx.textAlign = 'left';
}
