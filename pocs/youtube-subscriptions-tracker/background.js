const CHECK_ALARM = 'check-new-videos';
const CHECK_INTERVAL_MINUTES = 30;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(CHECK_ALARM, { periodInMinutes: CHECK_INTERVAL_MINUTES });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(CHECK_ALARM, { periodInMinutes: CHECK_INTERVAL_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM) checkAllChannels();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CHANNELS_SCRAPED') {
    mergeChannels(message.channels).then(() => checkAllChannels());
    return;
  }
  if (message.type === 'CHECK_NOW') {
    checkAllChannels().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'MARK_SEEN') {
    markSeen(message.channelId).then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function mergeChannels(scrapedChannels) {
  const { channels = {} } = await chrome.storage.local.get('channels');
  scrapedChannels.forEach(({ channelId, name, avatar }) => {
    channels[channelId] = {
      ...channels[channelId],
      channelId,
      name,
      avatar,
    };
  });
  await chrome.storage.local.set({ channels });
}

// Parseia o feed RSS público do canal (sem precisar de API key/OAuth).
async function fetchLatestVideo(channelId) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const xml = await response.text();

  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
  if (!entryMatch) return null;
  const entry = entryMatch[1];

  const videoId = entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1];
  const title = entry.match(/<title>(.*?)<\/title>/)?.[1];
  const published = entry.match(/<published>(.*?)<\/published>/)?.[1];

  if (!videoId) return null;
  return { videoId, title, published };
}

async function checkAllChannels() {
  const { channels = {} } = await chrome.storage.local.get('channels');
  const ids = Object.keys(channels);

  await Promise.all(
    ids.map(async (channelId) => {
      const latest = await fetchLatestVideo(channelId).catch(() => null);
      if (!latest) return;

      const channel = channels[channelId];
      const isNew = channel.lastSeenVideoId && channel.lastSeenVideoId !== latest.videoId;

      channels[channelId] = {
        ...channel,
        latestVideoId: latest.videoId,
        latestTitle: latest.title,
        latestPublished: latest.published,
        hasNew: channel.lastSeenVideoId ? isNew || channel.hasNew : false,
      };

      // Primeira vez que vemos o canal: só passa a rastrear a partir daqui.
      if (!channel.lastSeenVideoId) {
        channels[channelId].lastSeenVideoId = latest.videoId;
      }
    })
  );

  await chrome.storage.local.set({ channels });
  updateBadge(channels);
}

async function markSeen(channelId) {
  const { channels = {} } = await chrome.storage.local.get('channels');
  const channel = channels[channelId];
  if (!channel) return;

  channels[channelId] = {
    ...channel,
    lastSeenVideoId: channel.latestVideoId,
    hasNew: false,
  };

  await chrome.storage.local.set({ channels });
  updateBadge(channels);
}

function updateBadge(channels) {
  const newCount = Object.values(channels).filter((c) => c.hasNew).length;
  chrome.action.setBadgeText({ text: newCount > 0 ? String(newCount) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#cc0000' });
}
