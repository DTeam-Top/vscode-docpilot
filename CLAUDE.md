# CLAUDE.md

## Project Overview

DocPilot: VSCode extension for PDF viewing, AI document analysis, and markdown enhancements.

**Core Features:**

- PDF viewer with PDF.js v5.3.93 (navigation, zoom, search, screenshots, object inspector)
- AI-powered document analysis via GitHub Copilot integration
- Reveal.js slide presentations from markdown files
- Mermaid diagram rendering in markdown preview
- Quick Prompts for text processing with AI

## Build Commands

```bash
npm install              # Install dependencies
npm run compile          # Compile TypeScript + copy assets + bundle
npm run watch            # Watch mode for development
npm run test             # All tests (unit + integration + e2e)
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests
npm run test:e2e         # Playwright E2E tests
npm run lint             # Biome linting
npm run format           # Biome formatting
npm run package          # Create .vsix package

# Development: Press F5 to launch Extension Development Host
# Reload: Ctrl/Cmd+Shift+P -> "Developer: Reload Window"
```

## Architecture

### File Structure

```
src/
├── extension.ts                      # Main entry point
├── cache/                            # Document/summary caching (2 files)
├── chat/                             # Copilot participant & handlers (7 files)
├── commands/                         # Commands (4 files)
│   ├── openLocalPdf.ts
│   ├── openPdfFromUrl.ts
│   ├── quickPromptsCommand.ts
│   └── toggleRevealModeCommand.ts
├── editors/                          # Custom PDF editor (1 file)
├── pdf/                              # Text/object extraction, chunking (3 files)
├── markdown/                         # Mermaid preview enhancement
│   ├── scripts/mermaidRenderer.js
│   └── styles/mermaid.css
├── webview/                          # Webview providers
│   ├── webviewProvider.ts            # PDF viewer
│   ├── slideViewerProvider.ts        # Reveal.js slides
│   ├── webviewMessenger.ts           # Extension ↔ webview communication
│   ├── templates/                    # HTML (pdfViewer.html, slideViewer.html)
│   ├── scripts/                      # JavaScript modules (12 files)
│   │   ├── pdfViewer.js              # Main PDF.js integration
│   │   └── modules/                  # Modular components (10 files)
│   ├── styles/                       # CSS (pdfViewer.css, slideViewer.css)
│   └── assets/                       # SVG icons
├── utils/                            # Utilities & constants (12 files)
└── test/                             # Tests (unit, integration, e2e)
```

### Core Components

| Component | File | Purpose |
|-----------|------|---------|
| WebviewProvider | `webview/webviewProvider.ts` | PDF viewer using PDF.js v5.3.93 |
| SlideViewerProvider | `webview/slideViewerProvider.ts` | Reveal.js presentations |
| ChatParticipant | `chat/chatParticipant.ts` | Copilot integration (`/summarise`, `/mindmap`, etc.) |
| PdfCustomEditor | `editors/pdfCustomEditor.ts` | Auto-activation for PDF files |
| Quick Prompts | `commands/quickPromptsCommand.ts` | Text processing templates |

### Key Technologies

- TypeScript 5.9 (strict mode, ES2020)
- PDF.js v5.3.93 (CDN, ES modules)
- Reveal.js v5.2.1 (CDN)
- Mermaid v11 (CDN)
- VSCode Extension API ^1.102.0 (Language Model API)
- Rollup (bundling), Biome (lint/format)
- Mocha + Chai + Sinon (testing)
- Playwright (E2E tests)

## Development Guidelines

### Code Style

- TypeScript strict mode - explicit types required
- Use `// biome-ignore lint:<rule> <reason>` for exceptions
- Proper resource disposal (listeners, webviews)
- Async/await for async operations
- Follow existing patterns in `/src`

### Testing

- Test patterns: `*.test.ts` (unit), `*.integration.test.ts`, `*.e2e.test.ts`
- Use helpers in `src/test/helpers/` for PDF operations
- Integration tests use real VSCode extension host
- E2E tests use Playwright
- Environment config via `.env` for Copilot auth

### Message Communication

Constants in `src/utils/constants.ts`:

- `WEBVIEW_MESSAGES`: WebView ↔ Extension communication
- `CHAT_COMMANDS`: Chat participant commands

### Error Handling

- `ChatErrorHandler` for chat errors
- `vscode.window.showErrorMessage` for user feedback
- Centralized `Logger` instance
- Graceful degradation for large documents

## Critical Implementation Details

### Build Process

1. **TypeScript compilation** → `out/`
2. **Asset copying** → `npm run copy-assets` (webview assets to `out/webview/`, markdown to `out/markdown/`)
3. **Rollup bundling** → Processes webview scripts/styles

**Important**: Assets MUST be copied to `out/` for webview to load them.

### Webview Architecture

**PDF Viewer:**

- Templates: `src/webview/templates/pdfViewer.html`
- Scripts: `src/webview/scripts/pdfViewer.js` (ES modules, PDF.js v5.3.93)
- Panels tracked by URI to prevent duplicates
- Text extraction: 30s timeout with retry logic
- Object Inspector: Dual-mode (object-centric/page-centric), lazy loading, batch processing

**Slide Viewer:**

- Template: `src/webview/templates/slideViewer.html`
- CDN: Reveal.js 5.2.1 + plugins (Markdown, Highlight, Notes, Mermaid, Math)
- Slide separators: `---` (horizontal), `----` (vertical)
- Theme auto-mapping: VSCode dark → black, light → white
- Panel tracking by URI, auto-refresh on file changes
- Exit: Double ESC closes panel

**Markdown Preview:**

- Extension points: `markdown.previewScripts`, `markdown.previewStyles`
- Renderer: `mermaidRenderer.js` (CDN import, MutationObserver)
- Formats: ` ```mermaid ` blocks or `<pre class="mermaid">`
- Theme-aware (dark/light switching)
- Rollup: IIFE format, no minification (preserves CDN imports)
- Testing: Use `childFrames()` to access nested iframes

### Window Object Exposure

HTML onclick handlers need functions exposed on `window`:

```javascript
// At end of pdfViewer.js
window.toggleSearch = toggleSearch;
window.searchNext = searchNext;
```

### Selectors & Patterns

- Page containers: `#page-${pageNum}` (NOT `[data-page-number="${pageNum}"]`)
- Text layers: Lazy-loaded, check `textLayer.classList.contains('hidden')` before use
- Always study existing patterns before implementing similar features

### PDF.js Operations

**Critical**: PDF.js operations can hang. Always use timeouts:

```javascript
const imgPromise = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
  page.objs.get(imgName, (img) => {
    clearTimeout(timeout);
    resolve(img || null);
  });
});
```

### Dual Context Handling

PDFs opened via File → Open use `pdfCustomEditor.ts`. Add delegation for message handlers:

```typescript
case WEBVIEW_MESSAGES.BROWSE_SAVE_FOLDER:
  await this.delegateToWebviewProvider('handleBrowseSaveFolder', panel);
  break;
```

### Progressive Operations

Long-running operations need batching with UI yield points:

```javascript
for (let i = 0; i < pages.length; i += BATCH_SIZE) {
  // Process batch
  updateProgress((i / pages.length) * 100);
  await new Promise(resolve => setTimeout(resolve, 0)); // Yield to UI
}
```

### Type Safety

Always create proper interfaces - avoid `any`:

```typescript
interface ObjectExtractionRequest {
  selectedTypes: ObjectType[];
  saveFolder: string;
  fileName: string;
  objectData?: ObjectData;
  webviewStartTime?: number;
}
```

## Configuration

Key settings (`docpilot.*`):

- `textProcessing.chunkSizeRatio`: 0.8
- `textProcessing.overlapRatio`: 0.1
- `pdfViewer.maxCachedTextLayers`: 10
- `timeouts.textExtractionMs`: 30000
- `reveal.theme`: 11 themes (black, white, league, etc.)
- `reveal.transition`: 6 transitions (none, fade, slide, etc.)
- `quickPrompts`: Array of `{name, prompt}` with `{selectedText}` placeholder

## Activation

Extension activates via:

- `onCommand:*` (for each command)
- `onCustomEditor:docpilot.pdfEditor`
- "*" (for immediate activation)

## Quick Reference

**CDN Resources:**

- PDF.js: `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.3.93/`
- Reveal.js: `https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/`
- Mermaid: `https://cdn.jsdelivr.net/npm/mermaid@11/`

**Never bundle CDN resources** - always load at runtime.

**Webview Security (CSP):**

- Allows CDN via `connect-src`, `script-src`, `style-src`
- `unsafe-inline` required for Reveal.js init
- `unsafe-eval` required for KaTeX math

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Webview not loading | Check VSCode Developer Tools console |
| PDF.js errors | Verify CDN connectivity, check timeouts |
| Extension not activating | Check `activationEvents` in package.json |
| Test failures | Run `npm run compile-tests` first |
| Assets missing | Run `npm run copy-assets` |
| Command not found | Verify extension activated (check Output panel) |

## Key Learnings

**Architecture:**

- Design message flows before implementation
- Webview collects data first, then sends to extension (avoid circular dependencies)
- Track timing across webview-extension boundaries

**Performance:**

- Always timeout PDF.js operations (5s recommended)
- Use progressive rendering with batch processing
- Implement UI yield points for long operations

**VSCode Patterns:**

- Extensions have multiple entry points (commands, custom editors, chat)
- Delegation patterns needed for dual-context features
- Panel tracking prevents duplicate webviews

**Testing:**

- E2E tests for Reveal.js should verify rendering, navigation, theme application
- Mock file system for markdown reading
- Test panel reuse and cleanup on disposal
