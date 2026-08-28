import {
  computeSchedule,
  computeResumo,
  computeEconomia,
  formatDate,
  addMonths,
  addDays,
  estimatePrazoParaParcelaMaxima,
  estimateExtraParaPrazoDesejado,
  computeImpactoSimulado,
  computeValorLiquidoAmortizado,
  computeJurosCorridos,
} from './calc.js';
import {
  getAllFinancings,
  getFinancing,
  saveFinancing,
  deleteFinancing,
  duplicateFinancing,
  exportAllAsJSON,
  importFromJSON,
  getThemePreference,
  setThemePreference,
  generateId,
} from './storage.js';
import { drawSaldoChart, drawComposicaoChart } from './charts.js';

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function formatBRL(value) {
  return currencyFormatter.format(value || 0);
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ---------------------------------------------------------------------
// Máscaras de moeda (R$) e percentual. Ambas seguem o padrão "digitação
// por centavos": o usuário digita apenas números e o valor é formatado
// progressivamente, evitando problemas de parsing de "1.234,56".
// ---------------------------------------------------------------------

function attachCurrencyMask(input) {
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '');
    if (!digits) {
      input.value = '';
      return;
    }
    const value = parseInt(digits, 10) / 100;
    input.value = formatBRL(value);
  });
}

function getCurrencyValue(input) {
  const digits = input.value.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) / 100 : 0;
}

function setCurrencyValue(input, value) {
  input.value = value ? formatBRL(value) : '';
}

function attachPercentMask(input) {
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '');
    if (!digits) {
      input.value = '';
      return;
    }
    const value = parseInt(digits, 10) / 100;
    input.value = `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  });
}

function getPercentValue(input) {
  const digits = input.value.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) / 100 : 0;
}

function setPercentValue(input, value) {
  input.value = value
    ? `${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
    : '';
}

// ---------------------------------------------------------------------
// Estado da sessão de UI
// ---------------------------------------------------------------------

let currentFinancingId = null;
let currentFinancing = null;
let currentRows = null;

// ---------------------------------------------------------------------
// Navegação entre telas
// ---------------------------------------------------------------------

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('view--active'));
  document.getElementById(id).classList.add('view--active');
}

function showToast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

function confirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-dialog');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    document.getElementById('confirm-message').textContent = message;
    overlay.hidden = false;

    const cleanup = (result) => {
      overlay.hidden = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ---------------------------------------------------------------------
// Tela: lista de financiamentos
// ---------------------------------------------------------------------

async function renderList() {
  const all = await getAllFinancings();
  const grid = document.getElementById('financings-grid');
  const empty = document.getElementById('list-empty-state');
  grid.innerHTML = '';

  if (!all.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const fin of all) {
    const { rows } = computeSchedule(fin);
    const resumo = computeResumo(fin, rows);
    const pct = resumo.totalParcelas ? Math.round((resumo.parcelasPagasCount / resumo.totalParcelas) * 100) : 0;

    const card = document.createElement('div');
    card.className = 'financing-card';
    card.innerHTML = `
      <div class="financing-card__top">
        <div>
          <div class="financing-card__name">${escapeHTML(fin.nome)}</div>
          <div class="financing-card__meta">${formatDate(fin.dataPrimeiraParcela)} · ${resumo.totalParcelas} parcelas</div>
        </div>
        <span class="badge">${fin.tipo}</span>
      </div>
      <div class="financing-card__value">${formatBRL(fin.valorFinanciado)}</div>
      <div class="progress-bar"><div class="progress-bar__fill" style="width:${pct}%"></div></div>
      <div class="financing-card__meta">${resumo.parcelasPagasCount}/${resumo.totalParcelas} parcelas pagas (${pct}%)</div>
      <div class="financing-card__actions">
        <button class="btn btn--ghost btn--small" data-action="duplicate" data-id="${fin.id}">Duplicar</button>
        <button class="btn btn--ghost btn--small" data-action="delete" data-id="${fin.id}">Excluir</button>
      </div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      openDashboard(fin.id);
    });
    grid.appendChild(card);
  }
}

async function handleListGridClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  e.stopPropagation();
  const id = btn.dataset.id;

  if (btn.dataset.action === 'duplicate') {
    await duplicateFinancing(id);
    showToast('Financiamento duplicado.');
    await renderList();
  } else if (btn.dataset.action === 'delete') {
    const ok = await confirmDialog('Excluir este financiamento? Essa ação não pode ser desfeita.');
    if (!ok) return;
    await deleteFinancing(id);
    showToast('Financiamento excluído.');
    await renderList();
  }
}

// ---------------------------------------------------------------------
// Tela: formulário de novo/editar financiamento
// ---------------------------------------------------------------------

function clearFormErrors() {
  document.querySelectorAll('.field-error').forEach((e) => (e.textContent = ''));
  document.querySelectorAll('.field input').forEach((i) => i.classList.remove('is-invalid'));
}

function setFieldError(id, message) {
  const errorEl = document.querySelector(`[data-error-for="${id}"]`);
  if (errorEl) errorEl.textContent = message;
  const input = document.getElementById(id);
  if (input) input.classList.add('is-invalid');
}

function openNewFinancingForm() {
  document.getElementById('form-title').textContent = 'Novo financiamento';
  document.getElementById('financing-form').reset();
  document.getElementById('f-id').value = '';
  document.getElementById('f-tipo').value = 'SAC';
  document.getElementById('f-data-primeira').value = new Date().toISOString().slice(0, 10);
  clearFormErrors();
  showView('view-form');
}

async function openEditFinancingForm(id) {
  const fin = await getFinancing(id);
  if (!fin) return;
  document.getElementById('form-title').textContent = 'Editar financiamento';
  document.getElementById('f-id').value = fin.id;
  document.getElementById('f-nome').value = fin.nome;
  setCurrencyValue(document.getElementById('f-valor-bem'), fin.valorBem);
  setCurrencyValue(document.getElementById('f-entrada'), fin.valorEntrada);
  setCurrencyValue(document.getElementById('f-valor-financiado'), fin.valorFinanciado);
  setPercentValue(document.getElementById('f-cet'), fin.cetAnual);
  document.getElementById('f-prazo').value = fin.prazoMeses;
  document.getElementById('f-tipo').value = fin.tipo;
  document.getElementById('f-data-primeira').value = fin.dataPrimeiraParcela;
  setCurrencyValue(document.getElementById('f-encargos'), fin.encargosMensais || 0);
  setCurrencyValue(document.getElementById('f-juros-carencia'), fin.jurosCarencia || 0);
  document.getElementById('f-pro-rata').checked = !!fin.descontaJurosProRata;
  clearFormErrors();
  showView('view-form');
}

async function handleFinancingFormSubmit(e) {
  e.preventDefault();
  clearFormErrors();

  const nome = document.getElementById('f-nome').value.trim();
  const valorBem = getCurrencyValue(document.getElementById('f-valor-bem'));
  const valorEntrada = getCurrencyValue(document.getElementById('f-entrada'));
  const valorFinanciado = getCurrencyValue(document.getElementById('f-valor-financiado'));
  const cetAnual = getPercentValue(document.getElementById('f-cet'));
  const prazoMeses = parseInt(document.getElementById('f-prazo').value, 10);
  const tipo = document.getElementById('f-tipo').value;
  const dataPrimeiraParcela = document.getElementById('f-data-primeira').value;
  const encargosMensais = getCurrencyValue(document.getElementById('f-encargos'));
  const jurosCarencia = getCurrencyValue(document.getElementById('f-juros-carencia'));
  const descontaJurosProRata = document.getElementById('f-pro-rata').checked;

  let hasError = false;
  if (!nome) {
    setFieldError('f-nome', 'Informe um nome.');
    hasError = true;
  }
  if (!(valorFinanciado > 0)) {
    setFieldError('f-valor-financiado', 'Informe um valor financiado maior que zero.');
    hasError = true;
  }
  if (!(cetAnual > 0)) {
    setFieldError('f-cet', 'Informe uma taxa maior que zero.');
    hasError = true;
  }
  if (!(prazoMeses >= 1)) {
    setFieldError('f-prazo', 'Prazo mínimo de 1 mês.');
    hasError = true;
  }
  if (!dataPrimeiraParcela) {
    setFieldError('f-data-primeira', 'Informe a data da 1ª parcela.');
    hasError = true;
  }
  if (valorBem > 0 && valorEntrada > valorBem) {
    setFieldError('f-entrada', 'Entrada não pode ser maior que o valor do bem.');
    hasError = true;
  }
  if (hasError) return;

  const id = document.getElementById('f-id').value || undefined;
  const existing = id ? await getFinancing(id) : null;

  const financing = {
    id,
    nome,
    valorBem,
    valorEntrada,
    valorFinanciado,
    cetAnual,
    prazoMeses,
    tipo,
    dataPrimeiraParcela,
    encargosMensais,
    jurosCarencia,
    descontaJurosProRata,
    amortizacoesExtras: existing?.amortizacoesExtras || [],
    parcelasPagas: existing?.parcelasPagas || {},
    createdAt: existing?.createdAt,
  };

  const saved = await saveFinancing(financing);
  showToast('Financiamento salvo.');
  await renderList();
  openDashboard(saved.id);
}

function handleValorFinanciadoAutoCalc() {
  const bem = getCurrencyValue(document.getElementById('f-valor-bem'));
  const entrada = getCurrencyValue(document.getElementById('f-entrada'));
  if (bem > 0) {
    setCurrencyValue(document.getElementById('f-valor-financiado'), Math.max(0, bem - entrada));
  }
}

// ---------------------------------------------------------------------
// Tela: dashboard do financiamento
// ---------------------------------------------------------------------

async function openDashboard(id) {
  currentFinancingId = id;
  await renderDashboard();
  showView('view-dashboard');
  setActiveTab('resumo');
}

async function renderDashboard() {
  const fin = await getFinancing(currentFinancingId);
  if (!fin) {
    await renderList();
    showView('view-list');
    return;
  }
  currentFinancing = fin;
  document.getElementById('dash-title').textContent = fin.nome;

  const { rows } = computeSchedule(fin);
  currentRows = rows;
  const resumo = computeResumo(fin, rows);
  const economia = computeEconomia(fin);

  renderSummary(resumo, economia);
  renderInstallmentsTable(fin, rows);
  renderExtrasList(fin);
  renderComparador(fin);
  renderPrevisaoDiaInfo(fin);
  setupExtraDateInput(rows, fin);
  document.getElementById('prev-meta-resultado').hidden = true;
  document.getElementById('prev-aporte-resultado').hidden = true;
  document.getElementById('prev-fases-list').innerHTML = '';

  const activePanel = document.querySelector('.tab-panel--active')?.dataset.panel;
  if (activePanel === 'graficos') renderCharts(fin, rows);
}

function renderSummary(resumo, economia) {
  const tiles = [
    { label: 'Saldo devedor atual', value: formatBRL(resumo.saldoDevedorAtual) },
    { label: 'Total já pago', value: formatBRL(resumo.totalPago), cls: 'accent' },
    { label: 'Total de juros pago', value: formatBRL(resumo.totalJurosPago), cls: 'warn' },
    { label: 'Total amortizado extra', value: formatBRL(resumo.totalAmortExtra) },
    { label: 'Parcelas pagas / restantes', value: `${resumo.parcelasPagasCount} / ${resumo.parcelasRestantes}` },
    { label: 'Data prevista de quitação', value: formatDate(resumo.dataPrevistaQuitacao) },
  ];
  if (economia.mesesEconomizados > 0 || economia.jurosEconomizados > 0) {
    tiles.push({
      label: 'Tempo economizado',
      value: `${economia.mesesEconomizados} meses`,
      cls: 'accent',
      sub: `Prazo original: ${economia.prazoOriginal} meses`,
    });
    tiles.push({ label: 'Juros economizados', value: formatBRL(economia.jurosEconomizados), cls: 'accent' });
  }

  document.getElementById('summary-grid').innerHTML = tiles
    .map(
      (t) => `
    <div class="summary-tile">
      <div class="summary-tile__label">${t.label}</div>
      <div class="summary-tile__value ${t.cls ? `summary-tile__value--${t.cls}` : ''}">${t.value}</div>
      ${t.sub ? `<div class="summary-tile__sub">${t.sub}</div>` : ''}
    </div>`
    )
    .join('');

  const pct = resumo.totalParcelas ? Math.round((resumo.parcelasPagasCount / resumo.totalParcelas) * 100) : 0;
  document.getElementById('progress-label').textContent = `${resumo.parcelasPagasCount} / ${resumo.totalParcelas} parcelas`;
  document.getElementById('progress-fill').style.width = `${pct}%`;
}

function renderInstallmentsTable(fin, rows) {
  const tbody = document.getElementById('installments-tbody');
  tbody.innerHTML = rows
    .map((r) => {
      const paid = !!fin.parcelasPagas[r.numero];
      return `
      <tr class="${paid ? 'is-paid' : ''} ${r.extraAplicada ? 'has-extra' : ''}">
        <td>${r.numero}</td>
        <td>${formatDate(r.data)}</td>
        <td>${formatBRL(r.saldoInicial)}</td>
        <td>${formatBRL(r.amortizacao)}</td>
        <td>${formatBRL(r.juros)}</td>
        <td>${formatBRL(r.parcela)}${
        r.extraAplicada ? `<div class="extra-tag">+ ${formatBRL(r.extraAplicada.valor)} extra</div>` : ''
      }</td>
        <td>${formatBRL(r.saldoFinal)}</td>
        <td><button class="row-status-btn ${paid ? 'is-paid' : ''}" data-toggle-paid="${r.numero}">${
        paid ? 'Paga' : 'Pendente'
      }</button></td>
      </tr>`;
    })
    .join('');
}

async function handleToggleInstallmentPaid(e) {
  const btn = e.target.closest('[data-toggle-paid]');
  if (!btn) return;
  const num = parseInt(btn.dataset.togglePaid, 10);
  const fin = await getFinancing(currentFinancingId);
  fin.parcelasPagas = fin.parcelasPagas || {};
  if (fin.parcelasPagas[num]) delete fin.parcelasPagas[num];
  else fin.parcelasPagas[num] = true;
  await saveFinancing(fin);
  await renderDashboard();
}

function renderExtrasList(fin) {
  const list = document.getElementById('extras-list');
  const empty = document.getElementById('extras-empty');
  const extras = [...(fin.amortizacoesExtras || [])].sort((a, b) => a.parcelaReferencia - b.parcelaReferencia);

  if (!extras.length) {
    empty.hidden = false;
    list.innerHTML = '';
    return;
  }
  empty.hidden = true;
  list.innerHTML = extras
    .map((ex) => {
      const dataLabel = ex.dataReferencia ? formatDate(ex.dataReferencia) : `parcela nº ${ex.parcelaReferencia}`;
      const proRataInfo =
        ex.jurosProRata > 0 ? ` · pago ${formatBRL(ex.valorPago)}, ${formatBRL(ex.jurosProRata)} foram juros pro-rata` : '';
      return `
    <li class="extra-item">
      <div class="extra-item__info">
        <strong>${formatBRL(ex.valor)}</strong> amortizados
        <div>Aplicada em ${dataLabel} (parcela nº ${ex.parcelaReferencia}) · ${ex.modo === 'prazo' ? 'Reduzir prazo' : 'Reduzir parcela'}${proRataInfo}</div>
      </div>
      <button class="btn btn--ghost btn--small" data-remove-extra="${ex.id}">Remover</button>
    </li>`;
    })
    .join('');
}

// Associa a data informada pelo usuário à parcela agendada mais próxima —
// a maioria dos bancos mostra extratos por data, não por número de parcela.
function findNearestRow(rows, dateStr) {
  if (!rows || !rows.length || !dateStr) return null;
  const target = new Date(dateStr).getTime();
  let best = rows[0];
  let bestDiff = Math.abs(new Date(rows[0].data).getTime() - target);
  for (const row of rows) {
    const diff = Math.abs(new Date(row.data).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = row;
    }
  }
  return best;
}

function setupExtraDateInput(rows, fin) {
  const dataInput = document.getElementById('ex-data');
  const prevDataInput = document.getElementById('prev-data');
  if (rows.length) {
    dataInput.min = rows[0].data;
    dataInput.max = rows[rows.length - 1].data;
    prevDataInput.min = rows[0].data;
    prevDataInput.max = rows[rows.length - 1].data;
    // Pré-preenche com a próxima parcela em aberto: cobre de cara o caso
    // "sobrou uma grana esse mês", sem o usuário precisar escolher uma data.
    if (!prevDataInput.value) {
      const proxima = proximaParcelaNaoPaga(fin, rows);
      if (proxima) prevDataInput.value = proxima.data;
    }
  }
  updateExtraParcelaHint();
}

function updateExtraParcelaHint() {
  const hint = document.getElementById('ex-parcela-hint');
  const dateVal = document.getElementById('ex-data').value;
  if (!dateVal || !currentRows) {
    hint.textContent = '';
    return;
  }
  const row = findNearestRow(currentRows, dateVal);
  if (!row) {
    hint.textContent = '';
    return;
  }

  let texto = `Corresponde à parcela nº ${row.numero} (${formatDate(row.data)}).`;
  const valor = getCurrencyValue(document.getElementById('ex-valor'));
  if (currentFinancing?.descontaJurosProRata && valor > 0) {
    const { valorLiquido, jurosProRata, dias } = computeValorLiquidoAmortizado(currentFinancing, row, dateVal, valor);
    texto +=
      jurosProRata > 0
        ? ` Com juros pro-rata de ${dias} dia(s): ${formatBRL(valorLiquido)} realmente amortiza (${formatBRL(jurosProRata)} vira juros corridos).`
        : '';
  }
  hint.textContent = texto;
}

// ---------------------------------------------------------------------
// Tab: Previsão — melhor dia para amortizar, meta de prazo e simulação
// de aportes futuros.
// ---------------------------------------------------------------------

function renderPrevisaoDiaInfo(fin) {
  const el = document.getElementById('previsao-dia-info');
  if (!fin.dataPrimeiraParcela) {
    el.textContent = '';
    return;
  }
  const dia = parseInt(fin.dataPrimeiraParcela.split('-')[2], 10);
  const diaIdeal = dia < 28 ? dia + 1 : null;
  el.innerHTML =
    `Seu boleto vence todo dia <strong>${dia}</strong> (mesmo dia da 1ª parcela, repetido nas demais). ` +
    (diaIdeal
      ? `Para maximizar a economia de juros, prefira pagar amortizações extras no dia <strong>${diaIdeal}</strong> — logo após o vencimento, assim o saldo reduzido passa a valer desde o início do próximo ciclo completo, em vez de perder alguns dias com o saldo ainda alto.`
      : `Prefira pagar amortizações extras no dia seguinte ao vencimento do boleto (fique de olho no calendário nesse mês, já que o vencimento é perto do fim do mês) — assim o saldo reduzido passa a valer desde o início do próximo ciclo completo.`) +
    (fin.descontaJurosProRata
      ? ' Como seu banco desconta juros pro-rata, pagar no dia certo também reduz o quanto do seu pagamento é "comido" pelos juros corridos.'
      : '');
}

function proximaParcelaNaoPaga(fin, rows) {
  return rows.find((r) => !fin.parcelasPagas[r.numero]) || rows[rows.length - 1];
}

// Aplica (salva de verdade) uma ou mais amortizações extras já simuladas.
async function aplicarAmortizacoes(extrasParaSalvar) {
  const fin = await getFinancing(currentFinancingId);
  fin.amortizacoesExtras = fin.amortizacoesExtras || [];
  const criadoEm = new Date().toISOString();
  for (const extra of extrasParaSalvar) {
    fin.amortizacoesExtras.push({
      id: generateId(),
      valor: extra.valor,
      valorPago: extra.valorPago ?? extra.valor,
      jurosProRata: extra.jurosProRata || 0,
      parcelaReferencia: extra.parcelaReferencia,
      dataReferencia: extra.dataReferencia,
      modo: extra.modo,
      criadoEm,
    });
  }
  await saveFinancing(fin);
  showToast(
    extrasParaSalvar.length > 1
      ? `${extrasParaSalvar.length} amortizações extras aplicadas.`
      : `Amortização de ${formatBRL(extrasParaSalvar[0].valor)} aplicada na parcela nº ${extrasParaSalvar[0].parcelaReferencia}.`
  );
  await renderDashboard();
  setActiveTab('extras');
}

function handleCalcularMeta() {
  const mesesDesejados = parseInt(document.getElementById('prev-meses-desejados').value, 10);
  const resultEl = document.getElementById('prev-meta-resultado');
  if (!(mesesDesejados >= 1) || !currentFinancing || !currentRows) {
    resultEl.hidden = true;
    return;
  }

  const refRow = proximaParcelaNaoPaga(currentFinancing, currentRows);
  const estimativa = refRow ? estimateExtraParaPrazoDesejado(currentFinancing, refRow.numero, mesesDesejados) : null;
  if (!refRow || !estimativa) {
    resultEl.hidden = true;
    return;
  }

  if (estimativa.valor <= 0) {
    resultEl.innerHTML = `
      <div class="prev-result__value">Nenhuma amortização extra necessária 🎉</div>
      <p class="panel-description">No ritmo atual, seu financiamento já termina em até ${mesesDesejados} meses.</p>`;
  } else {
    const valorLiquido = estimativa.valor;
    // O valor líquido necessário é fixo; se o banco desconta juros
    // pro-rata, o valor a PAGAR precisa ser um pouco maior para compensar
    // — assumindo o dia ideal de pagamento (logo após o vencimento).
    let valorAPagar = valorLiquido;
    let dataPagamentoAssumida = refRow.data;
    let proRataLinha = '';
    if (currentFinancing.descontaJurosProRata) {
      dataPagamentoAssumida = addDays(refRow.data, 1);
      const { juros: jurosProRata } = computeJurosCorridos(currentFinancing, refRow, dataPagamentoAssumida);
      valorAPagar = valorLiquido + jurosProRata;
      proRataLinha = `<div class="compare-row"><span>Já soma o juros pro-rata (pagando dia ${dataPagamentoAssumida.split('-')[2]})</span><span>+ ${formatBRL(jurosProRata)}</span></div>`;
    }
    resultEl.innerHTML = `
      <div class="prev-result__value">${formatBRL(valorAPagar)}</div>
      ${proRataLinha}
      <div class="compare-row"><span>Amortização única, a partir da parcela</span><span>nº ${refRow.numero} (${formatDate(refRow.data)})</span></div>
      <div class="compare-row"><span>Quitação estimada</span><span>${mesesDesejados} meses depois</span></div>
      <div class="form-actions form-actions--start">
        <button id="btn-aplicar-meta" class="btn btn--primary btn--small" type="button">Aplicar esta amortização</button>
      </div>`;
    document.getElementById('btn-aplicar-meta').addEventListener('click', () =>
      aplicarAmortizacoes([
        {
          valor: valorLiquido,
          valorPago: valorAPagar,
          jurosProRata: valorAPagar - valorLiquido,
          parcelaReferencia: refRow.numero,
          dataReferencia: refRow.data,
          modo: 'prazo',
        },
      ])
    );
  }
  resultEl.hidden = false;
}

function updatePrevQuandoVisibility() {
  const quando = document.querySelector('input[name="prev-quando"]:checked')?.value || 'data';
  document.getElementById('prev-unico-field').hidden = quando !== 'data';
  document.getElementById('prev-recorrente-field').hidden = quando !== 'recorrente';
}

// --- Plano recorrente: várias "fases" (valor mensal + duração em meses),
// aplicadas em sequência a partir da próxima parcela em aberto. Ex: R$2.000
// por 4 meses, depois R$3.000 por mais 4 meses.

function createFaseRow() {
  const row = document.createElement('div');
  row.className = 'fase-row';
  row.innerHTML = `
    <input type="text" inputmode="decimal" class="fase-valor" placeholder="R$ 0,00" />
    <span class="fase-row__label">por</span>
    <input type="number" min="1" class="fase-meses" placeholder="meses" />
    <span class="fase-row__label">meses</span>
    <button type="button" class="fase-remove" aria-label="Remover fase">✕</button>
  `;
  const valorInput = row.querySelector('.fase-valor');
  attachCurrencyMask(valorInput);
  const debouncedSimular = debounce(handleSimularAporte, 250);
  valorInput.addEventListener('input', debouncedSimular);
  row.querySelector('.fase-meses').addEventListener('input', debouncedSimular);
  row.querySelector('.fase-remove').addEventListener('click', () => {
    row.remove();
    handleSimularAporte();
  });
  return row;
}

function addFaseRow() {
  document.getElementById('prev-fases-list').appendChild(createFaseRow());
}

// Lê as fases preenchidas no formulário e gera uma amortização extra
// hipotética por mês de cada fase, avançando a partir da próxima parcela
// em aberto. Fases incompletas (linha nova ainda vazia) são ignoradas.
function buildExtrasFromFases(modo) {
  if (!currentFinancing || !currentRows) return [];
  const proxima = proximaParcelaNaoPaga(currentFinancing, currentRows);
  if (!proxima) return [];

  let idx = currentRows.findIndex((r) => r.numero === proxima.numero);
  const extras = [];

  const faseEls = document.querySelectorAll('#prev-fases-list .fase-row');
  for (const faseEl of faseEls) {
    const valor = getCurrencyValue(faseEl.querySelector('.fase-valor'));
    const meses = parseInt(faseEl.querySelector('.fase-meses').value, 10);
    if (!(valor > 0) || !(meses >= 1)) continue;

    for (let m = 0; m < meses; m++) {
      if (idx >= currentRows.length) break; // plano ultrapassa o prazo restante atual
      const row = currentRows[idx];
      let valorLiquido = valor;
      let jurosProRata = 0;
      if (currentFinancing.descontaJurosProRata) {
        const dataPagamento = addDays(row.data, 1); // assume o dia ideal de pagamento
        const resultado = computeValorLiquidoAmortizado(currentFinancing, row, dataPagamento, valor);
        valorLiquido = resultado.valorLiquido;
        jurosProRata = resultado.jurosProRata;
      }
      extras.push({
        valor: valorLiquido,
        valorPago: valor,
        jurosProRata,
        parcelaReferencia: row.numero,
        dataReferencia: row.data,
        modo,
      });
      idx++;
    }
  }
  return extras;
}

function handleSimularAporte() {
  const quando = document.querySelector('input[name="prev-quando"]:checked')?.value || 'data';
  if (quando === 'recorrente') handleSimularAporteRecorrente();
  else handleSimularAporteUnico();
}

function handleSimularAporteUnico() {
  const valorPago = getCurrencyValue(document.getElementById('prev-valor'));
  const dataVal = document.getElementById('prev-data').value;
  const modo = document.querySelector('input[name="prev-modo"]:checked').value;
  const resultEl = document.getElementById('prev-aporte-resultado');

  if (!(valorPago > 0) || !dataVal || !currentRows || !currentFinancing) {
    resultEl.hidden = true;
    return;
  }
  const row = findNearestRow(currentRows, dataVal);
  if (!row) {
    resultEl.hidden = true;
    return;
  }

  let valorLiquido = valorPago;
  let jurosProRata = 0;
  let diasProRata = 0;
  if (currentFinancing.descontaJurosProRata) {
    const resultado = computeValorLiquidoAmortizado(currentFinancing, row, dataVal, valorPago);
    valorLiquido = resultado.valorLiquido;
    jurosProRata = resultado.jurosProRata;
    diasProRata = resultado.dias;
    if (valorLiquido <= 0) {
      resultEl.innerHTML = `
        <div class="prev-result__value">Esse valor não seria suficiente</div>
        <p class="panel-description">Os juros pro-rata (${formatBRL(jurosProRata)}, ${diasProRata} dia(s) corridos) consumiriam todo o valor pago — nada sobraria para abater o saldo.</p>`;
      resultEl.hidden = false;
      return;
    }
  }

  const impacto = computeImpactoSimulado(currentFinancing, [
    { id: '__preview__', valor: valorLiquido, parcelaReferencia: row.numero, modo },
  ]);

  const headline =
    impacto.mesesEconomizados > 0
      ? `${impacto.mesesEconomizados} meses a menos e ${formatBRL(impacto.jurosEconomizados)} de juros economizados`
      : `${formatBRL(Math.max(0, impacto.jurosEconomizados))} de juros economizados`;

  const proRataLinhas =
    jurosProRata > 0
      ? `<div class="compare-row"><span>Juros pro-rata (${diasProRata} dia${diasProRata === 1 ? '' : 's'})</span><span>− ${formatBRL(jurosProRata)}</span></div>
         <div class="compare-row"><span>Valor que realmente amortiza</span><span>${formatBRL(valorLiquido)}</span></div>`
      : '';
  const parcelaLinha =
    modo === 'parcela' && impacto.parcelaDepois != null
      ? `<div class="compare-row"><span>Nova parcela</span><span>${formatBRL(impacto.parcelaDepois)} (era ${formatBRL(impacto.parcelaAntes)})</span></div>`
      : '';

  resultEl.innerHTML = `
    <div class="prev-result__value">${headline}</div>
    ${parcelaLinha}
    ${proRataLinhas}
    <div class="compare-row"><span>Aplicado na parcela</span><span>nº ${row.numero} (${formatDate(row.data)})</span></div>
    <div class="compare-row"><span>Novo prazo total</span><span>${impacto.prazoHipotetico} meses (era ${impacto.prazoAtual})</span></div>
    <div class="compare-row"><span>Nova data de quitação</span><span>${formatDate(impacto.dataQuitacaoHipotetica)}</span></div>
    <div class="form-actions form-actions--start">
      <button id="btn-aplicar-aporte" class="btn btn--primary btn--small" type="button">Aplicar essa amortização agora</button>
    </div>`;
  resultEl.hidden = false;
  document.getElementById('btn-aplicar-aporte').addEventListener('click', () =>
    aplicarAmortizacoes([
      { valor: valorLiquido, valorPago, jurosProRata, parcelaReferencia: row.numero, dataReferencia: row.data, modo },
    ])
  );
}

function handleSimularAporteRecorrente() {
  const modo = document.querySelector('input[name="prev-modo"]:checked').value;
  const resultEl = document.getElementById('prev-aporte-resultado');

  if (!currentFinancing || !currentRows) {
    resultEl.hidden = true;
    return;
  }
  const extras = buildExtrasFromFases(modo);
  if (!extras.length) {
    resultEl.hidden = true;
    return;
  }

  const impacto = computeImpactoSimulado(currentFinancing, extras);
  const totalPago = extras.reduce((s, e) => s + e.valorPago, 0);
  const totalLiquido = extras.reduce((s, e) => s + e.valor, 0);
  const totalJurosProRata = extras.reduce((s, e) => s + e.jurosProRata, 0);

  const headline =
    impacto.mesesEconomizados > 0
      ? `${impacto.mesesEconomizados} meses a menos e ${formatBRL(impacto.jurosEconomizados)} de juros economizados`
      : `${formatBRL(Math.max(0, impacto.jurosEconomizados))} de juros economizados`;

  const totalLinhas =
    totalJurosProRata > 0
      ? `<div class="compare-row"><span>Total pago no plano (${extras.length} parcelas)</span><span>${formatBRL(totalPago)}</span></div>
         <div class="compare-row"><span>Juros pro-rata total</span><span>− ${formatBRL(totalJurosProRata)}</span></div>
         <div class="compare-row"><span>Total que realmente amortiza</span><span>${formatBRL(totalLiquido)}</span></div>`
      : `<div class="compare-row"><span>Total do plano</span><span>${formatBRL(totalLiquido)} em ${extras.length} parcela(s)</span></div>`;
  const parcelaLinha =
    modo === 'parcela' && impacto.parcelaDepois != null
      ? `<div class="compare-row"><span>Parcela após o plano</span><span>${formatBRL(impacto.parcelaDepois)} (era ${formatBRL(impacto.parcelaAntes)})</span></div>`
      : '';

  resultEl.innerHTML = `
    <div class="prev-result__value">${headline}</div>
    ${parcelaLinha}
    ${totalLinhas}
    <div class="compare-row"><span>Novo prazo total</span><span>${impacto.prazoHipotetico} meses (era ${impacto.prazoAtual})</span></div>
    <div class="compare-row"><span>Nova data de quitação</span><span>${formatDate(impacto.dataQuitacaoHipotetica)}</span></div>
    <div class="form-actions form-actions--start">
      <button id="btn-aplicar-aporte" class="btn btn--primary btn--small" type="button">Aplicar esse plano agora</button>
    </div>`;
  resultEl.hidden = false;
  document.getElementById('btn-aplicar-aporte').addEventListener('click', () => aplicarAmortizacoes(extras));
}

async function handleRemoveExtra(e) {
  const btn = e.target.closest('[data-remove-extra]');
  if (!btn) return;
  const ok = await confirmDialog('Remover esta amortização extra? A tabela será recalculada a partir daquele ponto.');
  if (!ok) return;
  const fin = await getFinancing(currentFinancingId);
  fin.amortizacoesExtras = (fin.amortizacoesExtras || []).filter((ex) => ex.id !== btn.dataset.removeExtra);
  await saveFinancing(fin);
  showToast('Amortização removida.');
  await renderDashboard();
}

async function handleExtraFormSubmit(e) {
  e.preventDefault();
  document.querySelectorAll('#extra-form .field-error').forEach((el) => (el.textContent = ''));
  document.querySelectorAll('#extra-form input').forEach((el) => el.classList.remove('is-invalid'));

  const valor = getCurrencyValue(document.getElementById('ex-valor'));
  const dataVal = document.getElementById('ex-data').value;
  const modo = document.querySelector('input[name="ex-modo"]:checked').value;

  let hasError = false;
  if (!(valor > 0)) {
    setFieldError('ex-valor', 'Informe um valor maior que zero.');
    hasError = true;
  }
  if (!dataVal) {
    setFieldError('ex-data', 'Informe a data do pagamento extra.');
    hasError = true;
  }
  if (hasError) return;

  const row = findNearestRow(currentRows, dataVal);
  if (!row) {
    setFieldError('ex-data', 'Não foi possível associar essa data a uma parcela.');
    return;
  }

  let valorLiquido = valor;
  let jurosProRata = 0;
  if (currentFinancing.descontaJurosProRata) {
    const resultado = computeValorLiquidoAmortizado(currentFinancing, row, dataVal, valor);
    if (resultado.valorLiquido <= 0) {
      setFieldError(
        'ex-valor',
        `Esse valor não cobre nem os juros pro-rata (${formatBRL(resultado.jurosProRata)}, ${resultado.dias} dia(s) corridos) — nada seria amortizado.`
      );
      return;
    }
    valorLiquido = resultado.valorLiquido;
    jurosProRata = resultado.jurosProRata;
  }

  await aplicarAmortizacoes([
    { valor: valorLiquido, valorPago: valor, jurosProRata, parcelaReferencia: row.numero, dataReferencia: row.data, modo },
  ]);
  e.target.reset();
  document.querySelector('input[name="ex-modo"][value="prazo"]').checked = true;
  document.getElementById('ex-parcela-hint').textContent = '';
}

function renderCharts(fin, rows) {
  const hasExtras = (fin.amortizacoesExtras || []).length > 0;
  const baseline = hasExtras ? computeSchedule(fin, { includeExtras: false }).rows : null;
  const showBaseline = baseline && baseline.length !== rows.length;

  document.getElementById('legend-baseline').style.display = showBaseline ? 'inline-block' : 'none';
  document.getElementById('legend-baseline-label').style.display = showBaseline ? 'inline' : 'none';

  drawSaldoChart(document.getElementById('chart-saldo'), rows, showBaseline ? baseline : null);
  drawComposicaoChart(document.getElementById('chart-composicao'), rows);
}

function renderComparador(fin) {
  const base = { ...fin, amortizacoesExtras: [] };
  const sac = computeSchedule({ ...base, tipo: 'SAC' });
  const price = computeSchedule({ ...base, tipo: 'PRICE' });
  const sacJuros = sac.rows.reduce((s, r) => s + r.juros, 0);
  const priceJuros = price.rows.reduce((s, r) => s + r.juros, 0);
  const sacTotal = sac.rows.reduce((s, r) => s + r.parcela, 0);
  const priceTotal = price.rows.reduce((s, r) => s + r.parcela, 0);
  const winner = sacJuros <= priceJuros ? 'SAC' : 'PRICE';

  function card(title, data, totalJuros, totalPago, isWinner) {
    return `
      <div class="compare-card ${isWinner ? 'compare-card--winner' : ''}">
        <h3>${title} ${isWinner ? '🏆' : ''}</h3>
        <div class="compare-row"><span>1ª parcela</span><span>${formatBRL(data.rows[0].parcela)}</span></div>
        <div class="compare-row"><span>Última parcela</span><span>${formatBRL(data.rows[data.rows.length - 1].parcela)}</span></div>
        <div class="compare-row"><span>Total de juros</span><span>${formatBRL(totalJuros)}</span></div>
        <div class="compare-row"><span>Total pago</span><span>${formatBRL(totalPago)}</span></div>
        <div class="compare-row"><span>Prazo</span><span>${data.rows.length} meses</span></div>
      </div>`;
  }

  document.getElementById('compare-grid').innerHTML =
    card('SAC', sac, sacJuros, sacTotal, winner === 'SAC') + card('Price', price, priceJuros, priceTotal, winner === 'PRICE');
}

function handleReverseSim() {
  const parcelaMax = getCurrencyValue(document.getElementById('rev-parcela-maxima'));
  const resultEl = document.getElementById('rev-result');
  if (!currentFinancing || !(parcelaMax > 0)) {
    resultEl.textContent = 'Informe um valor de parcela.';
    return;
  }
  const prazo = estimatePrazoParaParcelaMaxima(currentFinancing.valorFinanciado, currentFinancing.cetAnual, parcelaMax);
  if (prazo == null) {
    resultEl.textContent = 'Essa parcela não cobre nem os juros do financiamento — aumente o valor.';
    return;
  }
  resultEl.textContent = `Prazo necessário: ${prazo} meses (≈ ${(prazo / 12).toFixed(1)} anos) no sistema Price.`;
}

// ---------------------------------------------------------------------
// Abas do dashboard
// ---------------------------------------------------------------------

function setActiveTab(tab) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('tab--active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('tab-panel--active', p.dataset.panel === tab));
  if (tab === 'graficos' && currentFinancing) {
    requestAnimationFrame(() => renderCharts(currentFinancing, currentRows));
  }
}

// ---------------------------------------------------------------------
// Exportar CSV / imprimir
// ---------------------------------------------------------------------

function exportCSV() {
  if (!currentRows || !currentFinancing) return;
  const header = ['Numero', 'Data', 'Saldo Inicial', 'Amortizacao', 'Juros', 'Parcela', 'Saldo Final', 'Status'];
  const lines = [header.join(';')];
  for (const r of currentRows) {
    const paid = currentFinancing.parcelasPagas[r.numero] ? 'Paga' : 'Pendente';
    lines.push(
      [r.numero, formatDate(r.data), r.saldoInicial.toFixed(2), r.amortizacao.toFixed(2), r.juros.toFixed(2), r.parcela.toFixed(2), r.saldoFinal.toFixed(2), paid].join(';')
    );
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentFinancing.nome.replace(/\s+/g, '_')}_parcelas.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------
// Backup / restore
// ---------------------------------------------------------------------

async function handleExportBackup() {
  const json = await exportAllAsJSON();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `financiamentos-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup exportado.');
}

async function handleImportBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const count = await importFromJSON(text);
    showToast(`${count} financiamento(s) importado(s).`);
    await renderList();
  } catch (err) {
    showToast('Erro ao importar backup: arquivo inválido.');
  }
  e.target.value = '';
}

// ---------------------------------------------------------------------
// Tema claro/escuro
// ---------------------------------------------------------------------

function resolveIsDark() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr) return attr === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  document.getElementById('btn-theme-toggle').textContent = resolveIsDark() ? '☀️' : '🌙';
}

function handleThemeToggle() {
  const next = resolveIsDark() ? 'light' : 'dark';
  setThemePreference(next);
  applyTheme(next);
  if (currentFinancing) renderCharts(currentFinancing, currentRows);
}

// ---------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------

function init() {
  applyTheme(getThemePreference());

  [
    ['f-valor-bem'],
    ['f-entrada'],
    ['f-valor-financiado'],
    ['f-encargos'],
    ['f-juros-carencia'],
    ['ex-valor'],
    ['rev-parcela-maxima'],
    ['prev-valor'],
  ].forEach(([id]) => attachCurrencyMask(document.getElementById(id)));
  attachPercentMask(document.getElementById('f-cet'));

  document.getElementById('f-valor-bem').addEventListener('input', handleValorFinanciadoAutoCalc);
  document.getElementById('f-entrada').addEventListener('input', handleValorFinanciadoAutoCalc);

  document.getElementById('financings-grid').addEventListener('click', handleListGridClick);
  document.getElementById('btn-new-financing').addEventListener('click', openNewFinancingForm);
  document.querySelectorAll('[data-action="new-financing"]').forEach((btn) => btn.addEventListener('click', openNewFinancingForm));
  document.querySelectorAll('[data-action="back-to-list"]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await renderList();
      showView('view-list');
    })
  );

  document.getElementById('financing-form').addEventListener('submit', handleFinancingFormSubmit);
  document.getElementById('btn-edit-financing').addEventListener('click', () => openEditFinancingForm(currentFinancingId));

  document.getElementById('dash-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) setActiveTab(btn.dataset.tab);
  });

  document.getElementById('installments-tbody').addEventListener('click', handleToggleInstallmentPaid);
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-print').addEventListener('click', () => window.print());

  document.getElementById('extra-form').addEventListener('submit', handleExtraFormSubmit);
  document.getElementById('extras-list').addEventListener('click', handleRemoveExtra);
  document.getElementById('ex-data').addEventListener('input', updateExtraParcelaHint);
  document.getElementById('ex-valor').addEventListener('input', updateExtraParcelaHint);

  document.getElementById('btn-reverse-sim').addEventListener('click', handleReverseSim);
  document.getElementById('btn-calcular-meta').addEventListener('click', handleCalcularMeta);
  document.getElementById('btn-simular-aporte').addEventListener('click', handleSimularAporte);
  document.getElementById('btn-add-fase').addEventListener('click', addFaseRow);
  // Simulador ao vivo: atualiza o resultado conforme o usuário digita/muda
  // as opções, sem precisar clicar em nada — o pedido era "um simulador mesmo".
  const debouncedSimularAporte = debounce(handleSimularAporte, 250);
  document.getElementById('prev-valor').addEventListener('input', debouncedSimularAporte);
  document.getElementById('prev-data').addEventListener('change', handleSimularAporte);
  document.querySelectorAll('input[name="prev-modo"]').forEach((el) => el.addEventListener('change', handleSimularAporte));
  document.querySelectorAll('input[name="prev-quando"]').forEach((el) =>
    el.addEventListener('change', () => {
      updatePrevQuandoVisibility();
      const quando = document.querySelector('input[name="prev-quando"]:checked').value;
      if (quando === 'recorrente' && !document.querySelector('#prev-fases-list .fase-row')) {
        addFaseRow();
      }
      handleSimularAporte();
    })
  );
  updatePrevQuandoVisibility();

  document.getElementById('btn-export').addEventListener('click', handleExportBackup);
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('input-import-file').click());
  document.getElementById('input-import-file').addEventListener('change', handleImportBackup);

  document.getElementById('btn-theme-toggle').addEventListener('click', handleThemeToggle);

  window.addEventListener(
    'resize',
    debounce(() => {
      if (currentFinancing && document.querySelector('.tab-panel--active')?.dataset.panel === 'graficos') {
        renderCharts(currentFinancing, currentRows);
      }
    }, 150)
  );

  renderList();
  showView('view-list');
}

init();
