'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const files = ['reader.html', 'reader-styles.css', 'reader-core.js', 'reader-app.js'];
const apkArg = process.argv[2] || path.join(root, '小说阅读器.apk');

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

let failed = false;
for (const file of files) {
  const rootPath = path.join(root, file);
  const wwwPath = path.join(root, 'www', file);
  const assetPath = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public', file);
  if (!fs.existsSync(rootPath)) {
    console.error(`MISSING root source: ${file}`);
    failed = true;
    continue;
  }
  const rootHash = hashFile(rootPath);
  const wwwHash = fs.existsSync(wwwPath) ? hashFile(wwwPath) : null;
  const assetHash = fs.existsSync(assetPath) ? hashFile(assetPath) : null;
  const wwwOk = wwwHash === rootHash;
  const assetOk = assetHash === rootHash;
  console.log(`${file.padEnd(20)} root=${rootHash.slice(0, 12)} www=${wwwHash ? wwwHash.slice(0, 12) : 'N/A'}${wwwOk ? ' OK' : ' MISMATCH'}  android-assets=${assetHash ? assetHash.slice(0, 12) : 'N/A'}${assetOk ? ' OK' : ' MISMATCH'}`);
  if (!wwwOk) failed = true;
  if (!assetOk) failed = true;
}

if (fs.existsSync(apkArg)) {
  try {
    const out = execSync(`tar -xOf "${apkArg}" assets/public/reader-app.js`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    const apkHash = crypto.createHash('sha256').update(out).digest('hex');
    const expected = hashFile(path.join(root, 'reader-app.js'));
    const ok = apkHash === expected;
    console.log(`reader-app.js in APK:  ${apkHash.slice(0, 12)}${ok ? ' OK' : ' MISMATCH (stale APK!)'}`);
    if (!ok) failed = true;
  } catch (error) {
    console.error(`APK verification failed: ${String(error && error.message || error).slice(0, 300)}`);
    failed = true;
  }
} else {
  console.log(`APK not found (${apkArg}), skipping in-package check`);
}

if (failed) {
  console.error('VERIFY FAILED: root/www/android-assets/apk are not in sync.');
  process.exit(1);
}
console.log('VERIFY OK: root, www, Android assets and APK are identical.');
