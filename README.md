# DocPilot - VSCode PDF Viewer Extension

A powerful VSCode extension for viewing PDF files with smooth scrolling, crisp zoom controls, and an intuitive interface.

## ✨ Features

- **📄 Open Local PDFs** - Browse and open PDF files from your filesystem
- **🌐 Remote PDF Support** - View PDFs from URLs
- **🤖 AI Chat Integration** - Summarise PDFs using `@docpilot /summarise <file>` in Copilot Chat
- **🔍 Crisp Zoom Controls** - Zoom in/out with buttons, slider, or keyboard shortcuts
- **📏 Smart Fitting** - Fit to width or fit to page with one click
- **📜 Continuous Scrolling** - Natural scrolling through multi-page documents
- **🎨 VSCode Theme Integration** - Matches your VSCode theme colors
- **⚡ High Performance** - Optimized rendering with PDF.js

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

**Local Files:**

- Press `F1` → Type "DocPilot: Open Local PDF"
- Right-click any `.pdf` file in Explorer → "Open Local PDF"

**Remote URLs:**

- Press `F1` → Type "DocPilot: Open PDF from URL"
- Enter the PDF URL when prompted

### AI Chat Integration

**Summarise PDFs with Copilot:**

- Open Copilot Chat (`Ctrl+Alt+I` / `Cmd+Alt+I`)
- Type `@docpilot` to select the DocPilot participant
- Then use `/summarise path/to/file.pdf` for local files
- Or use `/summarise https://example.com/doc.pdf` for remote URLs
- Or simply `/summarise` to open a file picker
- The PDF will open in DocPilot viewer and AI will provide a comprehensive summary

**Features:**

- ✅ **Smart Token Management** - Automatically handles large documents with intelligent truncation
- ✅ **Automatic Text Extraction** - Extracts text content from all PDF pages
- ✅ **Intelligent Content Summarisation** - Provides structured summaries with key points
- ✅ **Document Structure Analysis** - Analyzes document organization and main topics
- ✅ **Multi-Strategy Processing** - Full analysis for small docs, key sections for large docs
- ✅ **Progress Feedback** - Real-time status updates during processing
- ✅ **Error Handling** - Graceful fallbacks for very large documents

**Example Usage:**

```bash
@docpilot /summarise docs/report.pdf
@docpilot /summarise https://example.com/whitepaper.pdf
@docpilot /summarise  # Opens file picker
```

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
│   └── extension.ts          # Main extension logic
├── package.json              # Extension manifest
├── tsconfig.json            # TypeScript configuration
└── README.md                # This file
```

### Key Technologies

- **TypeScript** - Main development language
- **PDF.js** - PDF rendering engine
- **VSCode Extension API** - Integration with VSCode
- **HTML5 Canvas** - High-quality PDF rendering

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

### PDF Rendering

- Uses PDF.js for reliable cross-platform PDF parsing
- Canvas-based rendering for crisp quality at all zoom levels
- Optimized re-rendering for zoom operations

### VSCode Integration

- Webview panels for PDF display
- File system access for local PDFs
- Theme integration for consistent UI

### Performance Optimizations

- Throttled zoom updates during slider usage
- Parallel page rendering
- Efficient scroll event handling

## 🐛 Known Issues

- Large PDFs may take time to load initially
- Very high zoom levels (>300%) may impact performance

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
