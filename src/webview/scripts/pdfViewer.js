// Global variables provided by VS Code webview and PDF.js
/* global acquireVsCodeApi, PDF_CONFIG */

// PDF inspector variables
let inspectorEnabled = false;
let extractedImages = [];
let extractedTables = [];

// Global PDF Object Inspector
let globalInspector = null;

// PDF Object Inspector class for dual-mode object viewing with lazy loading
class PDFObjectInspector {
  constructor() {
    this.currentMode = 'objects';
    this.objects = {
      images: new Map(),
      tables: new Map(),
      fonts: new Map(),
      annotations: new Map(),
      formFields: new Map(),
      attachments: new Map(),
      bookmarks: [],
      metadata: {},
      javascript: [],
    };
    this.pageObjects = new Map();
    this.expandedNodes = new Set();
    this.lazyScanning = true; // Enable user-controlled scanning
    this.sharedCache = new Map(); // Local cache for object scanning results
    this.pendingScans = new Set(); // Prevent duplicate scan requests
    this.pdfFileHash = null; // PDF file hash for cache keys
    this.lazyLoaders = {};

    // Progressive loading settings
    this.progressiveLoading = {
      pageMode: {
        batchSize: 10, // Show 10 pages at a time
        currentlyShown: 0, // How many pages currently shown
        showMoreInProgress: false, // Prevent duplicate show-more requests
      },
      objectMode: {
        batchSize: 3, // Process 3 pages per batch for near-real-time feedback
        currentlyShown: new Map(), // objectType -> count currently shown
        showMoreInProgress: new Set(), // Set of objectTypes being loaded
        scanningProgress: new Map(), // objectType -> current scan progress
      },
    };
  }

  hasObjectsOfType(type) {
    if (type === 'bookmarks') return this.objects.bookmarks.length > 0;
    if (type === 'javascript') return this.objects.javascript.length > 0;
    if (type === 'metadata') return Object.keys(this.objects.metadata).length > 0;
    return this.objects[type] && this.objects[type].size > 0;
  }

  // Progressive scanning method for page-based objects
  async scanObjectsProgressively(objectType, scanFunction) {
    const allResults = [];
    const totalPages = pdfDoc.numPages;
    const batchSize = this.progressiveLoading.objectMode.batchSize;

    // Update progress tracking
    const progress = this.progressiveLoading.objectMode.scanningProgress.get(objectType);
    progress.total = totalPages;
    progress.isProgressive = true;

    // Auto-expand immediately to show progressive results
    this.expandedNodes.add(objectType);

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        // Update progress
        progress.current = pageNum;

        // Scan this page
        const pageResults = await scanFunction(pageNum);
        if (pageResults && pageResults.length > 0) {
          allResults.push(...pageResults);
          progress.results = [...allResults]; // Keep current results

          // Apply results immediately for real-time display
          applyObjectScanResults(objectType, allResults);
          renderObjectTree();

          // Show progress feedback
          showStatusMessage(
            `🔍 Scanning ${objectType}... ${pageNum}/${totalPages} pages (${allResults.length} found)`
          );
        }

        // Brief pause every batch for better UX and to avoid blocking
        if (pageNum % batchSize === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.warn(`Failed to extract ${objectType} from page ${pageNum}:`, error);
      }
    }

    return allResults;
  }

  // Cache management methods
  generateCacheKey(type, pageNum = null) {
    const baseKey = `pdf-${this.pdfFileHash}`;
    if (pageNum !== null) {
      return `${baseKey}_page-${pageNum}_type-${type}`;
    } else {
      return `${baseKey}_doc-level_${type}`;
    }
  }

  isScanPending(cacheKey) {
    return (
      this.pendingScans.has(cacheKey) ||
      (this.sharedCache.has(cacheKey) && this.sharedCache.get(cacheKey).status === 'loading')
    );
  }

  setCacheStatus(cacheKey, status, data = null) {
    this.sharedCache.set(cacheKey, {
      status,
      data,
      timestamp: Date.now(),
    });
  }

  getCachedData(cacheKey) {
    const cached = this.sharedCache.get(cacheKey);
    return cached && cached.status === 'complete' ? cached.data : null;
  }

  getObjectCount(type) {
    if (type === 'bookmarks') return this.objects.bookmarks.length;
    if (type === 'javascript') return this.objects.javascript.length;
    if (type === 'metadata') return Object.keys(this.objects.metadata).length;
    return this.objects[type] ? this.objects[type].size : 0;
  }
}

// Wait for PDF.js to be available
function waitForPdfJs() {
  return new Promise((resolve) => {
    if (window.pdfjsLib) {
      resolve();
    } else {
      const checkPdfJs = () => {
        if (window.pdfjsLib) {
          resolve();
        } else {
          setTimeout(checkPdfJs, 10);
        }
      };
      checkPdfJs();
    }
  });
}

// Make vscode API available first
const vscode = acquireVsCodeApi();
console.log('VSCode API initialized');

let pdfDoc = null;
let scale = 1.0;
let currentPage = 1;
let zoomTimeout = null;
const pagesContainer = document.getElementById('pdfContainer');
const progressFill = document.getElementById('progressFill');

// Text layer management
let textSelectionEnabled = false;
let debugMode = false; // Add debug mode for development
const textLayerStates = new Map(); // pageNum -> { textLayer, container, rendered }
const textLayerCache = new Map(); // LRU cache for text layers
const MAX_CACHED_TEXT_LAYERS = 10;
const VISIBLE_PAGE_BUFFER = 2;
const MAX_TEXT_DIVS_PER_PAGE = 50000;
const renderTimes = [];
const PERFORMANCE_THRESHOLD = 500; // 500ms

// Initialize PDF loading after PDF.js is available
async function initializePdf() {
  await waitForPdfJs();

  // Load PDF
  const loadingTask = window.pdfjsLib.getDocument(PDF_CONFIG.pdfUri);
  loadingTask.onProgress = (progress) => {
    if (progress.total > 0) {
      const percent = (progress.loaded / progress.total) * 100;
      progressFill.style.width = `${percent}%`;
    }
  };

  loadingTask.promise
    .then(async (pdf) => {
      pdfDoc = pdf;
      pagesContainer.innerHTML = '<div class="pdf-pages" id="pdfPages"></div>';
      updatePageInfo();
      initializeTextSelection();
      initializePDFInspector();

      // If the inspector was opened before PDF loading completed, initialize it now
      if (inspectorEnabled) {
        console.log('PDF loaded and inspector is open - initializing lazy inspector');
        await initializeLazyInspector();
      }

      renderAllPages();

      // Signal that PDF is ready for text extraction
      console.log('PDF loaded successfully, ready for text extraction');
    })
    .catch((error) => {
      console.error('Error loading PDF:', error);

      // Determine error type and show appropriate message
      let errorMessage = 'Failed to load PDF. The file may be corrupted or inaccessible.';
      let isCorsError = false;

      if (error.message?.includes('CORS') || error.message?.includes('fetch')) {
        errorMessage = 'Failed to load PDF due to cross-origin restrictions.';
        isCorsError = true;
      } else if (error.message?.includes('network') || error.message?.includes('NetworkError')) {
        errorMessage = 'Failed to load PDF due to network issues.';
      } else if (error.message?.includes('InvalidPDFException')) {
        errorMessage = 'The file is not a valid PDF or is corrupted.';
      }

      let errorHtml = `<div class="error">${errorMessage}</div>`;

      // Add specific suggestions for CORS errors on remote PDFs
      if (isCorsError && PDF_CONFIG.isUrl) {
        errorHtml += `
          <div class="error-suggestions">
            <p>This PDF cannot be loaded directly due to server restrictions.</p>
            <button onclick="downloadPdfFallback()" class="suggestion-btn">Download PDF</button>
            <button onclick="openInBrowser()" class="suggestion-btn">Open in Browser</button>
          </div>
        `;
      }

      pagesContainer.innerHTML = errorHtml;

      // Notify extension of PDF loading error
      vscode.postMessage({
        type: 'textExtractionError',
        error: `Failed to load PDF: ${error.message}`,
        isCorsError: isCorsError,
        isUrl: PDF_CONFIG.isUrl,
      });
    });
}

// Start PDF initialization
initializePdf();

function renderAllPages() {
  const _pdfPages = document.getElementById('pdfPages');
  const promises = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    promises.push(renderPage(pageNum));
  }

  return Promise.all(promises).then(() => {
    setupScrollListener();
    fitToWidth(); // Default to fit width
  });
}

function renderPage(pageNum) {
  return pdfDoc.getPage(pageNum).then((page) => {
    const viewport = page.getViewport({ scale: scale });

    // Create page container
    const pageDiv = document.createElement('div');
    pageDiv.className = 'pdf-page';
    pageDiv.id = `page-${pageNum}`;

    // Create canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    pageDiv.appendChild(canvas);

    // Create text layer container (but don't render yet)
    const textContainer = document.createElement('div');
    textContainer.className = 'textLayer hidden';
    pageDiv.appendChild(textContainer);

    // Store text layer state
    textLayerStates.set(pageNum, {
      textLayer: null,
      container: textContainer,
      rendered: false,
      page: page,
    });

    document.getElementById('pdfPages').appendChild(pageDiv);

    // Render canvas content
    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
    };

    return page.render(renderContext).promise;
  });
}

function setupScrollListener() {
  const container = pagesContainer;
  let scrollTimeout;

  container.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      updateCurrentPage();
      // Update text layer visibility when scrolling
      if (textSelectionEnabled) {
        renderVisibleTextLayers();
      }
    }, 150);
  });
}

function updateCurrentPage() {
  const containerRect = pagesContainer.getBoundingClientRect();
  const pages = document.querySelectorAll('.pdf-page');

  for (let i = 0; i < pages.length; i++) {
    const pageRect = pages[i].getBoundingClientRect();
    if (pageRect.top <= containerRect.height / 2 && pageRect.bottom >= containerRect.height / 2) {
      currentPage = i + 1;
      updatePageInfo();
      updateNavigationButtons();
      break;
    }
  }
}

function setZoom(newScale, immediate = false) {
  scale = parseFloat(newScale);
  document.getElementById('zoomSlider').value = scale;
  updateZoomInfo();

  // Throttle re-rendering for slider, immediate for buttons
  clearTimeout(zoomTimeout);
  if (immediate) {
    rerenderAllPages();
  } else {
    zoomTimeout = setTimeout(() => {
      rerenderAllPages();
    }, 150);
  }
}

function rerenderAllPages() {
  const pages = document.querySelectorAll('.pdf-page');
  const renderPromises = [];

  // Re-render each page at the new scale
  pages.forEach((pageDiv, index) => {
    const pageNum = index + 1;
    const canvas = pageDiv.querySelector('canvas');
    if (canvas && pdfDoc) {
      const promise = pdfDoc.getPage(pageNum).then((page) => {
        const viewport = page.getViewport({ scale: scale });
        const ctx = canvas.getContext('2d');

        // Clear canvas first to prevent artifacts
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Update canvas size for new scale
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // Re-render at new scale
        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
        };

        // If text selection is enabled, invalidate and re-render text layer
        if (textSelectionEnabled) {
          const state = textLayerStates.get(pageNum);
          if (state) {
            state.container.innerHTML = '';
            state.rendered = false;
            // Re-render text layer for visible pages
            if (shouldRenderTextLayer(pageNum)) {
              renderTextLayer(pageNum);
            }
          }
        }

        return page.render(renderContext).promise;
      });
      renderPromises.push(promise);
    }
  });

  return Promise.all(renderPromises);
}

function zoomIn() {
  const newScale = Math.min(scale + 0.25, 3);
  setZoom(newScale, true);
}

function zoomOut() {
  const newScale = Math.max(scale - 0.25, 0.25);
  setZoom(newScale, true);
}

function fitToWidth() {
  const container = pagesContainer;
  const containerWidth = container.clientWidth - 40;
  const firstCanvas = document.querySelector('.pdf-page canvas');
  if (firstCanvas) {
    const canvasNaturalWidth = firstCanvas.width;
    const newScale = containerWidth / canvasNaturalWidth;
    setZoom(newScale, true);
  }
}

function fitToPage() {
  const container = pagesContainer;
  const containerHeight = container.clientHeight - 40;
  const containerWidth = container.clientWidth - 40;
  const firstCanvas = document.querySelector('.pdf-page canvas');
  if (firstCanvas) {
    const canvasNaturalWidth = firstCanvas.width;
    const canvasNaturalHeight = firstCanvas.height;
    const scaleX = containerWidth / canvasNaturalWidth;
    const scaleY = containerHeight / canvasNaturalHeight;
    const newScale = Math.min(scaleX, scaleY);
    setZoom(newScale, true);
  }
}

function updatePageInfo() {
  if (pdfDoc) {
    document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${pdfDoc.numPages}`;
    updateNavigationButtons();
  }
}

function updateZoomInfo() {
  document.getElementById('zoomLevel').textContent = `${Math.round(scale * 100)}%`;
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      zoomIn();
    } else if (e.key === '-') {
      e.preventDefault();
      zoomOut();
    } else if (e.key === '0') {
      e.preventDefault();
      setZoom(1);
    }
  } else {
    // Page navigation shortcuts (without modifier keys)
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();
        goToPreviousPage();
        break;
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
        e.preventDefault();
        goToNextPage();
        break;
      case 'Home':
        e.preventDefault();
        goToFirstPage();
        break;
      case 'End':
        e.preventDefault();
        goToLastPage();
        break;
    }
  }
});

// Only zoom on wheel when Ctrl is explicitly held down
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    if (e.deltaY < 0) {
      zoomIn();
    } else {
      zoomOut();
    }
  }
});

// Text layer management functions
function initializeTextSelection() {
  if (pdfDoc.numPages > 100) {
    document.getElementById('warningBanner').style.display = 'block';
    textSelectionEnabled = false;
  } else {
    textSelectionEnabled = false; // Start disabled, let user choose
  }
}

function toggleTextSelection() {
  console.log('Text selection button clicked - function called');
  textSelectionEnabled = !textSelectionEnabled;

  // Update button icon - use a more reliable approach
  const icon = document.getElementById('textSelectionIcon');
  const baseUrl = icon.src.substring(0, icon.src.lastIndexOf('/') + 1);

  if (textSelectionEnabled) {
    icon.src = `${baseUrl}text.svg`;
    console.log('Text selection enabled - rendering text layers for visible pages');
    renderVisibleTextLayers();
  } else {
    icon.src = `${baseUrl}view.svg`;
    console.log('Text selection disabled - hiding all text layers');
    hideAllTextLayers();
  }
}

function getVisiblePageRange() {
  const containerRect = pagesContainer.getBoundingClientRect();
  const pages = document.querySelectorAll('.pdf-page');
  let start = 1,
    end = 1;

  for (let i = 0; i < pages.length; i++) {
    const pageRect = pages[i].getBoundingClientRect();
    if (pageRect.bottom >= containerRect.top && pageRect.top <= containerRect.bottom) {
      if (start === 1) start = i + 1;
      end = i + 1;
    }
  }

  return { start, end };
}

function shouldRenderTextLayer(pageNum) {
  if (!textSelectionEnabled) return false;
  const visibleRange = getVisiblePageRange();
  return (
    pageNum >= visibleRange.start - VISIBLE_PAGE_BUFFER &&
    pageNum <= visibleRange.end + VISIBLE_PAGE_BUFFER
  );
}

async function renderVisibleTextLayers() {
  const visibleRange = getVisiblePageRange();
  const promises = [];

  for (
    let pageNum = Math.max(1, visibleRange.start - VISIBLE_PAGE_BUFFER);
    pageNum <= Math.min(pdfDoc.numPages, visibleRange.end + VISIBLE_PAGE_BUFFER);
    pageNum++
  ) {
    if (shouldRenderTextLayer(pageNum)) {
      promises.push(renderTextLayer(pageNum));
    }
  }

  // Cleanup text layers outside visible range
  textLayerStates.forEach((_state, pageNum) => {
    if (!shouldRenderTextLayer(pageNum)) {
      cleanupTextLayer(pageNum);
    }
  });

  await Promise.all(promises);
}

async function renderTextLayer(pageNum) {
  const state = textLayerStates.get(pageNum);
  if (!state || state.rendered) return;

  try {
    const startTime = performance.now();

    // Clear container
    state.container.innerHTML = '';
    state.container.className = 'textLayer enabled';

    // Get text content with safer options
    const textContent = await state.page.getTextContent();
    if (textContent.items.length > MAX_TEXT_DIVS_PER_PAGE) {
      console.warn(`Page ${pageNum} has ${textContent.items.length} text items, skipping`);
      state.container.className = 'textLayer hidden';
      return;
    }

    const viewport = state.page.getViewport({ scale: scale });

    // Create a document fragment for better performance
    const fragment = document.createDocumentFragment();

    // Process text items with simplified positioning
    textContent.items.forEach((textItem, index) => {
      if (!textItem.str || textItem.str.trim() === '') return;

      const textSpan = document.createElement('span');
      textSpan.textContent = textItem.str;
      textSpan.setAttribute('data-text-index', index);

      // Extract transformation matrix values
      const tx = textItem.transform;
      const [scaleX, skewY, _skewX, _scaleY, translateX, translateY] = tx;

      // Calculate position and font size
      const fontSize = Math.sqrt(scaleX * scaleX + skewY * skewY);
      const fontScale = fontSize * scale;

      // Apply positioning
      textSpan.style.left = `${translateX * scale}px`;
      textSpan.style.top = `${viewport.height - translateY * scale - fontScale}px`;
      textSpan.style.fontSize = `${fontScale}px`;

      // Set font family if available
      if (textItem.fontName && textItem.fontName !== 'g_d0_f1') {
        if (textItem.fontName.includes('Bold')) {
          textSpan.style.fontWeight = 'bold';
        }
      }

      fragment.appendChild(textSpan);
    });

    // Append all text spans at once
    state.container.appendChild(fragment);

    state.textLayer = {
      cancel: () => {
        /* No-op cancel function */
      },
    };
    state.rendered = true;

    const renderTime = performance.now() - startTime;
    monitorTextLayerPerformance(renderTime);

    // Update cache
    textLayerCache.set(pageNum, Date.now());
    if (textLayerCache.size > MAX_CACHED_TEXT_LAYERS) {
      evictOldestTextLayer();
    }
  } catch (error) {
    console.error(`Failed to render text layer for page ${pageNum}:`, error);
    state.container.className = 'textLayer hidden';
  }
}

function hideAllTextLayers() {
  console.log('Hiding all text layers');
  textLayerStates.forEach((state, _pageNum) => {
    if (state.container) {
      state.container.className = 'textLayer hidden';
      // Reset rendered state so text layers can be re-rendered when enabled again
      state.rendered = false;
    }
  });
}

function cleanupTextLayer(pageNum) {
  const state = textLayerStates.get(pageNum);
  if (state) {
    if (state.textLayer) {
      state.textLayer.cancel();
    }
    if (state.container) {
      state.container.innerHTML = '';
      state.container.className = 'textLayer hidden';
    }
    state.textLayer = null;
    state.rendered = false;
    textLayerCache.delete(pageNum);
  }
}

function evictOldestTextLayer() {
  let oldestPageNum = null;
  let oldestTime = Date.now();

  textLayerCache.forEach((time, pageNum) => {
    if (time < oldestTime) {
      oldestTime = time;
      oldestPageNum = pageNum;
    }
  });

  if (oldestPageNum !== null) {
    cleanupTextLayer(oldestPageNum);
  }
}

function monitorTextLayerPerformance(renderTime) {
  renderTimes.push(renderTime);
  if (renderTimes.length > 5) renderTimes.shift();

  const avgTime = renderTimes.reduce((a, b) => a + b) / renderTimes.length;
  if (avgTime > PERFORMANCE_THRESHOLD) {
    console.warn(
      `Text layer rendering too slow (avg: ${Math.round(avgTime)}ms), consider disabling`
    );
  }
}

function toggleDebug() {
  debugMode = !debugMode;

  // Update button icon
  const icon = document.getElementById('debugIcon');
  const baseUrl = icon.src.substring(0, icon.src.lastIndexOf('/') + 1);

  if (debugMode) {
    icon.src = `${baseUrl}bug-play.svg`;
  } else {
    icon.src = `${baseUrl}bug-off.svg`;
  }

  const btn = document.getElementById('debugBtn');
  btn.style.backgroundColor = debugMode ? '#ff6b6b' : 'var(--vscode-button-background)';

  // Update text layer styling for debug mode
  textLayerStates.forEach((state, _pageNum) => {
    if (state.container && state.rendered) {
      const spans = state.container.querySelectorAll('span');
      spans.forEach((span, index) => {
        if (debugMode) {
          span.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
          span.style.border = '1px solid red';
          span.style.color = 'rgba(0, 0, 0, 0.5)';
          // Add tooltip with text content for debugging
          span.title = `Text: "${span.textContent}" | Index: ${index} | Font: ${span.style.fontSize}`;
        } else {
          span.style.backgroundColor = '';
          span.style.border = '';
          span.style.color = 'transparent';
          span.title = '';
        }
      });
    }
  });

  console.log(`Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
  if (debugMode) {
    console.log('Hover over text elements to see their content and positioning info');
  }
}

// Text extraction functionality for chat integration
async function extractAllTextContent() {
  try {
    let allText = '';
    console.log('Starting text extraction for all pages...');

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();

      let pageText = '';
      textContent.items.forEach((item) => {
        if (item.str?.trim()) {
          pageText += `${item.str} `;
        }
      });

      if (pageText.trim()) {
        allText += `\n--- Page ${pageNum} ---\n${pageText.trim()}\n`;
      }
    }

    console.log(`Extracted ${allText.length} characters from ${pdfDoc.numPages} pages`);
    return allText.trim();
  } catch (error) {
    console.error('Error extracting text:', error);
    throw error;
  }
}

// Listen for messages from the extension
window.addEventListener('message', async (event) => {
  const message = event.data;
  console.log('Webview received message:', message.type);

  if (message.type === 'extractAllText') {
    try {
      console.log('Starting text extraction, PDF loaded:', !!pdfDoc);

      if (!pdfDoc) {
        throw new Error('PDF not loaded yet');
      }

      const extractedText = await extractAllTextContent();
      console.log('Text extraction completed, sending response');

      // Send the extracted text back to the extension
      vscode.postMessage({
        type: 'textExtracted',
        text: extractedText,
      });
    } catch (error) {
      console.error('Text extraction failed:', error);
      vscode.postMessage({
        type: 'textExtractionError',
        error: error.message || 'Unknown error during text extraction',
      });
    }
  }
});

// Summarize document function
async function summarizeDocument() {
  console.log('Summarize button clicked - function called');
  const summarizeBtn = document.getElementById('summarizeBtn');

  if (!pdfDoc) {
    console.error('PDF not loaded yet');
    return;
  }

  try {
    // Disable button and show loading state
    summarizeBtn.disabled = true;
    summarizeBtn.style.opacity = '0.6';
    summarizeBtn.title = 'Summarizing...';

    console.log('Starting document summarization...');

    // Send summarize request to extension
    vscode.postMessage({
      type: 'summarizeRequest',
      fileName: PDF_CONFIG.fileName,
      isUrl: PDF_CONFIG.isUrl,
      pdfUri: PDF_CONFIG.pdfUri,
    });
  } catch (error) {
    console.error('Error starting summarization:', error);

    // Reset button state
    summarizeBtn.disabled = false;
    summarizeBtn.style.opacity = '1';
    summarizeBtn.title = 'Summarize this PDF using AI';

    vscode.postMessage({
      type: 'summarizeError',
      error: error.message || 'Failed to start summarization',
    });
  }
}

async function exportText() {
  console.log('Export button clicked - function called');
  const exportBtn = document.getElementById('exportBtn');

  if (!pdfDoc) {
    console.error('PDF not loaded yet');
    return;
  }

  try {
    // Disable button and show loading state
    exportBtn.disabled = true;
    exportBtn.style.opacity = '0.6';
    exportBtn.title = 'Exporting...';

    console.log('Starting PDF export...');

    // Send export request to extension
    vscode.postMessage({
      type: 'exportText',
      fileName: PDF_CONFIG.fileName,
      isUrl: PDF_CONFIG.isUrl,
      pdfUri: PDF_CONFIG.pdfUri,
    });
  } catch (error) {
    console.error('Error starting export:', error);

    // Reset button state
    exportBtn.disabled = false;
    exportBtn.style.opacity = '1';
    exportBtn.title = 'Export Text';

    vscode.postMessage({
      type: 'exportError',
      error: error.message || 'Failed to start export',
    });
  }
}

// Listen for summarization and export status updates
window.addEventListener('message', (event) => {
  const message = event.data;
  const summarizeBtn = document.getElementById('summarizeBtn');
  const exportBtn = document.getElementById('exportBtn');

  switch (message.type) {
    case 'summarizeStarted':
      console.log('Summarization started in extension');
      break;

    case 'summarizeCompleted':
      console.log('Summarization completed');
      // Reset button state
      summarizeBtn.disabled = false;
      summarizeBtn.style.opacity = '1';
      summarizeBtn.title = 'Summarize this PDF using AI';
      break;

    case 'summarizeError':
      console.error('Summarization error:', message.error);
      // Reset button state
      summarizeBtn.disabled = false;
      summarizeBtn.style.opacity = '1';
      summarizeBtn.title = 'Summarize this PDF using AI';
      break;

    case 'exportStarted':
      console.log('Export started in extension');
      break;

    case 'exportCompleted':
      console.log('Export completed');
      // Reset button state
      exportBtn.disabled = false;
      exportBtn.style.opacity = '1';
      exportBtn.title = 'Export Text';
      break;

    case 'exportError':
      console.error('Export error:', message.error);
      // Reset button state
      exportBtn.disabled = false;
      exportBtn.style.opacity = '1';
      exportBtn.title = 'Export Text';
      break;
  }
});

// Fallback functions for CORS-blocked PDFs
function downloadPdfFallback() {
  console.log('Download PDF fallback requested');
  vscode.postMessage({
    type: 'downloadPdfFallback',
    url: PDF_CONFIG.pdfUri,
  });
}

function openInBrowser() {
  console.log('Open in browser requested');
  vscode.postMessage({
    type: 'openInBrowser',
    url: PDF_CONFIG.pdfUri,
  });
}

// PDF inspector functions - Updated for dual-mode system
function toggleInspector() {
  inspectorEnabled = !inspectorEnabled;
  const sidebar = document.getElementById('inspectorSidebar');

  if (inspectorEnabled) {
    sidebar.classList.add('open');

    // Ensure globalInspector is initialized
    if (!globalInspector) {
      console.log('toggleInspector: initializing PDF inspector');
      initializePDFInspector();
    }

    // Show immediate skeleton structure with lazy loading prompts
    initializeLazyInspector();
  } else {
    sidebar.classList.remove('open');
    // Clear results when closed
    clearExtractedContent();
  }
}

// ===== UI FUNCTIONS =====
function addImageToGallery(imageData) {
  // Legacy function maintained for backward compatibility
  // The new tree view will be rendered when renderObjectTree() is called
  // This function now serves as a no-op but maintains the interface
  console.log(`Image added to gallery: ${imageData.id} on page ${imageData.pageNum}`);
}

function addTableToList(tableData) {
  // Legacy function maintained for backward compatibility
  // The new tree view will be rendered when renderObjectTree() is called
  // This function now serves as a no-op but maintains the interface
  console.log(`Table added to list: ${tableData.id} on page ${tableData.pageNum}`);
}

function copyImageToClipboard(imageId) {
  // First try the new inspector data
  let image = globalInspector?.objects.images.get(imageId);

  // Fallback to legacy array for backward compatibility
  if (!image) {
    image = extractedImages.find((img) => img.id === imageId);
  }

  if (image) {
    // Convert base64 to blob and copy to clipboard
    fetch(image.base64)
      .then((res) => res.blob())
      .then((blob) => {
        navigator.clipboard
          .write([new ClipboardItem({ [blob.type]: blob })])
          .then(() => {
            console.log('Image copied to clipboard');
            showStatusMessage('Image copied to clipboard! 📋');
          })
          .catch((err) => {
            console.error('Failed to copy image:', err);
            showStatusMessage('Failed to copy image ❌');
          });
      });
  } else {
    console.error('Image not found:', imageId);
    showStatusMessage('Image not found ❌');
  }
}

function copyTableAsCSV(tableId) {
  // First try the new inspector data
  let table = globalInspector?.objects.tables.get(tableId);

  // Fallback to legacy array for backward compatibility
  if (!table) {
    table = extractedTables.find((tbl) => tbl.id === tableId);
  }

  if (table) {
    const csv = table.rows.map((row) => row.join(',')).join('\n');
    navigator.clipboard
      .writeText(csv)
      .then(() => {
        console.log('Table copied as CSV to clipboard');
        showStatusMessage('Table copied as CSV! 📋');
      })
      .catch((err) => {
        console.error('Failed to copy table:', err);
        showStatusMessage('Failed to copy table ❌');
      });
  } else {
    console.error('Table not found:', tableId);
    showStatusMessage('Table not found ❌');
  }
}

// Helper function to show status messages
function showStatusMessage(message) {
  // Create a temporary status message
  const statusDiv = document.createElement('div');
  statusDiv.style.cssText = `
    position: fixed;
    bottom: 50px;
    right: 20px;
    background: var(--vscode-notifications-background);
    color: var(--vscode-notifications-foreground);
    border: 1px solid var(--vscode-notifications-border);
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    transition: opacity 0.3s ease;
  `;
  statusDiv.textContent = message;
  document.body.appendChild(statusDiv);

  // Remove after 2 seconds
  setTimeout(() => {
    statusDiv.style.opacity = '0';
    setTimeout(() => {
      if (statusDiv.parentNode) {
        statusDiv.parentNode.removeChild(statusDiv);
      }
    }, 300);
  }, 2000);
}

function goToPage(pageNum) {
  const pageElement = document.getElementById(`page-${pageNum}`);
  if (pageElement) {
    pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Navigation functions
function goToFirstPage() {
  if (pdfDoc && pdfDoc.numPages > 0) {
    currentPage = 1;
    goToPage(currentPage);
    updatePageInfo();
    updateNavigationButtons();
  }
}

function goToPreviousPage() {
  if (pdfDoc && currentPage > 1) {
    currentPage--;
    goToPage(currentPage);
    updatePageInfo();
    updateNavigationButtons();
  }
}

function goToNextPage() {
  if (pdfDoc && currentPage < pdfDoc.numPages) {
    currentPage++;
    goToPage(currentPage);
    updatePageInfo();
    updateNavigationButtons();
  }
}

function goToLastPage() {
  if (pdfDoc && pdfDoc.numPages > 0) {
    currentPage = pdfDoc.numPages;
    goToPage(currentPage);
    updatePageInfo();
    updateNavigationButtons();
  }
}

function updateNavigationButtons() {
  if (!pdfDoc) return;

  const firstPageBtn = document.getElementById('firstPageBtn');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const lastPageBtn = document.getElementById('lastPageBtn');

  if (firstPageBtn) firstPageBtn.disabled = currentPage <= 1;
  if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
  if (nextPageBtn) nextPageBtn.disabled = currentPage >= pdfDoc.numPages;
  if (lastPageBtn) lastPageBtn.disabled = currentPage >= pdfDoc.numPages;
}

// ===== IMAGE EXTRACTION =====
async function extractImagesFromPage(page, pageNum) {
  const images = [];

  try {
    console.log(`Starting image extraction for page ${pageNum}`);

    const operatorList = await page.getOperatorList();
    console.log(`Page ${pageNum} operator list:`, operatorList);
    console.log(`Found ${operatorList.fnArray.length} operations`);

    let imageIndex = 0;

    for (let i = 0; i < operatorList.fnArray.length; i++) {
      const fn = operatorList.fnArray[i];
      const args = operatorList.argsArray[i];

      // Check all possible image operations
      // OPS constants from PDF.js: paintImageXObject = 85, paintJpegXObject = 86, paintImageMaskXObject = 87
      if (fn === 85 || fn === 86 || fn === 87) {
        console.log(`Found image operation: fn=${fn}, args=`, args);
        const objId = args[0];

        try {
          // Wait for the object to be available with timeout
          const imgObj = await Promise.race([
            new Promise((resolve) => {
              page.objs.get(objId, resolve);
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Image object timeout')), 2000)
            ),
          ]);

          if (imgObj && !imgObj.error) {
            let base64Image = null;

            // Try different approaches to get image data
            if (imgObj.bitmap && imgObj.bitmap instanceof ImageBitmap) {
              console.log(`Found ImageBitmap, width: ${imgObj.width}, height: ${imgObj.height}`);
              base64Image = await convertImageBitmapToBase64(imgObj.bitmap);
            } else if (imgObj.data) {
              console.log(
                `Found image data, kind: ${imgObj.kind}, width: ${imgObj.width}, height: ${imgObj.height}`
              );
              base64Image = await convertImageToBase64(imgObj);
            } else if (imgObj instanceof HTMLImageElement) {
              // If it's already an HTML image element
              base64Image = await convertHTMLImageToBase64(imgObj);
            } else if (imgObj instanceof HTMLCanvasElement) {
              // If it's a canvas
              base64Image = imgObj.toDataURL('image/png');
            }

            if (base64Image) {
              const extractedImage = {
                id: `img_${pageNum}_${imageIndex}`,
                pageNum,
                base64: base64Image,
                width: imgObj.width || 0,
                height: imgObj.height || 0,
                x: 0,
                y: 0,
              };

              // Filter out very small images (likely icons, bullets, etc.)
              const minSize = 80; // Minimum width or height
              const minArea = 5000; // Minimum total area
              const area = extractedImage.width * extractedImage.height;

              if (
                extractedImage.width >= minSize ||
                extractedImage.height >= minSize ||
                area >= minArea
              ) {
                console.log(
                  `Successfully extracted meaningful image ${imageIndex} from page ${pageNum} (${extractedImage.width}×${extractedImage.height})`
                );
                images.push(extractedImage);
                imageIndex++;
              } else {
                console.log(
                  `Skipped small image: ${extractedImage.width}×${extractedImage.height} (too small)`
                );
              }
            } else {
              console.warn(`Could not convert image object to base64:`, imgObj);
            }
          } else {
            console.warn(`Image object ${objId} failed to load or has errors`);
          }
        } catch (objError) {
          // Handle JPEG 2000 and other decode errors gracefully
          if (objError.message.includes('JpxError') || objError.message.includes('OpenJPEG')) {
            console.warn(`Skipping JPEG 2000 image ${objId} (format not supported)`);
          } else {
            console.warn(`Failed to extract image object ${objId}:`, objError.message);
          }
        }
      }
    }

    console.log(`Extracted ${images.length} images from page ${pageNum}`);
    return images;
  } catch (error) {
    console.error(`Error extracting images from page ${pageNum}:`, error);
    return [];
  }
}

// ===== TABLE DETECTION =====
async function extractTablesFromPage(page, pageNum) {
  try {
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });

    // Convert text items to our format
    const textItems = textContent.items
      .filter((item) => item.str && item.str.trim().length > 0)
      .map((item) => {
        const transform = item.transform;
        const x = transform[4];
        const y = viewport.height - transform[5];

        return {
          str: item.str.trim(),
          x,
          y,
          width: item.width || 0,
          height: Math.abs(transform[3]) || 12,
          fontName: item.fontName || '',
          fontSize: Math.abs(transform[3]) || 12,
        };
      });

    if (textItems.length < 6) return [];

    // Simple table detection: group items into potential tables
    const tables = detectTablesFromTextItems(textItems, pageNum);
    return tables;
  } catch (error) {
    console.error(`Error detecting tables from page ${pageNum}:`, error);
    return [];
  }
}

// Helper function to convert image data to base64
async function convertImageToBase64(imgObj) {
  try {
    if (!imgObj.data) return null;

    const { data, width, height, kind } = imgObj;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = width;
    canvas.height = height;

    let imageData;

    // Handle different image formats
    switch (kind) {
      case 1: // GRAYSCALE_1BPP
        console.log('Converting grayscale 1BPP image');
        imageData = convertGrayscale1BPP(data, width, height);
        break;
      case 2: // RGB_24BPP
        console.log('Converting RGB 24BPP image');
        imageData = convertRGB24BPP(data, width, height);
        break;
      case 3: // RGBA_32BPP
        console.log('Converting RGBA 32BPP image');
        imageData = new ImageData(new Uint8ClampedArray(data), width, height);
        break;
      default:
        console.log(`Unknown image kind: ${kind}, trying RGBA`);
        // Try RGBA format
        imageData = new ImageData(new Uint8ClampedArray(data), width, height);
        break;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('Error converting image to base64:', error);
    return null;
  }
}

// Helper function to convert HTML image to base64
async function convertHTMLImageToBase64(imgElement) {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = imgElement.naturalWidth || imgElement.width;
    canvas.height = imgElement.naturalHeight || imgElement.height;

    ctx.drawImage(imgElement, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('Error converting HTML image to base64:', error);
    return null;
  }
}

// Helper function to convert ImageBitmap to base64
async function convertImageBitmapToBase64(imageBitmap) {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;

    // Draw the ImageBitmap to the canvas
    ctx.drawImage(imageBitmap, 0, 0);

    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('Error converting ImageBitmap to base64:', error);
    return null;
  }
}

// Helper function to convert RGB to RGBA
function convertRGB24BPP(data, width, height) {
  const rgbaData = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < data.length; i += 3) {
    const rgbaIndex = (i / 3) * 4;
    rgbaData[rgbaIndex] = data[i]; // R
    rgbaData[rgbaIndex + 1] = data[i + 1]; // G
    rgbaData[rgbaIndex + 2] = data[i + 2]; // B
    rgbaData[rgbaIndex + 3] = 255; // A
  }

  return new ImageData(rgbaData, width, height);
}

// Helper function to convert grayscale 1BPP to RGBA
function convertGrayscale1BPP(data, width, height) {
  const rgbaData = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    for (let bit = 7; bit >= 0; bit--) {
      const pixelIndex = (i * 8 + (7 - bit)) * 4;
      if (pixelIndex >= rgbaData.length) break;

      const value = (byte >> bit) & 1 ? 255 : 0;
      rgbaData[pixelIndex] = value; // R
      rgbaData[pixelIndex + 1] = value; // G
      rgbaData[pixelIndex + 2] = value; // B
      rgbaData[pixelIndex + 3] = 255; // A
    }
  }

  return new ImageData(rgbaData, width, height);
}

// ===== HELPER FUNCTIONS =====

// Helper function for table detection
function detectTablesFromTextItems(textItems, pageNum) {
  // Sort by Y then X
  const sortedItems = textItems.sort((a, b) => {
    const yDiff = Math.abs(a.y - b.y);
    if (yDiff < 5) {
      return a.x - b.x;
    }
    return a.y - b.y;
  });

  // Group into rows
  const rows = [];
  let currentRow = [];
  let currentY = sortedItems[0]?.y || 0;

  for (const item of sortedItems) {
    if (Math.abs(item.y - currentY) <= 10) {
      currentRow.push(item);
    } else {
      if (currentRow.length > 0) {
        rows.push([...currentRow]);
      }
      currentRow = [item];
      currentY = item.y;
    }
  }
  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  // Look for table patterns
  const tables = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const firstRow = rows[i];
    if (firstRow.length < 2) continue;

    const tableRows = [firstRow];

    // Find consecutive rows with similar structure
    for (let j = i + 1; j < rows.length; j++) {
      const nextRow = rows[j];
      if (rowsAreAligned(firstRow, nextRow)) {
        tableRows.push(nextRow);
      } else {
        break;
      }
    }

    if (tableRows.length >= 2) {
      const tableData = {
        id: `table_${pageNum}_${tables.length}`,
        pageNum,
        rows: tableRows.map((row) => row.map((item) => item.str)),
      };
      tables.push(tableData);
      i += tableRows.length - 1;
    }
  }

  return tables;
}

// Helper function to check row alignment
function rowsAreAligned(row1, row2) {
  if (Math.abs(row1.length - row2.length) > 1) return false;

  const minLength = Math.min(row1.length, row2.length);
  let alignedColumns = 0;

  for (let i = 0; i < minLength; i++) {
    if (Math.abs(row1[i].x - row2[i].x) <= 15) {
      alignedColumns++;
    }
  }

  return alignedColumns >= minLength * 0.7;
}

// ===== LAZY LOADING CONTENT SCANNING =====
async function initializeLazyInspector() {
  if (!pdfDoc) {
    console.error('initializeLazyInspector: PDF not loaded yet');
    // Show a message in the tree container instead of failing silently
    const container = document.getElementById('objectTree');
    if (container) {
      container.innerHTML =
        '<div class="loading-message">PDF is still loading. Please wait...</div>';
    }
    return;
  }

  if (!globalInspector) {
    console.error('initializeLazyInspector: globalInspector not initialized');
    return;
  }

  console.log('initializeLazyInspector: starting initialization');

  // Generate PDF file hash for cache keys
  await generatePdfFileHash();

  // Initialize progressive loading for pages
  initializePDFProgression();

  // Show immediate skeleton structure with click-to-scan prompts
  renderLazyLoadingSkeleton();
  console.log(`PDF object inspector ready - ${pdfDoc.numPages} pages available for scanning`);

  showStatusMessage('📋 PDF Object Inspector ready! Click any item to scan.');
}

// Generate a simple hash from PDF metadata for cache keys
async function generatePdfFileHash() {
  try {
    const metadata = await pdfDoc.getMetadata();
    const hashSource = `${PDF_CONFIG.fileName}_${pdfDoc.numPages}_${JSON.stringify(metadata.info || {})}`;
    // Simple hash function for browser compatibility
    let hash = 0;
    for (let i = 0; i < hashSource.length; i++) {
      const char = hashSource.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    globalInspector.pdfFileHash = Math.abs(hash).toString(36);
  } catch (error) {
    console.warn('Could not generate PDF hash, using fallback:', error);
    globalInspector.pdfFileHash = `fallback_${Date.now()}`;
  }
}

async function scanPageForContent(pageNum) {
  let page = null;

  try {
    page = await Promise.race([
      pdfDoc.getPage(pageNum),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Page load timeout')), 5000)),
    ]);

    let imageCount = 0;
    let tableCount = 0;

    // Initialize page objects set
    if (!globalInspector.pageObjects.has(pageNum)) {
      globalInspector.pageObjects.set(pageNum, new Set());
    }
    const pageObjectsSet = globalInspector.pageObjects.get(pageNum);

    // Extract images from this page with error isolation
    try {
      const imageData = await extractImagesFromPage(page, pageNum);
      if (imageData.length > 0) {
        imageData.forEach((img) => {
          // Legacy support - maintain existing array
          if (!extractedImages.find((existing) => existing.id === img.id)) {
            extractedImages.push(img);
            addImageToGallery(img);
            imageCount++;
          }

          // New inspector integration
          globalInspector.objects.images.set(img.id, {
            ...img,
            pageNum,
          });
          pageObjectsSet.add(img.id);
        });
      }
    } catch (imageError) {
      console.warn(`Image extraction failed for page ${pageNum}:`, imageError.message);
    }

    // Extract tables from this page with error isolation
    try {
      const tableData = await extractTablesFromPage(page, pageNum);
      if (tableData.length > 0) {
        tableData.forEach((table) => {
          // Legacy support - maintain existing array
          if (!extractedTables.find((existing) => existing.id === table.id)) {
            extractedTables.push(table);
            addTableToList(table);
            tableCount++;
          }

          // New inspector integration
          globalInspector.objects.tables.set(table.id, {
            ...table,
            pageNum,
          });
          pageObjectsSet.add(table.id);
        });
      }
    } catch (tableError) {
      console.warn(`Table extraction failed for page ${pageNum}:`, tableError.message);
    }

    console.log(`Page ${pageNum}: Found ${imageCount} images, ${tableCount} tables`);
  } catch (error) {
    console.error(`Failed to load page ${pageNum}:`, error.message);
    throw error;
  } finally {
    page = null;
  }
}

function clearExtractedContent() {
  // Clear legacy arrays
  extractedImages = [];
  extractedTables = [];

  // Clear new inspector data
  if (globalInspector) {
    globalInspector.objects.images.clear();
    globalInspector.objects.tables.clear();
    globalInspector.objects.fonts.clear();
    globalInspector.objects.annotations.clear();
    globalInspector.objects.formFields.clear();
    globalInspector.objects.attachments.clear();
    globalInspector.objects.bookmarks = [];
    globalInspector.objects.metadata = {};
    globalInspector.objects.javascript = [];
    globalInspector.pageObjects.clear();
    globalInspector.expandedNodes.clear();
  }

  // Clear tree view
  const container = document.getElementById('objectTree');
  if (container) {
    container.innerHTML =
      '<div class="loading-message">Click the inspector button to scan for PDF objects</div>';
  }

  // Maintain backward compatibility with legacy UI elements if they exist
  const imagesList = document.getElementById('imagesList');
  const tablesList = document.getElementById('tablesList');

  if (imagesList) {
    imagesList.innerHTML =
      '<div class="loading-message">Click the inspector button to scan for images</div>';
  }
  if (tablesList) {
    tablesList.innerHTML =
      '<div class="loading-message">Click the inspector button to scan for tables</div>';
  }
}

function initializePDFInspector() {
  console.log('PDF inspector initialized');
  globalInspector = new PDFObjectInspector();
  initializeModeSwitching();

  // Load saved mode preference
  const savedMode = localStorage.getItem('docpilot-inspector-mode');
  if (savedMode && (savedMode === 'objects' || savedMode === 'pages')) {
    globalInspector.currentMode = savedMode;
    updateModeButtons();
  }
}

function initializeModeSwitching() {
  const modeButtons = document.querySelectorAll('.mode-btn');
  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const newMode = button.getAttribute('data-mode');
      switchMode(newMode);
    });
  });
}

function switchMode(newMode) {
  if (!globalInspector || globalInspector.currentMode === newMode) return;

  globalInspector.currentMode = newMode;
  updateModeButtons();

  const container = document.getElementById('objectTree');
  container.style.opacity = '0.5';

  setTimeout(() => {
    renderObjectTree();
    container.style.opacity = '1';
  }, 150);

  localStorage.setItem('docpilot-inspector-mode', newMode);
}

function updateModeButtons() {
  const modeButtons = document.querySelectorAll('.mode-btn');
  modeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === globalInspector.currentMode);
  });
}

// Tree rendering system
function renderObjectTree() {
  if (!globalInspector) {
    console.warn('renderObjectTree: globalInspector not initialized');
    return;
  }

  const container = document.getElementById('objectTree');
  if (!container) {
    console.warn('renderObjectTree: objectTree container not found');
    return;
  }

  if (globalInspector.currentMode === 'objects') {
    const treeHtml = renderObjectCentricTree();
    container.innerHTML = treeHtml;
  } else {
    const treeHtml = renderPageCentricTree();
    container.innerHTML = treeHtml;
  }

  attachTreeEventListeners();
}

function renderObjectCentricTree() {
  const objectTypes = [
    { key: 'images', label: 'Images', icon: '🖼️' },
    { key: 'tables', label: 'Tables', icon: '📊' },
    { key: 'fonts', label: 'Fonts', icon: '🔤' },
    { key: 'annotations', label: 'Annotations', icon: '📝' },
    { key: 'formFields', label: 'Form Fields', icon: '📋' },
    { key: 'attachments', label: 'Attachments', icon: '📎' },
    { key: 'bookmarks', label: 'Bookmarks', icon: '🔖' },
    { key: 'javascript', label: 'JavaScript', icon: '⚙️' },
    { key: 'metadata', label: 'Metadata', icon: '📑' },
  ];

  let html = '<div class="tree-root">';

  for (const type of objectTypes) {
    const count = globalInspector.getObjectCount(type.key);
    const hasObjects = globalInspector.hasObjectsOfType(type.key);
    const isExpanded = globalInspector.expandedNodes.has(type.key);
    const cacheKey = globalInspector.generateCacheKey(type.key);
    const cachedData = globalInspector.getCachedData(cacheKey);
    const isScanned = hasObjects || cachedData;

    // Determine badge content with progressive scanning feedback
    let badgeContent = '';
    const scanProgress = globalInspector.progressiveLoading.objectMode.scanningProgress.get(
      type.key
    );

    if (scanProgress?.isProgressive) {
      // Show progressive scanning status with real-time count and progress
      const currentCount = scanProgress.results.length;
      badgeContent = `${currentCount} (${scanProgress.current}/${scanProgress.total})`;
    } else if (globalInspector.isScanPending(cacheKey)) {
      badgeContent = '🔍 Scanning...';
    } else if (count > 0) {
      badgeContent = count;
    }

    html += `
      <div class="tree-node ${isScanned ? 'expandable' : 'clickable'} ${isExpanded ? 'expanded' : ''}" 
           data-node="${type.key}">
        <div class="tree-node-header" onclick="${isScanned ? `toggleNode('${type.key}')` : `scanObjectType('${type.key}')`}">
          <span class="tree-expand-icon">${isScanned ? (isExpanded ? '▼' : '▶') : '▶'}</span>
          <span class="tree-icon">${type.icon}</span>
          <span class="tree-label">${type.label}</span>
          ${badgeContent ? `<span class="tree-badge">${badgeContent}</span>` : ''}
        </div>
        ${isScanned ? `<div class="tree-children">${renderObjectTypeChildren(type.key)}</div>` : ''}
      </div>
    `;
  }

  return `${html}</div>`;
}

function renderPageCentricTree() {
  if (!pdfDoc) return '<div class="loading-message">PDF not loaded</div>';

  let html = '<div class="tree-root">';

  // Progressive page loading - show only a batch at a time
  const totalPages = pdfDoc.numPages;
  const currentlyShown = globalInspector.progressiveLoading.pageMode.currentlyShown;
  const batchSize = globalInspector.progressiveLoading.pageMode.batchSize;
  const pagesToShow = Math.min(currentlyShown + batchSize, totalPages);

  // Individual pages (show progressively)
  for (let pageNum = 1; pageNum <= pagesToShow; pageNum++) {
    const pageObjects = globalInspector.pageObjects.get(pageNum) || new Set();
    const isExpanded = globalInspector.expandedNodes.has(`page-${pageNum}`);
    const cacheKey = globalInspector.generateCacheKey('page-objects', pageNum);
    const isScanned = pageObjects.size > 0 || globalInspector.getCachedData(cacheKey);

    // Determine badge content
    let badgeContent = '';
    if (globalInspector.isScanPending(cacheKey)) {
      badgeContent = '🔍 Scanning...';
    } else if (pageObjects.size > 0) {
      badgeContent = pageObjects.size;
    }

    html += `
      <div class="tree-node ${isScanned ? 'expandable' : 'clickable'} ${isExpanded ? 'expanded' : ''}" 
           data-node="page-${pageNum}">
        <div class="tree-node-header" onclick="${isScanned ? `toggleNode('page-${pageNum}')` : `scanPageObjects(${pageNum})`}">
          <span class="tree-expand-icon">${isScanned ? (isExpanded ? '▼' : '▶') : '▶'}</span>
          <span class="tree-icon">📄</span>
          <span class="tree-label">Page ${pageNum}</span>
          ${badgeContent ? `<span class="tree-badge">${badgeContent}</span>` : ''}
        </div>
        ${
          isScanned
            ? `<div class="tree-children">${renderPageObjectsList(pageNum, pageObjects)}</div>`
            : ''
        }
      </div>
    `;
  }

  // Show "Load More Pages" button if there are more pages
  if (pagesToShow < totalPages) {
    const remaining = totalPages - pagesToShow;
    const showMoreInProgress = globalInspector.progressiveLoading.pageMode.showMoreInProgress;
    html += `
      <div class="tree-node clickable load-more-pages" onclick="loadMorePages()">
        <div class="tree-node-header">
          <span class="tree-expand-icon">⬇️</span>
          <span class="tree-icon">📄</span>
          <span class="tree-label">${showMoreInProgress ? 'Loading...' : `Load More Pages (${remaining} remaining)`}</span>
        </div>
      </div>
    `;
  }

  // Document-wide objects section
  const docTypes = ['attachments', 'bookmarks', 'javascript', 'metadata'];
  const hasAnyDocObjects = docTypes.some((type) => globalInspector.hasObjectsOfType(type));
  const docCacheKey = globalInspector.generateCacheKey('document-wide');
  const isDocScanned = hasAnyDocObjects || globalInspector.getCachedData(docCacheKey);

  const isExpanded = globalInspector.expandedNodes.has('document-wide');

  // Determine badge content for document-wide
  let docBadgeContent = '';
  if (globalInspector.isScanPending(docCacheKey)) {
    docBadgeContent = '🔍 Scanning...';
  } else if (hasAnyDocObjects) {
    const totalDocObjects = docTypes.reduce(
      (count, type) => count + globalInspector.getObjectCount(type),
      0
    );
    docBadgeContent = totalDocObjects;
  }

  html += `
    <div class="tree-node ${isDocScanned ? 'expandable' : 'clickable'} ${isExpanded ? 'expanded' : ''}" 
         data-node="document-wide">
      <div class="tree-node-header" onclick="${isDocScanned ? `toggleNode('document-wide')` : `scanDocumentWideObjects()`}">
        <span class="tree-expand-icon">${isDocScanned ? (isExpanded ? '▼' : '▶') : '▶'}</span>
        <span class="tree-icon">📋</span>
        <span class="tree-label">Document-Wide Objects</span>
        ${docBadgeContent ? `<span class="tree-badge">${docBadgeContent}</span>` : ''}
      </div>
      ${isDocScanned ? `<div class="tree-children">${renderDocumentWideObjects()}</div>` : ''}
    </div>
  `;

  return `${html}</div>`;
}

function renderObjectTypeChildren(objectType) {
  let html = '';

  if (objectType === 'images') {
    const objectsMap = globalInspector.objects[objectType];
    // Progressive rendering for images
    const currentlyShown =
      globalInspector.progressiveLoading.objectMode.currentlyShown.get('images') || objectsMap.size;
    let index = 0;

    objectsMap.forEach((obj, id) => {
      if (index >= currentlyShown) return; // Skip items beyond current batch

      html += `
        <div class="tree-object-preview">
          <div class="tree-object-thumbnail">
            <img src="${obj.base64}" title="Click to go to page ${obj.pageNum}">
          </div>
          <div class="tree-object-info" onclick="navigateToObject('${id}', '${objectType}', ${obj.pageNum})">
            <div class="tree-object-info-title">Page ${obj.pageNum} 🖼️</div>
            <div class="tree-object-info-details">${obj.width} × ${obj.height}</div>
          </div>
          <div class="tree-object-actions">
            <button class="tree-action-btn" onclick="copyImageToClipboard('${id}')" title="Copy image to clipboard">Copy</button>
          </div>
        </div>
      `;
      index++;
    });
  } else if (objectType === 'tables') {
    const objectsMap = globalInspector.objects[objectType];
    // Progressive rendering for tables
    const currentlyShown =
      globalInspector.progressiveLoading.objectMode.currentlyShown.get('tables') || objectsMap.size;
    let index = 0;

    objectsMap.forEach((obj, id) => {
      if (index >= currentlyShown) return; // Skip items beyond current batch

      const maxCols = Math.max(...obj.rows.map((row) => row.length));
      html += `
        <div class="tree-object-preview">
          <div class="tree-object-thumbnail">
            📊
          </div>
          <div class="tree-object-info" onclick="navigateToObject('${id}', '${objectType}', ${obj.pageNum})">
            <div class="tree-object-info-title">Page ${obj.pageNum}</div>
            <div class="tree-object-info-details">${obj.rows.length} × ${maxCols} table</div>
          </div>
          <div class="tree-object-actions">
            <button class="tree-action-btn" onclick="copyTableAsCSV('${id}')" title="Copy table as CSV">Copy CSV</button>
          </div>
        </div>
      `;
      index++;
    });
  } else if (objectType === 'metadata') {
    html += renderMetadataTable();
  } else if (objectType === 'bookmarks') {
    const bookmarks = globalInspector.objects.bookmarks;
    if (bookmarks.length > 0) {
      html += renderBookmarkItems(bookmarks);
    } else {
      html =
        '<div class="tree-object-item"><span class="tree-icon">∅</span><span class="tree-label">No bookmarks found</span></div>';
    }
  } else if (objectType === 'attachments') {
    html += renderAttachmentItems();
  } else if (objectType === 'javascript') {
    html += renderJavaScriptItems();
  } else if (objectType === 'formFields') {
    html += renderFormFieldItems();
  } else if (objectType === 'fonts') {
    html += renderFontItems();
  } else if (objectType === 'annotations') {
    html += renderAnnotationItems();
  } else {
    // Lazy loading placeholder for other object types
    html = `<div class="tree-object-item" onclick="loadObjectType('${objectType}')">
      <span class="tree-icon">⏳</span>
      <span class="tree-label">Click to load ${objectType}...</span>
    </div>`;
  }

  // Add "Load More" button for progressive object loading if needed
  if (['images', 'tables', 'fonts', 'annotations'].includes(objectType)) {
    const currentlyShown =
      globalInspector.progressiveLoading.objectMode.currentlyShown.get(objectType) || 0;
    const totalObjects = globalInspector.getObjectCount(objectType);
    const showMoreInProgress =
      globalInspector.progressiveLoading.objectMode.showMoreInProgress.has(objectType);

    if (totalObjects > currentlyShown) {
      const remaining = totalObjects - currentlyShown;
      html += `
        <div class="tree-object-item load-more-objects" onclick="loadMoreObjects('${objectType}')">
          <span class="tree-icon">⬇️</span>
          <span class="tree-label">${showMoreInProgress ? 'Loading...' : `Load More (${remaining} remaining)`}</span>
        </div>
      `;
    }
  }

  return html;
}

function renderPageObjectsList(pageNum, pageObjects) {
  let html = '';

  pageObjects.forEach((objectId) => {
    let objectType = '';
    const icon = '📄';
    const label = objectId;

    if (objectId.includes('img_')) {
      objectType = 'image';
      const obj = globalInspector.objects.images.get(objectId);
      if (obj) {
        html += `
          <div class="tree-object-preview">
            <div class="tree-object-thumbnail">
              <img src="${obj.base64}" title="Click to go to page ${obj.pageNum}">
            </div>
            <div class="tree-object-info" onclick="navigateToObject('${objectId}', '${objectType}', ${pageNum})">
              <div class="tree-object-info-title">🖼️ ${objectId.replace(`img_${pageNum}_`, 'Image ')}</div>
              <div class="tree-object-info-details">${obj.width} × ${obj.height}</div>
            </div>
            <div class="tree-object-actions">
              <button class="tree-action-btn" onclick="copyImageToClipboard('${objectId}')" title="Copy image to clipboard">Copy</button>
            </div>
          </div>
        `;
      }
    } else if (objectId.includes('table_')) {
      objectType = 'table';
      const obj = globalInspector.objects.tables.get(objectId);
      if (obj) {
        const maxCols = Math.max(...obj.rows.map((row) => row.length));
        html += `
          <div class="tree-object-preview">
            <div class="tree-object-thumbnail">
              📊
            </div>
            <div class="tree-object-info" onclick="navigateToObject('${objectId}', '${objectType}', ${pageNum})">
              <div class="tree-object-info-title">📊 ${objectId.replace(`table_${pageNum}_`, 'Table ')}</div>
              <div class="tree-object-info-details">${obj.rows.length} × ${maxCols} table</div>
            </div>
            <div class="tree-object-actions">
              <button class="tree-action-btn" onclick="copyTableAsCSV('${objectId}')" title="Copy table as CSV">Copy CSV</button>
            </div>
          </div>
        `;
      }
    } else {
      html += `
        <div class="tree-object-item" onclick="navigateToObject('${objectId}', '${objectType}', ${pageNum})">
          <span class="tree-icon">${icon}</span>
          <span class="tree-label">${label}</span>
        </div>
      `;
    }
  });

  if (html === '') {
    html =
      '<div class="tree-object-item"><span class="tree-icon">∅</span><span class="tree-label">No objects found</span></div>';
  }

  return html;
}

function renderDocumentWideObjects() {
  let html = '';

  // Render metadata as a table (same as in object-centric mode)
  if (globalInspector.hasObjectsOfType('metadata')) {
    const metadata = globalInspector.objects.metadata;
    html += `
      <div class="tree-node expandable ${globalInspector.expandedNodes.has('doc-metadata') ? 'expanded' : ''}" 
           data-node="doc-metadata">
        <div class="tree-node-header" onclick="toggleNode('doc-metadata')">
          <span class="tree-expand-icon">${globalInspector.expandedNodes.has('doc-metadata') ? '▼' : '▶'}</span>
          <span class="tree-icon">📑</span>
          <span class="tree-label">Metadata</span>
          <span class="tree-badge">${Object.keys(metadata).length}</span>
        </div>
        <div class="tree-children">
          ${renderMetadataTable()}
        </div>
      </div>
    `;
  }

  // Render bookmarks
  if (globalInspector.hasObjectsOfType('bookmarks')) {
    const bookmarks = globalInspector.objects.bookmarks;
    html += `
      <div class="tree-node expandable ${globalInspector.expandedNodes.has('doc-bookmarks') ? 'expanded' : ''}" 
           data-node="doc-bookmarks">
        <div class="tree-node-header" onclick="toggleNode('doc-bookmarks')">
          <span class="tree-expand-icon">${globalInspector.expandedNodes.has('doc-bookmarks') ? '▼' : '▶'}</span>
          <span class="tree-icon">🔖</span>
          <span class="tree-label">Bookmarks</span>
          <span class="tree-badge">${bookmarks.length}</span>
        </div>
        <div class="tree-children">
          ${renderBookmarkItems(bookmarks)}
        </div>
      </div>
    `;
  }

  // Render attachments
  if (globalInspector.hasObjectsOfType('attachments')) {
    const attachments = globalInspector.objects.attachments;
    html += `
      <div class="tree-node expandable ${globalInspector.expandedNodes.has('doc-attachments') ? 'expanded' : ''}" 
           data-node="doc-attachments">
        <div class="tree-node-header" onclick="toggleNode('doc-attachments')">
          <span class="tree-expand-icon">${globalInspector.expandedNodes.has('doc-attachments') ? '▼' : '▶'}</span>
          <span class="tree-icon">📎</span>
          <span class="tree-label">Attachments</span>
          <span class="tree-badge">${attachments.size}</span>
        </div>
        <div class="tree-children">
          ${renderAttachmentItems()}
        </div>
      </div>
    `;
  }

  // Render JavaScript
  if (globalInspector.hasObjectsOfType('javascript')) {
    const javascript = globalInspector.objects.javascript;
    html += `
      <div class="tree-node expandable ${globalInspector.expandedNodes.has('doc-javascript') ? 'expanded' : ''}" 
           data-node="doc-javascript">
        <div class="tree-node-header" onclick="toggleNode('doc-javascript')">
          <span class="tree-expand-icon">${globalInspector.expandedNodes.has('doc-javascript') ? '▼' : '▶'}</span>
          <span class="tree-icon">⚙️</span>
          <span class="tree-label">JavaScript</span>
          <span class="tree-badge">${javascript.length}</span>
        </div>
        <div class="tree-children">
          ${renderJavaScriptItems()}
        </div>
      </div>
    `;
  }

  // Render form fields if they exist
  if (globalInspector.hasObjectsOfType('formFields')) {
    const formFields = globalInspector.objects.formFields;
    html += `
      <div class="tree-node expandable ${globalInspector.expandedNodes.has('doc-formfields') ? 'expanded' : ''}" 
           data-node="doc-formfields">
        <div class="tree-node-header" onclick="toggleNode('doc-formfields')">
          <span class="tree-expand-icon">${globalInspector.expandedNodes.has('doc-formfields') ? '▼' : '▶'}</span>
          <span class="tree-icon">📋</span>
          <span class="tree-label">Form Fields</span>
          <span class="tree-badge">${formFields.size}</span>
        </div>
        <div class="tree-children">
          ${renderFormFieldItems()}
        </div>
      </div>
    `;
  }

  return html;
}

// Lazy loading skeleton rendering
function renderLazyLoadingSkeleton() {
  globalInspector.lazyScanning = true;
  renderObjectTree();
}

// Skeleton rendering for progressive loading (legacy - now redirects to lazy loading)
function attachTreeEventListeners() {
  // Event listeners are handled via onclick attributes in the HTML
  // This maintains compatibility with the existing approach
}

// Progressive loading helper functions
function toggleNode(nodeId) {
  if (globalInspector.expandedNodes.has(nodeId)) {
    globalInspector.expandedNodes.delete(nodeId);
  } else {
    globalInspector.expandedNodes.add(nodeId);
  }
  renderObjectTree();
}

function navigateToObject(objectId, objectType, pageNum) {
  console.log(`Navigating to ${objectType} ${objectId} on page ${pageNum}`);
  goToPage(pageNum);
}

function loadObjectType(objectType) {
  // Most object types are already loaded, just re-render the tree
  // This function is mainly for future lazy loading features
  console.log(`Loading object type: ${objectType}`);
  renderObjectTree();
}

// Helper functions for object interaction
function copyMetadataAsJSON() {
  const metadata = globalInspector.objects.metadata;
  if (metadata && Object.keys(metadata).length > 0) {
    try {
      const jsonString = JSON.stringify(metadata, null, 2);
      navigator.clipboard
        .writeText(jsonString)
        .then(() => {
          console.log('Metadata copied as JSON to clipboard');
          showStatusMessage('Metadata JSON copied to clipboard! 📋');
        })
        .catch((err) => {
          console.error('Failed to copy metadata JSON:', err);
          showStatusMessage('Failed to copy metadata ❌');
        });
    } catch (error) {
      console.error('Failed to stringify metadata:', error);
      showStatusMessage('Failed to format metadata as JSON ❌');
    }
  } else {
    showStatusMessage('No metadata to copy ❌');
  }
}

function renderBookmarkItems(bookmarks, level = 0) {
  let html = '';
  const _indent = '  '.repeat(level);

  bookmarks.forEach((bookmark, index) => {
    const dest = bookmark.dest;
    const pageNum = dest && Array.isArray(dest) && dest[0] && dest[0].num ? dest[0].num : 'Unknown';

    html += `
      <div class="tree-object-preview" style="margin-left: ${level * 20}px">
        <div class="tree-object-thumbnail">
          🔖
        </div>
        <div class="tree-object-info" onclick="navigateToBookmark(${index}, ${pageNum})">
          <div class="tree-object-info-title">${bookmark.title || `Bookmark ${index + 1}`}</div>
          <div class="tree-object-info-details">Page ${pageNum}</div>
        </div>
      </div>
    `;

    // Render child bookmarks if they exist
    if (bookmark.items && bookmark.items.length > 0) {
      html += renderBookmarkItems(bookmark.items, level + 1);
    }
  });

  return html;
}

function navigateToBookmark(index, pageNum) {
  console.log(`Navigating to bookmark ${index} on page ${pageNum}`);
  if (pageNum !== 'Unknown' && pageNum > 0) {
    goToPage(pageNum);
  }
}

function downloadAttachment(filename) {
  const attachment = globalInspector.objects.attachments.get(filename);
  if (attachment?.content) {
    try {
      const blob = new Blob([attachment.content], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      showStatusMessage(`${filename} downloaded! 📁`);
    } catch (error) {
      console.error('Failed to download attachment:', error);
      showStatusMessage('Failed to download attachment ❌');
    }
  } else {
    showStatusMessage('Attachment content not available ❌');
  }
}

function viewJavaScript(index) {
  const js = globalInspector.objects.javascript[index];
  if (js) {
    const content = js.action || 'No content available';
    // For now, just copy to clipboard as we can't show a modal
    navigator.clipboard
      .writeText(content)
      .then(() => {
        showStatusMessage('JavaScript copied to clipboard! 📋');
      })
      .catch(() => {
        showStatusMessage('Failed to copy JavaScript ❌');
      });
  }
}

// Helper functions to render individual object types consistently
function renderMetadataTable() {
  const metadata = globalInspector.objects.metadata;
  if (Object.keys(metadata).length === 0) {
    return '<div class="tree-object-item"><span class="tree-icon">∅</span><span class="tree-label">No metadata found</span></div>';
  }

  let html = `
    <div class="metadata-table-container">
      <div class="metadata-table-header">
        <span class="metadata-table-title">PDF Metadata</span>
        <button class="tree-action-btn" onclick="copyMetadataAsJSON()" title="Copy all metadata as JSON">Copy JSON</button>
      </div>
      <table class="metadata-table">
        <thead>
          <tr>
            <th>Property</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
  `;

  Object.entries(metadata).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      const displayValue =
        String(value).length > 80 ? `${String(value).substring(0, 80)}...` : String(value);
      html += `
        <tr>
          <td>${key}</td>
          <td title="${String(value).replace(/"/g, '&quot;')}">${displayValue}</td>
        </tr>
      `;
    }
  });

  html += `
        </tbody>
      </table>
    </div>
  `;

  return html;
}

function renderAttachmentItems() {
  let html = '';
  const attachments = globalInspector.objects.attachments;

  if (attachments.size === 0) {
    return '<div class="tree-object-item"><span class="tree-icon">∅</span><span class="tree-label">No attachments found</span></div>';
  }

  attachments.forEach((attachment, filename) => {
    html += `
      <div class="tree-object-preview">
        <div class="tree-object-thumbnail">
          📎
        </div>
        <div class="tree-object-info">
          <div class="tree-object-info-title">${filename}</div>
          <div class="tree-object-info-details">${attachment.size ? `${attachment.size} bytes` : 'Unknown size'}</div>
        </div>
        <div class="tree-object-actions">
          <button class="tree-action-btn" onclick="downloadAttachment('${filename}')" title="Download attachment">Download</button>
        </div>
      </div>
    `;
  });

  return html;
}

function renderJavaScriptItems() {
  let html = '';
  const javascript = globalInspector.objects.javascript;

  if (javascript.length === 0) {
    return '<div class="tree-object-item"><span class="tree-icon">∅</span><span class="tree-label">No JavaScript found</span></div>';
  }

  javascript.forEach((js, index) => {
    html += `
      <div class="tree-object-preview">
        <div class="tree-object-thumbnail">
          ⚙️
        </div>
        <div class="tree-object-info">
          <div class="tree-object-info-title">${js.name || `Script ${index + 1}`}</div>
          <div class="tree-object-info-details">JavaScript Action</div>
        </div>
        <div class="tree-object-actions">
          <button class="tree-action-btn" onclick="viewJavaScript(${index})" title="View script">View</button>
        </div>
      </div>
    `;
  });

  return html;
}

function renderFormFieldItems() {
  let html = '';
  const formFields = globalInspector.objects.formFields;

  if (formFields.size === 0) {
    return '<div class="tree-object-item"><span class="tree-icon">∅</span><span class="tree-label">No form fields found</span></div>';
  }

  formFields.forEach((field, fieldName) => {
    const pagesList = Array.from(field.pages || []).join(', ');
    html += `
      <div class="tree-object-preview">
        <div class="tree-object-thumbnail">
          📋
        </div>
        <div class="tree-object-info">
          <div class="tree-object-info-title">${fieldName}</div>
          <div class="tree-object-info-details">${field.type || 'Form Field'}${pagesList ? ` (Pages: ${pagesList})` : ''}</div>
        </div>
      </div>
    `;
  });

  return html;
}

function renderFontItems() {
  let html = '';
  const fonts = globalInspector.objects.fonts;

  if (fonts.size === 0) {
    return '<div class="tree-object-item"><span class="tree-icon">∅</span><span class="tree-label">No fonts found</span></div>';
  }

  // Progressive rendering - show only a batch at a time
  const currentlyShown =
    globalInspector.progressiveLoading.objectMode.currentlyShown.get('fonts') || fonts.size;
  let index = 0;

  fonts.forEach((font) => {
    if (index >= currentlyShown) return; // Skip items beyond current batch

    const pagesList = font.pages ? font.pages.join(', ') : '';
    const pageCount = font.pageCount || font.pages?.length || 0;
    html += `
      <div class="tree-object-preview">
        <div class="tree-object-thumbnail">
          🔤
        </div>
        <div class="tree-object-info">
          <div class="tree-object-info-title">${font.name}</div>
          <div class="tree-object-info-details">${font.type || 'Font'}${pageCount > 1 ? ` (${pageCount} pages: ${pagesList})` : pagesList ? ` (Page ${pagesList})` : ''}</div>
        </div>
      </div>
    `;
    index++;
  });

  return html;
}

function renderAnnotationItems() {
  let html = '';
  const annotations = globalInspector.objects.annotations;

  if (annotations.size === 0) {
    return '<div class="tree-object-item"><span class="tree-icon">∅</span><span class="tree-label">No annotations found</span></div>';
  }

  // Progressive rendering - show only a batch at a time
  const currentlyShown =
    globalInspector.progressiveLoading.objectMode.currentlyShown.get('annotations') ||
    annotations.size;
  let index = 0;

  annotations.forEach((annotation) => {
    if (index >= currentlyShown) return; // Skip items beyond current batch

    const pageNum = annotation.pageNum || 'Unknown';
    const type = annotation.subtype || annotation.type || 'Annotation';
    const title = annotation.title || annotation.contents || `${type} on Page ${pageNum}`;
    html += `
      <div class="tree-object-preview" onclick="navigateToObject('${annotation.id}', 'annotation', ${pageNum})">
        <div class="tree-object-thumbnail">
          📝
        </div>
        <div class="tree-object-info">
          <div class="tree-object-info-title">${title}</div>
          <div class="tree-object-info-details">${type} - Page ${pageNum}</div>
        </div>
      </div>
    `;
    index++;
  });

  return html;
}

// ===== GLOBAL FUNCTION EXPORTS =====
// Expose functions globally for HTML onclick handlers
window.fitToWidth = fitToWidth;
window.fitToPage = fitToPage;
window.summarizeDocument = summarizeDocument;
window.exportText = exportText;
window.toggleTextSelection = toggleTextSelection;
window.toggleDebug = toggleDebug;
window.toggleInspector = toggleInspector;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.setZoom = setZoom;
window.downloadPdfFallback = downloadPdfFallback;
window.openInBrowser = openInBrowser;
window.copyImageToClipboard = copyImageToClipboard;
window.copyTableAsCSV = copyTableAsCSV;
window.goToPage = goToPage;
window.goToFirstPage = goToFirstPage;
window.goToPreviousPage = goToPreviousPage;
window.goToNextPage = goToNextPage;
window.goToLastPage = goToLastPage;

// New dual-mode object inspector functions
window.toggleNode = toggleNode;
window.navigateToObject = navigateToObject;
window.loadObjectType = loadObjectType;
window.copyMetadataAsJSON = copyMetadataAsJSON;
window.navigateToBookmark = navigateToBookmark;
window.downloadAttachment = downloadAttachment;
window.viewJavaScript = viewJavaScript;

// Lazy loading functions
window.scanObjectType = scanObjectType;
window.scanPageObjects = scanPageObjects;
window.scanDocumentWideObjects = scanDocumentWideObjects;

// Progressive loading functions
window.loadMorePages = loadMorePages;
window.loadMoreObjects = loadMoreObjects;

// ===== LAZY LOADING SCAN FUNCTIONS =====

// Scan specific object type (Object-Centric mode)
async function scanObjectType(objectType) {
  const cacheKey = globalInspector.generateCacheKey(objectType);

  if (globalInspector.isScanPending(cacheKey)) {
    console.log(`Scan already in progress for ${objectType}`);
    return;
  }

  // Check if we already have cached data
  const cachedData = globalInspector.getCachedData(cacheKey);
  if (cachedData) {
    console.log(`Using cached data for ${objectType}`);
    applyObjectScanResults(objectType, cachedData);
    renderObjectTree();
    return;
  }

  console.log(`Starting progressive scan for object type: ${objectType}`);
  globalInspector.setCacheStatus(cacheKey, 'loading');
  globalInspector.pendingScans.add(cacheKey);

  // Initialize progress tracking
  globalInspector.progressiveLoading.objectMode.scanningProgress.set(objectType, {
    current: 0,
    total: 0,
    results: [],
    isProgressive: false,
  });

  // Update UI to show scanning state
  renderObjectTree();

  try {
    let results = [];

    switch (objectType) {
      case 'images':
        results = await globalInspector.scanObjectsProgressively(objectType, scanPageImages);
        break;
      case 'tables':
        results = await globalInspector.scanObjectsProgressively(objectType, scanPageTables);
        break;
      case 'fonts':
        results = await globalInspector.scanObjectsProgressively(objectType, scanPageFonts);
        break;
      case 'annotations':
        results = await globalInspector.scanObjectsProgressively(objectType, scanPageAnnotations);
        break;
      case 'formFields':
      case 'attachments':
      case 'bookmarks':
      case 'javascript':
      case 'metadata':
        // Document-level objects don't need progressive scanning
        results = await scanDocumentLevelObjects([objectType]);
        break;
      default:
        throw new Error(`Unknown object type: ${objectType}`);
    }

    // Cache the final results
    globalInspector.setCacheStatus(cacheKey, 'complete', results);

    // Clean up progress tracking
    globalInspector.progressiveLoading.objectMode.scanningProgress.delete(objectType);

    // Apply final results to inspector (might already be applied during progressive scan)
    applyObjectScanResults(objectType, results);

    // Automatically expand the node to show results
    globalInspector.expandedNodes.add(objectType);
    console.log(`Auto-expanded ${objectType} node after scan`);

    // Initialize progressive loading for this object type
    initializeObjectProgression(objectType, results);

    console.log(
      `Completed scan for ${objectType}: found ${results.length || Object.keys(results).length} items`
    );
    showStatusMessage(`✅ ${objectType} scan complete!`);

    // Force immediate re-render to show expanded state
    renderObjectTree();
  } catch (error) {
    console.error(`Failed to scan ${objectType}:`, error);
    globalInspector.setCacheStatus(cacheKey, 'error', error.message);
    globalInspector.progressiveLoading.objectMode.scanningProgress.delete(objectType);
    showStatusMessage(`❌ Failed to scan ${objectType}: ${error.message}`);
  } finally {
    globalInspector.pendingScans.delete(cacheKey);
    // Final render in case of errors
    renderObjectTree();
  }
}

// Scan specific page objects (Page-Centric mode)
async function scanPageObjects(pageNum) {
  const cacheKey = globalInspector.generateCacheKey('page-objects', pageNum);

  if (globalInspector.isScanPending(cacheKey)) {
    console.log(`Scan already in progress for page ${pageNum}`);
    return;
  }

  // Check if we already have cached data
  const cachedData = globalInspector.getCachedData(cacheKey);
  if (cachedData) {
    console.log(`Using cached data for page ${pageNum}`);
    applyPageScanResults(pageNum, cachedData);
    renderObjectTree();
    return;
  }

  console.log(`Starting lazy scan for page ${pageNum}`);
  globalInspector.setCacheStatus(cacheKey, 'loading');
  globalInspector.pendingScans.add(cacheKey);

  // Update UI to show scanning state
  renderObjectTree();

  try {
    // Scan the specific page
    await scanPageForContent(pageNum);

    // Get the results
    const pageObjects = globalInspector.pageObjects.get(pageNum) || new Set();
    const results = Array.from(pageObjects);

    // Cache the results
    globalInspector.setCacheStatus(cacheKey, 'complete', results);

    // Automatically expand the page node to show results
    globalInspector.expandedNodes.add(`page-${pageNum}`);

    console.log(`Completed scan for page ${pageNum}: found ${results.length} objects`);
    showStatusMessage(`✅ Page ${pageNum} scan complete!`);
  } catch (error) {
    console.error(`Failed to scan page ${pageNum}:`, error);
    globalInspector.setCacheStatus(cacheKey, 'error', error.message);
    showStatusMessage(`❌ Failed to scan page ${pageNum}: ${error.message}`);
  } finally {
    globalInspector.pendingScans.delete(cacheKey);
    renderObjectTree();
  }
}

// Scan document-wide objects
async function scanDocumentWideObjects() {
  const cacheKey = globalInspector.generateCacheKey('document-wide');

  if (globalInspector.isScanPending(cacheKey)) {
    console.log('Document-wide scan already in progress');
    return;
  }

  // Check if we already have cached data
  const cachedData = globalInspector.getCachedData(cacheKey);
  if (cachedData) {
    console.log('Using cached document-wide data');
    applyDocumentScanResults(cachedData);
    renderObjectTree();
    return;
  }

  console.log('Starting lazy scan for document-wide objects');
  globalInspector.setCacheStatus(cacheKey, 'loading');
  globalInspector.pendingScans.add(cacheKey);

  // Update UI to show scanning state
  renderObjectTree();

  try {
    // Scan all document-level objects
    const results = await scanDocumentLevelObjects([
      'attachments',
      'bookmarks',
      'javascript',
      'metadata',
      'formFields',
    ]);

    // Cache the results
    globalInspector.setCacheStatus(cacheKey, 'complete', results);

    // Apply results to inspector
    applyDocumentScanResults(results);

    // Automatically expand the document-wide node to show results
    globalInspector.expandedNodes.add('document-wide');

    const totalCount = Object.values(results).reduce((count, data) => {
      if (Array.isArray(data)) return count + data.length;
      if (data && typeof data === 'object') return count + Object.keys(data).length;
      return count;
    }, 0);

    console.log(`Completed document-wide scan: found ${totalCount} objects`);
    showStatusMessage(`✅ Document-wide scan complete!`);
  } catch (error) {
    console.error('Failed to scan document-wide objects:', error);
    globalInspector.setCacheStatus(cacheKey, 'error', error.message);
    showStatusMessage(`❌ Failed to scan document objects: ${error.message}`);
  } finally {
    globalInspector.pendingScans.delete(cacheKey);
    renderObjectTree();
  }
}

// Helper function to scan all images across pages
// Page-specific scanning functions for progressive mode
async function scanPageImages(pageNum) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    return await extractImagesFromPage(page, pageNum);
  } catch (error) {
    console.warn(`Failed to extract images from page ${pageNum}:`, error);
    return [];
  }
}

async function scanPageTables(pageNum) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    return await extractTablesFromPage(page, pageNum);
  } catch (error) {
    console.warn(`Failed to extract tables from page ${pageNum}:`, error);
    return [];
  }
}

async function scanPageFonts(pageNum) {
  const fonts = [];
  try {
    const page = await pdfDoc.getPage(pageNum);
    const _operatorList = await page.getOperatorList();

    // Check both commonObjs (shared fonts) and page.objs (page-specific fonts)
    const allObjs = new Map();

    // Add shared fonts from commonObjs
    if (page.commonObjs) {
      for (const [objId, obj] of page.commonObjs._objs || new Map()) {
        if (obj && (obj.name || objId.includes('font') || obj.type)) {
          allObjs.set(objId, obj);
        }
      }
    }

    // Add page-specific fonts from page.objs
    if (page.objs) {
      for (const [objId, obj] of page.objs._objs || new Map()) {
        if (obj && (obj.name || objId.includes('font') || obj.type)) {
          allObjs.set(objId, obj);
        }
      }
    }

    // Extract font information
    allObjs.forEach((obj, objId) => {
      if (obj && (obj.name || obj.type)) {
        const fontId = `font_${objId}_page${pageNum}`;
        fonts.push({
          id: fontId,
          name: obj.name || objId,
          pageNum,
          type: obj.type || 'Unknown',
          objId: objId,
        });
      }
    });
  } catch (error) {
    console.warn(`Failed to extract fonts from page ${pageNum}:`, error);
  }
  return fonts;
}

async function scanPageAnnotations(pageNum) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    const annotations = await page.getAnnotations();
    return annotations.map((annotation, index) => ({
      id: `annotation_${pageNum}_${index}`,
      pageNum,
      ...annotation,
    }));
  } catch (error) {
    console.warn(`Failed to extract annotations from page ${pageNum}:`, error);
    return [];
  }
}

// Helper function to scan document-level objects
async function scanDocumentLevelObjects(objectTypes) {
  const results = {};

  for (const objectType of objectTypes) {
    try {
      switch (objectType) {
        case 'metadata': {
          const metadata = await pdfDoc.getMetadata();
          results.metadata = metadata.info || {};
          break;
        }
        case 'bookmarks': {
          const outline = await pdfDoc.getOutline();
          results.bookmarks = outline || [];
          break;
        }
        case 'attachments': {
          const attachments = await pdfDoc.getAttachments();
          results.attachments = attachments || {};
          break;
        }
        case 'formFields': {
          const fieldObjects = await pdfDoc.getFieldObjects();
          results.formFields = fieldObjects || {};
          break;
        }
        case 'javascript': {
          const jsActions = await pdfDoc.getJSActions();
          results.javascript = jsActions
            ? Object.entries(jsActions).map(([name, action]) => ({ name, action }))
            : [];
          break;
        }
      }
    } catch (error) {
      console.warn(`Failed to extract ${objectType}:`, error);
      results[objectType] = objectType === 'bookmarks' || objectType === 'javascript' ? [] : {};
    }
  }

  return results;
}

// Apply object scan results to the inspector
function applyObjectScanResults(objectType, results) {
  if (Array.isArray(results)) {
    results.forEach((item, index) => {
      if (objectType === 'images') {
        globalInspector.objects.images.set(item.id, item);
        // Legacy support
        if (!extractedImages.find((existing) => existing.id === item.id)) {
          extractedImages.push(item);
        }
      } else if (objectType === 'tables') {
        globalInspector.objects.tables.set(item.id, item);
        // Legacy support
        if (!extractedTables.find((existing) => existing.id === item.id)) {
          extractedTables.push(item);
        }
      } else if (objectType === 'annotations') {
        globalInspector.objects.annotations.set(item.id, item);
      } else if (objectType === 'fonts') {
        globalInspector.objects.fonts.set(item.id || `font_${index}`, item);
      }

      // Update page objects mapping
      if (item.pageNum) {
        if (!globalInspector.pageObjects.has(item.pageNum)) {
          globalInspector.pageObjects.set(item.pageNum, new Set());
        }
        globalInspector.pageObjects.get(item.pageNum).add(item.id);
      }
    });
  } else if (results && typeof results === 'object') {
    // Handle document-level objects that come back as plain objects
    if (objectType === 'metadata' && results.metadata) {
      globalInspector.objects.metadata = results.metadata;
    } else if (objectType === 'bookmarks' && results.bookmarks) {
      globalInspector.objects.bookmarks = results.bookmarks;
    } else if (objectType === 'attachments' && results.attachments) {
      globalInspector.objects.attachments.clear();
      Object.entries(results.attachments).forEach(([name, attachment]) => {
        globalInspector.objects.attachments.set(name, {
          filename: name,
          ...attachment,
        });
      });
    } else if (objectType === 'formFields' && results.formFields) {
      globalInspector.objects.formFields.clear();
      Object.entries(results.formFields).forEach(([name, field]) => {
        globalInspector.objects.formFields.set(name, field);
      });
    } else if (objectType === 'javascript' && results.javascript) {
      globalInspector.objects.javascript = results.javascript;
    }
  }
}

// Apply page scan results (already handled by scanPageForContent)
function applyPageScanResults(pageNum, results) {
  // Results are already applied by scanPageForContent
  // This function is mainly for consistency and future enhancements
  console.log(`Applied cached results for page ${pageNum}:`, results);
}

// Apply document-wide scan results
function applyDocumentScanResults(results) {
  if (results.metadata) {
    globalInspector.objects.metadata = results.metadata;
  }
  if (results.bookmarks) {
    globalInspector.objects.bookmarks = results.bookmarks;
  }
  if (results.attachments) {
    globalInspector.objects.attachments.clear();
    Object.entries(results.attachments).forEach(([name, attachment]) => {
      globalInspector.objects.attachments.set(name, {
        filename: name,
        ...attachment,
      });
    });
  }
  if (results.formFields) {
    globalInspector.objects.formFields.clear();
    Object.entries(results.formFields).forEach(([name, field]) => {
      globalInspector.objects.formFields.set(name, field);
    });
  }
  if (results.javascript) {
    globalInspector.objects.javascript = results.javascript;
  }
}

// ===== PROGRESSIVE LOADING FUNCTIONS =====

// Initialize progressive loading when pages are first loaded
function initializePDFProgression() {
  if (!pdfDoc) return;

  const totalPages = pdfDoc.numPages;
  const initialBatch = Math.min(globalInspector.progressiveLoading.pageMode.batchSize, totalPages);

  globalInspector.progressiveLoading.pageMode.currentlyShown = initialBatch;
  console.log(`Initialized page progression: showing ${initialBatch} of ${totalPages} pages`);
}

// Initialize object progression after scanning
function initializeObjectProgression(objectType, results) {
  const resultCount = Array.isArray(results)
    ? results.length
    : results && typeof results === 'object'
      ? Object.keys(results).length
      : 0;
  const initialBatch = Math.min(
    globalInspector.progressiveLoading.objectMode.batchSize,
    resultCount
  );

  globalInspector.progressiveLoading.objectMode.currentlyShown.set(objectType, initialBatch);
  console.log(
    `Initialized ${objectType} progression: showing ${initialBatch} of ${resultCount} items`
  );
}

// Load more pages in page-centric mode
function loadMorePages() {
  if (globalInspector.progressiveLoading.pageMode.showMoreInProgress) {
    console.log('Page loading already in progress');
    return;
  }

  globalInspector.progressiveLoading.pageMode.showMoreInProgress = true;

  const currentlyShown = globalInspector.progressiveLoading.pageMode.currentlyShown;
  const batchSize = globalInspector.progressiveLoading.pageMode.batchSize;
  const totalPages = pdfDoc.numPages;
  const newTotal = Math.min(currentlyShown + batchSize, totalPages);

  console.log(`Loading more pages: ${currentlyShown} → ${newTotal}`);

  // Simulate brief loading delay for UX
  setTimeout(() => {
    globalInspector.progressiveLoading.pageMode.currentlyShown = newTotal;
    globalInspector.progressiveLoading.pageMode.showMoreInProgress = false;

    // Re-render the tree to show new pages
    renderObjectTree();

    const remaining = totalPages - newTotal;
    showStatusMessage(
      `📄 Loaded ${batchSize} more pages${remaining > 0 ? ` (${remaining} remaining)` : ' (all pages loaded)'}`
    );
  }, 300);
}

// Load more objects in object-centric mode
function loadMoreObjects(objectType) {
  if (globalInspector.progressiveLoading.objectMode.showMoreInProgress.has(objectType)) {
    console.log(`${objectType} loading already in progress`);
    return;
  }

  globalInspector.progressiveLoading.objectMode.showMoreInProgress.add(objectType);

  const currentlyShown =
    globalInspector.progressiveLoading.objectMode.currentlyShown.get(objectType) || 0;
  const batchSize = globalInspector.progressiveLoading.objectMode.batchSize;
  const totalObjects = globalInspector.getObjectCount(objectType);
  const newTotal = Math.min(currentlyShown + batchSize, totalObjects);

  console.log(`Loading more ${objectType}: ${currentlyShown} → ${newTotal}`);

  // Re-render the tree immediately to show loading state
  renderObjectTree();

  // Simulate brief loading delay for UX
  setTimeout(() => {
    globalInspector.progressiveLoading.objectMode.currentlyShown.set(objectType, newTotal);
    globalInspector.progressiveLoading.objectMode.showMoreInProgress.delete(objectType);

    // Re-render the tree to show new objects
    renderObjectTree();

    const remaining = totalObjects - newTotal;
    showStatusMessage(
      `${objectType === 'images' ? '🖼️' : objectType === 'tables' ? '📊' : objectType === 'fonts' ? '🔤' : '📝'} Loaded ${batchSize} more ${objectType}${remaining > 0 ? ` (${remaining} remaining)` : ' (all loaded)'}`
    );
  }, 300);
}

console.log('Webview script loaded and ready for messages');
