# Key Learnings from DocPilot Development

This document summarizes the most important technical and architectural lessons learned during the development of the DocPilot VSCode extension.

---

## 1. Core PDF Viewer Implementation

### Critical Failures & Fixes

- **PDF Loading Freeze:** A complex text preprocessing function caused freezes.
  - **Lesson:** Prioritize stable, basic functionality before introducing complex optimizations.
- **Text Overlay Misalignment:** A visual "two layers" effect occurred due to a mismatch between PDF.js and canvas coordinate systems.
  - **Lesson:** PDF coordinate systems (bottom-left origin) are different from canvas (top-left). Start with simple transformations.
- **Fragmented Text Selection:** Text copied from the viewer was often incomplete.
  - **Lesson:** Perfect text extraction from PDFs is a hard problem. It's better to ship a working, basic version and improve it incrementally.

### Architecture & Technical Decisions

- **Text Selection as an Opt-In Feature:** Text selection is disabled by default to prioritize a smooth reading experience. Users can toggle it on when needed.
- **Graceful Degradation:** Complex features like text selection are wrapped in `try...catch` blocks. If they fail, they are disabled without crashing the core viewer.
- **Debugging UI:** A visible "Debug Mode" toggle was implemented early, which was crucial for troubleshooting rendering and selection issues.

---

## 2. VSCode Extension Architecture

### Custom Editor for Seamless Integration

- **Problem:** The extension didn't automatically open when a user opened a PDF from the File Explorer.
- **Solution:** A `CustomReadonlyEditorProvider` was implemented to handle the `.pdf` file type. This is essential for binary files, as `CustomTextEditorProvider` will fail.
- **Architecture:** The custom editor is a thin wrapper. It doesn't contain any PDF rendering logic itself but instead delegates all work to a central `WebviewProvider`. This ensures a single source of truth and a consistent user experience regardless of how a PDF is opened.

### Viewer Deduplication and Resource Management

- **Problem:** Opening the same PDF through different methods (e.g., command palette then file explorer) created duplicate viewers.
- **Solution:** A centralized resource management system was implemented in `WebviewProvider`.
  - A `Map` tracks all active PDF viewers by their normalized file path.
  - Before a new viewer is created, the system checks if one already exists for that file. If so, the existing viewer is revealed, and the new one is disposed of.
  - This required creating a static registration method for the custom editor to integrate with the central tracking system.
- **Lesson:** In extensions with multiple entry points, centralized state management is critical to prevent inconsistent behavior and resource leaks.

### Handling HTML/JavaScript Dependencies

- **Problem:** A major refactoring using a linter automatically renamed JavaScript functions, which broke all `onclick` handlers in the HTML, as the linter was unaware of this implicit dependency.
- **Lesson:** Be cautious with automated refactoring tools. They can break implicit dependencies between different languages (like HTML and JavaScript). Always perform thorough functional testing after major automated changes.

---

## 3. Chat Integration & AI Features

### AI Token Limit Management

- **Problem:** Summarizing large PDFs failed because the extracted text exceeded the AI model's token limit.
- **Architecture:** A multi-tier processing strategy was developed:
  1. **Full Content:** If the text fits within the token limit, the entire document is used.
  2. **Semantic Chunking:** For larger documents, the text is split into meaningful chunks (e.g., by paragraphs). Each chunk is summarized individually.
  3. **Hierarchical Summarization:** The summaries of individual chunks are then consolidated in a final pass to create a coherent overall summary.
- **Key Principles:**
  - **Context Preservation:** Overlap chunks slightly (e.g., 10%) to avoid losing context at the boundaries.
  - **Batch Processing:** Send multiple chunks to the AI model concurrently to balance performance and API rate limits.
  - **Resilience:** A failure in summarizing one chunk does not stop the entire process.

### Caching for Performance

- **Problem:** Repeatedly summarizing the same document was slow and costly, as it triggered the full AI processing pipeline every time.
- **Architecture:** A persistent caching system was implemented.
  - **Storage:** Summaries are stored in VS Code's global storage, allowing them to persist across sessions.
  - **Invalidation:** The cache is invalidated intelligently. A summary is considered stale if the source PDF's modification date or file hash changes.
  - **File Watching:** A `FileSystemWatcher` monitors cached files and automatically invalidates the cache in real-time if the file is changed or deleted.
- **UX Lesson:** A performance optimization (caching) initially broke a user expectation. The fix was to ensure the PDF viewer was always opened, even when returning a cached summary, to maintain consistent behavior. Performance optimizations should not negatively alter the user experience.

### Remote PDF Handling

- **Problem:** Loading remote PDFs from URLs often failed due to CORS security restrictions.
- **Architecture:** A multi-tier fallback system was created:
  1. **Direct Load:** Attempt to load the PDF directly from the URL.
  2. **Proxy Fallback:** If direct loading fails (e.g., due to a CORS error), the extension's backend downloads the PDF to a temporary local cache and serves it from there.
  3. **User Options:** If both automatic methods fail, the user is presented with buttons to either download the file manually or open it in an external browser.
- **Caching:** Remote PDFs are cached locally for 24 hours to improve performance on subsequent views.

### Text Export Feature

- **Problem:** An "Export to Markdown" feature was misleading because the output was just plain text, not well-formatted Markdown.
- **Lesson:** Be honest in the UI. The feature was renamed to "Export Text," and the default file extension was changed to `.txt`. Feature names and UI elements should accurately reflect what they do.

### Multi-Model AI Compatibility

- **Problem:** The extension was hardcoded to use only GPT-4 models, preventing users from using other AI models like Gemini that they had configured in GitHub Copilot.
- **Root Cause:** The `vscode.lm.selectChatModels()` call included a `family: 'gpt-4'` filter, which excluded other model families.
- **Solution:** Removed the family restriction and only filtered by `vendor: 'copilot'`, allowing users to select any available model.
- **Additional Fix:** Added detection patterns for AI model rejection responses (e.g., "Sorry, I can't assist with that") to provide clearer error messages when models reject content due to policy restrictions.
- **Lesson:** Don't artificially restrict user choices in AI model selection. Let the user's configuration determine which models are available, and provide clear error messages when models reject content for policy reasons.

### Logger Cleanup and Debugging

- **Problem:** Console logs were showing "undefined" entries due to passing undefined values as parameters to console methods.
- **Root Cause:** The logger was unconditionally passing a second parameter to console methods, even when the data was undefined.
- **Solution:** Modified all logger methods to conditionally pass the data parameter only when it's defined.
- **Lesson:** Always validate optional parameters before passing them to external APIs. This prevents confusing debug output and maintains clean logs.
