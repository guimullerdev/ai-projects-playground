'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// O gráfico intradiário não existe pronto em lugar nenhum: a API só devolve as
// últimas ~100 cotações. Como o app fica ligado o dia inteiro na barra de menu,
// ele mesmo guarda cada amostra que vê e vai montando a trajetória do dia.
const MAX_SAMPLES = 4000;
const KEEP_DAYS = 2; // hoje + o pregão anterior (pra não ficar vazio no fim de semana)

function filePath() {
  return path.join(app.getPath('userData'), 'intraday.json');
}

function dayKey(sample) {
  // en-CA formata como YYYY-MM-DD, e no fuso local — que é o do pregão pra quem
  // usa o app.
  return new Date(sample.t * 1000).toLocaleDateString('en-CA');
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Primeira execução, arquivo corrompido ou disco ilegível: o histórico
    // local é um acúmulo, não a fonte da verdade — recomeça vazio.
    return [];
  }
}

function save(samples) {
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(samples));
  } catch {
    // Melhor esforço: sem gravar, o app segue rodando e o gráfico do dia passa
    // a mostrar só o que a API devolve na sessão atual.
  }
}

// Junta as amostras novas ao que já foi coletado, deduplicando pelo timestamp
// (a API repete as últimas cotações a cada polling).
function merge(incoming) {
  const byTime = new Map();
  for (const sample of [...load(), ...incoming]) byTime.set(sample.t, sample);

  let all = [...byTime.values()].sort((a, b) => a.t - b.t);
  const days = [...new Set(all.map(dayKey))].slice(-KEEP_DAYS);
  all = all.filter((sample) => days.includes(dayKey(sample)));
  if (all.length > MAX_SAMPLES) all = all.slice(-MAX_SAMPLES);

  save(all);
  return all;
}

// Só o pregão mais recente vai pro gráfico do dia. Em fim de semana ou feriado
// isso é a sexta-feira, e o popover mostra a data junto pra não passar por hoje.
function latestSession(samples) {
  if (!samples.length) return { date: null, samples: [] };
  const date = dayKey(samples[samples.length - 1]);
  return { date, samples: samples.filter((sample) => dayKey(sample) === date) };
}

module.exports = { merge, latestSession };
