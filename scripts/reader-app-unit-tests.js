const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '..');
const core = require(path.join(root, 'reader-core.js'));

function createElement(){
  const classes=new Set();
  return {
    inert:false,
    classList:{
      add(...names){names.forEach(name=>classes.add(name));},
      remove(...names){names.forEach(name=>classes.delete(name));},
      contains(name){return classes.has(name);},
      toggle(name,force){
        const enabled=force===undefined?!classes.has(name):!!force;
        if(enabled)classes.add(name);else classes.delete(name);
        return enabled;
      }
    },
    setAttribute(){},
    getAttribute(){return null;}
  };
}

const elements=new Map();
global.ReaderCore=core;
global.window={ReaderCore:core};
global.document={
  addEventListener(){},
  getElementById(id){
    if(!elements.has(id))elements.set(id,createElement());
    return elements.get(id);
  }
};
global.requestAnimationFrame=callback=>setImmediate(callback);

const localData=new Map();
global.localStorage={
  getItem(key){return localData.has(key)?localData.get(key):null;},
  setItem(key,value){localData.set(key,String(value));},
  removeItem(key){localData.delete(key);}
};

require(path.join(root, 'reader-app.js'));

(async()=>{
  const App=window.NovelReaderApp;
  assert.strictEqual(typeof App,'function','NovelReaderApp should be exposed for non-browser unit tests');
  const app=new App();
  app.db=null;

  const bookId='unit-book';
  const chapters=[
    {title:'第一章',content:'第一段',paragraphs:['第一段']},
    {title:'第二章',content:'第二段',paragraphs:['第二段']}
  ];
  await app.saveChapterBatch(bookId,chapters,3);
  assert.ok(localStorage.getItem(app.chapterStorageKey(bookId,3)),'fallback batch should preserve its start index');
  const loaded=await app.loadChapter({id:bookId,chapterTitles:['','','','第一章','第二章']},3);
  assert.strictEqual(loaded.paragraphs[0],'第一段','fallback chapter should load after the cache is empty');
  await app.deleteStoredChapters(bookId,5);
  assert.strictEqual(localStorage.getItem(app.chapterStorageKey(bookId,3)),null,'partial import cleanup should remove fallback chapters');

  const utf8File=new File(['序言\r\n第一章 开始\r\n正文内容'],'测试.txt',{type:'text/plain'});
  assert.strictEqual(await app.detectFileEncoding(utf8File),'utf-8','valid UTF-8 should remain UTF-8');
  let decoded='';
  await app.streamFileText(utf8File,'utf-8',async text=>{decoded+=text;});
  assert.strictEqual(decoded,'序言\r\n第一章 开始\r\n正文内容','streaming decode should preserve the complete UTF-8 text');

  const gbkBytes=[];
  for(let index=0;index<24;index++)gbkBytes.push(0xD6,0xD0,0xCE,0xC4);
  const gbkFile=new File([new Uint8Array(gbkBytes)],'gbk.txt',{type:'text/plain'});
  const detectedEncoding=await app.detectFileEncoding(gbkFile);
  assert.ok(detectedEncoding==='gbk'||detectedEncoding==='gb18030','replacement-heavy UTF-8 samples should select GBK family, got '+detectedEncoding);
  let gbkText='';
  await app.streamFileText(gbkFile,detectedEncoding,async text=>{gbkText+=text;});
  assert.ok(gbkText.startsWith('中文中文'),'GBK streaming decode should produce Chinese text');

  const utf16leBytes=[0xFF,0xFE,0x2D,0x4E,0x8B,0x6B,0x01,0x00];
  const utf16File=new File([new Uint8Array(utf16leBytes)],'utf16.txt',{type:'text/plain'});
  assert.strictEqual(await app.detectFileEncoding(utf16File),'utf-16le','UTF-16LE BOM should select UTF-16LE');
  let utf16Text='';
  await app.streamFileText(utf16File,'utf-16le',async text=>{utf16Text+=text;});
  assert.ok(utf16Text.includes('中'),'UTF-16LE streaming decode should produce Chinese text');

  const utf16beBytes=[0xFE,0xFF,0x4E,0x2D,0x6B,0x8B,0x00,0x01];
  const utf16beFile=new File([new Uint8Array(utf16beBytes)],'utf16be.txt',{type:'text/plain'});
  const beEncoding=await app.detectFileEncoding(utf16beFile);
  assert.ok(beEncoding==='utf-16be'||beEncoding==='utf-16le','UTF-16BE BOM should be recognised, got '+beEncoding);

  const defaults=ReaderCore.normalizeAppStateDefaults({books:[],bookmarks:[],settings:{}});
  assert.strictEqual(defaults.settings.brightness,1,'state defaults should enable full brightness');
  assert.strictEqual(defaults.settings.nightMode,'off','state defaults should keep night mode manual');
  assert.strictEqual(ReaderCore.isNightTime(new Date(2026,0,1,22)),true,'22:00 should be night time');
  assert.strictEqual(ReaderCore.isNightTime(new Date(2026,0,1,6)),true,'06:00 should be night time');
  assert.strictEqual(ReaderCore.isNightTime(new Date(2026,0,1,12)),false,'noon should not be night time');
  assert.strictEqual(ReaderCore.normalizeAppStateDefaults({books:[],bookmarks:[],settings:{brightness:0.1}}).settings.brightness,0.4,'brightness should clamp to the readable minimum');
  assert.strictEqual(ReaderCore.normalizeAppStateDefaults({books:[],bookmarks:[],settings:{nightMode:'bad'}}).settings.nightMode,'off','invalid night mode should fall back to manual');

  console.log('reader app unit checks passed');
})().catch(error=>{
  console.error(error&&error.stack||error);
  process.exitCode=1;
});
