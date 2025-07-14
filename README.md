# DocPilot - AI-Powered PDF Assistant for VSCode

A comprehensive VSCode extension that combines advanced PDF viewing with intelligent AI summarization capabilities. View, navigate, and understand PDF documents through seamless Copilot Chat integration.

## ✨ Core Features

### 📄 Advanced PDF Viewing
- **Automatic Activation** - Opens PDFs seamlessly via File → Open menu
- **Local & Remote Support** - Open files from filesystem or URLs
- **Crisp Rendering** - High-quality display with PDF.js engine
- **Smart Navigation** - Zoom, fit-to-width/page, continuous scrolling
- **VSCode Integration** - Seamless theme matching and UI consistency

### 🤖 AI-Powered Analysis
- **Intelligent Summarization** - Comprehensive document analysis via Copilot Chat
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

### Controls

**Zoom:**

- **Buttons**: `+` / `-` for zoom in/out
- **Slider**: Drag for precise zoom control (25% - 300%)
- **Keyboard**: `Ctrl/Cmd + +/-/0` for zoom in/out/reset
- **Mouse**: `Ctrl + Scroll` for zoom

**Fitting:**

- **Fit Width**: Automatically fit PDF width to window
- **Fit Page**: Fit entire page in window

**Navigation:**

- **Scroll**: Mouse wheel or trackpad for natural scrolling
- **Page Info**: Shows current page number in toolbar

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
- **PDF.js v3.11.174** - Mozilla's robust PDF rendering engine
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

# Package extension (requires vsce)
vsce package
```

## 🎯 Architecture

### Unified PDF Viewing System

- **WebviewProvider**: Core PDF viewer with HTML generation and message handling
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
