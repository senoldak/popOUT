document.addEventListener('DOMContentLoaded', async () => {
  const globalToggle = document.getElementById('globalToggle');
  const currentDomainEl = document.getElementById('currentDomain');
  const whitelistBtn = document.getElementById('whitelistBtn');
  const tabBlockedCountEl = document.getElementById('tabBlockedCount');
  const totalBlockedCountEl = document.getElementById('totalBlockedCount');
  const blockedListEl = document.getElementById('blockedList');

  // Query active tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let currentDomain = '';
  
  if (activeTab && activeTab.url) {
    try {
      const urlObj = new URL(activeTab.url);
      currentDomain = urlObj.hostname;
      currentDomainEl.textContent = currentDomain || 'N/A';
    } catch (e) {
      currentDomainEl.textContent = 'System Page';
    }
  }

  // Load storage state
  const data = await chrome.storage.local.get(['settings', 'whitelist']);
  const settings = data.settings || { enabled: true, totalBlocked: 0 };
  const whitelist = data.whitelist || [];

  globalToggle.checked = settings.enabled;
  totalBlockedCountEl.textContent = settings.totalBlocked || 0;

  const isWhitelisted = whitelist.includes(currentDomain);
  updateWhitelistBtnUI(isWhitelisted);

  // Global Toggle Listener
  globalToggle.addEventListener('change', async () => {
    settings.enabled = globalToggle.checked;
    await chrome.storage.local.set({ settings });
  });

  // Whitelist Button Listener
  whitelistBtn.addEventListener('click', async () => {
    if (!currentDomain || currentDomainEl.textContent === 'System Page') return;
    
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

  function updateWhitelistBtnUI(whitelisted) {
    if (whitelisted) {
      whitelistBtn.textContent = 'Whitelisted';
      whitelistBtn.classList.remove('btn-secondary');
      whitelistBtn.classList.add('btn-active');
    } else {
      whitelistBtn.textContent = 'Whitelist Site';
      whitelistBtn.classList.remove('btn-active');
      whitelistBtn.classList.add('btn-secondary');
    }
  }

  // Load blocked items for tab
  if (activeTab) {
    chrome.runtime.sendMessage({ type: 'GET_TAB_STATE', tabId: activeTab.id }, (res) => {
      const list = (res && res.blockedPopups) ? res.blockedPopups : [];
      tabBlockedCountEl.textContent = list.length;

      if (list.length > 0) {
        blockedListEl.innerHTML = '';
        list.forEach((item) => {
          const div = document.createElement('div');
          div.className = 'blocked-item';
          
          const urlSpan = document.createElement('span');
          urlSpan.className = 'blocked-url';
          urlSpan.textContent = item.url;

          const openBtn = document.createElement('button');
          openBtn.className = 'btn btn-secondary';
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
