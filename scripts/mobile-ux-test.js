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
  const script = String.raw`
<script>
(async function(){
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const chA = { title: '第一章', content: '第一段内容。', paragraphs: ['第一段内容。'] };
  const chB = { title: '第二章', content: '第二段内容。', paragraphs: ['第二段内容。'] };
  const chC = { title: '第三章', content: '第三段内容。', paragraphs: ['第三段内容。'] };
  const longParagraphs = Array.from({ length: 15 }, (_, i) => '长段落' + (i + 1) + '：这是一段足够长的中文正文，用来确保翻页模式下每一章都能产生多页。'.repeat(3));
  const longA = { title: '第一章', content: longParagraphs.join('\n'), paragraphs: longParagraphs };
  const longB = { title: '第二章', content: longParagraphs.join('\n'), paragraphs: longParagraphs };
  const longC = { title: '第三章', content: longParagraphs.join('\n'), paragraphs: longParagraphs };
  const chapters3 = [longA, longB, longC];

  window.__setup = async () => {
    const app = window.readerApp;
    const book = app.createBook('移动体验书', '测试', chapters3, 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books = [book];
    await app.saveChapters(book.id, chapters3);
    delete book.chapters;
    app.state.settings.mode = 'page';
    app.state.settings.nightMode = 'off';
    app.saveState();
    app.renderLibrary();
    return app;
  };

  window.__touchSizeCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    const checkEl = el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.width < 47.0 || r.height < 47.0) {
        errors.push((el.id ? '#' + el.id : el.className || el.tagName) + ' must be >=48x48: ' + r.width + 'x' + r.height);
      }
    };
    ['#search-btn', '#bookmarks-btn', '#import-btn', '#more-btn', '#continue-card .primary-button'].forEach(sel => {
      const el = document.querySelector(sel);
      if (el) checkEl(el);
    });
    if (app.reader.classList.contains('active') === false) {
      await app.openReader(app.state.books[0].id);
      await wait(120);
    }
    ['#back-btn', '#toc-btn', '#settings-btn', '#prev-btn', '#next-btn', '#progress-range'].forEach(sel => {
      const el = document.querySelector(sel);
      if (el) checkEl(el);
    });
    app.$('settings-btn').click();
    await wait(120);
    ['#font-dec', '#font-inc', '[data-mode]', '[data-line]', '[data-margin]', '[data-font]', '[data-animation]', '[data-autoscroll]', '[data-volume]', '[data-night]', '.theme-dot', '#brightness-range'].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => checkEl(el));
    });
    const allTargets = [...document.querySelectorAll('button,input[type="range"],[role="button"]')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled;
    });
    allTargets.forEach(el => checkEl(el));
    app.closeSheets();
    await wait(80);
    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      errors.push('horizontal overflow: scrollWidth=' + document.documentElement.scrollWidth + ' innerWidth=' + window.innerWidth);
    }
    return { ok: errors.length === 0, errors };
  };

  window.__pinchNoTurnCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    await app.openReader(app.state.books[0].id);
    await wait(120);
    app.currentPage = 0;
    app.setPageTransform(false);
    const pageBefore = app.currentPage;
    const fontBefore = app.state.settings.fontSize;
    const width = app.getReaderPageWidth();
    const y = app.reader.getBoundingClientRect().top + app.reader.getBoundingClientRect().height / 2;
    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 21, pointerType: 'touch', clientX: width * 0.3, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 22, pointerType: 'touch', clientX: width * 0.7, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 21, pointerType: 'touch', clientX: width * 0.2, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 22, pointerType: 'touch', clientX: width * 0.8, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 21, pointerType: 'touch', clientX: width * 0.2, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 22, pointerType: 'touch', clientX: width * 0.8, clientY: y }));
    await wait(200);
    if (app.currentPage !== pageBefore) errors.push('two-finger gesture must not page-turn: ' + pageBefore + ' -> ' + app.currentPage);
    if (app.state.settings.fontSize !== fontBefore) errors.push('two-finger gesture must not change font size: ' + fontBefore + ' -> ' + app.state.settings.fontSize);
    app.currentPage = 0;
    app.setPageTransform(false);
    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 23, pointerType: 'touch', clientX: width * 0.84, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 23, pointerType: 'touch', clientX: width * 0.5, clientY: y }));
    await wait(40);
    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 24, pointerType: 'touch', clientX: width * 0.6, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 23, pointerType: 'touch', clientX: width * 0.5, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 24, pointerType: 'touch', clientX: width * 0.6, clientY: y }));
    await wait(200);
    if (app.currentPage !== 0) errors.push('a second finger joining a drag must snap back to the current page: ' + app.currentPage);
    if (app.pointerStart !== null) errors.push('cancelReaderGesture must clear pointerStart');
    if (app.readerContent.classList.contains('dragging')) errors.push('cancelReaderGesture must clear dragging');
    const transform = app.readerContent.style.transform;
    if (!transform || transform.indexOf('translate3d(0px') !== 0) errors.push('cancelReaderGesture must restore the current page transform: ' + transform);

    app.currentPage = 0;
    app.setPageTransform(false);
    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 25, pointerType: 'touch', clientX: width * 0.84, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 25, pointerType: 'touch', clientX: width * 0.5, clientY: y }));
    app.$('next-btn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 26, pointerType: 'touch', clientX: width * 0.8, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 25, pointerType: 'touch', clientX: width * 0.5, clientY: y }));
    app.$('next-btn').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 26, pointerType: 'touch', clientX: width * 0.8, clientY: y }));
    await wait(100);
    if (app.currentPage !== 0) errors.push('a second finger on reader chrome must cancel the active drag: ' + app.currentPage);
    if (!app.readerContent.style.transform.startsWith('translate3d(0px')) errors.push('second finger on reader chrome must snap back: ' + app.readerContent.style.transform);

    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 27, pointerType: 'touch', clientX: width * 0.84, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 27, pointerType: 'touch', clientX: width * 0.5, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 27, pointerType: 'touch', clientX: width * 0.5, clientY: y }));
    if (app.currentPage !== 0 || !app.readerContent.style.transform.startsWith('translate3d(0px')) errors.push('pointercancel must snap the partial page drag back');

    app.touchStart = { x: width * 0.84, y, time: Date.now(), page: 0, dragging: true };
    app.readerContent.classList.add('dragging');
    app.readerContent.style.transform = 'translate3d(-100px,0,0)';
    app.onReaderTouchCancel();
    if (app.touchStart !== null || !app.readerContent.style.transform.startsWith('translate3d(0px')) errors.push('touchcancel must clear and snap the partial page drag back');

    app.touchStart = { x: width * 0.84, y, time: Date.now(), page: 0, dragging: true };
    app.readerContent.classList.add('dragging');
    app.readerContent.style.transform = 'translate3d(-100px,0,0)';
    app.onReaderTouchStart({ target: app.$('next-btn'), touches: [{ identifier: 1 }, { identifier: 2 }] });
    if (app.touchStart !== null || !app.readerContent.style.transform.startsWith('translate3d(0px')) errors.push('fallback second touch on reader chrome must cancel and snap the partial drag back');
    return { ok: errors.length === 0, errors };
  };

  window.__zoomedDragCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    await app.openReader(app.state.books[0].id);
    await wait(120);
    app.currentPage = 0;
    app.setPageTransform(false);
    const width = app.getReaderPageWidth();
    const y = app.reader.getBoundingClientRect().top + app.reader.getBoundingClientRect().height / 2;
    app.zoomScaleOverride = 1.2;
    const pageBefore = app.currentPage;
    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 31, pointerType: 'touch', clientX: width * 0.84, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 31, pointerType: 'touch', clientX: width * 0.2, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 31, pointerType: 'touch', clientX: width * 0.2, clientY: y }));
    await wait(200);
    if (app.currentPage !== pageBefore) errors.push('zoomed horizontal drag must not page-turn');
    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 32, pointerType: 'touch', clientX: width * 0.84, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 32, pointerType: 'touch', clientX: width * 0.84, clientY: y }));
    document.elementFromPoint(Math.floor(window.innerWidth * 0.84), Math.floor(window.innerHeight * 0.5)).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: Math.floor(window.innerWidth * 0.84), clientY: Math.floor(window.innerHeight * 0.5) }));
    await wait(200);
    if (app.currentPage !== pageBefore) errors.push('zoomed zone tap must not page-turn');
    app.zoomScaleOverride = 1.0;
    app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 33, pointerType: 'touch', clientX: width * 0.84, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 33, pointerType: 'touch', clientX: width * 0.2, clientY: y }));
    app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 33, pointerType: 'touch', clientX: width * 0.2, clientY: y }));
    await wait(200);
    if (app.currentPage === pageBefore) errors.push('gestures must recover after zoom returns to ~1: page=' + app.currentPage + ' before=' + pageBefore + ' pages=' + app.pages.length);
    delete app.zoomScaleOverride;
    return { ok: errors.length === 0, errors };
  };

  window.__nightSyncCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    await app.openReader(app.state.books[0].id);
    await wait(120);
    const chBefore = app.currentChapter;
    const pageBefore = app.currentPage;
    app.state.settings.nightMode = 'timer';
    app.state.settings.themeIdx = 1;
    app.syncNightTheme(new Date(2026, 0, 1, 7, 30));
    if (document.body.classList.contains('theme-night')) errors.push('07:30 must exit the night theme');
    if (app.currentChapter !== chBefore || app.currentPage !== pageBefore) errors.push('night sync must not move the reading position');
    app.syncNightTheme(new Date(2026, 0, 1, 22, 0));
    if (!document.body.classList.contains('theme-night')) errors.push('22:00 must enter the night theme');
    app.syncNightTheme(new Date(2026, 0, 1, 8, 0));
    if (document.body.classList.contains('theme-night')) errors.push('08:00 must exit the night theme');
    app.syncNightTheme(new Date(2026, 0, 1, 20, 59));
    if (document.body.classList.contains('theme-night')) errors.push('20:59 must keep the day theme');
    app.syncNightTheme(new Date(2026, 0, 1, 21, 0));
    if (!document.body.classList.contains('theme-night')) errors.push('21:00 must enter the night theme');
    app.syncNightTheme(new Date(2026, 0, 1, 6, 59));
    if (!document.body.classList.contains('theme-night')) errors.push('06:59 must keep the night theme');
    app.syncNightTheme(new Date(2026, 0, 1, 7, 0));
    if (document.body.classList.contains('theme-night')) errors.push('07:00 must exit the night theme');
    app.syncNightTheme(new Date(2026, 0, 1, 12, 0));
    const dayTheme = app.state.settings.themeIdx;
    if (document.documentElement.style.getPropertyValue('--reader-bg') === '') errors.push('day theme must apply the chosen theme');
    app.state.settings.nightMode = 'off';
    app.syncNightTheme(new Date(2026, 0, 1, 23, 0));
    if (document.body.classList.contains('theme-night')) errors.push('night mode off must keep the day theme even at night');
    return { ok: errors.length === 0, errors };
  };

  window.__overlayCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    await app.openReader(app.state.books[0].id);
    await wait(120);
    app.$('settings-btn').click();
    await wait(120);
    if (app.reader.inert !== true) errors.push('reader must be inert while a sheet is open');
    if (app.reader.getAttribute('aria-hidden') !== 'true') errors.push('reader must be aria-hidden while a sheet is open');
    const chBefore = app.currentChapter;
    const pageBefore = app.currentPage;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    await wait(120);
    if (app.currentChapter !== chBefore || app.currentPage !== pageBefore) errors.push('reader keys must not navigate while a sheet is open');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(120);
    if (app.settingsSheet.classList.contains('open')) errors.push('Escape must close the sheet');
    if (document.activeElement !== app.$('settings-btn')) errors.push('focus must return to the trigger button, got ' + (document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
    await app.closeReader();
    await wait(120);
    app.state.bookmarks.push({ id: 'bm-ux', bookId: app.state.books[0].id, chapterIdx: 0, paragraphIndex: 0, charOffset: 0, text: '体验书签', note: '', timestamp: Date.now() });
    app.saveState();
    app.$('search-btn').click();
    await wait(120);
    const searchInput = document.querySelector('#search-input');
    searchInput.focus();
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(120);
    if (app.searchPanel.classList.contains('open')) errors.push('Escape inside the search input must close the panel');
    if (document.activeElement !== app.$('search-btn')) errors.push('focus must return to the search trigger after search Escape');
    app.$('bookmarks-btn').click();
    await wait(120);
    if (app.library.inert !== true) errors.push('library must be inert while bookmarks panel is open');
    if (app.library.getAttribute('aria-hidden') !== 'true') errors.push('library must be aria-hidden while bookmarks panel is open');
    const ghostButtons = [...document.querySelectorAll('#bookmarks-list .ghost-button')];
    if (!ghostButtons.length) errors.push('bookmark panel must render actions');
    ghostButtons.forEach(btn => {
      const r = btn.getBoundingClientRect();
      if (r.width < 47.0 || r.height < 47.0) errors.push('bookmark ghost-button must be >=48x48: ' + r.width + 'x' + r.height);
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(120);
    if (document.activeElement !== app.$('bookmarks-btn')) errors.push('focus must return to the bookmarks trigger');
    return { ok: errors.length === 0, errors };
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
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-ux-profile-'));
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
    let ready = false;
    while (Date.now() < deadline) {
      const result = await client.send('Runtime.evaluate', { expression: 'typeof window.__setup === "function"', returnByValue: true });
      if (result.result && result.result.value) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.ok(ready, 'harness did not load');
    await client.send('Runtime.evaluate', { expression: 'window.__setup()', awaitPromise: true, returnByValue: true });

    const results = {};
    const touchResults = [];
    for (const [width, height] of sizes) {
      await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await new Promise(resolve => setTimeout(resolve, 500));
      const res = await client.send('Runtime.evaluate', { expression: 'window.__touchSizeCheck()', awaitPromise: true, returnByValue: true });
      touchResults.push({ width, height, ...res.result && res.result.value });
    }
    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await new Promise(resolve => setTimeout(resolve, 500));
    const checks = [
      ['pinchNoTurn', 'window.__pinchNoTurnCheck()'],
      ['zoomedDrag', 'window.__zoomedDragCheck()'],
      ['nightSync', 'window.__nightSyncCheck()'],
      ['overlay', 'window.__overlayCheck()'],
    ];
    for (const [name, expression] of checks) {
      const res = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) {
        const ex = res.exceptionDetails.exception || {};
        const desc = ex.description || ex.value || JSON.stringify(ex);
        results[name] = { ok: false, errors: ['check threw: ' + String(desc).slice(0, 400)] };
        continue;
      }
      results[name] = res.result && res.result.value;
    }
    results.touchSizes = touchResults;
    return results;
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-ux-'));
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
    for (const caseResult of results.touchSizes) {
      if (!caseResult || !caseResult.ok) {
        failures.push('touchSize ' + caseResult.width + 'x' + caseResult.height + ': ' + JSON.stringify(caseResult && caseResult.errors));
      }
    }
    for (const name of ['pinchNoTurn', 'zoomedDrag', 'nightSync', 'overlay']) {
      const result = results[name];
      if (!result || !result.ok) {
        failures.push(name + ': ' + JSON.stringify(result && result.errors || result));
      }
    }
    if (failures.length) {
      throw new Error('Mobile UX regression failed:\n' + failures.join('\n'));
    }
    console.log('mobile ux regression tests passed (touch targets, overflow, pinch, zoomed drag, night sync, overlay focus)');
  } finally {
    server.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
