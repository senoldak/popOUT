// State management
const tabState = new Map(); // tabId -> Array of blocked popups [{ url, time }]

// Initialize default storage on install
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['settings', 'whitelist']);
  if (!data.settings) {
    await chrome.storage.local.set({
      settings: { enabled: true, blockOverlays: true, blockAntiAdblock: true, stripTrackers: true, blockNotifications: true, antiFingerprint: true, totalBlocked: 0 },
      whitelist: []
    });
  }
});

// Update Badge
function updateBadge(tabId, count) {
  if (count > 0) {
    chrome.action.setBadgeText({ tabId, text: String(count) });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#FF3B30' });
  } else {
    chrome.action.setBadgeText({ tabId, text: '' });
  }
}

// Handle messaging from Content Script & Popup UI
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'POPUP_BLOCKED' && sender.tab) {
    const tabId = sender.tab.id;
    const currentList = tabState.get(tabId) || [];
    const newItem = { url: message.url || 'about:blank', time: Date.now() };
    currentList.push(newItem);
    tabState.set(tabId, currentList);

    updateBadge(tabId, currentList.length);

    // Increment global count
    chrome.storage.local.get(['settings'], (res) => {
      const settings = res.settings || {};
      settings.totalBlocked = (settings.totalBlocked || 0) + 1;
      chrome.storage.local.set({ settings });
    });

    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_TAB_STATE') {
    const tabId = message.tabId;
    const list = tabState.get(tabId) || [];
    sendResponse({ blockedPopups: list });
    return true;
  }

  if (message.type === 'CLEAR_TAB_STATE') {
    const tabId = message.tabId;
    tabState.delete(tabId);
    updateBadge(tabId, 0);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'CLEAR_SITE_DATA' && message.origin) {
    chrome.browsingData.remove({
      origins: [message.origin]
    }, {
      cache: true,
      cookies: true,
      fileSystems: true,
      indexedDB: true,
      localStorage: true,
      serviceWorkers: true,
      webSQL: true
    }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Handle Commands / Keyboard Shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'reset-site-data') {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url) {
      try {
        const urlObj = new URL(activeTab.url);
        if (urlObj.origin && urlObj.origin.startsWith('http')) {
          chrome.browsingData.remove({
            origins: [urlObj.origin]
          }, {
            cache: true,
            cookies: true,
            fileSystems: true,
            indexedDB: true,
            localStorage: true,
            serviceWorkers: true,
            webSQL: true
          }, () => {
            chrome.tabs.reload(activeTab.id);
          });
        }
      } catch (e) {}
    }
  }
});

// Clear tab state on tab closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});
