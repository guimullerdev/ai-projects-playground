const DEFAULT_SPEED = 1;
const STEP = 0.1;
const MIN_SPEED = 0.1;
const MAX_SPEED = 4;

const speedDisplay = document.getElementById('speedDisplay');
const speedSlider = document.getElementById('speedSlider');
const decreaseBtn = document.getElementById('decreaseBtn');
const increaseBtn = document.getElementById('increaseBtn');
const resetBtn = document.getElementById('resetBtn');
const presets = document.getElementById('presets');
const autoAdSpeedToggle = document.getElementById('autoAdSpeedToggle');
const adSpeedSelect = document.getElementById('adSpeedSelect');

function clamp(value) {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));
}

function render(speed) {
  speedDisplay.textContent = `${speed.toFixed(2)}x`;
  speedSlider.value = speed;
}

function setSpeed(speed) {
  const clamped = clamp(Number(speed.toFixed(2)));
  render(clamped);
  chrome.storage.sync.set({ globalSpeed: clamped });
}

chrome.storage.sync.get(['globalSpeed', 'adSpeed', 'autoAdSpeedEnabled'], (result) => {
  render(result.globalSpeed || DEFAULT_SPEED);
  autoAdSpeedToggle.checked = result.autoAdSpeedEnabled !== false;
  adSpeedSelect.value = String(result.adSpeed || 4);
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
