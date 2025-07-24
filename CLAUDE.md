# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DocPilot is a VSCode extension that provides advanced PDF viewing and AI-powered document analysis. It combines PDF rendering with Copilot Chat integration for intelligent document processing.

## Build & Development Commands

```bash
# Essential development commands
npm install                    # Install dependencies
npm run compile               # Compile TypeScript to out/ with asset copying
npm run watch                 # Watch mode for development
npm run copy-assets           # Copy webview assets to out/

# Testing
npm run test                  # Run all tests (unit + integration + e2e)
npm run test:unit            # Run unit tests only
npm run test:integration     # Run integration tests only
npm run test:e2e             # Run E2E tests with Playwright
npm run compile-tests        # Compile tests separately
npm run compile-e2e          # Compile E2E tests separately

# Code quality
npm run lint                 # Lint with Biome
npm run format              # Format code with Biome  
npm run check               # Run Biome check (lint + format)

# VSCode extension development
# Press F5 to launch Extension Development Host
# Use Ctrl+Shift+P -> "Developer: Reload Window" to reload extension
```

## Architecture Overview

### Core Components
- **WebviewProvider** (`src/webview/webviewProvider.ts`): Central PDF viewer using PDF.js v5.3.93 with ES modules
- **ChatParticipant** (`src/chat/chatParticipant.ts`): Copilot Chat integration with `/summarise`, `/cache-stats`, `/clear-cache` commands
- **Custom Editor** (`src/editors/pdfCustomEditor.ts`): Automatic PDF activation via File → Open
- **Text Processing** (`src/pdf/`): Advanced semantic chunking and extraction system
- **PDF Object Inspector** (`src/webview/`): Dual-mode hierarchical viewer for comprehensive PDF structure analysis
- **Enhanced Toolbar** (`src/webview/templates/`): Professional navigation, zoom, and content tools

### Webview Architecture
- **Templates**: Enhanced HTML in `src/webview/templates/pdfViewer.html` with PDF Object Inspector sidebar
- **Scripts**: Modern PDF.js v5.3.93 integration in `src/webview/scripts/pdfViewer.js` with ES modules
- **Assets**: Comprehensive SVG icon set in `src/webview/assets/` (navigation, zoom, content tools)
- **Styling**: VSCode theme integration with dark/light mode support
- Assets are copied to `out/webview/` during build

### AI Integration
- **Semantic Chunking**: Token-aware processing with 10% overlap between chunks
- **Caching System**: File modification detection with persistent storage
- **Multi-tier Processing**: Single-chunk → semantic chunking → excerpt fallback
- **Progress Tracking**: Real-time updates during document analysis

### Activation Methods
1. **Automatic**: File → Open on PDF files (custom editor)
2. **Manual Commands**: `docpilot.openLocalPdf`, `docpilot.openPdfFromUrl` 
3. **Context Menu**: Right-click PDF files in Explorer
4. **Chat Integration**: `@docpilot /summarise [path-or-url]`

## Key Technologies & Dependencies

- **TypeScript**: Strict mode with ES2020 target (^4.9.4)
- **PDF.js v5.3.93**: Mozilla's modern PDF rendering engine with ES modules
- **VSCode Extension API**: Language Model API for Copilot integration (^1.74.0)
- **Biome**: Code formatting and linting (^2.1.1)
- **Mocha + Chai + Sinon**: Testing framework for unit and integration tests
- **Playwright**: End-to-end testing framework (^1.54.1) for real VSCode extension testing

## Development Guidelines

### Code Style
- Use TypeScript strict mode - all types must be explicit
- Follow existing patterns in `/src` directory structure
- Use `// biome-ignore lint: <rule> <reason>` for lint exceptions
- Implement proper resource disposal (event listeners, webviews)
- Use async/await for asynchronous operations

### VSCode Integration Best Practices
- Use VSCode's built-in UI components (QuickPick, InputBox)
- Implement proper webview message handling via postMessage API
- Handle both local files and remote URLs gracefully
- Follow VSCode theme integration patterns
- Use proper security measures for webview content

### Testing Requirements
- All new features require unit, integration, and E2E tests where applicable
- Test files follow pattern: `*.test.ts` for unit, `*.integration.test.ts` for integration, `*.e2e.test.ts` for E2E
- Use test utilities in `src/test/helpers/` for PDF operations
- Integration tests use real VSCode extension host environment
- E2E tests use Playwright to test full extension functionality in VSCode
- Environment configuration via `.env` file for Copilot authentication

### Message Communication
Constants in `src/utils/constants.ts`:
- `WEBVIEW_MESSAGES`: WebView ↔ Extension communication
- `CHAT_COMMANDS`: Chat participant commands (`/summarise`, etc.)

### Error Handling
- Use `ChatErrorHandler` for chat-related errors
- Implement proper user feedback via `vscode.window.showErrorMessage`
- Log errors using centralized `Logger` instance
- Graceful degradation for oversized documents

## File Structure Patterns

```
src/
├── extension.ts              # Main activation entry point
├── cache/                    # Summary caching with file watching (2 files)
├── chat/                     # Copilot Chat participant & handlers (3 files)
├── commands/                 # PDF opening commands (2 files)
├── editors/                  # Custom PDF editor provider (1 file)
├── pdf/                      # Text extraction & chunking strategies (2 files)
├── types/interfaces.ts       # Shared TypeScript interfaces
├── utils/                    # Shared utilities & constants (8 files)
├── webview/                  # PDF viewer implementation
│   ├── assets/               # SVG icons (navigation, zoom, content tools)
│   ├── scripts/              # PDF.js v5.3.93 integration with ES modules
│   ├── templates/            # Enhanced HTML with content extraction sidebar
│   └── webviewProvider.ts    # Central webview management
└── test/                     # Multi-tier test suite
    ├── suite/
    │   ├── unit/             # Unit tests (2 files)
    │   └── integration/      # Integration tests (5 files)
    ├── e2e/                  # Playwright E2E tests (1 file)
    └── helpers/              # Test utilities and fixtures
```

## Important Implementation Notes

- Assets must be copied to `out/webview/` - handled by `copy-assets` script
- WebView panels are tracked and reused to prevent duplicates
- PDF.js v5.3.93 library loaded via ES modules from CDN with modern async initialization
- Chat participant automatically registers slash commands from handled commands
- Text extraction has 30s timeout with retry logic for reliability
- Cache invalidation happens automatically on file modification detection
- PDF Object Inspector provides dual-mode hierarchical viewer for comprehensive document structure analysis
- Enhanced toolbar with comprehensive navigation, zoom, and content tools
- Full VSCode theme integration with dark/light mode support
- E2E testing requires VSCode extension environment and Playwright setup

## PDF Object Inspector Features

### Dual-Mode Architecture
- **Object-Centric Mode**: View all objects by type across the document (Images, Tables, Fonts, Annotations, Form Fields, Attachments, Bookmarks, JavaScript, Metadata)
- **Page-Centric Mode**: View all objects organized by individual pages with cross-page object relationships
- **Mode Switching**: Seamless toggle between viewing modes with shared cache efficiency

### Advanced Object Extraction
- **Comprehensive Coverage**: Extracts all PDF object types available via PDF.js v5.3.93 APIs
- **Cross-Page Objects**: Proper handling of shared resources (fonts, form fields) with page reference indicators
- **Object Properties**: Detailed information including dimensions, coordinates, properties, and metadata
- **Export Capabilities**: Image extraction, table CSV export, metadata JSON export

### Performance & UX Optimizations
- **Lazy Loading**: User-controlled scanning with "click to scan" interface prevents automatic processing
- **Progressive Display**: Real-time object discovery with batched results (20 pages, 15 objects per batch)
- **Shared Cache**: Cross-mode efficiency with intelligent caching and race condition protection
- **Progressive Loading**: Batch processing for large documents with "Load More" pagination
- **Visual Feedback**: Loading indicators, progress tracking, and status messages during scanning

### Technical Implementation
- **PDFObjectInspector Class**: Central object management with dual-mode support in `src/webview/scripts/pdfViewer.js`
- **Cache Integration**: File hash-based caching with automatic invalidation on PDF changes
- **VSCode Integration**: Full theme support, accessibility compliance, and standard UI patterns
- **Error Handling**: Graceful degradation and timeout management for large documents

## Text Search Implementation Lessons (July 2025)

### Problem 1: HTML onclick handlers not finding functions
**Reason**: Functions defined in module scope aren't accessible to HTML onclick handlers  
**Solution**: Attach functions to window object - follow existing pattern at end of `pdfViewer.js`
```javascript
window.toggleSearch = toggleSearch;
window.searchNext = searchNext;
```

### Problem 2: "Page container not found" errors  
**Reason**: Used wrong selector `[data-page-number="${pageNum}"]` instead of existing pattern  
**Solution**: Use correct selector matching page creation: `#page-${pageNum}`

### Problem 3: Text layer not available for highlighting
**Reason**: Text layers are lazy-loaded and may be hidden initially  
**Solution**: Check and render text layer before highlighting
```javascript
if (textLayer.classList.contains('hidden') || textLayer.children.length === 0) {
  await renderTextLayer(pageNum);
}
```

### Key Learning: Study existing patterns first
Always examine how similar features work in the codebase before implementing new ones. This prevents selector mismatches, scope issues, and architectural inconsistencies.

## Enhanced Object Extraction Implementation Lessons (July 2025)

### Problem 1: Browse button not working in custom editor context
**Reason**: PDFs opened via File → Open use `pdfCustomEditor.ts` but lack extraction message handlers  
**Solution**: Add delegation methods to route extraction messages to `WebviewProvider`
```typescript
case WEBVIEW_MESSAGES.BROWSE_SAVE_FOLDER:
  await this.delegateToWebviewProvider('handleBrowseSaveFolder', panel);
  break;
```

### Problem 2: Infinite loops in PDF.js image object retrieval
**Reason**: `page.objs.get()` can hang indefinitely when PDF objects are malformed or large  
**Solution**: Implement timeout promises and operation limits
```javascript
const imgPromise = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    reject(new Error(`Timeout getting image ${imgName}`));
  }, 5000); // 5 second timeout
  
  page.objs.get(imgName, (img) => {
    clearTimeout(timeout);
    resolve(img || null);
  });
});
```

### Problem 3: Incorrect timing calculations showing "0s"
**Reason**: Extension-side `processingTime` didn't include webview collection phase  
**Solution**: Pass `webviewStartTime` from webview to extension for complete timing
```javascript
// In webview
extractionState.startTime = Date.now();
// Pass to extension
message.data.webviewStartTime = extractionState.startTime;
```

### Problem 4: Circular dependencies in extraction architecture
**Reason**: Original design had extension request webview data, then webview call back to extension  
**Solution**: Redesign flow - webview collects ALL data first, then sends to extension once
```javascript
// Webview collects everything first
const objectData = await collectObjectDataAndExtract();
// Then sends complete data to extension
vscode.postMessage({
  type: WEBVIEW_MESSAGES.EXTRACT_OBJECTS,
  data: { selectedTypes, saveFolder, fileName, objectData, webviewStartTime }
});
```

### Problem 5: UI responsiveness during extraction
**Reason**: Long-running operations blocked UI updates  
**Solution**: Implement progressive extraction with batch processing and real-time progress
```javascript
// Process in small batches with yield points
for (let i = 0; i < pages.length; i += BATCH_SIZE) {
  // Process batch
  updateProgress((i / pages.length) * 100);
  await new Promise(resolve => setTimeout(resolve, 0)); // Yield to UI
}
```

### Problem 6: TypeScript any types causing maintenance issues
**Reason**: Using `any` types bypassed type checking, leading to runtime errors  
**Solution**: Create proper interfaces for all data structures
```typescript
interface ObjectExtractionRequest {
  selectedTypes: ObjectType[];
  saveFolder: string;
  fileName: string;
  objectData?: ObjectData;
  webviewStartTime?: number;
}
```

### Key Learnings: Complex Feature Development
1. **Architecture First**: Design message flows and data structures before implementation
2. **Timeout Everything**: PDF.js operations can hang - always use timeouts and limits
3. **Progressive UX**: Long operations need progress indicators and UI yield points  
4. **Type Safety**: Proper interfaces prevent runtime errors and improve maintainability
5. **Dual Context Handling**: VSCode extensions have multiple entry points requiring delegation patterns
6. **Performance Monitoring**: Track timing across webview-extension boundaries for accurate metrics

## Troubleshooting

- **Webview issues**: Check VSCode Developer Tools console
- **PDF.js problems**: Refer to Mozilla PDF.js documentation  
- **Extension loading**: Use Output panel for extension logging
- **Test failures**: Run `npm run compile-tests` before running tests
- **Asset issues**: Ensure `npm run copy-assets` completed successfully