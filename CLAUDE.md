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
- **Content Extraction** (`src/webview/`): Advanced sidebar with tabbed interface for images and tables
- **Enhanced Toolbar** (`src/webview/templates/`): Professional navigation, zoom, and content tools

### Webview Architecture
- **Templates**: Enhanced HTML in `src/webview/templates/pdfViewer.html` with content extraction sidebar
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
- Content extraction sidebar provides tabbed interface for images and tables
- Enhanced toolbar with comprehensive navigation, zoom, and content tools
- Full VSCode theme integration with dark/light mode support
- E2E testing requires VSCode extension environment and Playwright setup

## Troubleshooting

- **Webview issues**: Check VSCode Developer Tools console
- **PDF.js problems**: Refer to Mozilla PDF.js documentation  
- **Extension loading**: Use Output panel for extension logging
- **Test failures**: Run `npm run compile-tests` before running tests
- **Asset issues**: Ensure `npm run copy-assets` completed successfully