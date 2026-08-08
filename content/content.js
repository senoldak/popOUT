(function () {
  'use strict';

  // ─── Inject injected.js into main world ─────────────────────────────────────
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/injected.js');
  script.onload = function () { this.remove(); };
  (document.head || document.documentElement).appendChild(script);

  // ─── Debug logger (opt-in via settings.debug) ───────────────────────────────
  function logDebug(...args) {
    if (window.__popoutDebug) console.warn('[popOUT]', ...args);
  }

  // ─── State flags ─────────────────────────────────────────────────────────────
  let overlayBlockerEnabled     = true;
  let antiAdblockEnabled        = true;
  let stripTrackersEnabled      = true;
  let aggressiveStripEnabled    = false;
  let blockNotificationsEnabled = true;
  let antiFingerprintEnabled    = true;
  let popupBlockerEnabled       = true;
  let blockGesturedPopups       = false;

  // ─── Key sets ────────────────────────────────────────────────────────────────
  // Trusted, well-known vendor containers: safe to remove structurally.
  const OVERLAY_VENDOR_SELECTORS = [
    '.fc-consent-root', '#onetrust-consent-sdk', '.onetrust-pc-dark-filter',
    '.qc-cmp2-container', '#didomi-host', '.cookie-consent-modal',
    '#cookie-law-info-bar'
  ];
  const ANTI_ADBLOCK_VENDOR_SELECTORS = [
    '.adblock-modal', '#adblock-notice', '.adblock-overlay'
  ];
  // Generic hints — only removed when they also *behave* like an overlay
  // (fixed/absolute + high z-index + matching keyword), to avoid nuking
  // legitimate on-page content (e.g. a "cookie" recipe section).
  const GENERIC_OVERLAY_HINTS = [
    'div[class*="cookie"]', 'div[id*="cookie"]',
    'div[class*="consent"]', 'div[id*="consent"]',
    'div[class*="gdpr"]', 'div[id*="gdpr"]',
    'div[class*="cookie-banner"]', 'div[id*="cookie-banner"]',
    'div[class*="CookieBanner"]', 'div[id*="CookieBanner"]'
  ];
  const GENERIC_ADBLOCK_HINTS = [
    'div[class*="adblock"]', 'div[id*="adblock"]',
    'div[class*="paywall"]', 'div[id*="paywall"]'
  ];
  // Strong consent keywords (avoid super-generic words like "accept"/"allow").
  const CONSENT_KEYWORDS = [
    'cookie', 'consent', 'gdpr', 'gizlilik', 'çerez', 'datenschutz',
    'politique', 'cookies', 'kabul', 'onaylıyorum', 'privacy', 'agree'
  ];
  const ADBLOCK_KEYWORDS = [
    'adblock', 'ad blocker', 'ublock', 'adguard', 'paywall',
    'disable your ad', 'ad-block', 'adblocker', 'whitelist'
  ];

  // ─── Domain matching ────────────────────────────────────────────────────────
  function matchesDomain(list, hostname) {
    return (list || []).some(d => hostname === d || hostname.endsWith('.' + d));
  }

  // ─── Scoped DOM query ───────────────────────────────────────────────────────
  // `scope` can be the document or an array of mutation-added nodes.
  function queryScope(scope, selector) {
    const out = [];
    const roots = Array.isArray(scope) ? scope : [scope || document];
    for (const root of roots) {
      if (!root || root.nodeType !== 1) continue;
      try {
        if (root.matches && root.matches(selector)) out.push(root);
        out.push(...root.querySelectorAll(selector));
      } catch (e) { /* invalid selector */ }
    }
    return out;
  }

  // Collect candidate overlay elements within a scope (document or a set of
  // mutation-added nodes). The scope is locally bounded, so per-mutation cost
  // stays proportional to newly added nodes — no whole-DOM rescan needed.
  function collectCandidates(scope) {
    const CANDIDATE_SEL = 'div, section, dialog, aside, [role="dialog"]';
    const result = [];
    const seen = new Set();
    const roots = Array.isArray(scope) ? scope : [scope || document];
    for (const root of roots) {
      if (!root || root.nodeType !== 1) continue;
      let list;
      try {
        list = root.querySelectorAll(CANDIDATE_SEL);
      } catch (e) { continue; }
      if (root.matches && root.matches(CANDIDATE_SEL)) list = [root, ...list];
      for (const el of list) {
        if (!el.isConnected) continue;
        if (seen.has(el)) continue;
        seen.add(el);
        result.push(el);
        if (result.length >= 400) return result; // safety cap per batch
      }
    }
    return result;
  }


  // ─── Consent / cookie overlay sweep ─────────────────────────────────────────
  // Removes fixed/absolute elements that look like consent overlays. Backdrop
  // elements are only removed when a consent modal is actually on the page.
  function scanConsentOverlays(scope) {
    if (!overlayBlockerEnabled) return false;
    const candidates = collectCandidates(scope);
    if (!candidates.length) return false;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clones = [];
    let pageHasConsent = false;

    for (const el of candidates) {
      let style, rect, zIndex;
      try {
        style = window.getComputedStyle(el);
        const pos = style.position;
        if (pos !== 'fixed' && pos !== 'absolute') continue;
        zIndex = parseInt(style.zIndex, 10) || 0;
        if (zIndex < 90) continue;
        rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
      } catch (e) { continue; }

      const text = (el.innerText || '').trim().toLowerCase();
      const hasConsent = CONSENT_KEYWORDS.some(k => text.includes(k));
      const matchesHint = GENERIC_OVERLAY_HINTS.some(sel => el.matches && el.matches(sel));

      // Full-width bottom/top consent bars are short (height often < 15% viewport)
      // so a height-only rule would miss them. Treat full-width as significant.
      const fullWidth = rect.width >= vw * 0.8;
      const coversSignificantArea = fullWidth || (rect.width >= vw * 0.3 && rect.height >= vh * 0.15);

      if (hasConsent && (matchesHint || coversSignificantArea)) {
        clones.push({ el });
        pageHasConsent = true;
        continue;
      }

      // Empty backdrop guard: only act if a consent modal exists on the page.
      if (coversSignificantArea) {
        const bg = style.backgroundColor;
        const isEmpty = text.length < 20 && (
          bg.startsWith('rgba') || bg === 'transparent' ||
          style.backdropFilter !== 'none' || parseFloat(style.opacity) < 0.95
        );
        if (isEmpty) clones.push({ el, isBackdrop: true });
      }
    }

    let removed = false;
    for (const c of clones) {
      if (c.isBackdrop && !pageHasConsent) continue;
      try { c.el.remove(); removed = true; } catch (e) { logDebug('consent remove failed', e); }
    }
    return removed;
  }

  // ─── Anti-AdBlock / paywall sweep ───────────────────────────────────────────
  function scanAntiAdblock(scope) {
    if (!antiAdblockEnabled) return false;
    const candidates = collectCandidates(scope);
    if (!candidates.length) return false;

    let removed = false;
    for (const el of candidates) {
      let style, rect;
      try {
        style = window.getComputedStyle(el);
        const pos = style.position;
        if (pos !== 'fixed' && pos !== 'absolute') continue;
        if ((parseInt(style.zIndex, 10) || 0) < 90) continue;
        rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
      } catch (e) { continue; }

      const text = (el.innerText || '').trim().toLowerCase();
      const hasKw = ADBLOCK_KEYWORDS.some(k => text.includes(k));
      const matchesHint = GENERIC_ADBLOCK_HINTS.some(sel => el.matches && el.matches(sel));
      if (hasKw && matchesHint) {
        try { el.remove(); removed = true; } catch (e) { logDebug('adblock remove failed', e); }
      }
    }
    return removed;
  }

  // ─── Main cleanup ────────────────────────────────────────────────────────────
  function cleanOverlays(scope) {
    if (document.documentElement.getAttribute('data-popout-enabled') === 'false') return;
    if (document.documentElement.getAttribute('data-popout-whitelisted') === 'true') return;

    let removed = false;

    // 1. Vendor containers (structural, safe)
    if (overlayBlockerEnabled) {
      OVERLAY_VENDOR_SELECTORS.forEach(sel => {
        queryScope(scope, sel).forEach(el => {
          try { el.remove(); removed = true; } catch (e) { logDebug('vendor remove failed', sel, e); }
        });
      });
    }
    if (antiAdblockEnabled) {
      ANTI_ADBLOCK_VENDOR_SELECTORS.forEach(sel => {
        queryScope(scope, sel).forEach(el => {
          try { el.remove(); removed = true; } catch (e) { logDebug('vendor remove failed', sel, e); }
        });
      });
    }

    // 2. Heuristic sweeps
    if (scanConsentOverlays(scope)) removed = true;
    if (scanAntiAdblock(scope)) removed = true;

    // 3. Collapse leftover empty ad slots (scoped: full only once at load)
    collapseEmptyAdSlots(scope);

    // 4. Restore body scroll when we removed something
    if (removed) restoreScroll();
  }

  function restoreScroll() {
    try {
      ['overflow', 'overflow-y', 'overflow-x'].forEach(prop => {
        if (document.body?.style.getPropertyValue(prop) === 'hidden')
          document.body.style.removeProperty(prop);
        if (document.documentElement?.style.getPropertyValue(prop) === 'hidden')
          document.documentElement.style.removeProperty(prop);
      });
      document.body?.classList.remove('modal-open', 'overflow-hidden', 'noscroll', 'body-locked');
      document.documentElement?.classList.remove('modal-open', 'overflow-hidden', 'noscroll', 'body-locked');
    } catch (e) { logDebug('scroll restore failed', e); }
  }

// ─── Empty ad slot collapser ──────────────────────────────────────────────────
  const AD_SLOT_SELECTORS = [
    'ins.adsbygoogle',
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

  const AD_SIZES = [
    [728, 90], [970, 90], [970, 250],
    [300, 250], [336, 280], [300, 600],
    [160, 600], [120, 600],
    [320, 50],  [320, 100],
    [468, 60],  [234, 60]
  ];

  function isAdSize(w, h) {
    return AD_SIZES.some(([aw, ah]) =>
      Math.abs(w - aw) <= 4 && Math.abs(h - ah) <= 4
    );
  }

  function isEffectivelyEmpty(el) {
    const text = (el.innerText || '').trim();
    if (text.length > 8) return false;
    const imgs = el.querySelectorAll('img');
    for (const img of imgs) if (img.naturalWidth > 0) return false;
    const frames = el.querySelectorAll('iframe');
    for (const fr of frames) {
      try {
        if (fr.contentDocument?.body?.innerHTML?.trim()?.length > 10) return false;
      } catch (e) { /* cross-origin iframe */ }
    }
    return true;
  }

  function collapseEmptyAdSlots(scope) {
    if (!overlayBlockerEnabled) return;
    if (document.documentElement.getAttribute('data-popout-enabled') === 'false') return;
    if (document.documentElement.getAttribute('data-popout-whitelisted') === 'true') return;

    const isFullScan = scope === undefined || scope === null || !Array.isArray(scope) && scope === document;

    // 1) Known selectors — check within current scope
    AD_SLOT_SELECTORS.forEach(sel => {
      queryScope(scope, sel).forEach(el => {
        if (isEffectivelyEmpty(el) && !el.hasAttribute('data-popout-collapsed')) {
          el.setAttribute('data-popout-collapsed', '1');
          el.style.setProperty('display', 'none', 'important');
        }
      });
    });

    // 2) Heuristic: elements with standard IAB sizes that are empty — once, on
    //    the initial full-document scan only (getBoundingClientRect is costly).
    if (isFullScan) {
      let scanned = 0;
      document.querySelectorAll('div, aside, section, span').forEach(el => {
        if (scanned++ > 2000) return;
        if (el.hasAttribute('data-popout-collapsed')) return;
        try {
          const rect = el.getBoundingClientRect();
          if (rect.width < 60 || rect.height < 30) return;
          if (!isAdSize(Math.round(rect.width), Math.round(rect.height))) return;
          if (!isEffectivelyEmpty(el)) return;
          const idClass = ((el.id || '') + ' ' + (el.className || '')).toLowerCase();
          if (!/ad|banner|sponsor|promo|widget|slot|pub|dfp/.test(idClass)) return;
          el.setAttribute('data-popout-collapsed', '1');
          el.style.setProperty('display', 'none', 'important');
        } catch (e) { /* element may be gone */ }
      });
    }
  }

  // ─── URL tracker stripper ────────────────────────────────────────────────────
  const TRACKING_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'fbclid', 'gclid', 'msclkid', 'mc_eid', '_hsenc'
  ];
  // `ref` is sometimes part of legit affiliate flows → only stripped in
  // aggressive mode (setting.aggressiveTrackerStrip = true).
  const OPTIONAL_TRACKING_PARAMS = ['ref'];

  function cleanTrackingParams() {
    if (!stripTrackersEnabled) return;
    try {
      const url = new URL(window.location.href);
      let changed = false;
      TRACKING_PARAMS.forEach(p => {
        if (url.searchParams.has(p)) { url.searchParams.delete(p); changed = true; }
      });
      if (aggressiveStripEnabled) {
        OPTIONAL_TRACKING_PARAMS.forEach(p => {
          if (url.searchParams.has(p)) { url.searchParams.delete(p); changed = true; }
        });
      }
      if (changed) window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    } catch (e) { logDebug('tracker strip failed', e); }
  }

  // Re-run on SPA pushState/replaceState navigations.
  const _origPush = history.pushState;
  const _origReplace = history.replaceState;
  history.pushState = function (...args) {
    const r = _origPush.apply(this, args);
    cleanTrackingParams();
    return r;
  };
  history.replaceState = function (...args) {
    const r = _origReplace.apply(this, args);
    cleanTrackingParams();
    return r;
  };
// ─── MutationObserver ────────────────────────────────────────────────────────
  // Scans only the newly-added nodes of each batch (bounded cost), then passes
  // them through both the consent and the anti-adblock sweeps.
  let mutationTimer = null;
  const observer = new MutationObserver((records) => {
    const added = [];
    let guard = 0;
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node.nodeType === 1) {
          added.push(node);
          if (++guard >= 100) break;
        }
      }
      if (guard >= 100) break;
    }
    if (!added.length) return;
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => cleanOverlays(added), 140);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // ─── Initial full-document sweep (once) ─────────────────────────────────────
  let didInitialScan = false;
  function onDomReady() {
    if (didInitialScan) return;
    didInitialScan = true;
    clearTimeout(mutationTimer);
    cleanOverlays(document);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDomReady, { once: true });
  } else {
    onDomReady();
  }

  // ─── Sync storage state → module flags + DOM attrs ─────────────────────────
  async function syncState() {
    try {
      const data = await chrome.storage.local.get(['settings', 'whitelist', 'blacklist']);
      const settings = data.settings || {};
      const hostname = window.location.hostname;

      window.__popoutDebug = settings.debug === true;

      const isWhitelisted = matchesDomain(data.whitelist, hostname);
      const isBlacklisted = matchesDomain(data.blacklist, hostname);
      const enabled = settings.enabled !== false;
      // Blacklist wins: force strict protection; whitelist never applies.
      const effectiveEnabled = isBlacklisted ? true : enabled;
      const effectiveWhitelisted = isBlacklisted ? false : isWhitelisted;

      overlayBlockerEnabled     = effectiveEnabled && !effectiveWhitelisted && (isBlacklisted || settings.blockOverlays !== false);
      antiAdblockEnabled        = effectiveEnabled && !effectiveWhitelisted && (isBlacklisted || settings.blockAntiAdblock !== false);
      stripTrackersEnabled      = effectiveEnabled && !effectiveWhitelisted && (isBlacklisted || settings.stripTrackers !== false);
      aggressiveStripEnabled    = settings.aggressiveTrackerStrip === true;
      blockNotificationsEnabled = effectiveEnabled && !effectiveWhitelisted && (isBlacklisted || settings.blockNotifications !== false);
      antiFingerprintEnabled    = effectiveEnabled && !effectiveWhitelisted && (isBlacklisted || settings.antiFingerprint !== false);
      popupBlockerEnabled       = effectiveEnabled && !effectiveWhitelisted && (isBlacklisted || settings.blockPopups !== false);
      blockGesturedPopups       = isBlacklisted || settings.blockGesturedPopups === true;

      const root = document.documentElement;
      root.setAttribute('data-popout-enabled', String(effectiveEnabled));
      root.setAttribute('data-popout-whitelisted', String(effectiveWhitelisted));
      root.setAttribute('data-popout-blacklisted', String(isBlacklisted));
      root.setAttribute('data-popout-block-popups', String(popupBlockerEnabled));
      root.setAttribute('data-popout-block-gestured-popups', String(blockGesturedPopups));
      root.setAttribute('data-popout-block-notifications', String(blockNotificationsEnabled));
      root.setAttribute('data-popout-anti-fingerprint', String(antiFingerprintEnabled));

      if (effectiveEnabled && !effectiveWhitelisted) {
        cleanTrackingParams();
        cleanOverlays();
      }
    } catch (e) {
      logDebug('syncState failed', e);
    }
  }

  syncState();

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings || changes.whitelist || changes.blacklist) syncState();
  });

  // ─── Relay blocked-popup event → storage.local + badge via SW ───────────────
  const MAX_ENTRIES = 100;
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'POPOUT_BLOCKED_EVENT') return;

    const url = event.data.url || 'about:blank';
    try {
      // 1) Write DIRECTLY to storage so popup.js can always read it.
      //    (The SW only updates badge + global counter — see POPUP_BLOCKED.)
      const tabId = await getOwnTabId();
      if (tabId) {
        const key = `ts_${tabId}`;
        const res = await chrome.storage.local.get([key]);
        const list = res[key] || [];
        list.push({ url, time: Date.now() });
        await chrome.storage.local.set({ [key]: list.slice(-MAX_ENTRIES) });
      }

      // 2) Notify SW to update badge + global counter
      chrome.runtime.sendMessage({ type: 'POPUP_BLOCKED', url }).catch(() => {});
    } catch (e) {
      logDebug('popup block relay failed', e);
    }
  });

  // Get this content script's own tab ID via SW
  async function getOwnTabId() {
    try {
      return await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_OWN_TAB_ID' }, (res) => {
          resolve((res && res.tabId) ? res.tabId : null);
        });
      });
    } catch (e) {
      return null;
    }
  }
// ─── Custom hidden elements (manual element picker) ──────────────────────────
  async function applyCustomHidden() {
    const domain = window.location.hostname;
    const key = `hidden_${domain}`;
    try {
      const res = await chrome.storage.local.get([key]);
      const selectors = res[key] || [];
      selectors.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => {
            el.style.setProperty('display', 'none', 'important');
            el.setAttribute('data-popout-custom-hidden', '1');
          });
        } catch (e) { logDebug('apply hidden selector failed', sel, e); }
      });
    } catch (e) { logDebug('applyCustomHidden failed', e); }
  }

  applyCustomHidden();

  // Re-apply on DOM mutations (for SPAs / lazy-loaded content)
  const hiddenObserver = new MutationObserver(() => applyCustomHidden());
  hiddenObserver.observe(document.documentElement, { childList: true, subtree: true });

  // ─── Element Picker Mode ──────────────────────────────────────────────────────
  let pickerActive = false;
  let lastHighlighted = null;

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
    if (el.id && !/^\d/.test(el.id)) return `#${CSS.escape(el.id)}`;
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/)
        .filter(c => c && !c.startsWith('__popout'))
        .map(c => `.${CSS.escape(c)}`).join('');
      if (classes) {
        const sel = el.tagName.toLowerCase() + classes;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    }
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
      el.style.setProperty('display', 'none', 'important');
      el.setAttribute('data-popout-custom-hidden', '1');

      const domain = window.location.hostname;
      const key = `hidden_${domain}`;
      const stored = await chrome.storage.local.get([key]);
      const list = stored[key] || [];
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
      return false;
    }
    if (message.type === 'CLEAR_CUSTOM_HIDDEN') {
      document.querySelectorAll('[data-popout-custom-hidden]').forEach(el => {
        el.style.removeProperty('display');
        el.removeAttribute('data-popout-custom-hidden');
      });
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

})();