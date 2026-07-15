const heroIcon = document.getElementById('hero-icon');
const heroLabel = document.getElementById('hero-label');
const heroSub = document.getElementById('hero-sub');
const statStreak = document.getElementById('stat-streak');
const statLongest = document.getElementById('stat-longest');
const commitList = document.getElementById('commit-list');
const btnSnooze = document.getElementById('btn-snooze');
const btnRescan = document.getElementById('btn-rescan');
const btnOpenMain = document.getElementById('btn-open-main');

const ICONS = { done: '●', rest: '◆', ok: '○', late: '⊙' };
const LABELS = {
  done: 'Commitei hoje',
  rest: 'Dia de folga',
  ok: 'Ainda não commitei',
  late: 'Ainda não commitei — está ficando tarde',
};

function render(state) {
  heroIcon.textContent = ICONS[state.iconState] || '○';
  heroIcon.className = `hero-icon ${state.iconState}`;
  heroLabel.textContent = LABELS[state.iconState] || '—';
  heroSub.textContent = state.today;

  statStreak.textContent = state.streak;
  statLongest.textContent = state.longestStreak;

  commitList.innerHTML = '';
  if (!state.todayCommits.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nenhum commit ainda.';
    commitList.appendChild(li);
  } else {
    for (const c of state.todayCommits) {
      const li = document.createElement('li');
      li.className = 'commit-item';
      li.innerHTML = `<div class="commit-repo">${c.repo}</div><div class="commit-msg">${c.msg}</div>`;
      commitList.appendChild(li);
    }
  }

  btnSnooze.style.display = state.committedToday || state.isRestDay ? 'none' : '';
}

window.commitStreak.getState().then(render);
window.commitStreak.onStateUpdate(render);

btnSnooze.addEventListener('click', () => window.commitStreak.snooze().then(render));
btnOpenMain.addEventListener('click', () => window.commitStreak.openMainWindow());
btnRescan.addEventListener('click', () => {
  btnRescan.textContent = 'Rescaneando…';
  window.commitStreak.rescan().then((state) => {
    btnRescan.textContent = 'Rescan';
    render(state);
  });
});
