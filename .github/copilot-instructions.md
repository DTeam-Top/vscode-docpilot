# DocPilot VSCode Extension

## Project Overview

DocPilot is a powerful VSCode extension that enables users to view PDF files directly within the VS Code editor. The extension supports both local PDF files and remote PDFs from URLs, providing a seamless document viewing experience with features like:

- Local and remote PDF viewing
- Crisp zoom controls (25% - 300%)
- Smart fitting options (fit to width/page)
- Continuous scrolling for multi-page documents
- VSCode theme integration
- High-performance rendering with PDF.js
- Context menu integration for PDF files
- Keyboard shortcuts and mouse controls

The extension is built as a VSCode webview-based solution that renders PDFs using PDF.js library, providing a native-like experience within the editor.

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Node.js
- **Framework**: VSCode Extension API
- **PDF Rendering**: PDF.js (Mozilla)
- **Build Tool**: TypeScript Compiler (tsc)
- **Linting/Formatting**: Biome
- **Package Manager**: npm
- **Target VSCode Version**: ^1.74.0

## Best Practices

- Use TypeScript for type safety and better development experience
- Follow the VSCode Extension Guidelines and API best practices
- Implement proper error handling for file operations and network requests
- Use webview postMessage API for communication between extension and webview
- Handle different PDF sources (local files, remote URLs) gracefully
- Implement responsive UI that adapts to VSCode themes
- Use proper resource disposal to avoid memory leaks
- Follow accessibility guidelines for UI components
- Implement proper security measures for webview content


## Rules

### General

1. Read the documents under `llms-txt` folder first (if available).
1. If you can find the answer in the documents, use it.
1. Before implementing major features, confirm the design approach first.
1. If you have any questions about requirements or implementation, ask for clarification.
1. If you are uncertain about VSCode API usage or best practices, seek guidance.
1. Always test changes in the Extension Development Host before proposing them.
1. Consider backward compatibility when making API changes.

### Development

1. Always use npm for installing packages.
1. Always follow the linting rules defined in `biome.json`.
1. Always use `// biome-ignore lint: <rule> <reason>` format for lint exceptions.
1. Use TypeScript strict mode and maintain type safety throughout the codebase.
1. Follow the existing code structure and naming conventions.
1. Implement proper error handling and user feedback messages.
1. Use VSCode's built-in UI components (QuickPick, InputBox) for consistency.
1. Write JSDoc comments for public methods and complex logic.
1. Use async/await pattern for asynchronous operations.
1. Properly dispose of resources (event listeners, webviews, etc.).

### Troubleshooting

1. If you encounter VSCode API issues, check the official VSCode Extension API documentation.
1. For PDF.js related problems, refer to the Mozilla PDF.js documentation.
1. If you could not find the root cause of a problem, try to search GitHub issues first.
1. Check the VSCode Developer Tools console for webview errors.
1. Use VSCode's Output panel for extension logging and debugging.
1. Verify file paths and permissions for local PDF access issues.