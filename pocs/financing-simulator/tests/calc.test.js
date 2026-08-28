// Tests for the financial calculation engine (js/calc.js), using Node's
// built-in test runner (no external dependencies). Run with:
//   npm test
// or directly:
//   node --test tests/
//
// Note: the fields below (valorFinanciado, cetAnual, etc.) match calc.js's
// data model, which is in Portuguese by design (matches the Brazilian
// financial domain terms used throughout the app).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  annualToMonthlyRate,
  addMonths,
  pricePayment,
  priceRemainingPeriods,
  computeSchedule,
  computeResumo,
  computeEconomia,
  estimatePrazoParaParcelaMaxima,
  estimateExtraParaPrazoDesejado,
  computeImpactoSimulado,
  addDays,
  computeJurosCorridos,
  computeValorLiquidoAmortizado,
  toCents,
  fromCents,
} from '../js/calc.js';

function baseFinancing(overrides = {}) {
  return {
    valorFinanciado: 300000,
    cetAnual: 10,
    prazoMeses: 360,
    tipo: 'SAC',
    dataPrimeiraParcela: '2024-01-10',
    amortizacoesExtras: [],
    parcelasPagas: {},
    ...overrides,
  };
}

describe('toCents / fromCents', () => {
  test('convert between reais and cents without losing precision', () => {
    assert.equal(toCents(1234.56), 123456);
    assert.equal(fromCents(123456), 1234.56);
    assert.equal(toCents(0.1 + 0.2), 30); // guards against the classic floating-point error
  });
});

describe('annualToMonthlyRate', () => {
  test('12 months at the monthly rate reconstruct the annual CET', () => {
    const i = annualToMonthlyRate(12);
    const rebuiltCet = (Math.pow(1 + i, 12) - 1) * 100;
    assert.ok(Math.abs(rebuiltCet - 12) < 1e-9);
  });

  test('0% CET results in a 0 monthly rate', () => {
    assert.equal(annualToMonthlyRate(0), 0);
  });
});

describe('addMonths', () => {
  test('adds simple months while preserving the day', () => {
    assert.equal(addMonths('2024-01-10', 1), '2024-02-10');
    assert.equal(addMonths('2024-01-10', 12), '2025-01-10');
  });

  test('clamps to the last valid day of the target month', () => {
    assert.equal(addMonths('2024-01-31', 1), '2024-02-29'); // 2024 is a leap year
    assert.equal(addMonths('2023-01-31', 1), '2023-02-28');
  });

  test('crosses a year boundary correctly', () => {
    assert.equal(addMonths('2024-11-15', 3), '2025-02-15');
  });
});

describe('pricePayment / priceRemainingPeriods', () => {
  test('are inverse functions of each other', () => {
    const pv = toCents(50000);
    const i = annualToMonthlyRate(9);
    const n = 48;
    const pmt = Math.round(pricePayment(pv, i, n));
    const recoveredN = priceRemainingPeriods(pv, pmt, i);
    assert.ok(Math.abs(recoveredN - n) <= 1); // rounding can shift the result by +/-1 period
  });

  test('zero rate degenerates into simple division', () => {
    assert.equal(pricePayment(120000, 0, 12), 10000);
    assert.equal(priceRemainingPeriods(120000, 10000, 0), 12);
  });
});

describe('computeSchedule — SAC', () => {
  test('generates as many installments as the term when there is no extra amortization', () => {
    const { rows } = computeSchedule(baseFinancing());
    assert.equal(rows.length, 360);
  });

  test('pays off the outstanding balance exactly to zero on the last installment', () => {
    const { rows } = computeSchedule(baseFinancing());
    assert.equal(rows[rows.length - 1].saldoFinal, 0);
  });

  test('the sum of the amortizations matches the financed amount (no rounding leftover)', () => {
    const { rows } = computeSchedule(baseFinancing());
    const sum = rows.reduce((s, r) => s + r.amortizacao, 0);
    assert.ok(Math.abs(sum - 300000) < 0.01);
  });

  test('installments are decreasing (constant amortization, falling interest)', () => {
    const { rows } = computeSchedule(baseFinancing());
    assert.ok(rows[0].parcela > rows[180].parcela);
    assert.ok(rows[180].parcela > rows[rows.length - 1].parcela);
  });

  test('installment dates advance by one month on each row', () => {
    const { rows } = computeSchedule(baseFinancing());
    assert.equal(rows[0].data, '2024-01-10');
    assert.equal(rows[1].data, '2024-02-10');
  });
});

describe('computeSchedule — Price', () => {
  test('generates as many installments as the term when there is no extra amortization', () => {
    const { rows } = computeSchedule(baseFinancing({ tipo: 'PRICE' }));
    assert.equal(rows.length, 360);
  });

  test('pays off the outstanding balance exactly to zero on the last installment', () => {
    const { rows } = computeSchedule(baseFinancing({ tipo: 'PRICE' }));
    assert.equal(rows[rows.length - 1].saldoFinal, 0);
  });

  test('the sum of the amortizations matches the financed amount', () => {
    const { rows } = computeSchedule(baseFinancing({ tipo: 'PRICE' }));
    const sum = rows.reduce((s, r) => s + r.amortizacao, 0);
    assert.ok(Math.abs(sum - 300000) < 0.01);
  });

  test('the installment is fixed for the whole term (except the last one, adjusted for rounding)', () => {
    const { rows } = computeSchedule(baseFinancing({ tipo: 'PRICE' }));
    const distinctValues = new Set(rows.slice(0, -1).map((r) => r.parcela.toFixed(2)));
    assert.equal(distinctValues.size, 1);
  });
});

describe('jurosCarencia (one-time carência interest on installment 1)', () => {
  test('adds to installment 1 only, on top of juros and parcela', () => {
    const withoutCarencia = computeSchedule(baseFinancing()).rows;
    const withCarencia = computeSchedule(baseFinancing({ jurosCarencia: 137.64 })).rows;

    assert.equal(withCarencia[0].juros, Math.round((withoutCarencia[0].juros + 137.64) * 100) / 100);
    assert.equal(withCarencia[0].parcela, Math.round((withoutCarencia[0].parcela + 137.64) * 100) / 100);
    assert.equal(withCarencia[0].amortizacao, withoutCarencia[0].amortizacao);
    assert.equal(withCarencia[0].saldoFinal, withoutCarencia[0].saldoFinal);
  });

  test('does not affect installment 2 onward, the balance, or the term', () => {
    const withoutCarencia = computeSchedule(baseFinancing()).rows;
    const withCarencia = computeSchedule(baseFinancing({ jurosCarencia: 137.64 })).rows;

    assert.equal(withCarencia.length, withoutCarencia.length);
    assert.deepEqual(withCarencia[1], withoutCarencia[1]);
    assert.deepEqual(withCarencia[withCarencia.length - 1], withoutCarencia[withoutCarencia.length - 1]);
  });
});

describe('extra amortization — "reduce term" mode', () => {
  test('SAC: reduces the number of installments and still closes the balance at zero', () => {
    const fin = baseFinancing({
      amortizacoesExtras: [{ id: 'x1', valor: 50000, parcelaReferencia: 12, modo: 'prazo' }],
    });
    const { rows } = computeSchedule(fin);
    assert.ok(rows.length < 360);
    assert.equal(rows[rows.length - 1].saldoFinal, 0);
    const amortSumPlusExtra = rows.reduce((s, r) => s + r.amortizacao, 0) + 50000;
    assert.ok(Math.abs(amortSumPlusExtra - 300000) < 0.01);
  });

  test('Price: keeps the installment value and reduces the term', () => {
    const fin = baseFinancing({
      tipo: 'PRICE',
      amortizacoesExtras: [{ id: 'x1', valor: 50000, parcelaReferencia: 12, modo: 'prazo' }],
    });
    const { rows } = computeSchedule(fin);
    assert.ok(rows.length < 360);
    const installmentBefore = rows[5].parcela;
    const installmentAfter = rows[15].parcela;
    assert.ok(Math.abs(installmentBefore - installmentAfter) < 0.02);
    assert.equal(rows[rows.length - 1].saldoFinal, 0);
  });
});

describe('extra amortization — "reduce installment" mode', () => {
  test('SAC: keeps the original term and reduces the value of the following installments', () => {
    const fin = baseFinancing({
      amortizacoesExtras: [{ id: 'x1', valor: 50000, parcelaReferencia: 12, modo: 'parcela' }],
    });
    const { rows } = computeSchedule(fin);
    assert.equal(rows.length, 360);
    assert.ok(rows[12].parcela < rows[11].parcela);
    assert.equal(rows[rows.length - 1].saldoFinal, 0);
  });

  test('Price: keeps the original term and recalculates a smaller fixed installment', () => {
    const fin = baseFinancing({
      tipo: 'PRICE',
      amortizacoesExtras: [{ id: 'x1', valor: 50000, parcelaReferencia: 12, modo: 'parcela' }],
    });
    const { rows } = computeSchedule(fin);
    assert.equal(rows.length, 360);
    assert.ok(rows[15].parcela < rows[5].parcela);
    assert.equal(rows[rows.length - 1].saldoFinal, 0);
  });
});

describe('removing an extra amortization', () => {
  test('restores the original calculation from that point on', () => {
    const withoutExtra = baseFinancing();
    const withExtra = baseFinancing({
      amortizacoesExtras: [{ id: 'x1', valor: 50000, parcelaReferencia: 12, modo: 'parcela' }],
    });

    const original = computeSchedule(withoutExtra).rows;
    const withAmortization = computeSchedule(withExtra).rows;
    // after "removing" the extra (simulated by recomputing without it), the
    // result should be identical to a financing that never had it applied
    withExtra.amortizacoesExtras = [];
    const removed = computeSchedule(withExtra).rows;

    assert.equal(removed.length, original.length);
    for (let idx = 0; idx < original.length; idx++) {
      assert.equal(removed[idx].parcela, original[idx].parcela);
    }
    // while the amortization was still applied, the schedule was different
    assert.notEqual(withAmortization[15].parcela, original[15].parcela);
  });
});

describe('computeResumo', () => {
  test('correctly aggregates installments marked as paid', () => {
    const fin = baseFinancing({ parcelasPagas: { 1: true, 2: true, 3: true } });
    const { rows } = computeSchedule(fin);
    const resumo = computeResumo(fin, rows);
    assert.equal(resumo.parcelasPagasCount, 3);
    assert.equal(resumo.parcelasRestantes, 357);
    assert.ok(Math.abs(resumo.totalPago - (rows[0].parcela + rows[1].parcela + rows[2].parcela)) < 0.01);
    assert.equal(resumo.saldoDevedorAtual, rows[2].saldoFinal);
  });

  test('with no installments paid, the current outstanding balance is the financed amount', () => {
    const fin = baseFinancing();
    const { rows } = computeSchedule(fin);
    const resumo = computeResumo(fin, rows);
    assert.equal(resumo.parcelasPagasCount, 0);
    assert.equal(resumo.saldoDevedorAtual, fin.valorFinanciado);
  });
});

describe('computeEconomia', () => {
  test('an extra amortization generates time and interest savings', () => {
    const fin = baseFinancing({
      amortizacoesExtras: [{ id: 'x1', valor: 50000, parcelaReferencia: 12, modo: 'prazo' }],
    });
    const economia = computeEconomia(fin);
    assert.ok(economia.mesesEconomizados > 0);
    assert.ok(economia.jurosEconomizados > 0);
    assert.equal(economia.prazoOriginal, 360);
    assert.ok(economia.prazoAtual < economia.prazoOriginal);
  });

  test('with no extra amortizations, there are no savings', () => {
    const economia = computeEconomia(baseFinancing());
    assert.equal(economia.mesesEconomizados, 0);
    assert.equal(economia.jurosEconomizados, 0);
  });
});

describe('estimateExtraParaPrazoDesejado', () => {
  test('finds an amortization value that actually pays off within the desired term', () => {
    const fin = baseFinancing();
    const estimate = estimateExtraParaPrazoDesejado(fin, 1, 36);
    assert.ok(estimate.valor > 0);

    const proof = computeSchedule({
      ...fin,
      amortizacoesExtras: [{ id: 'x', valor: estimate.valor, parcelaReferencia: 1, modo: 'prazo' }],
    }).rows;
    assert.ok(proof.length - 1 <= 36);
  });

  test('returns zero when the term would already be met without any extra amortization', () => {
    const fin = baseFinancing({ prazoMeses: 24 });
    const estimate = estimateExtraParaPrazoDesejado(fin, 1, 36);
    assert.equal(estimate.valor, 0);
  });

  test('returns null for a reference installment that does not exist', () => {
    const fin = baseFinancing({ prazoMeses: 24 });
    assert.equal(estimateExtraParaPrazoDesejado(fin, 999, 12), null);
  });
});

describe('computeImpactoSimulado', () => {
  test('measures the difference between the current scenario and a hypothetical amortization', () => {
    const fin = baseFinancing();
    const impact = computeImpactoSimulado(fin, { id: 'preview', valor: 50000, parcelaReferencia: 12, modo: 'prazo' });
    assert.equal(impact.prazoAtual, 360);
    assert.ok(impact.prazoHipotetico < impact.prazoAtual);
    assert.ok(impact.jurosEconomizados > 0);
    assert.ok(impact.mesesEconomizados > 0);
  });

  test('accepts an array of hypothetical amortizations (a multi-phase plan)', () => {
    const fin = baseFinancing();
    const plan = [
      { id: 'p1', valor: 2000, parcelaReferencia: 1, modo: 'parcela' },
      { id: 'p2', valor: 2000, parcelaReferencia: 2, modo: 'parcela' },
      { id: 'p3', valor: 2000, parcelaReferencia: 3, modo: 'parcela' },
    ];
    const impact = computeImpactoSimulado(fin, plan);
    assert.equal(impact.prazoHipotetico, impact.prazoAtual); // "reduce installment" keeps the term
    assert.ok(impact.jurosEconomizados > 0);
  });

  test('reports the new installment value right after the last simulated amortization', () => {
    const fin = baseFinancing();
    const withoutExtra = computeSchedule(fin).rows;
    const impact = computeImpactoSimulado(fin, { id: 'preview', valor: 50000, parcelaReferencia: 12, modo: 'parcela' });
    assert.equal(impact.parcelaAntes, withoutExtra[12].parcela);
    assert.ok(impact.parcelaDepois < impact.parcelaAntes);
  });

  test('does not mutate the original financing (it is only a preview)', () => {
    const fin = baseFinancing();
    computeImpactoSimulado(fin, { id: 'preview', valor: 50000, parcelaReferencia: 12, modo: 'prazo' });
    assert.deepEqual(fin.amortizacoesExtras, []);
  });
});

describe('addDays', () => {
  test('adds days across month and year boundaries', () => {
    assert.equal(addDays('2024-01-30', 3), '2024-02-02');
    assert.equal(addDays('2024-12-30', 3), '2025-01-02');
  });

  test('adds a single day (the "day after due date" case)', () => {
    assert.equal(addDays('2024-03-20', 1), '2024-03-21');
  });
});

describe('computeJurosCorridos', () => {
  test('is zero when paid on the exact due date of the reference installment', () => {
    const fin = baseFinancing();
    const refRow = computeSchedule(fin).rows[0];
    const { dias, juros } = computeJurosCorridos(fin, refRow, refRow.data);
    assert.equal(dias, 0);
    assert.equal(juros, 0);
  });

  test('grows with the number of days elapsed since the due date', () => {
    const fin = baseFinancing();
    const refRow = computeSchedule(fin).rows[0];
    const oneDay = computeJurosCorridos(fin, refRow, addDays(refRow.data, 1));
    const tenDays = computeJurosCorridos(fin, refRow, addDays(refRow.data, 10));
    assert.ok(oneDay.juros > 0);
    assert.ok(tenDays.juros > oneDay.juros);
  });

  test('is clamped to zero for a payment date before the due date', () => {
    const fin = baseFinancing();
    const refRow = computeSchedule(fin).rows[5];
    const { dias, juros } = computeJurosCorridos(fin, refRow, addDays(refRow.data, -5));
    assert.equal(dias, 0);
    assert.equal(juros, 0);
  });
});

describe('computeValorLiquidoAmortizado', () => {
  test('subtracts the accrued pro-rata interest from the gross amount paid', () => {
    const fin = baseFinancing();
    const refRow = computeSchedule(fin).rows[0];
    const dataPagamento = addDays(refRow.data, 5);
    const { dias, jurosProRata, valorLiquido } = computeValorLiquidoAmortizado(fin, refRow, dataPagamento, 1000);
    assert.equal(dias, 5);
    assert.ok(jurosProRata > 0);
    assert.equal(Math.round((valorLiquido + jurosProRata) * 100) / 100, 1000);
  });

  test('never returns a negative net value — caps the interest at the amount paid', () => {
    const fin = baseFinancing();
    const refRow = computeSchedule(fin).rows[0];
    const dataPagamento = addDays(refRow.data, 29); // long pro-rata window
    const { jurosProRata, valorLiquido } = computeValorLiquidoAmortizado(fin, refRow, dataPagamento, 1);
    assert.ok(jurosProRata <= 1);
    assert.ok(valorLiquido >= 0);
  });
});

describe('estimatePrazoParaParcelaMaxima', () => {
  test('returns a plausible term for a reasonable installment cap', () => {
    const term = estimatePrazoParaParcelaMaxima(300000, 10, 3000);
    assert.ok(term > 0 && term < 600);
  });

  test('returns null when the installment does not even cover the interest', () => {
    const term = estimatePrazoParaParcelaMaxima(300000, 10, 100);
    assert.equal(term, null);
  });
});
