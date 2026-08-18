const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

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
  const cssAlpha = value => {
    const text = String(value || '').trim();
    if (!text || text === 'transparent') return 0;
    const rgbaMatch = text.match(new RegExp('rgba\\\\([^,]+,[^,]+,[^,]+,\\\\s*([\\\\d.]+)\\\\)'));
    const slashMatch = text.match(new RegExp('/\\\\s*([\\\\d.]+)\\\\)'));
    if (rgbaMatch) return Number(rgbaMatch[1]);
    if (slashMatch) return Number(slashMatch[1]);
    return 1;
  };
  const ready = async () => {
    for (let i = 0; i < 120; i++) {
      if (window.readerApp && readerApp.state && readerApp.state.books.length) return;
      await wait(50);
    }
    throw new Error('readerApp not ready');
  };
  const run = async () => {
    await ready();
    document.documentElement.setAttribute('data-rebuilt-stage','ready');
    const app = window.readerApp;
    if (window.matchMedia('(max-width: 520px)').matches) {
      const shelfChapters = [{ title: '第一章', content: '用于书架布局测试。', paragraphs: ['用于书架布局测试。'] }];
      const shelfBooks = [
        app.createBook('龙族（实体版1-3部全本）', '江南', shelfChapters, 'linear-gradient(145deg,#315d72,#74a0af)'),
        app.createBook('红楼梦', '曹雪芹', shelfChapters, 'linear-gradient(145deg,#8b0000,#b12020)'),
        app.createBook('斗罗大陆3龙王传说', '唐家三少', shelfChapters, 'linear-gradient(145deg,#7740a1,#b069c8)')
      ];
      app.state.books = shelfBooks;
      for (const book of shelfBooks) await app.saveChapters(book.id, shelfChapters);
      app.saveState();
      app.renderLibrary();
      await wait(80);
      const cover = document.querySelector('.book-cover');
      const grid = document.querySelector('#book-grid');
      const title = document.querySelector('.library-header h1');
      const importButton = document.querySelector('#import-btn');
      const continueCard = document.querySelector('#continue-card');
      const continueCover = document.querySelector('.continue-cover');
      const continueButton = continueCard.querySelector('button');
      const headerActions = document.querySelector('.library-header .header-actions');
      const coverRect = cover.getBoundingClientRect();
      const gridColumns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
      const titleSize = parseFloat(getComputedStyle(title).fontSize);
      const importRect = importButton.getBoundingClientRect();
      const continueRect = continueCard.getBoundingClientRect();
      const continueRadius = parseFloat(getComputedStyle(continueCard).borderTopLeftRadius);
      const continueStyles = getComputedStyle(continueCard);
      const continueButtonRect = continueButton.getBoundingClientRect();
      const continueButtonBg = getComputedStyle(continueButton).backgroundColor;
      const continueMeterRect = continueCard.querySelector('.continue-meter').getBoundingClientRect();
      const continueMeterFillBg = getComputedStyle(continueCard.querySelector('.continue-meter i')).backgroundColor;
      const bookProgressBg = getComputedStyle(document.querySelector('.book-progress')).backgroundColor;
      const headerActionsRect = headerActions.getBoundingClientRect();
      const shellBg = getComputedStyle(document.querySelector('.app-shell')).backgroundImage;
      const continueBgImage = getComputedStyle(continueCard).backgroundImage;
      const coverBinding = cover.querySelector('.book-cover-binding');
      const coverFrame = cover.querySelector('.book-cover-frame');
      const coverMeta = cover.querySelector('.book-cover-meta');
      const headerButtons = [...headerActions.querySelectorAll('button')].map(button => {
        const rect = button.getBoundingClientRect();
        const styles = getComputedStyle(button);
        return {
          id: button.id,
          width: rect.width,
          height: rect.height,
          background: styles.backgroundColor,
          border: styles.borderTopStyle,
          boxShadow: styles.boxShadow
        };
      });
      const headerActionStyles = getComputedStyle(headerActions);
      const heavyHeaderButton = headerButtons.find(button => {
        const match = button.background.match(new RegExp('rgba?\\\\((\\\\d+),\\\\s*(\\\\d+),\\\\s*(\\\\d+)(?:,\\\\s*([\\\\d.]+))?'));
        const alpha = match && match[4] !== undefined ? Number(match[4]) : (match ? 1 : 0);
        return alpha > 0.2 || button.border !== 'none' || button.boxShadow !== 'none';
      });
      const firstRowCards = [...document.querySelectorAll('.book-card')].slice(0, 3).map(card => {
        const cardRect = card.getBoundingClientRect();
        const coverRect = card.querySelector('.book-cover').getBoundingClientRect();
        const progressRect = card.querySelector('.book-progress').getBoundingClientRect();
        const metaRect = card.querySelector('.book-meta').getBoundingClientRect();
        const titleRect = card.querySelector('.book-meta strong').getBoundingClientRect();
        const countRect = card.querySelector('.book-meta span').getBoundingClientRect();
        return {
          title: card.querySelector('.book-meta strong').textContent,
          cardTop: cardRect.top,
          coverTop: coverRect.top,
          progressTop: progressRect.top,
          progressBottom: progressRect.bottom,
          titleBottom: titleRect.bottom,
          countTop: countRect.top,
          countBottom: countRect.bottom,
          metaHeight: metaRect.height,
          cardHeight: cardRect.height
        };
      });
      const coverTopSpread = Math.max(...firstRowCards.map(card => card.coverTop)) - Math.min(...firstRowCards.map(card => card.coverTop));
      const progressTopSpread = Math.max(...firstRowCards.map(card => card.progressTop)) - Math.min(...firstRowCards.map(card => card.progressTop));
      const countTopSpread = Math.max(...firstRowCards.map(card => card.countTop)) - Math.min(...firstRowCards.map(card => card.countTop));
      const progressBottomSpread = Math.max(...firstRowCards.map(card => card.progressBottom)) - Math.min(...firstRowCards.map(card => card.progressBottom));
      document.documentElement.setAttribute('data-rebuilt-layout', JSON.stringify({
        coverWidth: coverRect.width,
        gridColumns,
        titleSize,
        importHeight: importRect.height,
        continueHeight: continueRect.height,
        continueRadius,
        continueButtonWidth: continueButtonRect.width,
        continueButtonBg,
        bookProgressBg,
        headerButtons,
        firstRowCards,
        coverTopSpread,
        progressTopSpread
      }));
      if (heavyHeaderButton) {
        throw new Error('mobile shelf actions should be one light toolbar, not four floating white buttons: ' + JSON.stringify({
          heavyHeaderButton,
          headerButtons
        }));
      }
      if (headerButtons.some(button => button.width < 48 || button.height < 48)) {
        throw new Error('mobile shelf action hit targets should stay at least 48px: ' + JSON.stringify(headerButtons));
      }
      if (headerActionsRect.top < 32) {
        throw new Error('mobile shelf toolbar should breathe below the status/cutout area: ' + JSON.stringify({
          top: headerActionsRect.top,
          height: headerActionsRect.height
        }));
      }
      if (headerActionsRect.width > innerWidth * 0.62) {
        throw new Error('mobile shelf toolbar is still visually dominant; keep utility actions compact beside the title: ' + JSON.stringify({
          width: headerActionsRect.width,
          innerWidth
        }));
      }
      if (
        cssAlpha(headerActionStyles.backgroundColor) > 0.16 ||
        headerActionStyles.borderTopStyle !== 'none' ||
        headerActionStyles.boxShadow !== 'none'
      ) {
        throw new Error('mobile shelf toolbar should be a quiet utility rail, not a floating frosted card: ' + JSON.stringify({
          background: headerActionStyles.backgroundColor,
          border: headerActionStyles.borderTopStyle,
          boxShadow: headerActionStyles.boxShadow
        }));
      }
      const shellColors = [...shellBg.matchAll(new RegExp('rgb\\\\((\\\\d+),\\\\s*(\\\\d+),\\\\s*(\\\\d+)\\\\)', 'g'))].map(match => match.slice(1, 4).map(Number));
      if (!shellColors.some(([r, g, b]) => b >= r - 14 && g >= r - 10)) {
        throw new Error('bookshelf background still reads as one-note warm beige instead of a calmer reading surface: ' + shellBg);
      }
      if (continueBgImage === 'none') {
        throw new Error('continue card should have a deliberate reading-focus surface, not a flat translucent block');
      }
      if (continueStyles.borderTopStyle !== 'none' || parseFloat(continueStyles.borderTopLeftRadius) > 7) {
        throw new Error('continue reading should feel like an integrated reading strip, not a bordered card: ' + JSON.stringify({
          border: continueStyles.borderTopStyle,
          radius: continueStyles.borderTopLeftRadius
        }));
      }
      if (coverTopSpread > 1) {
        throw new Error('bookshelf first-row covers should align to the same top edge: ' + JSON.stringify({ coverTopSpread, firstRowCards }));
      }
      if (progressTopSpread > 1) {
        throw new Error('bookshelf first-row progress bars should align despite one-line/two-line titles: ' + JSON.stringify({ progressTopSpread, firstRowCards }));
      }
      if (countTopSpread > 1 || progressBottomSpread > 1) {
        throw new Error('bookshelf metadata should use stable rows so chapter counts and progress bars do not stair-step: ' + JSON.stringify({
          countTopSpread,
          progressBottomSpread,
          firstRowCards
        }));
      }
      if (!coverBinding || !coverFrame || !coverMeta) {
        throw new Error('book covers should read as designed book objects, not plain color blocks');
      }
      if (gridColumns < 3) throw new Error('mobile bookshelf should show a denser 3-column library grid');
      if (coverRect.width > 124) throw new Error('mobile book cover is still too large and card-like');
      if (titleSize > 34) throw new Error('mobile library title is too large');
      if (importRect.height > 50) throw new Error('mobile import button is too tall');
      if (importRect.width > 96) throw new Error('mobile import action should be compact and not dominate the shelf header');
      if (continueRect.height > 156) throw new Error('mobile continue card is too tall: ' + JSON.stringify({
        height: continueRect.height,
        radius: continueRadius,
        text: continueCard.textContent.trim().replace(new RegExp('\\\\s+', 'g'), ' ').slice(0, 120)
      }));
      if (continueRadius > 7) throw new Error('mobile continue card radius is too soft');
      if (!continueCover) throw new Error('continue card should include a book-cover visual anchor');
      if (continueButtonRect.width > 72) {
        throw new Error('mobile continue action should be a light resume control, not a dominant rectangular CTA: ' + JSON.stringify({
          width: continueButtonRect.width,
          height: continueButtonRect.height,
          text: continueButton.textContent.trim()
        }));
      }
      const continueBgAlpha = cssAlpha(continueButtonBg);
      if (continueBgAlpha > 0.2) {
        throw new Error('mobile continue action should be visually light, not a solid accent block: ' + continueButtonBg);
      }
      if (continueMeterRect.height > 2 || cssAlpha(continueMeterFillBg) > 0.72) {
        throw new Error('continue progress should be a subtle reading memory trace, not a dominant divider: ' + JSON.stringify({
          height: continueMeterRect.height,
          fill: continueMeterFillBg
        }));
      }
    }
    if (getComputedStyle(document.querySelector('#reader-bottombar')).pointerEvents !== 'none') {
      throw new Error('reader bottom chrome should not block page tap zones');
    }
    if (getComputedStyle(document.querySelector('#reader-topbar')).pointerEvents !== 'none') {
      throw new Error('reader top chrome should not block page tap zones');
    }
    if (!document.querySelector('#reader-bottombar #settings-btn') || document.querySelector('#reader-topbar #settings-btn')) {
      throw new Error('settings button should live in the bottom reader chrome, not the top title bar');
    }
    if (!document.querySelector('[data-animation="slide"]')) throw new Error('page animation setting is missing');
    if (!document.querySelector('[data-margin]')) throw new Error('reader margin setting is missing');
    if (!document.querySelector('.settings-body') || document.querySelectorAll('.settings-card').length < 2) {
      throw new Error('settings sheet should use compact grouped control panels');
    }
    window.__androidReaderCalls = [];
    window.AndroidReader = {
      setReaderVolumeKeyEnabled(enabled) {
        window.__androidReaderCalls.push(['volume', !!enabled]);
      },
      setReaderImmersiveEnabled(enabled) {
        window.__androidReaderCalls.push(['immersive', !!enabled]);
      }
    };
    const longParagraphs = Array.from({ length: 36 }, (_, i) => (i % 2 ? '　　' : '    ') + '长章节第 ' + (i + 1) + ' 段，专门用于验证滚动和翻页模式切换时不会回到章首。'.repeat(3));
    const longChapters = [1, 2, 3].map(index => ({
      title: '第' + index + '章 长文',
      content: longParagraphs.map(text => '第' + index + '章 ' + text).join('\\n'),
      paragraphs: longParagraphs.map(text => '第' + index + '章 ' + text)
    }));
    const longBook = app.createBook('长文定位测试', '自动测试', longChapters, 'linear-gradient(145deg,#315d72,#74a0af)');
    app.state.books = [longBook];
    await app.saveChapters(longBook.id, longChapters);
    app.saveState();
    app.renderLibrary();
    await app.openReader(app.state.books[0].id);
    document.documentElement.setAttribute('data-rebuilt-stage','opened');
    if (!window.__androidReaderCalls.some(call => call[0] === 'immersive' && call[1] === true)) {
      throw new Error('opening the reader should request Android immersive system bars: ' + JSON.stringify(window.__androidReaderCalls));
    }
    await wait(200);
    await app.setMode('scroll');
    await wait(200);
    await wait(1400);
    if (app.reader.classList.contains('chrome-hidden')) throw new Error('reader chrome should remain visible until the reader explicitly hides it');
    app.toggleChrome();
    await wait(100);
    if (!app.reader.classList.contains('chrome-hidden')) throw new Error('center tap should hide reader chrome');
    app.toggleChrome();
    await wait(100);
    if (app.reader.classList.contains('chrome-hidden')) throw new Error('second center tap should show reader chrome');
    const continuousHeadings = [...app.readerContent.querySelectorAll('h1[data-ch]')];
    if (continuousHeadings.length !== longChapters.length) throw new Error('scroll mode should render every chapter into one continuous document');
    const normalizedFirstParagraph = app.readerContent.querySelector('p[data-ch="0"][data-p="0"]');
    if (!normalizedFirstParagraph || /^\s|^　/.test(normalizedFirstParagraph.textContent)) {
      throw new Error('reader should remove TXT source indentation before applying its fixed first-line indent');
    }
    app.readerScroll.scrollTop = Math.max(0, continuousHeadings[1].offsetTop - 24);
    app.updateProgress();
    if (app.capturePosition().chapter !== 1) throw new Error('continuous scroll position should identify the visible chapter');
    app.readerScroll.scrollTop = 0;
    app.updateProgress();
    const targetPara = app.readerContent.querySelector('p[data-p="18"]');
    if (!targetPara) throw new Error('long chapter paragraph missing');
    app.readerScroll.scrollTop = Math.max(0, targetPara.offsetTop - 24);
    app.updateProgress();
    await app.flushPosition();
    document.documentElement.setAttribute('data-rebuilt-stage','saved-scroll');
    const saved = app.getCurrentBook().readingPosition;
    if (!saved || saved.chapter !== 0 || saved.paragraphIndex < 16) throw new Error('missing saved scroll position');
    await app.closeReader();
    if (!window.__androidReaderCalls.some(call => call[0] === 'immersive' && call[1] === false)) {
      throw new Error('closing the reader should restore Android system bars: ' + JSON.stringify(window.__androidReaderCalls));
    }
    document.documentElement.setAttribute('data-rebuilt-stage','closed');
    await app.openReader(app.state.books[0].id);
    document.documentElement.setAttribute('data-rebuilt-stage','reopened');
    await wait(200);
    const restored = app.capturePosition();
    if (restored.chapter !== saved.chapter) throw new Error('restore chapter mismatch');
    if (restored.paragraphIndex < 15) throw new Error('restore paragraph regressed');
    await app.setMode('page');
    document.documentElement.setAttribute('data-rebuilt-stage','page-mode');
    await wait(200);
    app.setChromeVisible(true);
    await wait(60);
    const firstPageBlock = app.readerContent.querySelector('.page-inner h1, .page-inner p');
    const topChromeRect = app.$('reader-topbar').getBoundingClientRect();
    const firstBlockRect = firstPageBlock.getBoundingClientRect();
      if (firstBlockRect.top < topChromeRect.bottom + 10) {
        throw new Error('visible reader top chrome overlaps text: ' + JSON.stringify({
          chromeBottom: topChromeRect.bottom,
        firstTop: firstBlockRect.top,
        firstText: firstPageBlock.textContent.slice(0, 50)
      }));
    }
      if (window.matchMedia('(max-width: 520px)').matches) {
        const bottomChromeRect = app.$('reader-bottombar').getBoundingClientRect();
        const topChromeStyles = getComputedStyle(app.$('reader-topbar'));
        const bottomChromeStyles = getComputedStyle(app.$('reader-bottombar'));
        const titleWrapRect = document.querySelector('.reader-title-wrap').getBoundingClientRect();
        const titleWrapStyles = getComputedStyle(document.querySelector('.reader-title-wrap'));
        const topButtons = [...document.querySelectorAll('#reader-topbar .reader-control')].map(button => {
        const rect = button.getBoundingClientRect();
        const styles = getComputedStyle(button);
        return {
          width: rect.width,
          height: rect.height,
          background: styles.backgroundColor,
          border: styles.borderTopStyle,
          boxShadow: styles.boxShadow
        };
      });
      const heavyTopButton = topButtons.find(button => {
        const match = button.background.match(new RegExp('rgba?\\\\((\\\\d+),\\\\s*(\\\\d+),\\\\s*(\\\\d+)(?:,\\\\s*([\\\\d.]+))?'));
        const alpha = match && match[4] !== undefined ? Number(match[4]) : (match ? 1 : 0);
        return alpha > 0.18 || button.border !== 'none' || button.boxShadow !== 'none';
      });
      if (heavyTopButton) {
        throw new Error('mobile top reader controls should be light glyph controls, not floating white buttons: ' + JSON.stringify({
          heavyTopButton,
          topButtons
        }));
      }
      if (topChromeRect.height > 88) {
        throw new Error('visible reader top chrome is too heavy for mobile reading: ' + JSON.stringify({
          height: topChromeRect.height
        }));
      }
      if (cssAlpha(topChromeStyles.backgroundColor) < 0.72 || cssAlpha(bottomChromeStyles.backgroundColor) < 0.72) {
        throw new Error('visible reader controls need opaque backgrounds so prose does not show through: ' + JSON.stringify({
          top: topChromeStyles.backgroundColor,
          bottom: bottomChromeStyles.backgroundColor
        }));
      }
      if (titleWrapRect.width > innerWidth * 0.48 || parseFloat(titleWrapStyles.opacity || '1') > 0.82) {
        throw new Error('reader title hint should stay secondary so it does not compete with prose: ' + JSON.stringify({
          width: titleWrapRect.width,
          opacity: titleWrapStyles.opacity
        }));
      }
      if (bottomChromeRect.height > 78) {
        throw new Error('visible reader bottom chrome is too heavy for mobile reading: ' + JSON.stringify({
          height: bottomChromeRect.height
        }));
      }
      const progressArea = document.querySelector('.progress-area');
      const progressRange = document.querySelector('#progress-range');
      const progressAreaRect = progressArea.getBoundingClientRect();
      const progressRangeRect = progressRange.getBoundingClientRect();
      const progressAreaStyles = getComputedStyle(progressArea);
      if (
        progressAreaRect.width > innerWidth * 0.28 ||
        progressAreaRect.height > 54 ||
        cssAlpha(progressAreaStyles.backgroundColor) > 0.22 ||
        progressAreaStyles.borderTopStyle !== 'none'
      ) {
        throw new Error('reader progress control should feel like a native lightweight HUD, not a bordered form field: ' + JSON.stringify({
          width: progressAreaRect.width,
          height: progressAreaRect.height,
          border: progressAreaStyles.borderTopStyle,
          background: progressAreaStyles.backgroundColor
        }));
      }
      if (progressRangeRect.height > 52) {
        throw new Error('reader progress range should use a compact custom track, not the bulky default range control: ' + progressRangeRect.height);
      }
      app.openSheet(app.settingsSheet);
      await wait(80);
      const settingsSheetRect = document.querySelector('#settings-sheet').getBoundingClientRect();
      const settingsBodyRect = document.querySelector('#settings-sheet .settings-body').getBoundingClientRect();
      const settingsCards = [...document.querySelectorAll('#settings-sheet .settings-card')].map(card => {
        const rect = card.getBoundingClientRect();
        const styles = getComputedStyle(card);
        return {
          height: rect.height,
          background: styles.backgroundColor,
          borderTop: styles.borderTopStyle,
          borderRight: styles.borderRightStyle,
          borderBottom: styles.borderBottomStyle,
          borderLeft: styles.borderLeftStyle,
          radius: parseFloat(styles.borderTopLeftRadius)
        };
      });
      if (settingsSheetRect.height > innerHeight * 0.62) {
        throw new Error('settings sheet should feel like a compact reader control deck, not a tall form drawer: ' + settingsSheetRect.height);
      }
      if (settingsBodyRect.height > innerHeight * 0.55) {
        throw new Error('settings controls are too vertically heavy for one-handed reading adjustment: ' + settingsBodyRect.height);
      }
      const cardLikeSettings = settingsCards.find(card => (
        card.borderRight !== 'none' ||
        card.borderBottom !== 'none' ||
        card.borderLeft !== 'none' ||
        cssAlpha(card.background) > 0.62 ||
        card.radius > 7
      ));
      if (cardLikeSettings) {
        throw new Error('settings groups should be quiet control sections, not nested cards: ' + JSON.stringify(settingsCards));
      }
      app.closeSheets();
      await wait(60);
    }
    app.setChromeVisible(false);
    await wait(60);
    const pagePos = app.capturePosition();
    if (pagePos.readingMode !== 'page') throw new Error('mode did not switch to page');
    if (pagePos.currentPage < 1 || pagePos.paragraphIndex < 12) throw new Error('scroll to page switch lost anchor');
    const anchorTargetPage = app.pages[Math.max(1, Math.min(app.pages.length - 1, pagePos.currentPage))];
    const stalePagePosition = {
      ...pagePos,
      currentPage: 0,
      page: 0,
      paragraphIndex: anchorTargetPage.anchor.paragraphIndex,
      charOffset: anchorTargetPage.anchor.charOffset
    };
    const expectedAnchorPage = ReaderCore.findPageIndexForAnchor(app.pages, stalePagePosition.paragraphIndex, stalePagePosition.charOffset);
    if (app.pageIndexForPosition(stalePagePosition) !== expectedAnchorPage) {
      throw new Error('page restore should prefer its text anchor when a saved page index is stale');
    }
    const pageParagraph = app.readerContent.querySelector('.page-inner p');
    const pageInnerWidth = app.readerContent.querySelector('.page-inner').getBoundingClientRect().width;
    if (pageInnerWidth > 650) throw new Error('page text measure is too wide for long-form reading');
    const paragraphStyle = getComputedStyle(pageParagraph);
    if (paragraphStyle.textAlign === 'justify') {
      throw new Error('reader paragraphs should avoid browser justification gaps on Chinese prose: ' + paragraphStyle.textAlign);
    }
    if (parseFloat(paragraphStyle.wordSpacing) > 1) throw new Error('reader paragraphs should not introduce visible word-spacing gaps');
    const density = {
      lineRatio: parseFloat(paragraphStyle.lineHeight) / parseFloat(paragraphStyle.fontSize),
      marginRatio: parseFloat(paragraphStyle.marginBottom) / parseFloat(paragraphStyle.fontSize)
    };
    document.documentElement.setAttribute('data-reader-density', JSON.stringify(density));
    if (density.lineRatio > 1.72) throw new Error('page mode line height is too loose');
    if (density.marginRatio > 0.86) throw new Error('page mode paragraph spacing is too loose');
    await app.setMode('scroll');
    document.documentElement.setAttribute('data-rebuilt-stage','scroll-mode-again');
    await wait(200);
    const afterModeRoundTrip = app.capturePosition();
    if (afterModeRoundTrip.readingMode !== 'scroll') throw new Error('mode did not switch back to scroll');
    if (afterModeRoundTrip.paragraphIndex < 10) throw new Error('page to scroll switch lost anchor');
    const scrollMaxForKeys = Math.max(0, app.readerScroll.scrollHeight - app.readerScroll.clientHeight);
    app.readerScroll.scrollTop = Math.min(Math.max(0, scrollMaxForKeys - app.readerScroll.clientHeight * 1.2), Math.floor(scrollMaxForKeys * 0.35));
    const beforeSKey = app.readerScroll.scrollTop;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }));
    await wait(100);
    const afterSKey = app.readerScroll.scrollTop;
    if (afterSKey <= beforeSKey) throw new Error('S key did not advance scroll-mode reading');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true, cancelable: true }));
    await wait(100);
    if (app.readerScroll.scrollTop >= afterSKey) throw new Error('W key did not move scroll-mode reading backward');
    app.setChromeVisible(false);
    await wait(50);
    const beforeScrollTap = app.readerScroll.scrollTop;
    const scrollTapTarget = document.elementFromPoint(Math.floor(innerWidth * 0.84), Math.floor(innerHeight * 0.5));
    scrollTapTarget.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: Math.floor(innerWidth * 0.84),
      clientY: Math.floor(innerHeight * 0.5)
    }));
    await wait(320);
    if (app.readerScroll.scrollTop <= beforeScrollTap + app.readerScroll.clientHeight * 0.45) {
      throw new Error('scroll mode right-side tap did not advance by a readable page: ' + JSON.stringify({
        beforeScrollTap,
        afterScrollTap: app.readerScroll.scrollTop,
        viewport: app.readerScroll.clientHeight,
        target: scrollTapTarget && {
          tag: scrollTapTarget.tagName,
          id: scrollTapTarget.id,
          className: String(scrollTapTarget.className)
        }
      }));
    }
    await app.setMode('page');
    await wait(200);
    const beforeFontChapter = app.capturePosition().chapter;
    await app.changeFont(2);
    document.documentElement.setAttribute('data-rebuilt-stage','font-changed');
    await wait(200);
    document.documentElement.setAttribute('data-rebuilt-stage','after-font-wait');
    const afterFont = app.capturePosition();
    document.documentElement.setAttribute('data-rebuilt-stage','after-font-capture');
    document.documentElement.setAttribute('data-rebuilt-values', JSON.stringify({ afterChapter: afterFont.chapter, beforeFontChapter }));
    if (afterFont.chapter !== beforeFontChapter) throw new Error('font change lost chapter');
    const beforeMargin = app.capturePosition();
    await app.setMargin(2);
    await wait(200);
    const afterMargin = app.capturePosition();
    if (afterMargin.chapter !== beforeMargin.chapter) throw new Error('margin change lost chapter');
    const currentPageBlocks = (app.pages[app.currentPage] && app.pages[app.currentPage].blocks || []).filter(block => block.type === 'p');
    const visibleParagraphs = currentPageBlocks.map(block => block.paragraphIndex);
    const preservedOnPage = visibleParagraphs.includes(beforeMargin.paragraphIndex) || visibleParagraphs.includes(beforeMargin.paragraphIndex + 1);
    if (!preservedOnPage) {
      throw new Error('margin change lost reading anchor: ' + JSON.stringify({
        beforeMargin,
        afterMargin,
        currentPage: app.currentPage,
        pages: app.pages.length,
        marginIdx: app.state.settings.marginIdx,
        visibleParagraphs
      }));
    }
    app.setChromeVisible(true);
    await wait(280);
    app.currentPage = 0;
    app.setPageTransform(false);
    const settingsButtonRect = document.querySelector('#settings-btn').getBoundingClientRect();
    const settingsIcon = document.querySelector('#settings-btn svg');
    const settingsIconCircleCount = settingsIcon ? settingsIcon.querySelectorAll('circle').length : 0;
    if (settingsIconCircleCount < 3) {
      throw new Error('settings icon should read as sliders/tuning controls, not a plus-like glyph');
    }
    if (settingsButtonRect.top < innerHeight * 0.68) {
      throw new Error('settings button should be in the bottom reader chrome: ' + JSON.stringify({
        top: settingsButtonRect.top,
        bottom: settingsButtonRect.bottom,
        innerHeight
      }));
    }
    const beforeVisibleBottomTap = app.currentPage;
    const visibleBottomTarget = document.elementFromPoint(Math.floor(innerWidth * 0.86), innerHeight - 44);
    if (visibleBottomTarget && visibleBottomTarget.closest && visibleBottomTarget.closest('#reader-bottombar .reader-control')) {
      throw new Error('visible bottom reader chrome should not occupy the bottom-right page-turn corner: ' + JSON.stringify({
        target: {
          tag: visibleBottomTarget.tagName,
          id: visibleBottomTarget.id,
          className: String(visibleBottomTarget.className)
        }
      }));
    }
    visibleBottomTarget.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: Math.floor(innerWidth * 0.86),
      clientY: innerHeight - 44
    }));
    await wait(260);
    if (app.currentPage !== beforeVisibleBottomTap + 1) {
      throw new Error('visible chrome bottom-right reader tap should turn page, not open controls: ' + JSON.stringify({
        beforeVisibleBottomTap,
        afterVisibleBottomTap: app.currentPage,
        target: visibleBottomTarget && {
          tag: visibleBottomTarget.tagName,
          id: visibleBottomTarget.id,
          className: String(visibleBottomTarget.className)
        },
        settingsOpen: app.settingsSheet.classList.contains('open')
      }));
    }
    app.openSheet(app.settingsSheet);
    await wait(280);
    const sheetRect = app.settingsSheet.getBoundingClientRect();
    const activeSetting = app.settingsSheet.querySelector('.segmented button.active');
    const activeBgText = getComputedStyle(activeSetting).backgroundColor;
    const activeBgAlpha = cssAlpha(activeBgText);
    const activeBgMatch = activeBgText.match(new RegExp('rgba?\\\\((\\\\d+),\\\\s*(\\\\d+),\\\\s*(\\\\d+)'));
    if (!activeBgMatch) {
      throw new Error('could not parse active setting background color: ' + activeBgText);
    }
    const activeBg = activeBgMatch.slice(1, 4).map(Number);
    if (activeBgAlpha > 0.35) {
      throw new Error('settings selected controls should use a light state layer, not solid filled buttons: ' + activeBgText);
    }
    if (activeBg[0] < 55 && activeBg[1] < 55 && activeBg[2] < 55) {
      throw new Error('settings selected controls should use the reading accent, not a harsh black block: ' + activeBgText);
    }
    if (sheetRect.height > innerHeight * 0.68) {
      throw new Error('settings sheet is too tall for one-handed reading adjustments: ' + JSON.stringify({
        height: sheetRect.height,
        innerHeight
      }));
    }
    if (window.matchMedia('(max-width: 520px)').matches) {
      const cards = [...document.querySelectorAll('.settings-card')].map(card => {
        const rect = card.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          text: card.textContent.trim().replace(new RegExp('\\\\s+', 'g'), ' ').slice(0, 80)
        };
      });
      const tallCard = cards.find(card => card.height > 480);
      if (tallCard) {
        throw new Error('mobile settings cards should stay compact, not force controls into tall columns: ' + JSON.stringify({
          tallCard,
          cards
        }));
      }
    }
    app.closeSheets();
    await wait(80);
    app.openToc();
    await wait(160);
    const tocItem = document.querySelector('#toc-list .toc-item');
    const activeTocItem = document.querySelector('#toc-list .toc-item.active');
    if (!tocItem || !tocItem.querySelector('.toc-index') || !tocItem.querySelector('.toc-title') || !tocItem.querySelector('.toc-progress')) {
      throw new Error('toc should render mature structured list rows with index, title and progress marker, not plain text buttons');
    }
    if (!activeTocItem || activeTocItem.getAttribute('aria-current') !== 'true') {
      throw new Error('toc should expose the current chapter state with aria-current');
    }
    const tocItemRect = tocItem.getBoundingClientRect();
    const tocTitle = tocItem.querySelector('.toc-title');
    if (tocItemRect.height < 48 || tocTitle.textContent.trim().length === 0) {
      throw new Error('toc rows should be touch-friendly and keep chapter title visible: ' + JSON.stringify({
        height: tocItemRect.height,
        title: tocTitle.textContent
      }));
    }
    app.closeSheets();
    await wait(80);
    app.showBookActions(longBook.id);
    await wait(160);
    const actionRows = [...document.querySelectorAll('#book-actions .action-row')];
    const deleteAction = document.querySelector('#delete-book-btn.action-row.danger-action');
    if (actionRows.length < 2 || !deleteAction || document.querySelector('#book-actions .danger-button')) {
      throw new Error('book actions should use a compact action-list component with a separated danger row, not a single old danger button');
    }
    const malformedAction = actionRows.find(row => !row.querySelector('svg') || !row.querySelector('.action-copy') || !row.querySelector('.action-meta'));
    if (malformedAction) {
      throw new Error('book action rows should include icon, title and helper text for scannable mobile actions');
    }
    const actionRowRects = actionRows.map(row => row.getBoundingClientRect());
    if (actionRowRects.some(rect => rect.height < 52 || rect.height > 72)) {
      throw new Error('book action rows should use stable mobile list-item height: ' + JSON.stringify(actionRowRects.map(rect => rect.height)));
    }
    app.closeSheets();
    await wait(80);
    await app.setTheme(3);
    app.openToc();
    await wait(160);
    const nightTocActive = document.querySelector('#toc-list .toc-item.active');
    const nightTocStyles = getComputedStyle(nightTocActive);
    const nightTocBg = nightTocStyles.backgroundColor.match(new RegExp('rgba?\\\\((\\\\d+),\\\\s*(\\\\d+),\\\\s*(\\\\d+)'));
    const nightTocRgb = nightTocBg ? nightTocBg.slice(1,4).map(Number) : [0,0,0];
    if (nightTocRgb.every(channel => channel > 180) && cssAlpha(nightTocStyles.backgroundColor) > 0.35) {
      throw new Error('night toc active row should not use a bright light-mode surface: ' + nightTocStyles.backgroundColor);
    }
    app.closeSheets();
    await app.setTheme(0);
    await wait(80);
    app.setChromeVisible(false);
    await wait(50);
    app.currentPage = 0;
    app.setPageTransform(false);
    const beforeCornerTap = app.currentPage;
    const cornerTarget = document.elementFromPoint(Math.floor(innerWidth * 0.84), innerHeight - 44);
    cornerTarget.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: Math.floor(innerWidth * 0.84),
      clientY: innerHeight - 44
    }));
    await wait(260);
    if (app.currentPage !== beforeCornerTap + 1) throw new Error('hidden chrome bottom-right reader tap did not turn page: ' + JSON.stringify({
      beforeCornerTap,
      afterCornerTap: app.currentPage,
      pages: app.pages.length,
      target: cornerTarget && {
        tag: cornerTarget.tagName,
        id: cornerTarget.id,
        className: String(cornerTarget.className)
      }
    }));
    app.currentPage = 0;
    app.setPageTransform(false);
    const readerRect = app.reader.getBoundingClientRect();
    const swipeY = readerRect.top + readerRect.height * 0.5;
    app.reader.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 1,
      clientX: readerRect.right - 36,
      clientY: swipeY
    }));
    app.reader.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 1,
      clientX: readerRect.left + 36,
      clientY: swipeY + 4
    }));
    await wait(260);
    if (app.currentPage !== 1) throw new Error('left swipe did not turn to the next page');
    app.currentPage = 0;
    app.setPageTransform(false);
    const pointerSwipe = (id, fromX, toX, y) => {
      app.reader.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: id, pointerType: 'touch', clientX: fromX, clientY: y }));
      app.reader.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: id, pointerType: 'touch', clientX: toX, clientY: y + 3 }));
      app.reader.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: id, pointerType: 'touch', clientX: toX, clientY: y + 4 }));
    };
    pointerSwipe(2, readerRect.right - 36, readerRect.left + 80, swipeY);
    await wait(260);
    if (app.currentPage !== 1) throw new Error('touch swipe did not turn to the next page');
    app.currentPage = 0;
    app.setPageTransform(false);
    app.reader.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 3,
      pointerType: 'touch',
      clientX: readerRect.right - 36,
      clientY: swipeY
    }));
    app.reader.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true,
      pointerId: 3,
      pointerType: 'touch',
      clientX: readerRect.right - 70,
      clientY: swipeY
    }));
    pointerSwipe(4, readerRect.right - 36, readerRect.left + 80, swipeY);
    await wait(260);
    if (app.currentPage !== 1) throw new Error('swipe after pointercancel did not turn to the next page');
    app.currentPage = 0;
    app.setPageTransform(false);
    await wait(350);
    const touchTapTarget = document.elementFromPoint(Math.floor(innerWidth * 0.84), Math.floor(innerHeight * 0.5));
    touchTapTarget.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 5,
      pointerType: 'touch',
      clientX: Math.floor(innerWidth * 0.84),
      clientY: Math.floor(innerHeight * 0.5)
    }));
    touchTapTarget.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 5,
      pointerType: 'touch',
      clientX: Math.floor(innerWidth * 0.84),
      clientY: Math.floor(innerHeight * 0.5)
    }));
    touchTapTarget.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: Math.floor(innerWidth * 0.84),
      clientY: Math.floor(innerHeight * 0.5)
    }));
    await wait(260);
    if (app.currentPage !== 1) throw new Error('real touch tap on the right reading zone did not turn page: ' + JSON.stringify({
      target: touchTapTarget && {
        tag: touchTapTarget.tagName,
        id: touchTapTarget.id,
        className: String(touchTapTarget.className)
      },
      page: app.currentPage
    }));
    app.currentPage = 1;
    app.setPageTransform(false);
    await wait(320);
    const afterSwipeTapTarget = document.elementFromPoint(Math.floor(innerWidth * 0.84), Math.floor(innerHeight * 0.5));
    afterSwipeTapTarget.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: Math.floor(innerWidth * 0.84),
      clientY: Math.floor(innerHeight * 0.5)
    }));
    await wait(260);
    if (app.currentPage !== 2) throw new Error('tap after swipe was swallowed by gesture suppression');
    await app.setFontFamily(2);
    await wait(160);
    if (app.state.settings.fontFamilyIdx !== 2 || !getComputedStyle(app.readerContent).fontFamily.includes('KaiTi')) {
      throw new Error('restored font-family setting was not applied');
    }
    app.currentPage = 1;
    app.setPageTransform(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    await wait(80);
    if (app.currentPage !== 0) throw new Error('A key did not navigate to the previous page');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }));
    await wait(80);
    if (app.currentPage !== 1) throw new Error('D key did not navigate to the next page');
    const selectionParagraph = app.readerContent.querySelector('p[data-p="0"]');
    const selectionTextNode = selectionParagraph && selectionParagraph.firstChild;
    if (!selectionTextNode) {
      const allP0 = [...app.readerContent.querySelectorAll('p[data-p="0"]')];
      throw new Error('reader paragraph is unavailable for selection testing: paragraph=' + JSON.stringify(selectionParagraph && { html: selectionParagraph.outerHTML.slice(0, 120), text: selectionParagraph.textContent.slice(0, 40) }) + ' p0count=' + allP0.length + ' innerHead=' + app.readerContent.innerHTML.slice(0, 160) + ' blocks=' + JSON.stringify(app.pages.slice(0, 2).map(p => p.blocks.map(b => b.type + ':' + b.start + '-' + b.end))));
    }
    const selectText = () => {
      const range = document.createRange();
      range.setStart(selectionTextNode, 0);
      range.setEnd(selectionTextNode, Math.min(8, selectionTextNode.textContent.length));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      app.updateSelectionBubble();
    };
    selectText();
    if (!app.selectionBubble.classList.contains('show')) throw new Error('text selection did not show the bookmark bubble');
    app.openSheet(app.settingsSheet);
    if (app.selectionBubble.classList.contains('show')) throw new Error('selection bubble remains interactive above an open sheet');
    app.closeSheets();
    selectText();
    app.addBookmarkFromSelection();
    if (app.state.bookmarks.length !== 1 || app.state.bookmarks[0].bookId !== longBook.id) throw new Error('selection bookmark was not persisted with stable bookId');
    await app.closeReader();
    const longPressCard = document.querySelector('#book-grid .book-card');
    const longPressRect = longPressCard.getBoundingClientRect();
    longPressCard.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 9,
      clientX: longPressRect.left + 12,
      clientY: longPressRect.top + 12
    }));
    await wait(1120);
    longPressCard.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 9,
      clientX: longPressRect.left + 12,
      clientY: longPressRect.top + 12
    }));
    longPressCard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await wait(120);
    if (app.reader.classList.contains('active') || !app.bookActions.classList.contains('open')) {
      throw new Error('long press should open book actions without also opening the reader');
    }
    app.closeSheets();
    app.openSearch();
    await app.runSearch('专门用于验证');
    if (!document.querySelector('#search-results .result-card')) throw new Error('restored full-text search returned no result');
    const searchSubmit = document.querySelector('.search-form .primary-button');
    const searchSubmitRect = searchSubmit.getBoundingClientRect();
    const searchSubmitStyles = getComputedStyle(searchSubmit);
    if (searchSubmitRect.width > 56 || searchSubmit.textContent.trim()) {
      throw new Error('mobile search submit should be a compact icon action, not a large text CTA: ' + JSON.stringify({
        width: searchSubmitRect.width,
        text: searchSubmit.textContent.trim()
      }));
    }
    if (cssAlpha(searchSubmitStyles.backgroundColor) > 0.18 || searchSubmitStyles.boxShadow !== 'none') {
      throw new Error('mobile search submit should be a light secondary icon action, not a filled primary button: ' + JSON.stringify({
        background: searchSubmitStyles.backgroundColor,
        boxShadow: searchSubmitStyles.boxShadow
      }));
    }
    const resultCard = document.querySelector('#search-results .result-card');
    const resultCardStyles = getComputedStyle(resultCard);
    const resultCardRadius = parseFloat(resultCardStyles.borderTopLeftRadius);
    if (!resultCard.querySelector('.result-meta') || !resultCard.querySelector('.result-snippet')) {
      throw new Error('search results should use structured list-item content, not unstyled card text');
    }
    if (resultCardRadius > 8 || resultCardStyles.backgroundColor === 'rgba(250, 246, 237, 0.74)') {
      throw new Error('search results should be compact list items instead of heavy rounded cards: ' + JSON.stringify({
        radius: resultCardRadius,
        background: resultCardStyles.backgroundColor
      }));
    }
    if (document.documentElement.scrollWidth > innerWidth) throw new Error('search panel causes horizontal overflow');
    app.closeFeaturePanels();
    const bookmarkId = app.state.bookmarks[0].id;
    app.updateBookmarkNote(bookmarkId, '自动测试笔记');
    if (app.state.bookmarks[0].note !== '自动测试笔记') throw new Error('bookmark note was not updated');
    app.openBookmarks();
    if (!document.querySelector('#bookmarks-list [data-bookmark-id]')) throw new Error('bookmark panel did not render saved bookmark');
    const bookmarkCard = document.querySelector('#bookmarks-list .bookmark-card');
    if (!bookmarkCard.querySelector('.bookmark-head') || !bookmarkCard.querySelector('.bookmark-actions .ghost-button')) {
      throw new Error('bookmark items should use structured head/action components');
    }
    const bookmarkNoteWrap = bookmarkCard.querySelector('.bookmark-note-wrap');
    const bookmarkNote = bookmarkCard.querySelector('.bookmark-note');
    const bookmarkNoteStyles = bookmarkNote && getComputedStyle(bookmarkNote);
    if (!bookmarkNoteWrap || !bookmarkNote || bookmarkNote.tagName !== 'TEXTAREA' || bookmarkNoteStyles.borderTopStyle !== 'none') {
      throw new Error('bookmark note editor should be a calm inline note area, not a bordered form textarea');
    }
    const bookmarkActions = [...bookmarkCard.querySelectorAll('.bookmark-actions .ghost-button')].map(button => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height, text: button.textContent.trim(), hasIcon: !!button.querySelector('svg') };
    });
    if (bookmarkActions.some(action => action.width > 48 || !action.hasIcon || action.text)) {
      throw new Error('bookmark actions should be compact icon buttons, not large text buttons: ' + JSON.stringify(bookmarkActions));
    }
    if (document.documentElement.scrollWidth > innerWidth) throw new Error('bookmark panel causes horizontal overflow');
    app.closeFeaturePanels();
    await app.deleteBook(longBook.id);
    if (app.state.books.length !== 0) throw new Error('book deletion did not remove book metadata');
    if (app.state.bookmarks.length !== 0) throw new Error('book deletion left orphan bookmarks');
    const keptChapter = await app.idb('chapters','readonly',store => store.get(longBook.id + ':0'));
    if (!keptChapter) throw new Error('soft delete must keep chapter bodies in the store');
    await app.restoreFromTrash(longBook.id);
    if (!app.state.books.some(book => book.id === longBook.id)) throw new Error('book must be restorable after soft delete');
    document.documentElement.setAttribute('data-rebuilt-stage','before-pass');
    document.documentElement.setAttribute('data-rebuilt-e2e','pass');
    document.body.setAttribute('data-summary', JSON.stringify({ saved, restored, pagePos, afterFont }));
  };
  try { await run(); }
  catch (err) {
    document.documentElement.setAttribute('data-rebuilt-e2e','fail');
    document.body.textContent = 'FAIL ' + (err && (err.stack || err.message) || err);
  }
})();
</script>`;
  const testHtml = html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/i, '');
  return testHtml.replace('</body>', `${script}\n</body>`);
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

async function runChrome(chromePath, url, mobile = false) {
  const server = http.createServer();
  const debugPort = await new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  }));
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuilt-reader-profile-'));
  const child = childProcess.spawn(chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-background-networking',
    mobile ? '--window-size=390,844' : '--window-size=1280,900',
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
    if (mobile) {
      await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
      await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    }
    const deadline = Date.now() + 30000;
    let lastValue = '';
    while (Date.now() < deadline) {
      const result = await client.send('Runtime.evaluate', {
        expression: `[
          document.documentElement.getAttribute('data-rebuilt-e2e') || '',
          document.documentElement.getAttribute('data-rebuilt-stage') || '',
          document.documentElement.getAttribute('data-rebuilt-values') || '',
          document.body.textContent.slice(0, 1200)
        ].join('\\n')`,
        returnByValue: true,
      });
      lastValue = result.result && result.result.value || '';
      if (lastValue.startsWith('pass\n')) return;
      if (lastValue.startsWith('fail\n')) throw new Error(lastValue);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    const diagnostics = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const scripts = [...document.scripts].map((script, index) => ({
          index,
          src: script.src || '',
          type: script.type || '',
          textStart: (script.textContent || '').slice(0, 120),
          textLength: (script.textContent || '').length
        }));
        let injectedParse = 'missing';
        const injected = document.scripts[2];
        let injectedErrorContext = '';
        if (injected) {
          try {
            new Function(injected.textContent || '');
            injectedParse = 'ok';
          } catch (error) {
            injectedParse = error && (error.stack || error.message) || String(error);
            const lines = (injected.textContent || '').split('\\n');
            const lineMatch = injectedParse.match(/<anonymous>:(\\d+):(\\d+)/);
            const lineNumber = lineMatch ? Number(lineMatch[1]) : 1;
            injectedErrorContext = lines.slice(Math.max(0, lineNumber - 4), lineNumber + 3)
              .map((line, offset) => String(Math.max(1, lineNumber - 3 + offset)).padStart(4, ' ') + ': ' + line)
              .join('\\n');
          }
        }
        return JSON.stringify({
          readyState: document.readyState,
          readerApp: !!window.readerApp,
          books: window.readerApp && readerApp.state && readerApp.state.books && readerApp.state.books.length,
          cspMeta: [...document.querySelectorAll('meta[http-equiv]')].map(meta => meta.outerHTML),
          scripts,
          injectedParse,
          injectedErrorContext
        });
      })()`,
      returnByValue: true,
    }).catch(error => ({ result: { value: 'diagnostics failed: ' + error.message } }));
    throw new Error('Timed out waiting for rebuilt e2e: ' + lastValue + '\nDiagnostics: ' + (diagnostics.result && diagnostics.result.value || ''));
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuilt-reader-e2e-'));
  for (const file of ['reader.html', 'reader-core.js', 'reader-app.js', 'reader-styles.css', 'manifest.json']) {
    const src = path.join(root, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmpRoot, file));
  }
  fs.writeFileSync(path.join(tmpRoot, 'reader.html'), injectHarness(fs.readFileSync(path.join(root, 'reader.html'), 'utf8')), 'utf8');
  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, 'http://127.0.0.1');
    const pathname = parsed.pathname === '/' ? '/reader.html' : parsed.pathname;
    const filePath = path.join(tmpRoot, pathname.replace(/^\//, ''));
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
    await runChrome(chromePath, `http://127.0.0.1:${port}/reader.html`, false);
    await runChrome(chromePath, `http://127.0.0.1:${port}/reader.html`, true);
    console.log('rebuilt reader e2e passed');
  } finally {
    server.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
