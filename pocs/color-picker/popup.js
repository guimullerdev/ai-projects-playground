const HISTORY_KEY = "colorHistory";
const HISTORY_LIMIT = 16;

const pickBtn = document.getElementById("pick-btn");
const unsupportedEl = document.getElementById("unsupported");
const resultEl = document.getElementById("result");
const swatchEl = document.getElementById("swatch");
const hexInput = document.getElementById("hex-value");
const rgbInput = document.getElementById("rgb-value");
const historyList = document.getElementById("history-list");
const clearHistoryBtn = document.getElementById("clear-history");

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

function showColor(hex) {
  swatchEl.style.background = hex;
  hexInput.value = hex.toUpperCase();
  rgbInput.value = hexToRgb(hex);
  resultEl.classList.remove("hidden");
}

async function loadHistory() {
  const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get(HISTORY_KEY);
  return history;
}

async function saveToHistory(hex) {
  let history = await loadHistory();
  history = [hex, ...history.filter((c) => c !== hex)].slice(0, HISTORY_LIMIT);
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
  renderHistory(history);
}

function renderHistory(history) {
  historyList.innerHTML = "";
  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "Nenhuma cor capturada ainda.";
    historyList.appendChild(empty);
    return;
  }
  for (const hex of history) {
    const btn = document.createElement("button");
    btn.className = "history-swatch";
    btn.style.background = hex;
    btn.title = hex.toUpperCase();
    btn.addEventListener("click", () => showColor(hex));
    historyList.appendChild(btn);
  }
}

async function pickColor() {
  if (!window.EyeDropper) return;
  pickBtn.disabled = true;
  try {
    const eyeDropper = new EyeDropper();
    const result = await eyeDropper.open();
    showColor(result.sRGBHex);
    await saveToHistory(result.sRGBHex);
  } catch (err) {
    // usuário cancelou a seleção (Esc ou clique fora) — nada a fazer
  } finally {
    pickBtn.disabled = false;
  }
}

async function copyValue(targetId, btn) {
  const input = document.getElementById(targetId);
  await navigator.clipboard.writeText(input.value);
  const original = btn.textContent;
  btn.textContent = "Copiado!";
  btn.classList.add("copied");
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove("copied");
  }, 1200);
}

document.addEventListener("click", (e) => {
  const copyBtn = e.target.closest(".copy-btn");
  if (copyBtn) {
    copyValue(copyBtn.dataset.target, copyBtn);
  }
});

pickBtn.addEventListener("click", pickColor);

clearHistoryBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  renderHistory([]);
});

(function init() {
  if (!window.EyeDropper) {
    pickBtn.disabled = true;
    unsupportedEl.classList.remove("hidden");
  }
  loadHistory().then(renderHistory);
})();
