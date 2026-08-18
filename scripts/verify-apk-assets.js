'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const files = [
  { source: 'reader.html', output: 'index.html' },
  { source: 'reader-styles.css', output: 'reader-styles.css' },
  { source: 'reader-core.js', output: 'reader-core.js' },
  { source: 'reader-app.js', output: 'reader-app.js' }
];
const apkArg = path.resolve(process.argv[2] || path.join(root, '小说阅读器.apk'));

function hash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function readFile(label, file) {
  if (!fs.existsSync(file)) {
    console.error(`MISSING ${label}: ${file}`);
    return null;
  }
  const content = fs.readFileSync(file);
  if (content.length === 0) {
    console.error(`EMPTY ${label}: ${file}`);
    return null;
  }
  return content;
}

let failed = false;
const expected = new Map();

for (const file of files) {
  const rootPath = path.join(root, file.source);
  const wwwPath = path.join(root, 'www', file.output);
  const assetPath = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public', file.output);
  const rootContent = readFile('root source', rootPath);
  const wwwContent = readFile('www asset', wwwPath);
  const assetContent = readFile('Android asset', assetPath);

  if (!rootContent || !wwwContent || !assetContent) {
    failed = true;
    continue;
  }

  const rootHash = hash(rootContent);
  const wwwHash = hash(wwwContent);
  const assetHash = hash(assetContent);
  const wwwOk = wwwHash === rootHash;
  const assetOk = assetHash === rootHash;
  expected.set(file.output, { hash: rootHash });
  console.log(`${file.source.padEnd(20)} -> ${file.output.padEnd(18)} root=${rootHash.slice(0, 12)} www=${wwwHash.slice(0, 12)}${wwwOk ? ' OK' : ' MISMATCH'}  android-assets=${assetHash.slice(0, 12)}${assetOk ? ' OK' : ' MISMATCH'}`);
  if (!wwwOk || !assetOk) failed = true;
}

const apkContent = readFile('APK', apkArg);
if (!apkContent) {
  failed = true;
} else {
  for (const file of files) {
    const entry = `assets/public/${file.output}`;
    const source = expected.get(file.output);
    try {
      const content = execFileSync('tar', ['-xOf', apkArg, entry], {
        encoding: 'buffer',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024
      });
      if (content.length === 0) {
        console.error(`EMPTY APK entry: ${entry}`);
        failed = true;
        continue;
      }
      if (!source) {
        console.error(`UNVERIFIED APK entry (root source unavailable): ${entry}`);
        failed = true;
        continue;
      }
      const apkHash = hash(content);
      const ok = apkHash === source.hash;
      console.log(`${entry.padEnd(42)} apk=${apkHash.slice(0, 12)}${ok ? ' OK' : ' MISMATCH (stale APK!)'}`);
      if (!ok) failed = true;
    } catch (error) {
      const detail = String(error && (error.stderr || error.message) || error).trim().slice(0, 300);
      console.error(`MISSING APK entry: ${entry}${detail ? ` (${detail})` : ''}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('VERIFY FAILED: root/www/android-assets/apk are not in sync.');
  process.exit(1);
}
console.log('VERIFY OK: root, www, Android assets and APK are identical.');
