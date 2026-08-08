(function () {
  // ─── Inject injected.js into main world ─────────────────────────────────────
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/injected.js');
  script.onload = function () { this.remove(); };
  (document.head || document.documentElement).appendChild(script);

  // ─── State flags ─────────────────────────────────────────────────────────────
  let overlayBlockerEnabled   = true;
  let antiAdblockEnabled      = true;
  let stripTrackersEnabled    = true;
  let blockNotificationsEnabled = true;
  let antiFingerprintEnabled  = true;

  // ─── Selectors ───────────────────────────────────────────────────────────────
  const OVERLAY_SELECTORS = [
    '.fc-consent-root', '#onetrust-consent-sdk', '.onetrust-pc-dark-filter',
    '.qc-cmp2-container', '#didomi-host', '.cookie-consent-modal',
    '#cookie-law-info-bar', 'div[class*="consent"]', 'div[id*="consent"]',
    'div[class*="cookie-banner"]', 'div[id*="cookie-banner"]',
    'div[class*="gdpr"]', 'div[id*="gdpr"]'
  ];

  const ANTI_ADBLOCK_SELECTORS = [
    'div[class*="adblock"]', 'div[id*="adblock"]', '.adblock-modal',
    '#adblock-notice', '.adblock-overlay',
    'div[class*="paywall"]', 'div[id*="paywall"]'
  ];

  // ─── Heuristic overlay scanner ───────────────────────────────────────────────
  // Only targets elements with cookie/consent KEYWORDS — avoids generic gray backdrops
  function heuristicOverlayScan() {
    if (!overlayBlockerEnabled) return false;
    let found = false;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    document.querySelectorAll('div, section, dialog').forEach((el) => {
      try {
        const style = window.getComputedStyle(el);
        const zIndex = parseInt(style.zIndex, 10) || 0;
        const isFixed = style.position === 'fixed' || style.position === 'sticky';
        if (!isFixed || zIndex < 999) return;

        const rect = el.getBoundingClientRect();
        const coversScreen = rect.width >= vw * 0.55 && rect.height >= vh * 0.45;
        if (!coversScreen) return;

        const text = (el.innerText || '').toLowerCase();
        const KEYWORDS = ['cookie', 'consent', 'privacy', 'gizlilik', 'kabul',
                          'allow', 'accept', 'datenschutz', 'politique'];
        const hasKeyword = KEYWORDS.some(k => text.includes(k));
        if (!hasKeyword) return; // ← skip plain gray backdrops

        el.remove();
        found = true;
      } catch (e) {}
    });
    return found;
  }

  // ─── URL tracker stripper ────────────────────────────────────────────────────
  function cleanTrackingParams() {
    if (!stripTrackersEnabled) return;
    try {
      const url = new URL(window.location.href);
      const PARAMS = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content',
                      'fbclid','gclid','msclkid','mc_eid','_hsenc','ref'];
      let changed = false;
      PARAMS.forEach(p => { if (url.searchParams.has(p)) { url.searchParams.delete(p); changed = true; } });
      if (changed) window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    } catch (e) {}
  }

  // ─── Remove overlays + restore scroll ────────────────────────────────────────
  function cleanOverlays() {
    if (document.documentElement.getAttribute('data-popout-enabled') === 'false') return;
    if (document.documentElement.getAttribute('data-popout-whitelisted') === 'true') return;

    let removed = false;

    if (overlayBlockerEnabled) {
      OVERLAY_SELECTORS.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => { el.remove(); removed = true; });
        } catch (e) {}
      });
    }

    if (antiAdblockEnabled) {
      ANTI_ADBLOCK_SELECTORS.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => { el.remove(); removed = true; });
        } catch (e) {}
      });
    }

    if (heuristicOverlayScan()) removed = true;

    // Restore body scroll (only if something was actually removed)
    if (removed) {
      try { if (document.body?.style.overflow === 'hidden') document.body.style.removeProperty('overflow'); } catch (e) {}
      try { if (document.documentElement?.style.overflow === 'hidden') document.documentElement.style.removeProperty('overflow'); } catch (e) {}
    }
  }

  // ─── MutationObserver ────────────────────────────────────────────────────────
  const observer = new MutationObserver(() => cleanOverlays());

  // ─── Sync storage state → DOM attrs ─────────────────────────────────────────
  async function syncState() {
    const data = await chrome.storage.local.get(['settings', 'whitelist']);
    const settings = data.settings || {};
    const enabled = settings.enabled !== false;

    overlayBlockerEnabled     = settings.blockOverlays !== false;
    antiAdblockEnabled        = settings.blockAntiAdblock !== false;
    stripTrackersEnabled      = settings.stripTrackers !== false;
    blockNotificationsEnabled = settings.blockNotifications !== false;
    antiFingerprintEnabled    = settings.antiFingerprint !== false;

    const whitelist  = data.whitelist || [];
    const hostname   = window.location.hostname;
    const isWhitelisted = whitelist.some(d => hostname === d || hostname.endsWith('.' + d));

    document.documentElement.setAttribute('data-popout-enabled',            String(enabled));
    document.documentElement.setAttribute('data-popout-whitelisted',        String(isWhitelisted));
    document.documentElement.setAttribute('data-popout-block-notifications',String(enabled && !isWhitelisted && blockNotificationsEnabled));
    document.documentElement.setAttribute('data-popout-anti-fingerprint',   String(enabled && !isWhitelisted && antiFingerprintEnabled));

    if (enabled && !isWhitelisted) {
      cleanTrackingParams();
      cleanOverlays();
    }
  }

  syncState();

  const observeTarget = document.body || document.documentElement;
  if (observeTarget) observer.observe(observeTarget, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings || changes.whitelist) syncState();
  });

  // ─── Relay blocked-popup event from injected.js → background ────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'POPOUT_BLOCKED_EVENT') {
      chrome.runtime.sendMessage({
        type: 'POPUP_BLOCKED',
        url: event.data.url
      }).catch(() => {}); // ignore if SW not ready yet
    }
  });
})();
