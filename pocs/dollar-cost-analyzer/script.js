(() => {
  const LAST_URL = "https://economia.awesomeapi.com.br/json/last/USD-BRL";
  const DAILY_URL = "https://economia.awesomeapi.com.br/json/daily/USD-BRL/30";

  const statusBanner = document.getElementById("status-banner");
  const bidValueEl = document.getElementById("bid-value");
  const askValueEl = document.getElementById("ask-value");
  const changeValueEl = document.getElementById("change-value");
  const highTodayEl = document.getElementById("high-today");
  const lowTodayEl = document.getElementById("low-today");
  const avg7El = document.getElementById("avg-7");
  const avg30El = document.getElementById("avg-30");
  const updatedAtEl = document.getElementById("updated-at");
  const refreshBtn = document.getElementById("refresh-btn");
  const huskyInput = document.getElementById("husky-rate");
  const huskyCompare = document.getElementById("husky-compare");
  const huskyCompareText = document.getElementById("husky-compare-text");
  const recommendation = document.getElementById("recommendation");
  const recommendationIcon = document.getElementById("recommendation-icon");
  const recommendationTitle = document.getElementById("recommendation-title");
  const recommendationText = document.getElementById("recommendation-text");
  const svg = document.getElementById("chart");
  const tooltip = document.getElementById("tooltip");
  const newsCard = document.getElementById("news-card");
  const newsGeneratedAt = document.getElementById("news-generated-at");
  const newsOutlook = document.getElementById("news-outlook");
  const newsList = document.getElementById("news-list");

  const rateFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const currencyFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const percentFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" });
  const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
  const timeFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

  let history = []; // chronological, oldest first: { date, bid, ask }

  async function loadData() {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Atualizando…";
    hideStatus();
    try {
      const [lastRes, dailyRes] = await Promise.all([fetch(LAST_URL), fetch(DAILY_URL)]);
      if (!lastRes.ok || !dailyRes.ok) throw new Error("Falha na resposta da API");
      const lastData = await lastRes.json();
      const dailyData = await dailyRes.json();

      const last = lastData.USDBRL;
      history = dailyData
        .map((d) => ({
          date: new Date(Number(d.timestamp) * 1000),
          bid: parseFloat(d.bid),
          ask: parseFloat(d.ask),
        }))
        .reverse();

      renderCurrent(last);
      renderStats(history, last);
      renderChart(history);
      renderRecommendation(history, last);
      renderHuskyCompare(last);
    } catch (err) {
      showStatus("Não foi possível carregar a cotação agora. Tente atualizar de novo em instantes.");
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = "Atualizar cotação";
    }
  }

  function showStatus(msg) {
    statusBanner.textContent = msg;
    statusBanner.hidden = false;
  }

  function hideStatus() {
    statusBanner.hidden = true;
  }

  function renderCurrent(last) {
    const bid = parseFloat(last.bid);
    const ask = parseFloat(last.ask);
    const pctChange = parseFloat(last.pctChange);

    bidValueEl.textContent = currencyFmt.format(bid);
    askValueEl.textContent = currencyFmt.format(ask);
    changeValueEl.textContent = `${percentFmt.format(pctChange)}% hoje`;
    changeValueEl.classList.toggle("up", pctChange >= 0);
    changeValueEl.classList.toggle("down", pctChange < 0);

    highTodayEl.textContent = currencyFmt.format(parseFloat(last.high));
    lowTodayEl.textContent = currencyFmt.format(parseFloat(last.low));

    const updated = new Date(Number(last.timestamp) * 1000);
    updatedAtEl.textContent = `Atualizado às ${timeFmt.format(updated)}`;
  }

  function average(values) {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  function renderStats(hist, last) {
    const bids = hist.map((h) => h.bid);
    const last7 = bids.slice(-7);
    avg7El.textContent = currencyFmt.format(average(last7));
    avg30El.textContent = currencyFmt.format(average(bids));
  }

  function renderRecommendation(hist, last) {
    const bids = hist.map((h) => h.bid);
    const bid = parseFloat(last.bid);
    const min30 = Math.min(...bids);
    const max30 = Math.max(...bids);
    const range = max30 - min30 || 1;
    const position = (bid - min30) / range; // 0 = mínima do período, 1 = máxima

    const last7 = bids.slice(-7);
    const prior7 = bids.slice(-14, -7);
    const recentAvg = average(last7.length ? last7 : bids);
    const priorAvg = average(prior7.length ? prior7 : bids);
    const trendPct = priorAvg ? ((recentAvg - priorAvg) / priorAvg) * 100 : 0;
    const trendUp = trendPct > 0.15;
    const trendDown = trendPct < -0.15;

    let signal, icon, title, text;

    if (position >= 0.75) {
      signal = "signal-good";
      icon = "💰";
      title = "Perto da máxima dos últimos 30 dias";
      text = `O dólar está a ${percentFmt.format((position - 1) * 100 * -1 * -1).replace("+", "")}% do topo da faixa recente (mín. ${currencyFmt.format(min30)} / máx. ${currencyFmt.format(max30)})${trendUp ? ", e ainda em alta" : ""}. Historicamente é um momento mais favorável pra converter do que esperar.`;
    } else if (position <= 0.25) {
      signal = "signal-wait";
      icon = "⏳";
      title = "Perto da mínima dos últimos 30 dias";
      text = `O dólar está próximo do piso da faixa recente (mín. ${currencyFmt.format(min30)} / máx. ${currencyFmt.format(max30)})${trendDown ? " e ainda em queda" : ""}. Pode valer esperar uma recuperação antes de converter, se não houver urgência.`;
    } else {
      signal = "";
      icon = "➖";
      title = "Faixa intermediária, sem sinal claro";
      text = `O dólar está no meio da faixa dos últimos 30 dias (mín. ${currencyFmt.format(min30)} / máx. ${currencyFmt.format(max30)}), ${trendUp ? "com leve tendência de alta" : trendDown ? "com leve tendência de queda" : "estável"} na última semana. Não há sinal forte pra converter agora ou esperar.`;
    }

    recommendation.className = `recommendation ${signal}`;
    recommendationIcon.textContent = icon;
    recommendationTitle.textContent = title;
    recommendationText.textContent = text;
  }

  function renderHuskyCompare(last) {
    const huskyRate = parseFloat(huskyInput.value);
    if (!huskyRate || huskyRate <= 0) {
      huskyCompare.hidden = true;
      return;
    }
    const bid = parseFloat(last.bid);
    const spreadPct = ((bid - huskyRate) / bid) * 100;
    huskyCompare.hidden = false;
    huskyCompareText.className = spreadPct > 0 ? "spread-bad" : "spread-good";
    if (Math.abs(spreadPct) < 0.05) {
      huskyCompareText.textContent = `A Husky está oferecendo praticamente o mesmo do dólar comercial (${currencyFmt.format(huskyRate)}).`;
    } else if (spreadPct > 0) {
      huskyCompareText.textContent = `A Husky está ${percentFmt.format(spreadPct)}% abaixo do dólar comercial (${currencyFmt.format(huskyRate)} vs ${currencyFmt.format(bid)}) — esse é o spread/taxa embutido.`;
    } else {
      huskyCompareText.textContent = `A Husky está oferecendo acima do dólar comercial (${currencyFmt.format(huskyRate)} vs ${currencyFmt.format(bid)}).`;
    }
  }

  function renderNews() {
    const news = window.MARKET_NEWS;
    if (!news || !news.items || !news.items.length) {
      newsCard.hidden = true;
      return;
    }
    newsCard.hidden = false;
    const generated = new Date(news.generatedAt);
    newsGeneratedAt.textContent = `Gerado em ${dateFmt.format(generated)} às ${timeFmt.format(generated)} — não é ao vivo, ver plan.md`;
    newsOutlook.textContent = news.outlook;

    newsList.innerHTML = "";
    news.items.forEach((item) => {
      const li = document.createElement("li");
      const itemDate = item.date ? dateFmt.format(new Date(`${item.date}T12:00:00`)) : "";
      li.innerHTML = `
        <p class="news-item-title">${item.title}</p>
        <p class="news-item-summary">${item.summary}</p>
        <p class="news-item-meta">${item.source}${itemDate ? " · " + itemDate : ""}</p>
      `;
      newsList.appendChild(li);
    });
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const key in attrs) el.setAttribute(key, attrs[key]);
    return el;
  }

  function renderChart(points) {
    svg.innerHTML = "";
    if (points.length < 2) return;

    const width = 640;
    const height = 260;
    const padding = { top: 16, right: 16, bottom: 28, left: 44 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const allValues = points.flatMap((p) => [p.bid, p.ask]);
    const maxValue = Math.max(...allValues);
    const minValue = Math.min(...allValues);
    const pad = (maxValue - minValue) * 0.15 || maxValue * 0.01;
    const yMax = maxValue + pad;
    const yMin = minValue - pad;

    const x = (i) => padding.left + (i / (points.length - 1)) * plotW;
    const y = (v) => padding.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

    const gridCount = 4;
    for (let g = 0; g <= gridCount; g++) {
      const gy = padding.top + (g / gridCount) * plotH;
      svg.appendChild(svgEl("line", { class: "grid-line", x1: padding.left, x2: width - padding.right, y1: gy, y2: gy }));
      const value = yMax - (g / gridCount) * (yMax - yMin);
      const label = svgEl("text", { class: "axis-label", x: padding.left - 6, y: gy + 3, "text-anchor": "end" });
      label.textContent = rateFmt.format(value);
      svg.appendChild(label);
    }

    function linePath(key) {
      let d = `M ${x(0)} ${y(points[0][key])} `;
      points.forEach((p, i2) => {
        if (i2 === 0) return;
        d += `L ${x(i2)} ${y(p[key])} `;
      });
      return d;
    }

    svg.appendChild(svgEl("path", { class: "line-sell", d: linePath("ask") }));
    svg.appendChild(svgEl("path", { class: "line-buy", d: linePath("bid") }));

    const labelStep = Math.max(Math.ceil(points.length / 6), 1);
    points.forEach((p, i2) => {
      if (i2 % labelStep !== 0 && i2 !== points.length - 1) return;
      const label = svgEl("text", { class: "axis-label", x: x(i2), y: height - 8, "text-anchor": i2 === points.length - 1 ? "end" : "middle" });
      label.textContent = dateFmt.format(p.date);
      svg.appendChild(label);
    });

    const last = points[points.length - 1];
    svg.appendChild(svgEl("circle", { class: "end-point buy", cx: x(points.length - 1), cy: y(last.bid), r: 4 }));
    svg.appendChild(svgEl("circle", { class: "end-point sell", cx: x(points.length - 1), cy: y(last.ask), r: 4 }));

    const crosshair = svgEl("line", { class: "crosshair", x1: 0, x2: 0, y1: padding.top, y2: padding.top + plotH });
    const hoverBuy = svgEl("circle", { class: "hover-point end-point buy", r: 5 });
    const hoverSell = svgEl("circle", { class: "hover-point end-point sell", r: 5 });
    svg.appendChild(crosshair);
    svg.appendChild(hoverBuy);
    svg.appendChild(hoverSell);

    const hoverTarget = svgEl("rect", { class: "hover-target", x: padding.left, y: padding.top, width: plotW, height: plotH });
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
      hoverBuy.setAttribute("cx", x(idx));
      hoverBuy.setAttribute("cy", y(p.bid));
      hoverBuy.setAttribute("opacity", 1);
      hoverSell.setAttribute("cx", x(idx));
      hoverSell.setAttribute("cy", y(p.ask));
      hoverSell.setAttribute("opacity", 1);

      const svgRect = svg.getBoundingClientRect();
      const px = (x(idx) / width) * svgRect.width;
      const py = (Math.min(y(p.bid), y(p.ask)) / height) * svgRect.height;
      tooltip.style.left = `${px}px`;
      tooltip.style.top = `${py}px`;
      tooltip.hidden = false;
      tooltip.querySelector(".tooltip-date").textContent = dateFmt.format(p.date);
      tooltip.querySelector(".tooltip-buy").textContent = `Compra: ${currencyFmt.format(p.bid)}`;
      tooltip.querySelector(".tooltip-sell").textContent = `Venda: ${currencyFmt.format(p.ask)}`;
    });

    hoverTarget.addEventListener("mouseleave", () => {
      crosshair.setAttribute("opacity", 0);
      hoverBuy.setAttribute("opacity", 0);
      hoverSell.setAttribute("opacity", 0);
      tooltip.hidden = true;
    });
  }

  refreshBtn.addEventListener("click", loadData);
  huskyInput.addEventListener("input", () => {
    if (history.length) {
      fetch(LAST_URL)
        .then((r) => r.json())
        .then((d) => renderHuskyCompare(d.USDBRL))
        .catch(() => {});
    }
  });

  renderNews();
  loadData();
})();
