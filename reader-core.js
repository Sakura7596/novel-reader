(function(root){
  'use strict';

  const ReaderCore={};

  function clamp01(value){
    return Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
  }

  function normalizeParagraphs(paragraphs){
    return (Array.isArray(paragraphs)?paragraphs:[])
      .map(paragraph=>String(paragraph||'').replace(/^[\s\u3000]+/,'').replace(/[\s\u3000]+$/,''))
      .filter(Boolean);
  }

  function splitParagraphs(content){
    return normalizeParagraphs(String(content||'')
      .replace(/\r\n/g,'\n')
      .replace(/\r/g,'\n')
      .split(/\n+/));
  }

  const CN_DIGITS='零〇一二三四五六七八九十百千万两亿壹贰叁肆伍陆柒捌玖拾佰仟';
  const VOLUME_HEADER_PATTERN=new RegExp(`^\\s*第\\s*[${CN_DIGITS}\\d]+\\s*[卷部篇](?!的)[^\\n]{0,40}\\s*$`);
  const SPECIAL_HEADER=`(?:序\\s*章|终\\s*章|尾\\s*声|后\\s*记|序言|前言|楔子)(?:\\s+\\S[^\\n]{0,39})?`;
  const CHAPTER_HEADER_PATTERN=new RegExp(`^\\s*(?:第\\s*[${CN_DIGITS}\\d]+\\s*[章节回幕](?!的|正文|内容)[^\\n]{0,40}|番外(?:\\s+\\S[^\\n]{0,40})?|${SPECIAL_HEADER})\\s*$`);
  const NUMERIC_HEADER_PATTERN=/^([1-9]\d{0,4})[、.．]\s*\S{1,40}$/;
  const CHAPTER_MODE_SAMPLE_BYTES=256*1024;

  function isVolumeHeader(line){
    return line.length<=48&&VOLUME_HEADER_PATTERN.test(line);
  }

  function isChapterHeader(line){
    return line.length<=48&&CHAPTER_HEADER_PATTERN.test(line);
  }

  function createChapterParser(options){
    options=options||{};
    const numericMode=!!options.numericMode;
    let remainder='';
    let title='';
    let body=[];
    let started=false;
    let firstChunk=true;
    let finished=false;
    let lastNumeric=0;

    function emit(nextTitle,output){
      const content=body.join('\n').replace(/\n{3,}/g,'\n\n').trim();
      if(content){
        output.push({
          title:title||'序',
          content,
          paragraphs:splitParagraphs(content)
        });
      }
      title=nextTitle||'';
      body=[];
    }

    function matchHeader(line){
      if(isVolumeHeader(line)){
        return {kind:'volume',title:line};
      }
      if(isChapterHeader(line)){
        return {kind:'chapter',title:line};
      }
      if(numericMode){
        const match=NUMERIC_HEADER_PATTERN.exec(line);
        if(match&&line.length<=48){
          const num=Number(match[1]);
          if(num>lastNumeric)return {kind:'chapter',title:line,num};
          return null;
        }
      }
      return null;
    }

    function acceptLine(raw,output){
      const line=raw.trim();
      if(!line||line==='正文'||line==='------------')return;
      const header=matchHeader(line);
      if(header){
        if(header.kind==='volume'){
          lastNumeric=0;
          if(started||body.length)emit(header.title,output);
          else title=header.title;
          started=true;
          return;
        }
        if(header.num!==undefined)lastNumeric=header.num;
        if(started||body.length){
          if(title&&!body.length){
            title=header.title;
          }else{
            emit(header.title,output);
          }
        }else{
          title=header.title;
        }
        started=true;
        return;
      }
      body.push(raw);
    }

    return {
      push(chunk){
        if(finished)throw new Error('chapter parser already finished');
        let source=String(chunk||'');
        if(firstChunk&&source.charCodeAt(0)===0xFEFF)source=source.slice(1);
        firstChunk=false;
        source=(remainder+source).replace(/\r\n/g,'\n').replace(/\r/g,'\n');
        const lines=source.split('\n');
        remainder=lines.pop()||'';
        const output=[];
        lines.forEach(raw=>acceptLine(raw,output));
        return output;
      },
      finish(){
        if(finished)return [];
        finished=true;
        const output=[];
        if(remainder)acceptLine(remainder,output);
        remainder='';
        emit('',output);
        return output.filter(chapter=>chapter.title||chapter.content);
      }
    };
  }

  function detectChapterMode(text){
    const sample=String(text||'').slice(0,CHAPTER_MODE_SAMPLE_BYTES);
    const lines=sample.split(/\r?\n/);
    let standard=0,numeric=0,strictInc=0;
    let lastNum=0;
    for(const raw of lines){
      const line=raw.trim();
      if(!line)continue;
      if(isChapterHeader(line)||isVolumeHeader(line)){
        standard++;
        continue;
      }
      const match=NUMERIC_HEADER_PATTERN.exec(line);
      if(match&&line.length<=48){
        const num=Number(match[1]);
        if(numeric===0){
          numeric++;
          lastNum=num;
          continue;
        }
        numeric++;
        if(num>lastNum)strictInc++;
        lastNum=num;
      }
    }
    const incRate=numeric>1?strictInc/(numeric-1):0;
    return numeric>=10&&incRate>=0.9&&numeric>standard*3;
  }

  function segmentGraphemes(text){
    const source=String(text||'');
    if(typeof Intl!=='undefined'&&Intl.Segmenter){
      try{
        return [...new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(source)].map(part=>part.segment);
      }catch(error){}
    }
    const result=[];
    for(let index=0;index<source.length;){
      const code=source.codePointAt(index);
      const size=code>0xFFFF?2:1;
      let end=index+size;
      while(end<source.length){
        const cp=source.codePointAt(end);
        const isZwj=cp===0x200D;
        const isVariation=cp>=0xFE00&&cp<=0xFE0F;
        const isModifier=cp>=0x1F3FB&&cp<=0x1F3FF;
        const isCombining=cp>=0x0300&&cp<=0x036F;
        if(isZwj||isVariation||isModifier||isCombining){
          const step=cp>0xFFFF?2:1;
          end+=step;
          if(isZwj&&end<source.length){
            const next=source.codePointAt(end);
            end+=(next>0xFFFF?2:1);
          }
          continue;
        }
        break;
      }
      result.push(source.slice(index,end));
      index=end;
    }
    return result;
  }

  function parseChaptersFromText(text,options){
    const numericMode=options&&options.numericMode!==undefined?!!options.numericMode:detectChapterMode(text);
    const parser=createChapterParser({numericMode});
    return [...parser.push(text),...parser.finish()];
  }

  function parseTitleFromFilename(name){
    const clean=String(name||'').replace(/\.[^.]+$/,'').trim();
    const parts=clean.split(/\s*[-_—]\s*/).filter(Boolean);
    if(parts.length>=2){
      return {title:parts.slice(0,-1).join('-').trim(),author:parts[parts.length-1].trim()};
    }
    return {title:clean||'未命名小说',author:'未知作者'};
  }

  function getChapterCount(book){
    return Math.max(1,(book&&(book.chapterCount||(book.chapters&&book.chapters.length)))||1);
  }

  function getTotalProgress(chapter,intraChapterPercent,chapterCount){
    const count=getChapterCount({chapterCount});
    const safeChapter=Math.max(0,Math.min(Math.floor(chapter||0),count-1));
    return clamp01((safeChapter+clamp01(intraChapterPercent))/count);
  }

  function getPreviousPageTarget(chapter,currentPage,previousChapterPageCount){
    const safeChapter=Math.max(0,Math.floor(chapter||0));
    const safePage=Math.max(0,Math.floor(currentPage||0));
    if(safePage>0)return {chapter:safeChapter,page:safePage-1};
    if(safeChapter===0)return {chapter:0,page:0};
    return {
      chapter:safeChapter-1,
      page:Math.max(0,Math.floor(previousChapterPageCount||1)-1)
    };
  }

  function createReadingPosition(input){
    const page=Math.max(0,Math.floor(input.currentPage??input.page??0));
    const pageCount=Math.max(1,Math.floor(input.pageCount||1));
    const totalProgress=clamp01(input.totalProgress??input.scrollPercent??0);
    return {
      v:5,
      bookId:input.bookId,
      chapter:Math.max(0,Math.floor(input.chapter||0)),
      readingMode:input.readingMode||input.mode||'scroll',
      currentPage:page,
      page,
      pageCount,
      paragraphIndex:Math.max(0,Math.floor(input.paragraphIndex??input.paragraph??0)),
      paragraphOffsetPx:Math.max(0,Number(input.paragraphOffsetPx)||0),
      charOffset:Math.max(0,Math.floor(input.charOffset??0)),
      intraChapterPercent:clamp01(input.intraChapterPercent||0),
      scrollPercent:totalProgress,
      totalProgress,
      timestamp:Number.isFinite(Number(input.timestamp))?Number(input.timestamp):Date.now()
    };
  }

  function normalizeReadingPosition(pos,book){
    if(!pos||typeof pos.chapter!=='number')return null;
    const count=getChapterCount(book);
    const chapter=Math.max(0,Math.min(Math.floor(pos.chapter),count-1));
    const mode=pos.readingMode||pos.mode||'scroll';
    const page=Math.max(0,Math.floor(pos.currentPage??pos.page??0));
    const pageCount=Math.max(1,Math.floor(pos.pageCount||1));
    const legacyIntra=typeof pos.scrollPercent==='number'?clamp01(pos.scrollPercent*count-chapter):0;
    const pageIntra=mode==='page'&&pageCount>1?page/(pageCount-1):legacyIntra;
    const intra=clamp01(typeof pos.intraChapterPercent==='number'?pos.intraChapterPercent:pageIntra);
    const total=typeof pos.totalProgress==='number'?clamp01(pos.totalProgress):getTotalProgress(chapter,mode==='page'?pageIntra:intra,count);
    return createReadingPosition({
      bookId:book?book.id:pos.bookId,
      chapter,
      readingMode:mode,
      currentPage:page,
      pageCount,
      paragraphIndex:pos.paragraphIndex??pos.paragraph??0,
      paragraphOffsetPx:pos.paragraphOffsetPx||0,
      charOffset:pos.charOffset||0,
      intraChapterPercent:intra,
      totalProgress:total,
      timestamp:Number.isFinite(Number(pos.timestamp))?Number(pos.timestamp):0
    });
  }

  function chooseBestReadingPosition(candidates,book){
    return (candidates||[])
      .map(pos=>normalizeReadingPosition(pos,book))
      .filter(Boolean)
      .sort((a,b)=>(b.timestamp||0)-(a.timestamp||0))[0]||null;
  }

  function normalizeAppStateDefaults(state){
    if(!state)return state;
    if(!Array.isArray(state.books))state.books=[];
    if(!Array.isArray(state.bookmarks))state.bookmarks=[];
    if(!state.settings)state.settings={};
    if(!state.settings.mode)state.settings.mode=state.readingMode||'scroll';
    if(typeof state.settings.fontSize!=='number')state.settings.fontSize=state.fontSize||18;
    if(typeof state.settings.lineHeightIdx!=='number')state.settings.lineHeightIdx=state.lineHeightIdx||1;
    if(typeof state.settings.marginIdx!=='number')state.settings.marginIdx=state.marginIdx||1;
    if(typeof state.settings.themeIdx!=='number')state.settings.themeIdx=state.themeIdx||0;
    if(typeof state.settings.fontFamilyIdx!=='number')state.settings.fontFamilyIdx=state.fontFamilyIdx||0;
    state.settings.fontFamilyIdx=Math.max(0,Math.min(2,Math.floor(state.settings.fontFamilyIdx)));
    if(!state.settings.pageAnimation)state.settings.pageAnimation=state.pageAnimation||'slide';
    if(!state.settings.brightness)state.settings.brightness=1;
    state.settings.brightness=Math.max(.4,Math.min(1,Number(state.settings.brightness)||1));
    if(!state.settings.nightMode)state.settings.nightMode='off';
    if(!['off','system','timer'].includes(state.settings.nightMode))state.settings.nightMode='off';
    if(!state.settings.autoScroll)state.settings.autoScroll='off';
    if(!['off','slow','normal','fast'].includes(state.settings.autoScroll))state.settings.autoScroll='off';
    if(typeof state.settings.volumeKeyTurn!=='boolean')state.settings.volumeKeyTurn=false;
    if(!state.sortMode)state.sortMode='recent';
    if(!state.stats||typeof state.stats!=='object')state.stats={date:null,minutes:0,totalMinutes:0};
    return state;
  }

  function isNightTime(date){
    const hours=(date||new Date()).getHours();
    return hours>=21||hours<7;
  }

  function paginatePlainText(options){
    const title=options.title||'';
    const paragraphs=normalizeParagraphs(options.paragraphs||[]);
    const charsPerLine=Math.max(8,Math.floor(options.charsPerLine||22));
    const linesPerPage=Math.max(2,Math.floor(options.linesPerPage||18));
    const pages=[];
    let blocks=[];
    let lines=0;
    function blockLines(text){
      return Math.max(1,Math.ceil(String(text||'').length/charsPerLine));
    }
    function push(){
      if(!blocks.length)return;
      const first=blocks.find(b=>b.type==='p');
      pages.push({
        blocks,
        anchor:first?{paragraphIndex:first.paragraphIndex,charOffset:first.start||0}:{paragraphIndex:0,charOffset:0}
      });
      blocks=[];
      lines=0;
    }
    if(title){
      blocks.push({type:'title',text:title});
      lines+=2;
    }
    paragraphs.forEach((paragraph,paragraphIndex)=>{
      let start=0;
      const text=String(paragraph);
      while(start<text.length){
        const remaining=text.slice(start);
        const capacity=Math.max(1,(linesPerPage-lines)*charsPerLine);
        const take=Math.min(remaining.length,capacity);
        const chunk=remaining.slice(0,take);
        const needed=blockLines(chunk);
        if(lines+needed>linesPerPage&&blocks.length){
          push();
          continue;
        }
        blocks.push({type:'p',text:chunk,paragraphIndex,start,end:start+chunk.length});
        lines+=needed+1;
        start+=chunk.length;
        if(lines>=linesPerPage)push();
      }
    });
    push();
    return pages.length?pages:[{blocks:title?[{type:'title',text:title}]:[],anchor:{paragraphIndex:0,charOffset:0}}];
  }

  function findPageIndexForAnchor(pages,paragraphIndex,charOffset){
    const list=Array.isArray(pages)?pages:[];
    if(!list.length)return 0;
    const targetParagraph=Math.max(0,Math.floor(paragraphIndex||0));
    const targetOffset=Math.max(0,Math.floor(charOffset||0));
    let best=0;
    for(let i=0;i<list.length;i++){
      const anchor=list[i]&&list[i].anchor;
      if(!anchor)continue;
      const pageParagraph=Math.max(0,Math.floor(anchor.paragraphIndex||0));
      const pageOffset=Math.max(0,Math.floor(anchor.charOffset||0));
      if(pageParagraph<targetParagraph||(pageParagraph===targetParagraph&&pageOffset<=targetOffset))best=i;
      else break;
    }
    return Math.max(0,Math.min(best,list.length-1));
  }

  function normalizeBookmarks(bookmarks,books){
    const bookList=Array.isArray(books)?books:[];
    const bookMap=new Map(bookList.map(book=>[book.id,book]));
    return (Array.isArray(bookmarks)?bookmarks:[]).map((bookmark,index)=>{
      if(!bookmark||typeof bookmark!=='object')return null;
      const legacyBook=Number.isInteger(bookmark.bookIdx)?bookList[bookmark.bookIdx]:null;
      const bookId=bookmark.bookId||(legacyBook&&legacyBook.id);
      const book=bookMap.get(bookId);
      if(!book)return null;
      const chapterCount=getChapterCount(book);
      const chapterIdx=Math.max(0,Math.min(Math.floor(bookmark.chapterIdx??bookmark.chapter??0),chapterCount-1));
      return {
        id:bookmark.id||`bookmark_${bookmark.timestamp||Date.now()}_${index}`,
        bookId,
        chapterIdx,
        paragraphIndex:Math.max(0,Math.floor(bookmark.paragraphIndex??bookmark.paragraph??0)),
        charOffset:Math.max(0,Math.floor(bookmark.charOffset??0)),
        text:String(bookmark.text||'').slice(0,500),
        note:String(bookmark.note||''),
        timestamp:Number.isFinite(Number(bookmark.timestamp))?Number(bookmark.timestamp):0
      };
    }).filter(Boolean);
  }

  function makeSearchSnippet(content,query,maxLength){
    const source=String(content||'').replace(/\s+/g,' ').trim();
    const needle=String(query||'').trim();
    const limit=Math.max(4,Math.floor(maxLength||80));
    if(source.length<=limit)return source;
    const match=needle?source.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()):-1;
    if(match<0)return source.slice(0,limit-1)+'…';
    let bodyLength=Math.max(1,limit-2);
    let start=Math.max(0,Math.min(match-Math.floor((bodyLength-needle.length)/2),source.length-bodyLength));
    if(start===0)bodyLength=limit-1;
    let end=Math.min(source.length,start+bodyLength);
    if(end===source.length&&start>0){
      bodyLength=limit-1;
      start=Math.max(0,source.length-bodyLength);
      end=source.length;
    }
    const prefix=start>0?'…':'';
    const suffix=end<source.length?'…':'';
    return prefix+source.slice(start,end)+suffix;
  }

  Object.assign(ReaderCore,{
    clamp01,
    splitParagraphs,
    normalizeParagraphs,
    createChapterParser,
    parseChaptersFromText,
    parseTitleFromFilename,
    normalizeAppStateDefaults,
    normalizeReadingPosition,
    chooseBestReadingPosition,
    createReadingPosition,
    getTotalProgress,
    getPreviousPageTarget,
    paginatePlainText,
    findPageIndexForAnchor,
    normalizeBookmarks,
    makeSearchSnippet,
    isNightTime,
    detectChapterMode,
    segmentGraphemes
  });

  root.ReaderCore=ReaderCore;
  if(typeof window!=='undefined')window.ReaderCore=ReaderCore;
  if(typeof module!=='undefined'&&module.exports)module.exports=ReaderCore;
})(typeof window!=='undefined'?window:globalThis);
