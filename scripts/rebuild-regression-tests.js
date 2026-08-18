const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'reader.html'), 'utf8');
const corePath = path.join(root, 'reader-core.js');
const appPath = path.join(root, 'reader-app.js');
const cssPath = path.join(root, 'reader-styles.css');

assert.ok(fs.existsSync(corePath), 'reader-core.js should exist');
assert.ok(fs.existsSync(appPath), 'reader-app.js should exist');
assert.ok(fs.existsSync(cssPath), 'reader-styles.css should exist');

assert.ok(html.includes('<link rel="stylesheet" href="reader-styles.css">'), 'reader.html should load external CSS');
assert.ok(html.includes('<script src="reader-core.js"></script>'), 'reader.html should load ReaderCore');
assert.ok(html.includes('<script src="reader-app.js"></script>'), 'reader.html should load ReaderApp');
assert.ok(!html.includes('/* ===== Data ===== */'), 'reader.html should not contain the old inline app script');
assert.ok(html.length < 25000, 'reader.html should be a compact shell');
['search-btn','bookmarks-btn','search-panel','search-input','search-results','bookmarks-panel','bookmarks-list','book-actions','delete-book-btn','selection-bubble','selection-bookmark-btn','selection-copy-btn'].forEach(id => {
  assert.ok(html.includes(`id="${id}"`), `reader.html should include #${id}`);
});
['data-font="0"','data-font="1"','data-font="2"'].forEach(marker => {
  assert.ok(html.includes(marker), `reader.html should restore ${marker} font controls`);
});
assert.ok(html.includes('http-equiv="Content-Security-Policy"'), 'reader.html should define a Content Security Policy');

const core = require(corePath);
[
  'parseChaptersFromText',
  'createChapterParser',
  'parseTitleFromFilename',
  'splitParagraphs',
  'normalizeReadingPosition',
  'chooseBestReadingPosition',
  'createReadingPosition',
  'getPreviousPageTarget',
  'paginatePlainText',
].forEach(name => {
  assert.strictEqual(typeof core[name], 'function', `ReaderCore.${name} should be a function`);
});

const chapters = core.parseChaptersFromText('序言内容\n第一章 初见\n第一段\n\n第二段\n第二章 再见\n结尾');
assert.strictEqual(chapters.length, 3, 'parser should preserve prologue and chapter headings');
assert.strictEqual(chapters[0].title, '序');
assert.strictEqual(chapters[1].title, '第一章 初见');
const chunkedSource='\uFEFF序言内容\r\n第一章 初见\r\n第一段\r\n第二段\r\n第二章 再见\r\n结尾';
const chunkParser=core.createChapterParser();
const chunkedChapters=[];
['\uFEFF序言','内容\r','\n第','一章 初见\r\n第一段\r','\n第二段\r\n第二','章 再见\r\n结尾'].forEach(chunk=>{
  chunkedChapters.push(...chunkParser.push(chunk));
});
chunkedChapters.push(...chunkParser.finish());
assert.deepStrictEqual(chunkedChapters,core.parseChaptersFromText(chunkedSource),'chunk parser should match whole-text parsing across BOM, CRLF, and heading boundaries');
assert.deepStrictEqual(core.parseTitleFromFilename('凡人修仙传-忘语.txt'), { title: '凡人修仙传', author: '忘语' });

const best = core.chooseBestReadingPosition([
  { bookId: 'a', chapter: 1, timestamp: 10 },
  { bookId: 'a', chapter: 2, timestamp: 20 },
], { id: 'a', chapterCount: 5 });
assert.strictEqual(best.chapter, 2, 'newest position should win');

const pages = core.paginatePlainText({
  title: '第一章',
  paragraphs: ['这是一段用于分页的文字。'.repeat(40), '第二段内容。'.repeat(30)],
  charsPerLine: 16,
  linesPerPage: 8,
});
assert.ok(pages.length > 1, 'plain text pagination should split long content');
assert.ok(pages.every(page => Number.isInteger(page.anchor.paragraphIndex)), 'each page should expose an anchor');
assert.strictEqual(typeof core.findPageIndexForAnchor, 'function', 'ReaderCore.findPageIndexForAnchor should be a function');
const anchorPage = core.findPageIndexForAnchor(pages, 1, 10);
assert.ok(anchorPage > 0, 'page lookup should find the page closest to a later paragraph anchor');
assert.strictEqual(core.findPageIndexForAnchor(pages, 99, 0), pages.length - 1, 'page lookup should clamp anchors after the chapter to the last page');
assert.deepStrictEqual(core.getPreviousPageTarget(2,0,9),{chapter:1,page:8},'previous from a chapter start should land on the previous chapter last page');
assert.deepStrictEqual(core.getPreviousPageTarget(2,4,9),{chapter:2,page:3},'previous inside a chapter should stay in the chapter');

assert.strictEqual(typeof core.normalizeBookmarks, 'function', 'ReaderCore.normalizeBookmarks should be a function');
const normalizedBookmarks = core.normalizeBookmarks([
  { id: 'legacy', bookIdx: 1, chapterIdx: 3, text: '旧书签', timestamp: 10 },
  { id: 'current', bookId: 'book-a', chapterIdx: 1, text: '新书签', timestamp: 20 },
  { id: 'orphan', bookIdx: 99, chapterIdx: 0, text: '无效书签' },
], [
  { id: 'book-a', chapterCount: 2 },
  { id: 'book-b', chapterCount: 4 },
]);
assert.deepStrictEqual(normalizedBookmarks.map(item => item.bookId), ['book-b', 'book-a'], 'legacy bookmark indexes should migrate to stable book IDs');
assert.strictEqual(normalizedBookmarks[0].chapterIdx, 3, 'valid chapter indexes should be preserved');
assert.ok(normalizedBookmarks.every(item => !Object.prototype.hasOwnProperty.call(item, 'bookIdx')), 'migrated bookmarks should not retain deletion-sensitive book indexes');

assert.strictEqual(typeof core.makeSearchSnippet, 'function', 'ReaderCore.makeSearchSnippet should be a function');
assert.strictEqual(core.makeSearchSnippet('甲乙丙丁关键字戊己庚辛', '关键字', 10), '…丙丁关键字戊己庚…', 'search snippets should center and cap matching text');
assert.strictEqual(core.makeSearchSnippet('没有命中的普通文本', '缺失', 8), '没有命中的普通…', 'search snippets should return a capped prefix when no match exists');
assert.strictEqual(typeof core.normalizeParagraphs, 'function', 'ReaderCore.normalizeParagraphs should be a function');
assert.deepStrictEqual(core.normalizeParagraphs(['　　全角缩进', '  空格缩进', '\t制表符缩进', '']), ['全角缩进', '空格缩进', '制表符缩进'], 'paragraph normalization should remove source indentation before CSS applies the fixed two-character indent');
const normalizedPreferences = core.normalizeAppStateDefaults({ books: [], bookmarks: [], settings: {} });
assert.strictEqual(normalizedPreferences.settings.fontFamilyIdx, 0, 'state migration should default to the first reading font');

const app = fs.readFileSync(appPath, 'utf8');
assert.ok(app.includes('class NovelReaderApp'), 'reader-app.js should define the rebuilt app controller');
assert.ok(app.includes('restorePosition'), 'reader-app.js should restore saved reading positions');
assert.ok(app.includes('const committed=await this.openReader'), 'search/bookmark jumps must gate on the committed openReader result');
assert.ok(app.includes('beginRenderIntent'), 'reader-app.js should route every visual request through a render intent');
assert.ok(app.includes('capturePosition'), 'reader-app.js should capture reading positions');
assert.ok(app.includes('requestAnimationFrame'), 'reader-app.js should schedule layout-sensitive work');
assert.ok(app.includes('migrateLegacyInlineChapters'), 'reader-app.js should migrate legacy inline chapters out of app state');
assert.ok(app.includes('delete book.chapters'), 'legacy chapter migration should drop heavyweight inline chapters after saving');
assert.ok(app.includes('chapterCache'), 'reader-app.js should use a bounded chapter cache instead of storing loaded bodies on books');
assert.ok(!app.includes('if(!book.chapters)book.chapters=[]'), 'loadChapter should not recreate heavyweight book.chapters arrays');
['normalizeBookmarks','openSearch','runSearch','renderBookmarks','addBookmarkFromSelection','deleteBook','handleKeyboard','installElectronImport','setFontFamily'].forEach(name => {
  assert.ok(app.includes(`${name}(`), `reader-app.js should implement ${name}()`);
});
['detectFileEncoding','streamFileText','saveChapterBatch','deleteStoredChapters'].forEach(name=>{
  assert.ok(app.includes(`${name}(`), `reader-app.js should implement streaming import helper ${name}()`);
});
assert.ok(app.includes('file.stream()'), 'TXT import should consume File.stream when available');
assert.ok(app.includes('ReaderCore.createChapterParser('), 'TXT import should parse decoded chunks incrementally');
assert.ok(app.includes('detectChapterMode'), 'TXT import should decide numeric chapter mode from the decoded sample');
assert.ok(app.includes('scannedChapters'), 'full-text search should track scanned chapter progress');
assert.ok(app.includes('renderContinuousScrollContent('), 'scroll mode should render a continuous multi-chapter document');
assert.ok(app.includes("event.key==='a'"), 'keyboard navigation should restore A key page-back behavior');
assert.ok(app.includes("event.key==='d'"), 'keyboard navigation should restore D key page-forward behavior');
assert.ok(app.includes('MAX_IMPORT_BYTES'), 'reader-app.js should cap imported file size');
assert.ok(app.includes('tx.onabort'), 'IndexedDB wrapper should reject aborted transactions');

const server = fs.readFileSync(path.join(root, 'scripts', 'serve.js'), 'utf8');
assert.ok(server.includes('ALLOWED_FILES'), 'local server should use an explicit asset allowlist');
assert.ok(server.includes('X-Content-Type-Options'), 'local server should disable MIME sniffing');
assert.ok(server.includes("'config/icon.svg'"), 'local server should allow the icon referenced by the root manifest');

const electronMain = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');
const electronPreload = fs.readFileSync(path.join(root, 'desktop', 'preload.js'), 'utf8');
assert.ok(!electronMain.includes('executeJavaScript'), 'Electron import should not execute generated JavaScript');
assert.ok(electronMain.includes("webContents.send('import-file'"), 'Electron main should send validated TXT content over IPC');
assert.ok(electronPreload.includes('contextBridge.exposeInMainWorld'), 'Electron preload should expose a narrow import bridge');

const webManifest = fs.readFileSync(path.join(root, 'www', 'manifest.json'), 'utf8');
assert.ok(webManifest.includes('"src": "icon.svg"'), 'www manifest should reference its bundled icon asset');

const css = fs.readFileSync(cssPath, 'utf8');
assert.ok(css.includes('--surface'), 'reader-styles.css should use semantic surface tokens');
assert.ok(css.includes('.reader-view'), 'reader-styles.css should style the rebuilt reader shell');
assert.ok(css.includes('@media'), 'reader-styles.css should include responsive rules');
assert.ok(css.includes(':focus-visible'), 'reader-styles.css should provide a keyboard-visible focus state');

console.log('rebuild regression checks passed');
