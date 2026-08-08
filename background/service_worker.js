// ─── Tab state helpers (stored in local so they survive SW restarts) ─────────
// Key pattern: "ts_{tabId}"  → Array<{url, time}>

const TS_PREFIX = 'ts_';

async function getTabState(tabId) {
  const key = TS_PREFIX + tabId;
  const res = await chrome.storage.local.get([key]);
  return res[key] || [];
}

async function setTabState(tabId, list) {
  await chrome.storage.local.set({ [TS_PREFIX + tabId]: list });
}

async function clearTabState(tabId) {
  await chrome.storage.local.remove([TS_PREFIX + tabId]);
}

// ─── Badge ──────────────────────────────────────────────────────────────────
function updateBadge(tabId, count) {
  try {
    if (count > 0) {
      chrome.action.setBadgeText({ tabId, text: String(count) });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#f43f5e' });
    } else {
      chrome.action.setBadgeText({ tabId, text: '' });
    }
  } catch (e) {}
}

// ─── Install ─────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['settings', 'whitelist']);
  if (!data.settings) {
    await chrome.storage.local.set({
      settings: {
        enabled: true,
        blockOverlays: true,
        blockAntiAdblock: true,
        stripTrackers: true,
        blockNotifications: true,
        antiFingerprint: true,
        totalBlocked: 0
      },
      whitelist: []
    });
  }
});

// ─── Messages ────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Content script requests its own tab ID
  if (message.type === 'GET_OWN_TAB_ID' && sender.tab) {
    sendResponse({ tabId: sender.tab.id });
    return false;
  }

  // Popup blocked by injected.js
  if (message.type === 'POPUP_BLOCKED' && sender.tab) {
    const tabId = sender.tab.id;
    (async () => {
      try {
        const list = await getTabState(tabId);
        list.push({ url: message.url || 'about:blank', time: Date.now() });
        await setTabState(tabId, list);
        updateBadge(tabId, list.length);

        const res = await chrome.storage.local.get(['settings']);
        const settings = res.settings || {};
        settings.totalBlocked = (settings.totalBlocked || 0) + 1;
        await chrome.storage.local.set({ settings });

        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
    })();
    return true; // keep message channel open
  }

  // Popup UI requests tab state
  if (message.type === 'GET_TAB_STATE') {
    (async () => {
      try {
        const list = await getTabState(message.tabId);
        sendResponse({ blockedPopups: list });
      } catch (e) {
        sendResponse({ blockedPopups: [] });
      }
    })();
    return true;
  }

  // Popup UI clears tab state
  if (message.type === 'CLEAR_TAB_STATE') {
    (async () => {
      try {
        await clearTabState(message.tabId);
        updateBadge(message.tabId, 0);
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false });
      }
    })();
    return true;
  }

  // Reset site cookies/storage
  if (message.type === 'CLEAR_SITE_DATA' && message.origin) {
    chrome.browsingData.remove(
      { origins: [message.origin] },
      { cache: true, cookies: true, fileSystems: true, indexedDB: true,
        localStorage: true, serviceWorkers: true, webSQL: true },
      () => sendResponse({ success: true })
    );
    return true;
  }
});

// ─── Keyboard shortcut ────────────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'reset-site-data') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  try {
    const { origin } = new URL(tab.url);
    if (!origin.startsWith('http')) return;
    chrome.browsingData.remove(
      { origins: [origin] },
      { cache: true, cookies: true, fileSystems: true, indexedDB: true,
        localStorage: true, serviceWorkers: true, webSQL: true },
      () => chrome.tabs.reload(tab.id)
    );
  } catch (e) {}
});

// ─── Clean up on tab close ────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabState(tabId);
  try { chrome.action.setBadgeText({ tabId, text: '' }); } catch (e) {}
});

// ─── Clean old ts_ keys on navigate (so list resets per page load) ───────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    clearTabState(tabId);
    updateBadge(tabId, 0);
  }
});
