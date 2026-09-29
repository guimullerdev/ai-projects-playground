// Relatório semanal: uma linha por semana (segunda→domingo), mais recente
// primeiro, com o resumo em cima.
//
// O heatmap responde "que dia eu perdi". Esta tabela responde a outra pergunta,
// que é a que decide se o hábito pegou: "as minhas semanas estão melhorando ou
// piorando?". Por isso o resumo lidera com a média e a tendência, e a tabela
// vem depois como o detalhe de onde os números saíram.
//
// Semana incompleta aparece marcada como "em andamento" e nunca como meta
// perdida — ver scanner.computeWeeklyReport.

const PLURAL = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Número com vírgula decimal, e sem o ",0" pendurado quando é redondo. */
function fmtNum(n) {
  return String(Number.isInteger(n) ? n : n.toFixed(1)).replace('.', ',');
}

/** "22–28/set" quando a semana não cruza mês, "29/set – 5/out" quando cruza. */
function formatWeekLabel(start, end) {
  const [, sm, sd] = start.split('-');
  const [, em, ed] = end.split('-');
  const month = (m) => window.Heatmap.MONTH_ABBR[Number(m) - 1];
  return sm === em
    ? `${Number(sd)}–${Number(ed)}/${month(sm)}`
    : `${Number(sd)}/${month(sm)} – ${Number(ed)}/${month(em)}`;
}

function summaryText(report) {
  const s = report.summary;
  if (!s.completeWeeks) {
    return 'Nenhuma semana fechada no período ainda — o resumo aparece quando a primeira fechar.';
  }

  const parts = [
    `Média de ${fmtNum(s.avgDays)} ${s.avgDays === 1 ? 'dia' : 'dias'} com commit por semana, em ${PLURAL(s.completeWeeks, 'semana fechada', 'semanas fechadas')}`,
  ];
  if (report.goal) {
    parts.push(`meta de ${report.goal} batida em ${s.metCount} de ${s.completeWeeks}`);
  }
  if (s.best) {
    parts.push(
      `melhor semana: ${formatWeekLabel(s.best.start, s.best.end)}, com ${PLURAL(s.best.daysWithCommit, 'dia', 'dias')}`
    );
  }
  return `${parts.join(' · ')}.`;
}

function trendText(trend) {
  if (!trend) return null;
  const head = {
    up: 'Em alta',
    down: 'Em queda',
    flat: 'Estável',
  }[trend.direction];
  const delta = trend.delta > 0 ? `+${fmtNum(trend.delta)}` : fmtNum(trend.delta);
  return `${head}: ${fmtNum(trend.recent)} dias/semana nas últimas 4 semanas fechadas, contra ${fmtNum(trend.previous)} nas 4 anteriores (${delta}).`;
}

function renderWeeklyReport(report, { summaryEl, trendEl, tbodyEl, goalHeaderEl }) {
  summaryEl.textContent = summaryText(report);

  const trend = trendText(report.summary.trend);
  trendEl.hidden = !trend;
  trendEl.textContent = trend || '';
  trendEl.className = `report-trend${trend ? ` is-${report.summary.trend.direction}` : ''}`;

  // A coluna de meta só existe quando há meta — sem ela seria uma coluna de
  // travessões, igual ao tile de meta que some da linha de KPIs.
  goalHeaderEl.hidden = !report.goal;

  tbodyEl.innerHTML = '';
  if (!report.weeks.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = report.goal ? 5 : 4;
    td.className = 'empty';
    td.textContent = 'Sem semanas no período conhecido.';
    tr.appendChild(td);
    tbodyEl.appendChild(tr);
    return;
  }

  for (const week of report.weeks) {
    const tr = document.createElement('tr');
    if (week.isCurrent) tr.className = 'week-current';

    const label = formatWeekLabel(week.start, week.end);
    const tag = week.isCurrent
      ? '<span class="week-tag">em andamento</span>'
      : week.isPartial
        ? '<span class="week-tag">semana parcial</span>'
        : '';

    // "3 de 6" e não "3/7": dia de folga não é oportunidade perdida, então sai
    // do denominador — a mesma conta da meta semanal.
    const days = `${week.daysWithCommit} <span class="cell-sub">de ${week.opportunities}</span>`;
    const repos = week.repos.length
      ? week.repos
          .slice(0, 3)
          .map((r) => `${r.repo} (${r.count})`)
          .join(', ') + (week.repos.length > 3 ? `, +${week.repos.length - 3}` : '')
      : '—';

    tr.innerHTML = `
      <td>${label}${tag}</td>
      <td>${days}</td>
      <td>${week.commits}</td>
      <td class="cell-repos">${repos}</td>
    `;

    if (report.goal) {
      const td = document.createElement('td');
      if (week.isPartial) {
        td.innerHTML = `<span class="goal-badge pending">${week.daysWithCommit}/${report.goal}</span>`;
      } else {
        // ícone + rótulo, nunca a cor sozinha — regra do plano
        td.innerHTML = week.met
          ? `<span class="goal-badge met">✓ bateu</span>`
          : `<span class="goal-badge missed">✕ faltou ${report.goal - week.daysWithCommit}</span>`;
      }
      tr.appendChild(td);
    }

    tbodyEl.appendChild(tr);
  }
}

window.Report = { renderWeeklyReport, formatWeekLabel };
