document.addEventListener('DOMContentLoaded', async () => {
  const globalToggle        = document.getElementById('globalToggle');
  const overlayToggle       = document.getElementById('overlayToggle');
  const antiAdblockToggle   = document.getElementById('antiAdblockToggle');
  const notificationsToggle = document.getElementById('notificationsToggle');
  const trackersToggle      = document.getElementById('trackersToggle');
  const fingerprintToggle   = document.getElementById('fingerprintToggle');

  const currentDomainEl    = document.getElementById('currentDomain');
  const whitelistBtn       = document.getElementById('whitelistBtn');
  const whitelistBtnText   = document.getElementById('whitelistBtnText');
  const resetConsentBtn    = document.getElementById('resetConsentBtn');
  const openOptionsBtn     = document.getElementById('openOptionsBtn');
  const tabBlockedCountEl  = document.getElementById('tabBlockedCount');
  const totalBlockedCountEl= document.getElementById('totalBlockedCount');
  const dataSavedCountEl   = document.getElementById('dataSavedCount');
  const timeSavedCountEl   = document.getElementById('timeSavedCount');
  const blockedListEl      = document.getElementById('blockedList');
  const listBadge          = document.getElementById('listBadge');

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

  // ── Load settings & whitelist ─────────────────────────────────────────────
  const data     = await chrome.storage.local.get(['settings', 'whitelist']);
  const settings = data.settings || {};
  const whitelist= data.whitelist || [];

  globalToggle.checked        = settings.enabled          !== false;
  overlayToggle.checked       = settings.blockOverlays    !== false;
  antiAdblockToggle.checked   = settings.blockAntiAdblock !== false;
  notificationsToggle.checked = settings.blockNotifications !== false;
  trackersToggle.checked      = settings.stripTrackers    !== false;
  fingerprintToggle.checked   = settings.antiFingerprint  !== false;

  // ── Stats ────────────────────────────────────────────────────────────────
  const totalBlocked  = settings.totalBlocked || 0;
  const dataSavedMB   = (totalBlocked * 0.4).toFixed(1);
  const timeSavedSec  = totalBlocked * 3;

  totalBlockedCountEl.textContent = totalBlocked;
  dataSavedCountEl.textContent    = `${dataSavedMB} MB`;
  timeSavedCountEl.textContent    = timeSavedSec > 60
    ? `${(timeSavedSec / 60).toFixed(1)}m`
    : `${timeSavedSec}s`;

  // ── Whitelist state ───────────────────────────────────────────────────────
  updateWhitelistBtnUI(whitelist.includes(currentDomain));

  // ── Save settings helper ──────────────────────────────────────────────────
  async function saveSettings() {
    settings.enabled             = globalToggle.checked;
    settings.blockOverlays       = overlayToggle.checked;
    settings.blockAntiAdblock    = antiAdblockToggle.checked;
    settings.blockNotifications  = notificationsToggle.checked;
    settings.stripTrackers       = trackersToggle.checked;
    settings.antiFingerprint     = fingerprintToggle.checked;
    await chrome.storage.local.set({ settings });
  }

  globalToggle.addEventListener('change', saveSettings);
  overlayToggle.addEventListener('change', saveSettings);
  antiAdblockToggle.addEventListener('change', saveSettings);
  notificationsToggle.addEventListener('change', saveSettings);
  trackersToggle.addEventListener('change', saveSettings);
  fingerprintToggle.addEventListener('change', saveSettings);

  // ── Whitelist toggle ──────────────────────────────────────────────────────
  whitelistBtn.addEventListener('click', async () => {
    if (!currentDomain || currentDomainEl.textContent === 'Internal Page') return;
    const d = await chrome.storage.local.get(['whitelist']);
    let list = d.whitelist || [];
    if (list.includes(currentDomain)) {
      list = list.filter(x => x !== currentDomain);
      updateWhitelistBtnUI(false);
    } else {
      list.push(currentDomain);
      updateWhitelistBtnUI(true);
    }
    await chrome.storage.local.set({ whitelist: list });
  });

  // ── Reset consents ────────────────────────────────────────────────────────
  resetConsentBtn.addEventListener('click', () => {
    if (!currentOrigin || currentDomainEl.textContent === 'Internal Page') return;
    resetConsentBtn.disabled    = true;
    resetConsentBtn.textContent = 'Clearing...';
    chrome.runtime.sendMessage({ type: 'CLEAR_SITE_DATA', origin: currentOrigin }, () => {
      resetConsentBtn.classList.add('done');
      resetConsentBtn.textContent = '✓ Cleared!';
      setTimeout(() => { if (activeTab?.id) chrome.tabs.reload(activeTab.id); }, 800);
    });
  });

  // ── Whitelist UI ──────────────────────────────────────────────────────────
  function updateWhitelistBtnUI(whitelisted) {
    whitelistBtnText.textContent = whitelisted ? 'Whitelisted' : 'Whitelist Site';
    whitelistBtn.classList.toggle('active', whitelisted);
  }

  // ── Load blocked list — READ DIRECTLY from storage, no SW round-trip ─────
  if (activeTab?.id) {
    await renderBlockedList(activeTab.id);

    // Live-update when storage changes (e.g. new popup blocked while panel is open)
    chrome.storage.onChanged.addListener(async (changes) => {
      const key = `ts_${activeTab.id}`;
      if (changes[key]) await renderBlockedList(activeTab.id);
      // Refresh total stats too
      if (changes.settings) {
        const newTotal = (changes.settings.newValue?.totalBlocked) || 0;
        totalBlockedCountEl.textContent = newTotal;
        dataSavedCountEl.textContent = `${(newTotal * 0.4).toFixed(1)} MB`;
        const sec = newTotal * 3;
        timeSavedCountEl.textContent = sec > 60 ? `${(sec / 60).toFixed(1)}m` : `${sec}s`;
      }
    });
  }

  async function renderBlockedList(tabId) {
    const key = `ts_${tabId}`;
    const res  = await chrome.storage.local.get([key]);
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
});
