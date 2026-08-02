#!/usr/bin/env python3
import csv
import glob
import json
import os
import re
from collections import defaultdict
from datetime import datetime

INSTALLMENT_RE = re.compile(r"^(.*?)\s*-\s*Parcela\s+(\d+)/(\d+)$", re.IGNORECASE)


def add_months(year_month: str, delta: int) -> str:
    year, month = map(int, year_month.split("-"))
    month += delta
    year += (month - 1) // 12
    month = (month - 1) % 12 + 1
    return f"{year:04d}-{month:02d}"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSVS_DIR = os.path.join(SCRIPT_DIR, "csvs")
OUTPUT_FILE = os.path.join(SCRIPT_DIR, "report.html")

CATEGORY_KEYWORDS = [
    ("Transporte", ["uber", "99app", "99 -", "combustive", "posto", "estacionamento"]),
    ("Alimentação", ["ifood", "ifd*", "restaurante", "burguer", "cantina", "padaria", "lanchonete",
                      "churrasqu", "acai", "pizza", "sushi", "cafe", "bar ", "mercado", "super mercado",
                      "supermercado", "hortifruti", "empório", "emporio"]),
    ("Assinaturas", ["netflix", "spotify", "amazon prime", "disney", "hbo", "youtube premium",
                      "icloud", "google one", "openai", "chatgpt", "claude.ai"]),
    ("Educação", ["preply", "udemy", "alura", "coursera", "escola", "curso"]),
    ("Viagem", ["airbnb", "booking", "decolar", "latam", "gol linhas", "azul linhas", "hotel"]),
    ("Compras", ["aliexpress", "shopee", "amazon", "mercado livre", "mercadolivre", "shein", "magazine luiza"]),
    ("Saúde", ["farmacia", "drogaria", "droga raia", "pague menos", "clinica", "laboratorio"]),
    ("Telecomunicações", ["recarga de celular", "vivo", "claro", "tim ", "net serviços"]),
    ("Serviços", ["iof de"]),
    ("Encargos", ["multa por fatura atrasada", "juros por fatura atrasada"]),
]


def categorize(title: str) -> str:
    t = title.lower()
    for category, keywords in CATEGORY_KEYWORDS:
        if any(k in t for k in keywords):
            return category
    return "Outros"


def parse_amount(raw: str) -> float:
    s = raw.strip().replace(" ", "").replace(".", "").replace(",", ".")
    return float(s)


NON_EXPENSE_TITLES = ["pagamento recebido", "valor pendente do mês anterior"]


INVOICE_ID_RE = re.compile(r"(\d{4}-\d{2})")


def load_transactions():
    seen = set()
    transactions = []
    files = sorted(glob.glob(os.path.join(CSVS_DIR, "*.csv")))
    if not files:
        raise SystemExit(f"Nenhum CSV encontrado em {CSVS_DIR}")

    for path in files:
        # Cada CSV é uma fatura cujo ciclo vai do dia ~10 ao dia ~9 do mês seguinte
        # (não coincide com o mês-calendário), então agrupamos por fatura, não por
        # data da transação, para "mês com maior/menor gasto" refletir faturas reais.
        invoice_match = INVOICE_ID_RE.search(os.path.basename(path))
        invoice_id = invoice_match.group(1) if invoice_match else os.path.basename(path)
        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                date = row["date"].strip()
                title = row["title"].strip()
                amount = parse_amount(row["amount"])
                if title.lower() in NON_EXPENSE_TITLES:
                    continue
                key = (date, title, amount)
                if key in seen:
                    continue
                seen.add(key)
                transactions.append({
                    "date": date,
                    "title": title,
                    "amount": amount,
                    "category": categorize(title),
                    "month": invoice_id,
                })
    return transactions


CLOSING_DAY_THRESHOLD = 8  # faturas fechadas sempre têm a última transação no dia 8 ou 9


def find_open_invoice(transactions):
    """A fatura mais recente ainda não fechou se sua última transação (por data
    cronológica real, não apenas o dia do mês) está bem antes do dia de
    fechamento do ciclo (~dia 8-9), indicando exportação feita no meio do
    ciclo em vez de após o fechamento. Uma fatura cobre dois meses-calendário
    (ex: 10/jul a 09/ago), então olhar só o "dia" de cada linha sem considerar
    o mês (ex: 29/jul) daria um falso positivo de fechada."""
    if not transactions:
        return None
    last_invoice = max(t["month"] for t in transactions)
    max_date = max(t["date"] for t in transactions if t["month"] == last_invoice)
    is_closed = max_date[:7] == last_invoice and int(max_date[8:10]) >= CLOSING_DAY_THRESHOLD
    return None if is_closed else last_invoice


def build_report_data(transactions):
    expenses = [t for t in transactions if t["amount"] > 0]
    open_invoice = find_open_invoice(transactions)

    by_month = defaultdict(float)
    for t in transactions:
        by_month[t["month"]] += t["amount"]
    months_sorted = sorted(by_month.keys())
    closed_months = [m for m in months_sorted if m != open_invoice]

    by_category = defaultdict(float)
    for t in expenses:
        by_category[t["category"]] += t["amount"]
    categories_sorted = sorted(by_category.items(), key=lambda x: -x[1])

    by_merchant = defaultdict(float)
    merchant_count = defaultdict(int)
    for t in expenses:
        by_merchant[t["title"]] += t["amount"]
        merchant_count[t["title"]] += 1
    top_merchants = sorted(by_merchant.items(), key=lambda x: -x[1])[:10]

    top_expenses = sorted(expenses, key=lambda x: -x["amount"])[:15]

    total_spent = sum(expenses_amounts := [t["amount"] for t in expenses])
    total_refunds = sum(t["amount"] for t in transactions if t["amount"] < 0)
    net_total = total_spent + total_refunds

    # Total por fatura = líquido (compras - estornos do próprio ciclo), pois é assim que o
    # Nubank soma a fatura: estornos dentro do mesmo ciclo abatem o total, não ficam de fora.
    month_totals_expenses = by_month

    # Média e maior/menor consideram só faturas fechadas: a fatura em aberto (ciclo ainda
    # rodando) tem total parcial e enviesaria essas comparações para baixo.
    closed_totals = {m: by_month[m] for m in closed_months}
    avg_monthly = sum(closed_totals.values()) / len(closed_totals) if closed_totals else 0

    highest_month = max(closed_totals.items(), key=lambda x: x[1]) if closed_totals else (None, 0)
    lowest_month = min(closed_totals.items(), key=lambda x: x[1]) if closed_totals else (None, 0)

    top_category = categories_sorted[0] if categories_sorted else ("-", 0)

    forecast = build_forecast(expenses)
    highlights = build_highlights(expenses, ["uber", "preply"])

    return {
        "summary": {
            "total_spent": round(total_spent, 2),
            "total_refunds": round(total_refunds, 2),
            "net_total": round(net_total, 2),
            "avg_monthly": round(avg_monthly, 2),
            "months_count": len(closed_months),
            "transactions_count": len(expenses),
            "highest_month": {"month": highest_month[0], "amount": round(highest_month[1], 2)},
            "lowest_month": {"month": lowest_month[0], "amount": round(lowest_month[1], 2)},
            "top_category": {"name": top_category[0], "amount": round(top_category[1], 2)},
            "open_invoice": open_invoice,
        },
        "months": months_sorted,
        "month_totals": [round(month_totals_expenses.get(m, 0), 2) for m in months_sorted],
        "categories": [{"name": c, "amount": round(a, 2)} for c, a in categories_sorted],
        "top_merchants": [
            {"name": m, "amount": round(a, 2), "count": merchant_count[m]} for m, a in top_merchants
        ],
        "top_expenses": [
            {"date": t["date"], "title": t["title"], "amount": round(t["amount"], 2), "category": t["category"]}
            for t in top_expenses
        ],
        "all_expenses": [
            {"date": t["date"], "title": t["title"], "amount": round(t["amount"], 2), "category": t["category"]}
            for t in sorted(expenses, key=lambda x: x["date"], reverse=True)
        ],
        "forecast": forecast,
        "highlights": highlights,
    }


def build_highlights(expenses, keywords):
    """Total gasto e contagem de transações para merchants específicos (busca por substring no título)."""
    result = []
    for keyword in keywords:
        matches = [t for t in expenses if keyword in t["title"].lower()]
        result.append({
            "label": keyword.capitalize(),
            "amount": round(sum(t["amount"] for t in matches), 2),
            "count": len(matches),
        })
    return result


def build_forecast(expenses):
    """Projeta parcelas restantes de compras parceladas ainda em aberto,
    assumindo que a última parcela vista se repete com o mesmo valor até o total."""
    plans = {}
    for t in expenses:
        match = INSTALLMENT_RE.match(t["title"])
        if not match:
            continue
        base, current, total = match.groups()
        base = base.strip()
        current, total = int(current), int(total)
        key = (base, total)
        if key not in plans or current > plans[key]["current"]:
            plans[key] = {
                "base": base,
                "current": current,
                "total": total,
                "amount": t["amount"],
                "month": t["month"],
            }

    forecast_by_month = defaultdict(float)
    open_plans = []
    for plan in plans.values():
        remaining = plan["total"] - plan["current"]
        if remaining <= 0:
            continue
        future_months = [add_months(plan["month"], offset) for offset in range(1, remaining + 1)]
        for fm in future_months:
            forecast_by_month[fm] += plan["amount"]
        open_plans.append({
            "title": plan["base"],
            "installment_amount": round(plan["amount"], 2),
            "current_installment": plan["current"],
            "total_installments": plan["total"],
            "remaining_count": remaining,
            "remaining_total": round(plan["amount"] * remaining, 2),
            "next_month": future_months[0],
            "last_month": future_months[-1],
        })

    open_plans.sort(key=lambda p: -p["remaining_total"])
    forecast_months = sorted(forecast_by_month.keys())

    return {
        "months": forecast_months,
        "amounts": [round(forecast_by_month[m], 2) for m in forecast_months],
        "total_pending": round(sum(forecast_by_month.values()), 2),
        "open_plans": open_plans,
    }


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Análise de Gastos — Nubank</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg: #0f1115;
    --surface: #171a21;
    --surface-2: #1f232c;
    --border: #2a2f3a;
    --text: #eef0f4;
    --text-dim: #9aa1b0;
    --purple: #8a05be;
    --purple-light: #a855f7;
    --green: #00d179;
    --red: #ff5c5c;
    --amber: #ffb454;
    --blue: #4ea1ff;
    --radius: 14px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: radial-gradient(1200px 600px at 10% -10%, #2a0a45 0%, transparent 60%),
                radial-gradient(1000px 500px at 100% 0%, #05264a 0%, transparent 55%),
                var(--bg);
    color: var(--text);
    padding: 32px 24px 64px;
  }
  .container { max-width: 1180px; margin: 0 auto; }
  header { margin-bottom: 32px; }
  header h1 {
    font-size: 28px;
    margin: 0 0 6px;
    background: linear-gradient(90deg, var(--purple-light), var(--blue));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  header p { color: var(--text-dim); margin: 0; font-size: 14px; }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 16px;
    margin-bottom: 28px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 18px 20px;
  }
  .card .label { font-size: 12px; color: var(--text-dim); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px; }
  .card .value { font-size: 24px; font-weight: 700; }
  .card .sub { font-size: 12px; color: var(--text-dim); margin-top: 4px; }
  .card.accent .value { color: var(--purple-light); }
  .card.red .value { color: var(--red); }
  .card.green .value { color: var(--green); }
  .card.amber .value { color: var(--amber); }

  .grid-2 {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 20px;
    margin-bottom: 20px;
  }
  @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }

  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
  }
  .panel h2 { font-size: 15px; margin: 0 0 16px; color: var(--text); }
  .panel h2 .muted { color: var(--text-dim); font-weight: 400; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--border); }
  th { color: var(--text-dim); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  td.amount { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  tr:last-child td { border-bottom: none; }
  .tag {
    display: inline-block;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--purple-light);
    border: 1px solid var(--border);
  }

  .filters { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
  .filters input, .filters select {
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
  }
  .filters input { flex: 1; min-width: 180px; }

  canvas { max-height: 320px; }
  .table-scroll { max-height: 460px; overflow-y: auto; }

  footer { text-align: center; color: var(--text-dim); font-size: 12px; margin-top: 40px; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Análise de Gastos — Nubank</h1>
    <p id="period-label"></p>
  </header>

  <div class="cards" id="summary-cards"></div>

  <div class="grid-2">
    <div class="panel">
      <h2>Evolução por fatura</h2>
      <canvas id="monthlyChart"></canvas>
    </div>
    <div class="panel">
      <h2>Por categoria</h2>
      <canvas id="categoryChart"></canvas>
    </div>
  </div>

  <div class="grid-2">
    <div class="panel">
      <h2>Previsão de gastos futuros <span class="muted">(parcelamentos em aberto)</span></h2>
      <canvas id="forecastChart"></canvas>
    </div>
    <div class="panel">
      <h2>Compras parceladas em aberto</h2>
      <div class="table-scroll">
        <table id="openPlansTable">
          <thead><tr><th>Compra</th><th>Parcela</th><th style="text-align:right">Valor/parcela</th><th style="text-align:right">Restante</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="grid-2">
    <div class="panel">
      <h2>Maiores gastos individuais</h2>
      <div class="table-scroll">
        <table id="topExpensesTable">
          <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th style="text-align:right">Valor</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <h2>Top estabelecimentos</h2>
      <div class="table-scroll">
        <table id="topMerchantsTable">
          <thead><tr><th>Nome</th><th>Qtd</th><th style="text-align:right">Total</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="panel" style="margin-bottom:20px">
    <h2>Todas as transações <span class="muted" id="tx-count"></span></h2>
    <div class="filters">
      <input type="text" id="searchInput" placeholder="Buscar por descrição...">
      <select id="categoryFilter"></select>
      <select id="monthFilter"></select>
    </div>
    <div class="table-scroll">
      <table id="allExpensesTable">
        <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th style="text-align:right">Valor</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  </div>

  <footer>Gerado automaticamente a partir dos extratos CSV do Nubank.</footer>
</div>

<script>
const DATA = __DATA_JSON__;

function fmtBRL(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtMonth(m) {
  const [y, mo] = m.split('-');
  const names = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return names[parseInt(mo,10)-1] + '/' + y.slice(2);
}

document.getElementById('period-label').textContent =
  DATA.months.length ? `Período: ${fmtMonth(DATA.months[0])} — ${fmtMonth(DATA.months[DATA.months.length-1])}${DATA.summary.open_invoice ? ' (última fatura em aberto)' : ''}` : '';

const s = DATA.summary;
const cards = [
  { label: 'Total gasto', value: fmtBRL(s.total_spent), cls: 'accent' },
  { label: 'Média por fatura fechada', value: fmtBRL(s.avg_monthly), cls: '' },
  { label: 'Estornos', value: fmtBRL(Math.abs(s.total_refunds)), cls: 'green' },
  { label: 'Mês com maior gasto', value: fmtMonth(s.highest_month.month), sub: fmtBRL(s.highest_month.amount), cls: 'red' },
  { label: 'Mês com menor gasto', value: fmtMonth(s.lowest_month.month), sub: fmtBRL(s.lowest_month.amount), cls: 'green' },
  { label: 'Categoria dominante', value: s.top_category.name, sub: fmtBRL(s.top_category.amount), cls: 'amber' },
  { label: 'Parcelas em aberto', value: fmtBRL(DATA.forecast.total_pending), sub: `${DATA.forecast.open_plans.length} compra(s) parcelada(s)`, cls: 'red' },
  ...DATA.highlights.map(h => ({
    label: `Gasto com ${h.label}`,
    value: fmtBRL(h.amount),
    sub: `${h.count} transaç${h.count === 1 ? 'ão' : 'ões'}`,
    cls: '',
  })),
];
document.getElementById('summary-cards').innerHTML = cards.map(c => `
  <div class="card ${c.cls}">
    <div class="label">${c.label}</div>
    <div class="value">${c.value}</div>
    ${c.sub ? `<div class="sub">${c.sub}</div>` : ''}
  </div>
`).join('');

const CATEGORY_COLORS = {
  'Outros': '#8a05be',
  'Alimentação': '#4ea1ff',
  'Transporte': '#00d179',
  'Educação': '#ffb454',
  'Saúde': '#ff5c5c',
  'Viagem': '#a855f7',
  'Compras': '#14b8a6',
  'Telecomunicações': '#f472b6',
  'Assinaturas': '#facc15',
  'Serviços': '#60a5fa',
  'Encargos': '#f87171',
};
const FALLBACK_COLOR = '#9aa1b0';
function categoryColor(name) { return CATEGORY_COLORS[name] || FALLBACK_COLOR; }
function categoryTag(name) {
  const c = categoryColor(name);
  return `<span class="tag" style="background:${c}22;color:${c};border-color:${c}55">${name}</span>`;
}

new Chart(document.getElementById('monthlyChart'), {
  type: 'line',
  data: {
    labels: DATA.months.map(m => fmtMonth(m) + (m === DATA.summary.open_invoice ? ' (aberta)' : '')),
    datasets: [{
      label: 'Gasto mensal',
      data: DATA.month_totals,
      borderColor: '#a855f7',
      backgroundColor: 'rgba(168,85,247,0.15)',
      fill: true,
      tension: 0.35,
      pointRadius: DATA.months.map(m => m === DATA.summary.open_invoice ? 6 : 4),
      pointBackgroundColor: DATA.months.map(m => m === DATA.summary.open_invoice ? '#ffb454' : '#a855f7'),
      segment: {
        borderDash: ctx => DATA.months[ctx.p1DataIndex] === DATA.summary.open_invoice ? [6, 4] : undefined,
      },
    }]
  },
  options: {
    plugins: { legend: { display: false } },
    scales: {
      y: { ticks: { color: '#9aa1b0', callback: v => 'R$ ' + v }, grid: { color: '#2a2f3a' } },
      x: { ticks: { color: '#9aa1b0' }, grid: { display: false } }
    }
  }
});

new Chart(document.getElementById('categoryChart'), {
  type: 'doughnut',
  data: {
    labels: DATA.categories.map(c => c.name),
    datasets: [{
      data: DATA.categories.map(c => c.amount),
      backgroundColor: DATA.categories.map(c => categoryColor(c.name)),
      borderColor: '#171a21',
      borderWidth: 2,
    }]
  },
  options: {
    plugins: {
      legend: { position: 'bottom', labels: { color: '#eef0f4', boxWidth: 12, font: { size: 11 } } }
    }
  }
});

new Chart(document.getElementById('forecastChart'), {
  type: 'bar',
  data: {
    labels: DATA.forecast.months.map(fmtMonth),
    datasets: [{
      label: 'Previsto (parcelas restantes)',
      data: DATA.forecast.amounts,
      backgroundColor: '#ff5c5c',
      borderRadius: 6,
    }]
  },
  options: {
    plugins: { legend: { display: false } },
    scales: {
      y: { ticks: { color: '#9aa1b0', callback: v => 'R$ ' + v }, grid: { color: '#2a2f3a' } },
      x: { ticks: { color: '#9aa1b0' }, grid: { display: false } }
    }
  }
});

document.querySelector('#openPlansTable tbody').innerHTML = DATA.forecast.open_plans.map(p => `
  <tr>
    <td>${p.title}</td>
    <td>${p.current_installment}/${p.total_installments} <span class="sub" style="display:block;color:var(--text-dim);font-size:11px">até ${fmtMonth(p.last_month)}</span></td>
    <td class="amount">${fmtBRL(p.installment_amount)}</td>
    <td class="amount">${fmtBRL(p.remaining_total)}</td>
  </tr>
`).join('') || '<tr><td colspan="4" style="color:var(--text-dim)">Nenhuma compra parcelada em aberto</td></tr>';

document.querySelector('#topExpensesTable tbody').innerHTML = DATA.top_expenses.map(t => `
  <tr><td>${t.date}</td><td>${t.title}</td><td>${categoryTag(t.category)}</td><td class="amount">${fmtBRL(t.amount)}</td></tr>
`).join('');

document.querySelector('#topMerchantsTable tbody').innerHTML = DATA.top_merchants.map(m => `
  <tr><td>${m.name}</td><td>${m.count}</td><td class="amount">${fmtBRL(m.amount)}</td></tr>
`).join('');

const categoryFilter = document.getElementById('categoryFilter');
const monthFilter = document.getElementById('monthFilter');
categoryFilter.innerHTML = '<option value="">Todas categorias</option>' +
  DATA.categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
monthFilter.innerHTML = '<option value="">Todos os meses</option>' +
  DATA.months.map(m => `<option value="${m}">${fmtMonth(m)}</option>`).join('');

function renderAllExpenses() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const cat = categoryFilter.value;
  const month = monthFilter.value;
  const rows = DATA.all_expenses.filter(t =>
    (!search || t.title.toLowerCase().includes(search)) &&
    (!cat || t.category === cat) &&
    (!month || t.date.startsWith(month))
  );
  document.getElementById('tx-count').textContent = `(${rows.length})`;
  document.querySelector('#allExpensesTable tbody').innerHTML = rows.map(t => `
    <tr><td>${t.date}</td><td>${t.title}</td><td>${categoryTag(t.category)}</td><td class="amount">${fmtBRL(t.amount)}</td></tr>
  `).join('');
}
document.getElementById('searchInput').addEventListener('input', renderAllExpenses);
categoryFilter.addEventListener('change', renderAllExpenses);
monthFilter.addEventListener('change', renderAllExpenses);
renderAllExpenses();
</script>
</body>
</html>
"""


def main():
    transactions = load_transactions()
    data = build_report_data(transactions)
    html = HTML_TEMPLATE.replace("__DATA_JSON__", json.dumps(data, ensure_ascii=False))
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Transações processadas: {len(transactions)}")
    print(f"Relatório gerado em: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
