document.addEventListener('DOMContentLoaded', async () => {
  const globalToggle = document.getElementById('globalToggle');
  const overlayToggle = document.getElementById('overlayToggle');
  const antiAdblockToggle = document.getElementById('antiAdblockToggle');
  const notificationsToggle = document.getElementById('notificationsToggle');
  const trackersToggle = document.getElementById('trackersToggle');
  const fingerprintToggle = document.getElementById('fingerprintToggle');

  const currentDomainEl = document.getElementById('currentDomain');
  const whitelistBtn = document.getElementById('whitelistBtn');
  const whitelistBtnText = document.getElementById('whitelistBtnText');
  const resetConsentBtn = document.getElementById('resetConsentBtn');
  const openOptionsBtn = document.getElementById('openOptionsBtn');

  const tabBlockedCountEl = document.getElementById('tabBlockedCount');
  const totalBlockedCountEl = document.getElementById('totalBlockedCount');
  const blockedListEl = document.getElementById('blockedList');
  const listBadge = document.getElementById('listBadge');

  // Open Options page
  openOptionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Query active tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let currentDomain = '';
  let currentOrigin = '';
  
  if (activeTab && activeTab.url) {
    try {
      const urlObj = new URL(activeTab.url);
      currentDomain = urlObj.hostname;
      currentOrigin = urlObj.origin;
      currentDomainEl.textContent = currentDomain || 'N/A';
    } catch (e) {
      currentDomainEl.textContent = 'Internal Page';
    }
  }

  // Load storage state
  const data = await chrome.storage.local.get(['settings', 'whitelist']);
  const settings = data.settings || {};
  const whitelist = data.whitelist || [];

  globalToggle.checked = settings.enabled !== false;
  overlayToggle.checked = settings.blockOverlays !== false;
  antiAdblockToggle.checked = settings.blockAntiAdblock !== false;
  notificationsToggle.checked = settings.blockNotifications !== false;
  trackersToggle.checked = settings.stripTrackers !== false;
  fingerprintToggle.checked = settings.antiFingerprint !== false;

  totalBlockedCountEl.textContent = settings.totalBlocked || 0;

  const isWhitelisted = whitelist.includes(currentDomain);
  updateWhitelistBtnUI(isWhitelisted);

  // Helper to save settings
  async function saveSettings() {
    settings.enabled = globalToggle.checked;
    settings.blockOverlays = overlayToggle.checked;
    settings.blockAntiAdblock = antiAdblockToggle.checked;
    settings.blockNotifications = notificationsToggle.checked;
    settings.stripTrackers = trackersToggle.checked;
    settings.antiFingerprint = fingerprintToggle.checked;
    await chrome.storage.local.set({ settings });
  }

  // Bind toggles
  globalToggle.addEventListener('change', saveSettings);
  overlayToggle.addEventListener('change', saveSettings);
  antiAdblockToggle.addEventListener('change', saveSettings);
  notificationsToggle.addEventListener('change', saveSettings);
  trackersToggle.addEventListener('change', saveSettings);
  fingerprintToggle.addEventListener('change', saveSettings);

  // Whitelist Button Listener
  whitelistBtn.addEventListener('click', async () => {
    if (!currentDomain || currentDomainEl.textContent === 'Internal Page') return;
    
    const currentData = await chrome.storage.local.get(['whitelist']);
    let list = currentData.whitelist || [];

    if (list.includes(currentDomain)) {
      list = list.filter(d => d !== currentDomain);
      updateWhitelistBtnUI(false);
    } else {
      list.push(currentDomain);
      updateWhitelistBtnUI(true);
    }

    await chrome.storage.local.set({ whitelist: list });
  });

  // Reset Stored Consents & Cookies Button Listener
  resetConsentBtn.addEventListener('click', () => {
    if (!currentOrigin || currentDomainEl.textContent === 'Internal Page') return;

    resetConsentBtn.disabled = true;
    resetConsentBtn.textContent = 'Clearing site cookies & consents...';

    chrome.runtime.sendMessage({ type: 'CLEAR_SITE_DATA', origin: currentOrigin }, (res) => {
      resetConsentBtn.classList.add('done');
      resetConsentBtn.textContent = '✓ Site Consents & Storage Cleared!';

      setTimeout(() => {
        if (activeTab && activeTab.id) {
          chrome.tabs.reload(activeTab.id);
        }
      }, 800);
    });
  });

  function updateWhitelistBtnUI(whitelisted) {
    if (whitelisted) {
      whitelistBtnText.textContent = 'Whitelisted';
      whitelistBtn.classList.add('active');
    } else {
      whitelistBtnText.textContent = 'Whitelist Site';
      whitelistBtn.classList.remove('active');
    }
  }

  // Load blocked items for tab
  if (activeTab) {
    chrome.runtime.sendMessage({ type: 'GET_TAB_STATE', tabId: activeTab.id }, (res) => {
      const list = (res && res.blockedPopups) ? res.blockedPopups : [];
      tabBlockedCountEl.textContent = list.length;
      listBadge.textContent = list.length;

      if (list.length > 0) {
        blockedListEl.innerHTML = '';
        list.forEach((item) => {
          const div = document.createElement('div');
          div.className = 'blocked-item-row';
          
          const urlSpan = document.createElement('span');
          urlSpan.className = 'item-url-text';
          urlSpan.textContent = item.url;
          urlSpan.title = item.url;

          const openBtn = document.createElement('button');
          openBtn.className = 'btn btn-open';
          openBtn.textContent = 'Open';
          openBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: item.url });
          });

          div.appendChild(urlSpan);
          div.appendChild(openBtn);
          blockedListEl.appendChild(div);
        });
      }
    });
  }
});
