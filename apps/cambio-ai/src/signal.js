'use strict';

// O card de sinal — "bom momento pra converter" / "esperar".
//
// É a heurística que o POC `pocs/dollar-cost-analyzer` já usava, portada pra cá
// sem mudar os cortes: posição na faixa dos últimos 30 pregões decide o sinal, e
// a tendência das duas últimas semanas entra como qualificador do texto, nunca
// como gatilho sozinho.
//
// Sem Electron aqui de propósito: é função pura sobre as cotações, dá pra rodar
// e conferir com `node` sem subir o app. A parte de IA (outlook, notícias) é a
// v2b e vive fora deste arquivo.

const HIGH = 0.75; // daqui pra cima, perto do topo da faixa
const LOW = 0.25; // daqui pra baixo, perto do piso
const TREND_PCT = 0.15; // abaixo disso a variação entre as semanas é ruído
const MIN_SESSIONS = 7; // menos que uma semana de pregão não forma faixa

const rateFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const pctFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * @param {{bid: number}|null} quote cotação atual
 * @param {Array<{bid: number}>} daily pregões, do mais antigo pro mais recente
 * @returns {{
 *   state: 'convert'|'wait'|'neutral'|'insufficient',
 *   icon: string, title: string, text: string,
 *   position: number|null, min: number|null, max: number|null,
 *   trend: 'up'|'down'|'flat', trendPct: number|null,
 * }}
 */
function analyze(quote, daily) {
  const bids = (Array.isArray(daily) ? daily : [])
    .map((entry) => entry && entry.bid)
    .filter((bid) => typeof bid === 'number' && Number.isFinite(bid));

  const bid = quote && Number.isFinite(quote.bid) ? quote.bid : null;
  const min = bids.length ? Math.min(...bids) : null;
  const max = bids.length ? Math.max(...bids) : null;
  const range = min === null ? 0 : max - min;

  if (bid === null || bids.length < MIN_SESSIONS || range <= 0) {
    return {
      state: 'insufficient',
      icon: '·',
      title: 'Sem faixa pra comparar',
      text: `O sinal precisa de pelo menos ${MIN_SESSIONS} pregões no histórico pra dizer onde a cotação de hoje está na faixa.`,
      position: null,
      min,
      max,
      trend: 'flat',
      trendPct: null,
    };
  }

  // 0 = mínima dos 30 pregões, 1 = máxima.
  const position = clamp((bid - min) / range, 0, 1);
  const { trend, trendPct } = trendOf(bids);
  const faixa = `mín. ${money(min)} / máx. ${money(max)}`;

  if (position >= HIGH) {
    return {
      state: 'convert',
      icon: '↑',
      title: 'Perto da máxima de 30 dias',
      text: `A ${pctFmt.format((1 - position) * 100)}% do topo da faixa (${faixa})${trend === 'up' ? ', e ainda subindo' : ''}. É um momento mais favorável pra converter do que pra esperar.`,
      position,
      min,
      max,
      trend,
      trendPct,
    };
  }

  if (position <= LOW) {
    return {
      state: 'wait',
      icon: '↓',
      title: 'Perto da mínima de 30 dias',
      text: `Próximo do piso da faixa (${faixa})${trend === 'down' ? ', e ainda caindo' : ''}. Sem urgência, pode valer esperar uma recuperação.`,
      position,
      min,
      max,
      trend,
      trendPct,
    };
  }

  return {
    state: 'neutral',
    icon: '–',
    title: 'Faixa intermediária',
    text: `No meio da faixa de 30 dias (${faixa}), ${trendLabel(trend)} na última semana. Sem sinal forte pra converter agora nem pra esperar.`,
    position,
    min,
    max,
    trend,
    trendPct,
  };
}

/** Média da última semana contra a anterior — o qualificador, não o gatilho. */
function trendOf(bids) {
  const last7 = bids.slice(-7);
  const prior7 = bids.slice(-14, -7);
  const recent = average(last7.length ? last7 : bids);
  const prior = average(prior7.length ? prior7 : bids);
  if (!prior) return { trend: 'flat', trendPct: null };
  const trendPct = ((recent - prior) / prior) * 100;
  if (trendPct > TREND_PCT) return { trend: 'up', trendPct };
  if (trendPct < -TREND_PCT) return { trend: 'down', trendPct };
  return { trend: 'flat', trendPct };
}

function trendLabel(trend) {
  if (trend === 'up') return 'com leve tendência de alta';
  if (trend === 'down') return 'com leve tendência de queda';
  return 'estável';
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function money(value) {
  return `R$ ${rateFmt.format(value)}`;
}

module.exports = { analyze, HIGH, LOW, MIN_SESSIONS };
