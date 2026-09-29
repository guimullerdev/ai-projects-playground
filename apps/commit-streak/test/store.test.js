// Testes da poda das flags de notificação. É pouca coisa, mas é o tipo de
// função que roda sozinha, apaga dado e ninguém olha — então ela é justamente
// a que precisa de teste.

const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../main/store');

const HOJE = '2026-09-29';

/** `data.json` mínimo com as datas passadas já como flags de notificação. */
function dataCom(...datas) {
  const notifyFlags = {};
  for (const d of datas) notifyFlags[d] = { '19:00': true };
  return { repos: { '/algum/repo': { lastScan: 'x', commits: [] } }, notifyFlags, snoozeUntil: null };
}

test('poda tira o que passou da janela e mantém o resto', () => {
  const data = dataCom(HOJE, '2026-09-20', '2026-08-01', '2025-12-31');
  const removidas = store.pruneNotifyFlags(data, HOJE);

  assert.equal(removidas, 2);
  assert.deepEqual(Object.keys(data.notifyFlags).sort(), ['2026-09-20', HOJE]);
});

test('o dia de hoje nunca sai — é o único que o app realmente lê', () => {
  const data = dataCom(HOJE);
  assert.equal(store.pruneNotifyFlags(data, HOJE), 0);
  assert.deepEqual(data.notifyFlags[HOJE], { '19:00': true });
});

test('a borda da janela fica; um dia além dela sai', () => {
  const naBorda = '2026-08-30'; // exatamente 30 dias antes de 29/09
  const umDiaAlem = '2026-08-29';
  const data = dataCom(naBorda, umDiaAlem);

  assert.equal(store.pruneNotifyFlags(data, HOJE), 1);
  assert.deepEqual(Object.keys(data.notifyFlags), [naBorda]);
});

test('a janela é configurável', () => {
  const data = dataCom(HOJE, '2026-09-27', '2026-09-20');
  assert.equal(store.pruneNotifyFlags(data, HOJE, 7), 1);
  assert.deepEqual(Object.keys(data.notifyFlags).sort(), ['2026-09-27', HOJE]);
});

test('chave que não é data lógica sai, qualquer que seja a idade dela', () => {
  const data = dataCom(HOJE);
  data.notifyFlags['ontem'] = { '19:00': true };
  data.notifyFlags['2026-9-1'] = { '19:00': true }; // sem zero à esquerda: nunca seria lida
  data.notifyFlags['2026-09-29T10:00:00Z'] = { '19:00': true };

  assert.equal(store.pruneNotifyFlags(data, HOJE), 3);
  assert.deepEqual(Object.keys(data.notifyFlags), [HOJE]);
});

test('data no futuro sobrevive — não é lixo, é relógio adiantado', () => {
  const data = dataCom(HOJE, '2026-12-25');
  assert.equal(store.pruneNotifyFlags(data, HOJE), 0);
  assert.equal(Object.keys(data.notifyFlags).length, 2);
});

test('a poda não encosta no resto do data.json', () => {
  const data = dataCom(HOJE, '2020-01-01');
  data.snoozeUntil = '2026-09-29T20:00:00.000Z';
  const reposAntes = JSON.stringify(data.repos);

  store.pruneNotifyFlags(data, HOJE);

  assert.equal(data.snoozeUntil, '2026-09-29T20:00:00.000Z');
  assert.equal(JSON.stringify(data.repos), reposAntes);
});

test('data sem flags, vazio ou torto não quebra a poda', () => {
  assert.equal(store.pruneNotifyFlags({ notifyFlags: {} }, HOJE), 0);
  assert.equal(store.pruneNotifyFlags({}, HOJE), 0);
  assert.equal(store.pruneNotifyFlags({ notifyFlags: null }, HOJE), 0);
  assert.equal(store.pruneNotifyFlags({ notifyFlags: 'ops' }, HOJE), 0);
  assert.equal(store.pruneNotifyFlags(null, HOJE), 0);
});

test('data.json novo em folha passa pela poda sem perder nada', () => {
  const data = store.defaultData();
  assert.equal(store.pruneNotifyFlags(data, HOJE), 0);
  assert.deepEqual(data, store.defaultData());
});

test('podar duas vezes seguidas não tira mais nada na segunda', () => {
  const data = dataCom(HOJE, '2026-09-20', '2020-01-01');
  assert.equal(store.pruneNotifyFlags(data, HOJE), 1);
  assert.equal(store.pruneNotifyFlags(data, HOJE), 0, 'a poda é idempotente no mesmo dia');
});

test('um ano parado cai pra um punhado de entradas, não some com tudo', () => {
  // o caso que motivou a poda: app aberto por muito tempo, uma chave por dia
  const datas = [];
  for (let i = 0; i < 365; i += 1) {
    const d = new Date(Date.UTC(2026, 8, 29, 12));
    d.setUTCDate(d.getUTCDate() - i);
    datas.push(d.toISOString().slice(0, 10));
  }
  const data = dataCom(...datas);
  const removidas = store.pruneNotifyFlags(data, HOJE);

  assert.equal(removidas, 365 - 31, 'sobram os 30 dias da janela mais o próprio dia');
  assert.equal(Object.keys(data.notifyFlags).length, 31);
  assert.ok(data.notifyFlags[HOJE], 'e hoje continua lá');
});
