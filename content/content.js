(function () {
  // Inject script into main world for window.open override
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/injected.js');
  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  let overlayBlockerEnabled = true;
  let antiAdblockEnabled = true;
  let stripTrackersEnabled = true;
  let blockNotificationsEnabled = true;
  let antiFingerprintEnabled = true;

  // Common Cookie / GDPR / Overlay selectors and keywords
  const OVERLAY_SELECTORS = [
    '.fc-consent-root',
    '#onetrust-consent-sdk',
    '.onetrust-pc-dark-filter',
    '.qc-cmp2-container',
    '#didomi-host',
    '.cookie-consent-modal',
    '#cookie-law-info-bar',
    'div[class*="consent"]',
    'div[id*="consent"]',
    'div[class*="cookie-banner"]',
    'div[id*="cookie-banner"]',
    'div[class*="gdpr"]',
    'div[id*="gdpr"]'
  ];

  // Anti-AdBlock selectors
  const ANTI_ADBLOCK_SELECTORS = [
    'div[class*="adblock"]',
    'div[id*="adblock"]',
    '.adblock-modal',
    '#adblock-notice',
    '.adblock-overlay',
    'div[class*="paywall"]',
    'div[id*="paywall"]'
  ];

  // Strip URL Tracking Parameters
  function cleanTrackingParams() {
    if (!stripTrackersEnabled) return;
    try {
      const url = new URL(window.location.href);
      const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'msclkid', 'mc_eid', '_hsenc', 'ref'];
      let modified = false;

      trackingParams.forEach((param) => {
        if (url.searchParams.has(param)) {
          url.searchParams.delete(param);
          modified = true;
        }
      });

      if (modified) {
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      }
    } catch (e) {}
  }

  function cleanOverlays() {
    if (document.documentElement.getAttribute('data-popout-enabled') === 'false') return;
    if (document.documentElement.getAttribute('data-popout-whitelisted') === 'true') return;

    let removed = false;

    // Cookie / GDPR Overlays
    if (overlayBlockerEnabled) {
      OVERLAY_SELECTORS.forEach((selector) => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach((el) => {
            if (el && el.parentNode) {
              el.remove();
              removed = true;
            }
          });
        } catch (e) {}
      });
    }

    // Anti-AdBlock Modals
    if (antiAdblockEnabled) {
      ANTI_ADBLOCK_SELECTORS.forEach((selector) => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach((el) => {
            if (el && el.parentNode) {
              el.remove();
              removed = true;
            }
          });
        } catch (e) {}
      });
    }

    // Restore page scrolling if modal locked it
    if (removed || document.body?.style.overflow === 'hidden' || document.documentElement?.style.overflow === 'hidden') {
      if (document.body && document.body.style.overflow === 'hidden') {
        document.body.style.overflow = 'auto';
      }
      if (document.documentElement && document.documentElement.style.overflow === 'hidden') {
        document.documentElement.style.overflow = 'auto';
      }
    }
  }

  // MutationObserver to catch dynamically loaded cookie & anti-adblock modals
  const observer = new MutationObserver(() => {
    cleanOverlays();
  });

  // Sync extension state to DOM attribute for fast sync
  async function syncState() {
    const data = await chrome.storage.local.get(['settings', 'whitelist']);
    const settings = data.settings || {};
    const enabled = settings.enabled !== false;
    overlayBlockerEnabled = settings.blockOverlays !== false;
    antiAdblockEnabled = settings.blockAntiAdblock !== false;
    stripTrackersEnabled = settings.stripTrackers !== false;
    blockNotificationsEnabled = settings.blockNotifications !== false;
    antiFingerprintEnabled = settings.antiFingerprint !== false;

    const whitelist = data.whitelist || [];
    const hostname = window.location.hostname;

    const isWhitelisted = whitelist.some(domain => hostname === domain || hostname.endsWith('.' + domain));

    document.documentElement.setAttribute('data-popout-enabled', String(enabled));
    document.documentElement.setAttribute('data-popout-whitelisted', String(isWhitelisted));
    document.documentElement.setAttribute('data-popout-block-notifications', String(enabled && !isWhitelisted && blockNotificationsEnabled));
    document.documentElement.setAttribute('data-popout-anti-fingerprint', String(enabled && !isWhitelisted && antiFingerprintEnabled));

    if (enabled && !isWhitelisted) {
      cleanTrackingParams();
      cleanOverlays();
    }
  }

  syncState();

  if (document.body || document.documentElement) {
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  // Listen for storage updates
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings || changes.whitelist) {
      syncState();
    }
  });

  // Relay blocked event from injected script to background
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'POPOUT_BLOCKED_EVENT') {
      chrome.runtime.sendMessage({
        type: 'POPUP_BLOCKED',
        url: event.data.url
      });
    }
  });
})();
