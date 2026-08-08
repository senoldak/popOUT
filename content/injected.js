(function () {
  if (window.__popOUT_injected) return;
  window.__popOUT_injected = true;

  const originalWindowOpen = window.open;

  window.open = function (url, target, features) {
    // Check if popOUT protection is active via attribute on root
    if (document.documentElement.getAttribute('data-popout-enabled') === 'false') {
      return originalWindowOpen.apply(this, arguments);
    }
    if (document.documentElement.getAttribute('data-popout-whitelisted') === 'true') {
      return originalWindowOpen.apply(this, arguments);
    }

    const targetUrl = url || 'about:blank';
    window.postMessage({ type: 'POPOUT_BLOCKED_EVENT', url: targetUrl }, '*');
    
    // Return dummy window object to prevent null reference errors on calling scripts
    return {
      closed: false,
      focus: () => {},
      blur: () => {},
      close: () => {},
      postMessage: () => {}
    };
  };
})();
