const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

// Version is read from manifest.json so packaging can never drift.
const manifestPath = path.join(ROOT_DIR, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const VERSION = manifest.version;
const OUTPUT_ZIP = path.join(ROOT_DIR, `popOUT-v${VERSION}.zip`);

const INCLUDED_PATHS = [
  'manifest.json',
  'README.md',
  'assets',
  'background',
  'content',
  'options',
  'popup'
];

console.log(`📦 Packaging popOUT v${VERSION} for Chrome Web Store release...`);

// Use PowerShell Compress-Archive on Windows
const itemsToCompress = INCLUDED_PATHS.map(p => `'${path.join(ROOT_DIR, p)}'`).join(',');

if (fs.existsSync(OUTPUT_ZIP)) {
  fs.unlinkSync(OUTPUT_ZIP);
}

const command = `powershell -Command "Compress-Archive -Path ${itemsToCompress} -DestinationPath '${OUTPUT_ZIP}' -Force"`;

try {
  execSync(command, { stdio: 'inherit' });
  console.log(`✅ Release package created successfully: popOUT-v${VERSION}.zip`);
} catch (err) {
  console.error('❌ Failed to create zip package:', err);
  process.exit(1);
}
