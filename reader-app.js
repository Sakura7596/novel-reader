(function(){
  'use strict';

  const DB_NAME='novelReaderDB';
  const DB_VERSION=7;
  const TRASH_PREFIX='novelReader_trash_';
  const TRASH_RETENTION_MS=30*24*60*60*1000;
  const STATE_KEY='novelReaderState';
  const POSITION_PREFIX='novelReader_position_';
  const CHAPTER_PREFIX='novelReader_chapter_';
  const THEMES=[
    {name:'纸页',bg:'#f3ead7',text:'#2b251d',dot:'#f3ead7'},
    {name:'月白',bg:'#f7f7f2',text:'#20211f',dot:'#f7f7f2'},
    {name:'护眼',bg:'#dfe9d5',text:'#263023',dot:'#dfe9d5'},
    {name:'夜读',bg:'#151515',text:'#d8d1c8',dot:'#151515'},
    {name:'雾灰',bg:'#eef0f3',text:'#283039',dot:'#eef0f3'}
  ];
  const FONT_FAMILIES=[
    'Georgia,"Noto Serif SC","Source Han Serif SC","Songti SC",serif',
    '-apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif',
    '"KaiTi","STKaiti","Noto Serif SC",serif'
  ];
  const LINE_HEIGHTS=[1.5,1.64,1.82];
  const PAGE_GUTTERS=[18,24,32];
  const MAX_IMPORT_BYTES=100*1024*1024;
  const MAX_SEARCH_RESULTS=100;
  const ENCODING_SAMPLE_BYTES=256*1024;
  const IMPORT_BATCH_SIZE=8;
  const SCROLL_WINDOW_BEFORE=2;
  const SCROLL_WINDOW_AFTER=3;
  const SCROLL_WINDOW_STEP=2;
  const SCROLL_WINDOW_MAX=8;

  class NovelReaderApp{
    constructor(){
      this.$=id=>document.getElementById(id);
      this.db=null;
      this.storageFallback=false;
      this.state=ReaderCore.normalizeAppStateDefaults({books:[],bookmarks:[],settings:{mode:'page',fontSize:18,lineHeightIdx:1,marginIdx:1,themeIdx:0,fontFamilyIdx:0,pageAnimation:'slide'},sortMode:'recent'});
      this.currentBookId=null;
      this.currentChapter=0;
      this.currentPage=0;
      this.pages=[];
      this.chapterCache=new Map();
      this.scrollWindowStart=0;
      this.scrollWindowEnd=-1;
      this.scrollRenderToken=0;
      this.scrollWindowBusy=false;
      this.saveTimer=null;
      this.chromeTimer=null;
      this.chromeVisible=true;
      this.pointerStart=null;
      this.touchStart=null;
      this.suppressNextClick=false;
      this.suppressClickUntil=0;
      this.suppressBookClickUntil=0;
      this.suppressedBookClickId=null;
      this.bookPress=null;
      this.selectedBookActionId=null;
      this.selectedText=null;
      this.searchRunId=0;
      this.scrollRaf=0;
      this.markerCache=null;
      this.statTimer=null;
      this.deleteArmedUntil=0;
      this.armedBookId=null;
      this.trashEntries=[];
      this.autoScrollTimer=null;
      this.pinchStart=null;
      this.lastPinchTime=0;
      this.zoomScaleOverride=undefined;
      this.navChain=Promise.resolve();
      this.navGeneration=0;
      this.renderEpoch=0;
      this.importBusy=false;
      this.purgeArmedId=null;
      this.purgeArmedUntil=0;
      this.stateWriteChain=Promise.resolve();
      this.persistDegraded=false;
      this.systemDarkQuery=null;
      this.bindDom();
    }

    bindDom(){
      this.library=this.$('library-view');
      this.reader=this.$('reader-view');
      this.readerScroll=this.$('reader-scroll');
      this.readerContent=this.$('reader-content');
      this.bookGrid=this.$('book-grid');
      this.emptyState=this.$('empty-state');
      this.fileInput=this.$('file-input');
      this.toastEl=this.$('toast');
      this.scrim=this.$('scrim');
      this.settingsSheet=this.$('settings-sheet');
      this.tocSheet=this.$('toc-sheet');
      this.tocList=this.$('toc-list');
      this.pageIndicator=this.$('page-indicator');
      this.searchPanel=this.$('search-panel');
      this.searchInput=this.$('search-input');
      this.searchResults=this.$('search-results');
      this.bookmarksPanel=this.$('bookmarks-panel');
      this.bookmarksList=this.$('bookmarks-list');
      this.bookActions=this.$('book-actions');
      this.selectionBubble=this.$('selection-bubble');
      this.brightnessOverlay=this.$('brightness-overlay');
      this.readerClock=this.$('reader-clock');
      this.tocFilter=this.$('toc-filter');
      this.libraryMenu=this.$('library-menu');
      this.backupInput=this.$('backup-input');
      this.todayStats=this.$('today-stats');
      this.brightnessRange=this.$('brightness-range');
      this.trashPanel=this.$('trash-panel');
      this.trashList=this.$('trash-list');
      this.syncVisibilityState();
    }

    async init(){
      try{await this.openDB();}
      catch(error){this.storageFallback=true;console.warn('IndexedDB unavailable; using localStorage fallback',error);}
      await this.loadState();
      await this.ensureDemoBook();
      this.applySettings();
      this.renderLibrary();
      this.bindEvents();
      this.installAndroidBackHandling();
      this.installElectronImport();
      this.startStatTracking();
      this.installNightModeListener();
      this.startClock();
      this.refreshTrash();
      if(this.storageFallback)this.showToast('IndexedDB 不可用，已启用受限本地存储');
    }

    startClock(){
      const tick=()=>{
        if(this.readerClock){
          const now=new Date();
          this.readerClock.textContent=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        }
      };
      tick();
      clearInterval(this.clockTimer);
      this.clockTimer=setInterval(tick,30000);
    }

    installNightModeListener(){
      this.lastAppliedThemeIdx=this.effectiveThemeIdx();
      const tick=()=>{if(this.state.settings.nightMode!=='off')this.syncNightTheme();};
      if(window.matchMedia){
        this.systemDarkQuery=window.matchMedia('(prefers-color-scheme: dark)');
        const onChange=()=>{if(this.state.settings.nightMode==='system')this.syncNightTheme();};
        if(this.systemDarkQuery.addEventListener)this.systemDarkQuery.addEventListener('change',onChange);
        else if(this.systemDarkQuery.addListener)this.systemDarkQuery.addListener(onChange);
      }
      this.nightModeCheckTimer=setInterval(tick,60*1000);
      document.addEventListener('visibilitychange',()=>{
        if(!document.hidden)this.syncNightTheme();
      });
    }

    syncNightTheme(now){
      if(this.state.settings.nightMode==='off')return;
      const themeIdx=this.effectiveThemeIdx(now);
      if(themeIdx===this.lastAppliedThemeIdx)return;
      this.lastAppliedThemeIdx=themeIdx;
      this.applySettings(themeIdx);
    }

    effectiveThemeIdx(now){
      const mode=this.state.settings.nightMode;
      const night=mode==='timer'?ReaderCore.isNightTime(now):(mode==='system'?!!(this.systemDarkQuery&&this.systemDarkQuery.matches):false);
      return night?3:this.state.settings.themeIdx;
    }

    startStatTracking(){
      this.lastStatTick=Date.now();
      this.statAccumMs=0;
      clearInterval(this.statTimer);
      this.statTimer=setInterval(()=>{
        const now=Date.now();
        const elapsed=now-this.lastStatTick;
        this.lastStatTick=now;
        if(!document.hidden&&this.reader&&this.reader.classList.contains('active')){
          this.statAccumMs=(this.statAccumMs||0)+elapsed;
          if(this.statAccumMs>=60000){
            const minutes=Math.floor(this.statAccumMs/60000);
            this.statAccumMs-=minutes*60000;
            this.addReadingMinutes(minutes);
          }
        }
      },30000);
      this.renderTodayStats();
    }

    addReadingMinutes(minutes){
      const stats=this.state.stats||{date:null,minutes:0,totalMinutes:0};
      const today=new Date();
      const todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      if(stats.date!==todayKey){
        stats.date=todayKey;
        stats.minutes=0;
      }
      stats.minutes=(stats.minutes||0)+minutes;
      stats.totalMinutes=(stats.totalMinutes||0)+minutes;
      this.saveState();
      this.renderTodayStats();
    }

    renderTodayStats(){
      const el=this.todayStats;
      if(!el)return;
      const stats=this.state.stats||{};
      if(stats.minutes>0&&stats.date){
        el.textContent=`今日 ${stats.minutes} 分钟`;
        el.classList.remove('hidden');
      }else el.classList.add('hidden');
    }

    openDB(){
      if(this.db)return Promise.resolve(this.db);
      return new Promise((resolve,reject)=>{
        const req=indexedDB.open(DB_NAME,DB_VERSION);
        req.onupgradeneeded=e=>{
          const db=e.target.result;
          ['state','chapters','positions','trash'].forEach(name=>{if(!db.objectStoreNames.contains(name))db.createObjectStore(name);});
        };
        req.onsuccess=e=>{this.db=e.target.result;resolve(this.db);};
        req.onerror=e=>reject(e.target.error);
      });
    }

    idb(store,mode,fn){
      if(!this.db)return Promise.reject(new Error('IndexedDB unavailable'));
      return new Promise((resolve,reject)=>{
        let tx;
        let result;
        try{
          tx=this.db.transaction(store,mode);
          result=fn(tx.objectStore(store));
        }catch(error){reject(error);return;}
        tx.oncomplete=()=>resolve(result&&result.result);
        tx.onerror=e=>reject(e.target.error||tx.error);
        tx.onabort=e=>reject(e.target.error||tx.error||new Error('IndexedDB transaction aborted'));
      });
    }

    chapterStorageKey(bookId,index){
      return `${CHAPTER_PREFIX}${bookId}:${index}`;
    }

    async loadState(){
      let idbState=null,localState=null;
      if(this.db){try{idbState=await this.idb('state','readonly',s=>s.get(STATE_KEY));}catch(e){}}
      try{localState=JSON.parse(localStorage.getItem(STATE_KEY)||'null');}catch(e){}
      let saved=null;
      if(idbState&&localState){
        const idbRev=Number(idbState.revision)||0;
        const localRev=Number(localState.revision)||0;
        saved=idbRev>=localRev?idbState:localState;
      }else saved=idbState||localState;
      if(saved){
        this.state=ReaderCore.normalizeAppStateDefaults(saved);
        this.state.books.forEach(book=>{
          book.chapterCount=book.chapterCount||(book.chapterTitles&&book.chapterTitles.length)||0;
          book.chapterTitles=book.chapterTitles||[];
        });
        this.normalizeBookmarks();
        await this.migrateLegacyInlineChapters();
      }
    }

    normalizeBookmarks(){
      const normalized=ReaderCore.normalizeBookmarks(this.state.bookmarks,this.state.books);
      const changed=JSON.stringify(normalized)!==JSON.stringify(this.state.bookmarks||[]);
      this.state.bookmarks=normalized;
      if(changed)this.saveState();
    }

    async migrateLegacyInlineChapters(){
      let changed=false;
      for(const book of this.state.books){
        const chapters=Array.isArray(book.chapters)?book.chapters.filter(Boolean):[];
        if(!chapters.length)continue;
        book.chapterTitles=book.chapterTitles&&book.chapterTitles.length?book.chapterTitles:chapters.map(ch=>ch.title);
        book.chapterCount=book.chapterCount||chapters.length;
        await this.saveChapters(book.id,chapters);
        delete book.chapters;
        changed=true;
      }
      if(changed)this.saveState();
    }

    saveState(){
      const revision=(Number(this.state.revision)||0)+1;
      this.state.revision=revision;
      const light={
        ...this.state,
        revision,
        books:this.state.books.map(book=>({
          id:book.id,title:book.title,author:book.author,coverBg:book.coverBg,
          chapterCount:book.chapterCount,chapterTitles:book.chapterTitles,
          progress:book.progress||0,readingPosition:book.readingPosition||null,lastRead:book.lastRead||0
        }))
      };
      const serialized=JSON.stringify(light);
      const promise=this.persistState(light,serialized);
      promise.catch(error=>console.error('saveState failed',error));
      return promise;
    }

    persistState(light,serialized){
      const idbSnapshot=JSON.parse(serialized);
      const localWrote=new Promise(resolve=>{
        try{localStorage.setItem(STATE_KEY,serialized);resolve(true);}
        catch(error){resolve(false);}
      });
      const idbWrite=()=>this.db?this.idb('state','readwrite',s=>s.put(idbSnapshot,STATE_KEY)).then(()=>true,()=>false):Promise.resolve(false);
      this.stateWriteChain=this.stateWriteChain.then(idbWrite,idbWrite);
      return Promise.all([localWrote,this.stateWriteChain]).then(([localOk,idbOk])=>{
        if(!localOk&&!idbOk){
          this.persistDegraded=true;
          throw new Error('state persistence failed on all backends');
        }
        return localOk||idbOk;
      });
    }

    async saveChapterBatch(bookId,chapters,startIndex=0){
      if(!Array.isArray(chapters)||!chapters.length)return;
      if(this.db){
        await this.idb('chapters','readwrite',store=>{
          chapters.forEach((chapter,index)=>store.put(chapter,`${bookId}:${startIndex+index}`));
        });
        return;
      }
      const written=[];
      try{
        chapters.forEach((chapter,index)=>{
          const key=this.chapterStorageKey(bookId,startIndex+index);
          localStorage.setItem(key,JSON.stringify(chapter));
          written.push(key);
        });
      }catch(error){
        written.forEach(key=>localStorage.removeItem(key));
        throw error;
      }
    }

    async saveChapters(bookId,chapters){
      await this.saveChapterBatch(bookId,chapters,0);
    }

    async deleteStoredChapters(bookId,chapterCount){
      const count=Math.max(0,Math.floor(chapterCount||0));
      if(this.db){
        await this.idb('chapters','readwrite',store=>{
          for(let index=0;index<count;index++)store.delete(`${bookId}:${index}`);
        });
      }else{
        for(let index=0;index<count;index++)localStorage.removeItem(this.chapterStorageKey(bookId,index));
      }
      for(const key of [...this.chapterCache.keys()])if(key.startsWith(`${bookId}:`))this.chapterCache.delete(key);
    }

    async detectFileEncoding(file){
      const head=await file.slice(0,4).arrayBuffer();
      const bytes=new Uint8Array(head);
      if(bytes.length>=2){
        if(bytes[0]===0xFF&&bytes[1]===0xFE)return 'utf-16le';
        if(bytes[0]===0xFE&&bytes[1]===0xFF){
          try{new TextDecoder('utf-16be');return 'utf-16be';}
          catch(error){return 'utf-16le';}
        }
      }
      const sampleBuffer=await file.slice(0,Math.min(file.size,ENCODING_SAMPLE_BYTES)).arrayBuffer();
      const utf8Sample=new TextDecoder('utf-8',{fatal:false}).decode(sampleBuffer);
      const replacements=(utf8Sample.match(/\uFFFD/g)||[]).length;
      if(replacements>Math.max(2,Math.floor(utf8Sample.length*.01))){
        let gbkLoss=Infinity;
        let gb18030Loss=Infinity;
        try{gbkLoss=(new TextDecoder('gbk',{fatal:false}).decode(sampleBuffer).match(/\uFFFD/g)||[]).length;}catch(error){}
        try{gb18030Loss=(new TextDecoder('gb18030',{fatal:false}).decode(sampleBuffer).match(/\uFFFD/g)||[]).length;}catch(error){}
        if(gb18030Loss<=gbkLoss&&isFinite(gb18030Loss))return 'gb18030';
        if(isFinite(gbkLoss))return 'gbk';
        try{new TextDecoder('gbk');return 'gbk';}catch(error){}
      }
      return 'utf-8';
    }

    async streamFileText(file,encoding,onChunk){
      const decoder=new TextDecoder(encoding,{fatal:false});
      if(typeof file.stream==='function'){
        const reader=file.stream().getReader();
        let loaded=0;
        let chunks=0;
        try{
          while(true){
            const {done,value}=await reader.read();
            if(done)break;
            loaded+=value.byteLength;
            const text=decoder.decode(value,{stream:true});
            if(text)await onChunk(text,loaded,file.size);
            chunks++;
            if(chunks%8===0)await new Promise(resolve=>requestAnimationFrame(resolve));
          }
          const tail=decoder.decode();
          if(tail)await onChunk(tail,loaded,file.size);
        }finally{
          if(reader.releaseLock)reader.releaseLock();
        }
        return;
      }
      const buffer=await file.arrayBuffer();
      await onChunk(decoder.decode(buffer),buffer.byteLength,file.size);
    }

    async loadChapter(book,index){
      const key=`${book.id}:${index}`;
      if(this.chapterCache.has(key))return this.chapterCache.get(key);
      let chapter=null;
      if(this.db)chapter=await this.idb('chapters','readonly',s=>s.get(`${book.id}:${index}`));
      else{
        try{chapter=JSON.parse(localStorage.getItem(this.chapterStorageKey(book.id,index))||'null');}catch(error){}
      }
      if(chapter===null||chapter===undefined||typeof chapter!=='object'){
        const name=(book&&book.title)||(book&&book.id)||'';
        throw new Error(`章节数据缺失：${name} 第 ${index+1} 章`);
      }
      chapter.paragraphs=ReaderCore.normalizeParagraphs(chapter.paragraphs&&chapter.paragraphs.length?chapter.paragraphs:ReaderCore.splitParagraphs(chapter.content));
      this.rememberChapter(key,chapter);
      return chapter;
    }

    rememberChapter(key,chapter){
      this.chapterCache.set(key,chapter);
      if(this.chapterCache.size<=8)return;
      const oldest=this.chapterCache.keys().next().value;
      this.chapterCache.delete(oldest);
    }

    async ensureDemoBook(){
      if(this.state.books.length)return;
      try{
        if(localStorage.getItem('novelReader_seeded'))return;
      }catch(error){}
      const chapters=ReaderCore.parseChaptersFromText('第一章 初读\n夜色安静，书页在指尖慢慢展开。\n\n这是一本示例书，用来确认阅读器可以正常工作。\n第二章 继续\n重新打开应用时，阅读器会回到你离开的地方。');
      const book=this.createBook('红楼梦示例','本地示例',chapters,'linear-gradient(145deg,#684832,#b47b48)');
      try{
        await this.saveChapters(book.id,chapters);
        delete book.chapters;
        this.state.books.push(book);
        this.saveState();
        try{localStorage.setItem('novelReader_seeded','1');}catch(error){}
      }catch(error){
        console.error('create demo book failed',error);
      }
    }

    createBook(title,author,chapters,coverBg){
      return {
        id:'book_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),
        title,author,coverBg,
        chapterCount:chapters.length,
        chapterTitles:chapters.map(ch=>ch.title),
        chapters,
        progress:0,
        lastRead:Date.now()
      };
    }

    bindEvents(){
      this.$('import-btn').addEventListener('click',()=>this.fileInput.click());
      this.$('empty-import-btn').addEventListener('click',()=>this.fileInput.click());
      this.fileInput.addEventListener('change',()=>{const file=this.fileInput.files[0];if(file)this.importFile(file);this.fileInput.value='';});
      this.$('search-btn').addEventListener('click',()=>{this.lastTrigger=this.$('search-btn');this.openSearch();});
      this.$('search-close').addEventListener('click',()=>this.closeFeaturePanels());
      this.$('search-form').addEventListener('submit',e=>{e.preventDefault();this.runSearch(this.searchInput.value);});
      this.$('bookmarks-btn').addEventListener('click',()=>{this.lastTrigger=this.$('bookmarks-btn');this.openBookmarks();});
      this.$('bookmarks-close').addEventListener('click',()=>this.closeFeaturePanels());
      this.$('book-actions-close').addEventListener('click',()=>this.closeSheets());
      this.$('open-book-action').addEventListener('click',()=>this.openSelectedBookAction());
      this.$('back-btn').addEventListener('click',()=>this.closeReader());
      this.$('settings-btn').addEventListener('click',()=>{this.lastTrigger=this.$('settings-btn');this.openSheet(this.settingsSheet);});
      this.$('settings-close').addEventListener('click',()=>this.closeSheets());
      this.$('toc-btn').addEventListener('click',()=>{this.lastTrigger=this.$('toc-btn');this.openToc();});
      this.$('toc-close').addEventListener('click',()=>this.closeSheets());
      this.scrim.addEventListener('click',()=>this.closeOverlays());
      this.$('prev-btn').addEventListener('click',e=>{e.stopPropagation();this.stepBack().catch(()=>{});});
      this.$('next-btn').addEventListener('click',e=>{e.stopPropagation();this.stepForward().catch(()=>{});});
      this.reader.addEventListener('click',e=>this.handleReaderTap(e));
      this.installReaderGestures();
      this.$('progress-range').addEventListener('change',e=>this.jumpToProgress(Number(e.target.value)/1000));
      this.readerScroll.addEventListener('scroll',()=>this.onScroll(),{passive:true});
      this.readerContent.addEventListener('mouseup',()=>this.scheduleSelectionBubble());
      this.readerContent.addEventListener('touchend',()=>this.scheduleSelectionBubble());
      document.addEventListener('selectionchange',()=>this.scheduleSelectionBubble());
      this.$('selection-bookmark-btn').addEventListener('click',()=>this.addBookmarkFromSelection());
      this.$('selection-copy-btn').addEventListener('click',()=>this.copySelection());
      this.$('font-dec').addEventListener('click',()=>this.changeFont(-1));
      this.$('font-inc').addEventListener('click',()=>this.changeFont(1));
      document.querySelectorAll('[data-mode]').forEach(btn=>btn.addEventListener('click',()=>this.setMode(btn.dataset.mode)));
      document.querySelectorAll('[data-line]').forEach(btn=>btn.addEventListener('click',()=>this.setLineHeight(Number(btn.dataset.line))));
      document.querySelectorAll('[data-margin]').forEach(btn=>btn.addEventListener('click',()=>this.setMargin(Number(btn.dataset.margin))));
      document.querySelectorAll('[data-font]').forEach(btn=>btn.addEventListener('click',()=>this.setFontFamily(Number(btn.dataset.font))));
      document.querySelectorAll('[data-animation]').forEach(btn=>btn.addEventListener('click',()=>this.setPageAnimation(btn.dataset.animation)));
      window.addEventListener('beforeunload',()=>this.flushPosition());
      window.addEventListener('pagehide',()=>this.flushPosition());
      document.addEventListener('visibilitychange',()=>{if(document.hidden)this.flushPosition();});
      window.addEventListener('reader-volume-key',e=>e.detail&&e.detail.direction==='up'?this.stepBack().catch(()=>{}):this.stepForward().catch(()=>{}));
      window.addEventListener('resize',()=>this.rerenderPreservingPosition());
      document.addEventListener('keydown',e=>this.handleKeyboard(e));
      this.$('more-btn').addEventListener('click',()=>{this.lastTrigger=this.$('more-btn');this.openLibraryMenu();});
      this.$('library-menu-close').addEventListener('click',()=>this.closeSheets());
      this.$('sort-mode-btn').addEventListener('click',()=>{
        this.state.sortMode=this.state.sortMode==='recent'?'name':'recent';
        this.saveState();
        this.renderLibrary();
        this.updateSortModeLabel();
        this.showToast(this.state.sortMode==='recent'?'按最近阅读排序':'按书名排序');
      });
      this.$('export-data-btn').addEventListener('click',()=>this.exportData());
      this.$('import-data-btn').addEventListener('click',()=>this.backupInput.click());
      this.backupInput.addEventListener('change',()=>{const file=this.backupInput.files[0];if(file)this.importBackup(file);this.backupInput.value='';});
      this.brightnessRange.addEventListener('input',()=>this.setBrightness(Number(this.brightnessRange.value)/100));
      document.querySelectorAll('[data-night]').forEach(btn=>btn.addEventListener('click',()=>this.setNightMode(btn.dataset.night)));
      document.querySelectorAll('[data-autoscroll]').forEach(btn=>btn.addEventListener('click',()=>this.setAutoScroll(btn.dataset.autoscroll)));
      document.querySelectorAll('[data-volume]').forEach(btn=>btn.addEventListener('click',()=>this.setVolumeKeyTurn(btn.dataset.volume==='on')));
      this.tocFilter.addEventListener('input',()=>this.filterToc());
      this.$('delete-book-btn').addEventListener('click',()=>this.requestDeleteBook());
      this.$('trash-btn').addEventListener('click',()=>this.openTrashPanel());
      this.$('trash-close').addEventListener('click',()=>this.closeFeaturePanels());
      this.$('continue-card').addEventListener('click',()=>{
        if(this.continueBookId)this.openReader(this.continueBookId);
      });
    }

    isReaderChromeTarget(target){
      return target.closest('button,input,a,textarea,select,[role="button"],.bottom-sheet,.side-sheet,.scrim');
    }

    isPageTurnAssistTarget(target){
      const control=target.closest&&target.closest('#prev-btn,#next-btn');
      if(!control)return false;
      if(!control.closest('#reader-bottombar'))return false;
      return this.state.settings.mode==='page';
    }

    handleReaderTap(event){
      if(!this.reader.classList.contains('active'))return;
      if(event.defaultPrevented||event.button!==0)return;
      if(this.settingsSheet.classList.contains('open')||this.tocSheet.classList.contains('open'))return;
      if(this.isReaderChromeTarget(event.target)&&!this.isPageTurnAssistTarget(event.target))return;
      if(this.suppressNextClick&&Date.now()<this.suppressClickUntil){this.suppressNextClick=false;return;}
      this.suppressNextClick=false;
      if(this.handleReaderZoneAction(event.clientX))return;
      this.toggleChrome();
    }

    handleReaderZoneAction(clientX){
      if(this.isZoomed())return false;
      const x=clientX;
      const width=Math.max(1,window.innerWidth||this.reader.clientWidth||1);
      if(this.state.settings.mode==='page'){
      if(x<width*0.28){this.stepBack().catch(()=>{});return true;}
      if(x>width*0.72){this.stepForward().catch(()=>{});return true;}
        return false;
      }
      if(x<width*0.28){this.turnScrollPage(-1);return true;}
      if(x>width*0.72){this.turnScrollPage(1);return true;}
      return false;
    }

    async turnScrollPage(direction){
      if(this.state.settings.mode!=='scroll')return;
      this.hideSelectionBubble(true);
      const max=Math.max(0,this.readerScroll.scrollHeight-this.readerScroll.clientHeight);
      const current=this.readerScroll.scrollTop;
      const step=Math.max(160,Math.floor(this.readerScroll.clientHeight*.86));
      if(direction>0&&current>=max-4)return;
      if(direction<0&&current<=4)return;
      this.readerScroll.scrollTop=Math.max(0,Math.min(max,current+step*direction));
      this.updateProgress();
      clearTimeout(this.saveTimer);
      this.saveTimer=setTimeout(()=>this.flushPosition(),120);
      this.restartAutoScroll();
    }

    installReaderGestures(){
      const reader=this.reader;
      this.activePointers=new Map();
      this.supportsPointer=typeof window.PointerEvent==='function';
      if(this.supportsPointer){
        reader.addEventListener('pointerdown',e=>this.onReaderPointerDown(e));
        reader.addEventListener('pointermove',e=>this.onReaderPointerMove(e));
        reader.addEventListener('pointerup',e=>this.onReaderPointerUp(e));
        reader.addEventListener('pointercancel',e=>this.onReaderPointerCancel(e));
      }else{
        reader.addEventListener('touchstart',e=>this.onReaderTouchStart(e),{passive:true});
        reader.addEventListener('touchmove',e=>this.onReaderTouchMove(e),{passive:false});
        reader.addEventListener('touchend',e=>this.onReaderTouchEnd(e));
        reader.addEventListener('touchcancel',e=>this.onReaderTouchCancel(e));
      }
    }

    onReaderPointerDown(event){
      if(!this.reader.classList.contains('active'))return;
      if(event.pointerType==='touch'){
        this.activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
        if(this.activePointers.size>=2){
          this.cancelReaderGesture();
          return;
        }
      }
      if(this.settingsSheet.classList.contains('open')||this.tocSheet.classList.contains('open'))return;
      if(this.isReaderChromeTarget(event.target))return;
      if(this.state.settings.mode!=='page')return;
      if(event.pointerType==='mouse'&&event.button!==0)return;
      this.pointerStart={x:event.clientX,y:event.clientY,time:Date.now(),page:this.currentPage,dragging:false};
    }

    cancelReaderGesture(){
      this.pointerStart=null;
      this.touchStart=null;
      this.readerContent.classList.remove('dragging');
      this.readerContent.style.transition='';
      if(this.pages&&this.pages.length)this.setPageTransform(false);
    }

    onReaderPointerMove(event){
      if(event.pointerType==='touch'&&this.activePointers.has(event.pointerId)){
        this.activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
        if(this.activePointers.size>=2){
          this.cancelReaderGesture();
          return;
        }
      }
      if(this.state.settings.mode!=='page')return;
      if(!this.pointerStart||this.pointerStart.dragging===undefined)return;
      this.dragReader(event.clientX,event.clientY);
    }

    onReaderPointerUp(event){
      this.activePointers.delete(event.pointerId);
      this.readerContent.classList.remove('dragging');
      this.readerContent.style.transition='';
      if(!this.pointerStart)return;
      this.finishReaderSwipe(event.clientX,event.clientY);
    }

    onReaderPointerCancel(event){
      this.activePointers.delete(event.pointerId);
      this.cancelReaderGesture();
    }

    onReaderTouchStart(event){
      if(!this.reader.classList.contains('active'))return;
      if(event.touches&&event.touches.length>=2){
        this.cancelReaderGesture();
        return;
      }
      if(this.settingsSheet.classList.contains('open')||this.tocSheet.classList.contains('open'))return;
      if(this.isReaderChromeTarget(event.target))return;
      if(this.state.settings.mode!=='page')return;
      const touch=event.changedTouches&&event.changedTouches[0];
      if(!touch)return;
      this.touchStart={x:touch.clientX,y:touch.clientY,time:Date.now(),page:this.currentPage,dragging:false};
    }

    onReaderTouchMove(event){
      if(!this.reader.classList.contains('active'))return;
      if(event.touches&&event.touches.length>=2){
        this.cancelReaderGesture();
        return;
      }
      if(this.state.settings.mode!=='page')return;
      if(!this.touchStart||this.touchStart.dragging===undefined)return;
      const touch=event.changedTouches&&event.changedTouches[0];
      if(!touch)return;
      if(this.dragReader(touch.clientX,touch.clientY))event.preventDefault();
    }

    onReaderTouchEnd(event){
      if(!this.touchStart)return;
      const touch=event.changedTouches&&event.changedTouches[0];
      if(!touch)return;
      this.finishReaderSwipe(touch.clientX,touch.clientY,'touch');
    }

    onReaderTouchCancel(){
      this.cancelReaderGesture();
    }

    isZoomed(){
      if(this.zoomScaleOverride!==undefined)return this.zoomScaleOverride>1.05;
      const vv=window.visualViewport;
      return !!(vv&&vv.scale>1.05);
    }

    dragReader(clientX,clientY){
      if(this.isZoomed())return false;
      const start=this.pointerStart||this.touchStart;
      if(!start)return false;
      const dx=clientX-start.x;
      const dy=clientY-start.y;
      if(!start.dragging){
        if(Math.abs(dx)<14||Math.abs(dx)<Math.abs(dy)*1.2)return false;
        start.dragging=true;
        this.hideSelectionBubble(true);
        this.readerContent.classList.add('dragging');
        this.readerContent.style.transition='none';
      }
      const pageWidth=this.getReaderPageWidth();
      const base=-start.page*pageWidth;
      this.readerContent.style.transform=`translate3d(${base+dx}px,0,0)`;
      return true;
    }

    finishReaderSwipe(clientX,clientY,source='pointer'){
      const start=source==='touch'?this.touchStart:this.pointerStart;
      if(source==='touch')this.touchStart=null;
      else this.pointerStart=null;
      if(!start)return;
      const dx=clientX-start.x;
      const dy=clientY-start.y;
      const elapsed=Date.now()-start.time;
      if(start.dragging){
        this.readerContent.classList.remove('dragging');
        this.readerContent.style.transition='';
        const width=this.getReaderPageWidth();
        const threshold=Math.max(64,Math.floor(width*.18));
        let targetPage=start.page;
        if(dx<=-threshold&&start.page<this.pages.length-1)targetPage=start.page+1;
        else if(dx>=threshold&&start.page>0)targetPage=start.page-1;
        if(targetPage!==this.currentPage){
          this.currentPage=targetPage;
          this.flushPosition();
        }
        this.suppressNextClick=true;
        this.suppressClickUntil=Date.now()+300;
        this.setPageTransform(true);
        this.scheduleChromeAutoHide();
        return;
      }
      if(source==='touch'&&Math.abs(dx)<18&&Math.abs(dy)<18&&elapsed<420){
        this.suppressNextClick=true;
        this.suppressClickUntil=Date.now()+350;
        if(this.handleReaderZoneAction(clientX))return;
        this.toggleChrome();
        return;
      }
      if(Math.abs(dx)<52||Math.abs(dx)<Math.abs(dy)*1.35||elapsed>700)return;
      if(this.isZoomed())return;
      this.suppressNextClick=true;
      this.suppressClickUntil=Date.now()+250;
      if(dx<0)this.stepForward().catch(()=>{});
      else this.stepBack().catch(()=>{});
    }

    scheduleSelectionBubble(){
      clearTimeout(this.selectionTimer);
      this.selectionTimer=setTimeout(()=>this.updateSelectionBubble(),40);
    }

    updateSelectionBubble(){
      if(!this.reader.classList.contains('active')){this.hideSelectionBubble();return;}
      const selection=window.getSelection&&window.getSelection();
      if(!selection||selection.isCollapsed||!selection.rangeCount){this.hideSelectionBubble();return;}
      const range=selection.getRangeAt(0);
      const container=range.commonAncestorContainer.nodeType===Node.ELEMENT_NODE?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
      if(!container||!this.readerContent.contains(container)){this.hideSelectionBubble();return;}
      const text=selection.toString().replace(/\s+/g,' ').trim().slice(0,500);
      if(!text){this.hideSelectionBubble();return;}
      const startElement=range.startContainer.nodeType===Node.ELEMENT_NODE?range.startContainer:range.startContainer.parentElement;
      const paragraph=startElement&&startElement.closest('p[data-p]');
      const paragraphIndex=paragraph?Number(paragraph.dataset.p)||0:0;
      const chapterIndex=paragraph&&paragraph.dataset.ch!==undefined?(Number(paragraph.dataset.ch)||0):this.currentChapter;
      const charOffset=(paragraph?Number(paragraph.dataset.start)||0:0)+Math.max(0,range.startOffset||0);
      const rect=range.getBoundingClientRect();
      if(!rect.width&&!rect.height){this.hideSelectionBubble();return;}
      this.selectedText={text,bookId:this.currentBookId,chapterIdx:chapterIndex,paragraphIndex,charOffset};
      this.selectionBubble.classList.add('show');
      this.selectionBubble.setAttribute('aria-hidden','false');
      requestAnimationFrame(()=>{
        const width=this.selectionBubble.offsetWidth||124;
        const height=this.selectionBubble.offsetHeight||46;
        const left=Math.max(8,Math.min(window.innerWidth-width-8,rect.left+rect.width/2-width/2));
        const preferredTop=rect.top-height-10;
        const top=Math.max(8,preferredTop>=8?preferredTop:Math.min(window.innerHeight-height-8,rect.bottom+10));
        this.selectionBubble.style.left=`${left}px`;
        this.selectionBubble.style.top=`${top}px`;
      });
    }

    hideSelectionBubble(clearSelection=false){
      this.selectionBubble.classList.remove('show');
      this.selectionBubble.setAttribute('aria-hidden','true');
      this.selectedText=null;
      if(clearSelection&&window.getSelection)window.getSelection().removeAllRanges();
    }

    addBookmarkFromSelection(){
      const selected=this.selectedText;
      if(!selected||!selected.bookId)return;
      const timestamp=Date.now();
      this.state.bookmarks.push({
        id:`bookmark_${timestamp}_${Math.random().toString(36).slice(2,7)}`,
        bookId:selected.bookId,
        chapterIdx:selected.chapterIdx,
        paragraphIndex:selected.paragraphIndex,
        charOffset:selected.charOffset,
        text:selected.text,
        note:'',
        timestamp
      });
      this.saveState();
      this.hideSelectionBubble(true);
      this.showToast('已添加书签');
    }

    async copySelection(){
      const text=this.selectedText&&this.selectedText.text;
      if(!text)return;
      try{
        await navigator.clipboard.writeText(text);
        this.hideSelectionBubble(true);
        this.showToast('已复制');
      }catch(error){
        console.error('copy failed',error);
        this.showToast('复制失败，请允许剪贴板权限');
      }
    }

    handleKeyboard(event){
      const target=event.target;
      if(event.key==='Escape'){
        if(this.hasOpenOverlay()){event.preventDefault();this.closeOverlays();}
        else if(this.reader.classList.contains('active')){event.preventDefault();this.closeReader();}
        return;
      }
      if(target&&target.closest&&target.closest('input,textarea,select,[contenteditable="true"]'))return;
      if(this.hasOpenOverlay())return;
      if(!this.reader.classList.contains('active'))return;
      if(event.key==='ArrowLeft'||event.key==='a'||event.key==='A'){event.preventDefault();this.state.settings.mode==='page'?this.stepBack().catch(()=>{}):this.turnScrollPage(-1);}
      else if(event.key==='ArrowRight'||event.key==='d'||event.key==='D'){event.preventDefault();this.state.settings.mode==='page'?this.stepForward().catch(()=>{}):this.turnScrollPage(1);}
      else if(this.state.settings.mode==='scroll'&&(event.key==='ArrowDown'||event.key==='s'||event.key==='S'||event.key===' ')){event.preventDefault();this.turnScrollPage(1);}
      else if(this.state.settings.mode==='scroll'&&(event.key==='ArrowUp'||event.key==='w'||event.key==='W')){event.preventDefault();this.turnScrollPage(-1);}
    }

    installElectronImport(){
      if(!window.electronReader||typeof window.electronReader.onImportFile!=='function')return;
      window.electronReader.onImportFile(payload=>{
        if(!payload||typeof payload.name!=='string'||!(typeof payload.content==='string'||payload.content instanceof Uint8Array||payload.content instanceof ArrayBuffer))return;
        let file;
        try{
          file=new File([payload.content],payload.name,{type:'text/plain'});
        }catch(error){
          file=new File([payload.content],payload.name);
        }
        this.importFile(file);
      });
    }

    installAndroidBackHandling(){
      if(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.App){
        const App=window.Capacitor.Plugins.App;
        App.addListener('appStateChange',state=>{if(!state.isActive)this.flushPosition();});
        App.addListener('pause',()=>this.flushPosition());
        App.addListener('backButton',()=>{
          if(this.hasOpenOverlay())this.closeOverlays();
          else if(this.reader.classList.contains('active'))this.closeReader();
          else App.exitApp();
        });
      }
    }

    renderLibrary(){
      const books=[...this.state.books];
      if(this.state.sortMode==='name')books.sort((a,b)=>a.title.localeCompare(b.title,'zh-CN'));
      else books.sort((a,b)=>(b.lastRead||0)-(a.lastRead||0));
      const recentRead=[...books].sort((a,b)=>(b.lastRead||0)-(a.lastRead||0))[0];
      this.$('book-count').textContent=`${books.length} 本`;
      this.renderTodayStats();
      this.emptyState.classList.toggle('hidden',books.length>0);
      this.bookGrid.innerHTML=books.map(book=>this.bookCardHTML(book)).join('');
      this.bookGrid.querySelectorAll('.book-card').forEach(card=>{
        card.addEventListener('click',()=>{
          if(this.suppressedBookClickId===card.dataset.id){
            this.suppressedBookClickId=null;
            return;
          }
          if(Date.now()<this.suppressBookClickUntil)return;
          this.openReader(card.dataset.id);
        });
        card.addEventListener('contextmenu',event=>{
          event.preventDefault();
          this.showBookActions(card.dataset.id);
        });
        card.addEventListener('pointerdown',event=>this.startBookPress(event,card.dataset.id));
        card.addEventListener('pointermove',event=>this.moveBookPress(event));
        card.addEventListener('pointerup',()=>this.cancelBookPress());
        card.addEventListener('pointercancel',()=>this.cancelBookPress());
      });
      this.renderContinueCard(recentRead);
    }

    startBookPress(event,bookId){
      if(event.pointerType==='mouse'&&event.button!==0)return;
      this.cancelBookPress();
      const press={x:event.clientX,y:event.clientY,bookId,timer:null,triggered:false};
      press.timer=setTimeout(()=>{
        press.triggered=true;
        this.showBookActions(bookId);
      },520);
      this.bookPress=press;
    }

    moveBookPress(event){
      if(!this.bookPress)return;
      if(Math.hypot(event.clientX-this.bookPress.x,event.clientY-this.bookPress.y)>10)this.cancelBookPress();
    }

    cancelBookPress(){
      if(this.bookPress){
        clearTimeout(this.bookPress.timer);
        if(this.bookPress.triggered){
          const bookId=this.bookPress.bookId;
          this.suppressedBookClickId=bookId;
          this.suppressBookClickUntil=Date.now()+650;
          setTimeout(()=>{
            if(this.suppressedBookClickId===bookId)this.suppressedBookClickId=null;
          },650);
        }
      }
      this.bookPress=null;
    }

    showBookActions(bookId){
      const book=this.state.books.find(item=>item.id===bookId);
      if(!book)return;
      this.armedBookId=null;
      this.deleteArmedUntil=0;
      const btn=this.$('delete-book-btn');
      if(btn){
        btn.classList.remove('danger-armed');
        const strong=btn.querySelector('strong');
        if(strong)strong.textContent='删除这本书';
        const meta=btn.querySelector('.action-meta');
        if(meta)meta.textContent='移入最近删除，可恢复';
      }
      this.selectedBookActionId=bookId;
      this.$('book-actions-title').textContent=book.title;
      const progress=Math.round((book.progress||0)*100);
      this.$('book-actions-meta').textContent=`${book.author||'未知作者'} · ${book.chapterCount||0} 章 · ${progress}%`;
      this.openSheet(this.bookActions);
    }

    async openSelectedBookAction(){
      const bookId=this.selectedBookActionId;
      if(!bookId)return;
      this.closeSheets();
      await this.openReader(bookId);
    }

    bookCardHTML(book){
      const progress=Math.round((book.progress||0)*100);
      const chapterCount=book.chapterCount||0;
      return `<button class="book-card" data-id="${book.id}" type="button">
        <div class="book-cover" style="background:${book.coverBg||'linear-gradient(145deg,#5f4636,#9d7047)'}">
          <i class="book-spine book-cover-binding" aria-hidden="true"></i>
          <i class="book-cover-frame" aria-hidden="true"></i>
          <b class="book-cover-mark">${progress}%</b>
          <strong>${this.escape(book.title)}</strong><span class="book-cover-meta">${this.escape(book.author||'未知作者')}</span>
        </div>
        <div class="book-meta"><strong>${this.escape(book.title)}</strong><span>${chapterCount}章</span></div>
        <div class="book-progress"><i style="width:${progress}%"></i></div>
      </button>`;
    }

    renderContinueCard(book){
      const card=this.$('continue-card');
      if(!book){
        this.continueBookId=null;
        card.classList.add('hidden');
        return;
      }
      this.continueBookId=book.id;
      const chapter=book.readingPosition?book.readingPosition.chapter+1:1;
      const progress=Math.round((book.progress||0)*100);
      card.classList.remove('hidden');
      card.innerHTML=`<div class="continue-cover" style="background:${book.coverBg||'linear-gradient(145deg,#5f4636,#9d7047)'}"><i aria-hidden="true"></i><span>${progress}%</span></div><div class="continue-copy"><span>上次读到</span><h2>${this.escape(book.title)}</h2><p>第 ${chapter} 章 · ${progress}% · ${this.escape(book.author||'未知作者')}</p></div><button class="primary-button" type="button" aria-label="继续阅读"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button><div class="continue-meter"><i style="width:${progress}%"></i></div>`;
    }

    openSearch(){
      this.openFeaturePanel(this.searchPanel);
      requestAnimationFrame(()=>this.searchInput.focus());
    }

    async runSearch(query){
      const needle=String(query||'').trim();
      if(!needle){
        this.$('search-status').textContent='输入关键词开始搜索';
        this.searchResults.innerHTML='';
        return;
      }
      const runId=++this.searchRunId;
      const lowerNeedle=needle.toLocaleLowerCase();
      const results=[];
      const totalChapters=this.state.books.reduce((sum,book)=>sum+Math.max(0,book.chapterCount||0),0);
      let scannedChapters=0;
      this.$('search-status').textContent='正在搜索…';
      this.searchResults.innerHTML='';
      try{
        for(const book of this.state.books){
          if(runId!==this.searchRunId)return;
          const metadata=`${book.title||''} ${book.author||''}`;
          if(metadata.toLocaleLowerCase().includes(lowerNeedle)){
            results.push({bookId:book.id,chapterIdx:0,paragraphIndex:0,charOffset:0,bookTitle:book.title,chapterTitle:book.chapterTitles[0]||'第 1 章',snippet:ReaderCore.makeSearchSnippet(metadata,needle,90),needle});
          }
          for(let chapterIdx=0;chapterIdx<book.chapterCount&&results.length<MAX_SEARCH_RESULTS;chapterIdx++){
            let chapter;
            try{chapter=await this.loadChapter(book,chapterIdx);}
            catch(error){continue;}
            if(runId!==this.searchRunId)return;
            const title=String(chapter.title||'');
            const paragraphs=ReaderCore.normalizeParagraphs(chapter.paragraphs||ReaderCore.splitParagraphs(chapter.content));
            const titleMatch=title.toLocaleLowerCase().includes(lowerNeedle);
            let paragraphIndex=titleMatch?0:-1;
            let charOffset=0;
            if(!titleMatch){
              paragraphIndex=paragraphs.findIndex(paragraph=>String(paragraph).toLocaleLowerCase().includes(lowerNeedle));
              if(paragraphIndex>=0)charOffset=String(paragraphs[paragraphIndex]).toLocaleLowerCase().indexOf(lowerNeedle);
            }
            if(titleMatch||paragraphIndex>=0){
              const source=titleMatch?title:String(paragraphs[paragraphIndex]);
              results.push({bookId:book.id,chapterIdx,paragraphIndex:Math.max(0,paragraphIndex),charOffset:Math.max(0,charOffset),bookTitle:book.title,chapterTitle:title||`第 ${chapterIdx+1} 章`,snippet:ReaderCore.makeSearchSnippet(source,needle,110),needle});
            }
            scannedChapters++;
            if(scannedChapters%4===0){
              const progress=totalChapters?Math.min(99,Math.floor(scannedChapters/totalChapters*100)):0;
              this.$('search-status').textContent=`正在搜索… ${progress}%`;
              await new Promise(resolve=>requestAnimationFrame(resolve));
            }
          }
          if(results.length>=MAX_SEARCH_RESULTS)break;
        }
      }catch(error){
        console.error('search failed',error);
        if(runId===this.searchRunId)this.$('search-status').textContent='搜索失败，请重试';
        return;
      }
      if(runId!==this.searchRunId)return;
      this.renderSearchResults(results);
      this.$('search-status').textContent=results.length>=MAX_SEARCH_RESULTS?`已显示前 ${MAX_SEARCH_RESULTS} 条结果`:`找到 ${results.length} 条结果`;
    }

    renderSearchResults(results){
      if(!results.length){
        this.searchResults.innerHTML='<div class="feature-empty">没有找到匹配内容</div>';
        return;
      }
      this.searchResults.innerHTML=results.map((result,index)=>`<button class="result-card" type="button" data-result="${index}"><span class="result-meta"><strong>${this.escape(result.bookTitle)}</strong><small>${this.escape(result.chapterTitle)}</small></span><p class="result-snippet">${this.escape(result.snippet)}</p></button>`).join('');
      this.searchResults.querySelectorAll('[data-result]').forEach(button=>button.addEventListener('click',()=>this.openSearchResult(results[Number(button.dataset.result)])));
    }

    async openSearchResult(result){
      if(!result)return;
      this.closeFeaturePanels();
      const committed=await this.openReader(result.bookId);
      if(!committed)return;
      this.currentChapter=result.chapterIdx;
      this.currentPage=0;
      const intent=this.beginRenderIntent(this.currentBookId,result.chapterIdx,this.state.settings.mode);
      const anchor={readingMode:'anchor',chapter:result.chapterIdx,paragraphIndex:result.paragraphIndex,charOffset:result.charOffset};
      await this.renderReader(anchor,intent);
      if(!intent.isCurrent())return;
      this.revealParagraph(result.paragraphIndex,result.charOffset,result.needle);
    }

    highlightParagraphText(paragraphEl,charOffset,needle){
      if(!paragraphEl||!needle)return;
      const text=String(paragraphEl.textContent||'');
      const idx=text.toLocaleLowerCase().indexOf(String(needle).toLocaleLowerCase(),Math.max(0,charOffset||0));
      if(idx<0)return;
      const mark=document.createElement('mark');
      mark.className='search-highlight';
      mark.textContent=text.slice(idx,idx+String(needle).length);
      paragraphEl.replaceChildren(
        document.createTextNode(text.slice(0,idx)),
        mark,
        document.createTextNode(text.slice(idx+String(needle).length))
      );
    }

    revealParagraph(paragraphIndex,charOffset=0,highlightText=null){
      if(this.state.settings.mode==='page'){
        this.currentPage=ReaderCore.findPageIndexForAnchor(this.pages,paragraphIndex,charOffset);
        this.setPageTransform(false);
        if(highlightText){
          const page=this.readerContent.querySelector(`.page[data-page="${this.currentPage}"]`);
          const paragraph=page&&page.querySelector(`p[data-p="${paragraphIndex}"]`);
          this.highlightParagraphText(paragraph,charOffset,highlightText);
        }
        return;
      }
      requestAnimationFrame(()=>{
        const paragraph=this.readerContent.querySelector(`p[data-ch="${this.currentChapter}"][data-p="${paragraphIndex}"]`);
        if(paragraph){
          this.readerScroll.scrollTop=Math.max(0,paragraph.offsetTop-72);
          if(highlightText)this.highlightParagraphText(paragraph,charOffset,highlightText);
        }
      });
    }

    openBookmarks(){
      this.renderBookmarks();
      this.openFeaturePanel(this.bookmarksPanel);
    }

    renderBookmarks(){
      const bookmarks=[...(this.state.bookmarks||[])].sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
      this.$('bookmarks-status').textContent=bookmarks.length?`${bookmarks.length} 个书签`:'还没有书签';
      if(!bookmarks.length){
        this.bookmarksList.innerHTML='<div class="feature-empty">在阅读正文中选中文字，即可添加书签和笔记。</div>';
        return;
      }
      this.bookmarksList.innerHTML=bookmarks.map(bookmark=>{
        const book=this.state.books.find(item=>item.id===bookmark.bookId);
        const chapterTitle=book&&book.chapterTitles[bookmark.chapterIdx]||`第 ${bookmark.chapterIdx+1} 章`;
        return `<article class="bookmark-card" data-bookmark-id="${this.escape(bookmark.id)}"><div class="bookmark-head"><div><strong>${this.escape(book?book.title:'已删除书籍')}</strong><span class="bookmark-meta">${this.escape(chapterTitle)}</span></div></div><p class="bookmark-text">${this.escape(bookmark.text||'无文本快照')}</p><label class="bookmark-note-wrap"><span>笔记</span><textarea class="bookmark-note" maxlength="1000" placeholder="写一点想法" aria-label="书签笔记">${this.escape(bookmark.note||'')}</textarea></label><div class="bookmark-actions"><button class="ghost-button" type="button" data-action="open" aria-label="跳转到书签"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button><button class="ghost-button danger-text" type="button" data-action="delete" aria-label="删除书签"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12M10 11v6M14 11v6M9 7l1-2h4l1 2M8 7l1 13h6l1-13"/></svg></button></div></article>`;
      }).join('');
      this.bookmarksList.querySelectorAll('[data-bookmark-id]').forEach(card=>{
        const id=card.dataset.bookmarkId;
        card.querySelector('.bookmark-note').addEventListener('change',event=>this.updateBookmarkNote(id,event.target.value));
        card.querySelector('[data-action="open"]').addEventListener('click',()=>this.openBookmark(id));
        card.querySelector('[data-action="delete"]').addEventListener('click',()=>this.deleteBookmark(id));
      });
    }

    updateBookmarkNote(id,note){
      const bookmark=this.state.bookmarks.find(item=>item.id===id);
      if(!bookmark)return;
      bookmark.note=String(note||'').slice(0,1000);
      this.saveState();
      this.showToast('笔记已保存');
    }

    deleteBookmark(id){
      this.state.bookmarks=this.state.bookmarks.filter(item=>item.id!==id);
      this.saveState();
      this.renderBookmarks();
      this.showToast('书签已删除');
    }

    async openBookmark(id){
      const bookmark=this.state.bookmarks.find(item=>item.id===id);
      if(!bookmark)return;
      this.closeFeaturePanels();
      const committed=await this.openReader(bookmark.bookId);
      if(!committed)return;
      this.currentChapter=bookmark.chapterIdx;
      this.currentPage=0;
      const intent=this.beginRenderIntent(this.currentBookId,bookmark.chapterIdx,this.state.settings.mode);
      const anchor={readingMode:'anchor',chapter:bookmark.chapterIdx,paragraphIndex:bookmark.paragraphIndex,charOffset:bookmark.charOffset};
      await this.renderReader(anchor,intent);
      if(!intent.isCurrent())return;
      this.revealParagraph(bookmark.paragraphIndex,bookmark.charOffset);
    }

    requestDeleteBook(){
      const book=this.state.books.find(item=>item.id===this.selectedBookActionId);
      if(!book)return;
      const btn=this.$('delete-book-btn');
      if(this.armedBookId===book.id&&Date.now()<this.deleteArmedUntil){
        this.armedBookId=null;
        this.deleteArmedUntil=0;
        this.deleteBook(book.id);
        return;
      }
      this.armedBookId=book.id;
      this.deleteArmedUntil=Date.now()+3000;
      btn.classList.add('danger-armed');
      const strong=btn.querySelector('strong');
      if(strong)strong.textContent='确认删除《'+book.title+'》？';
      const meta=btn.querySelector('.action-meta');
      if(meta)meta.textContent='再次点击将移入最近删除';
      clearTimeout(this.deleteArmTimer);
      this.deleteArmTimer=setTimeout(()=>{
        this.armedBookId=null;
        this.deleteArmedUntil=0;
        btn.classList.remove('danger-armed');
        const strong2=btn.querySelector('strong');
        if(strong2)strong2.textContent='删除这本书';
        const meta2=btn.querySelector('.action-meta');
        if(meta2)meta2.textContent='移入最近删除，可恢复';
      },3000);
    }

    async bestTrashPosition(book){
      const candidates=[book.readingPosition];
      try{candidates.push(JSON.parse(localStorage.getItem(POSITION_PREFIX+book.id)||'null'));}catch(error){}
      if(this.db){
        try{candidates.push(await this.idb('positions','readonly',store=>store.get(book.id)));}catch(error){}
      }
      return ReaderCore.chooseBestReadingPosition(candidates,book);
    }

    async deleteBook(bookId){
      const book=this.state.books.find(item=>item.id===bookId);
      if(!book)return;
      this.closeSheets();
      try{
        const position=await this.bestTrashPosition(book);
        const bookmarks=this.state.bookmarks.filter(item=>item.bookId===book.id);
        const entry={savedAt:Date.now(),book,position,bookmarks,keepsData:true};
        await this.saveTrashEntry(bookId,entry);
        const originalIndex=this.state.books.indexOf(book);
        const originalBookmarks=this.state.bookmarks.slice();
        const nextBooks=this.state.books.filter(item=>item.id!==book.id);
        const nextBookmarks=this.state.bookmarks.filter(item=>item.bookId!==book.id);
        this.state.books=nextBooks;
        this.state.bookmarks=nextBookmarks;
        try{
          await this.saveState();
        }catch(error){
          try{await this.deleteTrashEntry(bookId);}catch(cleanupError){console.error('delete rollback trash cleanup failed',cleanupError);}
          const restoredBooks=nextBooks.slice();
          restoredBooks.splice(Math.min(originalIndex,restoredBooks.length),0,book);
          this.state.books=restoredBooks;
          this.state.bookmarks=originalBookmarks;
          throw error;
        }
        this.selectedBookActionId=null;
        this.armedBookId=null;
        this.renderLibrary();
        this.showToastAction(`《${book.title}》已移入最近删除`,'撤销',()=>this.restoreFromTrash(bookId));
      }catch(error){
        console.error('move to trash failed',error);
        this.armedBookId=null;
        this.showToast('删除失败，请重试');
      }
    }

    saveTrashEntry(bookId,entry){
      if(this.db)return this.idb('trash','readwrite',store=>store.put(entry,bookId));
      const serialized=JSON.stringify(entry);
      if(serialized.length>2*1024*1024)return Promise.reject(new Error('trash entry too large for local storage fallback'));
      localStorage.setItem(TRASH_PREFIX+bookId,serialized);
      return Promise.resolve();
    }

    loadTrashEntry(bookId){
      if(this.db)return this.idb('trash','readonly',store=>store.get(bookId));
      try{return Promise.resolve(JSON.parse(localStorage.getItem(TRASH_PREFIX+bookId)||'null'));}
      catch(error){return Promise.resolve(null);}
    }

    async listTrashEntries(){
      if(this.db){
        try{
          const values=await this.idb('trash','readonly',store=>store.getAll());
          return (values||[]).filter(Boolean).map(entry=>({bookId:entry.book&&entry.book.id,savedAt:entry.savedAt||0,book:entry.book}));
        }catch(error){return [];}
      }
      const entries=[];
      for(let index=0;index<localStorage.length;index++){
        const key=localStorage.key(index);
        if(key&&key.startsWith(TRASH_PREFIX)){
          try{
            const entry=JSON.parse(localStorage.getItem(key)||'null');
            if(entry&&entry.book)entries.push({bookId:key.slice(TRASH_PREFIX.length),savedAt:entry.savedAt||0,book:entry.book});
          }catch(error){}
        }
      }
      return entries;
    }

    deleteTrashEntry(bookId){
      if(this.db)return this.idb('trash','readwrite',store=>store.delete(bookId));
      localStorage.removeItem(TRASH_PREFIX+bookId);
      return Promise.resolve();
    }

    requestPurgeTrashEntry(bookId,title){
      if(this.purgeArmedId===bookId&&Date.now()<this.purgeArmedUntil){
        this.purgeArmedId=null;
        this.purgeArmedUntil=0;
        this.purgeTrashEntry(bookId);
        return;
      }
      this.purgeArmedId=bookId;
      this.purgeArmedUntil=Date.now()+3000;
      const btn=this.trashList&&this.trashList.querySelector(`[data-trash-id="${String(bookId).replace(/"/g,'&quot;')}"] [data-trash-action="purge"]`);
      if(btn){
        btn.classList.add('danger-armed');
        btn.setAttribute('aria-label','确认永久删除《'+title+'》？');
      }
      clearTimeout(this.purgeArmTimer);
      this.purgeArmTimer=setTimeout(()=>{
        this.purgeArmedId=null;
        this.purgeArmedUntil=0;
        if(btn){
          btn.classList.remove('danger-armed');
          btn.setAttribute('aria-label','永久删除《'+title+'》');
        }
      },3000);
    }

    async purgeExpiredTrashEntry(entry){
      const active=this.state.books.some(item=>item.id===entry.bookId);
      if(!active&&entry.book){
        const book=entry.book;
        await this.deleteStoredChapters(book.id,book.chapterCount||0);
        if(this.db)await this.idb('positions','readwrite',store=>store.delete(book.id));
        localStorage.removeItem(POSITION_PREFIX+book.id);
        const legacyPrefix=CHAPTER_PREFIX+book.id+':';
        const legacyKeys=[];
        for(let index=0;index<localStorage.length;index++){
          const key=localStorage.key(index);
          if(key&&key.startsWith(legacyPrefix))legacyKeys.push(key);
        }
        for(const key of legacyKeys)localStorage.removeItem(key);
        for(const key of [...this.chapterCache.keys()])if(key.startsWith(`${book.id}:`))this.chapterCache.delete(key);
      }
      await this.deleteTrashEntry(entry.bookId);
    }

    async purgeTrashEntry(bookId){
      let entry;
      try{
        entry=await this.loadTrashEntry(bookId);
      }catch(error){
        console.error('trash read failed, keeping marker',error);
        this.showToast('读取失败，可稍后重试');
        await this.refreshTrash();
        return;
      }
      try{
        await this.purgeExpiredTrashEntry({bookId,book:entry&&entry.book});
      }catch(error){
        console.error('purge failed, keeping trash marker',error);
        this.showToast('清理失败，可稍后重试');
        await this.refreshTrash();
        return;
      }
      await this.refreshTrash();
      if(entry&&entry.book)this.showToast('已永久删除《'+entry.book.title+'》');
      else this.showToast('已永久删除');
    }

    async restoreFromTrash(bookId){
      let entry;
      try{
        entry=await this.loadTrashEntry(bookId);
      }catch(error){
        console.error('trash read failed, keeping marker',error);
        this.showToast('读取失败，可稍后重试');
        return false;
      }
      if(!entry||!entry.book)return false;
      const book=entry.book;
      if(this.state.books.some(item=>item.id===book.id)){
        this.showToast('恢复失败：书架中已存在同名书籍');
        return false;
      }
      const addedBookmarks=[];
      try{
        if(entry.position){
          book.readingPosition=entry.position;
          book.progress=entry.position.totalProgress||0;
        }
        if(Array.isArray(entry.bookmarks)&&entry.bookmarks.length){
          const existing=new Set(this.state.bookmarks.map(item=>item.id));
          entry.bookmarks.forEach(bookmark=>{
            if(!existing.has(bookmark.id)){
              this.state.bookmarks.push(bookmark);
              addedBookmarks.push(bookmark);
            }
          });
        }
        let chapters=Array.isArray(entry.chapters)?entry.chapters:[];
        if(!chapters.length&&Array.isArray(book.chapters))chapters=book.chapters;
        if(chapters.length){
          const mapped=chapters.map(chapter=>({title:chapter.title,content:chapter.content}));
          await this.saveChapters(book.id,mapped);
          book.chapterCount=Math.max(book.chapterCount||0,mapped.length);
          if(!Array.isArray(book.chapterTitles)||!book.chapterTitles.length){
            book.chapterTitles=mapped.map(chapter=>chapter.title);
          }
          delete book.chapters;
        }
        this.state.books.push(book);
        try{
          await this.saveState();
        }catch(error){
          this.state.books=this.state.books.filter(item=>item.id!==book.id);
          this.state.bookmarks=this.state.bookmarks.filter(item=>!addedBookmarks.includes(item));
          throw error;
        }
        try{
          await this.deleteTrashEntry(bookId);
        }catch(error){
          console.error('trash cleanup failed',error);
          this.renderLibrary();
          this.showToast('已恢复《'+book.title+'》，但最近删除清理失败，可稍后重试');
          await this.refreshTrash();
          return true;
        }
        this.renderLibrary();
        this.showToast('已恢复《'+book.title+'》');
        await this.refreshTrash();
        return true;
      }catch(error){
        console.error('restore from trash failed',error);
        this.showToast('恢复失败，请重试');
        return false;
      }
    }

    async refreshTrash(){
      const entries=await this.listTrashEntries();
      const now=Date.now();
      const expiredFailures=[];
      const stale=entries.filter(entry=>now-entry.savedAt>TRASH_RETENTION_MS);
      for(const entry of stale){
        try{
          await this.purgeExpiredTrashEntry(entry);
        }catch(error){
          console.error('expired purge failed, keeping marker',error);
          expiredFailures.push(entry);
        }
      }
      const fresh=entries.filter(entry=>now-entry.savedAt<=TRASH_RETENTION_MS);
      this.trashEntries=fresh.concat(expiredFailures);
      if(expiredFailures.length)this.showToast('部分过期条目清理失败，可稍后重试');
      const countEl=this.$('trash-count');
      if(countEl)countEl.textContent=(fresh.length+expiredFailures.length)?`${fresh.length+expiredFailures.length} 本`:'空';
    }

    openTrashPanel(){
      this.purgeArmedId=null;
      this.purgeArmedUntil=0;
      this.refreshTrash().then(()=>{
        const entries=this.trashEntries;
        const status=this.$('trash-status');
        const list=this.$('trash-list');
        status.textContent=entries.length?`${entries.length} 本书在最近删除中，保留 30 天`:'没有可恢复的书籍';
        list.innerHTML=entries.map(entry=>{
          const date=new Date(entry.savedAt);
          const stamp=`${date.getMonth()+1}月${date.getDate()}日 ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
          const safeId=this.escape(String(entry.bookId));
          return `<article class="bookmark-card trash-row" data-trash-id="${safeId}">
            <div class="trash-cover" style="background:${entry.book.coverBg||'linear-gradient(145deg,#5f4636,#9d7047)'}"></div>
            <div class="trash-copy">
              <strong>${this.escape(entry.book.title)}</strong>
              <small>${this.escape(entry.book.author||'未知作者')} · ${stamp} 删除</small>
            </div>
            <div class="trash-actions">
              <button class="ghost-button" type="button" data-trash-action="restore" aria-label="恢复《${this.escape(entry.book.title)}》"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 1 2.3 5.7M4 12V7m0 5h5"/></svg></button>
              <button class="ghost-button danger-text" type="button" data-trash-action="purge" aria-label="永久删除《${this.escape(entry.book.title)}》"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12M10 11v6M14 11v6M9 7l1-2h4l1 2M8 7l1 13h6l1-13"/></svg></button>
            </div>
          </article>`;
        }).join('');
        list.querySelectorAll('[data-trash-id]').forEach(card=>{
          const id=card.dataset.trashId;
          const title=(card.querySelector('.trash-copy strong')||{}).textContent||'';
          card.querySelector('[data-trash-action="restore"]').addEventListener('click',()=>this.restoreFromTrash(id));
          card.querySelector('[data-trash-action="purge"]').addEventListener('click',()=>this.requestPurgeTrashEntry(id,title));
        });
        this.libraryMenu.classList.remove('open');
        this.trashPanel.classList.add('open');
        this.scrim.classList.add('show');
        this.syncVisibilityState();
      });
    }

    openLibraryMenu(){
      this.closeSheets(false);
      this.libraryMenu.classList.add('open');
      this.scrim.classList.add('show');
      this.updateSortModeLabel();
      this.syncVisibilityState();
    }

    updateSortModeLabel(){
      const label=this.$('sort-mode-label');
      if(label)label.textContent=this.state.sortMode==='recent'?'最近阅读':'书名排序';
    }

    async exportData(){
      this.closeSheets();
      if(!this.state.books.length){this.showToast('书架是空的，无需导出');return;}
      this.showToast('正在打包数据…');
      try{
        const payload={app:'novel-reader',version:2,exportedAt:Date.now(),state:JSON.parse(JSON.stringify(this.state))};
        for(const book of payload.state.books){
          const chapters=[];
          for(let index=0;index<book.chapterCount;index++){
            const chapter=await this.loadChapter(book,index);
            chapters.push({title:chapter.title,content:chapter.content});
            if(index%16===0)await new Promise(resolve=>requestAnimationFrame(resolve));
          }
          book.chapters=chapters;
        }
        const json=JSON.stringify(payload);
        const blob=new Blob([json],{type:'application/json'});
        const url=URL.createObjectURL(blob);
        const date=new Date();
        const stamp=`${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`;
        const anchor=document.createElement('a');
        anchor.href=url;
        anchor.download=`novel-reader-backup-${stamp}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(()=>URL.revokeObjectURL(url),10000);
        this.showToast('已导出备份文件');
      }catch(error){
        console.error('export failed',error);
        this.showToast(/章节数据缺失/.test(String(error&&error.message||error))?'导出失败：书籍数据不完整，请重新导入或从备份恢复':'导出失败，请重试');
      }
    }

    async importBackup(file){
      if(this.importBusy){this.showToast('正在导入中，请稍候');return;}
      this.importBusy=true;
      this.setImportBusyUI(true);
      this.closeSheets();
      this.showToast('正在导入备份…');
      try{
        const text=await file.text();
        const payload=JSON.parse(text);
        if(!payload||payload.app!=='novel-reader'||!payload.state){
          this.showToast('不是有效的备份文件');
          return;
        }
        const incoming=ReaderCore.normalizeAppStateDefaults(payload.state);
        const existingIds=new Set(this.state.books.map(book=>book.id));
        const trashIds=new Set((await this.listTrashEntries()).map(entry=>entry.bookId));
        const conflictIds=new Set([...existingIds,...trashIds]);
        const existingBookmarkIds=new Set(this.state.bookmarks.map(item=>item.id));
        const addedBooks=[];
        const addedBookmarkIds=[];
        let added=0,skipped=0;
        for(const book of incoming.books){
          const chapters=Array.isArray(book.chapters)?book.chapters:[];
          delete book.chapters;
          if(!chapters.length||conflictIds.has(book.id)){skipped++;continue;}
          book.chapterCount=chapters.length;
          book.chapterTitles=Array.isArray(book.chapterTitles)&&book.chapterTitles.length===chapters.length
            ?book.chapterTitles
            :chapters.map((chapter,index)=>chapter.title||`第 ${index+1} 章`);
          try{
            await this.saveChapters(book.id,chapters);
            this.state.books.push(book);
            addedBooks.push(book);
            added++;
            conflictIds.add(book.id);
          }catch(error){
            console.error('restore book failed',error);
            skipped++;
          }
        }
        for(const bookmark of (incoming.bookmarks||[])){
          if(!existingBookmarkIds.has(bookmark.id)&&this.state.books.some(book=>book.id===bookmark.bookId)){
            this.state.bookmarks.push(bookmark);
            existingBookmarkIds.add(bookmark.id);
            addedBookmarkIds.push(bookmark.id);
          }
        }
        if(!added&&!skipped){this.showToast('备份中没有可导入的内容');return;}
        try{
          await this.saveState();
        }catch(error){
          for(const addedBook of addedBooks){
            this.state.books=this.state.books.filter(item=>item.id!==addedBook.id);
            try{await this.deleteStoredChapters(addedBook.id,addedBook.chapterCount||0);}catch(cleanupError){console.error('backup rollback cleanup failed',cleanupError);}
          }
          this.state.bookmarks=this.state.bookmarks.filter(item=>!addedBookmarkIds.includes(item.id));
          this.showToast('导入失败：本地存储异常，请重试');
          return;
        }
        this.renderLibrary();
        this.showToast(added?`导入完成：新增 ${added} 本${skipped?`，跳过 ${skipped} 本`:''}`:`没有新增内容（跳过 ${skipped} 本已存在的书）`);
      }catch(error){
        console.error('import backup failed',error);
        this.showToast('导入失败，请检查文件');
      }finally{
        this.importBusy=false;
        this.setImportBusyUI(false);
      }
    }

    setImportBusyUI(busy){
      ['import-btn','empty-import-btn','import-data-btn'].forEach(id=>{
        const el=this.$(id);
        if(el){
          el.disabled=!!busy;
          el.setAttribute('aria-busy',busy?'true':'false');
        }
      });
      if(this.backupInput)this.backupInput.disabled=!!busy;
    }

    async importFile(file){
      if(this.importBusy){this.showToast('正在导入中，请稍候');return;}
      if(!file||!String(file.name||'').toLocaleLowerCase().endsWith('.txt')){this.showToast('请选择 TXT 文件');return;}
      if(file.size>MAX_IMPORT_BYTES){this.showToast('文件过大，请选择 100MB 以内的 TXT');return;}
      this.importBusy=true;
      this.setImportBusyUI(true);
      this.showToast('正在导入…');
      let book=null;
      let storedCount=0;
      try{
        const info=ReaderCore.parseTitleFromFilename(file.name);
        const duplicate=this.state.books.find(book=>book.title===info.title&&book.author===info.author);
        if(duplicate){
          this.showToast(`《${duplicate.title}》已在书架中，如需重新导入请先删除`);
          return;
        }
        const colors=['linear-gradient(145deg,#5b3f2f,#b16f3c)','linear-gradient(145deg,#324d5c,#6f9cb0)','linear-gradient(145deg,#42395f,#9875bd)','linear-gradient(145deg,#3f5533,#8aa66b)'];
        book=this.createBook(info.title,info.author,[],colors[this.state.books.length%colors.length]);
        const encoding=await this.detectFileEncoding(file);
        let numericMode=false;
        try{
          const sampleBuffer=await file.slice(0,Math.min(file.size,ENCODING_SAMPLE_BYTES)).arrayBuffer();
          const sampleText=new TextDecoder(encoding,{fatal:false}).decode(sampleBuffer);
          numericMode=ReaderCore.detectChapterMode(sampleText);
        }catch(error){}
        const parser=ReaderCore.createChapterParser({numericMode});
        const pending=[];
        const chapterTitles=[];
        let hasContent=false;
        let lastProgress=-10;

        const flushPending=async force=>{
          while(pending.length>=IMPORT_BATCH_SIZE||(force&&pending.length)){
            const batch=pending.splice(0,Math.min(IMPORT_BATCH_SIZE,pending.length));
            await this.saveChapterBatch(book.id,batch,storedCount);
            storedCount+=batch.length;
          }
        };
        const acceptChapters=async chapters=>{
          chapters.forEach(chapter=>{
            chapter.paragraphs=ReaderCore.normalizeParagraphs(chapter.paragraphs&&chapter.paragraphs.length?chapter.paragraphs:ReaderCore.splitParagraphs(chapter.content));
            if(chapter.paragraphs.length)hasContent=true;
            chapterTitles.push(chapter.title||`第 ${chapterTitles.length+1} 章`);
            pending.push(chapter);
          });
          await flushPending(false);
        };

        await this.streamFileText(file,encoding,async(text,loaded,total)=>{
          await acceptChapters(parser.push(text));
          const progress=total?Math.floor(loaded/total*100):0;
          if(progress>=lastProgress+10){
            lastProgress=progress;
            this.showToast(`正在导入… ${Math.min(99,progress)}%`);
          }
        });
        await acceptChapters(parser.finish());
        await flushPending(true);
        if(!storedCount||!hasContent){
          await this.deleteStoredChapters(book.id,storedCount);
          this.showToast('未识别到正文');
          return;
        }
        book.chapterCount=storedCount;
        book.chapterTitles=chapterTitles;
        delete book.chapters;
        this.state.books.push(book);
        try{
          await this.saveState();
        }catch(error){
          this.state.books=this.state.books.filter(item=>item.id!==book.id);
          try{await this.deleteStoredChapters(book.id,storedCount);}catch(cleanupError){console.error('import rollback cleanup failed',cleanupError);}
          this.showToast('导入失败：本地存储异常，请重试');
          return;
        }
        this.renderLibrary();
        this.showToast(`已导入 ${storedCount} 章`);
      }catch(error){
        console.error('import failed',error);
        if(book&&storedCount){
          try{await this.deleteStoredChapters(book.id,storedCount);}catch(cleanupError){console.error('cleanup partial import failed',cleanupError);}
        }
        const quota=/quota/i.test(`${error&&error.name||''} ${error&&error.message||''}`);
        this.showToast(quota?'本地存储空间不足，无法导入该 TXT':'导入失败，请检查文件后重试');
      }finally{
        this.importBusy=false;
        this.setImportBusyUI(false);
      }
    }

    async openReader(bookId){
      const book=this.state.books.find(b=>b.id===bookId);
      if(!book)return false;
      const previousMode=this.state.settings.mode;
      const previousLastRead=book.lastRead;
      const intent=this.beginRenderIntent(book.id,0,this.state.settings.mode);
      this.currentBookId=book.id;
      this.navGeneration++;
      try{
        this.library.classList.add('hidden');
        this.reader.classList.add('active');
        this.syncVisibilityState();
        this.setChromeVisible(true);
        this.setAndroidVolumeKeys(!!this.state.settings.volumeKeyTurn);
        this.setAndroidImmersive(true);
        const saved=await this.loadBestPosition(book);
        if(!intent.isCurrent())return false;
        this.currentChapter=saved?saved.chapter:0;
        this.currentPage=saved?saved.currentPage||0:0;
        if(saved&&saved.readingMode)this.state.settings.mode=saved.readingMode;
        await this.renderReader(saved,intent);
        if(!intent.isCurrent())return false;
        book.lastRead=Date.now();
        this.scheduleChromeAutoHide();
        await this.saveState();
        if(!intent.isCurrent()){
          book.lastRead=previousLastRead;
          return false;
        }
        if(this.state.settings.autoScroll!=='off')this.startAutoScroll();
        return true;
      }catch(error){
        console.error('openReader failed',error);
        if(intent.isCurrent()){
          book.lastRead=previousLastRead;
          this.rollbackReaderState(previousMode);
          const integrity=/章节数据缺失/.test(String(error&&error.message||error));
          this.showToast(integrity?'内容不完整：书籍数据缺失，请重新导入或从备份恢复':'打开失败：本地存储异常，请稍后重试');
        }
        return false;
      }
    }

    rollbackReaderState(previousMode){
      this.stopAutoScroll();
      this.currentBookId=null;
      this.currentChapter=0;
      this.currentPage=0;
      this.state.settings.mode=previousMode;
      this.reader.classList.remove('active','page-mode','chrome-hidden');
      this.chromeVisible=true;
      this.library.classList.remove('hidden');
      this.setAndroidVolumeKeys(false);
      this.setAndroidImmersive(false);
      this.closeOverlays();
      this.syncVisibilityState();
    }

    async loadBestPosition(book){
      const candidates=[book.readingPosition];
      try{candidates.push(JSON.parse(localStorage.getItem(POSITION_PREFIX+book.id)||'null'));}catch(e){}
      if(this.db){try{candidates.push(await this.idb('positions','readonly',s=>s.get(book.id)));}catch(e){}}
      const best=ReaderCore.chooseBestReadingPosition(candidates,book);
      if(best){book.readingPosition=best;book.progress=best.totalProgress;}
      return best;
    }

    async renderReader(savedPosition,intent){
      const book=this.getCurrentBook();
      if(!book)return;
      const intentObj=intent||this.beginRenderIntent(this.currentBookId,this.currentChapter,this.state.settings.mode);
      if(!intentObj.isCurrent())return;
      this.hideSelectionBubble(true);
      this.applySettings();
      this.$('reader-book-title').textContent=book.title;
      const chapter=await this.loadChapter(book,this.currentChapter);
      if(!intentObj.isCurrent())return;
      this.$('reader-chapter-title').textContent=chapter.title||`第 ${this.currentChapter+1} 章`;
      if(this.state.settings.mode==='page')this.renderPageMode(chapter,savedPosition);
      else await this.renderScrollMode(savedPosition,intentObj);
      if(!intentObj.isCurrent())return;
      this.updateProgress();
    }

    async renderScrollMode(savedPosition,intent){
      this.reader.classList.remove('page-mode');
      this.readerContent.style.transform='';
      this.readerContent.style.width='';
      this.invalidateMarkerCache();
      const target=savedPosition&&savedPosition.chapter!==undefined?savedPosition.chapter:this.currentChapter;
      await this.renderContinuousScrollContent(this.getCurrentBook(),target);
      await new Promise(resolve=>requestAnimationFrame(resolve));
      if(intent&&!intent.isCurrent())return;
      if(savedPosition)this.restorePosition(savedPosition);
      else this.readerScroll.scrollTop=0;
      this.updateProgress();
    }

    async renderContinuousScrollContent(book,targetChapter=this.currentChapter){
      if(!book)return;
      const count=Math.max(1,book.chapterCount||0);
      const target=Math.max(0,Math.min(count-1,Number(targetChapter)||0));
      const start=Math.max(0,target-SCROLL_WINDOW_BEFORE);
      const end=Math.min(count-1,target+SCROLL_WINDOW_AFTER);
      const token=++this.scrollRenderToken;
      this.scrollWindowBusy=true;
      this.readerContent.replaceChildren();
      this.scrollWindowStart=start;
      this.scrollWindowEnd=start-1;
      try{
        await this.insertScrollChapterRange(book,start,end,false,token);
      }finally{
        if(token===this.scrollRenderToken)this.scrollWindowBusy=false;
      }
    }

    async createScrollChapterElement(book,chapterIdx){
      const chapter=await this.loadChapter(book,chapterIdx);
      const section=document.createElement('section');
      section.className='scroll-chapter';
      section.dataset.ch=chapterIdx;
      const title=document.createElement('h1');
      title.dataset.ch=chapterIdx;
      title.textContent=chapter.title||`第 ${chapterIdx+1} 章`;
      section.appendChild(title);
      const paragraphs=ReaderCore.normalizeParagraphs(chapter.paragraphs||ReaderCore.splitParagraphs(chapter.content));
      paragraphs.forEach((text,paragraphIdx)=>{
        const paragraph=document.createElement('p');
        paragraph.dataset.ch=chapterIdx;
        paragraph.dataset.p=paragraphIdx;
        paragraph.textContent=text;
        section.appendChild(paragraph);
      });
      return section;
    }

    async insertScrollChapterRange(book,start,end,prepend,token){
      if(start>end)return false;
      const fragment=document.createDocumentFragment();
      for(let chapterIdx=start;chapterIdx<=end;chapterIdx++){
        if(token!==this.scrollRenderToken)return false;
        fragment.appendChild(await this.createScrollChapterElement(book,chapterIdx));
      }
      if(token!==this.scrollRenderToken)return false;
      if(prepend)this.readerContent.prepend(fragment);
      else this.readerContent.appendChild(fragment);
      this.scrollWindowStart=Math.min(this.scrollWindowStart,start);
      this.scrollWindowEnd=Math.max(this.scrollWindowEnd,end);
      this.invalidateMarkerCache();
      return true;
    }

    async extendScrollWindowAtEdge(){
      const book=this.getCurrentBook();
      if(!book||this.state.settings.mode!=='scroll'||this.scrollWindowBusy)return;
      const maxChapter=Math.max(0,(book.chapterCount||1)-1);
      const edge=Math.max(120,Math.floor(this.readerScroll.clientHeight*.45));
      const nearTop=this.readerScroll.scrollTop<=edge;
      const nearBottom=this.readerScroll.scrollTop+this.readerScroll.clientHeight>=this.readerScroll.scrollHeight-edge;
      if(!nearTop&&!nearBottom)return;
      const token=this.scrollRenderToken;
      this.scrollWindowBusy=true;
      try{
        if(nearBottom&&this.scrollWindowEnd<maxChapter){
          const end=Math.min(maxChapter,this.scrollWindowEnd+SCROLL_WINDOW_STEP);
          await this.insertScrollChapterRange(book,this.scrollWindowEnd+1,end,false,token);
          this.trimScrollWindow('top');
        }else if(nearTop&&this.scrollWindowStart>0){
          const start=Math.max(0,this.scrollWindowStart-SCROLL_WINDOW_STEP);
          const beforeHeight=this.readerContent.scrollHeight;
          const added=await this.insertScrollChapterRange(book,start,this.scrollWindowStart-1,true,token);
          if(added)this.readerScroll.scrollTop+=Math.max(0,this.readerContent.scrollHeight-beforeHeight);
          this.trimScrollWindow('bottom');
        }
      }finally{
        if(token===this.scrollRenderToken)this.scrollWindowBusy=false;
      }
    }

    trimScrollWindow(removeFrom){
      const sections=[...this.readerContent.querySelectorAll('.scroll-chapter[data-ch]')];
      if(sections.length<=SCROLL_WINDOW_MAX)return;
      const scrollTop=this.readerScroll.scrollTop;
      const viewportBottom=scrollTop+this.readerScroll.clientHeight;
      const buffer=Math.max(240,Math.floor(this.readerScroll.clientHeight*.4));
      const overlapping=sections.filter(section=>{
        const top=section.offsetTop;
        const bottom=top+section.offsetHeight;
        return bottom>scrollTop-buffer&&top<viewportBottom+buffer;
      }).length;
      const removable=Math.max(0,SCROLL_WINDOW_MAX-1-overlapping);
      let removedCount=0;
      while(removedCount<removable&&sections.length>SCROLL_WINDOW_MAX){
        const section=removeFrom==='top'?sections[0]:sections[sections.length-1];
        if(!section)break;
        const top=section.offsetTop;
        const bottom=top+section.offsetHeight;
        if(bottom>scrollTop-buffer&&top<viewportBottom+buffer)break;
        const chapter=Number(section.dataset.ch)||0;
        const beforeHeight=this.readerContent.scrollHeight;
        section.remove();
        if(removeFrom==='top'){
          const removedHeight=Math.max(0,beforeHeight-this.readerContent.scrollHeight);
          this.scrollWindowStart=chapter+1;
          this.readerScroll.scrollTop=Math.max(0,this.readerScroll.scrollTop-removedHeight);
        }else this.scrollWindowEnd=chapter-1;
        removedCount++;
        if(removeFrom==='top')sections.shift();
        else sections.pop();
      }
      this.invalidateMarkerCache();
    }

    renderPageMode(chapter,savedPosition){
      this.reader.classList.add('page-mode');
      const pageWidth=this.getReaderPageWidth();
      const gutter=PAGE_GUTTERS[this.state.settings.marginIdx]||PAGE_GUTTERS[1];
      const paragraphs=ReaderCore.normalizeParagraphs(chapter.paragraphs||ReaderCore.splitParagraphs(chapter.content));
      const renderDom=()=>{
        this.readerContent.innerHTML=this.pages.map((page,pageIndex)=>`<section class="page" data-page="${pageIndex}"><div class="page-inner">${page.blocks.map(block=>{
          if(block.type==='title')return '<h1>'+this.escape(block.text)+'</h1>';
          const cls=(block.continued?'continued':'')+(block.continues?' continues':'');
          return '<p data-p="'+block.paragraphIndex+'" data-start="'+block.start+'" data-end="'+block.end+'"'+(cls?' class="'+cls+'"':'')+'>'+this.escape(block.text)+'</p>';
        }).join('')}</div></section>`).join('');
        this.setPageAriaState();
      };
      let measured=null;
      try{
        measured=this.measurePaginateInDom(pageWidth,this.readerScroll.clientHeight,chapter.title,paragraphs);
      }catch(error){
        console.error('measure paginate failed, falling back',error);
      }
      if(measured&&measured.pages.length){
        this.pages=measured.pages;
        renderDom();
      }else{
        const verticalReserve=this.chromeVisible?194:116;
        const readableWidth=Math.min(680,Math.max(1,pageWidth-gutter*2));
        const width=Math.max(16,Math.floor(readableWidth/(this.state.settings.fontSize||18)));
        const measureLines=()=>Math.max(2,Math.floor((this.readerScroll.clientHeight-verticalReserve)/((this.state.settings.fontSize||18)*LINE_HEIGHTS[this.state.settings.lineHeightIdx])));
        let lines=measureLines();
        const paginate=()=>ReaderCore.paginatePlainText({title:chapter.title,paragraphs,charsPerLine:width,linesPerPage:lines});
        this.pages=paginate();
        renderDom();
        for(let attempt=0;attempt<5&&lines>2;attempt++){
          let worst=1;
          for(const pageEl of this.readerContent.children){
            const inner=pageEl.querySelector('.page-inner');
            if(!inner||inner.scrollHeight<=inner.clientHeight+1)continue;
            worst=Math.max(worst,inner.scrollHeight/Math.max(1,inner.clientHeight));
          }
          if(worst<=1.005)break;
          const nextLines=Math.max(2,Math.floor(lines/worst*.96));
          if(nextLines>=lines)lines=Math.max(2,lines-1);
          else lines=nextLines;
          this.pages=paginate();
          renderDom();
        }
      }
      if(savedPosition)this.currentPage=this.pageIndexForPosition(savedPosition);
      else this.currentPage=Math.min(this.currentPage||0,this.pages.length-1);
      this.readerContent.style.setProperty('--page-width',`${pageWidth}px`);
      this.readerContent.style.width=`${this.pages.length*pageWidth}px`;
      this.setPageTransform(false);
    }

    measurePaginateInDom(pageWidth,viewportHeight,title,paragraphs){
      const page=document.createElement('div');
      page.className='page';
      page.style.cssText=`position:absolute;left:-9999px;top:0;width:${pageWidth}px;height:${viewportHeight}px;`;
      const inner=document.createElement('div');
      inner.className='page-inner';
      page.appendChild(inner);
      this.reader.appendChild(page);
      try{
        const capacity=inner.clientHeight;
        if(!(capacity>0))return null;
        const pages=[];
        let blocks=[];
        let pIndex=0;
        let charOffset=0;
        const flushPage=()=>{
          if(!blocks.length)return;
          const firstBlock=blocks.find(block=>block.type==='p');
          pages.push({
            blocks,
            anchor:firstBlock?{paragraphIndex:firstBlock.paragraphIndex,charOffset:firstBlock.start}:{paragraphIndex:0,charOffset:0}
          });
          blocks=[];
          inner.textContent='';
        };
        const fits=()=>inner.scrollHeight<=inner.clientHeight;
        const makeP=(text,start,end,paraLen)=>{
          const el=document.createElement('p');
          el.textContent=text;
          if(start>0)el.classList.add('continued');
          if(end<paraLen)el.classList.add('continues');
          return el;
        };
        if(title){
          const heading=document.createElement('h1');
          heading.textContent=title;
          inner.appendChild(heading);
          blocks.push({type:'title',text:title});
        }
        while(pIndex<paragraphs.length){
          const source=paragraphs[pIndex];
          const remaining=source.slice(charOffset);
          const graphemes=ReaderCore.segmentGraphemes(remaining);
          const appended=makeP(remaining,charOffset,source.length,source.length);
          inner.appendChild(appended);
          if(fits()){
            blocks.push({type:'p',text:remaining,paragraphIndex:pIndex,start:charOffset,end:source.length,continued:charOffset>0,continues:false});
            pIndex++;
            charOffset=0;
            continue;
          }
          inner.removeChild(appended);
          let low=0,high=graphemes.length;
          while(low<high){
            const mid=Math.ceil((low+high)/2);
            const probeText=graphemes.slice(0,mid).join('');
            const probe=makeP(probeText,charOffset,charOffset+probeText.length,source.length);
            inner.appendChild(probe);
            if(fits())low=mid;
            else high=mid-1;
            inner.removeChild(probe);
          }
          let cursor=low;
          let missCount=0;
          const maxProbe=Math.min(graphemes.length,low+48);
          while(cursor<maxProbe&&missCount<2){
            cursor++;
            const probeText=graphemes.slice(0,cursor).join('');
            const probe=makeP(probeText,charOffset,charOffset+probeText.length,source.length);
            inner.appendChild(probe);
            if(fits()){
              low=cursor;
              missCount=0;
            }else{
              missCount++;
            }
            inner.removeChild(probe);
          }
          const CLOSING='，。！？；：、）》】』」〕〉］｝”’〗〙〛)]}';
          const OPENING='（《【『「〔〈［｛“‘〖〘〚([{';
          if(low<graphemes.length&&CLOSING.includes(graphemes[low])){
            let candidate=low;
            while(candidate<graphemes.length&&CLOSING.includes(graphemes[candidate]))candidate++;
            const probeText=graphemes.slice(0,candidate).join('');
            const probe=makeP(probeText,charOffset,charOffset+probeText.length,source.length);
            inner.appendChild(probe);
            if(fits()){
              low=candidate;
            }else{
              while(low>0&&CLOSING.includes(graphemes[low]))low--;
            }
            inner.removeChild(probe);
          }
          while(low>0&&OPENING.includes(graphemes[low-1]))low--;
          if(low===0&&blocks.length){
            flushPage();
            continue;
          }
          if(low===0)low=1;
          const prefix=graphemes.slice(0,low).join('');
          const endOffset=charOffset+prefix.length;
          inner.appendChild(makeP(prefix,charOffset,endOffset,source.length));
          blocks.push({type:'p',text:prefix,paragraphIndex:pIndex,start:charOffset,end:endOffset,continued:charOffset>0,continues:endOffset<source.length});
          charOffset=endOffset;
          if(endOffset>=source.length){
            pIndex++;
            charOffset=0;
          }else{
            flushPage();
          }
        }
        flushPage();
        return pages.length?{pages}:null;
      }finally{
        page.remove();
      }
    }

    setPageAriaState(){
      if(!this.readerContent)return;
      const pages=this.readerContent.querySelectorAll('.page');
      pages.forEach((page,index)=>page.setAttribute('aria-hidden',index===this.currentPage?'false':'true'));
    }

    getReaderPageWidth(){
      return Math.max(1,this.readerScroll.clientWidth||this.reader.clientWidth||window.innerWidth||1);
    }

    pageIndexForPosition(position){
      if(!this.pages.length)return 0;
      return ReaderCore.findPageIndexForAnchor(this.pages,position.paragraphIndex||0,position.charOffset||0);
    }

    invalidateMarkerCache(){
      this.markerCache=null;
    }

    getMarkerCache(){
      if(!this.markerCache||!this.markerCache.length){
        this.markerCache=[...this.readerContent.querySelectorAll('h1[data-ch],p[data-ch][data-p]')];
      }
      return this.markerCache;
    }

    capturePosition(){
      const book=this.getCurrentBook();
      if(!book)return null;
      let intra=0,paragraphIndex=0,paragraphOffsetPx=0,charOffset=0;
      if(this.state.settings.mode==='page'){
        intra=this.pages.length>1?this.currentPage/(this.pages.length-1):0;
        const anchor=this.pages[this.currentPage]&&this.pages[this.currentPage].anchor;
        if(anchor){paragraphIndex=anchor.paragraphIndex;charOffset=anchor.charOffset||0;}
      }else{
        const markers=this.getMarkerCache();
        if(markers.length){
          const focus=this.readerScroll.scrollTop+24;
          let low=0,high=markers.length-1,best=0;
          while(low<=high){
            const mid=(low+high)>>1;
            if(markers[mid].offsetTop<=focus){best=mid;low=mid+1;}
            else high=mid-1;
          }
          const chosen=markers[best];
          const chapter=Math.max(0,Number(chosen.dataset.ch)||0);
          this.currentChapter=chapter;
          const heading=this.readerContent.querySelector(`h1[data-ch="${chapter}"]`);
          const nextHeading=this.readerContent.querySelector(`h1[data-ch="${chapter+1}"]`);
          const chapterTop=heading?heading.offsetTop:chosen.offsetTop;
          const chapterBottom=nextHeading?nextHeading.offsetTop:this.readerContent.scrollHeight;
          intra=ReaderCore.clamp01((focus-chapterTop)/Math.max(1,chapterBottom-chapterTop));
          if(chosen.matches('p[data-p]')){
            paragraphIndex=Number(chosen.dataset.p)||0;
            paragraphOffsetPx=Math.max(0,focus-chosen.offsetTop);
          }
          const bookTitle=this.getCurrentBook()&&this.getCurrentBook().chapterTitles[chapter];
          if(bookTitle)this.$('reader-chapter-title').textContent=bookTitle;
        }
      }
      return ReaderCore.createReadingPosition({
        bookId:book.id,chapter:this.currentChapter,readingMode:this.state.settings.mode,
        currentPage:this.currentPage,pageCount:this.pages.length||1,
        paragraphIndex,paragraphOffsetPx,charOffset,intraChapterPercent:intra,
        totalProgress:ReaderCore.getTotalProgress(this.currentChapter,intra,book.chapterCount),
        timestamp:Date.now()
      });
    }

    restorePosition(position){
      if(!position)return;
      if(this.state.settings.mode==='page'){
        this.currentPage=this.pageIndexForPosition(position);
        this.setPageTransform(false);
        return;
      }
      const chapter=position.chapter!==undefined?position.chapter:this.currentChapter;
      const paragraph=this.readerContent.querySelector(`p[data-ch="${chapter}"][data-p="${position.paragraphIndex||0}"]`);
      if(paragraph)this.readerScroll.scrollTop=Math.max(0,paragraph.offsetTop+(position.paragraphOffsetPx||0)-24);
      else{
        const heading=this.readerContent.querySelector(`h1[data-ch="${chapter}"]`);
        if(heading)this.readerScroll.scrollTop=Math.max(0,heading.offsetTop-24);
        else this.readerScroll.scrollTop=0;
      }
    }

    async flushPosition(){
      const book=this.getCurrentBook();
      const pos=this.capturePosition();
      if(!book||!pos)return false;
      book.readingPosition=pos;
      book.progress=pos.totalProgress;
      book.lastRead=Date.now();
      let localWrote=false;
      try{localStorage.setItem(POSITION_PREFIX+book.id,JSON.stringify(pos));localWrote=true;}catch(error){}
      let idbWrote=false;
      if(this.db){try{await this.idb('positions','readwrite',s=>s.put(pos,book.id));idbWrote=true;}catch(error){}}
      try{await this.saveState();}catch(error){}
      return localWrote||idbWrote;
    }

    onScroll(){
      if(this.state.settings.mode==='page')return;
      this.hideSelectionBubble();
      clearTimeout(this.saveTimer);
      if(!this.scrollRaf){
        this.scrollRaf=requestAnimationFrame(()=>{
          this.scrollRaf=0;
          this.updateProgress();
          this.extendScrollWindowAtEdge().catch(error=>console.error('extend scroll window failed',error));
        });
      }
      this.saveTimer=setTimeout(()=>this.flushPosition(),400);
    }

    updateProgress(){
      const pos=this.capturePosition();
      if(!pos)return;
      const pct=Math.round(pos.totalProgress*100);
      if(this.state.settings.mode==='page'){
        this.$('progress-label').textContent=`${this.currentPage+1}/${Math.max(1,this.pages.length)}`;
        if(this.pageIndicator)this.pageIndicator.textContent=`${this.currentPage+1} / ${Math.max(1,this.pages.length)}`;
      }else{
        this.$('progress-label').textContent=`${pct}%`;
        if(this.pageIndicator)this.pageIndicator.textContent=`本章 ${Math.round(pos.intraChapterPercent*100)}%`;
      }
      this.$('progress-range').value=Math.round(pos.totalProgress*1000);
      const book=this.getCurrentBook();
      if(book)book.progress=pos.totalProgress;
    }

    stepForward(){
      return this.enqueueNavigation(context=>this.stepForwardOnce(context));
    }

    async stepForwardOnce(context){
      const book=this.getCurrentBook();
      if(!book)return;
      if(context&&!context.isActive())return;
      if(this.state.settings.mode==='scroll'){
        if(this.currentChapter<book.chapterCount-1){
          await this.scrollToChapter(this.currentChapter+1,context);
          this.restartAutoScroll();
        }
        return;
      }
      if(this.state.settings.mode==='page'){
        if(this.currentPage<this.pages.length-1){
          this.currentPage++;
          this.setPageTransform(true);
          this.scheduleChromeAutoHide();
          this.flushPosition();
          this.restartAutoScroll();
          return;
        }
        if(this.currentChapter<book.chapterCount-1){
          await this.goToChapter(this.currentChapter+1,null,context);
          this.restartAutoScroll();
        }
      }
    }

    stepBack(){
      return this.enqueueNavigation(context=>this.stepBackOnce(context));
    }

    async stepBackOnce(context){
      const book=this.getCurrentBook();
      if(!book)return;
      if(context&&!context.isActive())return;
      if(this.state.settings.mode==='scroll'){
        if(this.currentChapter>0){
          await this.scrollToChapter(this.currentChapter-1,context);
          this.restartAutoScroll();
        }
        return;
      }
      if(this.state.settings.mode==='page'&&this.currentPage>0){
        const target=ReaderCore.getPreviousPageTarget(this.currentChapter,this.currentPage,this.pages.length);
        this.currentPage=target.page;
        this.setPageTransform(true);
        this.scheduleChromeAutoHide();
        this.flushPosition();
        this.restartAutoScroll();
        return;
      }
      if(this.state.settings.mode==='page'&&this.currentChapter>0){
        await this.goToPreviousChapter(context);
        this.restartAutoScroll();
        return;
      }
      if(this.currentChapter>0){
        await this.goToChapter(this.currentChapter-1,null,context);
        this.restartAutoScroll();
      }
    }

    createNavContext(){
      const generation=this.navGeneration;
      return {
        isActive:()=>generation===this.navGeneration
      };
    }

    beginRenderIntent(bookId,chapter,mode){
      this.renderEpoch++;
      this.scrollRenderToken++;
      const epoch=this.renderEpoch;
      const targetBookId=bookId!==undefined?bookId:this.currentBookId;
      const targetChapter=chapter!==undefined?chapter:this.currentChapter;
      const targetMode=mode||this.state.settings.mode;
      return {
        bookId:targetBookId,
        epoch,
        chapter:targetChapter,
        mode:targetMode,
        isCurrent:()=>this.currentBookId===targetBookId&&this.renderEpoch===epoch
      };
    }

    enqueueNavigation(task){
      const context=this.createNavContext();
      const wrapped=()=>{
        if(!context.isActive())return Promise.resolve();
        return Promise.resolve().then(()=>task(context));
      };
      const taskPromise=this.navChain.then(wrapped);
      this.navChain=taskPromise.catch(()=>{});
      return taskPromise;
    }

    async goToChapter(chapter,position,context){
      if(!context)this.navGeneration++;
      if(context&&!context.isActive())return false;
      const book=this.getCurrentBook();
      if(!book)return false;
      const target=Math.max(0,Math.min(book.chapterCount-1,Math.floor(chapter)||0));
      if(target===this.currentChapter&&this.reader.classList.contains('active'))return true;
      const intent=this.beginRenderIntent(book.id,target,this.state.settings.mode);
      await this.flushPosition();
      if(!intent.isCurrent())return false;
      this.currentChapter=target;
      this.currentPage=0;
      await this.renderReader(position,intent);
      if(!intent.isCurrent())return false;
      this.updateProgress();
      return true;
    }

    async goToPreviousChapter(context){
      if(context&&!context.isActive())return;
      const book=this.getCurrentBook();
      if(!book||this.currentChapter<=0)return;
      const fromChapter=this.currentChapter;
      const intent=this.beginRenderIntent(book.id,fromChapter-1,this.state.settings.mode);
      await this.flushPosition();
      if(!intent.isCurrent())return;
      this.currentChapter=fromChapter-1;
      this.currentPage=0;
      await this.renderReader(undefined,intent);
      if(!intent.isCurrent())return;
      const target=ReaderCore.getPreviousPageTarget(fromChapter,0,this.pages.length);
      this.currentPage=target.page;
      this.setPageTransform(false);
      this.flushPosition();
    }

    setPageTransform(animated){
      const animation=this.state.settings.pageAnimation||'slide';
      this.reader.classList.toggle('page-fade',animation==='fade');
      this.readerContent.style.transition=animated&&animation==='slide'?'transform .22s cubic-bezier(.22,.61,.36,1)':'none';
      const pageWidth=this.getReaderPageWidth();
      this.readerContent.style.transform=`translate3d(${-this.currentPage*pageWidth}px,0,0)`;
      if(animated&&animation==='fade'){
        this.readerContent.animate([{opacity:.3},{opacity:1}],{duration:180,easing:'ease-out'});
      }
      this.setPageAriaState();
      this.updateProgress();
    }

    async jumpToProgress(progress){
      const book=this.getCurrentBook();
      if(!book)return;
      const raw=ReaderCore.clamp01(progress)*book.chapterCount;
      const targetChapter=Math.min(book.chapterCount-1,Math.floor(raw));
      const committed=await this.goToChapter(targetChapter);
      if(!committed)return;
      if(this.state.settings.mode==='scroll'){
        const heading=this.readerContent.querySelector(`h1[data-ch="${targetChapter}"]`);
        if(heading)this.readerScroll.scrollTop=Math.max(0,heading.offsetTop-24);
      }else{
        this.currentPage=Math.round((raw-targetChapter)*Math.max(0,this.pages.length-1));
        this.setPageTransform(false);
      }
      this.flushPosition();
    }

    async setMode(mode){
      if(this.state.settings.mode===mode)return;
      this.navGeneration++;
      const pos=this.capturePosition();
      const intent=this.beginRenderIntent(this.currentBookId,this.currentChapter,mode);
      this.state.settings.mode=mode;
      await this.renderReader(pos,intent);
      if(!intent.isCurrent())return;
      this.flushPosition();
      this.updateSettingControls();
    }

    async setLineHeight(idx){
      const pos=this.capturePosition();
      if(pos&&this.state.settings.mode==='page')pos.readingMode='anchor';
      const intent=this.beginRenderIntent(this.currentBookId,this.currentChapter,this.state.settings.mode);
      this.state.settings.lineHeightIdx=idx;
      this.applySettings();
      await this.renderReader(pos,intent);
      if(!intent.isCurrent())return;
      this.flushPosition();
      this.updateSettingControls();
    }

    async setMargin(idx){
      const pos=this.capturePosition();
      if(pos&&this.state.settings.mode==='page')pos.readingMode='anchor';
      const intent=this.beginRenderIntent(this.currentBookId,this.currentChapter,this.state.settings.mode);
      this.state.settings.marginIdx=Math.max(0,Math.min(2,Number(idx)||0));
      this.applySettings();
      await this.renderReader(pos,intent);
      if(!intent.isCurrent())return;
      this.flushPosition();
      this.updateSettingControls();
    }

    async setFontFamily(idx){
      const pos=this.capturePosition();
      if(pos&&this.state.settings.mode==='page')pos.readingMode='anchor';
      const intent=this.beginRenderIntent(this.currentBookId,this.currentChapter,this.state.settings.mode);
      this.state.settings.fontFamilyIdx=Math.max(0,Math.min(FONT_FAMILIES.length-1,Number(idx)||0));
      this.applySettings();
      if(this.currentBookId)await this.renderReader(pos,intent);
      if(!intent.isCurrent())return;
      this.flushPosition();
      this.updateSettingControls();
    }

    setPageAnimation(animation){
      this.state.settings.pageAnimation=['slide','fade','none'].includes(animation)?animation:'slide';
      this.saveState();
      this.updateSettingControls();
      this.showToast(this.state.settings.pageAnimation==='slide'?'平移翻页':this.state.settings.pageAnimation==='fade'?'淡入翻页':'已关闭动画');
    }

    async changeFont(delta){
      const pos=this.capturePosition();
      if(pos&&this.state.settings.mode==='page')pos.readingMode='anchor';
      const intent=this.beginRenderIntent(this.currentBookId,this.currentChapter,this.state.settings.mode);
      this.state.settings.fontSize=Math.max(14,Math.min(28,this.state.settings.fontSize+delta));
      this.applySettings();
      await this.renderReader(pos,intent);
      if(!intent.isCurrent())return;
      this.flushPosition();
      this.updateSettingControls();
    }

    async setTheme(idx){
      this.state.settings.themeIdx=idx;
      this.applySettings();
      this.flushPosition();
      this.updateSettingControls();
    }

    applySettings(themeIdxOverride){
      const settings=this.state.settings;
      const themeIdx=themeIdxOverride!==undefined?themeIdxOverride:this.effectiveThemeIdx();
      const theme=THEMES[themeIdx]||THEMES[0];
      const root=document.documentElement;
      root.style.setProperty('--reader-bg',theme.bg);
      root.style.setProperty('--reader-text',theme.text);
      root.style.setProperty('--font-size',`${settings.fontSize}px`);
      root.style.setProperty('--line-height',LINE_HEIGHTS[settings.lineHeightIdx]||LINE_HEIGHTS[1]);
      root.style.setProperty('--page-gutter',`${PAGE_GUTTERS[settings.marginIdx]||PAGE_GUTTERS[1]}px`);
      root.style.setProperty('--reader-font',FONT_FAMILIES[settings.fontFamilyIdx]||FONT_FAMILIES[0]);
      document.body.classList.toggle('theme-night',themeIdx===3);
      if(this.brightnessOverlay){
        const dim=Math.round((1-Math.max(.4,Math.min(1,Number(settings.brightness)||1)))*190);
        this.brightnessOverlay.style.background=`rgba(0,0,0,${dim/255})`;
      }
      if(this.brightnessRange)this.brightnessRange.value=Math.round((Math.max(.4,Math.min(1,Number(settings.brightness)||1)))*100);
      this.$('font-size-label').textContent=settings.fontSize;
      this.renderThemeOptions(themeIdx);
      this.updateSettingControls();
    }

    renderThemeOptions(activeIdx=this.state.settings.themeIdx){
      const box=this.$('theme-options');
      box.innerHTML=THEMES.map((theme,i)=>`<button class="theme-dot ${i===activeIdx?'active':''}" style="--dot:${theme.dot}" data-theme="${i}" type="button" aria-label="${theme.name}"></button>`).join('');
      box.querySelectorAll('[data-theme]').forEach(btn=>btn.addEventListener('click',()=>this.setTheme(Number(btn.dataset.theme))));
    }

    setNightMode(mode){
      this.state.settings.nightMode=['off','system','timer'].includes(mode)?mode:'off';
      this.saveState();
      this.applySettings();
      this.showToast(this.state.settings.nightMode==='system'?'夜间模式：跟随系统':this.state.settings.nightMode==='timer'?'夜间模式：21:00-7:00':'夜间模式：手动');
    }

    setVolumeKeyTurn(enabled){
      this.state.settings.volumeKeyTurn=!!enabled;
      this.saveState();
      this.updateSettingControls();
      this.setAndroidVolumeKeys(!!enabled);
      this.showToast(this.state.settings.volumeKeyTurn?'音量键翻页已开启':'音量键恢复为系统音量');
    }

    setAutoScroll(mode){
      this.state.settings.autoScroll=['off','slow','normal','fast'].includes(mode)?mode:'off';
      this.saveState();
      this.updateSettingControls();
      if(this.currentBookId&&this.state.settings.autoScroll!=='off')this.startAutoScroll();
      else this.stopAutoScroll();
      const labels={off:'自动翻页已关闭',slow:'自动翻页：慢速',normal:'自动翻页：中速',fast:'自动翻页：快速'};
      this.showToast(labels[this.state.settings.autoScroll]);
    }

    startAutoScroll(){
      this.stopAutoScroll();
      if(this.state.settings.autoScroll==='off'||!this.currentBookId)return;
      const speeds={slow:14000,normal:8000,fast:5000};
      const interval=speeds[this.state.settings.autoScroll]||8000;
      this.autoScrollTimer=setInterval(()=>{
        if(!this.currentBookId||!this.reader.classList.contains('active')){
          this.stopAutoScroll();
          return;
        }
        if(this.hasOpenOverlay())return;
        const selection=window.getSelection&&window.getSelection();
        if(selection&&!selection.isCollapsed)return;
        const book=this.getCurrentBook();
        if(!book)return;
        const mode=this.state.settings.mode;
        if(mode==='scroll'){
          const max=Math.max(0,this.readerScroll.scrollHeight-this.readerScroll.clientHeight);
          if(this.readerScroll.scrollTop>=max-4){
            if(this.currentChapter>=book.chapterCount-1){this.stopAutoScroll();this.showToast('已读完全书');return;}
            this.stepForward().catch(()=>{});
            return;
          }
          this.turnScrollPage(1);
        }else{
          if(this.currentPage>=this.pages.length-1&&this.currentChapter>=book.chapterCount-1){
            this.stopAutoScroll();
            this.showToast('已读完全书');
            return;
          }
          this.stepForward().catch(()=>{});
        }
      },interval);
    }

    stopAutoScroll(){
      clearInterval(this.autoScrollTimer);
      this.autoScrollTimer=null;
    }

    restartAutoScroll(){
      if(this.state.settings.autoScroll!=='off')this.startAutoScroll();
    }

    setBrightness(value){
      this.state.settings.brightness=Math.max(.4,Math.min(1,Number(value)||1));
      this.applySettings();
      this.saveState();
    }

    updateSettingControls(){
      document.querySelectorAll('[data-mode]').forEach(btn=>{const active=btn.dataset.mode===this.state.settings.mode;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',active?'true':'false');});
      document.querySelectorAll('[data-line]').forEach(btn=>{const active=Number(btn.dataset.line)===this.state.settings.lineHeightIdx;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',active?'true':'false');});
      document.querySelectorAll('[data-margin]').forEach(btn=>{const active=Number(btn.dataset.margin)===this.state.settings.marginIdx;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',active?'true':'false');});
      document.querySelectorAll('[data-font]').forEach(btn=>{const active=Number(btn.dataset.font)===this.state.settings.fontFamilyIdx;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',active?'true':'false');});
      document.querySelectorAll('[data-animation]').forEach(btn=>{const active=btn.dataset.animation===this.state.settings.pageAnimation;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',active?'true':'false');});
      document.querySelectorAll('[data-night]').forEach(btn=>{const active=btn.dataset.night===this.state.settings.nightMode;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',active?'true':'false');});
      document.querySelectorAll('[data-autoscroll]').forEach(btn=>{const active=btn.dataset.autoscroll===(this.state.settings.autoScroll||'off');btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',active?'true':'false');});
      document.querySelectorAll('[data-volume]').forEach(btn=>{const active=btn.dataset.volume==='on'===!!this.state.settings.volumeKeyTurn;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',active?'true':'false');});
      this.$('font-size-label').textContent=this.state.settings.fontSize;
    }

    openToc(){
      const book=this.getCurrentBook();
      if(!book)return;
      this.tocFilter.value='';
      this.renderTocList(book,'');
      this.openSheet(this.tocSheet);
      requestAnimationFrame(()=>{
        const active=this.tocList.querySelector('.toc-item.active');
        if(active&&active.scrollIntoView)active.scrollIntoView({block:'center'});
      });
    }

    renderTocList(book,filter=''){
      const needle=String(filter||'').toLocaleLowerCase();
      const progressChapter=book.readingPosition&&book.readingPosition.chapter;
      this.tocList.innerHTML=book.chapterTitles.map((title,i)=>{
        const active=i===this.currentChapter;
        const read=i<Number(progressChapter||0);
        const progress=active?'正在读':read?'已读':`第 ${i+1} 章`;
        const match=!needle||String(title).toLocaleLowerCase().includes(needle);
        return `<button class="toc-item ${active?'active':''} ${match?'':'filtered-out'}" data-ch="${i}" type="button" ${active?'aria-current="true"':''}>
          <span class="toc-index">${String(i+1).padStart(2,'0')}</span>
          <span class="toc-copy">
            <strong class="toc-title">${this.escape(title)}</strong>
            <span class="toc-progress">${progress}</span>
          </span>
        </button>`;
      }).join('');
      this.tocList.querySelectorAll('[data-ch]').forEach(btn=>btn.addEventListener('click',async()=>{
        const chapter=Number(btn.dataset.ch);
        this.closeSheets();
        await this.goToChapter(chapter);
      }));
    }

    filterToc(){
      const book=this.getCurrentBook();
      if(!book)return;
      this.renderTocList(book,this.tocFilter.value);
    }

    async scrollToChapter(chapter,context){
      if(context&&!context.isActive())return;
      const book=this.getCurrentBook();
      if(!book)return;
      const target=Math.max(0,Math.min(book.chapterCount-1,Number(chapter)||0));
      const intent=this.beginRenderIntent(book.id,target,this.state.settings.mode);
      let heading=this.readerContent.querySelector(`h1[data-ch="${target}"]`);
      if(!heading){
        await this.renderContinuousScrollContent(book,target);
        await new Promise(resolve=>requestAnimationFrame(resolve));
        if(!intent.isCurrent())return;
        this.currentChapter=target;
        heading=this.readerContent.querySelector(`h1[data-ch="${target}"]`);
      }
      if(!heading)return;
      this.currentChapter=target;
      this.readerScroll.scrollTop=Math.max(0,heading.offsetTop-24);
      this.$('reader-chapter-title').textContent=book.chapterTitles[target]||`第 ${target+1} 章`;
      if(!intent.isCurrent())return;
      this.updateProgress();
      this.flushPosition();
    }

    openSheet(sheet){
      this.hideSelectionBubble(true);
      this.closeOverlays(false);
      clearTimeout(this.chromeTimer);
      this.setChromeVisible(true);
      sheet.classList.add('open');
      this.scrim.classList.add('show');
      this.syncVisibilityState();
    }

    restoreFocus(){
      if(this._focusRestoring)return;
      this._focusRestoring=true;
      try{
        const trigger=this.lastTrigger;
        this.lastTrigger=null;
        if(trigger&&trigger.focus&&trigger.isConnected&&!trigger.disabled){
          const rect=trigger.getBoundingClientRect();
          if((rect.width>0||rect.height>0)&&!trigger.closest('[inert],[aria-hidden="true"]')){
            trigger.focus();
          }
        }
      }catch(error){}
      this._focusRestoring=false;
    }

    closeSheets(hideScrim=true){
      this.settingsSheet.classList.remove('open');
      this.tocSheet.classList.remove('open');
      this.bookActions.classList.remove('open');
      if(this.libraryMenu)this.libraryMenu.classList.remove('open');
      if(hideScrim)this.scrim.classList.remove('show');
      this.syncVisibilityState();
      this.scheduleChromeAutoHide();
      if(hideScrim)this.restoreFocus();
    }

    openFeaturePanel(panel){
      this.hideSelectionBubble(true);
      this.closeOverlays(false);
      panel.classList.add('open');
      this.scrim.classList.add('show');
      this.syncVisibilityState();
    }

    closeFeaturePanels(hideScrim=true){
      this.searchRunId++;
      this.searchPanel.classList.remove('open');
      this.bookmarksPanel.classList.remove('open');
      if(this.trashPanel)this.trashPanel.classList.remove('open');
      if(hideScrim)this.scrim.classList.remove('show');
      this.syncVisibilityState();
      if(hideScrim)this.restoreFocus();
    }

    closeOverlays(hideScrim=true){
      this.closeSheets(false);
      this.closeFeaturePanels(false);
      if(hideScrim)this.scrim.classList.remove('show');
      this.syncVisibilityState();
      if(hideScrim)this.restoreFocus();
    }

    hasOpenOverlay(){
      return [this.settingsSheet,this.tocSheet,this.bookActions,this.searchPanel,this.bookmarksPanel,this.libraryMenu,this.trashPanel].some(panel=>panel&&panel.classList.contains('open'));
    }

    toggleChrome(){
      this.setChromeVisible(!this.chromeVisible);
      if(this.chromeVisible)this.scheduleChromeAutoHide();
      else clearTimeout(this.chromeTimer);
    }

    setChromeVisible(visible){
      this.chromeVisible=!!visible;
      this.reader.classList.toggle('chrome-hidden',!this.chromeVisible);
    }

    scheduleChromeAutoHide(delay){
      clearTimeout(this.chromeTimer);
      if(this.hasOpenOverlay())return;
      this.chromeTimer=setTimeout(()=>{
        if(this.hasOpenOverlay())return;
        this.setChromeVisible(false);
      },delay||2800);
    }

    async closeReader(){
      this.navGeneration++;
      this.renderEpoch++;
      this.scrollRenderToken++;
      await this.flushPosition();
      this.stopAutoScroll();
      clearTimeout(this.chromeTimer);
      this.hideSelectionBubble(true);
      this.closeOverlays();
      this.reader.classList.remove('active','page-mode','chrome-hidden');
      this.chromeVisible=true;
      this.library.classList.remove('hidden');
      this.currentBookId=null;
      this.setAndroidVolumeKeys(false);
      this.setAndroidImmersive(false);
      this.syncVisibilityState();
      this.renderLibrary();
    }

    syncVisibilityState(){
      const readerActive=this.reader&&this.reader.classList.contains('active');
      const settingsOpen=this.settingsSheet&&this.settingsSheet.classList.contains('open');
      const tocOpen=this.tocSheet&&this.tocSheet.classList.contains('open');
      const bookActionsOpen=this.bookActions&&this.bookActions.classList.contains('open');
      const libraryMenuOpen=this.libraryMenu&&this.libraryMenu.classList.contains('open');
      const searchOpen=this.searchPanel&&this.searchPanel.classList.contains('open');
      const bookmarksOpen=this.bookmarksPanel&&this.bookmarksPanel.classList.contains('open');
      const trashOpen=this.trashPanel&&this.trashPanel.classList.contains('open');
      const libraryBlocked=readerActive||searchOpen||bookmarksOpen||bookActionsOpen||libraryMenuOpen||trashOpen;
      const overlayOpen=settingsOpen||tocOpen||bookActionsOpen||libraryMenuOpen||searchOpen||bookmarksOpen||trashOpen;
      if(this.library){
        this.library.setAttribute('aria-hidden',libraryBlocked?'true':'false');
        this.library.inert=!!libraryBlocked;
      }
      if(this.reader){
        this.reader.setAttribute('aria-hidden',readerActive&&!overlayOpen?'false':'true');
        this.reader.inert=!readerActive||overlayOpen;
      }
      if(this.settingsSheet){
        this.settingsSheet.setAttribute('aria-hidden',settingsOpen?'false':'true');
        this.settingsSheet.inert=!settingsOpen;
      }
      if(this.tocSheet){
        this.tocSheet.setAttribute('aria-hidden',tocOpen?'false':'true');
        this.tocSheet.inert=!tocOpen;
      }
      if(this.bookActions){
        this.bookActions.setAttribute('aria-hidden',bookActionsOpen?'false':'true');
        this.bookActions.inert=!bookActionsOpen;
      }
      if(this.libraryMenu){
        this.libraryMenu.setAttribute('aria-hidden',libraryMenuOpen?'false':'true');
        this.libraryMenu.inert=!libraryMenuOpen;
      }
      if(this.searchPanel){
        this.searchPanel.setAttribute('aria-hidden',searchOpen?'false':'true');
        this.searchPanel.inert=!searchOpen;
      }
      if(this.bookmarksPanel){
        this.bookmarksPanel.setAttribute('aria-hidden',bookmarksOpen?'false':'true');
        this.bookmarksPanel.inert=!bookmarksOpen;
      }
      if(this.trashPanel){
        this.trashPanel.setAttribute('aria-hidden',trashOpen?'false':'true');
        this.trashPanel.inert=!trashOpen;
      }
    }

    rerenderPreservingPosition(){
      clearTimeout(this.resizeTimer);
      this.resizeTimer=setTimeout(async()=>{
        if(!this.currentBookId)return;
        const intent=this.beginRenderIntent(this.currentBookId,this.currentChapter,this.state.settings.mode);
        const pos=this.capturePosition();
        await this.renderReader(pos,intent);
      },180);
    }

    getCurrentBook(){
      return this.state.books.find(book=>book.id===this.currentBookId)||null;
    }

    setAndroidVolumeKeys(enabled){
      try{if(window.AndroidReader)window.AndroidReader.setReaderVolumeKeyEnabled(!!enabled);}catch(e){}
    }

    setAndroidImmersive(enabled){
      try{if(window.AndroidReader)window.AndroidReader.setReaderImmersiveEnabled(!!enabled);}catch(e){}
    }

    showToast(message){
      this.toastEl.textContent=message;
      this.toastEl.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer=setTimeout(()=>this.toastEl.classList.remove('show'),1800);
    }

    showToastAction(message,actionLabel,onAction){
      this.toastEl.textContent=message;
      this.toastEl.classList.add('show','toast-action');
      const action=document.createElement('button');
      action.type='button';
      action.className='toast-action-btn';
      action.textContent=actionLabel;
      action.addEventListener('click',()=>{
        this.toastEl.classList.remove('show','toast-action');
        clearTimeout(this.toastTimer);
        try{onAction();}catch(error){console.error('toast action failed',error);}
      });
      this.toastEl.appendChild(action);
      clearTimeout(this.toastTimer);
      this.toastTimer=setTimeout(()=>this.toastEl.classList.remove('show','toast-action'),8000);
    }

    escape(value){
      return String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
  }

  window.NovelReaderApp=NovelReaderApp;
  document.addEventListener('DOMContentLoaded',()=>{
    window.readerApp=new NovelReaderApp();
    window.readerApp.init().catch(err=>{
      console.error(err);
      const toast=document.getElementById('toast');
      if(toast){toast.textContent='启动失败，请刷新重试';toast.classList.add('show');}
    });
  });
})();
