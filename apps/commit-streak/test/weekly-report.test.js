// Testes do relatório semanal. Separado do scanner.test.js porque as regras
// aqui são de outra natureza: não é "que dia é esse", é "o que a semana
// merece que digam dela".
//
// As duas que mais importam, e que são fáceis de quebrar sem querer:
//   - semana incompleta não entra na média e nunca aparece como meta perdida;
//   - dia de folga sai do denominador, não do numerador.

const test = require('node:test');
const assert = require('node:assert/strict');

const scanner = require('../main/scanner');

/** commitMap com `count` commits em cada data listada. */
function mapOf(spec) {
  const map = new Map();
  for (const [date, count] of Object.entries(spec)) {
    map.set(
      date,
      Array.from({ length: count }, (_, i) => ({ repo: `repo${i % 2}`, hash: `${date}-${i}`, msg: 'm' }))
    );
  }
  return map;
}

/** `days` dias consecutivos com 1 commit a partir de `start`. */
function run(start, days, spec = {}) {
  for (let i = 0; i < days; i += 1) spec[scanner.addDays(start, i)] = 1;
  return spec;
}

/** N semanas cheias (7/7) terminando no domingo anterior a `mondayOfWeek0`. */
function fullWeeksBefore(mondayOfWeek0, n) {
  const spec = {};
  for (let w = 1; w <= n; w += 1) run(scanner.addDays(mondayOfWeek0, -w * 7), 7, spec);
  return spec;
}

const HOJE = '2026-09-30'; // quarta
const SEGUNDA = '2026-09-28';

test('a semana corrente vem marcada e não entra na média', () => {
  // semana corrente: seg e ter com commit (qua, hoje, vazia) + 2 semanas cheias antes
  const map = mapOf({ ...run(SEGUNDA, 2), ...fullWeeksBefore(SEGUNDA, 2) });
  const r = scanner.computeWeeklyReport(map, [], HOJE, { weeksCount: 4, goal: 4 });

  const atual = r.weeks[0];
  assert.equal(atual.isCurrent, true);
  assert.equal(atual.isPartial, true);
  assert.equal(atual.tracked, 3, 'só seg, ter e qua já aconteceram');
  assert.equal(atual.daysWithCommit, 2);
  assert.equal(atual.missed, false, 'faltando 2 pra meta, mas a semana não acabou');

  // a média é das completas (7 e 7), não das três
  assert.equal(r.summary.completeWeeks, 2);
  assert.equal(r.summary.avgDays, 7);
});

test('semana fechada abaixo da meta é meta perdida, com a diferença', () => {
  const map = mapOf({ ...run(SEGUNDA, 3), ...run('2026-09-21', 2) });
  const r = scanner.computeWeeklyReport(map, [], HOJE, { weeksCount: 2, goal: 4 });

  const passada = r.weeks[1];
  assert.equal(passada.isPartial, false);
  assert.equal(passada.daysWithCommit, 2);
  assert.equal(passada.met, false);
  assert.equal(passada.missed, true);
  assert.equal(r.summary.metCount, 0);
});

test('folga sai do denominador, não do numerador', () => {
  // semana de 21 a 27: commit em 21 e 22, folga em 23 e 24, vazio em 25, 26, 27
  const map = mapOf({ ...run('2026-09-21', 2), ...run(SEGUNDA, 1) });
  const r = scanner.computeWeeklyReport(map, ['2026-09-23', '2026-09-24'], HOJE, { weeksCount: 2 });

  const semana = r.weeks[1];
  assert.equal(semana.daysWithCommit, 2, 'a folga não vira dia com commit');
  assert.equal(semana.opportunities, 5, '7 dias menos as 2 folgas');
  assert.equal(semana.restDays, 2);
  assert.equal(semana.emptyDays, 3);
});

test('commit num dia de folga conta como dia com commit', () => {
  // trabalhei no feriado: o dia conta, e sai da conta de folga
  const map = mapOf(run('2026-09-21', 3));
  const r = scanner.computeWeeklyReport(map, ['2026-09-23'], HOJE, { weeksCount: 2 });
  const semana = r.weeks[1];
  assert.equal(semana.daysWithCommit, 3);
  assert.equal(semana.restDays, 0, 'a folga tinha commit, então não é folga vazia');
  assert.equal(semana.opportunities, 7);
});

test('sem meta, nenhuma semana ganha veredito de meta', () => {
  const map = mapOf(fullWeeksBefore(SEGUNDA, 2));
  const r = scanner.computeWeeklyReport(map, [], HOJE, { weeksCount: 3 });
  assert.equal(r.goal, 0);
  assert.ok(r.weeks.every((w) => w.met === null));
  assert.ok(r.weeks.every((w) => w.missed === false));
  assert.equal(r.summary.metCount, null);
});

test('semanas anteriores ao primeiro commit ficam de fora', () => {
  const map = mapOf(run('2026-09-21', 3));
  const r = scanner.computeWeeklyReport(map, [], HOJE, { weeksCount: 12 });
  // só a semana de 21 e a corrente existem — o resto é antes do primeiro commit
  assert.equal(r.weeks.length, 2);
  assert.equal(r.weeks[1].start, '2026-09-21');
});

test('a semana mais antiga, cortada pelo primeiro commit, é parcial', () => {
  // primeiro commit numa quarta: a semana dele só tem 5 dias rastreáveis
  const map = mapOf({ '2026-09-23': 1, ...run(SEGUNDA, 2) });
  const r = scanner.computeWeeklyReport(map, [], HOJE, { weeksCount: 4, goal: 4 });
  const primeira = r.weeks[r.weeks.length - 1];
  assert.equal(primeira.start, '2026-09-21');
  assert.equal(primeira.tracked, 5, 'de quarta a domingo');
  assert.equal(primeira.isPartial, true);
  assert.equal(primeira.isCurrent, false);
  assert.equal(primeira.missed, false, 'semana cortada não é semana perdida');
});

test('repos vêm ordenados por volume, com desempate por nome', () => {
  const map = new Map([
    [
      SEGUNDA,
      [
        { repo: 'zeta', hash: '1', msg: 'm' },
        { repo: 'alpha', hash: '2', msg: 'm' },
        { repo: 'beta', hash: '3', msg: 'm' },
        { repo: 'beta', hash: '4', msg: 'm' },
      ],
    ],
  ]);
  const r = scanner.computeWeeklyReport(map, [], HOJE, { weeksCount: 1 });
  assert.deepEqual(r.weeks[0].repos, [
    { repo: 'beta', count: 2 },
    { repo: 'alpha', count: 1 },
    { repo: 'zeta', count: 1 },
  ]);
});

// ------------------------------------------------------------- tendência

test('tendência só aparece com 8 semanas fechadas', () => {
  const sete = mapOf({ ...run(SEGUNDA, 2), ...fullWeeksBefore(SEGUNDA, 7) });
  assert.equal(scanner.computeWeeklyReport(sete, [], HOJE, { weeksCount: 12 }).summary.trend, null);

  const oito = mapOf({ ...run(SEGUNDA, 2), ...fullWeeksBefore(SEGUNDA, 8) });
  assert.notEqual(scanner.computeWeeklyReport(oito, [], HOJE, { weeksCount: 12 }).summary.trend, null);
});

test('tendência compara as 4 fechadas mais recentes com as 4 anteriores', () => {
  const spec = { ...run(SEGUNDA, 2) };
  // 4 semanas recentes com 6 dias, 4 mais antigas com 2 dias
  for (let w = 1; w <= 4; w += 1) run(scanner.addDays(SEGUNDA, -w * 7), 6, spec);
  for (let w = 5; w <= 8; w += 1) run(scanner.addDays(SEGUNDA, -w * 7), 2, spec);

  const r = scanner.computeWeeklyReport(mapOf(spec), [], HOJE, { weeksCount: 12 });
  assert.equal(r.summary.trend.recent, 6);
  assert.equal(r.summary.trend.previous, 2);
  assert.equal(r.summary.trend.delta, 4);
  assert.equal(r.summary.trend.direction, 'up');
});

/** Monta 8 semanas fechadas: as 4 recentes com `recentes` dias, as 4 anteriores com `antigas`. */
function oitoSemanas(recentes, antigas) {
  const spec = { ...run(SEGUNDA, 2) };
  for (let w = 1; w <= 4; w += 1) run(scanner.addDays(SEGUNDA, -w * 7), recentes, spec);
  for (let w = 5; w <= 8; w += 1) run(scanner.addDays(SEGUNDA, -w * 7), antigas, spec);
  return scanner.computeWeeklyReport(mapOf(spec), [], HOJE, { weeksCount: 12 }).summary.trend;
}

test('um dia de diferença em quatro semanas não é tendência, pra nenhum dos lados', () => {
  // Esta é a simetria que o arredondamento quebrava: +1 dia e -1 dia dão o
  // mesmo |delta| e têm que dar o mesmo veredito.
  const subiu = oitoSemanas(5, 5);
  assert.equal(subiu.direction, 'flat');

  // 4 semanas a 5 dias contra 3 a 5 e 1 a 6 -> -1 dia no total, delta -0,25
  const spec = { ...run(SEGUNDA, 2) };
  for (let w = 1; w <= 4; w += 1) run(scanner.addDays(SEGUNDA, -w * 7), 5, spec);
  for (let w = 5; w <= 7; w += 1) run(scanner.addDays(SEGUNDA, -w * 7), 5, spec);
  run(scanner.addDays(SEGUNDA, -8 * 7), 6, spec);
  const caiu = scanner.computeWeeklyReport(mapOf(spec), [], HOJE, { weeksCount: 12 }).summary.trend;
  // o número exibido continua arredondado a uma casa (-0,25 vira "-0,2"); o que
  // não pode é o arredondamento decidir a direção, e não decide mais
  assert.equal(caiu.delta, -0.2);
  assert.equal(caiu.direction, 'flat', 'um dia a menos em quatro semanas não é queda');

  // e o espelho: um dia a MAIS também não é alta
  const spec2 = { ...run(SEGUNDA, 2) };
  for (let w = 1; w <= 3; w += 1) run(scanner.addDays(SEGUNDA, -w * 7), 5, spec2);
  run(scanner.addDays(SEGUNDA, -4 * 7), 6, spec2);
  for (let w = 5; w <= 8; w += 1) run(scanner.addDays(SEGUNDA, -w * 7), 5, spec2);
  const subiuUm = scanner.computeWeeklyReport(mapOf(spec2), [], HOJE, { weeksCount: 12 }).summary.trend;
  assert.equal(subiuUm.direction, 'flat', 'um dia a mais em quatro semanas também não é alta');
});

test('meio dia por semana de diferença já é tendência', () => {
  // 2 dias a mais espalhados nas 4 semanas recentes = +0,5/semana, passa do corte
  const spec = { ...run(SEGUNDA, 2) };
  run(scanner.addDays(SEGUNDA, -1 * 7), 6, spec);
  run(scanner.addDays(SEGUNDA, -2 * 7), 6, spec);
  run(scanner.addDays(SEGUNDA, -3 * 7), 5, spec);
  run(scanner.addDays(SEGUNDA, -4 * 7), 5, spec);
  for (let w = 5; w <= 8; w += 1) run(scanner.addDays(SEGUNDA, -w * 7), 5, spec);
  const t = scanner.computeWeeklyReport(mapOf(spec), [], HOJE, { weeksCount: 12 }).summary.trend;
  assert.equal(t.delta, 0.5);
  assert.equal(t.direction, 'up');
});

test('um dia a mais por semana é alta; três a menos é queda', () => {
  assert.equal(oitoSemanas(6, 5).direction, 'up');
  assert.equal(oitoSemanas(5, 5).direction, 'flat');
  assert.equal(oitoSemanas(3, 6).direction, 'down');
});

// ----------------------------------------------------------------- bordas

test('relatório de um mapa vazio não quebra e não inventa resumo', () => {
  const r = scanner.computeWeeklyReport(new Map(), [], HOJE, { weeksCount: 4, goal: 4 });
  assert.equal(r.summary.avgDays, 0);
  assert.equal(r.summary.totalCommits, 0);
  assert.equal(r.summary.trend, null);
  assert.ok(r.weeks.every((w) => w.daysWithCommit === 0));
});

test('summarizeWeeks sem nenhuma semana fechada devolve resumo nulo, não zero', () => {
  // zero e "não sei ainda" são coisas diferentes: a tela escreve frases diferentes
  const s = scanner.summarizeWeeks(
    [{ daysWithCommit: 2, commits: 3, isPartial: true, start: SEGUNDA, end: '2026-10-04' }],
    4
  );
  assert.equal(s.completeWeeks, 0);
  assert.equal(s.avgDays, null);
  assert.equal(s.best, null);
  assert.equal(s.metCount, null);
  assert.equal(s.totalCommits, 3, 'os commits da semana em andamento continuam contados');
});

test('melhor semana desempata por número de commits', () => {
  const spec = {};
  run('2026-09-21', 3, spec);
  run('2026-09-14', 3, spec);
  spec['2026-09-14'] = 9; // mesma quantidade de dias, muito mais commits
  const r = scanner.computeWeeklyReport(mapOf(spec), [], HOJE, { weeksCount: 4 });
  assert.equal(r.summary.best.start, '2026-09-14');
});
