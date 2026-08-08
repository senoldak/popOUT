(function () {
  if (window.__popOUT_injected) return;
  window.__popOUT_injected = true;

  // ─── DOM attribute helpers ──────────────────────────────────────────────────
  // content.js keeps these attributes in sync with settings/whitelist/blacklist.
  function attr(name) {
    try { return document.documentElement.getAttribute(name); } catch (e) { return null; }
  }
  const isBlacklisted   = () => attr('data-popout-blacklisted') === 'true';
  const isWhitelisted   = () => attr('data-popout-whitelisted') === 'true';
  const isEnabled       = () => attr('data-popout-enabled') !== 'false';
  const blockScriptPop  = () => attr('data-popout-block-popups') === 'true';
  const blockGestured   = () => attr('data-popout-block-gestured-popups') === 'true';
  const antiFingerprint = () => attr('data-popout-anti-fingerprint') === 'true';
  const blockNotifs     = () => attr('data-popout-block-notifications') === 'true';

  // ─── User-gesture tracking ──────────────────────────────────────────────────
  // Legit sites (OAuth login, PayPal, payment gateways…) open popups from real
  // clicks. Popunders / script spam do not. We remember the last trusted
  // gesture so window.open() triggered straight from a click is allowed (unless
  // the user enables "block popups from clicks" or blacklists the site).
  let lastUserGesture = 0;
  const GESTURE_WINDOW_MS = 900;
  function registerGesture() { lastUserGesture = Date.now(); }
  ['click', 'keydown', 'keyup', 'pointerdown', 'pointerup', 'touchend'].forEach((ev) => {
    try { document.addEventListener(ev, registerGesture, true); } catch (e) {}
  });
  const hasRecentGesture = () => (Date.now() - lastUserGesture) < GESTURE_WINDOW_MS;

  // ─── Click popunder blocker (dynamically-injected <a target="_blank">) ──────
  // Popunders are usually <a target="_blank"> links that scripts inject at
  // runtime and "click" (or real clicks land on the ad). We snapshot the
  // anchors the site ships statically and only block plain-left-clicks on
  // anchors that appeared AFTER load (script-added), when "block popups from
  // clicks" is enabled. Real static links (e.g. news articles) are untouched.
  const _staticAnchors = new WeakSet();
  function snapshotStaticAnchors() {
    document.querySelectorAll('a[target]').forEach(a => {
      if ((a.getAttribute('target') || '').toLowerCase().includes('_blank')) {
        _staticAnchors.add(a);
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', snapshotStaticAnchors, { once: true });
  } else {
    snapshotStaticAnchors();
  }

  function onClickPopunder(e) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const shouldBlock = isBlacklisted() || (!isWhitelisted() && isEnabled() && blockGestured());
    if (!shouldBlock) return;

    let el = e.target;
    while (el && el.nodeType === 1) {
      if (el.tagName === 'A') {
        const t = (el.getAttribute('target') || '').toLowerCase();
        const href = el.getAttribute('href') || '';
        if (t.includes('_blank') && !href.startsWith('#') && !href.startsWith('javascript:')) {
          // Only suppress script-injected anchors; keep the site's own links.
          if (!_staticAnchors.has(el)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
        return;
      }
      el = el.parentElement;
    }
  }
  document.addEventListener('click', onClickPopunder, true);

  // ─── window.open interceptor ─────────────────────────────────────────────────
  const originalWindowOpen = window.open;

  // A Proxy-backed stub so scripts that use the returned window object
  // (w.document.write, w.focus, w.addEventListener, …) never crash.
  function makeFakeWindow(url, target) {
    const fake = {
      closed: false,
      name: target || '',
      location: { href: url, assign() {}, replace() {} },
      focus() {}, blur() {}, close() {}, postMessage() {},
      document: { write() {}, writeln() {}, open() { return null; }, close() {} },
      frames: [],
      length: 0,
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
      setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {}
    };
    fake.self = fake;
    fake.top = fake;
    fake.parent = fake;
    fake.opener = null;
    return new Proxy(fake, {
      get(t, prop) {
        // unknown property → return a no-op function (defensive pattern)
        if (prop in t) return t[prop];
        if (prop === Symbol.toPrimitive) return () => '[popOUT blocked window]';
        return () => {};
      },
      set() { return true; }
    });
  }

  window.open = function (url, target, features) {
    const targetUrl = url || 'about:blank';
    const shouldBlock =
      isBlacklisted() ||                                              // strict blocklist wins
      (!isWhitelisted() && isEnabled() && blockScriptPop() &&         // normal path
       (blockGestured() || !hasRecentGesture()));

    if (!shouldBlock) {
      return originalWindowOpen.apply(this, arguments);
    }
    window.postMessage({ type: 'POPOUT_BLOCKED_EVENT', url: targetUrl }, '*');
    return makeFakeWindow(targetUrl, target);
  };

  // ─── Push notification blocker ───────────────────────────────────────────────
  if (window.Notification?.requestPermission) {
    const origReq = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = function () {
      if (isBlacklisted() || (!isWhitelisted() && isEnabled() && blockNotifs())) {
        return Promise.resolve('denied');
      }
      return origReq.apply(this, arguments);
    };
  }

  // ─── Canvas fingerprint protection ─────────────────────────────────────────
  // Strategy: add imperceptible per-canvas pixel noise (±1 on a handful of RGB
  // channels) BEFORE encoding. This makes toDataURL()/toBlob() output unique per
  // canvas instance, so fingerprinting scripts see a different result for the
  // "same" drawing on every visit — while the on-screen image stays visually
  // identical. This is the standard canvas-fingerprint-blocking technique.
  const _noised = new WeakSet();
  const MAX_CANVAS_PIXELS = 16_000_000; // ~4096x4096 guard

  function addNoise(canvas) {
    if (_noised.has(canvas)) return;
    _noised.add(canvas);
    try {
      const w = canvas.width, h = canvas.height;
      if (!w || !h || (w * h) > MAX_CANVAS_PIXELS) return;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;

      // Deterministic per-canvas seed → stable output for the same canvas,
      // different output across canvas instances / visits.
      const seed = (Math.random() * 0xffffffff) >>> 0;
      const count = Math.min(16, Math.max(4, Math.floor((w * h) / 4000)));

      for (let i = 0; i < count; i++) {
        const b = (seed + i * 2654435761) >>> 0; // Knuth multiplicative hash
        const idx = ((b % (w * h)) * 4) >>> 0;
        const channel = (b >>> 16) % 3;          // R, G or B (never alpha)
        const delta = (b & 1) ? 1 : -1;
        const v = d[idx + channel] + delta;
        d[idx + channel] = Math.max(0, Math.min(255, v));
      }

      ctx.putImageData(img, 0, 0);
    } catch (e) {
      /* canvas may be tainted / context gone — fall back to no-op */
    }
  }

  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...args) {
    if (antiFingerprint() && (isBlacklisted() || !isWhitelisted())) addNoise(this);
    return originalToDataURL.apply(this, args);
  };

  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
    if (antiFingerprint() && (isBlacklisted() || !isWhitelisted())) addNoise(this);
    return originalToBlob.apply(this, [callback, ...args]);
  };
})();
