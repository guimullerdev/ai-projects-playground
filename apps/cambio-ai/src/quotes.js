'use strict';

// Fonte única do app: AwesomeAPI, direto do processo principal. Sem servidor
// próprio e sem chave — os três endpoints abaixo são públicos.
const LAST_URL = 'https://economia.awesomeapi.com.br/json/last/USD-BRL';
const DAILY_URL = (days) => `https://economia.awesomeapi.com.br/json/daily/USD-BRL/${days}`;
const TICKS_URL = (n) => `https://economia.awesomeapi.com.br/json/USD-BRL/${n}`;

// A API devolve no máximo 100 cotações nesse endpoint, o que cobre só as
// últimas 2–3 horas de pregão — por isso o app acumula o histórico do dia em
// store.js em vez de confiar só no que vem daqui.
const TICKS_LIMIT = 100;
const DAILY_DAYS = 30;
const TIMEOUT_MS = 10 * 1000;

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} em ${url}`);
  return res.json();
}

function num(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// Uma cotação só entra nos gráficos se tiver os dois lados e o horário.
function toSample(raw) {
  const t = Number(raw.timestamp);
  const bid = num(raw.bid);
  const ask = num(raw.ask);
  if (!Number.isFinite(t) || bid === null || ask === null) return null;
  return { t, bid, ask };
}

async function fetchAll() {
  const [last, daily, ticks] = await Promise.all([
    getJSON(LAST_URL),
    getJSON(DAILY_URL(DAILY_DAYS)),
    getJSON(TICKS_URL(TICKS_LIMIT)),
  ]);

  const quote = last && last.USDBRL;
  if (!quote) throw new Error('resposta sem USDBRL');

  return {
    quote: {
      ...toSample(quote),
      high: num(quote.high),
      low: num(quote.low),
      varBid: num(quote.varBid),
      pctChange: num(quote.pctChange),
    },
    // Ambos os endpoints vêm do mais recente pro mais antigo; os gráficos
    // querem o contrário.
    daily: (Array.isArray(daily) ? daily : []).map(toSample).filter(Boolean).reverse(),
    ticks: (Array.isArray(ticks) ? ticks : []).map(toSample).filter(Boolean).reverse(),
  };
}

module.exports = { fetchAll, DAILY_DAYS };
