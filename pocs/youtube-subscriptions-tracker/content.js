// Roda em youtube.com/feed/channels e extrai a lista de canais inscritos.
// O layout do YouTube muda com frequência, então usamos seletores com fallback.

function extractChannels() {
  const channels = new Map();

  const anchors = document.querySelectorAll('a[href^="/channel/"]');

  anchors.forEach((anchor) => {
    const match = anchor.getAttribute('href').match(/^\/channel\/(UC[\w-]+)/);
    if (!match) return;
    const channelId = match[1];
    if (channels.has(channelId)) return;

    const container =
      anchor.closest('ytd-channel-renderer') ||
      anchor.closest('ytd-grid-channel-renderer') ||
      anchor.parentElement;

    const img = container?.querySelector('img');
    const nameEl =
      container?.querySelector('#text, #channel-title, yt-formatted-string#text') ||
      anchor;

    const name = (nameEl.textContent || anchor.getAttribute('title') || channelId).trim();
    const avatar = img?.src || '';

    channels.set(channelId, { channelId, name, avatar });
  });

  return Array.from(channels.values());
}

function sendChannels() {
  const channels = extractChannels();
  if (channels.length === 0) return;
  chrome.runtime.sendMessage({ type: 'CHANNELS_SCRAPED', channels });
}

// A página carrega canais de forma incremental (scroll infinito) e via SPA navigation,
// então observamos mudanças no DOM além de rodar uma vez no carregamento.
const observer = new MutationObserver(() => {
  clearTimeout(window.__ytSubTrackerTimeout);
  window.__ytSubTrackerTimeout = setTimeout(sendChannels, 800);
});

observer.observe(document.body, { childList: true, subtree: true });

sendChannels();
