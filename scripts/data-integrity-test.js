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
  const STATE_KEY = 'novelReaderState';
  const POSITION_PREFIX = 'novelReader_position_';
  const TRASH_PREFIX = 'novelReader_trash_';
  const chA = { title: '第一章', content: '第一段内容。', paragraphs: ['第一段内容。'] };
  const chB = { title: '第二章', content: '第二段内容。', paragraphs: ['第二段内容。'] };
  const chC = { title: '第三章', content: '第三段内容。', paragraphs: ['第三段内容。'] };
  const chapters3 = [chA, chB, chC];
  const makeDeferred = () => {
    let releaseFn;
    const promise = new Promise(r => { releaseFn = r; });
    return { promise, release: releaseFn };
  };

  window.__navQueueCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    const book = app.createBook('队列测试书', '测试', chapters3, 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books = [book];
    await app.saveChapters(book.id, chapters3);
    delete book.chapters;
    app.saveState();
    app.renderLibrary();
    if (app.reader.classList.contains('active')) await app.closeReader();
    await app.openReader(book.id);
    await wait(150);

    let task2Ran = false;
    const p1 = app.enqueueNavigation(async () => { throw new Error('boom'); });
    const p2 = app.enqueueNavigation(async () => { task2Ran = true; });
    let rejected = false;
    try { await p1; } catch (e) { rejected = /boom/.test(String(e && e.message || e)); }
    await p2;
    if (!rejected) errors.push('task1 failure must reject the awaited promise');
    if (!task2Ran) errors.push('task2 must still run after task1 failure');

    app.currentChapter = 0;
    const dNav = makeDeferred();
    const blockedNav = app.enqueueNavigation(async context => { await dNav.promise; await app.goToChapter(2, undefined, context); });
    await wait(150);
    await app.goToChapter(1);
    await wait(120);
    if (app.currentChapter !== 1) errors.push('direct navigation must win over the queued task: ch=' + app.currentChapter);
    dNav.release();
    await blockedNav;
    await wait(120);
    if (app.currentChapter !== 1) errors.push('stale queued task must not override direct navigation: ch=' + app.currentChapter);

    app.currentChapter = 0;
    const dToc = makeDeferred();
    const blockedToc = app.enqueueNavigation(async context => { await dToc.promise; await app.goToChapter(2, undefined, context); });
    await wait(150);
    app.openToc();
    const tocItem = document.querySelector('.toc-item[data-ch="1"]');
    if (!tocItem) errors.push('toc item for chapter 1 missing');
    if (tocItem) {
      tocItem.click();
      await wait(150);
      if (app.currentChapter !== 1) errors.push('real TOC tap must navigate to chapter 1: ch=' + app.currentChapter);
    }
    dToc.release();
    await blockedToc;
    await wait(120);
    if (app.currentChapter !== 1) errors.push('stale queued task must not override a real TOC tap: ch=' + app.currentChapter);

    const dSwitch = makeDeferred();
    const blocked = app.enqueueNavigation(async context => { await dSwitch.promise; await app.goToChapter(2, undefined, context); });

    const bookB = app.createBook('队列测试书B', '测试', chapters3, 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books.push(bookB);
    await app.saveChapters(bookB.id, chapters3);
    delete bookB.chapters;
    await app.openReader(bookB.id);
    await wait(100);
    dSwitch.release();
    await blocked;
    await wait(150);
    if (app.currentBookId !== bookB.id) errors.push('stale queued task must not switch books');
    if (app.currentChapter !== 0) errors.push('stale queued task must not move chapters after switching books: ch=' + app.currentChapter);

    await app.setMode('scroll');
    await wait(80);
    app.currentChapter = 0;
    let modeTaskRan = false;
    const dMode = makeDeferred();
    const blockedMode = app.enqueueNavigation(async context => { modeTaskRan = true; await dMode.promise; await app.goToChapter(2, undefined, context); });
    await app.setMode('page');
    await wait(80);
    dMode.release();
    await blockedMode;
    await wait(80);
    if (modeTaskRan) errors.push('stale queued task ran after mode switch');
    if (app.currentChapter !== 0) errors.push('stale queued task must not move chapters after mode switch');

    app.currentChapter = 0;
    app.currentPage = 0;
    await app.renderReader();
    await wait(80);
    const dClose = makeDeferred();
    const blockerClose = app.enqueueNavigation(async () => { await dClose.promise; });
    let stepOnceCalls = 0;
    const origStepOnce = app.stepForwardOnce.bind(app);
    app.stepForwardOnce = async (...args) => { stepOnceCalls++; return origStepOnce(...args); };
    const navForwardClose = app.stepForward();
    const origFlush2 = app.flushPosition.bind(app);
    let releaseFlush;
    const flushGate = new Promise(r => { releaseFlush = r; });
    let gateFlush = true;
    app.flushPosition = async () => { if (gateFlush) await flushGate; return origFlush2(); };
    const closePromise = app.closeReader();
    if (app.currentBookId !== bookB.id) errors.push('closeReader must still be pending while its flush is gated');
    gateFlush = false;
    dClose.release();
    await blockerClose;
    await navForwardClose;
    await wait(100);
    if (app.currentBookId !== bookB.id) errors.push('stale stepForward ran after close finished (close not gated)');
    if (stepOnceCalls !== 0) errors.push('stale stepForward must not invoke stepForwardOnce: calls=' + stepOnceCalls);
    if (app.currentChapter !== 0) errors.push('stale stepForward must not advance after closing the reader: ch=' + app.currentChapter);
    releaseFlush();
    await closePromise;
    app.flushPosition = origFlush2;
    app.stepForwardOnce = origStepOnce;
    await wait(100);
    if (app.reader.classList.contains('active')) errors.push('reader must stay closed after stale task');
    if (app.currentBookId !== null) errors.push('stale task must not reopen a book');

    const pF = app.stepForward();
    const pB = app.stepBack();
    await Promise.all([pF, pB]);
    if (app.currentChapter !== 0 || app.currentPage !== 0) errors.push('rapid forward/back must settle on real state: ' + app.currentChapter + '/' + app.currentPage);
    return { ok: errors.length === 0, errors };
  };

  window.__stateRevisionCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    const idbBook = { id: 'idb-book', title: 'IDB书', author: 'a', coverBg: 'g', chapterCount: 1, chapterTitles: ['第一章'], progress: 0, readingPosition: null, lastRead: 0 };
    const localBook = { id: 'local-book', title: 'LOCAL书', author: 'a', coverBg: 'g', chapterCount: 1, chapterTitles: ['第一章'], progress: 0, readingPosition: null, lastRead: 0 };
    const base = { books: [], bookmarks: [], settings: { mode: 'page', fontSize: 18, lineHeightIdx: 1, marginIdx: 1, themeIdx: 0, fontFamilyIdx: 0, pageAnimation: 'slide', brightness: 1, nightMode: 'off' }, sortMode: 'recent', stats: { date: null, minutes: 0, totalMinutes: 0 } };

    await app.idb('state', 'readwrite', s => s.put({ ...base, revision: 3, books: [idbBook] }, STATE_KEY));
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...base, revision: 5, books: [localBook] }));
    await app.loadState();
    if (!app.state.books.length || app.state.books[0].title !== 'LOCAL书') {
      errors.push('newer local revision must win over older IDB revision');
    }

    await app.idb('state', 'readwrite', s => s.put({ ...base, revision: 7, books: [idbBook] }, STATE_KEY));
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...base, revision: 7, books: [localBook] }));
    await app.loadState();
    if (!app.state.books.length || app.state.books[0].title !== 'IDB书') {
      errors.push('equal revisions must resolve deterministically to IDB');
    }

    const writes = [];
    for (let i = 0; i < 8; i++) writes.push(app.saveState());
    await Promise.all(writes);
    const stored = await app.idb('state', 'readonly', s => s.get(STATE_KEY));
    if (!stored || stored.revision !== app.state.revision) {
      errors.push('serialized writes must converge on the latest revision: stored=' + (stored && stored.revision) + ' mem=' + app.state.revision);
    }

    const realSetItem = localStorage.setItem.bind(localStorage);
    let mockThrows = false;
    Object.defineProperty(localStorage, 'setItem', { configurable: true, value: () => { throw new Error('quota'); } });
    try { localStorage.setItem('mock-check', '1'); } catch (e) { mockThrows = true; }
    if (!mockThrows) errors.push('localStorage mock must actually throw');
    const originalDb = app.db;
    app.db = null;
    let rejected = false;
    try { await app.saveState(); } catch (e) { rejected = true; }
    app.db = originalDb;
    Object.defineProperty(localStorage, 'setItem', { configurable: true, value: realSetItem });
    if (!rejected) errors.push('saveState must reject when both backends fail');
    await app.saveState();
    const afterRecovery = await app.idb('state', 'readonly', s => s.get(STATE_KEY));
    if (!afterRecovery || afterRecovery.revision !== app.state.revision) {
      errors.push('write after both-backend failure must not be poisoned');
    }

    const book = app.createBook('位置书', '测试', chapters3, 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books = [book];
    await app.saveChapters(book.id, chapters3);
    delete book.chapters;
    app.saveState();
    app.renderLibrary();
    if (app.reader.classList.contains('active')) await app.closeReader();
    await app.openReader(book.id);
    await wait(100);
    app.state.settings.mode = 'page';
    await app.renderReader();
    app.currentPage = 2;
    app.setPageTransform(false);
    await app.idb('positions', 'readwrite', s => s.delete(book.id));
    localStorage.removeItem(POSITION_PREFIX + book.id);
    await app.flushPosition();
    const persisted = await app.idb('positions', 'readonly', s => s.get(book.id));
    if (!persisted || persisted.chapter !== 0 || persisted.currentPage !== 2) {
      errors.push('flushPosition must complete persistence before resolving: ' + JSON.stringify(persisted && { chapter: persisted.chapter, page: persisted.currentPage }));
    }

    const fontSnap = app.state.settings.fontSize;
    const pSnap = app.saveState();
    app.state.settings.fontSize = fontSnap + 10;
    await pSnap;
    const storedSnap = await app.idb('state', 'readonly', s => s.get(STATE_KEY));
    if (storedSnap.settings.fontSize !== fontSnap) {
      errors.push('IDB snapshot must be a deep copy of the serialized state: ' + storedSnap.settings.fontSize + ' vs ' + fontSnap);
    }
    app.state.settings.fontSize = fontSnap;
    await app.saveState();
    return { ok: errors.length === 0, errors };
  };

  window.__missingChapterCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    const book = app.createBook('缺章书', '测试', chapters3, 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books = [book];
    await app.saveChapters(book.id, chapters3);
    delete book.chapters;
    await app.idb('chapters', 'readwrite', s => s.delete(book.id + ':0'));
    let rejected = false;
    try { await app.loadChapter(book, 0); } catch (e) { rejected = /章节数据缺失/.test(String(e && e.message || e)); }
    if (!rejected) errors.push('loadChapter must throw a clear integrity error for missing chapters');

    const emptyBook = app.createBook('空章书', '测试', [{ title: '空章', content: '', paragraphs: [] }], 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books.push(emptyBook);
    await app.saveChapters(emptyBook.id, [{ title: '空章', content: '' }]);
    delete emptyBook.chapters;
    const emptyChapter = await app.loadChapter(emptyBook, 0);
    if (!emptyChapter || emptyChapter.title !== '空章') errors.push('stored empty chapter must still be readable');

    if (app.reader.classList.contains('active')) await app.closeReader();
    const volumeCalls = [];
    const immersiveCalls = [];
    app.setAndroidVolumeKeys = v => volumeCalls.push(v);
    app.setAndroidImmersive = v => immersiveCalls.push(v);
    const lastReadBefore = book.lastRead;
    await app.openReader(book.id);
    await wait(150);
    if (app.reader.classList.contains('active')) errors.push('failed openReader must roll back the reader UI');
    if (app.library.classList.contains('hidden')) errors.push('failed openReader must restore the library');
    if (volumeCalls.length && volumeCalls[volumeCalls.length - 1] !== false) errors.push('volume keys must be disabled after failed open');
    if (immersiveCalls.length && immersiveCalls[immersiveCalls.length - 1] !== false) errors.push('immersive must be disabled after failed open');
    if (app.state.books.find(b => b.id === book.id).lastRead !== lastReadBefore) errors.push('failed openReader must not update lastRead');

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
    await app.exportData();
    document.createElement = originalCreate;
    if (downloadName) errors.push('export with a missing chapter must not produce a file');

    const saveFailBook = app.createBook('保存失败书', '测试', [chA], 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books.push(saveFailBook);
    await app.saveChapters(saveFailBook.id, [chA]);
    delete saveFailBook.chapters;
    const lastReadBefore2 = saveFailBook.lastRead || 0;
    if (app.reader.classList.contains('active')) await app.closeReader();
    const origSave3 = app.saveState.bind(app);
    let failSave = true;
    app.saveState = async () => { if (failSave) { failSave = false; throw new Error('state persistence failed on all backends'); } return origSave3(); };
    const committed3 = await app.openReader(saveFailBook.id);
    app.saveState = origSave3;
    if (committed3 !== false) errors.push('openReader must return false when metadata save fails');
    if (app.reader.classList.contains('active')) errors.push('openReader save failure must roll back the reader UI');
    if (app.library.classList.contains('hidden')) errors.push('openReader save failure must restore the library');
    if (app.state.books.find(b => b.id === saveFailBook.id).lastRead !== lastReadBefore2) errors.push('openReader save failure must restore lastRead');
    const saveFailToast = (document.querySelector('#toast') || {}).textContent || '';
    if (saveFailToast.includes('内容不完整')) errors.push('openReader save failure must not be reported as missing content: ' + saveFailToast);
    return { ok: errors.length === 0, errors };
  };

  window.__renderRaceCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    const chaptersA = [0, 1, 2].map(i => ({ title: '甲章' + (i + 1), content: '甲章' + (i + 1) + ' 内容。', paragraphs: ['甲章' + (i + 1) + ' 内容。'] }));
    const chaptersB = [0, 1, 2].map(i => ({ title: '乙章' + (i + 1), content: '乙章' + (i + 1) + ' 内容。', paragraphs: ['乙章' + (i + 1) + ' 内容。'] }));
    const bookA = app.createBook('竞态书A', '测试', chaptersA, 'linear-gradient(145deg,#315d72,#74a0af)');
    const bookB = app.createBook('竞态书B', '测试', chaptersB, 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books = [bookA, bookB];
    await app.saveChapters(bookA.id, chaptersA);
    await app.saveChapters(bookB.id, chaptersB);
    delete bookA.chapters;
    delete bookB.chapters;
    app.saveState();
    app.renderLibrary();
    if (app.reader.classList.contains('active')) await app.closeReader();

    const lastReadBeforeA = bookA.lastRead || 0;
    const origLoad = app.loadChapter.bind(app);
    let releaseLoad;
    const loadGate = new Promise(r => { releaseLoad = r; });
    let gateLoad = true;
    app.loadChapter = async (...args) => {
      if (gateLoad && args[1] === 0) await loadGate;
      return origLoad(...args);
    };
    const openA = app.openReader(bookA.id);
    await wait(60);
    gateLoad = false;
    const openB = app.openReader(bookB.id);
    await wait(150);
    releaseLoad();
    await openA;
    await openB;
    await wait(200);
    app.loadChapter = origLoad;
    if (app.currentBookId !== bookB.id) errors.push('stale openReader A must not become current');
    const title = document.querySelector('#reader-book-title').textContent;
    if (title !== '竞态书B') errors.push('reader title must belong to B, got ' + title);
    const chapterTitle = document.querySelector('#reader-chapter-title').textContent;
    if (!String(chapterTitle).includes('乙章')) errors.push('chapter title must belong to B, got ' + chapterTitle);
    const bodyText = app.readerContent.textContent;
    if (bodyText.includes('甲章')) errors.push('rendered body must not contain A chapters');
    if (!bodyText.includes('乙章')) errors.push('rendered body must contain B chapters');
    const firstPageText = String(app.pages[0] && app.pages[0].blocks && app.pages[0].blocks[0] && app.pages[0].blocks[0].text || '');
    if (firstPageText.includes('甲章')) errors.push('page array must belong to B, got ' + firstPageText.slice(0, 20));
    if ((app.state.books.find(b => b.id === bookA.id).lastRead || 0) !== lastReadBeforeA) {
      errors.push('stale openReader A must not update lastRead');
    }

    const bookA2 = app.createBook('竞态失败书A', '测试', chaptersA, 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books.push(bookA2);
    await app.saveChapters(bookA2.id, chaptersA);
    delete bookA2.chapters;
    let a2Entered = false;
    let releaseA2;
    const a2Gate = new Promise(r => { releaseA2 = r; });
    const origLoad2 = app.loadChapter.bind(app);
    app.loadChapter = async (...args) => {
      if (args[0] && args[0].id === bookA2.id && args[1] === 0) {
        a2Entered = true;
        await a2Gate;
        throw new Error('章节数据缺失：竞态失败书A 第 1 章');
      }
      return origLoad2(...args);
    };
    const openA2 = app.openReader(bookA2.id);
    for (let i = 0; i < 50 && !a2Entered; i++) await wait(20);
    if (!a2Entered) errors.push('openReader A2 must enter loadChapter before B opens');
    const openB2 = app.openReader(bookB.id);
    await wait(100);
    releaseA2();
    await openA2;
    await openB2;
    app.loadChapter = origLoad2;
    await wait(150);
    if (app.currentBookId !== bookB.id) errors.push('failed stale openReader must not rollback the active reader');
    if (!app.reader.classList.contains('active')) errors.push('reader must stay open after a stale openReader failure');
    if (document.querySelector('#reader-book-title').textContent !== '竞态书B') errors.push('title must stay B after a stale openReader failure');
    await app.closeReader();
    const committedB = await app.openReader(bookB.id);
    if (committedB !== true) errors.push('successful openReader must return a committed true');
    if (app.currentBookId !== bookB.id) errors.push('committed openReader must leave currentBookId as the target');

    const bookA3 = app.createBook('搜索书A', '测试', chaptersA, 'linear-gradient(145deg,#315d72,#74a0af)');
    const bookB3 = app.createBook('搜索书B', '测试', chaptersB, 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books.push(bookA3, bookB3);
    await app.saveChapters(bookA3.id, chaptersA);
    await app.saveChapters(bookB3.id, chaptersB);
    delete bookA3.chapters;
    delete bookB3.chapters;
    app.saveState();
    let a3Entered = false;
    let releaseA3;
    const a3Gate = new Promise(r => { releaseA3 = r; });
    const origLoad4 = app.loadChapter.bind(app);
    app.loadChapter = async (...args) => {
      if (args[0] && args[0].id === bookA3.id && args[1] === 0) { a3Entered = true; await a3Gate; }
      return origLoad4(...args);
    };
    const srA = app.openSearchResult({ bookId: bookA3.id, chapterIdx: 1, paragraphIndex: 0, charOffset: 0, needle: '甲' });
    for (let i = 0; i < 50 && !a3Entered; i++) await wait(20);
    if (!a3Entered) errors.push('openSearchResult A must enter load before B opens');
    const srB = app.openSearchResult({ bookId: bookB3.id, chapterIdx: 0, paragraphIndex: 0, charOffset: 0, needle: '乙' });
    await wait(150);
    releaseA3();
    await srA;
    await srB;
    app.loadChapter = origLoad4;
    await wait(150);
    if (app.currentBookId !== bookB3.id) errors.push('search race must leave B as the current book');
    if (app.currentChapter !== 0) errors.push('stale search continuation must not change B chapter: ' + app.currentChapter);
    const srTitle = document.querySelector('#reader-chapter-title').textContent;
    if (!String(srTitle).includes('乙章')) errors.push('stale search continuation must not write A content: ' + srTitle);

    app.state.settings.mode = 'page';
    await app.openReader(bookB3.id);
    await wait(100);
    app.currentChapter = 0;
    let releaseJump;
    const jumpGate = new Promise(r => { releaseJump = r; });
    let gateJump = true;
    const origLoadJ = app.loadChapter.bind(app);
    app.loadChapter = async (...args) => { if (gateJump && args[0] && args[0].id === bookB3.id && args[1] === 2) { gateJump = false; await jumpGate; } return origLoadJ(...args); };
    const jumpP = app.jumpToProgress(0.9);
    await wait(80);
    app.openToc();
    const toc1 = document.querySelector('.toc-item[data-ch="1"]');
    if (!toc1) errors.push('toc item for jump race missing');
    if (toc1) {
      toc1.click();
      await wait(150);
      if (app.currentChapter !== 1) errors.push('jump race: TOC must navigate to chapter 1: ch=' + app.currentChapter);
    }
    releaseJump();
    await jumpP;
    await wait(150);
    app.loadChapter = origLoadJ;
    if (app.currentChapter !== 1) errors.push('stale jump must not override the TOC navigation: ch=' + app.currentChapter);
    const jumpTitle = document.querySelector('#reader-chapter-title').textContent;
    if (!String(jumpTitle).includes('乙章')) errors.push('stale jump must not write content for another chapter: ' + jumpTitle);
    return { ok: errors.length === 0, errors };
  };

  window.__importSingleFlightCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    let batchCalls = 0;
    const origBatch = app.saveChapterBatch.bind(app);
    app.saveChapterBatch = async (...args) => { batchCalls++; await origBatch(...args); };
    const file = new File(['第一章 开始\n正文内容\n第二章 继续\n更多内容'], '单飞测试-测试作者.txt', { type: 'text/plain' });
    const p1 = app.importFile(file);
    const p2 = app.importFile(file);
    await Promise.all([p1, p2]);
    const imported = app.state.books.filter(b => b.title === '单飞测试');
    if (imported.length !== 1) errors.push('double import must add exactly one book, got ' + imported.length);
    const retryFile = new File(['第一章 重试\n内容'], '单飞重试-测试作者.txt', { type: 'text/plain' });
    await app.importFile(retryFile);
    if (app.state.books.filter(b => b.title === '单飞重试').length !== 1) errors.push('import must work again after busy clears');

    const importBtn = document.querySelector('#import-btn');
    const emptyImportBtn = document.querySelector('#empty-import-btn');
    const importDataBtn = document.querySelector('#import-data-btn');
    let releaseImport;
    const importGate = new Promise(r => { releaseImport = r; });
    const origBatch2 = app.saveChapterBatch.bind(app);
    app.saveChapterBatch = async (...args) => { await importGate; await origBatch2(...args); };
    const busyFile = new File(['第一章 忙碌\n内容\n第二章 更多'], '忙碌导入-测试作者.txt', { type: 'text/plain' });
    const pBusy = app.importFile(busyFile);
    await wait(80);
    if (app.importBusy !== true) errors.push('importBusy must be true while importing');
    if (!importBtn.disabled) errors.push('import button must be disabled while importing');
    if (!emptyImportBtn.disabled) errors.push('empty-state import button must be disabled while importing');
    if (!importDataBtn.disabled) errors.push('backup import button must be disabled while importing');
    if (importBtn.getAttribute('aria-busy') !== 'true') errors.push('import button must be aria-busy while importing');
    releaseImport();
    await pBusy;
    if (app.importBusy !== false) errors.push('importBusy must clear after import');
    if (importBtn.disabled) errors.push('import button must re-enable after import');
    if (importBtn.getAttribute('aria-busy') !== 'false') errors.push('aria-busy must clear after import');

    const origDetect = app.detectFileEncoding.bind(app);
    app.detectFileEncoding = async () => { throw new Error('decode failed'); };
    const failFile = new File(['第一章 失败\n内容'], '失败导入-测试作者.txt', { type: 'text/plain' });
    await app.importFile(failFile);
    app.detectFileEncoding = origDetect;
    if (app.importBusy !== false) errors.push('importBusy must clear after a failed import');
    if (importBtn.disabled) errors.push('import button must re-enable after a failed import');
    if (importBtn.getAttribute('aria-busy') !== 'false') errors.push('aria-busy must clear after a failed import');
    const retryFile2 = new File(['第一章 可重试\n内容'], '可重试导入-测试作者.txt', { type: 'text/plain' });
    await app.importFile(retryFile2);
    if (app.state.books.filter(b => b.title === '可重试导入').length !== 1) errors.push('import must be retryable after a failure');

    app.saveChapterBatch = origBatch;
    let releaseMix;
    const mixGate = new Promise(r => { releaseMix = r; });
    const origBatchMix = app.saveChapterBatch.bind(app);
    app.saveChapterBatch = async (...args) => { await mixGate; return origBatchMix(...args); };
    const mixTxt = app.importFile(new File(['第一章 互斥\n内容'], '互斥TXT-测试作者.txt', { type: 'text/plain' }));
    await wait(80);
    const mixBackup = app.importBackup(new File(['{}'], '互斥backup.json', { type: 'application/json' }));
    await wait(80);
    if (app.importBusy !== true) errors.push('TXT import must hold the busy gate while backup is attempted');
    releaseMix();
    await mixTxt;
    await mixBackup;
    if (app.state.books.some(b => b.title === '互斥TXT') === false) errors.push('TXT import must complete after the gate releases');
    const origFileText = File.prototype.text;
    let releaseText;
    const textGate = new Promise(r => { releaseText = r; });
    File.prototype.text = async function () {
      if (this.name === '互斥backup2.json') await textGate;
      return origFileText.call(this);
    };
    const mixBackup2 = new File([JSON.stringify({
      app: 'novel-reader', version: 2, exportedAt: Date.now(),
      state: { books: [{ ...app.createBook('互斥备份书', '测试', [chA], 'g'), chapters: [{ title: '第一章', content: '正文' }] }], bookmarks: [], settings: {}, sortMode: 'recent', stats: { date: null, minutes: 0, totalMinutes: 0 } }
    })], '互斥backup2.json', { type: 'application/json' });
    const bkBusy = app.importBackup(mixBackup2);
    await wait(80);
    const mixTxt2 = app.importFile(new File(['第一章 拒\n内容'], '互斥拒TXT-测试作者.txt', { type: 'text/plain' }));
    await wait(80);
    if (app.importBusy !== true) errors.push('backup import must hold the busy gate while TXT is attempted');
    releaseText();
    await bkBusy;
    await mixTxt2;
    File.prototype.text = origFileText;
    if (app.state.books.some(b => b.title === '互斥备份书') === false) errors.push('backup import must complete after the gate releases');
    if (app.state.books.some(b => b.title === '互斥拒TXT')) errors.push('TXT import must be rejected while backup is busy');
    app.saveChapterBatch = origBatch;
    return { ok: errors.length === 0, errors };
  };

  window.__importAtomicityCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    const origSaveState = app.saveState.bind(app);
    let lastBatchBookId = null;
    const origBatch = app.saveChapterBatch.bind(app);
    app.saveChapterBatch = async (bookId, ...rest) => { lastBatchBookId = bookId; return origBatch(bookId, ...rest); };

    const existingCount = app.state.books.length;
    app.saveState = async () => { throw new Error('persist failed'); };
    const atomFile = new File(['第一章 原子\n内容'], '原子导入-测试作者.txt', { type: 'text/plain' });
    await app.importFile(atomFile);
    app.saveState = origSaveState;
    if (app.state.books.some(b => b.title === '原子导入')) errors.push('failed metadata save must roll back the new book');
    if (lastBatchBookId) {
      const orphan = await app.idb('chapters', 'readonly', store => store.get(lastBatchBookId + ':0'));
      if (orphan) errors.push('failed import must clean up orphan chapters');
    }
    const toastText = (document.querySelector('#toast') || {}).textContent || '';
    if (toastText.includes('已导入')) errors.push('failed import must not claim success: ' + toastText);
    const importBtn2 = document.querySelector('#import-btn');
    if (importBtn2.disabled) errors.push('import button must re-enable after a failed atomic import');
    if (app.importBusy !== false) errors.push('importBusy must clear after a failed atomic import');
    const retryAtomic = new File(['第一章 原子重试\n内容'], '原子重试-测试作者.txt', { type: 'text/plain' });
    await app.importFile(retryAtomic);
    if (app.state.books.filter(b => b.title === '原子重试').length !== 1) errors.push('import must be retryable after an atomic failure');

    app.saveState = async () => { throw new Error('persist failed'); };
    const bkBackup = app.createBook('备份原子书', '测试', [chA], 'linear-gradient(145deg,#315d72,#74a0af)');
    const backupPayload = JSON.stringify({
      app: 'novel-reader', version: 2, exportedAt: Date.now(),
      state: {
        books: [{ ...bkBackup, chapters: [{ title: '第一章', content: '备份正文' }] }],
        bookmarks: [{ id: 'bm-atomic', bookId: bkBackup.id, chapterIdx: 0, paragraphIndex: 0, charOffset: 0, text: 'x', note: '', timestamp: Date.now() }],
        settings: {}, sortMode: 'recent', stats: { date: null, minutes: 0, totalMinutes: 0 }
      }
    });
    await app.importBackup(new File([backupPayload], 'atomic-backup.json', { type: 'application/json' }));
    app.saveState = origSaveState;
    if (app.state.books.some(b => b.title === '备份原子书')) errors.push('failed backup import must roll back added books');
    if (app.state.books.length !== existingCount + 1) errors.push('existing books must stay untouched after a failed backup import: ' + app.state.books.length + ' vs ' + (existingCount + 1));
    if (app.state.bookmarks.some(b => b.id === 'bm-atomic')) errors.push('failed backup import must roll back its bookmarks');
    const orphan2 = await app.idb('chapters', 'readonly', store => store.get(bkBackup.id + ':0'));
    if (orphan2) errors.push('failed backup import must clean up added chapters');
    if (app.importBusy !== false) errors.push('backup importBusy must clear after an atomic failure');

    const mismatchBook = app.createBook('数不一致书', '测试', [chA], 'linear-gradient(145deg,#315d72,#74a0af)');
    mismatchBook.chapterCount = 5;
    mismatchBook.chapterTitles = ['一', '二', '三', '四', '五'];
    const mismatchPayload = JSON.stringify({
      app: 'novel-reader', version: 2, exportedAt: Date.now(),
      state: { books: [{ ...mismatchBook, chapters: [{ title: '第一章', content: '一' }, { title: '第二章', content: '二' }] }], bookmarks: [], settings: {}, sortMode: 'recent', stats: { date: null, minutes: 0, totalMinutes: 0 } }
    });
    await app.importBackup(new File([mismatchPayload], 'mismatch.json', { type: 'application/json' }));
    const mismatchImported = app.state.books.find(b => b.title === '数不一致书');
    if (!mismatchImported) errors.push('mismatch backup must import the book');
    if (mismatchImported && mismatchImported.chapterCount !== 2) errors.push('chapterCount must be normalized to actual body length: ' + mismatchImported.chapterCount);
    if (mismatchImported && (!Array.isArray(mismatchImported.chapterTitles) || mismatchImported.chapterTitles.length !== 2)) errors.push('chapterTitles must be normalized to actual body length');
    if (mismatchImported) {
      const mismatchCh0 = await app.loadChapter(mismatchImported, 0);
      if (!mismatchCh0 || mismatchCh0.title !== '第一章') errors.push('mismatch backup must produce readable chapters');
      let mismatchPhantom = false;
      try { await app.loadChapter(mismatchImported, 2); } catch (e) { mismatchPhantom = true; }
      if (!mismatchPhantom) errors.push('normalized chapterCount must not expose phantom chapters');
    }
    app.saveState = async () => { throw new Error('persist failed'); };
    const mismatchRollback = app.createBook('数不一致回滚', '测试', [chA], 'linear-gradient(145deg,#315d72,#74a0af)');
    mismatchRollback.chapterCount = 9;
    const rbkPayload = JSON.stringify({
      app: 'novel-reader', version: 2, exportedAt: Date.now(),
      state: { books: [{ ...mismatchRollback, chapters: [{ title: '第一章', content: '一' }] }], bookmarks: [], settings: {}, sortMode: 'recent', stats: { date: null, minutes: 0, totalMinutes: 0 } }
    });
    await app.importBackup(new File([rbkPayload], 'rbk.json', { type: 'application/json' }));
    app.saveState = origSaveState;
    if (app.state.books.some(b => b.title === '数不一致回滚')) errors.push('failed mismatch backup must roll back');
    const rbkOrphan = await app.idb('chapters', 'readonly', store => store.get(mismatchRollback.id + ':0'));
    if (rbkOrphan) errors.push('failed mismatch backup must clean up written chapters');
    return { ok: errors.length === 0, errors };
  };

  window.__trashSoftDeleteCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    const book = app.createBook('软删书', '测试', chapters3, 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books = [book];
    await app.saveChapters(book.id, chapters3);
    delete book.chapters;
    const softPos = ReaderCore.createReadingPosition({ bookId: book.id, chapter: 0, readingMode: 'page', currentPage: 2, pageCount: 5, intraChapterPercent: 0.5 });
    book.readingPosition = softPos;
    book.progress = 0.5;
    app.state.bookmarks.push({ id: 'bm-soft', bookId: book.id, chapterIdx: 1, paragraphIndex: 0, charOffset: 0, text: '软删书签', note: '', timestamp: Date.now() });
    localStorage.setItem(POSITION_PREFIX + book.id, JSON.stringify({ ...softPos, timestamp: softPos.timestamp + 1000, chapter: 1 }));
    await app.idb('positions', 'readwrite', store => store.put({ ...softPos, timestamp: softPos.timestamp + 2000, chapter: 2 }, book.id));
    app.saveState();
    app.renderLibrary();

    let loadCalls = 0;
    const origLoad = app.loadChapter.bind(app);
    app.loadChapter = async (...args) => { loadCalls++; return origLoad(...args); };
    await app.deleteBook(book.id);
    if (loadCalls > 0) errors.push('soft delete must not load chapters');
    const trashEntry = await app.loadTrashEntry(book.id);
    if (!trashEntry) errors.push('trash entry must exist after soft delete');
    if (trashEntry.chapters) errors.push('trash must not copy chapter bodies');
    if (!trashEntry.position || trashEntry.position.chapter !== 2) errors.push('trash must keep the newest position across candidates: ' + JSON.stringify(trashEntry.position && trashEntry.position.chapter));
    const ch0 = await app.loadChapter(book, 0);
    if (!ch0 || ch0.title !== '第一章') errors.push('chapter bodies must stay in store after soft delete');
    if (!(await app.restoreFromTrash(book.id))) errors.push('restore must succeed after soft delete');
    if (!app.state.books.some(b => b.id === book.id)) errors.push('restored book must be back on the shelf');
    if (app.state.bookmarks.some(b => b.id === 'bm-soft') === false) errors.push('restore must bring back the bookmarks');
    const restoredBook = app.state.books.find(b => b.id === book.id);
    if (!restoredBook.readingPosition || restoredBook.readingPosition.chapter !== 2) errors.push('restore must keep the newest reading position');
    const restoredPosStore = await app.idb('positions', 'readonly', store => store.get(book.id));
    if (!restoredPosStore || restoredPosStore.chapter !== 2) errors.push('restore must keep the persisted position');

    await app.deleteBook(book.id);
    const conflictBook = { ...book, chapterCount: 1, chapterTitles: ['冲突章'] };
    await app.idb('chapters', 'readwrite', store => store.put({ title: 'SENTINEL-不可覆盖', content: '现有正文' }, book.id + ':0'));
    app.chapterCache.clear();
    app.state.books.push(conflictBook);
    app.saveState();
    const conflicted = await app.restoreFromTrash(book.id);
    if (conflicted) errors.push('restore with same-ID conflict must be refused');
    const conflictChapter = await app.loadChapter(conflictBook, 0);
    if (conflictChapter.title !== 'SENTINEL-不可覆盖') errors.push('conflict restore must not overwrite existing chapters: ' + conflictChapter.title);
    app.state.books = app.state.books.filter(b => b.id !== conflictBook.id);

    const secondBook = app.createBook('第二软删书', '测试', [chA], 'linear-gradient(145deg,#315d72,#74a0af)');
    await app.saveChapters(secondBook.id, [chA]);
    delete secondBook.chapters;
    app.state.books.push(secondBook);
    app.saveState();
    await app.deleteBook(book.id);
    await app.deleteBook(secondBook.id);
    let purged = false;
    const origPurge = app.purgeTrashEntry.bind(app);
    app.purgeTrashEntry = async id => { purged = true; await origPurge(id); };
    app.requestPurgeTrashEntry(book.id, '软删书');
    if (purged) errors.push('first purge click must only arm');
    app.requestPurgeTrashEntry(secondBook.id, '第二软删书');
    app.requestPurgeTrashEntry(book.id, '软删书');
    if (purged) errors.push('switching entries must clear the purge arm');
    app.requestPurgeTrashEntry(book.id, '软删书');
    await wait(300);
    if (!purged) errors.push('second purge click on the same id must purge');
    let chapterGone = false;
    try { await app.loadChapter(book, 0); } catch (e) { chapterGone = true; }
    if (!chapterGone) errors.push('purged book chapter bodies must be removed');
    if (await app.loadTrashEntry(book.id)) errors.push('purged trash entry must be removed');

    const legacyBook = app.createBook('旧格式书', '测试', [chA], 'linear-gradient(145deg,#315d72,#74a0af)');
    const legacyEntry = { savedAt: Date.now(), book: legacyBook, chapters: [{ title: '第一章', content: '旧正文' }], position: null, bookmarks: [] };
    await app.saveTrashEntry(legacyBook.id, legacyEntry);
    if (!(await app.restoreFromTrash(legacyBook.id))) errors.push('legacy trash entry must restore');
    const legacyCh = await app.loadChapter(legacyBook, 0);
    if (!legacyCh || legacyCh.title !== '第一章') errors.push('legacy restore must write chapter bodies back');
    await app.deleteBook(legacyBook.id);
    const reTrash = await app.loadTrashEntry(legacyBook.id);
    if (reTrash.chapters) errors.push('re-trash must not contain inline chapter bodies');
    if (reTrash.book && reTrash.book.chapters) errors.push('re-trash must not carry inline chapters on the book');
    if (!(await app.restoreFromTrash(legacyBook.id))) errors.push('re-trash restore must succeed');
    const legacyBook2 = app.createBook('旧格式书B', '测试', [chA], 'linear-gradient(145deg,#315d72,#74a0af)');
    const legacyEntry2 = { savedAt: Date.now(), book: { ...legacyBook2, chapters: [{ title: '第一章', content: 'book正文' }] }, position: null, bookmarks: [] };
    await app.saveTrashEntry(legacyBook2.id, legacyEntry2);
    if (!(await app.restoreFromTrash(legacyBook2.id))) errors.push('legacy book.chapters must restore');
    const legacyCh2 = await app.loadChapter(legacyBook2, 0);
    if (!legacyCh2 || legacyCh2.content !== 'book正文') errors.push('legacy book.chapters must write bodies');
    const legacyStateBook2 = app.state.books.find(b => b.id === legacyBook2.id);
    if (legacyStateBook2 && legacyStateBook2.chapters) errors.push('legacy restore must delete inline book.chapters from the shelved book');
    if (!app.state.books.some(b => b.id === legacyBook2.id)) errors.push('legacy book.chapters restore must add the book');

    const expiredBook = app.createBook('过期书', '测试', [chA], 'linear-gradient(145deg,#315d72,#74a0af)');
    await app.saveChapters(expiredBook.id, [chA]);
    await app.saveTrashEntry(expiredBook.id, { savedAt: Date.now() - 31 * 24 * 60 * 60 * 1000, book: expiredBook, position: null, bookmarks: [], keepsData: true });
    await app.refreshTrash();
    if (await app.loadTrashEntry(expiredBook.id)) errors.push('expired trash entry must be removed');
    let expiredGone = false;
    try { await app.loadChapter(expiredBook, 0); } catch (e) { expiredGone = true; }
    if (!expiredGone) errors.push('expired purge must remove retained chapter bodies');

    app.state.books.push(conflictBook);
    await app.idb('chapters', 'readwrite', store => store.put({ title: 'SENTINEL-不可覆盖', content: '现有正文' }, conflictBook.id + ':0'));
    app.chapterCache.clear();
    const posConflict = { chapter: 0, currentPage: 0, totalProgress: 0, timestamp: Date.now() };
    await app.idb('positions', 'readwrite', store => store.put(posConflict, conflictBook.id));
    await app.saveTrashEntry(conflictBook.id, { savedAt: Date.now() - 31 * 24 * 60 * 60 * 1000, book: { ...conflictBook }, position: posConflict, bookmarks: [], keepsData: true });
    await app.refreshTrash();
    const sentinelAfter = await app.loadChapter(conflictBook, 0);
    if (sentinelAfter.title !== 'SENTINEL-不可覆盖') errors.push('expired purge must not delete chapters of an active book: ' + sentinelAfter.title);
    const posAfter = await app.idb('positions', 'readonly', store => store.get(conflictBook.id));
    if (!posAfter) errors.push('expired purge must not delete the position of an active book');
    if (await app.loadTrashEntry(conflictBook.id)) errors.push('expired trash metadata must be removed for an active book');
    await app.saveTrashEntry(conflictBook.id, { savedAt: Date.now(), book: { ...conflictBook }, position: posConflict, bookmarks: [], keepsData: true });
    await app.purgeTrashEntry(conflictBook.id);
    const sentinelPurge = await app.loadChapter(conflictBook, 0);
    if (sentinelPurge.title !== 'SENTINEL-不可覆盖') errors.push('purge must not delete chapters of an active book');
    if (await app.loadTrashEntry(conflictBook.id)) errors.push('purged trash metadata must be removed');
    app.state.books = app.state.books.filter(b => b.id !== conflictBook.id);

    const purgeFailBook = app.createBook('purge失败书', '测试', [chA], 'linear-gradient(145deg,#315d72,#74a0af)');
    await app.saveChapters(purgeFailBook.id, [chA]);
    delete purgeFailBook.chapters;
    app.state.books.push(purgeFailBook);
    app.saveState();
    await app.deleteBook(purgeFailBook.id);
    app.state.books = app.state.books.filter(b => b.id !== purgeFailBook.id);
    app.saveState();
    localStorage.setItem('novelReader_chapter_' + purgeFailBook.id + ':0', JSON.stringify({ title: '旧', content: '旧正文' }));
    let delFail = false;
    const origDelCh = app.deleteStoredChapters.bind(app);
    app.deleteStoredChapters = async (...args) => { if (!delFail) { delFail = true; throw new Error('delete chapters failed'); } return origDelCh(...args); };
    await app.purgeTrashEntry(purgeFailBook.id);
    app.deleteStoredChapters = origDelCh;
    if (!(await app.loadTrashEntry(purgeFailBook.id))) errors.push('failed purge cleanup must keep the trash marker');
    if (!delFail) errors.push('purge cleanup failure must be visible, not swallowed');
    await app.purgeTrashEntry(purgeFailBook.id);
    if (await app.loadTrashEntry(purgeFailBook.id)) errors.push('purge retry must clear the marker');
    if (localStorage.getItem('novelReader_chapter_' + purgeFailBook.id + ':0')) errors.push('purge must remove legacy localStorage chapter keys');
    let purgeBodyGone = false;
    try { await app.loadChapter(purgeFailBook, 0); } catch (e) { purgeBodyGone = true; }
    if (!purgeBodyGone) errors.push('purge retry must remove retained chapter bodies');

    const cleanupBook = app.createBook('清理失败书', '测试', [chA], 'linear-gradient(145deg,#315d72,#74a0af)');
    await app.saveChapters(cleanupBook.id, [chA]);
    delete cleanupBook.chapters;
    app.state.books.push(cleanupBook);
    app.saveState();
    await app.deleteBook(cleanupBook.id);
    let cleanupFailed = false;
    const origDel = app.deleteTrashEntry.bind(app);
    app.deleteTrashEntry = async id => { if (id === cleanupBook.id && !cleanupFailed) { cleanupFailed = true; throw new Error('cleanup failed'); } return origDel(id); };
    const restoredClean = await app.restoreFromTrash(cleanupBook.id);
    if (!restoredClean) errors.push('restore must succeed even when trash cleanup fails');
    if (!app.state.books.some(b => b.id === cleanupBook.id)) errors.push('restored book must stay on the shelf');
    if (!(await app.loadTrashEntry(cleanupBook.id))) errors.push('failed cleanup must keep the trash entry');
    const toastTxt = (document.querySelector('#toast') || {}).textContent || '';
    if (toastTxt.includes('已恢复') && !toastTxt.includes('清理失败')) errors.push('toast must not claim full success when cleanup failed: ' + toastTxt);
    app.deleteTrashEntry = origDel;
    await app.purgeTrashEntry(cleanupBook.id);
    if (await app.loadTrashEntry(cleanupBook.id)) errors.push('retry must clear the stale trash entry');
    const activeCh = await app.loadChapter(cleanupBook, 0);
    if (!activeCh) errors.push('active book chapters must survive purge');

    const rollbackBook = app.createBook('删除回滚书', '测试', [chA], 'linear-gradient(145deg,#315d72,#74a0af)');
    await app.saveChapters(rollbackBook.id, [chA]);
    delete rollbackBook.chapters;
    app.state.bookmarks.push({ id: 'bm-rb', bookId: rollbackBook.id, chapterIdx: 0, paragraphIndex: 0, charOffset: 0, text: 'x', note: '', timestamp: Date.now() });
    app.state.books.push(rollbackBook);
    app.saveState();
    const rbOriginalIndex = app.state.books.indexOf(rollbackBook);
    let rbFail = true;
    const origSaveRb = app.saveState.bind(app);
    app.saveState = async () => { if (rbFail) { rbFail = false; throw new Error('persist failed'); } return origSaveRb(); };
    await app.deleteBook(rollbackBook.id);
    app.saveState = origSaveRb;
    if (!app.state.books.some(b => b.id === rollbackBook.id)) errors.push('failed delete must restore the book to the shelf');
    if (app.state.books.indexOf(rollbackBook) !== rbOriginalIndex) errors.push('failed delete must restore the book at its original index');
    if (app.state.bookmarks.some(b => b.id === 'bm-rb') === false) errors.push('failed delete must restore its bookmarks');
    if (await app.loadTrashEntry(rollbackBook.id)) errors.push('failed delete must not leave trash metadata');

    const restoreRbBook = app.createBook('恢复回滚书', '测试', [chA], 'linear-gradient(145deg,#315d72,#74a0af)');
    await app.saveChapters(restoreRbBook.id, [chA]);
    delete restoreRbBook.chapters;
    app.state.bookmarks.push({ id: 'bm-rrb', bookId: restoreRbBook.id, chapterIdx: 0, paragraphIndex: 0, charOffset: 0, text: 'y', note: '', timestamp: Date.now() });
    app.state.books.push(restoreRbBook);
    app.saveState();
    await app.deleteBook(restoreRbBook.id);
    let rrbFail = true;
    app.saveState = async () => { if (rrbFail) { rrbFail = false; throw new Error('persist failed'); } return origSaveRb(); };
    const restoredRb = await app.restoreFromTrash(restoreRbBook.id);
    app.saveState = origSaveRb;
    if (restoredRb) errors.push('restore must fail when metadata save fails');
    if (app.state.books.some(b => b.id === restoreRbBook.id)) errors.push('failed restore must not leave the book on the shelf');
    if (app.state.bookmarks.some(b => b.id === 'bm-rrb')) errors.push('failed restore must roll back added bookmarks');

    const readFailBook = app.createBook('读取失败书', '测试', [chA], 'linear-gradient(145deg,#315d72,#74a0af)');
    await app.saveChapters(readFailBook.id, [chA]);
    delete readFailBook.chapters;
    app.state.books.push(readFailBook);
    app.saveState();
    await app.deleteBook(readFailBook.id);
    const origIdb = app.idb.bind(app);
    let failTrashRead = true;
    app.idb = async (store, mode, fn) => {
      if (failTrashRead && store === 'trash' && mode === 'readonly') { failTrashRead = false; throw new Error('trash read failed'); }
      return origIdb(store, mode, fn);
    };
    const restoredFail = await app.restoreFromTrash(readFailBook.id);
    if (restoredFail) errors.push('restore must fail when the trash read throws');
    if (!(await app.loadTrashEntry(readFailBook.id))) errors.push('failed trash read must keep the marker');
    const readFailCh = await app.loadChapter(readFailBook, 0);
    if (!readFailCh) errors.push('failed trash read must keep chapter bodies');
    if (!(await app.restoreFromTrash(readFailBook.id))) errors.push('restore must be retryable after a trash read failure');
    if (!app.state.books.some(b => b.id === readFailBook.id)) errors.push('retried restore must bring the book back');
    app.idb = origIdb;

    const purgeReadFail = app.createBook('purge读取失败书', '测试', [chA], 'linear-gradient(145deg,#315d72,#74a0af)');
    await app.saveChapters(purgeReadFail.id, [chA]);
    delete purgeReadFail.chapters;
    app.state.books.push(purgeReadFail);
    app.saveState();
    await app.deleteBook(purgeReadFail.id);
    app.state.books = app.state.books.filter(b => b.id !== purgeReadFail.id);
    app.saveState();
    failTrashRead = true;
    app.idb = async (store, mode, fn) => {
      if (failTrashRead && store === 'trash' && mode === 'readonly') { failTrashRead = false; throw new Error('trash read failed'); }
      return origIdb(store, mode, fn);
    };
    await app.purgeTrashEntry(purgeReadFail.id);
    if (!(await app.loadTrashEntry(purgeReadFail.id))) errors.push('failed purge read must keep the marker');
    const purgeReadCh = await app.loadChapter(purgeReadFail, 0);
    if (!purgeReadCh) errors.push('failed purge read must keep chapter bodies');
    app.idb = origIdb;
    await app.purgeTrashEntry(purgeReadFail.id);
    if (await app.loadTrashEntry(purgeReadFail.id)) errors.push('purge retry must clear the marker');
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

async function runChrome(chromePath, url) {
  const server = http.createServer();
  const debugPort = await new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  }));
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-integrity-profile-'));
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
      const result = await client.send('Runtime.evaluate', {
        expression: 'typeof window.__navQueueCheck === "function" && !!window.readerApp && (!!window.readerApp.db || window.readerApp.storageFallback) && !!window.readerApp.statTimer && !!window.readerApp.nightModeCheckTimer && !!window.readerApp.clockTimer',
        returnByValue: true,
      });
      if (result.result && result.result.value) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    const diag = await client.send('Runtime.evaluate', {
      expression: `(() => {
        let injectedError = '';
        const injected = document.scripts[2];
        if (injected) {
          try { new Function(injected.textContent || ''); } catch (e) {
            const msg = String(e && e.message || e);
            const m = msg.match(/<anonymous>:(\\d+):(\\d+)/);
            let context = '';
            if (m) {
              const line = Number(m[1]);
              const lines = (injected.textContent || '').split('\n');
              context = lines.slice(Math.max(0, line - 2), line + 1).map((l, i) => String(line - 1 + i) + ': ' + l).join('\n');
            }
            injectedError = msg + '\n---\n' + context;
          }
        }
        return JSON.stringify({ readerApp: !!window.readerApp, books: window.readerApp && readerApp.state && readerApp.state.books.length, body: (document.body.textContent || '').slice(0, 200), injectedError: injectedError.slice(0, 600) });
      })()`,
      returnByValue: true,
    });
    console.log('diag: ' + (diag.result && diag.result.value || ''));
    assert.ok(ready, 'harness did not load');

    const checks = [
      ['navQueue', 'window.__navQueueCheck()'],
      ['stateRevision', 'window.__stateRevisionCheck()'],
      ['missingChapter', 'window.__missingChapterCheck()'],
      ['renderRace', 'window.__renderRaceCheck()'],
      ['importSingleFlight', 'window.__importSingleFlightCheck()'],
      ['importAtomicity', 'window.__importAtomicityCheck()'],
      ['trashSoftDelete', 'window.__trashSoftDeleteCheck()'],
    ];
    const results = {};
    for (const [name, expression] of checks) {
      const res = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) {
        const ex = res.exceptionDetails.exception || {};
        const desc = ex.description || ex.value || JSON.stringify(ex);
        console.log('check ' + name + ' threw: ' + String(desc).slice(0, 800));
        results[name] = { ok: false, errors: ['check threw: ' + String(desc).slice(0, 400)] };
        continue;
      }
      results[name] = res.result && res.result.value;
    }
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'data-integrity-'));
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
    const results = await runChrome(chromePath, `http://127.0.0.1:${port}/reader.html`);
    const failures = [];
    for (const [name, result] of Object.entries(results)) {
      if (!result || !result.ok) {
        failures.push(name + ': ' + JSON.stringify(result && result.errors || result));
      }
    }
    if (failures.length) {
      throw new Error('Data integrity regression failed:\n' + failures.join('\n'));
    }
    const summary = Object.keys(results).map(name => name + '=' + (results[name] && results[name].ok ? 'PASS' : 'FAIL')).join(' ');
    console.log('data integrity regression tests passed: ' + summary);
  } finally {
    server.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
