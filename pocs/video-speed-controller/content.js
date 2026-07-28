(function () {
  const DEFAULT_SPEED = 1;
  const STEP = 0.1;
  const MIN_SPEED = 0.1;
  const MAX_SPEED = 16;

  const DEFAULT_AD_SPEED = 4;

  let currentSpeed = DEFAULT_SPEED;
  let adSpeed = DEFAULT_AD_SPEED;
  let autoAdSpeedEnabled = true;
  let adActive = false;
  const overlays = new WeakMap();

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function clamp(value) {
    return round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, value)));
  }

  function formatSpeed(speed) {
    return `${speed.toFixed(2).replace(/\.?0+$/, '') || '0'}x`;
  }

  function effectiveSpeed() {
    return adActive ? adSpeed : currentSpeed;
  }

  function flashOverlay(video) {
    const overlay = overlays.get(video);
    if (!overlay) return;
    overlay.classList.add('vsc-visible');
    clearTimeout(overlay.dataset.hideTimer);
    const timer = setTimeout(() => overlay.classList.remove('vsc-visible'), 1000);
    overlay.dataset.hideTimer = timer;
  }

  function applySpeed(video) {
    const speed = effectiveSpeed();
    video.playbackRate = speed;
    const overlay = overlays.get(video);
    if (overlay) {
      overlay.textContent = adActive ? `${formatSpeed(speed)} (anúncio)` : formatSpeed(speed);
    }
    flashOverlay(video);
  }

  function applySpeedToAllVideos() {
    document.querySelectorAll('video').forEach(applySpeed);
  }

  function setSpeed(speed) {
    currentSpeed = clamp(speed);
    chrome.storage.sync.set({ globalSpeed: currentSpeed });
    applySpeedToAllVideos();
  }

  function createOverlay(video) {
    const badge = document.createElement('div');
    badge.className = 'vsc-badge';
    badge.textContent = formatSpeed(currentSpeed);
    overlays.set(video, badge);

    const host = video.parentElement;
    if (!host) return;

    if (getComputedStyle(host).position === 'static') {
      host.style.position = 'relative';
    }
    host.classList.add('vsc-host');
    host.appendChild(badge);
  }

  function setupVideo(video) {
    if (video.dataset.vscInit) return;
    video.dataset.vscInit = 'true';
    applySpeed(video);

    // Sites frequentemente resetam playbackRate para 1x ao trocar de vídeo
    // (playlists, autoplay, feeds). Reforçamos a velocidade escolhida em
    // todos esses pontos e sempre que o próprio site tentar mudá-la.
    ['loadstart', 'loadedmetadata', 'canplay', 'play', 'playing'].forEach((eventName) => {
      video.addEventListener(eventName, () => applySpeed(video));
    });
    video.addEventListener('ratechange', () => {
      if (video.playbackRate !== effectiveSpeed()) applySpeed(video);
    });

    createOverlay(video);
  }

  function scanForVideos(root = document) {
    root.querySelectorAll('video').forEach(setupVideo);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.tagName === 'VIDEO') setupVideo(node);
        else scanForVideos(node);
      });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  function isTypingTarget(target) {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable
    );
  }

  document.addEventListener('keydown', (event) => {
    if (isTypingTarget(event.target)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    switch (event.key.toLowerCase()) {
      case 's':
        setSpeed(currentSpeed - STEP);
        break;
      case 'd':
        setSpeed(currentSpeed + STEP);
        break;
      case 'r':
        setSpeed(DEFAULT_SPEED);
        break;
      default:
        return;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.globalSpeed) currentSpeed = clamp(changes.globalSpeed.newValue);
    if (changes.adSpeed) adSpeed = clamp(changes.adSpeed.newValue);
    if (changes.autoAdSpeedEnabled) autoAdSpeedEnabled = changes.autoAdSpeedEnabled.newValue;
    applySpeedToAllVideos();
  });

  function isYouTubeAdShowing() {
    const player = document.querySelector('.html5-video-player');
    return !!player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
  }

  function setupYouTubeAdDetection() {
    if (!location.hostname.includes('youtube.com')) return;

    function checkAdState() {
      if (!autoAdSpeedEnabled) {
        if (adActive) {
          adActive = false;
          applySpeedToAllVideos();
        }
        return;
      }
      const showingAd = isYouTubeAdShowing();
      if (showingAd !== adActive) {
        adActive = showingAd;
        applySpeedToAllVideos();
      }
    }

    const playerObserver = new MutationObserver(checkAdState);
    function attachToPlayer() {
      const player = document.querySelector('.html5-video-player');
      if (!player) return false;
      playerObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
      return true;
    }

    if (!attachToPlayer()) {
      const retry = setInterval(() => {
        if (attachToPlayer()) clearInterval(retry);
      }, 1000);
    }

    setInterval(checkAdState, 500);
  }

  chrome.storage.sync.get(['globalSpeed', 'adSpeed', 'autoAdSpeedEnabled'], (result) => {
    currentSpeed = clamp(result.globalSpeed || DEFAULT_SPEED);
    adSpeed = clamp(result.adSpeed || DEFAULT_AD_SPEED);
    autoAdSpeedEnabled = result.autoAdSpeedEnabled !== false;
    scanForVideos();
    setupYouTubeAdDetection();
  });
})();
