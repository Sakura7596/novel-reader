'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const wwwDir = path.join(root, 'www');
const files = [
  'reader.html',
  'reader-styles.css',
  'reader-core.js',
  'reader-app.js',
  'manifest.json',
  'icon.svg'
];

fs.mkdirSync(wwwDir, { recursive: true });
let copied = 0;
for (const file of files) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) continue;
  fs.copyFileSync(source, path.join(wwwDir, file));
  copied++;
}

const manifestPath = path.join(wwwDir, 'manifest.json');
if (fs.existsSync(manifestPath)) {
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  manifest = manifest.replace(/"src":\s*"[^"]*icon\.svg"/, '"src": "icon.svg"');
  fs.writeFileSync(manifestPath, manifest);
}

const configDir = path.join(wwwDir, 'config');
fs.mkdirSync(configDir, { recursive: true });
const sourceIcon = path.join(root, 'config', 'icon.svg');
if (fs.existsSync(sourceIcon)) {
  fs.copyFileSync(sourceIcon, path.join(configDir, 'icon.svg'));
  copied++;
}

const readerHtml = path.join(wwwDir, 'reader.html');
if (fs.existsSync(readerHtml)) {
  fs.copyFileSync(readerHtml, path.join(wwwDir, 'index.html'));
  copied++;
}

console.log(`www synced (${copied} files). Android build now uses the latest source.`);
