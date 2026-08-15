'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function findChrome() {
  return chromeCandidates.find(p => p && fs.existsSync(p));
}

function injectHarness(html) {
  const script = `
<script>
(async function(){
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 120; i++) {
    if (window.readerApp && readerApp.state && readerApp.state.books.length) break;
    await wait(50);
  }
  const fail = message => { throw new Error(message); };
  const touchEvent = (type, touches, changed) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: touches });
    Object.defineProperty(event, 'changedTouches', { value: changed || touches });
    return event;
  };
  try {
    const app = window.readerApp;
    const paragraphs = Array.from({ length: 40 }, (_, i) => '第 ' + (i + 1) + ' 段用于移动端手势测试的内容。'.repeat(4));
    const chapters = [1, 2].map(index => ({
      title: '第' + index + '章 手势',
      content: paragraphs.map(t => '第' + index + '章 ' + t).join('\\n'),
      paragraphs: paragraphs.map(t => '第' + index + '章 ' + t)
    }));
    const book = app.createBook('手势测试书', '测试', chapters, 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books = [book];
    await app.saveChapters(book.id, chapters);
    delete book.chapters;
    app.saveState();
    app.renderLibrary();
    await app.openReader(book.id);
    await wait(200);

    app.currentPage = 2;
    app.setPageTransform(false);
    const width = app.getReaderPageWidth();
    const y = app.reader.getBoundingClientRect().top + app.reader.getBoundingClientRect().height / 2;

    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: width * 0.7, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: width * 0.3, clientY: y + 2 }));
    const midTransform = app.readerContent.style.transform;
    const expectedMid = 'translate3d(-' + (2 * width + width * 0.4).toFixed(1);
    if (!midTransform || !midTransform.includes(expectedMid)) {
      fail('page drag should follow the finger via transform: ' + midTransform + ' | expected ' + expectedMid + ' width=' + width + ' page=' + app.currentPage + ' start=' + JSON.stringify(app.pointerStart));
    }
    app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: width * 0.3, clientY: y + 2 }));
    await wait(300);
    if (app.currentPage !== 3) fail('drag past the threshold should turn to the next page: ' + app.currentPage);

    app.currentPage = 2;
    app.setPageTransform(false);
    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: width * 0.5, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: width * 0.48, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: width * 0.48, clientY: y }));
    await wait(300);
    if (app.currentPage !== 2) fail('sub-threshold drag should snap back to the same page: ' + app.currentPage);

    const beforeFont = app.state.settings.fontSize;
    const readerRect = app.reader.getBoundingClientRect();
    const cy = readerRect.top + readerRect.height / 2;
    app.reader.dispatchEvent(touchEvent('touchstart', [
      { clientX: width * 0.3, clientY: cy }, { clientX: width * 0.7, clientY: cy }
    ]));
    app.reader.dispatchEvent(touchEvent('touchmove', [
      { clientX: width * 0.2, clientY: cy }, { clientX: width * 0.8, clientY: cy }
    ], [
      { clientX: width * 0.2, clientY: cy }, { clientX: width * 0.8, clientY: cy }
    ]));
    app.reader.dispatchEvent(touchEvent('touchend', []));
    await wait(300);
    if (app.state.settings.fontSize !== beforeFont + 1) fail('pinch out should increase the font size: ' + app.state.settings.fontSize);

    app.setMode('page');
    await wait(250);
    const chapterCount = app.getCurrentBook().chapterCount;
    for (let i = 0; i < 12; i++) {
      app.stepForward();
    }
    await wait(500);
    if (app.currentChapter !== chapterCount - 1) fail('rapid next presses must clamp at the last chapter: ' + app.currentChapter);
    for (let i = 0; i < 12; i++) {
      app.stepBack();
    }
    await wait(500);
    if (app.currentChapter < 0 || app.currentPage < 0) fail('rapid back presses must not go below the first page: ' + app.currentChapter + '/' + app.currentPage);
    if (app.currentPage > 0 && app.currentChapter >= 0) {
      if (app.readerContent.querySelectorAll('.page').length === 0) fail('page DOM should exist after rapid navigation');
    }
    app.setMode('scroll');
    await wait(250);
    const scrollBook = app.getCurrentBook();
    for (let i = 0; i < 10; i++) {
      app.stepForward();
    }
    await wait(600);
    if (app.currentChapter > scrollBook.chapterCount - 1) fail('rapid scroll-mode next must not exceed the last chapter: ' + app.currentChapter);

    app.setAutoScroll('fast');
    if (!app.autoScrollTimer) fail('fast auto-scroll should start a timer');
    app.setAutoScroll('off');
    if (app.autoScrollTimer) fail('disabling auto-scroll should clear the timer');

    const restore = app.state.settings.fontSize;
    app.state.settings.fontSize = restore > 14 ? restore : 18;
    app.applySettings();

    document.documentElement.setAttribute('data-gesture-smoke', 'pass');
  } catch (err) {
    document.body.textContent = 'FAIL ' + (err && (err.stack || err.message) || err);
  }
})();
</script>`;
  return html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/i, '').replace('</body>', `${script}\n</body>`);
}

async function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function waitForJson(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { res, rej }));
        },
        close() { try { ws.close(); } catch (e) {} },
      });
    });
    ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !pending.has(msg.id)) return;
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    });
    ws.addEventListener('error', reject);
  });
}

async function runChrome(chromePath, url) {
  const server = http.createServer();
  const debugPort = await new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  }));
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gesture-smoke-profile-'));
  const child = spawn(chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-background-networking',
    '--window-size=390,844',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    url,
  ], { stdio: 'ignore', windowsHide: true });
  let client;
  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    let target;
    for (let i = 0; i < 100; i++) {
      const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json`);
      target = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(target, 'No Chrome page target found');
    client = await connectWebSocket(target.webSocketDebuggerUrl);
    await client.send('Runtime.enable');
    const deadline = Date.now() + 30000;
    let lastValue = '';
    while (Date.now() < deadline) {
      const result = await client.send('Runtime.evaluate', {
        expression: `[
          document.documentElement.getAttribute('data-gesture-smoke') || '',
          document.body.textContent.slice(0, 1200)
        ].join('\\n')`,
        returnByValue: true,
      });
      lastValue = result.result && result.result.value || '';
      if (lastValue.startsWith('pass')) return;
      if (lastValue.startsWith('FAIL')) throw new Error(lastValue);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('Timed out waiting for gesture smoke: ' + lastValue);
  } finally {
    if (client) client.close();
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

async function run() {
  const chromePath = findChrome();
  assert.ok(chromePath, 'Chrome or Edge executable is required');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gesture-smoke-'));
  for (const file of ['reader.html', 'reader-core.js', 'reader-app.js', 'reader-styles.css', 'manifest.json']) {
    const src = path.join(root, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmpRoot, file));
  }
  fs.writeFileSync(path.join(tmpRoot, 'reader.html'), injectHarness(fs.readFileSync(path.join(root, 'reader.html'), 'utf8')), 'utf8');
  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, 'http://127.0.0.1');
    const filePath = path.join(tmpRoot, (parsed.pathname === '/' ? '/reader.html' : parsed.pathname).replace(/^\//, ''));
    if (!filePath.startsWith(tmpRoot) || !fs.existsSync(filePath)) {
      res.writeHead(404); res.end('not found'); return;
    }
    const ext = path.extname(filePath);
    const type = ext === '.js' ? 'application/javascript;charset=utf-8' : ext === '.css' ? 'text/css;charset=utf-8' : 'text/html;charset=utf-8';
    res.writeHead(200, { 'Content-Type': type });
    res.end(fs.readFileSync(filePath));
  });
  try {
    const port = await listen(server);
    await runChrome(chromePath, `http://127.0.0.1:${port}/reader.html`);
    console.log('mobile gesture smoke tests passed');
  } finally {
    server.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
