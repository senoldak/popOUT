document.addEventListener('DOMContentLoaded', async () => {
  const whitelistInput = document.getElementById('whitelistInput');
  const addWhitelistBtn = document.getElementById('addWhitelistBtn');
  const whitelistContainer = document.getElementById('whitelistContainer');

  const blacklistInput = document.getElementById('blacklistInput');
  const addBlacklistBtn = document.getElementById('addBlacklistBtn');
  const blacklistContainer = document.getElementById('blacklistContainer');

  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');

  // Render list of chips
  function renderChips(container, list, onRemove) {
    container.innerHTML = '';
    if (list.length === 0) {
      container.innerHTML = '<span style="font-size:12px; color:#64748b;">No domains configured.</span>';
      return;
    }
    list.forEach((domain) => {
      const chip = document.createElement('div');
      chip.className = 'domain-chip';
      
      const span = document.createElement('span');
      span.textContent = domain;

      const remove = document.createElement('span');
      remove.className = 'remove-chip';
      remove.textContent = '×';
      remove.addEventListener('click', () => onRemove(domain));

      chip.appendChild(span);
      chip.appendChild(remove);
      container.appendChild(chip);
    });
  }

  // Load state
  async function loadState() {
    const data = await chrome.storage.local.get(['whitelist', 'blacklist']);
    const whitelist = data.whitelist || [];
    const blacklist = data.blacklist || [];

    renderChips(whitelistContainer, whitelist, async (domain) => {
      const newList = whitelist.filter(d => d !== domain);
      await chrome.storage.local.set({ whitelist: newList });
      loadState();
    });

    renderChips(blacklistContainer, blacklist, async (domain) => {
      const newList = blacklist.filter(d => d !== domain);
      await chrome.storage.local.set({ blacklist: newList });
      loadState();
    });
  }

  loadState();

  // Add Whitelist Domain
  addWhitelistBtn.addEventListener('click', async () => {
    const domain = whitelistInput.value.trim().toLowerCase();
    if (!domain) return;

    const data = await chrome.storage.local.get(['whitelist']);
    const list = data.whitelist || [];
    if (!list.includes(domain)) {
      list.push(domain);
      await chrome.storage.local.set({ whitelist: list });
    }
    whitelistInput.value = '';
    loadState();
  });

  // Add Blacklist Domain
  addBlacklistBtn.addEventListener('click', async () => {
    const domain = blacklistInput.value.trim().toLowerCase();
    if (!domain) return;

    const data = await chrome.storage.local.get(['blacklist']);
    const list = data.blacklist || [];
    if (!list.includes(domain)) {
      list.push(domain);
      await chrome.storage.local.set({ blacklist: list });
    }
    blacklistInput.value = '';
    loadState();
  });

  // Export JSON
  exportBtn.addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['settings', 'whitelist', 'blacklist']);
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'popOUT-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Import JSON
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (imported.settings || imported.whitelist || imported.blacklist) {
          await chrome.storage.local.set(imported);
          alert('popOUT configuration successfully imported!');
          loadState();
        }
      } catch (err) {
        alert('Invalid JSON file format.');
      }
    };
    reader.readAsText(file);
  });
});
