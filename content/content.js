(function () {
  // ─── Inject injected.js into main world ─────────────────────────────────────
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/injected.js');
  script.onload = function () { this.remove(); };
  (document.head || document.documentElement).appendChild(script);

  // ─── State flags ─────────────────────────────────────────────────────────────
  let overlayBlockerEnabled     = true;
  let antiAdblockEnabled        = true;
  let stripTrackersEnabled      = true;
  let blockNotificationsEnabled = true;
  let antiFingerprintEnabled    = true;

  // ─── Selectors ───────────────────────────────────────────────────────────────
  const OVERLAY_SELECTORS = [
    '.fc-consent-root', '#onetrust-consent-sdk', '.onetrust-pc-dark-filter',
    '.qc-cmp2-container', '#didomi-host', '.cookie-consent-modal',
    '#cookie-law-info-bar',
    'div[class*="consent"]', 'div[id*="consent"]',
    'div[class*="cookie-banner"]', 'div[id*="cookie-banner"]',
    'div[class*="gdpr"]', 'div[id*="gdpr"]',
    'div[class*="cookie"]', 'div[id*="cookie"]',
    'div[class*="CookieBanner"]', 'div[id*="CookieBanner"]'
  ];

  const ANTI_ADBLOCK_SELECTORS = [
    'div[class*="adblock"]', 'div[id*="adblock"]',
    '.adblock-modal', '#adblock-notice', '.adblock-overlay',
    'div[class*="paywall"]', 'div[id*="paywall"]'
  ];

  // ─── Remove any full-screen backdrop/overlay divs (incl. empty backdrops) ───
  function removeFullScreenOverlays() {
    if (!overlayBlockerEnabled) return false;
    let removed = false;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const candidates = document.querySelectorAll('div, section, dialog, aside, span[style], div[style]');
    candidates.forEach((el) => {
      try {
        const style = window.getComputedStyle(el);
        const pos   = style.position;
        if (pos !== 'fixed' && pos !== 'absolute') return;

        const zIndex = parseInt(style.zIndex, 10) || 0;
        if (zIndex < 50) return;

        const rect = el.getBoundingClientRect();
        const coversW = rect.width  >= vw * 0.5;
        const coversH = rect.height >= vh * 0.4;
        if (!coversW || !coversH) return;

        const text = (el.innerText || '').trim().toLowerCase();
        const bg   = style.backgroundColor;

        // Match 1: has consent/cookie keywords → always remove
        const KEYWORDS = ['cookie', 'consent', 'privacy', 'gizlilik', 'kabul',
                          'allow', 'accept', 'datenschutz', 'politique', 'gdpr',
                          'çerez', 'onaylıyorum', 'agree', 'manage'];
        const hasKeyword = KEYWORDS.some(k => text.includes(k));

        // Match 2: pure backdrop (no text, semi-transparent/dark background)
        const isEmptyBackdrop = text.length < 20 && (
          bg.startsWith('rgba') ||
          style.backdropFilter !== 'none' ||
          parseFloat(style.opacity) < 0.95
        );

        if (hasKeyword || isEmptyBackdrop) {
          el.remove();
          removed = true;
        }
      } catch (e) {}
    });
    return removed;
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

  // ─── Empty ad slot collapser ──────────────────────────────────────────────────
  // Known ad container CSS selectors
  const AD_SLOT_SELECTORS = [
    'ins.adsbygoogle',                     // Google AdSense
    '[id^="google_ads"]', '[id*="_ad_"]', '[id*="-ad-"]',
    '[class*="ad-slot"]', '[class*="ad_slot"]',
    '[class*="adunit"]', '[class*="ad-unit"]',
    '[class*="advertisement"]', '[id*="advertisement"]',
    '[class*="banner-ad"]', '[id*="banner-ad"]',
    '[class*="dfp-ad"]', '[id*="dfp"]',
    '[class*="adsense"]', '[id*="adsense"]',
    '[data-ad-slot]', '[data-ad-unit]', '[data-ad-client]',
    'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]',
    'iframe[src*="adnxs"]', 'iframe[src*="adform"]',
    'iframe[src*="rubiconproject"]', 'iframe[src*="pubmatic"]'
  ];

  // Standard IAB ad dimensions (w x h) — if empty element matches, collapse it
  const AD_SIZES = [
    [728, 90], [970, 90], [970, 250],  // leaderboard
    [300, 250], [336, 280], [300, 600], // rectangle / half-page
    [160, 600], [120, 600],             // skyscraper
    [320, 50],  [320, 100],             // mobile banner
    [468, 60],  [234, 60]               // full / half banner
  ];

  function isAdSize(w, h) {
    return AD_SIZES.some(([aw, ah]) =>
      Math.abs(w - aw) <= 4 && Math.abs(h - ah) <= 4
    );
  }

  function isEffectivelyEmpty(el) {
    // No meaningful text
    const text = (el.innerText || '').trim();
    if (text.length > 8) return false;
    // No visible images
    const imgs = el.querySelectorAll('img');
    for (const img of imgs) {
      if (img.naturalWidth > 0) return false;
    }
    // No visible iframes with content
    const frames = el.querySelectorAll('iframe');
    for (const fr of frames) {
      try {
        if (fr.contentDocument?.body?.innerHTML?.trim()?.length > 10) return false;
      } catch {}
    }
    return true;
  }

  function collapseEmptyAdSlots() {
    if (!overlayBlockerEnabled) return;
    if (document.documentElement.getAttribute('data-popout-enabled') === 'false') return;
    if (document.documentElement.getAttribute('data-popout-whitelisted') === 'true') return;

    // 1️⃣ Known ad selectors — if empty, hide
    AD_SLOT_SELECTORS.forEach(sel => {
      try {
        document.querySelectorAll(sel).forEach(el => {
          if (isEffectivelyEmpty(el) && !el.hasAttribute('data-popout-collapsed')) {
            el.setAttribute('data-popout-collapsed', '1');
            el.style.setProperty('display', 'none', 'important');
          }
        });
      } catch {}
    });

    // 2️⃣ Heuristic: inline/block elements with ad dimensions that are empty
    const candidates = document.querySelectorAll('div, aside, section, span');
    candidates.forEach(el => {
      try {
        if (el.hasAttribute('data-popout-collapsed')) return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 60 || rect.height < 30) return; // too small to be an ad slot
        if (!isAdSize(Math.round(rect.width), Math.round(rect.height))) return;
        if (!isEffectivelyEmpty(el)) return;
        // Make sure it's not a layout element by checking it has ad-like class/id
        const idClass = ((el.id || '') + ' ' + (el.className || '')).toLowerCase();
        const hasAdHint = /ad|banner|sponsor|promo|widget|slot|pub|dfp/.test(idClass);
        if (!hasAdHint) return;
        el.setAttribute('data-popout-collapsed', '1');
        el.style.setProperty('display', 'none', 'important');
      } catch {}
    });
  }

  // ─── Main cleanup ────────────────────────────────────────────────────────────
  function cleanOverlays() {
    if (document.documentElement.getAttribute('data-popout-enabled') === 'false') return;
    if (document.documentElement.getAttribute('data-popout-whitelisted') === 'true') return;

    let removed = false;

    // Known selectors
    if (overlayBlockerEnabled) {
      OVERLAY_SELECTORS.forEach(sel => {
        try { document.querySelectorAll(sel).forEach(el => { el.remove(); removed = true; }); } catch (e) {}
      });
    }
    if (antiAdblockEnabled) {
      ANTI_ADBLOCK_SELECTORS.forEach(sel => {
        try { document.querySelectorAll(sel).forEach(el => { el.remove(); removed = true; }); } catch (e) {}
      });
    }

    // Generic full-screen overlay sweep (catches backdrops)
    if (removeFullScreenOverlays()) removed = true;

    // Collapse leftover empty ad slots
    collapseEmptyAdSlots();

    // Restore body scroll
    if (removed) {
      try {
        ['overflow', 'overflow-y', 'overflow-x'].forEach(prop => {
          if (document.body?.style.getPropertyValue(prop) === 'hidden')
            document.body.style.removeProperty(prop);
          if (document.documentElement?.style.getPropertyValue(prop) === 'hidden')
            document.documentElement.style.removeProperty(prop);
        });
        // Also reset class-based locks
        document.body?.classList.remove('modal-open', 'overflow-hidden', 'noscroll', 'body-locked');
        document.documentElement?.classList.remove('modal-open', 'overflow-hidden', 'noscroll', 'body-locked');
      } catch (e) {}
    }
  }

  // ─── MutationObserver ────────────────────────────────────────────────────────
  // Debounced to avoid performance hit on heavy mutation sites
  let mutationTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(cleanOverlays, 120);
  });

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

    const whitelist = data.whitelist || [];
    const hostname  = window.location.hostname;
    const isWhitelisted = whitelist.some(d => hostname === d || hostname.endsWith('.' + d));

    document.documentElement.setAttribute('data-popout-enabled',             String(enabled));
    document.documentElement.setAttribute('data-popout-whitelisted',         String(isWhitelisted));
    document.documentElement.setAttribute('data-popout-block-notifications', String(enabled && !isWhitelisted && blockNotificationsEnabled));
    document.documentElement.setAttribute('data-popout-anti-fingerprint',    String(enabled && !isWhitelisted && antiFingerprintEnabled));

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

  // ─── Relay blocked-popup event → storage.local + badge via SW ───────────────
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'POPOUT_BLOCKED_EVENT') return;

    const url = event.data.url || 'about:blank';

    try {
      // 1️⃣ Write DIRECTLY to storage so popup.js can always read it
      const tabId = await getOwnTabId();
      if (tabId) {
        const key  = `ts_${tabId}`;
        const res  = await chrome.storage.local.get([key]);
        const list = res[key] || [];;
        list.push({ url, time: Date.now() });
        await chrome.storage.local.set({ [key]: list });
      }

      // 2️⃣ Also notify SW to update badge + global counter
      chrome.runtime.sendMessage({ type: 'POPUP_BLOCKED', url }).catch(() => {});
    } catch (e) {}
  });

  // Get this content script's own tab ID via SW
  async function getOwnTabId() {
    try {
      return await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_OWN_TAB_ID' }, (res) => {
          resolve((res && res.tabId) ? res.tabId : null);
        });
      });
    } catch {
      return null;
    }
  }

  // ─── Custom hidden elements (manual element picker) ──────────────────────────

  // Apply any saved hidden selectors for this domain
  async function applyCustomHidden() {
    const domain = window.location.hostname;
    const key    = `hidden_${domain}`;
    const res    = await chrome.storage.local.get([key]);
    const selectors = res[key] || [];
    selectors.forEach(sel => {
      try {
        document.querySelectorAll(sel).forEach(el => {
          el.style.setProperty('display', 'none', 'important');
          el.setAttribute('data-popout-custom-hidden', '1');
        });
      } catch {}
    });
  }

  applyCustomHidden();

  // Re-apply on DOM mutations (for SPAs / lazy-loaded content)
  const hiddenObserver = new MutationObserver(() => applyCustomHidden());
  hiddenObserver.observe(document.documentElement, { childList: true, subtree: true });

  // ─── Element Picker Mode ──────────────────────────────────────────────────────
  let pickerActive = false;
  let lastHighlighted = null;

  // Inject picker styles into page
  function injectPickerStyles() {
    if (document.getElementById('__popout_picker_style')) return;
    const style = document.createElement('style');
    style.id = '__popout_picker_style';
    style.textContent = `
      .__popout_highlight {
        outline: 2px dashed #fbbf24 !important;
        outline-offset: 2px !important;
        background: rgba(251,191,36,0.07) !important;
        cursor: crosshair !important;
      }
      #__popout_picker_banner {
        position: fixed !important;
        top: 0 !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        z-index: 2147483647 !important;
        background: #fbbf24 !important;
        color: #0d1117 !important;
        font: 700 12px/1 "Plus Jakarta Sans", system-ui, sans-serif !important;
        padding: 7px 16px !important;
        border-radius: 0 0 10px 10px !important;
        box-shadow: 0 4px 20px rgba(251,191,36,0.5) !important;
        pointer-events: none !important;
        letter-spacing: 0.02em !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function showPickerBanner() {
    let b = document.getElementById('__popout_picker_banner');
    if (!b) {
      b = document.createElement('div');
      b.id = '__popout_picker_banner';
      document.documentElement.appendChild(b);
    }
    b.textContent = '🎯 popOUT Picker — Click an element to hide it  |  Esc to cancel';
  }

  function hidePickerBanner() {
    document.getElementById('__popout_picker_banner')?.remove();
  }

  function clearHighlight() {
    lastHighlighted?.classList.remove('__popout_highlight');
    lastHighlighted = null;
  }

  // Generate a stable CSS selector for an element
  function buildSelector(el) {
    // 1. Try ID
    if (el.id && !/^\d/.test(el.id)) return `#${CSS.escape(el.id)}`;

    // 2. Try unique class combination
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/)
        .filter(c => c && !c.startsWith('__popout'))
        .map(c => `.${CSS.escape(c)}`).join('');
      if (classes) {
        const sel = el.tagName.toLowerCase() + classes;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    }

    // 3. nth-child path (up to 4 levels)
    function nthPath(node, depth = 0) {
      if (!node.parentElement || depth > 4) return node.tagName.toLowerCase();
      const siblings = Array.from(node.parentElement.children)
        .filter(s => s.tagName === node.tagName);
      const idx = siblings.indexOf(node) + 1;
      const part = `${node.tagName.toLowerCase()}:nth-of-type(${idx})`;
      return `${nthPath(node.parentElement, depth + 1)} > ${part}`;
    }
    return nthPath(el);
  }

  function activatePicker() {
    if (pickerActive) return;
    pickerActive = true;
    injectPickerStyles();
    showPickerBanner();

    function onMouseOver(e) {
      if (!pickerActive) return;
      const el = e.target;
      if (el.id === '__popout_picker_banner' || el.hasAttribute('data-popout-custom-hidden')) return;
      clearHighlight();
      el.classList.add('__popout_highlight');
      lastHighlighted = el;
      e.stopPropagation();
    }

    function onMouseOut(e) {
      if (e.target === lastHighlighted) clearHighlight();
    }

    async function onClick(e) {
      if (!pickerActive) return;
      e.preventDefault();
      e.stopPropagation();

      const el = e.target;
      if (el.id === '__popout_picker_banner') return;

      const selector = buildSelector(el);

      // Hide immediately
      el.style.setProperty('display', 'none', 'important');
      el.setAttribute('data-popout-custom-hidden', '1');

      // Persist selector for this domain
      const domain = window.location.hostname;
      const key    = `hidden_${domain}`;
      const stored = await chrome.storage.local.get([key]);
      const list   = stored[key] || [];
      if (!list.includes(selector)) list.push(selector);
      await chrome.storage.local.set({ [key]: list });

      deactivatePicker();
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') deactivatePicker();
    }

    function deactivatePicker() {
      pickerActive = false;
      clearHighlight();
      hidePickerBanner();
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('mouseout',  onMouseOut,  true);
      document.removeEventListener('click',     onClick,     true);
      document.removeEventListener('keydown',   onKeyDown,   true);
    }

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout',  onMouseOut,  true);
    document.addEventListener('click',     onClick,     true);
    document.addEventListener('keydown',   onKeyDown,   true);
  }

  // ─── Listen for messages from popup ──────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'ACTIVATE_PICKER') {
      activatePicker();
      sendResponse({ ok: true });
    }
    return false;
  });

})();
