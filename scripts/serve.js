const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const MIME = {
  '.html':'text/html;charset=utf-8',
  '.css':'text/css;charset=utf-8',
  '.js':'application/javascript;charset=utf-8',
  '.json':'application/json;charset=utf-8',
  '.svg':'image/svg+xml',
  '.txt':'text/plain;charset=utf-8',
  '.png':'image/png',
  '.ico':'image/x-icon'
};

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? 'reader.html' : req.url);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = require('os').networkInterfaces();
  const addresses = [];
  Object.keys(ip).forEach(key => {
    ip[key].forEach(d => {
      if (d.family === 'IPv4' && !d.internal) addresses.push(d.address);
    });
  });
  console.log('┌────────────────────────────────────────┐');
  console.log('│        小说阅读器 · 手机访问             │');
  console.log('├────────────────────────────────────────┤');
  console.log('│  电脑端: http://localhost:' + PORT + '       │');
  addresses.forEach(addr => {
    console.log('│  手机端: http://' + addr + ':' + PORT + padAddr(addr) + '│');
  });
  console.log('└────────────────────────────────────────┘');
  console.log('手机和电脑需要在同一 WiFi 下');
  console.log('手机 Chrome 打开后 → 菜单 → 添加到主屏幕');
});

function padAddr(addr) {
  const len = addr.length;
  return ' '.repeat(Math.max(0, 20 - len));
}
