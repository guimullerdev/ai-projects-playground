const channelList = document.getElementById('channelList');
const emptyState = document.getElementById('emptyState');
const syncBtn = document.getElementById('syncBtn');
const statusText = document.getElementById('statusText');

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function render(channels) {
  const items = Object.values(channels);
  channelList.innerHTML = '';

  if (items.length === 0) {
    emptyState.classList.remove('hidden');
    statusText.textContent = '';
    return;
  }

  emptyState.classList.add('hidden');

  items
    .sort((a, b) => Number(b.hasNew) - Number(a.hasNew) || a.name.localeCompare(b.name))
    .forEach((channel) => {
      const li = document.createElement('li');
      li.className = 'channel-item' + (channel.hasNew ? ' has-new' : '');

      const img = document.createElement('img');
      img.src = channel.avatar || '';
      img.alt = '';

      const info = document.createElement('div');
      info.className = 'channel-info';

      const name = document.createElement('div');
      name.className = 'channel-name';
      name.textContent = channel.name;

      const video = document.createElement('div');
      video.className = 'channel-video';
      video.textContent = channel.latestTitle
        ? `${channel.latestTitle} · ${formatDate(channel.latestPublished)}`
        : 'Sem vídeos ainda';

      info.append(name, video);
      li.append(img, info);

      if (channel.hasNew) {
        const dot = document.createElement('span');
        dot.className = 'new-dot';
        li.appendChild(dot);
      }

      li.addEventListener('click', () => {
        if (channel.latestVideoId) {
          window.open(`https://www.youtube.com/watch?v=${channel.latestVideoId}`, '_blank');
        } else {
          window.open(`https://www.youtube.com/channel/${channel.channelId}`, '_blank');
        }
        chrome.runtime.sendMessage({ type: 'MARK_SEEN', channelId: channel.channelId }, () => {
          loadAndRender();
        });
      });

      channelList.appendChild(li);
    });

  const newCount = items.filter((c) => c.hasNew).length;
  statusText.textContent = `${items.length} canais · ${newCount} com vídeo novo`;
}

function loadAndRender() {
  chrome.storage.local.get('channels', ({ channels = {} }) => render(channels));
}

syncBtn.addEventListener('click', () => {
  syncBtn.classList.add('spinning');
  chrome.runtime.sendMessage({ type: 'CHECK_NOW' }, () => {
    syncBtn.classList.remove('spinning');
    loadAndRender();
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.channels) {
    render(changes.channels.newValue || {});
  }
});

loadAndRender();
