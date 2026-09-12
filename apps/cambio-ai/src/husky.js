'use strict';

// Comparação com a taxa da Husky — o spread que some do valor recebido.
//
// A Husky não tem API pública, então a taxa é digitada à mão no popover, igual
// ao campo que o POC `pocs/dollar-cost-analyzer` já tinha. O que o app acrescenta
// é guardar o número entre aberturas e dizer o spread em reais por dólar, não só
// em percentual: "0,42%" não dói, "R$ 0,02 por dólar" dói.
//
// Sem Electron aqui: é função pura sobre dois números.

// Abaixo disso a diferença é ruído de arredondamento da própria cotação, que
// anda mais que isso entre duas atualizações.
const PAR_PCT = 0.05;

const rateFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const pctFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * @param {number|null} bid cotação de compra do dólar comercial
 * @param {number|null} rate taxa oferecida pela Husky, digitada pelo usuário
 * @returns {{
 *   state: 'none'|'below'|'above'|'par',
 *   spreadPct: number|null, perDollar: number|null, text: string|null,
 * }}
 */
function compare(bid, rate) {
  const valid = typeof bid === 'number' && Number.isFinite(bid) && bid > 0
    && typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
  if (!valid) return { state: 'none', spreadPct: null, perDollar: null, text: null };

  const spreadPct = ((bid - rate) / bid) * 100;
  const perDollar = bid - rate;

  if (Math.abs(spreadPct) < PAR_PCT) {
    return {
      state: 'par',
      spreadPct,
      perDollar,
      text: `Praticamente o mesmo do comercial (${money(rate)}).`,
    };
  }

  if (spreadPct > 0) {
    return {
      state: 'below',
      spreadPct,
      perDollar,
      text: `${pctFmt.format(spreadPct)}% abaixo do comercial — ${money(perDollar)} por dólar fica no spread (${money(rate)} vs ${money(bid)}).`,
    };
  }

  return {
    state: 'above',
    spreadPct,
    perDollar,
    text: `Acima do comercial: ${money(rate)} contra ${money(bid)}.`,
  };
}

/** Normaliza o que veio do campo: número positivo, ou nada. */
function parseRate(value) {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function money(value) {
  return `R$ ${rateFmt.format(Math.abs(value))}`;
}

module.exports = { compare, parseRate, PAR_PCT };
