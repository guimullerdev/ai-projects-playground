(() => {
  const goalInput = document.getElementById("goal");
  const yearsInput = document.getElementById("years");
  const monthsInput = document.getElementById("months");
  const rateInput = document.getElementById("rate");
  const inflationInput = document.getElementById("inflation");

  const monthlyDepositEl = document.getElementById("monthly-deposit");
  const heroNoteEl = document.getElementById("hero-note");
  const lastDepositEl = document.getElementById("last-deposit");
  const totalDepositedEl = document.getElementById("total-deposited");
  const totalInterestEl = document.getElementById("total-interest");
  const rateAnnualHintEl = document.getElementById("rate-annual-hint");
  const tableBody = document.querySelector("#year-table tbody");
  const svg = document.getElementById("chart");
  const tooltip = document.getElementById("tooltip");

  const currencyFmt = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
  const currencyFmtCents = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  });
  const percentFmt = new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
  });

  function parseLocaleNumber(value) {
    if (typeof value !== "string") return Number(value) || 0;
    const cleaned = value.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  function formatGoalInput(el) {
    const n = parseLocaleNumber(el.value);
    if (n > 0) {
      el.value = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
    }
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const key in attrs) el.setAttribute(key, attrs[key]);
    return el;
  }

  function calculate() {
    const goal = Math.max(parseLocaleNumber(goalInput.value), 0);
    const years = Math.max(parseInt(yearsInput.value, 10) || 0, 0);
    const extraMonths = Math.max(parseInt(monthsInput.value, 10) || 0, 0);
    const monthlyRatePct = Math.max(parseFloat(rateInput.value) || 0, 0);
    const annualInflationPct = Math.max(parseFloat(inflationInput.value) || 0, 0);

    const totalMonths = years * 12 + extraMonths;
    const i = monthlyRatePct / 100;
    const annualInflation = annualInflationPct / 100;
    const totalYearsFraction = totalMonths / 12;

    const annualNominalRate = Math.pow(1 + i, 12) - 1;
    rateAnnualHintEl.textContent = `Equivale a ${percentFmt.format(annualNominalRate * 100)}% ao ano.`;

    if (totalMonths <= 0 || goal <= 0) {
      monthlyDepositEl.textContent = currencyFmtCents.format(0);
      heroNoteEl.textContent = "Informe um prazo e uma meta maiores que zero.";
      lastDepositEl.textContent = "—";
      totalDepositedEl.textContent = "—";
      totalInterestEl.textContent = "—";
      renderChart([]);
      tableBody.innerHTML = "";
      return;
    }

    const adjustedGoal = goal * Math.pow(1 + annualInflation, totalYearsFraction);

    // Aporte mensal crescente: fixo dentro de cada ano, reajustado pela
    // inflação a cada 12 meses. Resolve o valor do 1º ano (firstMonthly) tal
    // que a soma dos valores futuros dos aportes, capitalizados a `i` ao mês,
    // bate com a meta corrigida no fim do prazo.
    let growthFactor = 0; // soma dos fatores de capitalização por mês
    const monthlyLevels = [];
    for (let m = 1; m <= totalMonths; m++) {
      const yearIndex = Math.floor((m - 1) / 12);
      if (monthlyLevels[yearIndex] === undefined) {
        monthlyLevels[yearIndex] = Math.pow(1 + annualInflation, yearIndex);
      }
      growthFactor += monthlyLevels[yearIndex] * Math.pow(1 + i, totalMonths - m);
    }

    const firstMonthlyDeposit = adjustedGoal / growthFactor;
    const lastYearIndex = Math.floor((totalMonths - 1) / 12);
    const lastMonthlyDeposit = firstMonthlyDeposit * monthlyLevels[lastYearIndex];

    let totalDeposited = 0;
    for (let m = 1; m <= totalMonths; m++) {
      const yearIndex = Math.floor((m - 1) / 12);
      totalDeposited += firstMonthlyDeposit * monthlyLevels[yearIndex];
    }
    const totalInterest = adjustedGoal - totalDeposited;

    monthlyDepositEl.textContent = currencyFmtCents.format(firstMonthlyDeposit);
    heroNoteEl.textContent = `Reajustado todo ano pela inflação, até chegar a ${currencyFmtCents.format(lastMonthlyDeposit)}/mês no último ano — para alcançar o equivalente a ${currencyFmt.format(goal)} de hoje em ${formatDuration(years, extraMonths)}.`;
    lastDepositEl.textContent = currencyFmt.format(lastMonthlyDeposit);
    totalDepositedEl.textContent = currencyFmt.format(totalDeposited);
    totalInterestEl.textContent = currencyFmt.format(Math.max(totalInterest, 0));

    const wholeYears = Math.max(Math.ceil(totalYearsFraction), 1);
    const points = [];
    for (let y = 0; y <= wholeYears; y++) {
      const cappedYear = Math.min(y, totalYearsFraction);
      const value = goal * Math.pow(1 + annualInflation, cappedYear);
      const yearIndex = Math.min(y > 0 ? y - 1 : 0, monthlyLevels.length - 1);
      const monthlyDeposit = y === 0 ? firstMonthlyDeposit : firstMonthlyDeposit * monthlyLevels[yearIndex];
      points.push({ year: y, value, monthlyDeposit });
    }

    renderChart(points, goal);
    renderTable(points, goal);
  }

  function formatDuration(years, months) {
    const parts = [];
    if (years > 0) parts.push(`${years} ano${years === 1 ? "" : "s"}`);
    if (months > 0) parts.push(`${months} ${months === 1 ? "mês" : "meses"}`);
    return parts.length ? parts.join(" e ") : "0 meses";
  }

  function renderTable(points, goal) {
    tableBody.innerHTML = "";
    points.forEach((p) => {
      if (p.year === 0) return;
      const diff = p.value - goal;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>Ano ${p.year}</td>
        <td>${currencyFmt.format(p.monthlyDeposit)}</td>
        <td>${currencyFmt.format(p.value)}</td>
        <td>${diff > 0 ? "+" : ""}${currencyFmt.format(diff)}</td>
      `;
      tableBody.appendChild(tr);
    });
  }

  function renderChart(points) {
    svg.innerHTML = "";
    if (points.length < 2) return;

    const width = 640;
    const height = 260;
    const padding = { top: 16, right: 16, bottom: 28, left: 16 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const maxValue = Math.max(...points.map((p) => p.value));
    const minValue = Math.min(...points.map((p) => p.value));
    const yMax = maxValue * 1.08;
    const yMin = Math.min(minValue, 0) * (minValue < 0 ? 1.08 : 1);

    const x = (i) => padding.left + (i / (points.length - 1)) * plotW;
    const y = (v) => padding.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

    // gridlines
    const gridCount = 4;
    for (let g = 0; g <= gridCount; g++) {
      const gy = padding.top + (g / gridCount) * plotH;
      svg.appendChild(
        svgEl("line", {
          class: "grid-line",
          x1: padding.left,
          x2: width - padding.right,
          y1: gy,
          y2: gy,
        })
      );
      const value = yMax - (g / gridCount) * (yMax - yMin);
      const label = svgEl("text", {
        class: "axis-label",
        x: padding.left,
        y: gy - 4,
        "text-anchor": "start",
      });
      label.textContent = compactCurrency(value);
      svg.appendChild(label);
    }

    // area path
    let areaD = `M ${x(0)} ${y(points[0].value)} `;
    points.forEach((p, i2) => {
      areaD += `L ${x(i2)} ${y(p.value)} `;
    });
    areaD += `L ${x(points.length - 1)} ${padding.top + plotH} L ${x(0)} ${padding.top + plotH} Z`;
    svg.appendChild(svgEl("path", { class: "area-fill", d: areaD }));

    // line path
    let lineD = `M ${x(0)} ${y(points[0].value)} `;
    points.forEach((p, i2) => {
      if (i2 === 0) return;
      lineD += `L ${x(i2)} ${y(p.value)} `;
    });
    svg.appendChild(svgEl("path", { class: "line-path", d: lineD }));

    // x-axis year labels (sparse)
    const labelStep = Math.max(Math.ceil(points.length / 6), 1);
    points.forEach((p, i2) => {
      if (i2 % labelStep !== 0 && i2 !== points.length - 1) return;
      const label = svgEl("text", {
        class: "axis-label",
        x: x(i2),
        y: height - 8,
        "text-anchor": i2 === points.length - 1 ? "end" : "middle",
      });
      label.textContent = `Ano ${p.year}`;
      svg.appendChild(label);
    });

    // endpoint marker
    const last = points[points.length - 1];
    svg.appendChild(
      svgEl("circle", {
        class: "end-point",
        cx: x(points.length - 1),
        cy: y(last.value),
        r: 4,
      })
    );

    // hover interaction
    const crosshair = svgEl("line", {
      class: "crosshair",
      x1: 0,
      x2: 0,
      y1: padding.top,
      y2: padding.top + plotH,
    });
    const hoverPoint = svgEl("circle", { class: "hover-point", r: 5 });
    svg.appendChild(crosshair);
    svg.appendChild(hoverPoint);

    const hoverTarget = svgEl("rect", {
      class: "hover-target",
      x: padding.left,
      y: padding.top,
      width: plotW,
      height: plotH,
    });
    svg.appendChild(hoverTarget);

    hoverTarget.addEventListener("mousemove", (evt) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((evt.clientX - rect.left) / rect.width) * width;
      const ratio = Math.min(Math.max((relX - padding.left) / plotW, 0), 1);
      const idx = Math.round(ratio * (points.length - 1));
      const p = points[idx];

      crosshair.setAttribute("x1", x(idx));
      crosshair.setAttribute("x2", x(idx));
      crosshair.setAttribute("opacity", 1);
      hoverPoint.setAttribute("cx", x(idx));
      hoverPoint.setAttribute("cy", y(p.value));
      hoverPoint.setAttribute("opacity", 1);

      const svgRect = svg.getBoundingClientRect();
      const px = (x(idx) / width) * svgRect.width;
      const py = (y(p.value) / height) * svgRect.height;
      tooltip.style.left = `${px}px`;
      tooltip.style.top = `${py}px`;
      tooltip.hidden = false;
      tooltip.querySelector(".tooltip-year").textContent = `Ano ${p.year}`;
      tooltip.querySelector(".tooltip-value").textContent = currencyFmt.format(p.value);
    });

    hoverTarget.addEventListener("mouseleave", () => {
      crosshair.setAttribute("opacity", 0);
      hoverPoint.setAttribute("opacity", 0);
      tooltip.hidden = true;
    });
  }

  function compactCurrency(value) {
    if (Math.abs(value) >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}k`;
    return `R$ ${value.toFixed(0)}`;
  }

  const inputs = [goalInput, yearsInput, monthsInput, rateInput, inflationInput];
  inputs.forEach((el) => el.addEventListener("input", calculate));
  goalInput.addEventListener("blur", () => {
    formatGoalInput(goalInput);
    calculate();
  });

  formatGoalInput(goalInput);
  calculate();
})();
