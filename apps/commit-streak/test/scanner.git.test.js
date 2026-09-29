// Testes das duas funções do scanner que tocam o disco e o git: descoberta de
// repos e leitura do `git log`. Montam repositórios de verdade num diretório
// temporário — nada de mock de `execFile`, porque o que pode quebrar aqui é
// justamente o contrato com o git (formato da data, filtro de autor, merge).
//
// Os commits são criados com GIT_AUTHOR_DATE fixo, então os testes não
// dependem de que horas são agora.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const scanner = require('../main/scanner');

let tmp;

function git(cwd, args, env = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

/** Repo novo com identidade local, pra não depender do ~/.gitconfig de quem roda. */
function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'user.name', 'Fulano de Tal']);
  git(dir, ['config', 'user.email', 'fulano@example.com']);
  return dir;
}

/**
 * Commit com data e autor controlados. `iso` vai com offset explícito de propósito.
 *
 * Cada commit escreve no SEU arquivo, e não todos no mesmo: o teste de merge
 * precisa que dois branches possam se encontrar sem conflito.
 */
function commit(dir, { msg, iso, name = 'Fulano de Tal', email = 'fulano@example.com' }) {
  const arquivo = `${msg.replace(/[^a-z0-9]+/gi, '-')}.txt`;
  fs.writeFileSync(path.join(dir, arquivo), `${msg}\n`);
  git(dir, ['add', '.']);
  git(dir, ['commit', '--quiet', '-m', msg], {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  });
}

test.before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-streak-test-'));
});

test.after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ------------------------------------------------------- discoverRepos

test('discoverRepos acha repo na raiz e em subpasta', () => {
  const root = path.join(tmp, 'discover');
  initRepo(path.join(root, 'projeto-a'));
  initRepo(path.join(root, 'clientes', 'projeto-b'));
  fs.mkdirSync(path.join(root, 'pasta-sem-git'), { recursive: true });

  const found = scanner.discoverRepos([root], [], 3).sort();
  assert.deepEqual(found, [
    path.join(root, 'clientes', 'projeto-b'),
    path.join(root, 'projeto-a'),
  ]);
});

test('discoverRepos não desce dentro de um repo atrás de repo aninhado', () => {
  const root = path.join(tmp, 'aninhado');
  const pai = initRepo(path.join(root, 'pai'));
  initRepo(path.join(pai, 'vendorizado'));

  const found = scanner.discoverRepos([root], [], 3);
  assert.deepEqual(found, [pai], 'o repo de dentro não aparece');
});

test('discoverRepos respeita ignoredDirNames e maxDepth', () => {
  const root = path.join(tmp, 'limites');
  initRepo(path.join(root, 'node_modules', 'pacote'));
  initRepo(path.join(root, 'a', 'b', 'c', 'fundo'));
  const visivel = initRepo(path.join(root, 'raso'));

  assert.deepEqual(scanner.discoverRepos([root], ['node_modules'], 1), [visivel]);

  const comProfundidade = scanner.discoverRepos([root], ['node_modules'], 4).sort();
  assert.deepEqual(comProfundidade, [path.join(root, 'a', 'b', 'c', 'fundo'), visivel]);
});

test('discoverRepos engole raiz inexistente sem quebrar', () => {
  assert.deepEqual(scanner.discoverRepos([path.join(tmp, 'nao-existe')], [], 3), []);
});

// ------------------------------------------------------------ scanRepo

test('scanRepo lê data do autor com a hora local do commit', async () => {
  const repo = initRepo(path.join(tmp, 'datas'));
  // 01:30 da madrugada, com offset explícito: a hora que importa é a do relógio
  // de quem commitou, porque é ela que o dayStartHour re-agrupa depois.
  commit(repo, { msg: 'madrugada', iso: '2026-09-15T01:30:00-03:00' });
  commit(repo, { msg: 'tarde', iso: '2026-09-15T15:00:00-03:00' });

  const commits = await scanner.scanRepo(repo, [], null);
  assert.equal(commits.length, 2);

  const madrugada = commits.find((c) => c.msg === 'madrugada');
  assert.equal(madrugada.rawY, 2026);
  assert.equal(madrugada.rawMo, 9);
  assert.equal(madrugada.rawD, 15);
  assert.equal(madrugada.rawHour, 1);
  assert.equal(madrugada.repo, 'datas', 'o nome do repo é o basename da pasta');
  assert.match(madrugada.hash, /^[0-9a-f]{40}$/);

  // a virada de dia é decisão do buildCommitMap, não do scanRepo
  const map = scanner.buildCommitMap(commits, 4);
  assert.equal(map.get('2026-09-14').length, 1, 'a madrugada caiu no dia anterior');
  assert.equal(map.get('2026-09-15').length, 1);
});

test('scanRepo filtra por autor', async () => {
  const repo = initRepo(path.join(tmp, 'autores'));
  commit(repo, { msg: 'meu', iso: '2026-09-15T10:00:00-03:00' });
  commit(repo, {
    msg: 'de outra pessoa',
    iso: '2026-09-15T11:00:00-03:00',
    name: 'Beltrana',
    email: 'beltrana@example.com',
  });

  const todos = await scanner.scanRepo(repo, [], null);
  assert.equal(todos.length, 2, 'sem filtro, vêm os dois');

  const meus = await scanner.scanRepo(repo, ['fulano@example.com'], null);
  assert.deepEqual(meus.map((c) => c.msg), ['meu']);

  // o filtro casa contra "Nome <email>", então o nome também serve
  const porNome = await scanner.scanRepo(repo, ['Beltrana'], null);
  assert.deepEqual(porNome.map((c) => c.msg), ['de outra pessoa']);
});

test('merge fica de fora por padrão e entra com countMerges', async () => {
  const repo = initRepo(path.join(tmp, 'merges'));
  commit(repo, { msg: 'base', iso: '2026-09-15T10:00:00-03:00' });
  git(repo, ['checkout', '--quiet', '-b', 'ramo']);
  commit(repo, { msg: 'no ramo', iso: '2026-09-15T11:00:00-03:00' });
  git(repo, ['checkout', '--quiet', 'main']);
  commit(repo, { msg: 'na main', iso: '2026-09-15T12:00:00-03:00' });
  git(repo, ['merge', '--quiet', '--no-ff', '-m', 'merge do ramo', 'ramo'], {
    GIT_AUTHOR_DATE: '2026-09-15T13:00:00-03:00',
    GIT_COMMITTER_DATE: '2026-09-15T13:00:00-03:00',
  });

  const semMerge = await scanner.scanRepo(repo, [], null);
  assert.ok(!semMerge.some((c) => c.msg === 'merge do ramo'));
  assert.equal(semMerge.length, 3);

  const comMerge = await scanner.scanRepo(repo, [], null, { countMerges: true });
  assert.ok(comMerge.some((c) => c.msg === 'merge do ramo'));
  assert.equal(comMerge.length, 4);
});

test('scanRepo enxerga commit em qualquer branch, não só na atual', async () => {
  const repo = initRepo(path.join(tmp, 'branches'));
  commit(repo, { msg: 'na main', iso: '2026-09-15T10:00:00-03:00' });
  git(repo, ['checkout', '--quiet', '-b', 'experimento']);
  commit(repo, { msg: 'no experimento', iso: '2026-09-16T10:00:00-03:00' });
  git(repo, ['checkout', '--quiet', 'main']);

  const commits = await scanner.scanRepo(repo, [], null);
  assert.deepEqual(
    commits.map((c) => c.msg).sort(),
    ['na main', 'no experimento'],
    'trabalho num branch não mergeado ainda é trabalho feito naquele dia'
  );
});

test('scanRepo devolve lista vazia pra pasta que não é repo', async () => {
  const naoRepo = path.join(tmp, 'sem-git');
  fs.mkdirSync(naoRepo, { recursive: true });
  assert.deepEqual(await scanner.scanRepo(naoRepo, [], null), []);
  assert.deepEqual(await scanner.scanRepo(path.join(tmp, 'inexistente'), [], null), []);
});

test('scanRepo devolve vazio quando o repo não tem commit nenhum', async () => {
  const vazio = initRepo(path.join(tmp, 'repo-vazio'));
  assert.deepEqual(await scanner.scanRepo(vazio, [], null), []);
});
