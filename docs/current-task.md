# PDF Content Selection Enhancement - Development Plan (v2)

## New Strategy: The "Content Extractor Palette"

**Pivoting from the previous approach.** The "in-place overlay" method has proven technically infeasible due to limitations in the lightweight PDF.js build ("Illegal invocation" error). To deliver a robust and reliable feature, we are moving to a new UX model: the **Content Extractor Palette**.

This new approach avoids all direct render-time manipulation. Instead, it will provide a dedicated sidebar UI where users can view, manage, and copy all detected images and tables from the document. This is a cleaner, more reliable, and arguably more user-friendly solution.

---

## Phase 1: Backend - Robust Content Extraction

**Objective**: Reliably extract all image and table data from the PDF in a structured format, completely independent of the rendering process.

#### Task 1.1: Implement Image Extraction Service

**Objective**: Find all image objects in the PDF and convert them into a web-friendly format.
**Files**: `src/pdf/imageExtractor.ts` (new file), `src/webview/scripts/pdfViewer.js`

**Implementation**:
1.  Create a new `ImageExtractor` class.
2.  Use `page.getOperatorList()` and `page.objs.get()` to identify all image XObjects.
3.  For each image object, correctly handle its data format (`kind`):
    *   `ImageKind.RGBA_32BPP`: Raw RGBA data.
    *   `ImageKind.RGB_24BPP`: Convert to RGBA by adding an alpha channel.
    *   Handle JPEG data if present (`imageObj.data` can be a `Uint8Array` of a JPEG file).
4.  Convert the processed pixel data into a `base64` encoded PNG or JPEG string.
5.  The service will return an array of objects: `{ pageNum: number, base64: string, id: string }`.

**Testing**:
-   Create unit tests for the `ImageExtractor`.
-   Test with PDFs containing different image formats (PNG, JPEG).
-   Test with PDFs containing multiple images on a single page.

#### Task 1.2: Implement Table Detection Service

**Objective**: Analyze text layout to identify and extract tables.
**Files**: `src/pdf/tableDetector.ts` (new file), `src/webview/scripts/pdfViewer.js`

**Implementation**:
1.  Create a new `TableDetector` class.
2.  Use `page.getTextContent()` to get all text items and their coordinates.
3.  Implement an algorithm to cluster text items based on horizontal and vertical alignment.
4.  Identify rows and columns from the clustered text.
5.  The service will return an array of structured table objects: `{ pageNum: number, rows: string[][], id: string }`.

**Testing**:
-   Create unit tests for the `TableDetector`.
-   Test with PDFs containing simple, complex, and multi-page tables.
-   Test with bordered and borderless tables.

---

## Phase 2: Frontend - The Extractor Palette UI

**Objective**: Build a new sidebar UI to display and interact with extracted content.

#### Task 2.1: Add New UI Entry Point

**Objective**: Replace the old selection mode button with a new button to toggle the Content Extractor Palette.
**Files**: `src/webview/templates/pdfViewer.html`, `src/webview/scripts/pdfViewer.js`

**Implementation**:
1.  In `pdfViewer.html`, remove the old "wand" icon.
2.  Add a new toolbar button with an "extractor" or "sidebar" icon.
3.  This button will toggle the visibility of a new sidebar container.

#### Task 2.2: Build the Palette View

**Objective**: Create the main container for the new UI.
**Files**: `src/webview/templates/pdfViewer.html`, `src/webview/styles/pdfViewer.css` (new or existing)

**Implementation**:
1.  Add a `<div id="extractorPalette">` to `pdfViewer.html`.
2.  Style it as a sidebar that appears on the right side of the viewer.
3.  The palette will contain two tabs: "Images" and "Tables".

#### Task 2.3: Implement the Image Gallery

**Objective**: Display extracted images in the "Images" tab.
**Files**: `src/webview/scripts/pdfViewer.js`

**Implementation**:
1.  When the palette is opened, call the `ImageExtractor` service.
2.  Display a loading indicator while images are being extracted.
3.  Render the returned `base64` images as thumbnails in a grid layout.
4.  Each thumbnail will have two action buttons: "Copy" and "Go to Page".
5.  Add a "Copy All Images" button at the top of the gallery.

#### Task 2.4: Implement the Table Viewer

**Objective**: Display extracted tables in the "Tables" tab.
**Files**: `src/webview/scripts/pdfViewer.js`

**Implementation**:
1.  When the palette is opened, call the `TableDetector` service.
2.  Display a list of detected tables (e.g., "Table 1 on Page 3").
3.  When a user clicks a table, render it as a preview using an HTML `<table>`.
4.  Provide buttons to copy the table data as CSV, Markdown, and JSON.
5.  Each table preview will also have a "Go to Page" button.

---

## Phase 3: Integration and Polish

**Objective**: Connect the backend services to the frontend UI and refine the user experience.

#### Task 3.1: Wire Up Backend and Frontend

**Objective**: Manage the flow of data from the PDF to the UI.
**Files**: `src/webview/scripts/pdfViewer.js`, `src/extension.ts`

**Implementation**:
1.  Create a message-passing system between the webview and the extension host for triggering extraction.
2.  Implement robust state management for the palette (loading, empty, error states).
3.  Ensure extraction is performed efficiently, perhaps only for visible pages initially, with a button to "Scan Entire Document".

#### Task 3.2: Implement "Go to Page" Functionality

**Objective**: Allow users to easily find the source of extracted content.
**Files**: `src/webview/scripts/pdfViewer.js`

**Implementation**:
1.  The "Go to Page" button next to each image and table will trigger a scroll event.
2.  The main PDF view will scroll to the corresponding page.
3.  (Optional Enhancement) Add a temporary highlight on the page to indicate the general area of the content.

---
## Success Criteria

-   ✅ Users can open a new "Content Extractor" sidebar from the toolbar.
-   ✅ The sidebar displays all images from the PDF in a gallery.
-   ✅ Users can copy individual images or all images to the clipboard.
-   ✅ The sidebar displays all tables from the PDF in a structured list.
-   ✅ Users can view and copy table data in multiple formats (CSV, Markdown).
-   ✅ The "Go to Page" feature navigates to the correct page for any piece of content.
-   ✅ The core PDF viewing experience remains fast and error-free.