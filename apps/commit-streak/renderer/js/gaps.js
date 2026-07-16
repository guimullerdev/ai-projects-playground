// Gaps panel (empty-day runs, most recent first) and the repo table.
// See plan.md § Painel de lacunas — two honest outcomes per gap: the work
// existed and never got committed (go commit/push it, "abrir no editor"),
// or it really was a day off ("marcar como folga"). No third button that
// fakes GIT_AUTHOR_DATE to paint the day green.

function formatGapRange(gap) {
  const fmt = (iso) => window.Heatmap.formatDatePt(iso);
  return gap.start === gap.end ? fmt(gap.start) : `${fmt(gap.start)} a ${fmt(gap.end)}`;
}

function renderGaps(gaps, listEl, { onMarkRest, onOpenEditor }) {
  listEl.innerHTML = '';
  if (!gaps.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nenhuma lacuna — sem dias vazios no período conhecido.';
    listEl.appendChild(li);
    return;
  }

  for (const gap of gaps) {
    const li = document.createElement('li');
    li.className = 'gap-item';

    const header = document.createElement('div');
    header.className = 'gap-header';
    header.innerHTML = `<span class="gap-days">${gap.days} dia${gap.days === 1 ? '' : 's'}</span> — ${formatGapRange(gap)}`;
    li.appendChild(header);

    if (gap.hints && gap.hints.length) {
      const hintList = document.createElement('ul');
      hintList.className = 'hint-list';
      for (const hint of gap.hints) {
        const hintLi = document.createElement('li');
        hintLi.className = 'hint-item';
        hintLi.innerHTML = `<strong>${hint.repo}</strong> ${hint.lines.join(', ')}`;
        const openBtn = document.createElement('button');
        openBtn.textContent = 'Abrir no editor';
        openBtn.addEventListener('click', () => onOpenEditor(hint.repoPath));
        hintLi.appendChild(openBtn);
        hintList.appendChild(hintLi);
      }
      li.appendChild(hintList);
    }

    const actions = document.createElement('div');
    actions.className = 'gap-actions';
    const restBtn = document.createElement('button');
    restBtn.textContent = 'Marcar como folga';
    restBtn.addEventListener('click', () => onMarkRest(gap));
    actions.appendChild(restBtn);
    li.appendChild(actions);

    listEl.appendChild(li);
  }
}

function renderRepos(repos, tbodyEl, { onToggle }) {
  tbodyEl.innerHTML = '';
  for (const r of repos) {
    const tr = document.createElement('tr');
    const lastCommit = r.lastDate ? window.Heatmap.formatDatePt(r.lastDate) : '—';
    tr.innerHTML = `
      <td>${r.repo}</td>
      <td>${r.commits}</td>
      <td>${lastCommit}</td>
      <td></td>
    `;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = r.enabled;
    checkbox.addEventListener('change', () => onToggle(r.repo, checkbox.checked));
    tr.lastElementChild.appendChild(checkbox);
    tbodyEl.appendChild(tr);
  }
}

window.Gaps = { renderGaps, renderRepos };
