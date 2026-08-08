// ─── Helpers ───────────────────────────────────────────────────────────────

async function getTabState(tabId) {
  const key = `tabState_${tabId}`;
  const res = await chrome.storage.session.get([key]);
  return res[key] || [];
}

async function setTabState(tabId, list) {
  const key = `tabState_${tabId}`;
  await chrome.storage.session.set({ [key]: list });
}

async function clearTabState(tabId) {
  const key = `tabState_${tabId}`;
  await chrome.storage.session.remove([key]);
}

// ─── Badge ──────────────────────────────────────────────────────────────────

function updateBadge(tabId, count) {
  if (count > 0) {
    chrome.action.setBadgeText({ tabId, text: String(count) });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#f43f5e' });
  } else {
    chrome.action.setBadgeText({ tabId, text: '' });
  }
}

// ─── Install ────────────────────────────────────────────────────────────────

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

// ─── Messages ───────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Popup blocked ──
  if (message.type === 'POPUP_BLOCKED' && sender.tab) {
    const tabId = sender.tab.id;
    (async () => {
      const list = await getTabState(tabId);
      list.push({ url: message.url || 'about:blank', time: Date.now() });
      await setTabState(tabId, list);
      updateBadge(tabId, list.length);

      // Increment global counter
      const res = await chrome.storage.local.get(['settings']);
      const settings = res.settings || {};
      settings.totalBlocked = (settings.totalBlocked || 0) + 1;
      await chrome.storage.local.set({ settings });

      sendResponse({ success: true });
    })();
    return true; // keep channel open for async
  }

  // ── Get tab state ──
  if (message.type === 'GET_TAB_STATE') {
    (async () => {
      const list = await getTabState(message.tabId);
      sendResponse({ blockedPopups: list });
    })();
    return true;
  }

  // ── Clear tab state ──
  if (message.type === 'CLEAR_TAB_STATE') {
    (async () => {
      await clearTabState(message.tabId);
      updateBadge(message.tabId, 0);
      sendResponse({ success: true });
    })();
    return true;
  }

  // ── Clear site data ──
  if (message.type === 'CLEAR_SITE_DATA' && message.origin) {
    chrome.browsingData.remove(
      { origins: [message.origin] },
      { cache: true, cookies: true, fileSystems: true, indexedDB: true, localStorage: true, serviceWorkers: true, webSQL: true },
      () => { sendResponse({ success: true }); }
    );
    return true;
  }
});

// ─── Keyboard shortcut ───────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'reset-site-data') {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.url) return;
    try {
      const { origin } = new URL(activeTab.url);
      if (!origin.startsWith('http')) return;
      chrome.browsingData.remove(
        { origins: [origin] },
        { cache: true, cookies: true, fileSystems: true, indexedDB: true, localStorage: true, serviceWorkers: true, webSQL: true },
        () => chrome.tabs.reload(activeTab.id)
      );
    } catch (e) {}
  }
});

// ─── Cleanup on tab close ────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabState(tabId);
  chrome.action.setBadgeText({ tabId, text: '' });
});
