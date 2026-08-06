(() => {
  const STORAGE_KEY = "budget-planner:v1";

  const DEFAULT_CATEGORIES = [
    "Transporte", "Alimentação", "Assinaturas", "Educação", "Viagem",
    "Compras", "Saúde", "Telecomunicações", "Serviços", "Encargos", "Outros",
  ];

  // Mesmas categorias/cores do nubank-expenses-analyzer, pra manter os dois POCs consistentes.
  const CATEGORY_COLORS = {
    "Outros": "#8a05be",
    "Alimentação": "#2f7dd1",
    "Transporte": "#1f6f5c",
    "Educação": "#b3872a",
    "Saúde": "#b3402a",
    "Viagem": "#7c3aed",
    "Compras": "#0f9488",
    "Telecomunicações": "#d6428f",
    "Assinaturas": "#c99a12",
    "Serviços": "#3b6fd6",
    "Encargos": "#c1493a",
  };
  const FALLBACK_COLOR = "#5d655f";

  const MONTH_NAMES = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];

  const currencyFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

  const els = {
    statusBanner: document.getElementById("status-banner"),
    form: document.getElementById("expense-form"),
    dateInput: document.getElementById("expense-date"),
    titleInput: document.getElementById("expense-title"),
    categorySelect: document.getElementById("expense-category"),
    amountInput: document.getElementById("expense-amount"),
    suggestHint: document.getElementById("suggest-hint"),
    suggestBtn: document.getElementById("suggest-btn"),
    limitsList: document.getElementById("limits-list"),
    newCategoryInput: document.getElementById("new-category"),
    addCategoryBtn: document.getElementById("add-category-btn"),
    monthSelect: document.getElementById("month-select"),
    totalSpent: document.getElementById("total-spent"),
    totalBudget: document.getElementById("total-budget"),
    totalRemaining: document.getElementById("total-remaining"),
    categoryBars: document.getElementById("category-bars"),
    expenseCount: document.getElementById("expense-count"),
    expensesTableBody: document.querySelector("#expenses-table tbody"),
  };

  let state = loadState();
  let nubankSuggestions = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) throw new Error("empty");
      const parsed = JSON.parse(raw);
      return {
        categories: Array.isArray(parsed.categories) && parsed.categories.length
          ? parsed.categories
          : [...DEFAULT_CATEGORIES],
        limits: parsed.limits && typeof parsed.limits === "object" ? parsed.limits : {},
        expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      };
    } catch {
      return { categories: [...DEFAULT_CATEGORIES], limits: {}, expenses: [] };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function categoryColor(name) {
    return CATEGORY_COLORS[name] || FALLBACK_COLOR;
  }

  function todayISO() {
    const d = new Date();
    const tzOffsetMs = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
  }

  function monthKey(dateStr) {
    return dateStr.slice(0, 7);
  }

  function monthLabel(key) {
    const [y, m] = key.split("-");
    return `${MONTH_NAMES[parseInt(m, 10) - 1]}/${y}`;
  }

  function formatDate(dateStr) {
    const [y, m, d] = dateStr.split("-");
    return `${d}/${m}/${y.slice(2)}`;
  }

  // ---------- Category select / limits sidebar ----------

  function renderCategorySelect() {
    const current = els.categorySelect.value;
    els.categorySelect.innerHTML = state.categories.map(c => `<option value="${c}">${c}</option>`).join("");
    if (state.categories.includes(current)) els.categorySelect.value = current;
  }

  function renderLimitsList() {
    els.limitsList.innerHTML = state.categories.map(cat => {
      const value = state.limits[cat] || 0;
      return `
        <div class="limit-row">
          <span class="limit-name">${cat}</span>
          <div class="input-prefix">
            <span>R$</span>
            <input type="number" min="0" step="10" class="limit-input" data-category="${cat}" value="${value || ""}" placeholder="0" />
          </div>
        </div>
      `;
    }).join("");
  }

  els.limitsList.addEventListener("input", (e) => {
    if (!e.target.classList.contains("limit-input")) return;
    const cat = e.target.dataset.category;
    const value = parseFloat(e.target.value) || 0;
    state.limits[cat] = value;
    saveState();
    render();
  });

  els.addCategoryBtn.addEventListener("click", () => {
    const name = els.newCategoryInput.value.trim();
    if (!name) return;
    if (!state.categories.includes(name)) {
      state.categories.push(name);
      saveState();
      renderCategorySelect();
      renderLimitsList();
    }
    els.newCategoryInput.value = "";
    els.categorySelect.value = name;
  });

  // ---------- Expense form ----------

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const date = els.dateInput.value || todayISO();
    const title = els.titleInput.value.trim();
    const category = els.categorySelect.value;
    const amount = parseFloat(els.amountInput.value);
    if (!title || !category || !amount || amount <= 0) return;

    state.expenses.push({ id: uid(), date, title, category, amount });
    saveState();

    els.titleInput.value = "";
    els.amountInput.value = "";
    els.titleInput.focus();

    renderMonthSelect(monthKey(date));
    render();
  });

  els.expensesTableBody.addEventListener("click", (e) => {
    const btn = e.target.closest(".delete-btn");
    if (!btn) return;
    state.expenses = state.expenses.filter(x => x.id !== btn.dataset.id);
    saveState();
    render();
  });

  // ---------- Month select ----------

  function availableMonths() {
    const months = new Set(state.expenses.map(x => monthKey(x.date)));
    months.add(monthKey(todayISO()));
    return Array.from(months).sort().reverse();
  }

  function renderMonthSelect(preferred) {
    const months = availableMonths();
    const current = preferred || els.monthSelect.value || monthKey(todayISO());
    els.monthSelect.innerHTML = months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join("");
    els.monthSelect.value = months.includes(current) ? current : months[0];
  }

  els.monthSelect.addEventListener("change", render);

  // ---------- Integração com nubank-expenses-analyzer (opcional) ----------

  function loadNubankData() {
    const script = document.createElement("script");
    script.src = "../nubank-expenses-analyzer/report-data.js";
    script.onload = () => {
      // report-data.js declara `const DATA = {...}` num script clássico: isso vira uma
      // binding léxica global visível como identificador solto `DATA`, não `window.DATA`.
      if (typeof DATA !== "undefined" && DATA && Array.isArray(DATA.categories)) {
        nubankSuggestions = computeSuggestions(DATA);
        const months = DATA.summary?.months_count || 0;
        els.suggestHint.textContent = months
          ? `Histórico encontrado (${months} fatura${months === 1 ? "" : "s"} fechada${months === 1 ? "" : "s"}) — sugestão é uma média simples por categoria, ajuste como quiser.`
          : "Histórico encontrado, mas sem faturas fechadas suficientes pra sugerir médias.";
        els.suggestBtn.hidden = !months;
      } else {
        showNoNubankHint();
      }
    };
    script.onerror = showNoNubankHint;
    document.body.appendChild(script);
  }

  function showNoNubankHint() {
    els.suggestHint.textContent = "Sem histórico do nubank-expenses-analyzer nesta pasta — limites ficam manuais. Rode analyze.py lá (ver plan.md) pra habilitar a sugestão automática.";
    els.suggestBtn.hidden = true;
  }

  function computeSuggestions(data) {
    const monthsCount = data.summary?.months_count || 1;
    const suggestions = {};
    for (const c of data.categories) {
      suggestions[c.name] = Math.max(0, Math.round(c.amount / monthsCount / 10) * 10);
    }
    return suggestions;
  }

  els.suggestBtn.addEventListener("click", () => {
    if (!nubankSuggestions) return;
    for (const [cat, value] of Object.entries(nubankSuggestions)) {
      if (!state.categories.includes(cat)) state.categories.push(cat);
      state.limits[cat] = value;
    }
    saveState();
    renderCategorySelect();
    renderLimitsList();
    render();
  });

  // ---------- Render principal ----------

  function render() {
    renderMonthSelect();
    const month = els.monthSelect.value;
    const monthExpenses = state.expenses.filter(x => monthKey(x.date) === month);

    const spentByCategory = {};
    let totalSpent = 0;
    for (const x of monthExpenses) {
      spentByCategory[x.category] = (spentByCategory[x.category] || 0) + x.amount;
      totalSpent += x.amount;
    }

    const totalBudget = state.categories.reduce((sum, c) => sum + (state.limits[c] || 0), 0);
    const remaining = totalBudget - totalSpent;

    els.totalSpent.textContent = currencyFmt.format(totalSpent);
    els.totalBudget.textContent = currencyFmt.format(totalBudget);
    els.totalRemaining.textContent = currencyFmt.format(remaining);
    els.totalRemaining.classList.toggle("over", remaining < 0);

    renderCategoryBars(spentByCategory);
    renderExpensesTable(monthExpenses);
  }

  function renderCategoryBars(spentByCategory) {
    const rows = state.categories
      .map(cat => ({ cat, spent: spentByCategory[cat] || 0, limit: state.limits[cat] || 0 }))
      .filter(r => r.spent > 0 || r.limit > 0)
      .sort((a, b) => b.spent - a.spent);

    if (!rows.length) {
      els.categoryBars.innerHTML = '<p class="bar-empty">Nenhum gasto ou limite definido pra este mês ainda.</p>';
      return;
    }

    els.categoryBars.innerHTML = rows.map(({ cat, spent, limit }) => {
      const pct = limit > 0 ? (spent / limit) * 100 : (spent > 0 ? 100 : 0);
      const widthPct = Math.min(100, pct);
      let cls = "";
      if (limit > 0) {
        if (pct >= 100) cls = "over";
        else if (pct >= 70) cls = "warn";
      } else if (spent > 0) {
        cls = "over";
      }
      const fullCls = widthPct >= 100 ? " full" : "";
      const limitText = limit > 0 ? `de ${currencyFmt.format(limit)}` : "sem limite definido";
      return `
        <div class="category-bar-row">
          <div class="bar-head">
            <span class="bar-name" style="color:${categoryColor(cat)}">${cat}</span>
            <span class="bar-amounts">${currencyFmt.format(spent)} ${limitText}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill ${cls}${fullCls}" style="width:${widthPct}%"></div>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderExpensesTable(monthExpenses) {
    const sorted = [...monthExpenses].sort((a, b) => b.date.localeCompare(a.date));
    els.expenseCount.textContent = sorted.length;
    els.expensesTableBody.innerHTML = sorted.map(x => `
      <tr>
        <td>${formatDate(x.date)}</td>
        <td>${x.title}</td>
        <td><span class="tag" style="background:${categoryColor(x.category)}22;color:${categoryColor(x.category)}">${x.category}</span></td>
        <td>${currencyFmt.format(x.amount)}</td>
        <td><button class="delete-btn" data-id="${x.id}" type="button" title="Remover">✕</button></td>
      </tr>
    `).join("") || '<tr><td colspan="5" style="color:var(--muted)">Nenhum gasto registrado neste mês</td></tr>';
  }

  // ---------- Init ----------

  els.dateInput.value = todayISO();
  renderCategorySelect();
  renderLimitsList();
  renderMonthSelect();
  render();
  loadNubankData();
})();
