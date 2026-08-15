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
  try {
    const app = window.readerApp;

    const chapterA = { title: '第一章', content: '第一段内容', paragraphs: ['第一段内容'] };
    const chapterB = { title: '第二章', content: '第二段内容', paragraphs: ['第二段内容'] };
    const book = app.createBook('冒烟测试书', '测试作者', [chapterA, chapterB], 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books = [book];
    await app.saveChapters(book.id, [chapterA, chapterB]);
    delete book.chapters;
    app.saveState();
    app.renderLibrary();

    const continueBook = app.renderContinueCard && document.querySelector('#continue-card .continue-copy h2');
    if (continueBook && continueBook.textContent !== '冒烟测试书') fail('continue card should show the recently read book: ' + continueBook.textContent);
    app.state.books[0].lastRead = Date.now();
    app.renderLibrary();
    const continueHeading = document.querySelector('#continue-card .continue-copy h2');
    if (!continueHeading || continueHeading.textContent !== '冒烟测试书') fail('continue card missing after render');

    await app.openReader(book.id);
    app.setBrightness(0.5);
    await wait(250);
    const overlayBg = getComputedStyle(document.querySelector('#brightness-overlay')).backgroundColor;
    const dim = parseFloat((overlayBg.match(/rgba?\\([^)]*\\)/) || [''])[0].replace('rgba(', '').split(',')[3] || '0');
    if (!(dim > 0.05)) fail('brightness overlay should dim the reader: ' + overlayBg);

    app.setNightMode('system');
    if (app.state.settings.nightMode !== 'system') fail('night mode was not saved');
    if (!document.querySelector('[data-night="system"]').classList.contains('active')) fail('night mode control should highlight the active option');

    app.openToc();
    const filterInput = document.querySelector('#toc-filter');
    filterInput.value = '第一章';
    app.filterToc();
    const visibleItems = [...document.querySelectorAll('.toc-item')].filter(item => !item.classList.contains('filtered-out'));
    if (visibleItems.length !== 1) fail('toc filter should keep only matching chapters: ' + visibleItems.length);
    const activeItem = document.querySelector('.toc-item.active');
    if (!activeItem || activeItem.getAttribute('data-ch') !== '0') fail('toc should mark the current chapter as active');
    app.closeSheets();

    app.showBookActions(book.id);
    app.requestDeleteBook();
    const deleteBtn = document.querySelector('#delete-book-btn');
    if (!deleteBtn.classList.contains('danger-armed')) fail('delete button should arm before confirming');
    const otherBook = app.createBook('另一本书', '测试', [{ title: '第一章', content: '内容', paragraphs: ['内容'] }], 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books.push(otherBook);
    app.showBookActions(otherBook.id);
    if (app.armedBookId !== null && app.armedBookId !== undefined) fail('switching books should clear the armed delete state');
    try {
      await app.saveTrashEntry('selfcheck-id', { savedAt: Date.now(), book: { id: 'selfcheck-id', title: '自检' }, chapters: [], position: null, bookmarks: [] });
      const selfCheck = await app.loadTrashEntry('selfcheck-id');
      await app.deleteTrashEntry('selfcheck-id');
      if (!selfCheck || selfCheck.book.id !== 'selfcheck-id') fail('trash write/read self-check failed: ' + JSON.stringify(selfCheck));
    } catch (selfError) {
      fail('trash self-check threw: ' + (selfError && selfError.message || selfError));
    }
    app.requestDeleteBook();
    if (app.state.books.some(b => b.id === book.id) === false) fail('cross-book arm must not delete book A');
    if (app.state.books.some(b => b.id === otherBook.id) === false) fail('first tap on book B must not delete it');
    app.requestDeleteBook();
    await wait(400);
    if (app.state.books.some(b => b.id === otherBook.id)) fail('second tap on an armed delete should remove only its own book');
    if (app.state.books.some(b => b.id === book.id) === false) fail('book A must remain intact after deleting B');
    app.closeSheets();

    await app.refreshTrash();
    const trashEntry = await app.loadTrashEntry(otherBook.id);
    const allTrash = await app.listTrashEntries();
    const restored = await app.restoreFromTrash(otherBook.id);
    if (!restored) fail('book should be restorable from the trash; entry=' + JSON.stringify(trashEntry && { hasBook: !!trashEntry.book, chapters: (trashEntry.chapters || []).length, savedAt: trashEntry.savedAt }) + ' all=' + JSON.stringify(allTrash.map(t => t.bookId)));
    if (!app.state.books.some(b => b.id === otherBook.id)) fail('restored book should be back on the shelf');
    if (app.trashEntries.some(entry => entry.bookId === otherBook.id)) fail('restored book should leave the trash');

    app.showBookActions(book.id);
    app.requestDeleteBook();
    app.requestDeleteBook();
    await wait(400);
    if (app.state.books.length !== 1) fail('second tap on an armed delete should remove the book');
    app.closeSheets();

    const restoredBook = app.createBook('恢复书', '测试作者', [chapterA], 'linear-gradient(145deg,#315d72,#74a0af)');
    const backup = JSON.stringify({
      app: 'novel-reader',
      version: 2,
      exportedAt: Date.now(),
      state: {
        books: [{ ...restoredBook, chapters: [chapterA] }],
        bookmarks: [{ id: 'bm-restored', bookId: restoredBook.id, chapterIdx: 0, paragraphIndex: 0, charOffset: 0, text: '恢复书签', note: '', timestamp: Date.now() }],
        settings: { mode: 'scroll', fontSize: 20, lineHeightIdx: 1, marginIdx: 1, themeIdx: 0, fontFamilyIdx: 0, pageAnimation: 'slide', brightness: 1, nightMode: 'off' },
        sortMode: 'recent',
        stats: { date: null, minutes: 0, totalMinutes: 0 }
      }
    });
    await app.importBackup(new File([backup], 'backup.json', { type: 'application/json' }));
    if (!app.state.books.some(b => b.title === '恢复书')) fail('backup import should restore the book: ' + app.state.books.length);
    const restoredFromBackup = app.state.books.find(b => b.title === '恢复书');
    if (!restoredFromBackup) fail('backup import restored the wrong book');
    if (app.state.bookmarks.length !== 1 || app.state.bookmarks[0].id !== 'bm-restored') fail('backup import should restore bookmarks');
    await app.loadChapter(restoredFromBackup, 0);
    if (app.chapterCache.has(restoredFromBackup.id + ':0') === false) fail('backup import should make chapter content loadable');

    let downloadName = '';
    const originalCreate = document.createElement.bind(document);
    document.createElement = function(tag) {
      const el = originalCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'download', { set: v => { downloadName = v; }, get: () => downloadName });
        el.click = () => {};
      }
      return el;
    };
    const booksBeforeExport = app.state.books.length;
    await app.exportData();
    document.createElement = originalCreate;
    if (!downloadName.startsWith('novel-reader-backup-')) fail('export should produce a named backup download: ' + downloadName);
    if (app.state.books.length !== booksBeforeExport) fail('export should not mutate the library');

    document.documentElement.setAttribute('data-feature-smoke', 'pass');
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
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-smoke-profile-'));
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
          document.documentElement.getAttribute('data-feature-smoke') || '',
          document.body.textContent.slice(0, 1200)
        ].join('\\n')`,
        returnByValue: true,
      });
      lastValue = result.result && result.result.value || '';
      if (lastValue.startsWith('pass')) return;
      if (lastValue.startsWith('FAIL')) throw new Error(lastValue);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('Timed out waiting for feature smoke: ' + lastValue);
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-smoke-'));
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
    console.log('feature smoke tests passed');
  } finally {
    server.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
