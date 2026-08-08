const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_ZIP = path.join(ROOT_DIR, 'popOUT-v1.3.0.zip');

const INCLUDED_PATHS = [
  'manifest.json',
  'README.md',
  'assets',
  'background',
  'content',
  'options',
  'popup'
];

console.log('📦 Packaging popOUT for Chrome Web Store release...');

// Use PowerShell Compress-Archive on Windows
const itemsToCompress = INCLUDED_PATHS.map(p => `'${path.join(ROOT_DIR, p)}'`).join(',');

if (fs.existsSync(OUTPUT_ZIP)) {
  fs.unlinkSync(OUTPUT_ZIP);
}

const command = `powershell -Command "Compress-Archive -Path ${itemsToCompress} -DestinationPath '${OUTPUT_ZIP}' -Force"`;

try {
  execSync(command, { stdio: 'inherit' });
  console.log(`✅ Release package created successfully: ${OUTPUT_ZIP}`);
} catch (err) {
  console.error('❌ Failed to create zip package:', err);
  process.exit(1);
}
