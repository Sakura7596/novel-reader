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

  const paragraphs = Array.from({ length: 15 }, (_, i) => '段落' + (i + 1) + '：这是用于翻页与分页验证的中文长段落内容，用来确保分页不会丢失任何一个字符。'.repeat(2));
  const chapters = [0, 1, 2].map(index => ({
    title: '第' + (index + 1) + '章',
    content: paragraphs.map(t => '第' + (index + 1) + '章 ' + t).join('\\n'),
    paragraphs: paragraphs.map(t => '第' + (index + 1) + '章 ' + t)
  }));

  window.__navCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    const book = app.createBook('导航串行测试', '测试', chapters, 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books = [book];
    await app.saveChapters(book.id, chapters);
    delete book.chapters;
    app.saveState();
    app.renderLibrary();
    await app.openReader(book.id);
    await wait(150);
    await app.setMode('page');
    await wait(200);

    app.currentPage = app.pages.length - 1;
    app.setPageTransform(false);
    const firstForward = app.stepForward();
    const secondForward = app.stepForward();
    await Promise.all([firstForward, secondForward]);
    if (app.currentChapter !== 1 || app.currentPage !== 1) {
      errors.push('concurrent forward x2: ch=' + app.currentChapter + ' page=' + app.currentPage + ' (expected 1/1, must not skip pages or chapters)');
    }
    const firstBack = app.stepBack();
    const secondBack = app.stepBack();
    await Promise.all([firstBack, secondBack]);
    if (app.currentChapter !== 0 || app.currentPage !== app.pages.length - 1) {
      errors.push('concurrent back x2: ch=' + app.currentChapter + ' page=' + app.currentPage + ' (expected last page of chapter 0, must not skip pages or chapters)');
    }

    await app.setMode('scroll');
    await wait(200);
    app.currentChapter = 0;
    const scrollForward1 = app.stepForward();
    const scrollForward2 = app.stepForward();
    await Promise.all([scrollForward1, scrollForward2]);
    if (app.currentChapter !== 2) errors.push('concurrent scroll forward x2: ch=' + app.currentChapter + ' (expected 2)');
    const scrollBack1 = app.stepBack();
    const scrollBack2 = app.stepBack();
    await Promise.all([scrollBack1, scrollBack2]);
    if (app.currentChapter !== 0) errors.push('concurrent scroll back x2: ch=' + app.currentChapter + ' (expected 0)');
    return { ok: errors.length === 0, errors };
  };

  window.__pagingCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    const book = app.state.books.find(b => b.title === '导航串行测试');
    if (!book) return { ok: false, errors: ['paging book missing'] };
    if (!app.reader.classList.contains('active')) await app.openReader(book.id);
    app.state.settings.mode = 'page';
    app.state.settings.lineHeightIdx = 2;
    app.currentChapter = 1;
    app.currentPage = 0;
    for (const fontSize of [14, 18, 28]) {
      app.state.settings.fontSize = fontSize;
      app.applySettings();
      await app.renderReader({ chapter: 1, paragraphIndex: 0, readingMode: 'page' });
      await wait(80);
      const pageEls = [...app.readerContent.querySelectorAll('.page')];
      if (!pageEls.length) { errors.push('size ' + fontSize + ': no pages rendered'); continue; }
      for (const page of pageEls) {
        const inner = page.querySelector('.page-inner');
        if (inner && inner.scrollHeight > inner.clientHeight + 1) {
          errors.push('size ' + fontSize + ': page ' + page.dataset.page + ' overflow ' + inner.scrollHeight + '>' + inner.clientHeight);
        }
      }
      const chapter = await app.loadChapter(book, 1);
      const expected = chapter.title + ReaderCore.normalizeParagraphs(chapter.paragraphs).join('');
      const rendered = app.readerContent.textContent;
      if (rendered !== expected) {
        errors.push('size ' + fontSize + ': text mismatch rendered=' + rendered.length + ' expected=' + expected.length);
      }
    }
    return { ok: errors.length === 0, errors };
  };

  window.__continueCheck = async () => {
    const app = window.readerApp;
    let calls = 0;
    let lastId = null;
    const originalOpen = app.openReader.bind(app);
    app.openReader = async id => { calls++; lastId = id; await originalOpen(id); };
    const bookA = app.createBook('续读卡A', '测试', [{ title: '第一章', content: '内容', paragraphs: ['内容'] }], 'linear-gradient(145deg,#315d72,#74a0af)');
    const bookB = app.createBook('续读卡B', '测试', [{ title: '第一章', content: '内容', paragraphs: ['内容'] }], 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books = [bookA, bookB];
    app.saveState();
    for (let i = 0; i < 100; i++) {
      app.state.books[0].lastRead = Date.now() - i;
      app.state.books[1].lastRead = Date.now();
      app.renderLibrary();
    }
    const card = document.querySelector('#continue-card');
    card.click();
    await wait(250);
    const ok = calls === 1 && lastId === bookB.id;
    return { ok, calls, lastId, expected: bookB.id };
  };

  window.__gestureCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    try {
      const gBook = app.createBook('手势测试书', '测试', chapters, 'linear-gradient(145deg,#315d72,#74a0af)');
      app.state.books = [gBook];
      await app.saveChapters(gBook.id, chapters);
      delete gBook.chapters;
      app.saveState();
      app.renderLibrary();
      if (app.reader.classList.contains('active')) await app.closeReader();
      await app.openReader(gBook.id);
      await wait(150);
      const dbgChapter = await app.loadChapter(gBook, 0);
      const dbgPages = app.pages.length;
      app.setMode('page');
      await wait(200);
      if (app.pages.length <= 1) {
        const ch = await app.loadChapter(gBook, 0);
        const paras = ReaderCore.normalizeParagraphs(ch.paragraphs || []);
        const lines = Math.max(2, Math.floor((app.readerScroll.clientHeight - 194) / (28 * 1.82)));
        const w = Math.max(16, Math.floor((Math.min(680, Math.max(1, app.getReaderPageWidth() - 48)) / 28)));
        let manual = [];
        let manualError = '';
        try {
          manual = ReaderCore.paginatePlainText({ title: ch.title, paragraphs: paras, charsPerLine: w, linesPerPage: lines });
        } catch (e) { manualError = String(e && e.message || e); }
        errors.push('expected multiple pages, got ' + app.pages.length + ' paragraphs=' + (ch.paragraphs || []).length + ' fontSize=' + app.state.settings.fontSize + ' clientHeight=' + app.readerScroll.clientHeight + ' modeBefore=' + app.state.settings.mode + ' openPages=' + dbgPages + ' lines=' + lines + ' w=' + w + ' manual=' + manual.length + ' manualErr=' + manualError + ' blocksPerPage=' + JSON.stringify(app.pages.map(p => p.blocks.length)) + ' bookId=' + gBook.id);
        return { ok: false, errors };
      }
    const touchEvent = (type, touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      Object.defineProperty(event, 'changedTouches', { value: touches });
      return event;
    };
    const width = app.getReaderPageWidth();
    const y = app.reader.getBoundingClientRect().top + app.reader.getBoundingClientRect().height / 2;

    const pageBefore = app.currentPage;
    app.reader.dispatchEvent(touchEvent('touchstart', [{ clientX: width * 0.84, clientY: y }]));
    app.reader.dispatchEvent(touchEvent('touchend', [{ clientX: width * 0.84, clientY: y }]));
    await wait(120);
    if (app.currentPage !== pageBefore) {
      errors.push('touch-only stream must be ignored when Pointer Events are active (page ' + pageBefore + ' -> ' + app.currentPage + ')');
    }

    const pointerTapPage = app.currentPage;
    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'touch', clientX: width * 0.84, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'touch', clientX: width * 0.84, clientY: y }));
    await wait(120);
    if (app.currentPage !== pointerTapPage) {
      errors.push('same-position pointer tap should not page-turn by itself');
    }

    app.currentPage = 0;
    app.setPageTransform(false);
    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: width * 0.84, clientY: y }));
    app.reader.dispatchEvent(touchEvent('touchstart', [{ clientX: width * 0.84, clientY: y }]));
    app.reader.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: width * 0.3, clientY: y }));
    app.reader.dispatchEvent(touchEvent('touchmove', [{ clientX: width * 0.3, clientY: y }]));
    app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: width * 0.3, clientY: y }));
    app.reader.dispatchEvent(touchEvent('touchend', [{ clientX: width * 0.3, clientY: y }]));
    await wait(300);
    if (app.currentPage !== 1) {
      errors.push('one physical swipe must turn exactly one page, got page ' + app.currentPage + ' mode=' + app.state.settings.mode + ' pages=' + app.pages.length);
    }

    app.state.settings.fontSize = 20;
    app.applySettings();
    await wait(100);
    const fontBeforeCancel = app.state.settings.fontSize;
    const pageBeforePinch = app.currentPage;
    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 101, pointerType: 'touch', clientX: width * 0.3, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 102, pointerType: 'touch', clientX: width * 0.5, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 102, pointerType: 'touch', clientX: width * 0.7, clientY: y }));
    await wait(60);
    const fontAfterPinch = app.state.settings.fontSize;
    if (fontAfterPinch !== fontBeforeCancel) {
      errors.push('two-finger pinch must not change font size: ' + fontBeforeCancel + ' -> ' + fontAfterPinch);
    }
    if (app.currentPage !== pageBeforePinch) {
      errors.push('two-finger gesture must not page-turn: ' + pageBeforePinch + ' -> ' + app.currentPage);
    }
    app.reader.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 102, pointerType: 'touch', clientX: width * 0.7, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 101, pointerType: 'touch', clientX: width * 0.3, clientY: y }));
    await wait(420);
    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 103, pointerType: 'touch', clientX: width * 0.3, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 104, pointerType: 'touch', clientX: width * 0.5, clientY: y }));
    await wait(150);
    app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 103, pointerType: 'touch', clientX: width * 0.3, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 104, pointerType: 'touch', clientX: width * 0.5, clientY: y }));
    if (app.state.settings.fontSize !== fontAfterPinch) {
      errors.push('fresh two-finger down after cancel must not change font size: ' + fontAfterPinch + ' -> ' + app.state.settings.fontSize);
    }
    if (app.currentPage !== pageBeforePinch) {
      errors.push('fresh two-finger down after cancel must not page-turn: ' + pageBeforePinch + ' -> ' + app.currentPage);
    }
    return { ok: errors.length === 0, errors };
    } catch (e) {
      return { ok: false, errors: ['gesture threw: ' + String(e && e.stack || e)] };
    }
  };
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

async function runChrome(chromePath, url, sizes) {
  const server = http.createServer();
  const debugPort = await new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  }));
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-regression-profile-'));
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
    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      const result = await client.send('Runtime.evaluate', { expression: 'typeof window.__navCheck === "function"', returnByValue: true });
      if (result.result && result.result.value) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.ok(ready, 'harness did not load');

    const navResult = await client.send('Runtime.evaluate', { expression: 'window.__navCheck()', awaitPromise: true, returnByValue: true });
    const navData = navResult.result && navResult.result.value;

    const pagingResults = [];
    for (const [width, height] of sizes) {
      await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await new Promise(resolve => setTimeout(resolve, 700));
      const res = await client.send('Runtime.evaluate', { expression: 'window.__pagingCheck()', awaitPromise: true, returnByValue: true });
      pagingResults.push({ width, height, ...res.result && res.result.value });
    }

    const contRes = await client.send('Runtime.evaluate', { expression: 'window.__continueCheck()', awaitPromise: true, returnByValue: true });
    const contData = contRes.result && contRes.result.value;

    const gestureRes = await client.send('Runtime.evaluate', { expression: 'window.__gestureCheck()', awaitPromise: true, returnByValue: true });
    const gestureData = gestureRes.result && gestureRes.result.value;

    return { nav: navData, paging: pagingResults, continueCard: contData, gesture: gestureData };
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-regression-'));
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
    const sizes = [[320, 568], [390, 844], [844, 390]];
    const results = await runChrome(chromePath, `http://127.0.0.1:${port}/reader.html`, sizes);

    const failures = [];
    if (!results.nav || !results.nav.ok) {
      failures.push('navigation: ' + JSON.stringify(results.nav && results.nav.errors));
    }
    for (const caseResult of results.paging) {
      if (!caseResult || !caseResult.ok) {
        failures.push('paging ' + caseResult.width + 'x' + caseResult.height + ': ' + JSON.stringify(caseResult && caseResult.errors));
      }
    }
    if (!results.continueCard || !results.continueCard.ok) {
      failures.push('continue card: ' + JSON.stringify(results.continueCard));
    }
    if (!results.gesture || !results.gesture.ok) {
      failures.push('gesture: ' + JSON.stringify(results.gesture && results.gesture.errors));
    }
    if (failures.length) {
      throw new Error('P0 regression failed:\n' + failures.join('\n'));
    }
    console.log('p0 regression tests passed (nav serialization, pagination, continue card, gesture dedup)');
  } finally {
    server.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
