'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const core = require(path.join(root, 'reader-core.js'));

function runParserFixtures() {
  // standard headers: digits, spaced numbers, uppercase numerals, 番外, 第N篇/幕 and special headings
  const standard = core.parseChaptersFromText(
    '序言内容\n第一章 初见\n第一段\n第二章 重逢\n第二段\n第 2 章 空格\n第三段\n第两千章 大写\n第四段\n番外 冬日\n第五段\n第一篇 卷首\n第六段\n第一幕 风起\n第七段\n第 2 幕 云涌\n第八段\n序 章 学院\n第九段\n尾 声 归途\n第十段\n第一幕的内容是人物介绍。\n第一章的内容是人物介绍。\n这句是正文。\n'
  );
  const titles = standard.map(ch => ch.title);
  assert.deepStrictEqual(titles, ['序', '第一章 初见', '第二章 重逢', '第 2 章 空格', '第两千章 大写', '番外 冬日', '第一篇 卷首', '第一幕 风起', '第 2 幕 云涌', '序 章 学院', '尾 声 归途'], 'standard headers incl. spaces/uppercase/番外/篇/幕/special headings must parse; 误切句 must stay in content');
  const lastChapter = standard[standard.length - 1];
  assert.ok(lastChapter.content.includes('第一章的内容是人物介绍。'), '第一章的内容是人物介绍。 must remain body text');
  assert.ok(lastChapter.content.includes('第一幕的内容是人物介绍。'), '第一幕的内容是人物介绍。 must remain body text');
  assert.ok(!lastChapter.content.includes('第一章 初见'), 'chapter titles must not leak into body');

  const volumes = core.parseChaptersFromText(
    '第一卷\n第一章 开始\n卷一正文\n第二章 继续\n卷二正文\n第二卷\n第一章 重来\n卷二正文\n'
  );
  assert.deepStrictEqual(volumes.map(ch => ch.title), ['第一章 开始', '第二章 继续', '第一章 重来'], 'volume->chapter with no body must not create empty chapters');
  assert.strictEqual(volumes.some(ch => !ch.content), false, 'no empty chapters allowed');

  // high-confidence numeric mode (auto-detect)
  const numericText = Array.from({ length: 12 }, (_, i) => `${i + 1}、第${i + 1}节标题\n第${i + 1}节正文内容。`).join('\n');
  assert.strictEqual(core.detectChapterMode(numericText), true, '>=10 strictly increasing numeric candidates enable numeric mode');
  const numericParsed = core.parseChaptersFromText(numericText);
  assert.strictEqual(numericParsed.length, 12, 'numeric mode should split every numbered heading');
  assert.ok(numericParsed.every(ch => !/^第\d+节正文/.test(ch.title)), 'numeric mode must not swallow body into titles');

  // low-confidence enumeration stays body
  const lowConfidence = core.parseChaptersFromText('开头\n1、只有一条\n2、两条\n3、三条\n结尾正文');
  assert.strictEqual(lowConfidence.length, 1, 'low-confidence enumeration must not become chapters');
  assert.ok(lowConfidence[0].content.includes('1、只有一条'), 'low-confidence numbers remain body');

  // repeated/regressive numeric ids inside a volume are body
  const regressive = core.createChapterParser({ numericMode: true });
  const regressiveChapters = [...regressive.push('第一卷\n1、标题一\n正文一\n1、重复编号\n这是正文\n2、标题二\n正文二\n'), ...regressive.finish()];
  assert.deepStrictEqual(regressiveChapters.map(ch => ch.title), ['1、标题一', '2、标题二'], 'volume header directly followed by a chapter must not create an empty chapter; repeated numeric id stays body');
  assert.ok(regressiveChapters[0].content.includes('这是正文'), 'regressive line must stay in the current chapter body');

  // chunked parse with CRLF must match whole-text parse (standard + numeric)
  const standardSource = '序言内容\r\n第一章 初见\r\n第一段\r\n第二章 再见\r\n结尾';
  const chunks = ['序言', '内容\r', '\n第', '一章 初见\r\n第一段\r', '\n第二章 再见\r\n结', '尾'];
  const chunkParser = core.createChapterParser();
  const chunked = [];
  chunks.forEach(c => chunked.push(...chunkParser.push(c)));
  chunked.push(...chunkParser.finish());
  assert.deepStrictEqual(chunked, core.parseChaptersFromText(standardSource), 'chunked standard parse must match whole-text');

  const numericSource = Array.from({ length: 10 }, (_, i) => `${i + 1}、标题${i + 1}\n内容${i + 1}`).join('\r\n');
  const numericChunks = ['1、', '标题1\r\n内容1\r\n2、标题', '2\r\n内容2\r\n3、标题3\r\n内容3\r\n4、标题4\r\n内容4\r\n5、标题5\r\n内容5\r\n6、标题6\r\n内容6\r\n7、标题7\r\n内容7\r\n8、标题8\r\n内容8\r\n9、标题9\r\n内容9\r\n10、标题10\r\n内容10'];
  const numericChunkParser = core.createChapterParser({ numericMode: true });
  const numericChunked = [];
  numericChunks.forEach(c => numericChunked.push(...numericChunkParser.push(c)));
  numericChunked.push(...numericChunkParser.finish());
  assert.deepStrictEqual(numericChunked, core.parseChaptersFromText(numericSource, { numericMode: true }), 'chunked numeric parse must match whole-text');

  // grapheme fallback (Segmenter disabled)
  const originalSegmenter = Intl && Intl.Segmenter;
  try {
    if (originalSegmenter) Intl.Segmenter = undefined;
    const zwjText = 'a👩‍💻b🏳️‍🌈c👨🏽d𠮷eé\u0301f';
    const parts = core.segmentGraphemes(zwjText);
    assert.deepStrictEqual(parts.join(''), zwjText, 'fallback graphemes must rejoin to the source');
    assert.ok(!parts.some(p => p === '👩' && parts[parts.indexOf('👩') + 1] === '‍'), 'ZWJ sequences must not be split');
    const flagIndex = parts.findIndex(p => p.includes('🏳️‍🌈'));
    assert.ok(flagIndex >= 0 && parts[flagIndex].length === '🏳️‍🌈'.length, 'ZWJ flag sequence must stay whole');
    const skinIndex = parts.findIndex(p => p.includes('👨🏽'));
    assert.ok(skinIndex >= 0 && parts[skinIndex].length === '👨🏽'.length, 'skin-tone emoji must stay whole');
    const extIndex = parts.findIndex(p => p.includes('𠮷'));
    assert.ok(extIndex >= 0 && parts[extIndex].length === '𠮷'.length, 'astral chars must not be split into surrogates');
    const combiningIndex = parts.findIndex(p => p.includes('é\u0301'));
    assert.ok(combiningIndex >= 0 && parts[combiningIndex].length === 'é\u0301'.length, 'combining marks must stay attached');
  } finally {
    if (originalSegmenter) Intl.Segmenter = originalSegmenter;
  }
}

runParserFixtures();
console.log('reading layout: parser fixtures + grapheme fallback passed');

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
  const longPara = (prefix, i) => prefix + ' 长段落' + (i + 1) + '：这是一段足够长的中文正文，用来验证真实测量分页在页尾按完整行切断并且不会丢失任何一个字符。'.repeat(4);
  const paragraphs = [];
  for (let i = 0; i < 40; i++) paragraphs.push(longPara('正文', i));
  paragraphs.push('带 emoji 的段落 👨‍👩‍👧‍👦 和肤色 👍🏽 以及扩展汉字 𠮷野家 与组合音标 é\u0301 结尾。');
  paragraphs.push('短句。');
  paragraphs.push('另一段很长很长的中文句子，用来确认分页测量在多个字号和视口下都能保持行尾完整且不溢出。'.repeat(8));
  const chapters = [0, 1, 2].map(idx => ({
    title: '第' + (idx + 1) + '章 长文',
    content: paragraphs.map(p => '第' + (idx + 1) + '章 ' + p).join('\n'),
    paragraphs: paragraphs.map(p => '第' + (idx + 1) + '章 ' + p)
  }));

  window.__layoutCheck = async () => {
    const app = window.readerApp;
    const errors = [];
    const book = app.createBook('排版测试书', '测试', chapters, 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books = [book];
    await app.saveChapters(book.id, chapters);
    delete book.chapters;
    app.state.settings.mode = 'page';
    app.state.settings.lineHeightIdx = 2;
    app.saveState();
    app.renderLibrary();
    await app.openReader(book.id);
    await wait(120);
    app.currentChapter = 1;
    app.currentPage = 0;
    for (const fontSize of [14, 18, 28]) {
      app.state.settings.fontSize = fontSize;
      app.applySettings();
      await app.renderReader({ chapter: 1, paragraphIndex: 0, readingMode: 'page' });
      await wait(80);
      const pageEls = [...app.readerContent.querySelectorAll('.page')];
      if (!pageEls.length) { errors.push('size ' + fontSize + ': no pages rendered'); continue; }
      const sourceChapter = await app.loadChapter(book, 1);
      const sourceParas = ReaderCore.normalizeParagraphs(sourceChapter.paragraphs);
      const byParagraph = new Map();
      let rebuilt = '';
      const seenTitles = [];
      for (const pageEl of pageEls) {
        const inner = pageEl.querySelector('.page-inner');
        if (inner && inner.scrollHeight > inner.clientHeight + 1) {
          errors.push('size ' + fontSize + ': page ' + pageEl.dataset.page + ' overflow ' + inner.scrollHeight + '>' + inner.clientHeight);
        }
        const headings = [...pageEl.querySelectorAll('.page-inner h1')];
        headings.forEach(h => { seenTitles.push(h.textContent); rebuilt += h.textContent; });
        const ps = [...pageEl.querySelectorAll('.page-inner p')];
        for (const p of ps) {
          const para = Number(p.dataset.p);
          const start = Number(p.dataset.start);
          const end = Number(p.dataset.end);
          const blockText = p.textContent;
          const isContinued = p.classList.contains('continued');
          const isContinues = p.classList.contains('continues');
          if (isContinued) {
            const indent = getComputedStyle(p).textIndent;
            if (indent !== '0px') errors.push('size ' + fontSize + ': continued block must have text-indent 0, got ' + indent);
          }
          if (isContinues) {
            const margin = getComputedStyle(p).marginBottom;
            if (margin !== '0px') errors.push('size ' + fontSize + ': continues block must have margin-bottom 0, got ' + margin);
          }
          const realStart = isContinued || start > 0;
          if ((start > 0) !== isContinued) errors.push('size ' + fontSize + ': continued class must equal start>0 for para ' + para);
          if ((end < sourceParas[para].length) !== isContinues) errors.push('size ' + fontSize + ': continues class must equal end<length for para ' + para);
          if (isContinued && start === 0) errors.push('size ' + fontSize + ': a continued block must not start the paragraph at 0');
          if (!byParagraph.has(para)) byParagraph.set(para, []);
          byParagraph.get(para).push({ start, end, text: blockText });
          const source = sourceParas[para];
          if (blockText !== source.slice(start, end)) {
            errors.push('size ' + fontSize + ': block text must equal paragraph.slice(start,end) for para ' + para + ' [' + start + ',' + end + ')');
          }
          const expectedEnd = start + blockText.length;
          if (end !== expectedEnd) errors.push('size ' + fontSize + ': block end must equal start + text length for para ' + para);
          rebuilt += blockText;
        }
      }
      const expected = sourceChapter.title + sourceParas.join('');
      if (rebuilt !== expected) {
        let diffAt = -1;
        for (let i = 0; i < Math.min(rebuilt.length, expected.length); i++) {
          if (rebuilt[i] !== expected[i]) { diffAt = i; break; }
        }
        const ctx = (str, at) => JSON.stringify(str.slice(Math.max(0, at - 12), at + 12));
        errors.push('size ' + fontSize + ': text mismatch at ' + diffAt + ' rebuilt=' + ctx(rebuilt, diffAt) + ' expected=' + ctx(expected, diffAt));
      }
      if (seenTitles.filter(t => t === sourceChapter.title).length !== 1) {
        errors.push('size ' + fontSize + ': chapter title must appear exactly once');
      }
      for (const [para, blocks] of byParagraph.entries()) {
        const source = sourceParas[para];
        if (blocks[0].start !== 0) errors.push('size ' + fontSize + ': paragraph ' + para + ' must start at 0, got ' + blocks[0].start);
        for (let i = 1; i < blocks.length; i++) {
          if (blocks[i - 1].end !== blocks[i].start) {
            errors.push('size ' + fontSize + ': paragraph ' + para + ' offsets must be continuous: ' + blocks[i - 1].end + ' -> ' + blocks[i].start);
          }
        }
        if (blocks[blocks.length - 1].end !== source.length) {
          errors.push('size ' + fontSize + ': paragraph ' + para + ' must end at its length ' + source.length + ', got ' + blocks[blocks.length - 1].end);
        }
        for (const block of blocks) {
          const gs = ReaderCore.segmentGraphemes(source.slice(0, block.end));
          if (gs.join('') !== source.slice(0, block.end)) {
            errors.push('size ' + fontSize + ': paragraph ' + para + ' cut [' + block.start + ',' + block.end + ') must land on a grapheme boundary');
          }
          if (block.end < source.length) {
            const closing = '，。！？；：、）》】』」〕〉］｝”’〗〙〛)]}';
            const nextChar = source.charAt(block.end);
            if (closing.includes(nextChar)) {
              errors.push('size ' + fontSize + ': paragraph ' + para + ' page break must not leave a closing punctuation at the next page start: ' + JSON.stringify(nextChar));
            }
          }
        }
      }
      for (const pageEl of pageEls.slice(0, pageEls.length - 1)) {
        const ps = [...pageEl.querySelectorAll('.page-inner p')];
        const lastP = ps[ps.length - 1];
        if (!lastP || !lastP.classList.contains('continues')) continue;
        const para = Number(lastP.dataset.p);
        const end = Number(lastP.dataset.end);
        const source = sourceParas[para];
        const nextGraphemes = ReaderCore.segmentGraphemes(source.slice(end));
        if (!nextGraphemes.length) continue;
        const nextGrapheme = nextGraphemes[0];
        const CLOSING = '，。！？；：、）》】』」〕〉］｝”’〗〙〛)]}';
        const probeAppend = suffix => {
          const probePage = document.createElement('div');
          probePage.className = 'page';
          const probeInner = document.createElement('div');
          probeInner.className = 'page-inner';
          probePage.appendChild(probeInner);
          probePage.style.cssText = 'position:absolute;left:-9999px;top:0;width:' + app.getReaderPageWidth() + 'px;height:' + app.readerScroll.clientHeight + 'px;';
          app.reader.appendChild(probePage);
          pageEl.querySelectorAll('.page-inner h1, .page-inner p').forEach(el => {
            const clone = document.createElement(el.tagName.toLowerCase());
            clone.className = el.className;
            clone.textContent = el.textContent;
            probeInner.appendChild(clone);
          });
          const clones = probeInner.querySelectorAll('p');
          clones[clones.length - 1].textContent += suffix;
          const overflow = probeInner.scrollHeight > probeInner.clientHeight;
          probePage.remove();
          return overflow;
        };
        if (probeAppend(nextGrapheme)) continue;
        const nextNext = nextGraphemes.length > 1 ? nextGraphemes[1] : '';
        if (CLOSING.includes(nextNext)) continue;
        errors.push('size ' + fontSize + ': page ' + pageEl.dataset.page + ' must be tight at a browser line end (para=' + para + ' end=' + end + ' next=' + JSON.stringify(nextGrapheme) + ' rendered=' + pageEl.querySelector('.page-inner').scrollHeight + '/' + pageEl.querySelector('.page-inner').clientHeight);
      }
      app.currentChapter = 1;
      app.currentPage = 0;
      app.setChromeVisible(true);
      await app.renderReader({ chapter: 1, paragraphIndex: 0, readingMode: 'page' });
      await wait(80);
      const visibleHeights = [...app.readerContent.querySelectorAll('.page .page-inner')].map(el => el.clientHeight);
      app.setChromeVisible(false);
      await wait(80);
      const hiddenHeights = [...app.readerContent.querySelectorAll('.page .page-inner')].map(el => el.clientHeight);
      if (JSON.stringify(visibleHeights) !== JSON.stringify(hiddenHeights)) {
        errors.push('size ' + fontSize + ': page-inner height must not change with chrome visibility: ' + JSON.stringify(visibleHeights) + ' vs ' + JSON.stringify(hiddenHeights));
      }
      let hiddenRebuilt = '';
      for (const pageEl of app.readerContent.querySelectorAll('.page')) {
        const inner = pageEl.querySelector('.page-inner');
        if (inner && inner.scrollHeight > inner.clientHeight + 1) {
          errors.push('size ' + fontSize + ': hidden-chrome page ' + pageEl.dataset.page + ' overflow ' + inner.scrollHeight + '>' + inner.clientHeight);
        }
        const headings = pageEl.querySelectorAll('.page-inner h1');
        headings.forEach(h => { hiddenRebuilt += h.textContent; });
        pageEl.querySelectorAll('.page-inner p').forEach(p => { hiddenRebuilt += p.textContent; });
      }
      if (hiddenRebuilt !== expected) {
        errors.push('size ' + fontSize + ': hidden-chrome text reconstruction mismatch');
      }
      app.setChromeVisible(true);
      await wait(50);
    }
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
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-layout-profile-'));
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
      const result = await client.send('Runtime.evaluate', { expression: 'typeof window.__layoutCheck === "function"', returnByValue: true });
      if (result.result && result.result.value) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.ok(ready, 'harness did not load');
    const results = [];
    for (const [width, height] of sizes) {
      await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await new Promise(resolve => setTimeout(resolve, 400));
      const res = await client.send('Runtime.evaluate', { expression: 'window.__layoutCheck()', awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) {
        const ex = res.exceptionDetails.exception || {};
        results.push({ width, height, ok: false, errors: ['check threw: ' + String(ex.description || ex.value || JSON.stringify(ex)).slice(0, 400)] });
        continue;
      }
      results.push({ width, height, ...res.result && res.result.value });
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-layout-'));
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
    for (const result of results) {
      if (!result.ok) {
        failures.push('layout ' + result.width + 'x' + result.height + ': ' + JSON.stringify(result.errors).slice(0, 1200));
      }
    }
    if (failures.length) {
      throw new Error('Reading layout regression failed:\n' + failures.join('\n'));
    }
    console.log('reading layout: real-measure pagination passed across 320x568 / 390x844 / 844x390 x 14/18/28px');
  } finally {
    server.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
