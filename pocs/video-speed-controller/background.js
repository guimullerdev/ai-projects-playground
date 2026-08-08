const DEFAULT_SPEED = 1;

function speedKey(tabId) {
  return `speed_${tabId}`;
}

async function getSpeed(tabId) {
  const key = speedKey(tabId);
  const result = await chrome.storage.session.get(key);
  return typeof result[key] === 'number' ? result[key] : DEFAULT_SPEED;
}

async function setSpeed(tabId, speed) {
  await chrome.storage.session.set({ [speedKey(tabId)]: speed });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'vsc-get-speed') {
    const tabId = message.tabId ?? sender.tab?.id;
    if (tabId == null) {
      sendResponse({ speed: DEFAULT_SPEED });
      return;
    }
    getSpeed(tabId).then((speed) => sendResponse({ speed }));
    return true;
  }

  if (message?.type === 'vsc-set-speed') {
    const tabId = message.tabId ?? sender.tab?.id;
    if (tabId == null) return;
    setSpeed(tabId, message.speed).then(() => {
      // Mensagem veio do popup (que não é o content script da aba): avisa a aba para aplicar na hora.
      if (message.tabId != null) {
        chrome.tabs.sendMessage(tabId, { type: 'vsc-apply-speed', speed: message.speed }).catch(() => {});
      }
      sendResponse({ ok: true });
    });
    return true;
  }
});

// Cada aba tem sua própria velocidade; ao fechar, removemos o estado guardado.
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(speedKey(tabId));
});
