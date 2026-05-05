# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## How to Run

Open `reader.html` in any modern browser. No build step, no server, no dependencies — it's a pure client-side single-page application.

## Tech Stack

- **Language**: Vanilla JavaScript (ES6+), no frameworks or bundlers
- **Storage**: IndexedDB (primary) via the `idbSave`/`idbLoad` helper functions; localStorage as fallback
- **External API**: OpenLibrary API (`openlibrary.org/search.json`) for book cover images
- **Target**: Mobile-first, with iOS design aesthetic (SF Pro fonts, backdrop filters, safe-area insets)

## Architecture

The entire application is a single HTML file (`reader.html`) with embedded CSS and JS. There are three main views toggled via a bottom tab bar:

1. **Bookshelf** (`#tab-shelf`) — Grid of book cards with SVG progress rings. Long-press for delete action sheet.
2. **Reader** (`#tab-reader`) — Full-screen reading view that hides the tab bar. Two modes:
   - **scroll mode** — All chapters rendered continuously, scroll position tracked as percentage
   - **page mode** — Single chapter paginated by line-height-based page breaks, tap left/right to navigate
3. **Bookmarks** (`#tab-bookmarks`) — List of saved bookmarks with editable notes, swipe-to-delete, and tap-to-navigate

### Data Model (`state` object, line ~390)

```js
state = {
  books: [],              // Array of {id, title, author, coverBg, coverUrl, chapters, progress, readingPosition}
  currentBookIdx: -1,     // Currently reading book index
  currentChapter: 0,      // Current chapter index
  scrollPercent: 0,       // Scroll position 0-1
  themeIdx: 1,            // Theme preset 0-4
  fontSize: 18,           // Font size in px (range 14-28)
  lineHeightIdx: 1,       // Line height preset 0-2
  fontFamilyIdx: 0,       // Font family preset 0-2
  toolbarVisible: true,
  readingMode: 'scroll',  // 'scroll' or 'page'
  currentPage: 0,
  bookmarks: []           // Array of {bookIdx, chapterIdx, text, note, cfi, timestamp, id}
}
```

### Key Functions

| Function | Location | Purpose |
|---|---|---|
| `parseChaptersFromText(text)` | ~line 655 | Splits raw `.txt` content into `[{title, content}]` using Chinese chapter regex |
| `parseTitleFromFilename(name)` | ~line 700 | Extracts title and author from filename by splitting on `-`, `—`, `_`, `/` |
| `importFile(file)` | ~line 713 | Entry point for .txt import via FileReader |
| `saveState()` / `loadStateAsync()` | ~line 444 | Serialize/deserialize entire state to IndexedDB |
| `saveBookProgress()` | ~line 475 | Saves per-book reading position (chapter, scroll%, page) |
| `renderShelfGrid()` | ~line 753 | Renders the bookshelf grid from `state.books` |
| `renderContent()` | — | Renders all chapters into the scroll area |
| `renderPageContent()` | — | Renders single chapter for page mode |
| `openReader(idx)` | — | Opens a book and restores reading position |
| `applySettings()` | — | Applies theme/font/line-height CSS custom properties |

### Chapter Parsing

The `parseChaptersFromText()` function (line 655) is the most important import pipeline function. It:
1. Strips BOM and normalizes line endings
2. Detects chapter headers with regex: `^(第[一二三四五六七八九十百千万零〇\d]+章...|楔子|序章|尾声|后记|终章)`
3. Content before the first chapter header becomes a prologue titled "序"
4. Language: Chinese — all UI text, comments, and novel content are in Chinese

### Persistence Layer

- **IndexedDB** (primary): Database `novelReaderDB`, object store `state`, key `novelReaderState`
- **localStorage** (fallback): Same key name
- `saveState()` writes to both; `loadStateAsync()` tries IndexedDB first, then localStorage
- Progress auto-saves on scroll (debounced 800ms) and on `beforeunload`

### DOM Conventions

- `$ = id => document.getElementById(id)` — shorthand for getElementById
- `S = q => document.querySelector(q)` — shorthand for querySelector
- All major DOM elements are cached as globals at initialization (~line 408-418)
- Event handlers are attached at the bottom of the script (~line 1053+)
- Init runs as an async IIFE at the very end (~line 1358)

### Other Features

- **Text selection**: Selecting text in reader shows a floating bubble to bookmark or copy
- **Search**: Search across all chapter content, results link to the matching chapter
- **Keyboard shortcuts**: Arrow keys/WASD/space for navigation, Escape to close reader (line 1326)
- **Themes**: 5 color themes with CSS custom properties, persisted in state
- **Font options**: 3 font sizes, 3 line heights, 3 font families
- **Demo book**: 红楼梦 (Dream of the Red Chamber) by 曹雪芹 is bundled as a demo when no books exist

## Common Development Tasks

- **No build/lint/test commands exist** — this is a zero-tooling project. Test by opening `reader.html` in a browser.
- **Backup before editing**: There's a `reader.backup.html` file — update it before making significant changes.
- **Adding a feature**: Find the relevant section by the labeled comment blocks (e.g., `/* ===== Bookshelf ===== */`), add HTML in the `<body>`, CSS in `<style>`, JS in `<script>`.
- **Testing import**: Use the bundled `斗罗大陆3龙王传说-唐家三少.txt` file (15 MB, ~200K lines) as a realistic test input.

## Project Files

- `reader.html` — main application
- `reader.backup.html` — backup/snapshot of reader.html before modifications
- `斗罗大陆3龙王传说-唐家三少.txt` — bundled test/example novel (Douluo Dalu 3 by Tang Jia San Shao)
- `.claude/settings.local.json` — Claude Code local permissions config
