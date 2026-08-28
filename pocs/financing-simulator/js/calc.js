// Motor de cálculo financeiro: SAC, Price e amortização extraordinária.
//
// Toda a matemática monetária é feita em CENTAVOS (inteiros) para evitar
// erros de ponto flutuante que se acumulariam ao longo de centenas de
// parcelas. Só convertemos para reais (float) na saída, para exibição.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function toCents(value) {
  return Math.round((Number(value) || 0) * 100);
}

export function fromCents(cents) {
  return cents / 100;
}

// CET anual (%) -> taxa mensal equivalente (decimal), por juros compostos.
export function annualToMonthlyRate(cetAnualPercent) {
  const cet = (Number(cetAnualPercent) || 0) / 100;
  return Math.pow(1 + cet, 1 / 12) - 1;
}

// Soma `months` meses a uma data 'YYYY-MM-DD', preservando o dia do mês
// (ou ajustando para o último dia válido, ex: 31/jan + 1 mês = 28/fev).
export function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetMonthIndex = (m - 1) + months;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  const date = new Date(Date.UTC(targetYear, targetMonth, day));
  return date.toISOString().slice(0, 10);
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// Valor da parcela fixa no sistema Price (PMT), em centavos.
export function pricePayment(pvCents, i, n) {
  if (n <= 0) return 0;
  if (i === 0) return pvCents / n;
  const factor = Math.pow(1 + i, n);
  return (pvCents * (i * factor)) / (factor - 1);
}

// Número de períodos necessários para quitar `pvCents` pagando `pmtCents`
// por período a uma taxa `i`. Usado em "reduzir prazo" no sistema Price,
// onde a parcela é mantida e o prazo restante precisa ser recalculado.
export function priceRemainingPeriods(pvCents, pmtCents, i) {
  if (pvCents <= 0) return 0;
  if (i === 0) return Math.ceil(pvCents / pmtCents);
  const ratio = pmtCents / (pmtCents - pvCents * i);
  if (ratio <= 0) return Infinity; // parcela não cobre nem os juros: nunca quita
  return Math.ceil(Math.log(ratio) / Math.log(1 + i));
}

// Gera a tabela de parcelas completa de um financiamento.
//
// options.includeExtras = false gera a tabela "original" (sem nenhuma
// amortização extra aplicada), usada como baseline para calcular economia.
//
// Cada amortização extra é aplicada logo após o pagamento da parcela de
// referência, reduzindo o saldo devedor. A partir daí a tabela é
// recalculada segundo o modo escolhido:
//  - 'prazo'   : mantém a "força" da parcela (amortização SAC / valor Price)
//                e reduz o número de parcelas restantes.
//  - 'parcela' : mantém o prazo restante original e recalcula uma parcela
//                menor.
export function computeSchedule(financing, options = {}) {
  const includeExtras = options.includeExtras !== false;
  const i = annualToMonthlyRate(financing.cetAnual);
  const tipo = financing.tipo;
  const prazoTotal = financing.prazoMeses;
  const encargosCents = toCents(financing.encargosMensais || 0);
  // Juros de carência: cobrança única do período entre a liberação do
  // crédito e a data da 1ª parcela, comum em financiamento imobiliário.
  // Some apenas na parcela 1 — não afeta saldo devedor nem as demais linhas.
  const jurosCarenciaCents = toCents(financing.jurosCarencia || 0);

  const extras = includeExtras
    ? [...(financing.amortizacoesExtras || [])].sort((a, b) => a.parcelaReferencia - b.parcelaReferencia)
    : [];

  const rows = [];
  let saldoCents = toCents(financing.valorFinanciado);
  let mesesRestantesSegmento = prazoTotal;
  let amortConstCents = tipo === 'SAC' ? Math.floor(saldoCents / mesesRestantesSegmento) : null;
  let parcelaFixaCents = tipo === 'PRICE' ? Math.round(pricePayment(saldoCents, i, mesesRestantesSegmento)) : null;
  let extraIdx = 0;
  let numero = 1;

  // Rede de segurança: recálculos de "reduzir prazo" usam uma estimativa
  // (ceil de logaritmo/razão) que pode divergir por causa do arredondamento
  // em centavos das parcelas reais; isso evita um laço infinito nesse caso raro.
  const maxIterations = prazoTotal * 3 + 120;
  let iterations = 0;

  while (saldoCents > 0 && iterations < maxIterations) {
    iterations++;
    if (mesesRestantesSegmento <= 0) mesesRestantesSegmento = 1;
    const isLastOfSegment = mesesRestantesSegmento === 1;

    const saldoInicialCents = saldoCents;
    const jurosCents = Math.round(saldoCents * i);
    let amortCents;

    if (tipo === 'SAC') {
      amortCents = isLastOfSegment ? saldoCents : amortConstCents;
    } else {
      amortCents = isLastOfSegment ? saldoCents : parcelaFixaCents - jurosCents;
    }
    amortCents = Math.max(0, Math.min(amortCents, saldoCents));

    const parcelaCents = amortCents + jurosCents;
    saldoCents -= amortCents;
    mesesRestantesSegmento--;

    const carenciaCents = numero === 1 ? jurosCarenciaCents : 0;
    const row = {
      numero,
      data: addMonths(financing.dataPrimeiraParcela, numero - 1),
      saldoInicial: fromCents(saldoInicialCents),
      amortizacao: fromCents(amortCents),
      juros: fromCents(jurosCents + carenciaCents),
      encargos: fromCents(encargosCents),
      parcela: fromCents(parcelaCents + encargosCents + carenciaCents),
      saldoFinal: fromCents(saldoCents),
      extraAplicada: null,
    };
    rows.push(row);

    // Aplica amortização extraordinária referenciando esta parcela.
    if (extraIdx < extras.length && extras[extraIdx].parcelaReferencia === numero && saldoCents > 0) {
      const extra = extras[extraIdx];
      const extraCents = Math.max(0, Math.min(toCents(extra.valor), saldoCents));
      saldoCents -= extraCents;
      row.extraAplicada = { id: extra.id, valor: fromCents(extraCents), modo: extra.modo };
      row.saldoFinal = fromCents(saldoCents);

      if (saldoCents > 0) {
        if (extra.modo === 'prazo') {
          if (tipo === 'SAC') {
            mesesRestantesSegmento = Math.max(1, Math.ceil(saldoCents / amortConstCents));
            amortConstCents = Math.floor(saldoCents / mesesRestantesSegmento) || 1;
          } else {
            let n = priceRemainingPeriods(saldoCents, parcelaFixaCents, i);
            if (!isFinite(n)) n = prazoTotal - numero; // parcela não cobre juros: mantém prazo original como fallback
            mesesRestantesSegmento = Math.max(1, n);
            // parcelaFixaCents é mantida (é o critério de "reduzir prazo" no Price)
          }
        } else {
          // 'parcela': mantém o prazo restante original
          mesesRestantesSegmento = Math.max(1, prazoTotal - numero);
          if (tipo === 'SAC') {
            amortConstCents = Math.floor(saldoCents / mesesRestantesSegmento) || 1;
          } else {
            parcelaFixaCents = Math.round(pricePayment(saldoCents, i, mesesRestantesSegmento));
          }
        }
      }
      extraIdx++;
    }

    numero++;
  }

  return { rows, taxaMensal: i };
}

// Resumo agregado do financiamento a partir da tabela de parcelas e do
// status de pagamento salvo (parcelasPagas: { [numero]: true }).
export function computeResumo(financing, rows) {
  const pagas = financing.parcelasPagas || {};
  let totalPago = 0;
  let totalJurosPago = 0;
  let totalAmortPago = 0;
  let parcelasPagasCount = 0;
  let totalAmortExtra = 0;

  for (const row of rows) {
    if (pagas[row.numero]) {
      totalPago += row.parcela;
      totalJurosPago += row.juros;
      totalAmortPago += row.amortizacao;
      parcelasPagasCount++;
    }
    if (row.extraAplicada) totalAmortExtra += row.extraAplicada.valor;
  }

  const ultimaPaga = [...rows].reverse().find((r) => pagas[r.numero]);
  const saldoDevedorAtual = ultimaPaga ? ultimaPaga.saldoFinal : financing.valorFinanciado;
  const ultimaParcela = rows[rows.length - 1];

  return {
    saldoDevedorAtual,
    totalPago,
    totalJurosPago,
    totalAmortPago,
    totalAmortExtra,
    parcelasPagasCount,
    parcelasRestantes: rows.length - parcelasPagasCount,
    totalParcelas: rows.length,
    dataPrevistaQuitacao: ultimaParcela ? ultimaParcela.data : null,
  };
}

// Compara a tabela real (com amortizações extras) com a tabela original
// (sem elas), para medir quanto tempo e juros foram economizados.
export function computeEconomia(financing) {
  const semExtras = computeSchedule(financing, { includeExtras: false });
  const comExtras = computeSchedule(financing, { includeExtras: true });

  const jurosTotalSemExtras = semExtras.rows.reduce((sum, r) => sum + r.juros, 0);
  const jurosTotalComExtras = comExtras.rows.reduce((sum, r) => sum + r.juros, 0);

  return {
    mesesEconomizados: semExtras.rows.length - comExtras.rows.length,
    jurosEconomizados: jurosTotalSemExtras - jurosTotalComExtras,
    prazoOriginal: semExtras.rows.length,
    prazoAtual: comExtras.rows.length,
  };
}

// Dado que o usuário quer quitar o financiamento em `mesesDesejados` a
// partir da parcela `parcelaReferencia`, encontra o menor valor de
// amortização extra (modo "reduzir prazo") que atinge essa meta.
//
// Usa busca binária sobre o próprio `computeSchedule` em vez de tentar
// inverter a fórmula analiticamente: a recalculagem de "reduzir prazo"
// envolve arredondamentos (ceil) que não são triviais de inverter, e o
// prazo resultante é monotônico decrescente conforme o valor extra
// aumenta, então a busca binária converge com poucas iterações.
export function estimateExtraParaPrazoDesejado(financing, parcelaReferencia, mesesDesejados) {
  const rowsAtuais = computeSchedule(financing).rows;
  const refRow = rowsAtuais.find((r) => r.numero === parcelaReferencia);
  if (!refRow) return null;

  const saldoMaximoCents = toCents(refRow.saldoFinal);
  if (saldoMaximoCents <= 0) return { valor: 0 };

  function mesesRestantesCom(valorExtraCents) {
    const hipotetico = {
      ...financing,
      amortizacoesExtras: [
        ...(financing.amortizacoesExtras || []),
        { id: '__preview__', valor: fromCents(valorExtraCents), parcelaReferencia, modo: 'prazo' },
      ],
    };
    return computeSchedule(hipotetico).rows.length - parcelaReferencia;
  }

  if (mesesRestantesCom(0) <= mesesDesejados) return { valor: 0 };

  let lo = 0;
  let hi = saldoMaximoCents;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (mesesRestantesCom(mid) <= mesesDesejados) hi = mid;
    else lo = mid + 1;
  }
  return { valor: fromCents(hi) };
}

// Simula o impacto de uma ou mais amortizações extras hipotéticas (ainda
// não salvas), comparando a tabela atual do financiamento (já considerando
// as amortizações extras reais) com o cenário "e se eu também aplicasse
// estas" — usado tanto para um aporte único quanto para um plano de várias
// fases (ex: R$2.000/mês por 4 meses, depois R$3.000/mês por mais 4 meses).
export function computeImpactoSimulado(financing, extrasHipoteticas) {
  const lista = Array.isArray(extrasHipoteticas) ? extrasHipoteticas : [extrasHipoteticas];
  const atual = computeSchedule(financing).rows;
  const hipotetico = computeSchedule({
    ...financing,
    amortizacoesExtras: [...(financing.amortizacoesExtras || []), ...lista],
  }).rows;

  const jurosAtual = atual.reduce((s, r) => s + r.juros, 0);
  const jurosHipotetico = hipotetico.reduce((s, r) => s + r.juros, 0);

  // Valor da parcela logo após a última amortização simulada — mais
  // relevante no modo "reduzir parcela", onde é a informação que o usuário
  // quer ver (de quanto para quanto cai a parcela).
  const ultimaReferencia = Math.max(...lista.map((e) => e.parcelaReferencia));
  const parcelaAntes = atual.find((r) => r.numero === ultimaReferencia + 1)?.parcela ?? null;
  const parcelaDepois = hipotetico.find((r) => r.numero === ultimaReferencia + 1)?.parcela ?? null;

  return {
    prazoAtual: atual.length,
    prazoHipotetico: hipotetico.length,
    mesesEconomizados: atual.length - hipotetico.length,
    jurosEconomizados: jurosAtual - jurosHipotetico,
    dataQuitacaoAtual: atual[atual.length - 1]?.data ?? null,
    dataQuitacaoHipotetica: hipotetico[hipotetico.length - 1]?.data ?? null,
    parcelaAntes,
    parcelaDepois,
  };
}

// Soma `days` dias a uma data 'YYYY-MM-DD'.
export function addDays(dateStr, days) {
  const date = new Date(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Juros "pro-rata die": a maioria dos bancos brasileiros, ao receber uma
// amortização extra fora do dia exato do vencimento, primeiro desconta os
// juros corridos desde o vencimento da parcela de referência até o dia real
// do pagamento — só o restante abate o saldo devedor. Esse custo é fixo
// (depende do saldo e dos dias corridos), não do valor pago.
// Aproximação linear simples (taxa mensal / 30), que é como a maioria dos
// bancos calcula o pro-rata na prática.
export function computeJurosCorridos(financing, refRow, dataPagamento) {
  const i = annualToMonthlyRate(financing.cetAnual);
  const taxaDiaria = i / 30;
  const dias = Math.max(0, Math.round((new Date(dataPagamento) - new Date(refRow.data)) / MS_PER_DAY));
  const saldoCents = toCents(refRow.saldoFinal);
  const jurosCents = Math.round(saldoCents * taxaDiaria * dias);
  return { dias, juros: fromCents(jurosCents) };
}

// Dado um valor bruto que o usuário efetivamente paga, calcula quanto
// realmente abate o saldo devedor depois de descontados os juros pro-rata.
export function computeValorLiquidoAmortizado(financing, refRow, dataPagamento, valorPagoBruto) {
  const { dias, juros } = computeJurosCorridos(financing, refRow, dataPagamento);
  const jurosAplicado = Math.min(valorPagoBruto, juros);
  return {
    dias,
    jurosProRata: jurosAplicado,
    valorLiquido: Math.round((valorPagoBruto - jurosAplicado) * 100) / 100,
  };
}

// Simulação reversa: dado um valor máximo de parcela, estima o prazo (em
// meses) necessário para financiar `valorFinanciado` sem estourar o teto.
// Usa a fórmula de Price (parcela decrescente do SAC facilita, então o
// caso mais restritivo/relevante para o usuário é o Price).
export function estimatePrazoParaParcelaMaxima(valorFinanciado, cetAnualPercent, parcelaMaxima) {
  const i = annualToMonthlyRate(cetAnualPercent);
  const pv = toCents(valorFinanciado);
  const pmt = toCents(parcelaMaxima);
  if (pmt <= 0 || pv <= 0) return null;
  if (i > 0 && pmt <= pv * i) return null; // parcela não cobre nem os juros do 1º mês
  const n = priceRemainingPeriods(pv, pmt, i);
  if (!isFinite(n) || n <= 0) return null;
  return Math.ceil(n);
}
