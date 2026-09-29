// Config + cache persistence. Two flat JSON files under userData:
//   config.json  — user-editable settings (roots, authors, schedule, rest days)
//   data.json    — scan cache (per-repo commits) + notification flags
//
// Kept deliberately dumb (read-modify-write, no migrations) — this is a
// single-user local app, not a database.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Só pela aritmética de data (ancorada no meio-dia UTC). O scanner não importa
// nada daqui, então não há ciclo — e duplicar a conta de datas seria pior.
const { addDays } = require('./scanner');

function paths(userDataDir) {
  return {
    config: path.join(userDataDir, 'config.json'),
    data: path.join(userDataDir, 'data.json'),
  };
}

function gitConfig(key) {
  try {
    const v = execFileSync('git', ['config', '--global', key], { encoding: 'utf8' }).trim();
    return v || null;
  } catch {
    return null;
  }
}

// `--author` matches a regex against "Name <email>", so seeding both the
// configured name AND email catches the common case where a commit's author
// email differs from the global config (e.g. GitHub's noreply address) but
// the display name is still the same person.
function detectAuthorSeeds() {
  return [gitConfig('user.name'), gitConfig('user.email')].filter(Boolean);
}

function defaultConfig() {
  return {
    roots: [path.join(os.homedir(), 'Documents', 'Github')],
    authors: detectAuthorSeeds(),
    ignoredDirRepos: [], // repo basenames toggled off by the user
    dayStartHour: 4, // commits before this hour count for the previous day
    restDays: [], // ['YYYY-MM-DD', ...] — don't break streak, don't notify
    // Dias de commit por semana. 0 = sem meta, e o app segue sendo só o streak
    // diário. Com meta batida, os lembretes do dia calam — é o ponto de ter meta.
    weeklyGoal: 0,
    // Janela do relatório semanal, em semanas. Escolhida na própria janela e
    // guardada aqui, como o tema — é preferência de leitura, não tuning.
    reportWeeks: 12,
    ignoredDirNames: ['node_modules', 'vendor', '.build', 'dist', 'build'],
    maxDepth: 3,
    countMerges: false,
    notifySchedule: [
      { time: '19:00', tone: 'normal' },
      { time: '21:30', tone: 'normal' },
      { time: '23:00', tone: 'urgent' },
    ],
    quietIconHour: '13:00', // from this hour: silent, no notification, icon unchanged
    lateIconHour: '21:00', // from this hour: icon switches to the "late" shape
    loginItem: true,
    theme: 'system', // 'system' | 'light' | 'dark' — manual toggle in the main window
  };
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function loadConfig(userDataDir) {
  const { config } = paths(userDataDir);
  const loaded = readJSON(config, null);
  if (!loaded) {
    const def = defaultConfig();
    writeJSON(config, def);
    return def;
  }
  // shallow-merge so new default keys show up after an upgrade
  return { ...defaultConfig(), ...loaded };
}

function saveConfig(userDataDir, cfg) {
  writeJSON(paths(userDataDir).config, cfg);
}

// Quantos dias de flag de notificação ficam guardados. O app só lê as de HOJE
// (`data.notifyFlags[today]`), então um dia bastaria; os 30 são pra dar pra
// olhar depois e responder "ele me avisou na terça?" — custa três booleanos por
// dia. O número é folgado de propósito, não afinado.
const NOTIFY_FLAGS_RETENTION_DAYS = 30;

const LOGICAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tira do `data.json` as flags de notificação fora da janela de retenção.
 *
 * Sem isso o arquivo ganha uma chave por dia **pra sempre**: cresce devagar e
 * ninguém nota, que é exatamente o formato do vazamento que o
 * `rate-limits.jsonl` do `claude-statusbar` tinha antes da poda de 30 dias.
 *
 * Chave que não é uma data 'YYYY-MM-DD' também sai: a leitura é sempre por dia
 * lógico, então nada com outro formato pode ser lido de volta — é peso morto
 * por construção, não dado de alguém.
 *
 * Só mexe em `notifyFlags`. O cache de commits já tem teto (os 13 meses do
 * `git log`), e `snoozeUntil` é um campo só.
 *
 * @returns {number} quantas entradas saíram — quem chamou decide se vale gravar.
 */
function pruneNotifyFlags(data, todayLogical, retentionDays = NOTIFY_FLAGS_RETENTION_DAYS) {
  const flags = data && data.notifyFlags;
  if (!flags || typeof flags !== 'object') return 0;

  const cutoff = addDays(todayLogical, -retentionDays);
  let removed = 0;
  for (const key of Object.keys(flags)) {
    if (!LOGICAL_DATE_RE.test(key) || key < cutoff) {
      delete flags[key];
      removed += 1;
    }
  }
  return removed;
}

function defaultData() {
  return {
    repos: {}, // repoPath -> { lastScan: iso, commits: [{hash, date, msg}] }
    notifyFlags: {}, // logicalDate -> { '19:00': true, ... }
    snoozeUntil: null, // iso timestamp
  };
}

function loadData(userDataDir) {
  const { data } = paths(userDataDir);
  const loaded = readJSON(data, null);
  return loaded ? { ...defaultData(), ...loaded } : defaultData();
}

function saveData(userDataDir, data) {
  writeJSON(paths(userDataDir).data, data);
}

module.exports = {
  loadConfig,
  saveConfig,
  loadData,
  saveData,
  defaultConfig,
  defaultData,
  pruneNotifyFlags,
  NOTIFY_FLAGS_RETENTION_DAYS,
};
