# DocPilot - AI-Powered PDF Assistant for VSCode

A comprehensive VSCode extension that combines advanced PDF viewing with intelligent AI summarization capabilities. View, navigate, and understand PDF documents through seamless Copilot Chat integration.

## ✨ Core Features

### 📄 Advanced PDF Viewing

- **Automatic Activation** - Opens PDFs seamlessly via File → Open menu
- **Local & Remote Support** - Open files from filesystem or URLs
- **Crisp Rendering** - High-quality display with PDF.js v5.3.93 engine
- **Smart Navigation** - Zoom, fit-to-width/page, continuous scrolling
- **Professional Toolbar** - Clean icon-based interface with intuitive controls
- **Text Selection** - Interactive text selection with dynamic visual feedback
- **Enhanced Object Extraction** - Extract text, images, tables, metadata, and 6 other object types
- **PDF Object Inspector** - Dual-mode hierarchical viewer for comprehensive document structure analysis
- **Debug Mode** - Developer tools for troubleshooting text layer rendering
- **VSCode Integration** - Seamless theme matching and responsive UI

### 🤖 AI-Powered Analysis

- **Intelligent Summarization** - Comprehensive document analysis via Copilot Chat
- **Multi-Model Support** - Works with GPT-4, Gemini, and other Copilot models
- **Smart Caching** - Instant results for previously processed documents
- **Semantic Chunking** - Advanced processing for documents of any size
- **Hierarchical Processing** - Multi-level summarization with context preservation
- **Progress Tracking** - Real-time status updates during analysis
- **Automatic Cache Invalidation** - Fresh summaries when files are modified

## 🚀 Installation

### Development Mode

1. Clone this repository
2. Open in VSCode
3. Install dependencies: `npm install`
4. Compile: `npm run compile`
5. Press `F5` to launch Extension Development Host
6. Test the extension in the new window

### From VSIX (Coming Soon)

Will be available on VSCode Marketplace

## 📖 Usage

### Opening PDFs

**Automatic Activation (Easiest):**

- File → Open → Select any PDF file - DocPilot opens automatically!
- Double-click PDF files in VS Code Explorer

**Manual Commands:**

- Press `F1` → Type "DocPilot: Open Local PDF"
- Right-click any `.pdf` file in Explorer → "Open Local PDF"

**Remote URLs:**

- Press `F1` → Type "DocPilot: Open PDF from URL"
- Enter the PDF URL when prompted

### 🤖 AI Chat Integration

**Quick Start:**

1. Open Copilot Chat (`Ctrl+Alt+I` / `Cmd+Alt+I`)
2. Type `@docpilot /summarise [file-path-or-url]`
3. Get comprehensive AI analysis with document viewer

**Supported Commands:**

```bash
@docpilot /summarise docs/report.pdf        # Local file + open viewer
@docpilot /summarise https://example.com/doc.pdf  # Remote URL + open viewer
@docpilot /summarise                        # File picker dialog + open viewer
@docpilot /cache-stats                      # View cache statistics
@docpilot /clear-cache                      # Clear all cached summaries
```

**Advanced Capabilities:**

- **🧠 Semantic Chunking** - Preserves context across document boundaries
- **⚡ Intelligent Caching** - Instant retrieval of previously processed summaries
- **🔄 Hierarchical Summarization** - Multi-stage analysis for comprehensive understanding
- **📊 Processing Analytics** - Detailed stats on chunks processed and pages analyzed
- **🛡️ Error Resilience** - Multiple fallback strategies ensure reliable operation
- **🔄 Auto Cache Invalidation** - File modification detection for fresh content

### Enhanced Toolbar Controls

**Navigation Controls:**

- **📄 Page Navigation**: First/Previous/Next/Last page buttons with SVG icons
- **📊 Page Counter**: Live page display showing current position
- **🔄 Page Input**: Direct page number input for quick navigation

**Zoom & Fit Controls:**

- **🔍 Zoom In/Out**: Precise zoom control with high-quality magnifying glass icons
- **📊 Zoom Level Display**: Current zoom percentage (25% - 300%)
- **📏 Zoom Slider**: Drag control for smooth zoom adjustment
- **📏 Fit Width**: Automatically fit PDF width to window for optimal reading
- **📄 Fit Page**: Fit entire page in window for complete overview

**Content & Analysis Tools:**

- **📝 AI Summarize**: Intelligent document analysis via Copilot Chat integration
- **📤 Export Text**: Extract PDF content as clean text files with metadata
- **👁️ Text Selection**: Toggle interactive text selection with dynamic visual feedback
- **🔍 Text Search**: Vi-style text search across all pages with keyboard navigation
- **🔍 PDF Object Inspector**: Dual-mode hierarchical viewer for comprehensive PDF structure analysis
- **🐛 Debug Mode**: Developer tools for troubleshooting text layer rendering

### 🔍 Text Search - NEW!

DocPilot now includes powerful vi-style text search functionality for quick document navigation:

**Core Features:**
- **📄 Cross-Page Search**: Search across all pages in the PDF document
- **⌨️ Keyboard Navigation**: Enter for next match, Shift+Enter for previous, ESC to close
- **🔍 Case-Insensitive**: Finds matches regardless of letter case
- **⚡ Lazy Loading**: Text extracted on-demand for optimal performance
- **💾 Smart Caching**: Page text cached to avoid re-extraction
- **🎯 Visual Highlighting**: Current match highlighted with orange outline
- **📜 Auto-Scrolling**: Automatically scrolls to bring matches into view

**How to Use:**
1. Press `Ctrl+F` (or `Cmd+F` on Mac) or click the search button (🔍) in the toolbar
2. Type your search term (minimum 2 characters)
3. Use Enter/Shift+Enter or navigation buttons to move between matches
4. Press ESC to close search

**Vi-Style Experience:**
- Simple, distraction-free interface with no match counters
- Immediate search as you type with smart debouncing
- Seamless integration with existing PDF navigation

### 🔍 PDF Object Inspector

The PDF Object Inspector transforms document analysis with a dual-mode hierarchical viewer that reveals the internal structure of PDF documents:

**Object-Centric Mode:**
- **🖼️ Images**: All images across the document with page references
- **📊 Tables**: Detected table structures with coordinate information
- **🔤 Fonts**: Used fonts with page distribution and properties
- **📝 Annotations**: Links, comments, and markup across pages
- **📋 Form Fields**: Interactive form elements and their properties
- **📎 Attachments**: Embedded files and document attachments
- **🔖 Bookmarks**: Hierarchical document outline and navigation
- **⚙️ JavaScript**: Document-level and page-level script actions
- **📑 Metadata**: Document properties, author, creation date, etc.

**Page-Centric Mode:**
- **📄 Page Analysis**: Objects organized by individual pages
- **Cross-Page Objects**: Shared resources marked with link indicators
- **Progressive Loading**: Batch processing for large documents (20 pages at a time)
- **Object Relationships**: Clear visualization of object distribution

**Advanced Features:**
- **Lazy Loading**: User-controlled scanning with "click to scan" interface
- **Progressive Display**: Real-time object discovery with batched results
- **Shared Cache**: Cross-mode efficiency with intelligent caching
- **Export Capabilities**: Image extraction, table CSV export, metadata JSON
- **VSCode Integration**: Full theme support and accessibility compliance

**Accessibility & UX:**

- **Full Accessibility**: All buttons include proper titles and ARIA attributes
- **Theme Integration**: Complete dark/light mode support with CSS filters
- **Keyboard Shortcuts**: `Ctrl/Cmd + F` to open search, `Ctrl/Cmd + +/-/0` for zoom, Enter/Shift+Enter for search navigation, ESC to close search
- **Mouse Controls**: `Ctrl + Scroll` for zoom, natural scrolling
- **Performance Awareness**: Automatic warnings and optimizations for large documents

## 🛠️ Development

### Project Structure

```text
vscode-docpilot/
├── src/
│   ├── extension.ts          # Main extension activation
│   ├── cache/                # Summary caching system
│   ├── chat/                 # AI chat participant
│   ├── commands/             # PDF opening commands
│   ├── editors/              # Custom PDF editor provider
│   ├── webview/              # PDF viewer implementation
│   └── utils/                # Shared utilities
├── package.json              # Extension manifest
├── tsconfig.json            # TypeScript configuration
└── README.md                # This file
```

### Key Technologies

- **TypeScript** - Type-safe development with modern language features
- **PDF.js v5.3.93** - Mozilla's modern PDF rendering engine with ES modules
- **VSCode Extension API** - Deep IDE integration and Chat participant support
- **Language Model API** - Copilot integration for AI-powered analysis
- **HTML5 Canvas** - Hardware-accelerated PDF rendering

### Build Commands

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode for development
npm run watch

# Run tests
npm run test                # All tests (unit + integration)

# Run specific test suites
npm run test:unit           # Unit tests only (48 tests)
npm run test:integration    # Integration tests only (55 tests)
npm run test:e2e            # End-to-end tests with real VS Code

# Package extension (requires vsce)
vsce package
```

### Testing

The project includes comprehensive testing infrastructure with **103 passing tests** (100% success rate):

- **Unit Tests (48 tests)**: Core functionality testing (ChunkingStrategy, RetryPolicy)
- **Integration Tests (55 tests)**: Real functionality testing with actual VS Code extension host
- **End-to-End Tests**: Real browser automation testing with VS Code Extension Development Host
- **Enhanced Test Reporting**: Clear unit/integration separation with performance metrics
- **Test Utilities**: Helper functions for PDF operations and real webview communication
- **VS Code Integration**: Proper extension host testing environment
- **CI/CD Ready**: GitHub Actions workflow for automated testing

**Enhanced Test Output:**

```
==================================================
              TEST RESULTS SUMMARY
==================================================
✅ Passed: 103/103 tests (100.0%)
⏱️  Duration: 53.5s
📁 Suites: 12

🧪 UNIT TESTS:
  ✅ getDefaultConfig(): 3/3 passed
  ✅ createSemanticChunks(): 17/17 passed
  ✅ Integration with TokenEstimator: 2/2 passed
  ✅ withRetry: 9/9 passed
  ✅ shouldRetryNetworkError: 8/8 passed
  ✅ shouldRetryModelError: 7/7 passed
  ✅ delay: 2/2 passed

🔗 INTEGRATION TESTS:
  ✅ Real Error Scenarios: 14/14 passed
  ✅ OpenLocalPdf Integration: 7/7 passed
  ✅ OpenPdfFromUrl Integration: 8/8 passed
  ✅ Real User Workflows: 14/14 passed
  ✅ PDF Viewer Integration: 12/12 passed

🐌 SLOW TESTS (>500ms):
  ⏱️  8507ms - PDF Viewer Integration should handle real PDF.js rendering functionality
  ⏱️  6736ms - Real Error Scenarios should test real network timeout scenarios
  ⏱️  5652ms - Real User Workflows Performance workflow should be acceptable
  ⏱️  5075ms - Real User Workflows Command: Open Local PDF should work end-to-end
  ⏱️  3101ms - Real User Workflows Multiple PDF workflow should work correctly

🎉 ALL TESTS PASSED!
==================================================
```

**End-to-End Testing:**

The project includes comprehensive E2E testing using **Playwright** for real browser automation with VS Code Extension Development Host:

- **Real VS Code Integration**: Tests run in actual VS Code Extension Development Host
- **Webview Testing**: Complete toolbar interaction testing within PDF viewer
- **User Workflow Simulation**: Realistic user interactions through command palette and UI
- **Cross-Browser Support**: Electron-based testing for authentic VS Code environment
- **Visual Validation**: Button visibility, accessibility attributes, and user feedback testing

**E2E Test Coverage:**

- ✅ PDF opening via command palette (`F1` → "DocPilot: Open Local PDF")
- ✅ Webview frame access and PDF viewer initialization
- ✅ Zoom controls (Zoom In/Out buttons, slider, level display)
- ✅ Fit controls (Fit Width, Fit Page)
- ✅ Navigation controls (First/Previous/Next/Last page, page info)
- ✅ Toggle features (Text Selection, PDF Object Inspector, Debug Mode)
- ✅ Action buttons (Export Text, AI Summarize)
- ✅ Accessibility attributes (titles, ARIA labels)
- ✅ Real PDF rendering and user interaction workflows

**Running E2E Tests:**

```bash
# Run all tests (unit + integration)
npm run test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Compile tests separately
npm run compile-tests
```

**Test Structure:**

```text
src/test/
├── runTest.ts                    # VS Code test runner configuration
├── reporters/
│   └── enhanced-spec.ts         # Custom test reporter with unit/integration separation
├── e2e/                         # End-to-end tests with Playwright
│   └── toolbar.e2e.test.ts     # Real PDF viewer toolbar interaction tests
├── suite/
│   ├── index.ts                 # Test suite discovery and execution
│   ├── unit/                    # Unit tests (48 tests)
│   │   ├── pdf/
│   │   │   └── chunkingStrategy.test.ts
│   │   └── utils/
│   │       └── retry.test.ts
│   └── integration/             # Integration tests (55 tests)
│       ├── errorScenarios.test.ts
│       ├── openLocalPdf.integration.test.ts
│       ├── openPdfFromUrl.integration.test.ts
│       ├── userWorkflows.test.ts
│       └── webviewProvider.integration.test.ts
├── helpers/
│   ├── pdfTestUtils.ts          # PDF testing utilities
│   └── realIntegrationUtils.ts  # Real integration testing utilities
└── fixtures/
    └── pdfs/
        └── normal.pdf           # Test PDF fixture
```

**Test Configuration:**

- `playwright.config.ts` - E2E test configuration with VS Code electron support
- `tsconfig.e2e.json` - TypeScript configuration for E2E tests
- `.env` support for environment variables in E2E tests

**Current Status:** Complete testing infrastructure with enhanced reporting that clearly separates unit, integration, and E2E tests - **103/103 tests passing** with comprehensive coverage of PDF processing, webview communication, Copilot integration, and real user interaction workflows via Playwright automation.

## 🎯 Architecture

### Unified PDF Viewing System

- **WebviewProvider**: Core PDF viewer with HTML generation and message handling
- **PDF Object Inspector**: Dual-mode hierarchical viewer for comprehensive document structure analysis
- **Custom Editor**: Automatic activation for File → Open, delegates to WebviewProvider
- **Commands**: Manual PDF opening via command palette and context menu
- **WebviewUtils**: Shared utilities for consistent panel creation across entry points

### Multiple Activation Methods

1. **Automatic**: File → Open on PDF files (via custom editor registration)
2. **Manual Commands**: `docpilot.openLocalPdf`, `docpilot.openPdfFromUrl`
3. **Context Menu**: Right-click on PDF files in Explorer
4. **Chat Integration**: `@docpilot /summarise` command

### PDF Rendering

- Uses PDF.js for reliable cross-platform PDF parsing
- Canvas-based rendering for crisp quality at all zoom levels
- Optimized re-rendering for zoom operations

### VSCode Integration

- Custom editor provider for seamless file association
- Webview panels for PDF display with theme integration
- File system access for local PDFs and URL support

### Performance Optimizations

**Rendering:**

- Throttled zoom updates and parallel page rendering
- Efficient scroll event handling with viewport optimization

**AI Processing:**

- Token-aware chunking with configurable overlap (10% default)
- Batch processing (3 chunks concurrently) to prevent API overload
- Memory-efficient streaming with real-time progress updates
- Intelligent caching with file modification detection
- Persistent cache storage across VS Code sessions

## 🔧 Technical Highlights

**Intelligent Document Processing:**

- Automatic token estimation (3.5 chars/token) for accurate chunking
- Paragraph-aware semantic boundaries to preserve context
- Configurable overlap between chunks maintains narrative flow
- Multi-tier processing: single-chunk → semantic chunking → excerpt fallback

**Robust Error Handling:**

- Graceful degradation for oversized documents
- Comprehensive timeout management (30s for text extraction)
- Detailed error reporting with actionable feedback

## ⚠️ Limitations

- Initial load time increases with document size
- Very high zoom levels (>300%) may impact rendering performance
- AI summarization requires active Copilot subscription

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- **PDF.js** - Mozilla's excellent PDF rendering library
- **VSCode Team** - For the comprehensive extension API
- **TypeScript** - For type safety and developer experience

## 📚 Related

- [VSCode Extension API](https://code.visualstudio.com/api)
- [PDF.js Documentation](https://mozilla.github.io/pdf.js/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

---

Built with ❤️ for the VSCode community
