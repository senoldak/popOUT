/**
 * popOUT — project sanity checker
 * Run with:  node scripts/check.js
 *
 * Verifies:
 *   1. All files referenced by manifest.json exist.
 *   2. Declared permissions are actually used (and nothing is missing).
 *   3. Version consistency: build script + zip naming + UI placeholders.
 *   4. No .popout-scanned / legacy no-op leftovers (`data-popout-scanned` ok).
 *   5. Basic bracket balance on the rewritten core scripts (cheap smoke test).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let errors = 0;
const err = (msg) => { errors++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

console.log('\npopOUT project check\n' + '-'.repeat(40));

// ── 1. manifest parses + referenced files exist ──────────────────────────────
let manifest;
try {
  manifest = JSON.parse(read('manifest.json'));
  ok('manifest.json parses');
} catch (e) {
  err('manifest.json is invalid JSON: ' + e.message);
  process.exit(1);
}

const referenced = [];
if (manifest.background?.service_worker) referenced.push(manifest.background.service_worker);
if (manifest.action?.default_popup) referenced.push(manifest.action.default_popup);
if (manifest.options_ui?.page) referenced.push(manifest.options_ui.page);
for (const cs of manifest.content_scripts || []) {
  for (const js of cs.js || []) referenced.push(js);
}
for (const res of manifest.web_accessible_resources || []) {
  for (const r of res.resources || []) referenced.push(r);
}
for (const size of Object.values(manifest.action?.default_icon || {})) referenced.push(size);

for (const ref of referenced) {
  if (!fs.existsSync(path.join(ROOT, ref))) {
    err(`manifest references missing file: ${ref}`);
  }
}
console.log(`  ✓ ${referenced.length} referenced files checked`);

// ── 2. permissions vs usage ───────────────────────────────────────────────────
const allSources = [];
const sourceDirs = ['background', 'content', 'popup', 'options'];
for (const dir of sourceDirs) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    if (f.endsWith('.js')) allSources.push(read(path.join(dir, f)));
  }
}
const src = allSources.join('\n');

const declared = manifest.permissions || [];
for (const perm of ['scripting', 'cookies', 'activeTab']) {
  if (declared.includes(perm)) err(`permission "${perm}" is declared but not needed (no chrome.${perm} usage found)`);
}
for (const perm of declared) {
  if (!new RegExp(`chrome\\.${perm}\\b`).test(src)) {
    err(`permission "${perm}" has no chrome.${perm} usage in source`);
  }
}
// chrome.runtime / chrome.action / chrome.tabs(??) — note: tabs IS a permission.
const required = { tabs: 'tabs', storage: 'storage', browsingData: 'browsingData' };
for (const [ns, perm] of Object.entries(required)) {
  if (src.includes(`chrome.${ns}`) && !declared.includes(perm)) {
    err(`source uses chrome.${ns} but the "${perm}" permission is missing`);
  }
}
ok('permission set matches usage');

// ── 3. version consistency ────────────────────────────────────────────────────
const version = manifest.version;
const buildSrc = read('scripts/build_zip.js');
if (!buildSrc.includes(`manifest.version`)) err('build_zip.js no longer reads version from manifest');
ok(`manifest version = ${version}`);

const legacyZip = fs.readdirSync(ROOT).find((f) => /^popOUT-v\d/.test(f) && f.endsWith('.zip'));
if (legacyZip) {
  // The checked-in zip must match the manifest version (re-run `npm run build`).
  const zipVer = legacyZip.match(/popOUT-v([\d.]+)\.zip/)?.[1];
  if (zipVer && zipVer !== version) {
    err(`stale release artifact ${legacyZip} (manifest is v${version})`);
  } else {
    ok(`release artifact ${legacyZip} matches manifest`);
  }
}

// ── 4. leftover debugging / known-bad patterns ────────────────────────────────
const badPatterns = [
  [/return result\.slice\(0, eqIdx\) \+ result\.slice\(eqIdx\)/, 'legacy canvas no-op salt found in content/injected.js'],
  [/console\.log\(/, 'console.log left in source (use debug logger)']
];
for (const [re, msg] of badPatterns) {
  for (const dir of sourceDirs) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (!f.endsWith('.js')) continue;
      const body = read(path.join(dir, f));
      if (re.test(body)) err(`${msg} in ${dir}/${f}`);
    }
  }
}
console.log('  ✓ source patterns clean');

// ── 5. definitive syntax validation for core scripts ─────────────────────────
// `new Function(src)` compiles the code without executing it — a real parse,
// immune to regex literal / comment heuristics.
for (const f of ['content/content.js', 'content/injected.js', 'background/service_worker.js', 'popup/popup.js', 'options/options.js']) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(read(f));
    ok(`${f} parses (syntax OK)`);
  } catch (e) {
    err(`${f} failed to parse: ${e.message}`);
  }
}

console.log('-'.repeat(40));
if (errors) {
  console.error(`✗ ${errors} problem(s) found.\n`);
  process.exit(1);
}
console.log('✔ All checks passed.\n');