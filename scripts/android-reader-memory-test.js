'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');

const PACKAGE_ID = 'com.novel.reader';
const DEVICE_ID = process.env.ANDROID_SERIAL || '3dfaa1bf';
const DEBUG_PORT = Number(process.env.READER_CDP_PORT || 9222);
const TEST_BOOK_ID = `__codex_reader_device_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_STATE_KEY = '__codex_reader_device_original_state__';

function adb(args, options = {}) {
  return execFileSync('adb', ['-s', DEVICE_ID, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getPid() {
  const pid = adb(['shell', 'pidof', PACKAGE_ID]).split(/\s+/)[0];
  if (!pid) throw new Error(`Unable to find ${PACKAGE_ID} process on ${DEVICE_ID}`);
  return pid;
}

async function waitForJson(url, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(120);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
    socket.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveMessage, rejectMessage) => pending.set(id, { resolveMessage, rejectMessage }));
        },
        close() {
          try { socket.close(); } catch (error) {}
        }
      });
    });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const callback = pending.get(message.id);
      if (!callback) return;
      pending.delete(message.id);
      if (message.error) callback.rejectMessage(new Error(JSON.stringify(message.error)));
      else callback.resolveMessage(message.result);
    });
    socket.addEventListener('error', reject);
  });
}

async function openClient() {
  adb(['shell', 'monkey', '-p', PACKAGE_ID, '1']);
  await sleep(900);
  const pid = getPid();
  try { adb(['forward', '--remove', `tcp:${DEBUG_PORT}`]); } catch (error) {}
  adb(['forward', `tcp:${DEBUG_PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
  const targets = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const target = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
  if (!target) throw new Error('No debuggable reader WebView page found');
  const client = await connectWebSocket(target.webSocketDebuggerUrl);
  await client.send('Runtime.enable');
  return client;
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
  }
  return result.result && result.result.value;
}

function deviceScript(body) {
  return `(async()=>{${body}})()`;
}

async function cleanup(client) {
  if (!client) return;
  await evaluate(client, deviceScript(`
    const app=window.readerApp;
    const original=JSON.parse(localStorage.getItem(${JSON.stringify(TEST_STATE_KEY)})||'null');
    if(app.currentBookId===${JSON.stringify(TEST_BOOK_ID)})await app.closeReader();
    const testBook=app.state.books.find(book=>book.id===${JSON.stringify(TEST_BOOK_ID)});
    if(testBook){
      const previousConfirm=window.confirm;
      window.confirm=()=>true;
      try{await app.deleteBook(testBook.id);}finally{window.confirm=previousConfirm;}
    }
    if(original&&original.settings){
      app.state.settings=original.settings;
      app.applySettings();
      app.saveState();
    }
    localStorage.removeItem(${JSON.stringify(TEST_STATE_KEY)});
    if(original&&original.bookId&&app.state.books.some(book=>book.id===original.bookId)){
      await app.openReader(original.bookId);
    }else if(app.currentBookId){
      await app.closeReader();
    }
    return {books:app.state.books.length,activeBookId:app.currentBookId||null};
  `));
}

async function run() {
  let client;
  try {
    client = await openClient();
    if (!process.env.SKIP_STORAGE_FALLBACK) {
      const fallback = await evaluate(client, deviceScript(`
      const app=window.readerApp;
      const fallbackBookId='__codex_reader_fallback_'+Date.now();
      const fallbackBook={id:fallbackBookId,chapterCount:1,chapterTitles:['本地后备章节']};
      const originalDb=app.db;
      try{
        app.db=null;
        await app.saveChapters(fallbackBookId,[{title:'本地后备章节',content:'本地后备正文',paragraphs:['本地后备正文']}]);
        app.chapterCache.delete(fallbackBookId+':0');
        const chapter=await app.loadChapter(fallbackBook,0);
        return {title:chapter.title,text:chapter.paragraphs[0]};
      }finally{
        app.db=originalDb;
        localStorage.removeItem('novelReader_chapter_'+fallbackBookId+':0');
      }
    `));
      assert.deepStrictEqual(fallback, { title: '本地后备章节', text: '本地后备正文' }, 'reader should load a chapter from localStorage when IndexedDB is unavailable');
    }

    const setup = await evaluate(client, deviceScript(`
      const app=window.readerApp;
      await app.flushPosition();
      localStorage.setItem(${JSON.stringify(TEST_STATE_KEY)},JSON.stringify({
        bookId:app.currentBookId||null,
        settings:JSON.parse(JSON.stringify(app.state.settings))
      }));
      const chapters=Array.from({length:14},(_,chapterOffset)=>{
        const chapter=chapterOffset+1;
        const paragraphs=Array.from({length:34},(_,paragraphOffset)=>
          '真机验证 第 '+chapter+' 章 第 '+(paragraphOffset+1)+' 段：用于验证连续滚动、进程重启和位置恢复。'.repeat(4)
        );
        return {title:'真机验证 第 '+chapter+' 章',content:paragraphs.join('\\n'),paragraphs};
      });
      const book=app.createBook('Codex 真机临时验证书','自动化测试',chapters,'linear-gradient(145deg,#315d72,#74a0af)');
      book.id=${JSON.stringify(TEST_BOOK_ID)};
      await app.saveChapters(book.id,chapters);
      delete book.chapters;
      app.state.books.push(book);
      app.saveState();
      app.renderLibrary();
      app.state.settings.mode='scroll';
      app.applySettings();
      await app.openReader(book.id);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const headings=[...app.readerContent.querySelectorAll('h1[data-ch]')];
      const initialLastChapter=Number(headings[headings.length-1]&&headings[headings.length-1].dataset.ch);
      return {chapterCount:book.chapterCount,headingCount:headings.length,initialLastChapter};
    `));

    assert.ok(setup.headingCount > 0, 'reader should render an initial chapter window');
    assert.ok(setup.headingCount < setup.chapterCount, 'reader should not render every chapter on initial open');

    const extended = await evaluate(client, deviceScript(`
      const app=window.readerApp;
      const initialLastChapter=${Number(setup.initialLastChapter)};
      app.readerScroll.scrollTop=Math.max(0,app.readerScroll.scrollHeight-app.readerScroll.clientHeight);
      app.readerScroll.dispatchEvent(new Event('scroll'));
      await new Promise(resolve=>setTimeout(resolve,700));
      return !!app.readerContent.querySelector('h1[data-ch="'+(initialLastChapter+1)+'"]');
    `));
    assert.strictEqual(extended, true, 'reader should append the next chapter near the scroll window edge');

    const saved = await evaluate(client, deviceScript(`
      const app=window.readerApp;
      await app.scrollToChapter(6);
      await new Promise(resolve=>setTimeout(resolve,250));
      const paragraph=app.readerContent.querySelector('p[data-ch="6"][data-p="16"]');
      if(!paragraph)throw new Error('target paragraph was not rendered');
      app.readerScroll.scrollTop=Math.max(0,paragraph.offsetTop-24);
      await app.flushPosition();
      const position=app.capturePosition();
      return {chapter:position.chapter,paragraphIndex:position.paragraphIndex};
    `));
    assert.strictEqual(saved.chapter, 6, 'test setup should save chapter 7');
    assert.ok(saved.paragraphIndex >= 14, 'test setup should save a later paragraph');

    client.close();
    client = null;
    adb(['shell', 'input', 'keyevent', 'HOME']);
    await sleep(700);
    adb(['shell', 'am', 'force-stop', PACKAGE_ID]);
    await sleep(700);

    client = await openClient();
    const restored = await evaluate(client, deviceScript(`
      const app=window.readerApp;
      await app.openReader(${JSON.stringify(TEST_BOOK_ID)});
      await new Promise(resolve=>setTimeout(resolve,450));
      const position=app.capturePosition();
      return {chapter:position.chapter,paragraphIndex:position.paragraphIndex};
    `));
    assert.strictEqual(restored.chapter, saved.chapter, 'force-stop/reopen should restore the saved chapter');
    assert.ok(restored.paragraphIndex >= saved.paragraphIndex-2, 'force-stop/reopen should restore the saved paragraph');

    const pageBoundary = await evaluate(client, deviceScript(`
      const app=window.readerApp;
      app.state.settings.mode='page';
      app.currentChapter=1;
      app.currentPage=0;
      app.applySettings();
      await app.renderReader();
      const expectedPage=Math.max(0,app.pages.length-1);
      await app.stepBack();
      return {chapter:app.currentChapter,currentPage:app.currentPage,expectedPage};
    `));
    assert.strictEqual(pageBoundary.chapter, 0, 'previous from a chapter start should enter the previous chapter');
    assert.strictEqual(pageBoundary.currentPage, pageBoundary.expectedPage, 'previous from a chapter start should land on the previous chapter’s last page');
    console.log(`Android reader memory test passed on ${DEVICE_ID}: chapter ${restored.chapter + 1}, paragraph ${restored.paragraphIndex + 1}`);
  } finally {
    try { await cleanup(client); } catch (error) { console.error('device test cleanup failed:', error.message); }
    try { adb(['forward', '--remove', `tcp:${DEBUG_PORT}`]); } catch (error) {}
    if (client) client.close();
  }
}

run().catch(error => {
  console.error(error && (error.stack || error.message) || error);
  process.exitCode = 1;
});
