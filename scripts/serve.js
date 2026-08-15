const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8080;
const ROOT = path.resolve(__dirname, '..');
const ALLOWED_FILES = new Set([
  'reader.html',
  'reader-styles.css',
  'reader-core.js',
  'reader-app.js',
  'manifest.json',
  'config/icon.svg',
  'icon.svg'
]);
const MIME = {
  '.html': 'text/html;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.js': 'application/javascript;charset=utf-8',
  '.json': 'application/json;charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain;charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let fileName = 'reader.html';
  try {
    const parsed = new URL(req.url, 'http://localhost');
    const decoded = decodeURIComponent(parsed.pathname);
    fileName = decoded === '/' ? 'reader.html' : decoded.replace(/^\/+/, '');
  } catch (e) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (!ALLOWED_FILES.has(fileName)) {
    res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' });
    res.end('Not found');
    return;
  }

  const filePath = path.join(ROOT, fileName);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const addresses = [];
  for (const devices of Object.values(os.networkInterfaces())) {
    for (const device of devices || []) {
      if (device.family === 'IPv4' && !device.internal) addresses.push(device.address);
    }
  }

  console.log('小说阅读器手机访问服务已启动');
  console.log('电脑访问: http://localhost:' + PORT);
  for (const addr of addresses) {
    console.log('手机访问: http://' + addr + ':' + PORT);
  }
  console.log('手机和电脑需要在同一个 Wi-Fi 下');
});
