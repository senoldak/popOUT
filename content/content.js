(function () {
  // Inject script into main world
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/injected.js');
  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  // Sync extension state to DOM attribute for fast sync
  async function syncState() {
    const data = await chrome.storage.local.get(['settings', 'whitelist']);
    const enabled = data.settings ? data.settings.enabled : true;
    const whitelist = data.whitelist || [];
    const hostname = window.location.hostname;

    const isWhitelisted = whitelist.some(domain => hostname === domain || hostname.endsWith('.' + domain));

    document.documentElement.setAttribute('data-popout-enabled', String(enabled));
    document.documentElement.setAttribute('data-popout-whitelisted', String(isWhitelisted));
  }

  syncState();

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
