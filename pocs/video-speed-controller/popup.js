const DEFAULT_SPEED = 1;
const STEP = 0.1;
const MIN_SPEED = 0.1;
const MAX_SPEED = 16;

const speedDisplay = document.getElementById('speedDisplay');
const speedSlider = document.getElementById('speedSlider');
const decreaseBtn = document.getElementById('decreaseBtn');
const increaseBtn = document.getElementById('increaseBtn');
const resetBtn = document.getElementById('resetBtn');
const presets = document.getElementById('presets');
const autoAdSpeedToggle = document.getElementById('autoAdSpeedToggle');
const adSpeedSelect = document.getElementById('adSpeedSelect');

let activeTabId = null;

function clamp(value) {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));
}

function render(speed) {
  speedDisplay.textContent = `${speed.toFixed(2)}x`;
  speedSlider.value = speed;
}

function setSpeed(speed) {
  if (activeTabId == null) return;
  const clamped = clamp(Number(speed.toFixed(2)));
  render(clamped);
  chrome.runtime.sendMessage({ type: 'vsc-set-speed', tabId: activeTabId, speed: clamped });
}

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  activeTabId = tab?.id ?? null;
  if (activeTabId == null) {
    render(DEFAULT_SPEED);
    return;
  }
  chrome.runtime.sendMessage({ type: 'vsc-get-speed', tabId: activeTabId }, (response) => {
    render(response?.speed ?? DEFAULT_SPEED);
  });
});

// Mantém o popup atualizado se a velocidade mudar por atalho enquanto ele está aberto.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || activeTabId == null) return;
  const change = changes[`speed_${activeTabId}`];
  if (typeof change?.newValue === 'number') render(change.newValue);
});

chrome.storage.sync.get(['adSpeed', 'autoAdSpeedEnabled'], (result) => {
  autoAdSpeedToggle.checked = result.autoAdSpeedEnabled !== false;
  adSpeedSelect.value = String(Math.min(3, result.adSpeed || 3));
});

autoAdSpeedToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ autoAdSpeedEnabled: autoAdSpeedToggle.checked });
});

adSpeedSelect.addEventListener('change', () => {
  chrome.storage.sync.set({ adSpeed: Number(adSpeedSelect.value) });
});

speedSlider.addEventListener('input', (event) => {
  setSpeed(Number(event.target.value));
});

decreaseBtn.addEventListener('click', () => {
  setSpeed(Number(speedSlider.value) - STEP);
});

increaseBtn.addEventListener('click', () => {
  setSpeed(Number(speedSlider.value) + STEP);
});

resetBtn.addEventListener('click', () => {
  setSpeed(DEFAULT_SPEED);
});

presets.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-speed]');
  if (!target) return;
  setSpeed(Number(target.dataset.speed));
});
