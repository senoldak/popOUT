// ─── Defaults & migration ──────────────────────────────────────────────────────
// Single source of truth for all settings keys. New keys added across versions
// are merged here so upgrades never leave stale/undefined values behind.
const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  blockPopups: true,
  // Aggressive by default: click-triggered popups / popunders are the #1
  // annoyance on ad portals. Users can disable this for OAuth/payment flows.
  blockGesturedPopups: true,
  blockOverlays: true,
  blockAntiAdblock: true,
  stripTrackers: true,
  aggressiveTrackerStrip: false,
  blockNotifications: true,
  antiFingerprint: true,
  totalBlocked: 0
});

async function migrateSettings() {
  const data = await chrome.storage.local.get(['settings', 'whitelist', 'blacklist']);
  const existing = data.settings || {};
  const settings = { ...DEFAULT_SETTINGS, ...existing };
  await chrome.storage.local.set({
    settings,
    whitelist: Array.isArray(data.whitelist) ? data.whitelist : [],
    blacklist: Array.isArray(data.blacklist) ? data.blacklist : []
  });
  return settings;
}

// ─── Tab state helpers (stored in local so they survive SW restarts) ─────────
// Key pattern: "ts_{tabId}"  → Array<{url, time}>
const TS_PREFIX = 'ts_';

async function getTabState(tabId) {
  const key = TS_PREFIX + tabId;
  const res = await chrome.storage.local.get([key]);
  return res[key] || [];
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
  } catch (e) { /* tab may have closed */ }
}

// ─── Site data wipe (shared by popup button + keyboard shortcut) ─────────────
const SITE_DATA_TYPES = {
  cache: true,
  cookies: true,
  fileSystems: true,
  indexedDB: true,
  localStorage: true,
  serviceWorkers: true,
  webSQL: true
};

function resetSiteData(origin) {
  return new Promise((resolve, reject) => {
    chrome.browsingData.remove({ origins: [origin] }, SITE_DATA_TYPES, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// ─── Install / upgrade ───────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await migrateSettings();
  } catch (e) {
    console.warn('[popOUT] settings migration failed:', e);
  }
});

// ─── Messages ────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Content script requests its own tab ID
  if (message.type === 'GET_OWN_TAB_ID' && sender.tab) {
    sendResponse({ tabId: sender.tab.id });
    return false;
  }

  // Popup blocked by injected.js → update badge + global counter only.
  // The per-tab list is written DIRECTLY by the content script (see
  // content.js) so it never needs a round-trip through the SW here. Writing
  // twice used to double-count every blocked popup.
  if (message.type === 'POPUP_BLOCKED' && sender.tab) {
    const tabId = sender.tab.id;
    (async () => {
      try {
        const res = await chrome.storage.local.get(['settings']);
        const settings = res.settings || {};
        settings.totalBlocked = (settings.totalBlocked || 0) + 1;
        await chrome.storage.local.set({ settings });

        // Content script wrote ts_ before messaging us → badge is accurate.
        const list = await getTabState(tabId);
        updateBadge(tabId, list.length);

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
    resetSiteData(message.origin)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
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
    await resetSiteData(origin);
    await chrome.tabs.reload(tab.id);
  } catch (e) {
    console.warn('[popOUT] reset-site-data failed:', e);
  }
});

// ─── Clean up on tab close ────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabState(tabId).catch(() => {});
  try { chrome.action.setBadgeText({ tabId, text: '' }); } catch (e) {}
});

// ─── Clean old ts_ keys on navigate (so list resets per page load) ───────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  clearTabState(tabId).catch(() => {});
  try { updateBadge(tabId, 0); } catch (e) {}
});
