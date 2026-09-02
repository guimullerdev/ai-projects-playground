'use strict';

// Preferences window. Saves on change instead of behind a "Salvar" button: the
// form is four fields, every one of them applies to the running app
// immediately, and a save button would only add a state to get wrong.

const els = {
  trayTitle: document.getElementById('tray-title'),
  notifyEnabled: document.getElementById('notify-enabled'),
  thresholdWarn: document.getElementById('threshold-warn'),
  thresholdDanger: document.getElementById('threshold-danger'),
  burnNotify: document.getElementById('burn-notify'),
  reportDays: document.getElementById('report-days'),
  reset: document.getElementById('reset'),
  status: document.getElementById('status'),
  configPath: document.getElementById('config-path'),
};

const FLASH_MS = 2500;

let defaults = null;
let statusFlash = null;

init();

async function init() {
  const { config, defaults: fallback, configPath } = await window.claudeStatusbar.getPrefs();
  defaults = fallback;
  els.configPath.textContent = configPath;
  fill(config);

  for (const el of [els.trayTitle, els.notifyEnabled, els.thresholdWarn, els.thresholdDanger, els.burnNotify, els.reportDays]) {
    // 'change', not 'input': a number field mid-typing ("7" on the way to "75")
    // is not a preference, and saving it would notify at the wrong percentage.
    el.addEventListener('change', apply);
  }

  els.reset.addEventListener('click', () => {
    fill(defaults);
    apply();
  });
}

function fill(config) {
  els.trayTitle.value = config.trayTitle;
  els.burnNotify.checked = config.burnNotify;
  els.reportDays.value = String(config.reportDays);

  // The two inputs are the stored thresholds in ascending order; an empty list
  // means "don't notify", so the defaults stay visible in the disabled fields
  // instead of leaving the user with two blanks to guess at.
  const [warn, danger] = config.thresholds.length ? config.thresholds : defaults.thresholds;
  els.notifyEnabled.checked = config.thresholds.length > 0;
  els.thresholdWarn.value = String(warn);
  els.thresholdDanger.value = String(danger ?? warn);
  syncEnabled();
}

function syncEnabled() {
  const on = els.notifyEnabled.checked;
  els.thresholdWarn.disabled = !on;
  els.thresholdDanger.disabled = !on;
}

async function apply() {
  syncEnabled();
  const patch = {
    trayTitle: els.trayTitle.value,
    thresholds: els.notifyEnabled.checked
      ? [Number(els.thresholdWarn.value), Number(els.thresholdDanger.value)]
      : [],
    burnNotify: els.burnNotify.checked,
    reportDays: Number(els.reportDays.value),
  };

  const result = await window.claudeStatusbar.savePrefs(patch);
  if (result && result.ok) {
    // Re-fills from what was actually saved, not from what was typed: the
    // config clamps and sorts, and the form has to show the value that's live.
    fill(result.config);
    flash('salvo', false);
  } else {
    flash(result && result.error ? `não salvou: ${result.error}` : 'não salvou', true);
  }
}

function flash(message, isError) {
  clearTimeout(statusFlash);
  els.status.textContent = message;
  els.status.classList.toggle('is-error', isError);
  // An error stays put: it's the one message worth reading twice.
  if (isError) return;
  statusFlash = setTimeout(() => {
    els.status.textContent = '';
  }, FLASH_MS);
}
