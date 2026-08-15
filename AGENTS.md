# AGENTS.md

This file provides guidance for AI coding agents working with this repository.

## How to Run

- **Web**: open `reader.html` in any modern browser (no build step).
- **LAN access**: `node scripts/serve.js` (allowlisted static assets only).
- **Desktop**: `cd desktop && npm install && npm start` (Electron; drag-and-drop TXT import, GBK/UTF-8 auto-detected).
- **Android APK**: double-click `scripts/编译APK.bat` (syncs `www/` via `scripts/sync-www.js`, runs `npx cap copy android`, builds with Gradle, then verifies root/www/assets/APK hashes via `scripts/verify-apk-assets.js` — build fails rather than shipping a stale APK).

## Tests (MANDATORY before finishing any change)

```bash
npm test                 # everything: quick + e2e + feature & gesture smoke
npm run test:quick       # Node-only unit/regression (no browser)
npm run test:e2e         # real Chrome E2E (layout, paging, position restore, keys)
npm run test:features    # feature smoke: backup roundtrip, brightness, night mode, TOC filter, delete confirm
                         # + mobile gesture smoke: drag-follow page turn, snap-back, pinch zoom, auto-scroll
```

All checks live in `scripts/*-test.js`. The E2E tests encode hard UX constraints
(e.g. toolbar width, settings sheet height) — treat failures as design violations, not test bugs.

## Architecture

The app is a zero-dependency vanilla JS SPA split across four files:

| File | Role |
|---|---|
| `reader.html` | DOM shell, sheets, panels |
| `reader-styles.css` | All styling (iOS aesthetic, dark theme via `body.theme-night`) |
| `reader-core.js` | **Pure logic, no DOM**: chapter parsing, pagination, position normalization, state migration, `isNightTime`. Exposes `ReaderCore` (window/module). Must stay unit-testable. |
| `reader-app.js` | `NovelReaderApp` controller: IndexedDB/localStorage, views, gestures, TTS, search |

`www/` is a **generated copy** for the Capacitor Android build — never edit it directly; run `npm run sync:www` (or build the APK) to refresh.

## State Model

```js
state = {
  books: [],          // {id,title,author,coverBg,chapterCount,chapterTitles,progress,readingPosition,lastRead}
  bookmarks: [],      // {id,bookId,chapterIdx,paragraphIndex,charOffset,text,note,timestamp}
  settings: {         // mode,fontSize(14-28),lineHeightIdx,marginIdx,themeIdx,fontFamilyIdx,
    ...               // pageAnimation,brightness(.4-1),nightMode('off'|'system'|'timer')}
  sortMode: 'recent'|'name',
  stats: {date,minutes,totalMinutes}
}
```

- Chapter bodies live ONLY in IndexedDB `chapters` store (key `bookId:index`) or localStorage fallback; never in `state.books`.
- Reading positions are saved per-book with timestamps; newest wins on restore.

## Key Conventions

- `$ = id => document.getElementById(id)`; DOM nodes cached in `bindDom()`.
- All user-facing text is Chinese; UI text uses `escape()` before interpolation.
- Deletes go to a trash store first (`deleteBook` → `saveTrashEntry`, 30-day retention, restore via `restoreFromTrash`); the armed-confirm state is bound to `armedBookId` and cleared on book switch.
- Navigation that changes chapters is serialized through `enqueueNavigation` + `goToChapter` with boundary clamping; never mutate `currentChapter` across awaits without the queue.
- Search/bookmark anchors must carry `chapter`; selection bookmarks read `data-ch` from the real DOM paragraph.
- Page mode re-measures overflow and shrinks lines up to 3 iterations; never hard-floor lines above the measured capacity.
- Gesture handling: `pointerdown/up` + `touchstart/end` with `suppressNextClick` guards; zone taps (left 28% / right 28%) turn pages in both modes.
- Page mode supports drag-follow page turning (`dragReader` + `finishReaderSwipe` dragging branch); sub-threshold drags snap back, over-threshold drags turn the page. `.dragging` disables the transform transition.
- Two-finger pinch (`handlePinchMove`) adjusts font size; `viewport` forbids page zoom so pinch belongs to the reader. Auto-scroll (`setAutoScroll`) drives `turnScrollPage`/`stepForward` on a timer and restarts on any manual page turn.
- Volume-key paging is opt-in (`settings.volumeKeyTurn`, default off); Android `dispatchKeyEvent` throttles repeats (350ms).
- Night theme (`body.theme-night`) is scoped to the reader and sheets only — never restyle the light library header.
- `capturePosition()` uses a cached marker list + binary search (rebuild via `invalidateMarkerCache()` on DOM chapter changes).
- Chrome auto-hides after 2.8s (`scheduleChromeAutoHide`); page indicator shows when hidden.
- Settings sheet and toolbar sizes are asserted by E2E — keep the settings body ≤ 42vh and header actions ≤ 46% width on mobile.

## Common Tasks

- **Add a setting**: HTML group in `#settings-sheet .settings-body` + default in `ReaderCore.normalizeAppStateDefaults` + control binding in `bindEvents()` + apply in `applySettings()`/`updateSettingControls()`.
- **Add storage**: use `this.idb(store,'readwrite',...)`; register store names in `openDB()` (bump `DB_VERSION` and add migration logic if schema changes).
- **Import pipeline**: `detectFileEncoding` → `streamFileText` → `ReaderCore.createChapterParser()` (chunked, BOM/CRLF-safe) → batched `saveChapterBatch`.
- **Testing import**: use `斗罗大陆3龙王传说-唐家三少.txt` (15 MB) or the in-app demo book.
- **Before significant changes**: `reader.backup.html` exists as a legacy single-file snapshot — prefer git history instead.
