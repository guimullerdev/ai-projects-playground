// Testes das funções puras do scanner — as que decidem o que o app afirma
// sobre os seus dias. Rodam com `npm test` (node:test embutido, sem
// dependência nova, como o resto do repo, que não tem build step).
//
// O que está testado aqui é de propósito o que o plan.md chama de decisão, e
// não o que é detalhe de implementação: a virada do dia às 4h, folga que não
// quebra streak, semana parcial que não vira semana ruim. Se alguma dessas
// mudar, é pra quebrar um teste e obrigar a reler o plano.

const test = require('node:test');
const assert = require('node:assert/strict');

const scanner = require('../main/scanner');

/** Monta um commitMap a partir de {data: nCommits} — o formato que o resto do app consome. */
function mapOf(spec) {
  const map = new Map();
  for (const [date, count] of Object.entries(spec)) {
    map.set(
      date,
      Array.from({ length: count }, (_, i) => ({ repo: `repo${i % 2}`, hash: `${date}-${i}`, msg: 'msg' }))
    );
  }
  return map;
}

/** Datas consecutivas a partir de `start`, cada uma com 1 commit. */
function run(start, days) {
  const spec = {};
  for (let i = 0; i < days; i += 1) spec[scanner.addDays(start, i)] = 1;
  return spec;
}

// ---------------------------------------------------------------- datas

test('logicalDate joga commit da madrugada pro dia anterior', () => {
  // 01:30 com dayStartHour=4 é "ontem" — a sessão da madrugada conta pro dia
  // em que ela começou, não pro dia do relógio.
  assert.equal(scanner.logicalDate(2026, 9, 15, 1, 4), '2026-09-14');
  assert.equal(scanner.logicalDate(2026, 9, 15, 3, 4), '2026-09-14');
  // exatamente no limiar já é o dia novo
  assert.equal(scanner.logicalDate(2026, 9, 15, 4, 4), '2026-09-15');
  assert.equal(scanner.logicalDate(2026, 9, 15, 23, 4), '2026-09-15');
  // com dayStartHour=0 a virada é a meia-noite de sempre
  assert.equal(scanner.logicalDate(2026, 9, 15, 1, 0), '2026-09-15');
});

test('logicalDate atravessa virada de mês e de ano', () => {
  assert.equal(scanner.logicalDate(2026, 10, 1, 2, 4), '2026-09-30');
  assert.equal(scanner.logicalDate(2027, 1, 1, 2, 4), '2026-12-31');
  // 1º de março de ano bissexto volta pro dia 29
  assert.equal(scanner.logicalDate(2028, 3, 1, 2, 4), '2028-02-29');
});

test('addDays anda pra frente e pra trás sem tropeçar em fim de mês', () => {
  assert.equal(scanner.addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(scanner.addDays('2026-10-01', -1), '2026-09-30');
  assert.equal(scanner.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(scanner.addDays('2028-02-28', 1), '2028-02-29');
});

test('a semana começa na segunda, como as linhas do heatmap', () => {
  // 2026-09-28 é uma segunda
  assert.equal(scanner.weekdayMondayFirst('2026-09-28'), 0);
  assert.equal(scanner.weekdayMondayFirst('2026-09-29'), 1);
  assert.equal(scanner.weekdayMondayFirst('2026-10-04'), 6); // domingo
  assert.equal(scanner.mondayOf('2026-10-04'), '2026-09-28'); // domingo puxa pra segunda anterior
  assert.equal(scanner.mondayOf('2026-09-28'), '2026-09-28'); // segunda é ela mesma
  // startOfWeek é a mesma conta por outro caminho: têm que concordar sempre
  for (let i = 0; i < 14; i += 1) {
    const d = scanner.addDays('2026-09-20', i);
    assert.equal(scanner.startOfWeek(d), scanner.mondayOf(d), `divergiram em ${d}`);
  }
});

// ------------------------------------------------------------ commitMap

test('buildCommitMap dedupa o mesmo commit visto em dois clones', () => {
  const commits = [
    { hash: 'aaa', rawY: 2026, rawMo: 9, rawD: 15, rawHour: 10, msg: 'm', repo: 'projeto' },
    { hash: 'aaa', rawY: 2026, rawMo: 9, rawD: 15, rawHour: 10, msg: 'm', repo: 'projeto-clone' },
    { hash: 'bbb', rawY: 2026, rawMo: 9, rawD: 15, rawHour: 11, msg: 'm', repo: 'projeto' },
  ];
  const map = scanner.buildCommitMap(commits, 4);
  assert.equal(map.get('2026-09-15').length, 2);
  // o primeiro a aparecer é quem fica — o clone não sobrescreve o original
  assert.equal(map.get('2026-09-15')[0].repo, 'projeto');
});

test('buildCommitMap re-agrupa pelo dayStartHour do config', () => {
  const commits = [{ hash: 'aaa', rawY: 2026, rawMo: 9, rawD: 15, rawHour: 2, msg: 'm', repo: 'p' }];
  assert.ok(scanner.buildCommitMap(commits, 4).has('2026-09-14'));
  assert.ok(scanner.buildCommitMap(commits, 0).has('2026-09-15'));
});

// --------------------------------------------------------------- streaks

test('streak atual conta hoje quando já commitei', () => {
  const map = mapOf(run('2026-09-26', 4)); // 26,27,28,29
  assert.equal(scanner.computeStreaks(map, [], '2026-09-29').current, 4);
});

test('hoje ainda vazio não quebra o streak — a contagem começa em ontem', () => {
  const map = mapOf(run('2026-09-26', 3)); // 26,27,28; hoje (29) vazio
  assert.equal(scanner.computeStreaks(map, [], '2026-09-29').current, 3);
});

test('folga pula sem quebrar, e não entra na contagem', () => {
  // 26 e 27 com commit, 28 de folga, 29 com commit
  const map = mapOf({ '2026-09-26': 1, '2026-09-27': 1, '2026-09-29': 1 });
  const s = scanner.computeStreaks(map, ['2026-09-28'], '2026-09-29');
  assert.equal(s.current, 3, 'três dias com commit, a folga não soma nem corta');
});

test('dia vazio que não é folga zera o streak atual', () => {
  const map = mapOf({ '2026-09-20': 1, '2026-09-21': 1, '2026-09-29': 1 });
  const s = scanner.computeStreaks(map, [], '2026-09-29');
  assert.equal(s.current, 1);
  assert.equal(s.longest, 2);
});

test('streak vazio quando não há commit nenhum', () => {
  const s = scanner.computeStreaks(new Map(), [], '2026-09-29');
  assert.deepEqual(s, { current: 0, longest: 0 });
});

test('maior streak olha o histórico todo, não só o fim', () => {
  const map = mapOf({ ...run('2026-08-01', 10), ...run('2026-09-28', 2) });
  const s = scanner.computeStreaks(map, [], '2026-09-29');
  assert.equal(s.longest, 10);
  assert.equal(s.current, 2);
});

// ------------------------------------------------------------------ KPIs

test('KPIs contam cobertura e dias perdidos no mês', () => {
  const map = mapOf(run('2026-09-25', 5)); // 25..29
  const kpis = scanner.computeKPIs(map, [], '2026-09-29');
  assert.equal(kpis.currentStreak, 5);
  assert.equal(kpis.daysWithCommit365, 5);
  assert.equal(kpis.coveragePct, Math.round((5 / 365) * 100));
  // set/2026: dias 1..24 vazios; 25..29 com commit
  assert.equal(kpis.daysLostThisMonth, 24);
});

test('dia de folga não entra em dias perdidos', () => {
  const map = mapOf(run('2026-09-25', 5));
  const folgas = ['2026-09-01', '2026-09-02'];
  const kpis = scanner.computeKPIs(map, folgas, '2026-09-29');
  assert.equal(kpis.daysLostThisMonth, 22);
});

// --------------------------------------------------------- meta semanal

test('sem meta configurada, computeWeeklyGoal devolve null', () => {
  assert.equal(scanner.computeWeeklyGoal(mapOf(run('2026-09-28', 2)), [], '2026-09-29', 0), null);
  assert.equal(scanner.computeWeeklyGoal(mapOf(run('2026-09-28', 2)), [], '2026-09-29', null), null);
});

test('meta batida é meta batida, mesmo sobrando semana', () => {
  // seg a qui com commit, meta 4, hoje é quinta
  const map = mapOf(run('2026-09-28', 4));
  const g = scanner.computeWeeklyGoal(map, [], '2026-10-01', 4);
  assert.equal(g.done, 4);
  assert.equal(g.met, true);
  assert.equal(g.remaining, 0);
  assert.equal(g.atRisk, false);
});

test('meta fica em risco quando não sobram dias suficientes', () => {
  // hoje é sábado, nada commitado na semana, meta 4: sobram sábado e domingo
  const g = scanner.computeWeeklyGoal(new Map(), [], '2026-10-03', 4);
  assert.equal(g.done, 0);
  assert.equal(g.opportunities, 2);
  assert.equal(g.remaining, 4);
  assert.equal(g.atRisk, true);
});

test('folga sai da conta de oportunidades da meta', () => {
  // hoje sexta, meta 2, nada feito; sobram sex, sáb, dom — mas sáb e dom são folga
  const semFolga = scanner.computeWeeklyGoal(new Map(), [], '2026-10-02', 2);
  assert.equal(semFolga.opportunities, 3);
  assert.equal(semFolga.atRisk, false);

  const comFolga = scanner.computeWeeklyGoal(
    new Map(),
    ['2026-10-03', '2026-10-04'],
    '2026-10-02',
    2
  );
  assert.equal(comFolga.opportunities, 1, 'só sexta sobra como oportunidade real');
  assert.equal(comFolga.atRisk, true, 'faltam 2 e só há 1 dia disponível');
});

// -------------------------------------------------------------- lacunas

test('lacunas vêm agrupadas por quebra, mais recente primeiro', () => {
  // primeiro commit em 01/09; vazios em 02-04 e 06; commits em 05 e 07
  const map = mapOf({ '2026-09-01': 1, '2026-09-05': 1, '2026-09-07': 1 });
  const gaps = scanner.computeGaps(map, [], '2026-09-07');
  assert.deepEqual(
    gaps.map((g) => [g.start, g.end, g.days]),
    [
      ['2026-09-06', '2026-09-06', 1],
      ['2026-09-02', '2026-09-04', 3],
    ]
  );
});

test('folga não vira lacuna, e parte a lacuna em duas', () => {
  const map = mapOf({ '2026-09-01': 1, '2026-09-07': 1 });
  const gaps = scanner.computeGaps(map, ['2026-09-04'], '2026-09-07');
  assert.deepEqual(
    gaps.map((g) => [g.start, g.end]),
    [
      ['2026-09-05', '2026-09-06'],
      ['2026-09-02', '2026-09-03'],
    ]
  );
});

test('lacunas ignoram o passado anterior ao primeiro commit', () => {
  const map = mapOf({ '2026-09-05': 1 });
  assert.deepEqual(scanner.computeGaps(map, [], '2026-09-05'), []);
});

test('lacuna aberta hoje aparece até hoje', () => {
  const map = mapOf({ '2026-09-01': 1 });
  const gaps = scanner.computeGaps(map, [], '2026-09-03');
  assert.deepEqual(gaps.map((g) => [g.start, g.end, g.days]), [['2026-09-02', '2026-09-03', 2]]);
});

// -------------------------------------------------------------- heatmap

test('a rampa do heatmap tem os cortes do plano', () => {
  assert.equal(scanner.bucketForCount(0), 0);
  assert.equal(scanner.bucketForCount(1), 1);
  assert.equal(scanner.bucketForCount(2), 1);
  assert.equal(scanner.bucketForCount(3), 2);
  assert.equal(scanner.bucketForCount(5), 2);
  assert.equal(scanner.bucketForCount(6), 3);
  assert.equal(scanner.bucketForCount(9), 3);
  assert.equal(scanner.bucketForCount(10), 4);
  assert.equal(scanner.bucketForCount(999), 4);
});

test('a grade tem 53 semanas de 7 dias terminando no domingo da semana atual', () => {
  const map = mapOf(run('2026-09-28', 2));
  const weeks = scanner.buildHeatmapWeeks(map, [], '2026-09-29', '2026-09-28');
  assert.equal(weeks.length, 53);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(weeks[52][0].date, '2026-09-28', 'última linha começa na segunda desta semana');
  assert.equal(weeks[52][6].date, '2026-10-04', 'e termina no domingo');
});

test('só o dia zero "normal" ganha o anel — futuro e pré-histórico não são lacuna', () => {
  // hoje é quarta 30/09; segunda tem commit, terça é folga
  const map = mapOf({ '2026-09-28': 1 });
  const weeks = scanner.buildHeatmapWeeks(map, ['2026-09-29'], '2026-09-30', '2026-09-28');
  const semana = weeks[52];
  assert.equal(semana[0].status, 'normal'); // segunda, com commit
  assert.equal(semana[1].status, 'rest'); // terça marcada como folga
  assert.equal(semana[2].status, 'normal'); // quarta (hoje), vazia: é lacuna, tem anel
  assert.equal(semana[3].status, 'future'); // quinta ainda não chegou
  // antes do primeiro commit conhecido: fora de escala, não é dia perdido
  assert.equal(weeks[0][0].status, 'before-first');
});

test('futuro vence folga: folga marcada lá na frente não vira hachura hoje', () => {
  // marcar férias da semana que vem não deve desenhar nada na grade ainda —
  // a hachura de folga é sobre o passado, o futuro é só "ainda não chegou".
  const map = mapOf({ '2026-09-28': 1 });
  const weeks = scanner.buildHeatmapWeeks(map, ['2026-10-02'], '2026-09-30', '2026-09-28');
  assert.equal(weeks[52][4].status, 'future');
});

test('cada célula carrega a quebra por repo', () => {
  const map = new Map([
    [
      '2026-09-28',
      [
        { repo: 'alpha', hash: '1', msg: 'm' },
        { repo: 'alpha', hash: '2', msg: 'm' },
        { repo: 'beta', hash: '3', msg: 'm' },
      ],
    ],
  ]);
  const weeks = scanner.buildHeatmapWeeks(map, [], '2026-09-29', '2026-09-28');
  const segunda = weeks[52][0];
  assert.equal(segunda.count, 3);
  assert.equal(segunda.bucket, 2);
  assert.deepEqual(segunda.repos, [
    { repo: 'alpha', count: 2 },
    { repo: 'beta', count: 3 - 2 },
  ]);
});
