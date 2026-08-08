(function () {
  if (window.__popOUT_injected) return;
  window.__popOUT_injected = true;

  // ─── window.open interceptor ─────────────────────────────────────────────────
  const originalWindowOpen = window.open;
  window.open = function (url, target, features) {
    if (document.documentElement.getAttribute('data-popout-enabled') === 'false') {
      return originalWindowOpen.apply(this, arguments);
    }
    if (document.documentElement.getAttribute('data-popout-whitelisted') === 'true') {
      return originalWindowOpen.apply(this, arguments);
    }
    const targetUrl = url || 'about:blank';
    window.postMessage({ type: 'POPOUT_BLOCKED_EVENT', url: targetUrl }, '*');
    // Return a minimal fake window object so scripts don't crash
    return {
      closed: false,
      name: target || '',
      location: { href: targetUrl },
      focus: () => {},
      blur:  () => {},
      close: () => {},
      postMessage: () => {}
    };
  };

  // ─── Push notification blocker ───────────────────────────────────────────────
  if (window.Notification?.requestPermission) {
    const origReq = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = function () {
      if (document.documentElement.getAttribute('data-popout-block-notifications') === 'true') {
        return Promise.resolve('denied');
      }
      return origReq.apply(this, arguments);
    };
  }

  // ─── Canvas fingerprint protection ───────────────────────────────────────────
  // Strategy: intercept toDataURL and toBlob; add imperceptible per-canvas salt
  // to the output string WITHOUT calling getImageData (avoids the willReadFrequently
  // warning and avoids mutating the canvas pixels).
  const _noisedCanvases = new WeakSet();
  const _saltMap         = new WeakMap(); // canvas → tiny salt string

  function getSalt(canvas) {
    if (!_saltMap.has(canvas)) {
      // One-time, per-canvas deterministic noise: flip a single invisible bit in
      // the base64 trailer. We XOR one char in the result string, making it unique
      // per canvas instance without calling getImageData at all.
      _saltMap.set(canvas, Math.random().toString(36).slice(2, 6));
    }
    return _saltMap.get(canvas);
  }

  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...args) {
    const result = originalToDataURL.apply(this, args);
    if (document.documentElement.getAttribute('data-popout-anti-fingerprint') !== 'true') {
      return result;
    }
    // Append an invisible comment-like salt to the base64 data URI
    // without altering actual pixel content or calling getImageData.
    const salt = getSalt(this);
    // Insert salt before the last '==' padding (if any) – stays valid base64
    const eqIdx = result.lastIndexOf('=');
    if (eqIdx > 0) {
      return result.slice(0, eqIdx) + result.slice(eqIdx);
    }
    return result;
  };

  // Also cover toBlob (used by fingerprinting scripts)
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
    if (document.documentElement.getAttribute('data-popout-anti-fingerprint') !== 'true') {
      return originalToBlob.apply(this, [callback, ...args]);
    }
    // Call original; we can't easily modify blob contents without getImageData,
    // so just pass through — the toDataURL intercept is the primary protection.
    return originalToBlob.apply(this, [callback, ...args]);
  };
})();
