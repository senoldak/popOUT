(function () {
  if (window.__popOUT_injected) return;
  window.__popOUT_injected = true;

  const originalWindowOpen = window.open;

  // Intercept window.open
  window.open = function (url, target, features) {
    if (document.documentElement.getAttribute('data-popout-enabled') === 'false') {
      return originalWindowOpen.apply(this, arguments);
    }
    if (document.documentElement.getAttribute('data-popout-whitelisted') === 'true') {
      return originalWindowOpen.apply(this, arguments);
    }

    const targetUrl = url || 'about:blank';
    window.postMessage({ type: 'POPOUT_BLOCKED_EVENT', url: targetUrl }, '*');
    
    return {
      closed: false,
      focus: () => {},
      blur: () => {},
      close: () => {},
      postMessage: () => {}
    };
  };

  // Block Push Notification Requests
  if (window.Notification && Notification.requestPermission) {
    const originalRequestPermission = Notification.requestPermission;
    Notification.requestPermission = function () {
      if (document.documentElement.getAttribute('data-popout-block-notifications') === 'true') {
        return Promise.resolve('denied');
      }
      return originalRequestPermission.apply(this, arguments);
    };
  }

  // Canvas Fingerprint Protection (Inject subtle noise)
  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function () {
    if (document.documentElement.getAttribute('data-popout-anti-fingerprint') === 'true') {
      const ctx = this.getContext('2d');
      if (ctx) {
        try {
          const imgData = ctx.getImageData(0, 0, Math.min(this.width, 10), Math.min(this.height, 10));
          imgData.data[0] = (imgData.data[0] + 1) % 255;
          ctx.putImageData(imgData, 0, 0);
        } catch (e) {}
      }
    }
    return originalToDataURL.apply(this, arguments);
  };
})();
