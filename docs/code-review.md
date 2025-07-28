# Code Review Report: `src/webview/scripts/pdfViewer.js`

## 1. Executive Summary

The `pdfViewer.js` script is the powerful client-side engine of the DocPilot extension. It is feature-rich, robust, and provides a sophisticated user experience, including an advanced PDF Object Inspector and interactive text layers.

However, at over 4,400 lines, the script has become a monolithic entity that is difficult to maintain, debug, and extend. Its size and complexity obscure the underlying logic and make future development risky.

This report provides a refactoring plan to improve the script's structure and maintainability by decomposing it into smaller, focused ES modules. The goal is to **refactor the existing code for clarity and modularity without altering its external behavior**, leveraging the project's existing E2E tests to ensure safety.

## 2. Analysis based on Refactoring Best Practices

The script exhibits several "code smells" that are prime candidates for refactoring, based on the principles in `llm-skills/refactor.md`.

-   **Large Class / Long Script:** This is the most significant issue. The single file is responsible for:
    -   PDF rendering and lifecycle management.
    -   Toolbar UI logic and event handling.
    -   State management (current page, zoom, etc.).
    -   Text selection and layer rendering.
    -   A complex, multi-mode Object Inspector.
    -   Vi-style text search.
    -   Communication with the VS Code extension host.
    This violates the Single Responsibility Principle and makes the code hard to reason about.

-   **Primitive Obsession & Dispersed State:** State is managed through numerous global variables (`pdfDoc`, `scale`, `currentPage`, `textSelectionEnabled`, `inspectorEnabled`, `debugMode`). This global state is modified from various functions throughout the script, making it difficult to track changes and dependencies.

-   **Feature Envy:** The code contains logical "features" (like the Inspector, Search, and Text Layer) whose functions are intertwined with the main script body. These features would be more coherent if they were self-contained modules, managing their own logic and state.

-   **Long Method:** Several functions are excessively long. The main `window.addEventListener('message', ...)` block, for instance, handles many different message types in a single location. The `initializePdf()` function also orchestrates too many disparate setup tasks.

## 3. Proposed Refactoring Plan

The core of the plan is to apply the **Extract Class** and **Extract Method** techniques by breaking `pdfViewer.js` into a collection of ES modules. This will improve separation of concerns and make the codebase more organized and maintainable.

### 3.1. New File Structure

It is proposed to create a new directory `src/webview/scripts/modules/` and decompose `pdfViewer.js` as follows:

```
src/webview/scripts/
├── modules/
│   ├── state.js          # Centralized state management
│   ├── ui.js             # Toolbar/UI event listeners and DOM updates
│   ├── renderer.js       # Canvas and text layer rendering logic
│   ├── communication.js  # VS Code message handling (postMessage/addEventListener)
│   ├── search.js         # All text search functionality
│   ├── inspector.js      # The PDFObjectInspector class and related logic
│   └── utils.js          # Shared helper functions
└── pdfViewer.js          # Main entry point (will be much smaller)
```

### 3.2. Module Responsibilities

-   **`pdfViewer.js` (New Entry Point):**
    -   Imports all other modules.
    -   Contains the primary `initializePdf` function which orchestrates the initialization sequence by calling functions from the imported modules.
    -   Acts as the central coordinator.

-   **`state.js`:**
    -   Exports a state object or class to manage shared state like `pdfDoc`, `currentPage`, `scale`, `vscodeApi`, etc.
    -   This encapsulates the global state, making it explicit and easier to track.

-   **`ui.js`:**
    -   Manages all DOM interactions and event listeners for the toolbar (e.g., `zoomIn`, `fitToWidth`, `goToNextPage`).
    -   Contains DOM update functions like `updatePageInfo()` and `updateZoomInfo()`.
    -   Depends on `state.js` to get data and `communication.js` to send messages.

-   **`renderer.js`:**
    -   Handles all PDF.js rendering logic for the canvas (`renderPage`, `rerenderAllPages`).
    -   Manages the text layer, including its creation, visibility, and performance monitoring (`renderTextLayer`, `toggleTextSelection`).

-   **`communication.js`:**
    -   Initializes and exports the `vscode` API object.
    -   Contains a single, clean `window.addEventListener('message', ...)` that delegates message handling to specific functions based on `message.type`.
    -   Provides wrapper functions for `vscode.postMessage` (e.g., `requestSummary()`, `sendError()`).

-   **`search.js`:**
    -   Encapsulates all logic for the text search feature: the search bar UI, event listeners (`Ctrl+F`), and search execution logic.

-   **`inspector.js`:**
    -   Contains the large `PDFObjectInspector` class.
    -   Includes all related functions for scanning, rendering the object tree, and handling inspector UI events.

-   **`utils.js`:**
    -   A home for shared helper functions like `showStatusMessage`.

### 3.3. Dependency Management

The webview currently loads `pdf.js` from a CDN. For better security, offline capability, and performance, this dependency should be bundled with the extension.

-   **Action:** Modify `rollup.config.js` to process and bundle `pdfViewer.js` and its new modules, including the `pdf.js` library from `node_modules`. This will produce a single, self-contained script for the webview.

## 4. How to Refactor Safely

This refactoring should be performed incrementally, following best practices to minimize risk.

1.  **Use Version Control:** Commit after each successful, small step.
2.  **Start with State:** Create `state.js` and move the global state variables into it. Update the rest of the script to import and use the shared state object.
3.  **Extract Pure Functions:** Move utility functions like `showStatusMessage` to `utils.js`.
4.  **Extract Features Incrementally:**
    -   Move all search-related code into `search.js`.
    -   Move the `PDFObjectInspector` class and its related functions into `inspector.js`.
    -   Continue this process for each new module (`ui.js`, `renderer.js`, etc.).
5.  **Run Tests Constantly:** The project has an excellent E2E test suite (`toolbar.e2e.test.ts`). These tests are **critical** for this refactoring. **Run the tests after every small change** to ensure that no functionality has been broken. The tests will act as a safety net, verifying that the UI and its behavior remain unchanged from the user's perspective.

By following this plan, `pdfViewer.js` can be transformed from a monolithic script into a well-structured, maintainable, and modular codebase, making future development faster and safer.