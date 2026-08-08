document.addEventListener('DOMContentLoaded', async () => {
  const globalToggle        = document.getElementById('globalToggle');
  const overlayToggle       = document.getElementById('overlayToggle');
  const antiAdblockToggle   = document.getElementById('antiAdblockToggle');
  const notificationsToggle = document.getElementById('notificationsToggle');
  const trackersToggle      = document.getElementById('trackersToggle');
  const fingerprintToggle   = document.getElementById('fingerprintToggle');
  const popupsToggle        = document.getElementById('popupsToggle');
  const gesturePopupsToggle = document.getElementById('gesturePopupsToggle');

  const currentDomainEl    = document.getElementById('currentDomain');
  const whitelistBtn       = document.getElementById('whitelistBtn');
  const whitelistBtnText   = document.getElementById('whitelistBtnText');
  const blocklistBtn       = document.getElementById('blocklistBtn');
  const blocklistBtnText   = document.getElementById('blocklistBtnText');
  const resetConsentBtn    = document.getElementById('resetConsentBtn');
  const openOptionsBtn     = document.getElementById('openOptionsBtn');
  const tabBlockedCountEl  = document.getElementById('tabBlockedCount');
  const totalBlockedCountEl= document.getElementById('totalBlockedCount');
  const dataSavedCountEl   = document.getElementById('dataSavedCount');
  const timeSavedCountEl   = document.getElementById('timeSavedCount');
  const blockedListEl      = document.getElementById('blockedList');
  const listBadge          = document.getElementById('listBadge');
  const pickElementBtn     = document.getElementById('pickElementBtn');
  const hiddenCountEl      = document.getElementById('hiddenCount');
  const clearHiddenBtn     = document.getElementById('clearHiddenBtn');
  const versionTagEl       = document.getElementById('versionTag');

  // ── Dynamic version (single source of truth: manifest.json) ───────────────
  try {
    const ver = chrome.runtime.getManifest().version;
    if (versionTagEl) versionTagEl.textContent = `v${ver}`;
  } catch (e) { /* manifest version unavailable */ }

  // ── Open Options ──────────────────────────────────────────────────────────
  openOptionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

  // ── Active tab ───────────────────────────────────────────────────────────
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let currentDomain = '';
  let currentOrigin = '';

  if (activeTab?.url) {
    try {
      const urlObj = new URL(activeTab.url);
      currentDomain = urlObj.hostname;
      currentOrigin = urlObj.origin;
      currentDomainEl.textContent = currentDomain || 'N/A';
    } catch {
      currentDomainEl.textContent = 'Internal Page';
    }
  }

  // ── Load settings, whitelist & blacklist ─────────────────────────────────
  const data      = await chrome.storage.local.get(['settings', 'whitelist', 'blacklist']);
  const settings  = data.settings || {};
  const whitelist = data.whitelist || [];
  const blacklist = data.blacklist || [];

  globalToggle.checked        = settings.enabled          !== false;
  overlayToggle.checked       = settings.blockOverlays    !== false;
  antiAdblockToggle.checked   = settings.blockAntiAdblock !== false;
  notificationsToggle.checked = settings.blockNotifications !== false;
  trackersToggle.checked      = settings.stripTrackers    !== false;
  fingerprintToggle.checked   = settings.antiFingerprint  !== false;
  popupsToggle.checked        = settings.blockPopups      !== false;
  gesturePopupsToggle.checked = settings.blockGesturedPopups === true;

  // ── Stats ────────────────────────────────────────────────────────────────
  updateStats(settings.totalBlocked || 0);

  // ── Whitelist / blacklist state ──────────────────────────────────────────
  const whitelisted = whitelist.includes(currentDomain);
  const blacklisted = blacklist.includes(currentDomain);
  updateWhitelistBtnUI(whitelisted);
  updateBlocklistBtnUI(blacklisted);
// ── Save settings helper ─────────────────────────────────────────────────
  async function saveSettings() {
    settings.enabled             = globalToggle.checked;
    settings.blockOverlays       = overlayToggle.checked;
    settings.blockAntiAdblock    = antiAdblockToggle.checked;
    settings.blockNotifications  = notificationsToggle.checked;
    settings.stripTrackers       = trackersToggle.checked;
    settings.antiFingerprint     = fingerprintToggle.checked;
    settings.blockPopups         = popupsToggle.checked;
    settings.blockGesturedPopups = gesturePopupsToggle.checked;
    await chrome.storage.local.set({ settings });
  }

  globalToggle.addEventListener('change', saveSettings);
  overlayToggle.addEventListener('change', saveSettings);
  antiAdblockToggle.addEventListener('change', saveSettings);
  notificationsToggle.addEventListener('change', saveSettings);
  trackersToggle.addEventListener('change', saveSettings);
  fingerprintToggle.addEventListener('change', saveSettings);
  popupsToggle.addEventListener('change', saveSettings);
  gesturePopupsToggle.addEventListener('change', saveSettings);

  // ── Whitelist toggle ─────────────────────────────────────────────────────
  whitelistBtn.addEventListener('click', async () => {
    if (!currentDomain || currentDomainEl.textContent === 'Internal Page') return;
    const d = await chrome.storage.local.get(['whitelist', 'blacklist']);
    let wl = d.whitelist || [];
    const bl = d.blacklist || [];
    if (wl.includes(currentDomain)) {
      wl = wl.filter(x => x !== currentDomain);
      updateWhitelistBtnUI(false);
    } else {
      wl.push(currentDomain);
      // Whitelist and blacklist are mutually exclusive in the UI flow.
      const newBl = bl.filter(x => x !== currentDomain);
      if (newBl.length !== bl.length) {
        await chrome.storage.local.set({ blacklist: newBl });
        updateBlocklistBtnUI(false);
      }
      updateWhitelistBtnUI(true);
    }
    await chrome.storage.local.set({ whitelist: wl });
  });

  // ── Strict blocklist toggle ──────────────────────────────────────────────
  blocklistBtn.addEventListener('click', async () => {
    if (!currentDomain || currentDomainEl.textContent === 'Internal Page') return;
    const d = await chrome.storage.local.get(['whitelist', 'blacklist']);
    let bl = d.blacklist || [];
    const wl = d.whitelist || [];
    if (bl.includes(currentDomain)) {
      bl = bl.filter(x => x !== currentDomain);
      updateBlocklistBtnUI(false);
    } else {
      bl.push(currentDomain);
      const newWl = wl.filter(x => x !== currentDomain);
      if (newWl.length !== wl.length) {
        await chrome.storage.local.set({ whitelist: newWl });
        updateWhitelistBtnUI(false);
      }
      updateBlocklistBtnUI(true);
    }
    await chrome.storage.local.set({ blacklist: bl });
  });
// ── Reset consents ────────────────────────────────────────────────────────
  resetConsentBtn.addEventListener('click', () => {
    if (!currentOrigin || currentDomainEl.textContent === 'Internal Page') return;
    resetConsentBtn.disabled    = true;
    resetConsentBtn.textContent = 'Clearing...';
    chrome.runtime.sendMessage({ type: 'CLEAR_SITE_DATA', origin: currentOrigin }, (res) => {
      resetConsentBtn.classList.add('done');
      resetConsentBtn.textContent = (res && res.success) ? '✓ Cleared!' : '✗ Failed';
      setTimeout(() => {
        resetConsentBtn.disabled = false;
        if (activeTab?.id) chrome.tabs.reload(activeTab.id);
        setTimeout(() => {
          resetConsentBtn.classList.remove('done');
          resetConsentBtn.textContent = 'Reset Stored Consents (Alt+Shift+P)';
        }, 2500);
      }, 800);
    });
  });

  // ── Whitelist / blacklist UI ─────────────────────────────────────────────
  function updateWhitelistBtnUI(whitelisted) {
    whitelistBtnText.textContent = whitelisted ? 'Whitelisted' : 'Whitelist Site';
    whitelistBtn.classList.toggle('active', whitelisted);
    if (whitelisted) blocklistBtn.classList.remove('active', 'blocked');
  }

  function updateBlocklistBtnUI(blocked) {
    blocklistBtnText.textContent = blocked ? 'Blocked' : 'Block Site';
    blocklistBtn.classList.toggle('active', blocked);
    blocklistBtn.classList.toggle('blocked', blocked);
    if (blocked) whitelistBtn.classList.remove('active');
  }

  // ── Show hidden element count for this domain ─────────────────────────────
  async function renderHiddenTools() {
    if (!currentDomain) return;
    const hKey = `hidden_${currentDomain}`;
    const hRes = await chrome.storage.local.get([hKey]);
    const hiddenSelectors = hRes[hKey] || [];
    hiddenCountEl.textContent = hiddenSelectors.length;
    clearHiddenBtn.hidden = hiddenSelectors.length === 0;
  }

  // ── Clear hidden elements for this domain ─────────────────────────────────
  clearHiddenBtn.addEventListener('click', async () => {
    if (!currentDomain) return;
    await chrome.storage.local.remove([`hidden_${currentDomain}`]);
    try {
      if (activeTab?.id) await chrome.tabs.sendMessage(activeTab.id, { type: 'CLEAR_CUSTOM_HIDDEN' });
    } catch (e) { /* content script not ready → styles reset on next reload */ }
    await renderHiddenTools();
  });

  // ── Pick Element button ───────────────────────────────────────────────────
  pickElementBtn.addEventListener('click', async () => {
    if (!activeTab?.id || currentDomainEl.textContent === 'Internal Page') return;
    pickElementBtn.classList.add('active');
    pickElementBtn.querySelector('span').textContent = 'Click element on page…';
    try {
      await chrome.tabs.sendMessage(activeTab.id, { type: 'ACTIVATE_PICKER' });
    } catch (e) { /* content script not ready */ }
    setTimeout(() => window.close(), 300);
  });

  await renderHiddenTools();
// ── Stats helpers ─────────────────────────────────────────────────────────
  function updateStats(totalBlocked) {
    totalBlocked = totalBlocked || 0;
    totalBlockedCountEl.textContent = totalBlocked;
    const dataSavedMB = (totalBlocked * 0.4).toFixed(1);
    dataSavedCountEl.textContent = `${dataSavedMB} MB`;
    const sec = totalBlocked * 3;
    timeSavedCountEl.textContent = sec > 60 ? `${(sec / 60).toFixed(1)}m` : `${sec}s`;
  }

  // ── Blocked list — read directly from storage (no SW round-trip) ──────────
  async function renderBlockedList(tabId) {
    const key = `ts_${tabId}`;
    const res = await chrome.storage.local.get([key]);
    const list = res[key] || [];

    tabBlockedCountEl.textContent = list.length;
    listBadge.textContent         = list.length;

    if (list.length === 0) {
      blockedListEl.innerHTML = `
        <div class="empty-state">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>
          </svg>
          <p>No popups intercepted on this page.</p>
        </div>`;
      return;
    }

    blockedListEl.innerHTML = '';
    list.slice().reverse().forEach((item) => {
      const div     = document.createElement('div');
      div.className = 'blocked-item-row';

      const urlSpan     = document.createElement('span');
      urlSpan.className = 'item-url-text';
      try {
        const u = new URL(item.url);
        urlSpan.textContent = u.hostname + (u.pathname !== '/' ? u.pathname : '');
      } catch {
        urlSpan.textContent = item.url;
      }
      urlSpan.title = item.url;

      const openBtn     = document.createElement('button');
      openBtn.className = 'btn btn-open';
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', () => chrome.tabs.create({ url: item.url }));

      div.appendChild(urlSpan);
      div.appendChild(openBtn);
      blockedListEl.appendChild(div);
    });
  }

  // ── Live update while the panel is open ───────────────────────────────────
  if (activeTab?.id) {
    await renderBlockedList(activeTab.id);

    chrome.storage.onChanged.addListener(async (changes) => {
      const key = `ts_${activeTab.id}`;
      if (changes[key]) await renderBlockedList(activeTab.id);
      if (changes.settings) {
        updateStats(changes.settings.newValue?.totalBlocked || 0);
      }
    });
  }
});