# DocPilot

VSCode extension for PDF viewing, Reveal.js slide presentations, AI-powered document analysis, and productivity tools.

## Features

### Reveal.js Slide Presentations

Transform markdown files into professional presentations with one click.

- **Slide separators**: `---` (horizontal), `----` (vertical)
- **Rich plugins**: Markdown, syntax highlighting, speaker notes, Mermaid diagrams, math (KaTeX)
- **11 themes**: black, white, league, beige, sky, night, serif, simple, solarized, blood, moon
- **6 transitions**: none, fade, slide, convex, concave, zoom
- **VSCode theme integration**: Auto dark/light mode mapping
- **Customizable**: controls, progress bar, slide numbers

![slides-preview-01](https://github.com/DTeam-Top/vscode-docpilot/blob/main/docs/screenshots/slides-preview-01.png?raw=true)

![slides-preview-02](https://github.com/DTeam-Top/vscode-docpilot/blob/main/docs/screenshots/slides-preview-02.png?raw=true)

### PDF Viewer

- **Auto-activation** when opening `.pdf` files
- **Local & remote** PDFs (filesystem or URLs)
- **Navigation & zoom** with fit-to-width/page
- **Text search** (Ctrl/Cmd+F)
- **Screenshot tool** with drag-to-select
- **Object inspector** (images, tables, fonts, annotations, metadata)
- **Theme integration** (dark/light modes)

![pdf-viewer-01](https://github.com/DTeam-Top/vscode-docpilot/blob/main/docs/screenshots/pdf-viewer-01.png?raw=true)

![pdf-viewer-03](https://github.com/DTeam-Top/vscode-docpilot/blob/main/docs/screenshots/pdf-viewer-03.png?raw=true)

![pdf-viewer-04](https://github.com/DTeam-Top/vscode-docpilot/blob/main/docs/screenshots/pdf-viewer-04.png?raw=true)

### AI Document Analysis

Requires GitHub Copilot subscription.

- **Summarization** with smart caching
- **Mindmap generation** (Mermaid format)
- **Semantic chunking** for large documents
- **Multi-model support** (GPT-4, Gemini, etc.)
- **Cache management** (stats, export, clear)

![pdf-viewer-02](https://github.com/DTeam-Top/vscode-docpilot/blob/main/docs/screenshots/pdf-viewer-02.png?raw=true)

### Quick Prompts

- **Customizable text processing** with AI
- **Context menu integration** (right-click selected text)
- **Template system** (`{selectedText}` placeholder)
- **Direct Copilot integration**
- **Built-in defaults** (Explain Code, Find Issues)

![quick-prompts-01](https://github.com/DTeam-Top/vscode-docpilot/blob/main/docs/screenshots/quick-prompts-01.png?raw=true)

![quick-prompts-02](https://github.com/DTeam-Top/vscode-docpilot/blob/main/docs/screenshots/quick-prompts-02.png?raw=true)

### Markdown Enhancement

- **Auto Mermaid rendering** in preview and Reveal.js slides
- **All diagram types** (flowcharts, sequence, class, state, ER, gantt, mindmap, etc.)
- **Theme-aware** visualization
- **Math equations** (KaTeX in slides)
- **Zero configuration**

![mermaid-01](https://github.com/DTeam-Top/vscode-docpilot/blob/main/docs/screenshots/mermaid-01.png?raw=true)

![mermaid-02](https://github.com/DTeam-Top/vscode-docpilot/blob/main/docs/screenshots/mermaid-02.png?raw=true)

## Installation

**Marketplace:**

- [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=dteam-top.vscode-docpilot)
- [Open VSX](https://open-vsx.org/extension/dteam-top/vscode-docpilot)

**Development:**

```bash
git clone https://github.com/DTeam-Top/vscode-docpilot
cd vscode-docpilot
npm install && npm run compile
# Press F5 to launch Extension Development Host
```

## Quick Start

### Reveal.js Slides

Right-click `.md` file → **"View as Reveal.js Slides"**

**Markdown format:**

```markdown
# Title Slide

---

## Slide 1
Content here

---

## Slide 2

----

### Vertical Slide 2.1
```

### PDFs

- **Automatic**: File → Open → select `.pdf`
- **Command**: Ctrl/Cmd+Shift+P → "DocPilot: Open Local PDF"
- **Context menu**: Right-click `.pdf` → "Open Local PDF"

### AI Commands

Open Copilot Chat (Ctrl/Cmd+Alt+I):

```bash
@docpilot /summarise path/to/file.pdf
@docpilot /summarise https://example.com/doc.pdf
@docpilot /summarise                    # Shows file picker

@docpilot /mindmap path/to/file.pdf     # Generate Mermaid mindmap
@docpilot /cache-stats                  # View cache info
@docpilot /clear-cache                  # Clear all caches
@docpilot /cache-export                 # Export to markdown
```

### Quick Prompts

1. Select text
2. Right-click → DocPilot → Quick Prompts
3. Choose prompt

**Custom prompts:**

```json
{
  "docpilot.quickPrompts": [
    {
      "name": "Explain Code",
      "prompt": "Explain this code:\n\n{selectedText}"
    }
  ]
}
```

## Keyboard Shortcuts

**Reveal.js:**

- Arrow Keys / Space - Navigate
- ESC - Exit presentation
- F - Fullscreen
- S - Speaker notes
- O - Overview

**PDF:**

- Ctrl/Cmd+F - Search
- Enter / Shift+Enter - Next/Previous result
- Ctrl/Cmd + +/-/0 - Zoom

## Configuration

```json
{
  "docpilot.reveal.theme": "black",
  "docpilot.reveal.transition": "slide",
  "docpilot.reveal.controls": true,
  "docpilot.textProcessing.chunkSizeRatio": 0.8,
  "docpilot.pdfViewer.maxCachedTextLayers": 10,
  "docpilot.timeouts.textExtractionMs": 30000
}
```

See full options in VSCode Settings UI.

## Development

```bash
npm run compile          # Build TypeScript + assets
npm run watch            # Watch mode
npm run test             # All tests
npm run test:e2e         # E2E tests (Playwright)
npm run lint             # Biome linting
npm run package          # Create .vsix
```

**Architecture:**

```
src/
├── extension.ts         # Entry point
├── chat/                # Copilot integration
├── commands/            # Commands (PDF, Reveal.js, Quick Prompts)
├── webview/             # PDF & slide viewers
├── pdf/                 # Text/object extraction
├── cache/               # Document caching
└── test/                # Unit/integration/E2E tests
```

**Tech stack:** TypeScript 5.9, PDF.js 5.3.93, Reveal.js 5.2.1, Mermaid v11, VSCode Extension API, Rollup, Biome, Playwright

## Publishment

```bash
npm publish
```

For any authentication failures, try:

- npm registry: `npm login`
- vscode PAT: `npx vsce login ${publisher}`

## Limitations

- AI features require GitHub Copilot subscription
- Large documents (>100MB) may have performance issues

## Links

- [Repository](https://github.com/DTeam-Top/vscode-docpilot)
- [Issues](https://github.com/DTeam-Top/vscode-docpilot/issues)
- [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=dteam-top.vscode-docpilot)

## License

MIT License - see [LICENSE](LICENSE)
