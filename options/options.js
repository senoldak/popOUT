document.addEventListener('DOMContentLoaded', async () => {
  const whitelistInput = document.getElementById('whitelistInput');
  const addWhitelistBtn = document.getElementById('addWhitelistBtn');
  const whitelistContainer = document.getElementById('whitelistContainer');
  const whitelistError = document.getElementById('whitelistError');

  const blacklistInput = document.getElementById('blacklistInput');
  const addBlacklistBtn = document.getElementById('addBlacklistBtn');
  const blacklistContainer = document.getElementById('blacklistContainer');
  const blacklistError = document.getElementById('blacklistError');

  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const versionTag = document.getElementById('versionTag');

  // ── Dynamic version ─────────────────────────────────────────────────────────
  try {
    const ver = chrome.runtime.getManifest().version;
    if (versionTag) versionTag.textContent = `Ultimate Protection Suite v${ver}`;
  } catch (e) { /* ignore */ }

  // ── Domain normalization & validation ──────────────────────────────────────
  const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

  function normalizeDomain(input) {
    let d = (input || '').trim().toLowerCase();
    if (!d) return '';
    // Strip protocol/path/port if the user pasted a full URL.
    try {
      d = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(d) ? d : 'http://' + d).hostname;
    } catch (e) {
      d = d.split(/[/?#:]/)[0];
    }
    return d.replace(/^www\./, '');
  }

  function isValidDomain(d) {
    return !!d && DOMAIN_RE.test(d);
  }

  function showError(el, show) {
    if (!el) return;
    el.hidden = !show;
    if (show) setTimeout(() => { el.hidden = true; }, 3000);
  }

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
      remove.setAttribute('role', 'button');
      remove.setAttribute('aria-label', `Remove ${domain}`);
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

  // Shared add-domain logic (whitelist + strict blocklist)
  async function addDomain(listKey, inputEl, errorEl, container) {
    const domain = normalizeDomain(inputEl.value);
    if (!isValidDomain(domain)) {
      showError(errorEl, true);
      return;
    }
    const data = await chrome.storage.local.get([listKey]);
    const list = data[listKey] || [];
    if (!list.includes(domain)) {
      list.push(domain);
      await chrome.storage.local.set({ [listKey]: list });
    }
    inputEl.value = '';
    loadState();
  }

  addWhitelistBtn.addEventListener('click', () => addDomain('whitelist', whitelistInput, whitelistError, whitelistContainer));
  whitelistInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addDomain('whitelist', whitelistInput, whitelistError, whitelistContainer); });

  addBlacklistBtn.addEventListener('click', () => addDomain('blacklist', blacklistInput, blacklistError, blacklistContainer));
  blacklistInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addDomain('blacklist', blacklistInput, blacklistError, blacklistContainer); });
// ── Export JSON ──────────────────────────────────────────────────────────────
  exportBtn.addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['settings', 'whitelist', 'blacklist']);
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `popOUT-backup-${chrome.runtime.getManifest().version}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // ── Import JSON (with validation) ───────────────────────────────────────────
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (!imported || typeof imported !== 'object') throw new Error('not an object');

        const patch = {};
        if (imported.settings && typeof imported.settings === 'object') {
          // Merge over existing settings so partial backups never lose keys.
          const cur = await chrome.storage.local.get(['settings']);
          patch.settings = { ...(cur.settings || {}), ...imported.settings };
        }
        // Only accept well-formed array fields.
        if (Array.isArray(imported.whitelist)) patch.whitelist = imported.whitelist;
        if (Array.isArray(imported.blacklist)) patch.blacklist = imported.blacklist;

        if (Object.keys(patch).length === 0) throw new Error('no recognizable fields');
        await chrome.storage.local.set(patch);
        alert(`popOUT configuration successfully imported! (${Object.keys(patch).length} section(s))`);
        loadState();
      } catch (err) {
        alert('Invalid JSON file format.');
      }
    };
    reader.readAsText(file);
    importFile.value = '';
  });
});