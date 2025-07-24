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
    } else if (e.key === 'f' || e.key === 'F') {
      // Don't trigger search if user is typing in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      e.preventDefault();
      toggleSearch();
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

// Legacy export text function - now redirects to enhanced extraction modal
function exportText() {
  console.log('Export button clicked - redirecting to extraction modal');

  // Pre-select only text type for backward compatibility
  extractionState.selectedTypes.clear();
  extractionState.selectedTypes.add('text');
  showExtractionModal();
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

    // Enhanced extraction messages
    case 'folderSelected':
      console.log('Folder selected:', message.data);
      if (message.data && message.data.folderPath) {
        handleFolderSelected(message.data.folderPath);
      }
      break;

    case 'objectCountsUpdated':
      console.log('Object counts updated:', message.data);
      if (message.data) {
        updateObjectCounts(message.data);
      }
      break;

    case 'extractionProgress':
      console.log('Extraction progress:', message.data);
      if (message.data) {
        updateExtractionProgress(message.data);
      }
      break;

    case 'extractionCompleted':
      console.log('Extraction completed:', message.data);
      if (message.data) {
        handleExtractionCompleted(message.data);
      }
      break;

    case 'extractionError':
      console.error('Extraction error:', message.error);
      if (message.error) {
        handleExtractionError(message.error);
      }
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

// Search functions
window.toggleSearch = toggleSearch;
window.searchNext = searchNext;
window.searchPrevious = searchPrevious;
window.closeSearch = closeSearch;

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

// Search functionality
const searchState = {
  isActive: false,
  query: '',
  matches: [],
  currentMatchIndex: -1,
  pageTextCache: new Map(), // Cache extracted text per page
};

function toggleSearch() {
  const overlay = document.getElementById('searchOverlay');
  const input = document.getElementById('searchInput');

  if (searchState.isActive) {
    closeSearch();
  } else {
    searchState.isActive = true;
    overlay.style.display = 'block';
    input.focus();

    // Setup input event listener for real-time search
    input.addEventListener('input', debounce(handleSearchInput, 300));
    input.addEventListener('keydown', handleSearchKeydown);
  }
}

function closeSearch() {
  const overlay = document.getElementById('searchOverlay');
  const input = document.getElementById('searchInput');

  searchState.isActive = false;
  overlay.style.display = 'none';
  input.value = '';
  clearSearchHighlights();
  searchState.query = '';
  searchState.matches = [];
  searchState.currentMatchIndex = -1;

  // Remove event listeners
  input.removeEventListener('input', handleSearchInput);
  input.removeEventListener('keydown', handleSearchKeydown);
}

function handleSearchInput(event) {
  const query = event.target.value.trim();
  if (query.length < 2) {
    clearSearchHighlights();
    return;
  }

  performSearch(query);
}

function handleSearchKeydown(event) {
  if (event.key === 'Escape') {
    closeSearch();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (event.shiftKey) {
      searchPrevious();
    } else {
      searchNext();
    }
  }
}

async function performSearch(query) {
  if (!query || query === searchState.query) return;

  searchState.query = query.toLowerCase();
  searchState.matches = [];
  searchState.currentMatchIndex = -1;
  clearSearchHighlights();

  // Search through all pages
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const pageText = await getPageText(pageNum);
    if (pageText) {
      findMatchesInPage(pageText, pageNum);
    }
  }

  // Highlight first match if found
  if (searchState.matches.length > 0) {
    searchState.currentMatchIndex = 0;
    highlightCurrentMatch();
    updateSearchButtons();
  }
}

async function getPageText(pageNum) {
  // Check cache first
  if (searchState.pageTextCache.has(pageNum)) {
    return searchState.pageTextCache.get(pageNum);
  }

  try {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => item.str)
      .join(' ')
      .toLowerCase();

    // Cache the text
    searchState.pageTextCache.set(pageNum, pageText);
    return pageText;
  } catch (error) {
    console.warn(`Failed to extract text from page ${pageNum}:`, error);
    return '';
  }
}

function findMatchesInPage(pageText, pageNum) {
  const query = searchState.query;
  let index = 0;

  // Find all matches in the page text
  let foundIndex = pageText.indexOf(query, index);
  while (foundIndex !== -1) {
    searchState.matches.push({
      pageNum,
      textIndex: foundIndex,
    });
    index = foundIndex + query.length;
    foundIndex = pageText.indexOf(query, index);
  }
}

function searchNext() {
  if (searchState.matches.length === 0) return;

  searchState.currentMatchIndex = (searchState.currentMatchIndex + 1) % searchState.matches.length;
  highlightCurrentMatch();
}

function searchPrevious() {
  if (searchState.matches.length === 0) return;

  searchState.currentMatchIndex =
    searchState.currentMatchIndex <= 0
      ? searchState.matches.length - 1
      : searchState.currentMatchIndex - 1;
  highlightCurrentMatch();
}

async function highlightCurrentMatch() {
  if (
    searchState.currentMatchIndex < 0 ||
    searchState.currentMatchIndex >= searchState.matches.length
  ) {
    return;
  }

  const match = searchState.matches[searchState.currentMatchIndex];

  // Clear previous highlights
  clearSearchHighlights();

  // Navigate to the page containing the match
  await goToPage(match.pageNum);

  // Wait for page to be rendered and text layer to be available
  setTimeout(async () => {
    await highlightMatchInTextLayer(match.pageNum, searchState.query);
  }, 300); // Increased delay to ensure text layer is ready
}

async function highlightMatchInTextLayer(pageNum, query) {
  const pageContainer = document.querySelector(`#page-${pageNum}`);
  if (!pageContainer) {
    return;
  }

  const textLayer = pageContainer.querySelector('.textLayer');
  if (!textLayer) {
    return;
  }

  // Ensure text layer is rendered and visible
  if (textLayer.classList.contains('hidden') || textLayer.children.length === 0) {
    // Render the text layer first
    await renderTextLayer(pageNum);
  }

  // Get the current match
  const currentMatch = searchState.matches[searchState.currentMatchIndex];
  if (!currentMatch || currentMatch.pageNum !== pageNum) {
    return;
  }

  // Count how many matches we've seen on this page so far
  let matchesOnThisPage = 0;
  let targetMatchIndex = 0;

  for (let i = 0; i < searchState.matches.length; i++) {
    if (searchState.matches[i].pageNum === pageNum) {
      if (i === searchState.currentMatchIndex) {
        targetMatchIndex = matchesOnThisPage;
        break;
      }
      matchesOnThisPage++;
    }
  }

  // Find all spans that contain the query and highlight the correct one
  const textSpans = textLayer.querySelectorAll('span');
  let foundMatches = 0;
  let foundMatch = false;

  for (const span of textSpans) {
    const spanText = span.textContent.toLowerCase();
    let queryIndex = spanText.indexOf(query);

    while (queryIndex !== -1) {
      if (foundMatches === targetMatchIndex) {
        // This is our target match
        const originalText = span.textContent;
        const before = originalText.substring(0, queryIndex);
        const matchText = originalText.substring(queryIndex, queryIndex + query.length);
        const after = originalText.substring(queryIndex + query.length);

        span.innerHTML =
          before + `<span class="search-highlight current">${matchText}</span>` + after;

        // Scroll to the match
        span.scrollIntoView({ behavior: 'smooth', block: 'center' });
        foundMatch = true;
        break;
      }

      foundMatches++;
      queryIndex = spanText.indexOf(query, queryIndex + 1);
    }

    if (foundMatch) break;
  }

  // If match not found, silently continue
}

function clearSearchHighlights() {
  // Remove all search highlights
  const highlights = document.querySelectorAll('.search-highlight');
  highlights.forEach((highlight) => {
    const parent = highlight.parentNode;
    parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
    parent.normalize(); // Merge adjacent text nodes
  });
}

function updateSearchButtons() {
  const prevBtn = document.getElementById('searchPrevBtn');
  const nextBtn = document.getElementById('searchNextBtn');

  const hasMatches = searchState.matches.length > 0;
  prevBtn.disabled = !hasMatches;
  nextBtn.disabled = !hasMatches;
}

// Utility function for debouncing
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Enhanced Object Extraction System
let extractionState = {
  isOpen: false,
  isExtracting: false,
  isCompleted: false,
  selectedTypes: new Set(['text']), // Default to text
  saveFolder: '',
  objectCounts: {},
  extractionId: null,
  extractionSummary: null,
};

// Show extraction modal
function showExtractionModal() {
  console.log('Opening extraction modal');
  extractionState.isOpen = true;

  const overlay = document.getElementById('extractionOverlay');
  if (!overlay) {
    console.error('Extraction overlay element not found!');
    return;
  }

  overlay.style.display = 'flex';
  console.log('Modal overlay display set to flex');

  // Reset modal state
  resetExtractionModal();

  // Verify browse button is accessible
  const browseBtn = document.querySelector('.folder-browse-btn');
  if (browseBtn) {
    console.log('Browse button found and accessible:', browseBtn);
    console.log('Browse button click handler:', browseBtn.onclick);
  } else {
    console.error('Browse button not found in modal!');
  }

  // Request object counts from PDF Object Inspector
  requestObjectCounts();

  // Focus on the modal
  setTimeout(() => {
    const firstCheckbox = document.getElementById('type-text');
    if (firstCheckbox) firstCheckbox.focus();
  }, 100);
}

// Close extraction modal
function closeExtractionModal() {
  console.log('Closing extraction modal');
  extractionState.isOpen = false;
  extractionState.isExtracting = false;

  const overlay = document.getElementById('extractionOverlay');
  overlay.style.display = 'none';

  // Cancel any ongoing extraction
  if (extractionState.extractionId) {
    cancelExtraction();
  }
}

// Reset modal to initial state
function resetExtractionModal() {
  // Reset extraction state flags
  extractionState.isExtracting = false;
  extractionState.isCompleted = false;
  extractionState.extractionId = null;
  extractionState.extractionSummary = null;

  // Reset extraction progress
  const progressContainer = document.getElementById('extractionProgress');
  progressContainer.classList.remove('show');

  // Reset progress bar
  const progressBarFill = document.getElementById('progressBarFill');
  progressBarFill.style.width = '0%';

  // Reset progress text
  document.getElementById('progressTitle').textContent = 'Extracting objects...';
  document.getElementById('progressStatus').textContent = 'Preparing extraction...';
  document.getElementById('progressDetails').innerHTML = '';

  // Update extract button state
  updateExtractButton();
}

// Toggle object type selection (called by checkbox onchange)
function toggleObjectType(objectType) {
  console.log(`Toggling object type: ${objectType}`);

  const checkbox = document.getElementById(`type-${objectType}`);
  if (!checkbox) return;

  // Update selected types based on checkbox state (no need to toggle, checkbox already changed)
  if (checkbox.checked) {
    extractionState.selectedTypes.add(objectType);
  } else {
    extractionState.selectedTypes.delete(objectType);
  }

  // Update extract button
  updateExtractButton();

  console.log('Selected types:', Array.from(extractionState.selectedTypes));
}

// Toggle by clicking label (triggers checkbox)
function toggleObjectTypeByLabel(objectType) {
  const checkbox = document.getElementById(`type-${objectType}`);
  if (!checkbox || checkbox.disabled) return;

  checkbox.checked = !checkbox.checked;
  toggleObjectType(objectType); // Update state
}

// Update extract button state
function updateExtractButton() {
  const extractBtn = document.getElementById('startExtractionBtn');
  const hasSelection = extractionState.selectedTypes.size > 0;
  const hasFolder = extractionState.saveFolder.length > 0;

  // Handle completion state
  if (extractionState.isCompleted) {
    extractBtn.disabled = false;
    extractBtn.textContent = 'Close';
    extractBtn.onclick = closeExtractionModal;
    return;
  }

  // Reset onclick to startExtraction if not completed
  extractBtn.onclick = startExtraction;

  extractBtn.disabled = !hasSelection || !hasFolder || extractionState.isExtracting;

  if (!hasSelection) {
    extractBtn.textContent = 'Select Object Types';
  } else if (!hasFolder) {
    extractBtn.textContent = 'Select Save Folder';
  } else if (extractionState.isExtracting) {
    extractBtn.textContent = 'Extracting...';
  } else {
    extractBtn.textContent = `Extract ${extractionState.selectedTypes.size} Type${extractionState.selectedTypes.size > 1 ? 's' : ''}`;
  }

  // Update Select All button text based on current selection
  updateSelectAllButton();
}

function updateSelectAllButton() {
  const selectAllBtn = document.querySelector('.select-all-btn');
  if (!selectAllBtn) return;

  const allCheckboxes = document.querySelectorAll('.object-types-grid input[type="checkbox"]');
  const allSelected = Array.from(allCheckboxes).every((checkbox) => checkbox.checked);

  selectAllBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
}

// Browse for save folder
function browseSaveFolder() {
  console.log('Browse button clicked - starting folder selection');
  console.log('Current extraction state:', extractionState);

  try {
    // Check if vscode API is available
    if (typeof vscode === 'undefined') {
      console.error('VSCode API not available!');
      return;
    }

    console.log('VSCode API available, sending message...');

    // Send message to extension to open folder picker
    const message = {
      type: 'browseSaveFolder',
    };
    console.log('Sending message:', message);

    vscode.postMessage(message);

    console.log('Message sent to extension for folder browsing');
  } catch (error) {
    console.error('Error in browseSaveFolder:', error);
  }
}

// Handle folder selection from extension
function handleFolderSelected(folderPath) {
  console.log('Folder selected:', folderPath);

  extractionState.saveFolder = folderPath;
  const folderInput = document.getElementById('folderPath');
  folderInput.value = folderPath;

  updateExtractButton();
}

// Show predefined object types immediately (no scanning needed)
function requestObjectCounts() {
  console.log('Showing predefined object types');

  // Show all object types without counts - extraction will determine actual availability
  const predefinedCounts = {
    text: '',
    images: '',
    tables: '',
    fonts: '',
    annotations: '',
    formFields: '',
    attachments: '',
    bookmarks: '',
    javascript: '',
    metadata: '',
  };

  updateObjectCounts(predefinedCounts);
}

// Update object counts in UI
function updateObjectCounts(counts) {
  console.log('Updating object counts:', counts);

  extractionState.objectCounts = counts;

  // Update count badges in UI
  Object.entries(counts).forEach(([type, count]) => {
    const countElement = document.getElementById(`count-${type}`);
    if (countElement) {
      // Hide count display - just show object type without numbers
      if (count === '' || count === null || count === undefined) {
        countElement.style.display = 'none';
      } else {
        countElement.textContent = count.toString();
        countElement.style.display = 'inline';
      }

      // All object types are enabled by default - extraction will handle empty results
      const typeItem = countElement.closest('.object-type-item');
      const checkbox = document.getElementById(`type-${type}`);

      // Keep all items enabled and available for selection
      typeItem.style.opacity = '1';
      typeItem.style.cursor = 'pointer';
      checkbox.disabled = false;
    }
  });

  updateExtractButton();
}

// Start extraction process
function startExtraction() {
  if (extractionState.selectedTypes.size === 0 || !extractionState.saveFolder) {
    console.warn('Cannot start extraction: missing selection or folder');
    return;
  }

  extractionState.isExtracting = true;
  extractionState.extractionId = Date.now().toString();
  extractionState.startTime = Date.now(); // Track extraction start time

  // Show progress container
  const progressContainer = document.getElementById('extractionProgress');
  progressContainer.classList.add('show');

  // Update UI
  updateExtractButton();

  // Collect all object data first, then send to extension
  collectObjectDataAndExtract();
}

// Collect object data and send extraction request
async function collectObjectDataAndExtract() {
  try {
    console.log('Collecting object data for extraction...');

    const selectedTypesArray = Array.from(extractionState.selectedTypes);
    const totalTypes = selectedTypesArray.length;

    // Initialize object data collection
    const objectData = {};

    // Update progress to show we're collecting data
    updateExtractionProgress({
      overall: { current: 0, total: totalTypes, percentage: 0, status: 'processing' },
      types: Object.fromEntries(
        selectedTypesArray.map((type) => [
          type,
          {
            current: 0,
            total: 1,
            percentage: 0,
            status: 'pending',
            message: `Waiting to collect ${type}...`,
          },
        ])
      ),
      currentOperation: 'Collecting object data from PDF...',
      filesCreated: [],
    });

    for (let i = 0; i < selectedTypesArray.length; i++) {
      const objectType = selectedTypesArray[i];
      console.log(`Collecting ${objectType} data...`);

      // Update progress to show current collection phase
      const collectionProgress = {
        overall: {
          current: i,
          total: totalTypes,
          percentage: (i / totalTypes) * 100,
          status: 'processing',
        },
        types: Object.fromEntries(
          selectedTypesArray.map((type, index) => [
            type,
            {
              current: index < i ? 1 : index === i ? 0.5 : 0,
              total: 1,
              percentage: index < i ? 100 : index === i ? 50 : 0,
              status: index < i ? 'completed' : index === i ? 'processing' : 'pending',
              message:
                index < i
                  ? `${type} collected`
                  : index === i
                    ? `Collecting ${type}...`
                    : `Waiting for ${type}`,
            },
          ])
        ),
        currentOperation: `Collecting ${objectType} data from PDF...`,
        filesCreated: [],
      };

      updateExtractionProgress(collectionProgress);

      switch (objectType) {
        case 'text':
          objectData[objectType] = await collectTextData();
          break;

        case 'images':
          objectData[objectType] = await collectImageData();
          break;

        case 'tables':
          objectData[objectType] = await collectTableData();
          break;

        case 'fonts':
          objectData[objectType] = await collectFontData();
          break;

        case 'annotations':
          objectData[objectType] = await collectAnnotationData();
          break;

        case 'formFields':
          objectData[objectType] = await collectFormFieldData();
          break;

        case 'attachments':
          objectData[objectType] = await collectAttachmentData();
          break;

        case 'bookmarks':
          objectData[objectType] = await collectBookmarkData();
          break;

        case 'javascript':
          objectData[objectType] = await collectJavaScriptData();
          break;

        case 'metadata':
          objectData[objectType] = await collectMetadataData();
          break;

        default:
          console.warn(`Unknown object type: ${objectType}`);
          objectData[objectType] = { count: 0, data: [] };
      }

      // Update progress to show this type is completed
      collectionProgress.types[objectType] = {
        current: 1,
        total: 1,
        percentage: 100,
        status: 'completed',
        message: `${objectType} collected (${objectData[objectType].count} items)`,
      };
      collectionProgress.overall.current = i + 1;
      collectionProgress.overall.percentage = ((i + 1) / totalTypes) * 100;

      updateExtractionProgress(collectionProgress);

      // Add a small delay to make progress visible for fast operations
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log('Collected object data:', objectData);

    // Update progress to show we're sending to extension
    updateExtractionProgress({
      overall: { current: totalTypes, total: totalTypes, percentage: 100, status: 'processing' },
      types: Object.fromEntries(
        selectedTypesArray.map((type) => [
          type,
          {
            current: 1,
            total: 1,
            percentage: 100,
            status: 'completed',
            message: `${type} ready for extraction`,
          },
        ])
      ),
      currentOperation: 'Sending data to extension for file creation...',
      filesCreated: [],
    });

    // Send extraction request with collected data
    vscode.postMessage({
      type: 'extractObjects',
      data: {
        selectedTypes: selectedTypesArray,
        saveFolder: extractionState.saveFolder,
        fileName: PDF_CONFIG.fileName,
        extractionId: extractionState.extractionId,
        objectData: objectData, // Include collected object data
        webviewStartTime: extractionState.startTime, // Include webview start time for accurate timing
      },
    });
  } catch (error) {
    console.error('Failed to collect object data:', error);
    updateExtractionProgress({
      overall: { current: 0, total: 1, percentage: 0, status: 'error' },
      currentOperation: `Error: ${error.message}`,
      filesCreated: [],
    });
  }
}

// Object data collection functions
async function collectTextData() {
  if (!pdfDoc) return { count: 0, data: '' };

  try {
    const totalPages = pdfDoc.numPages;
    let fullText = '';

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      // Update progress every 10 pages
      if (pageNum % 10 === 0 || pageNum === totalPages) {
        const progress = Math.round((pageNum / totalPages) * 100);
        updateExtractionProgress({
          overall: { current: 0, total: 1, percentage: progress / 2, status: 'processing' },
          currentOperation: `Extracting text from page ${pageNum}/${totalPages}`,
          filesCreated: [],
        });
      }

      try {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Combine text items with spaces
        const pageText = textContent.items
          .map((item) => item.str)
          .join(' ')
          .trim();

        if (pageText) {
          fullText += `\n\n--- Page ${pageNum} ---\n\n${pageText}`;
        }
      } catch (pageError) {
        console.warn(`Failed to extract text from page ${pageNum}:`, pageError);
      }
    }

    console.log(`Text extraction completed. Extracted ${fullText.length} characters.`);
    return { count: fullText.length, data: fullText.trim() };
  } catch (error) {
    console.error('Error collecting text data:', error);
    return { count: 0, data: '' };
  }
}

async function collectImageData() {
  const images = [];
  if (!pdfDoc) return { count: 0, data: images };

  try {
    const totalPages = pdfDoc.numPages;
    const maxImages = 100; // Limit total images to prevent memory issues

    for (let pageNum = 1; pageNum <= totalPages && images.length < maxImages; pageNum++) {
      console.log(
        `Extracting images from page ${pageNum}/${totalPages}... (found ${images.length} so far)`
      );

      // Update progress for image collection (shows every 10 pages or on last page)
      if (pageNum % 10 === 0 || pageNum === totalPages) {
        const progress = Math.round((pageNum / totalPages) * 100);
        updateExtractionProgress({
          overall: { current: 0, total: 1, percentage: progress / 2, status: 'processing' }, // Half the progress since this is just one type
          currentOperation: `Extracting images from page ${pageNum}/${totalPages}... (${images.length} found)`,
          filesCreated: [],
        });
      }

      try {
        // Add timeout for page processing to prevent getting stuck
        const pagePromise = pdfDoc.getPage(pageNum);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Timeout processing page ${pageNum}`)), 10000); // 10 second timeout per page
        });

        const page = await Promise.race([pagePromise, timeoutPromise]);

        // Get all images from the page
        const ops = await page.getOperatorList();
        const pageImages = [];

        // Look for image operations (limit to prevent infinite loops)
        const maxOperations = Math.min(ops.fnArray.length, 1000); // Limit to 1000 operations per page
        let imageOpsProcessed = 0;
        const maxImageOpsPerPage = 50; // Limit image operations per page to prevent infinite loops

        for (let i = 0; i < maxOperations; i++) {
          if (ops.fnArray[i] === pdfjsLib.OPS.paintImageXObject) {
            // Check if we've reached the limit for image operations per page
            if (imageOpsProcessed >= maxImageOpsPerPage) {
              console.log(
                `Reached maximum image operations per page (${maxImageOpsPerPage}), skipping remaining images on page ${pageNum}`
              );
              break;
            }
            imageOpsProcessed++;

            const imgName = ops.argsArray[i][0];
            console.log(`Found image: ${imgName} on page ${pageNum}`);

            try {
              // Get image from page objects with timeout
              const imgPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                  reject(new Error(`Timeout getting image ${imgName}`));
                }, 5000); // 5 second timeout

                page.objs.get(
                  imgName,
                  (img) => {
                    clearTimeout(timeout);
                    resolve(img || null);
                  },
                  (error) => {
                    clearTimeout(timeout);
                    console.warn(`Failed to get image ${imgName}:`, error);
                    resolve(null); // Return null instead of rejecting to continue processing
                  }
                );
              });

              const img = await imgPromise;
              if (img && (img.data || img.bitmap || img instanceof ImageBitmap)) {
                console.log(`Processing image ${imgName}:`, {
                  width: img.width,
                  height: img.height,
                  kind: img.kind,
                });

                // Create canvas and draw image
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // Set canvas size with reasonable limits to prevent memory issues
                const maxDimension = 2048; // Limit image dimensions to prevent infinite loops
                const imgWidth = Math.min(img.width || 200, maxDimension);
                const imgHeight = Math.min(img.height || 200, maxDimension);
                canvas.width = imgWidth;
                canvas.height = imgHeight;

                // Handle different image types
                if (img.bitmap) {
                  // ImageBitmap
                  ctx.drawImage(img.bitmap, 0, 0);
                } else if (img.data) {
                  // Raw image data
                  const imageData = ctx.createImageData(canvas.width, canvas.height);
                  const data = new Uint8ClampedArray(img.data);

                  // Handle different pixel formats with safety checks
                  const totalPixels = canvas.width * canvas.height;
                  const maxPixels = 4194304; // 2048x2048 maximum to prevent infinite loops

                  if (totalPixels > maxPixels) {
                    console.warn(
                      `Skipping large image ${imgName}: ${canvas.width}x${canvas.height} (${totalPixels} pixels)`
                    );
                    continue; // Skip this image
                  }

                  if (data.length === totalPixels * 4) {
                    // RGBA
                    imageData.data.set(data);
                  } else if (data.length === totalPixels * 3) {
                    // RGB - convert to RGBA
                    for (let j = 0; j < totalPixels; j++) {
                      imageData.data[j * 4] = data[j * 3]; // R
                      imageData.data[j * 4 + 1] = data[j * 3 + 1]; // G
                      imageData.data[j * 4 + 2] = data[j * 3 + 2]; // B
                      imageData.data[j * 4 + 3] = 255; // A
                    }
                  } else if (data.length === totalPixels) {
                    // Grayscale - convert to RGBA
                    for (let j = 0; j < totalPixels; j++) {
                      const gray = data[j];
                      imageData.data[j * 4] = gray; // R
                      imageData.data[j * 4 + 1] = gray; // G
                      imageData.data[j * 4 + 2] = gray; // B
                      imageData.data[j * 4 + 3] = 255; // A
                    }
                  }

                  ctx.putImageData(imageData, 0, 0);
                } else {
                  // Fallback: try to draw the image directly
                  try {
                    ctx.drawImage(img, 0, 0);
                  } catch (drawError) {
                    console.warn(`Cannot draw image ${imgName}:`, drawError);
                    continue;
                  }
                }

                // Convert to base64
                const base64 = canvas.toDataURL('image/png');
                if (base64 && base64.length > 100) {
                  // Basic validation
                  images.push({
                    id: `img_p${pageNum}_${images.length + 1}`,
                    page: pageNum,
                    name: imgName,
                    width: canvas.width,
                    height: canvas.height,
                    base64: base64,
                  });

                  console.log(
                    `Successfully extracted image ${imgName} (${canvas.width}x${canvas.height})`
                  );
                }
              } else {
                console.warn(`No valid image data found for ${imgName}`);
              }
            } catch (imgError) {
              console.warn(`Failed to extract image ${imgName} on page ${pageNum}:`, imgError);
            }

            // Break if we've reached the max image limit
            if (images.length >= maxImages) {
              console.log(`Reached maximum image limit (${maxImages}), stopping extraction`);
              break;
            }
          }

          // Yield control periodically to prevent blocking the main thread
          if (imageOpsProcessed % 10 === 0 && imageOpsProcessed > 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }

        // Add images from this page to the overall collection
        images.push(...pageImages);
      } catch (pageError) {
        console.warn(`Failed to process page ${pageNum} for images:`, pageError);
      }
    }

    console.log(`Image extraction completed. Found ${images.length} images.`);
  } catch (error) {
    console.error('Error collecting image data:', error);
  }

  return { count: images.length, data: images };
}

async function collectTableData() {
  // Placeholder for table extraction
  return { count: 0, data: [], message: 'Table extraction not yet implemented' };
}

async function collectFontData() {
  const fonts = [];
  if (!pdfDoc) return { count: 0, data: fonts };

  try {
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const fonts_page = await page.getOperatorList();
      // Font extraction logic would go here
    }
  } catch (error) {
    console.error('Error collecting font data:', error);
  }

  return { count: fonts.length, data: fonts };
}

async function collectAnnotationData() {
  const annotations = [];
  if (!pdfDoc) return { count: 0, data: annotations };

  try {
    const totalPages = pdfDoc.numPages;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      // Update progress for annotation collection (every 20 pages)
      if (pageNum % 20 === 0 || pageNum === totalPages) {
        const progress = Math.round((pageNum / totalPages) * 100);
        updateExtractionProgress({
          overall: { current: 0, total: 1, percentage: progress / 2, status: 'processing' },
          currentOperation: `Collecting annotations from page ${pageNum}/${totalPages}...`,
          filesCreated: [],
        });
      }

      const page = await pdfDoc.getPage(pageNum);
      const pageAnnotations = await page.getAnnotations();

      pageAnnotations.forEach((annotation, index) => {
        annotations.push({
          id: `ann_p${pageNum}_${index}`,
          page: pageNum,
          type: annotation.subtype || 'Unknown',
          content: annotation.contents || '',
          rect: annotation.rect,
          data: annotation,
        });
      });
    }
  } catch (error) {
    console.error('Error collecting annotation data:', error);
  }

  return { count: annotations.length, data: annotations };
}

async function collectFormFieldData() {
  // Placeholder - would use page.getAnnotations() and filter for form fields
  return { count: 0, data: [], message: 'Form field extraction not yet implemented' };
}

async function collectAttachmentData() {
  // Placeholder - would use doc.getAttachments()
  return { count: 0, data: [], message: 'Attachment extraction not yet implemented' };
}

async function collectBookmarkData() {
  const bookmarks = [];
  if (!pdfDoc) return { count: 0, data: bookmarks };

  try {
    const outline = await pdfDoc.getOutline();
    if (outline) {
      const flattenOutline = (items, level = 0) => {
        items.forEach((item, index) => {
          bookmarks.push({
            id: `bookmark_${level}_${index}`,
            title: item.title,
            level: level,
            dest: item.dest,
            url: item.url,
            data: item,
          });

          if (item.items && item.items.length > 0) {
            flattenOutline(item.items, level + 1);
          }
        });
      };

      flattenOutline(outline);
    }
  } catch (error) {
    console.error('Error collecting bookmark data:', error);
  }

  return { count: bookmarks.length, data: bookmarks };
}

async function collectJavaScriptData() {
  // Placeholder - would extract JS actions from the PDF
  return { count: 0, data: [], message: 'JavaScript extraction not yet implemented' };
}

async function collectMetadataData() {
  const metadata = {};
  if (!pdfDoc) return { count: 0, data: metadata };

  try {
    const info = await pdfDoc.getMetadata();
    metadata.info = info.info;
    metadata.metadata = info.metadata;
    metadata.contentDispositionFilename = info.contentDispositionFilename;
    metadata.contentLength = info.contentLength;
  } catch (error) {
    console.error('Error collecting metadata:', error);
  }

  return { count: Object.keys(metadata).length, data: metadata };
}

// Cancel extraction
function cancelExtraction() {
  if (!extractionState.isExtracting) return;

  console.log('Cancelling extraction');

  // Send cancellation to extension
  vscode.postMessage({
    type: 'extractionCancelled',
    data: { extractionId: extractionState.extractionId },
  });

  // Reset state
  extractionState.isExtracting = false;
  extractionState.extractionId = null;

  // Update UI
  updateExtractButton();

  // Hide progress
  const progressContainer = document.getElementById('extractionProgress');
  progressContainer.classList.remove('show');
}

// Update extraction progress
function updateExtractionProgress(progress) {
  console.log('Updating extraction progress:', progress);

  // Update progress bar
  const progressBarFill = document.getElementById('progressBarFill');
  progressBarFill.style.width = `${progress.overall.percentage}%`;

  // Update progress status
  const progressStatus = document.getElementById('progressStatus');
  if (progress.currentOperation) {
    progressStatus.textContent = progress.currentOperation;
  } else if (progress.currentType) {
    progressStatus.textContent = `Extracting ${progress.currentType}...`;
  } else {
    progressStatus.textContent = `${Math.round(progress.overall.percentage)}% complete`;
  }

  // Update progress details
  const progressDetails = document.getElementById('progressDetails');
  if (progress.types && Object.keys(progress.types).length > 0) {
    const detailsHtml = Object.entries(progress.types)
      .map(
        ([type, typeProgress]) => `
        <div class="detail-item">
          <span>${type}</span>
          <span>${typeProgress.status === 'completed' ? '✓' : typeProgress.status === 'error' ? '✗' : '⋯'}</span>
        </div>
      `
      )
      .join('');
    progressDetails.innerHTML = detailsHtml;
  }

  // Show files created count
  if (progress.filesCreated && progress.filesCreated.length > 0) {
    const filesInfo = document.createElement('div');
    filesInfo.textContent = `${progress.filesCreated.length} files created`;
    filesInfo.style.fontSize = '11px';
    filesInfo.style.color = 'var(--vscode-descriptionForeground)';
    filesInfo.style.marginTop = '4px';
    progressDetails.appendChild(filesInfo);
  }
}

// Handle extraction completion
function handleExtractionCompleted(result) {
  console.log('Extraction completed:', result);

  extractionState.isExtracting = false;
  extractionState.isCompleted = true;
  extractionState.extractionId = null;
  extractionState.extractionSummary = result;

  // Update progress to show completion
  updateExtractionProgress({
    overall: {
      current: result.extractedTypes.length,
      total: result.extractedTypes.length,
      percentage: 100,
      status: 'completed',
    },
    types: Object.fromEntries(
      result.extractedTypes.map((type) => [
        type,
        { status: 'completed', message: 'Extraction completed' },
      ])
    ),
    filesCreated: result.filesCreated,
    currentOperation: 'Extraction completed successfully!',
  });

  // Update progress status
  const progressStatus = document.getElementById('progressStatus');
  const objectCount = result.totalObjects || 0;
  const fileCount = result.filesCreated ? result.filesCreated.length : 0;

  // Calculate total time including webview collection phase
  let totalProcessingTime = 0;
  if (extractionState.startTime) {
    totalProcessingTime = Math.round((Date.now() - extractionState.startTime) / 1000);
  } else {
    // Fallback to extension processing time if startTime is missing
    totalProcessingTime = result.processingTime ? Math.round(result.processingTime / 1000) : 0;
  }

  if (objectCount === 0) {
    progressStatus.textContent = `ℹ️ No objects found for selected types. Check if PDF contains the requested object types.`;
  } else {
    progressStatus.textContent = `✅ Extraction completed! ${objectCount} objects extracted to ${fileCount} files in ${totalProcessingTime}s`;
  }

  // Update extract button
  updateExtractButton();

  // Show extraction summary in the dialog
  showExtractionSummary(result);

  // Populate shared object data for PDF Object Inspector if extraction found objects
  if (result.summary && result.summary.results) {
    populateSharedObjectData(result.summary.results);
  }

  // Show appropriate completion message
  setTimeout(() => {
    if (objectCount === 0) {
      alert(
        `No objects found for the selected types.\\n\\nThe PDF may not contain: ${Array.from(extractionState.selectedTypes).join(', ')}.\\n\\nTry selecting different object types or check if the PDF has the content you're looking for.`
      );
    } else {
      const message = `Extraction completed successfully!\\n\\n${objectCount} objects extracted to ${fileCount} files in ${totalProcessingTime}s.\\n\\nWould you like to open the extraction folder?`;
      if (confirm(message)) {
        vscode.postMessage({
          type: 'openFolder',
          data: { folderPath: result.folderPath },
        });
      }
    }
  }, 500);
}

// Populate shared object data for PDF Object Inspector
function populateSharedObjectData(extractionResults) {
  console.log('Populating shared object data for PDF Object Inspector:', extractionResults);

  // If PDF Object Inspector is initialized, populate it with extraction results
  if (globalInspector && extractionResults) {
    try {
      // Update inspector with extracted data counts
      Object.entries(extractionResults).forEach(([objectType, result]) => {
        if (result.count > 0) {
          console.log(`Found ${result.count} ${objectType} objects`);
          // The actual object data would be populated during the extraction process
          // This gives users visual feedback in the Inspector if they open it later
        }
      });

      // Refresh inspector display if it's open
      const inspectorSidebar = document.getElementById('inspectorSidebar');
      if (inspectorSidebar && inspectorSidebar.classList.contains('open')) {
        console.log('Refreshing PDF Object Inspector display with new data');
        // The inspector will show updated data next time it renders
      }
    } catch (error) {
      console.warn('Failed to populate shared object data:', error);
    }
  }
}

// Handle extraction error
function handleExtractionError(error) {
  console.error('Extraction error:', error);

  extractionState.isExtracting = false;
  extractionState.extractionId = null;

  // Update progress status
  const progressStatus = document.getElementById('progressStatus');
  progressStatus.textContent = `❌ Extraction failed: ${error}`;

  // Update extract button
  updateExtractButton();

  // Show error message
  alert(`Extraction failed: ${error}`);
}

// Show extraction summary in the dialog
function showExtractionSummary(result) {
  const progressDetails = document.getElementById('progressDetails');

  if (!result || !result.summary || !result.summary.results) {
    return;
  }

  console.log('Showing extraction summary:', result.summary);

  // Create summary HTML
  const summaryHtml = `
    <div class="extraction-summary">
      <h4>📊 Extraction Summary</h4>
      <div class="summary-stats">
        <div class="stat-item">
          <span class="stat-label">Total Objects:</span>
          <span class="stat-value">${result.totalObjects || 0}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Files Created:</span>
          <span class="stat-value">${result.filesCreated ? result.filesCreated.length : 0}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Processing Time:</span>
          <span class="stat-value">${result.processingTime ? Math.round(result.processingTime / 1000) : 0}s</span>
        </div>
      </div>
      <div class="summary-details">
        ${Object.entries(result.summary.results)
          .map(
            ([type, typeResult]) => `
          <div class="summary-type">
            <span class="type-name">${type.charAt(0).toUpperCase() + type.slice(1)}:</span>
            <span class="type-count">${typeResult.count || 0} objects</span>
            <span class="type-files">(${typeResult.files ? typeResult.files.length : 0} files)</span>
            ${
              typeResult.status === 'error'
                ? '<span class="type-error">❌ Error</span>'
                : typeResult.count > 0
                  ? '<span class="type-success">✅</span>'
                  : '<span class="type-empty">⚪ Empty</span>'
            }
          </div>
        `
          )
          .join('')}
      </div>
      <div class="summary-location">
        <strong>📁 Saved to:</strong> ${result.extractionFolder || extractionState.saveFolder}
      </div>
    </div>
  `;

  progressDetails.innerHTML = summaryHtml;
}

// Select/Deselect all object types
function toggleSelectAll() {
  const selectAllBtn = document.querySelector('.select-all-btn');
  const allCheckboxes = document.querySelectorAll('.object-types-grid input[type="checkbox"]');

  // Check if all are currently selected
  const allSelected = Array.from(allCheckboxes).every((checkbox) => checkbox.checked);

  if (allSelected) {
    // Deselect all
    allCheckboxes.forEach((checkbox) => {
      if (checkbox.checked) {
        checkbox.checked = false;
        const objectType = checkbox.id.replace('type-', '');
        extractionState.selectedTypes.delete(objectType);
      }
    });
    selectAllBtn.textContent = 'Select All';
  } else {
    // Select all
    allCheckboxes.forEach((checkbox) => {
      if (!checkbox.checked) {
        checkbox.checked = true;
        const objectType = checkbox.id.replace('type-', '');
        extractionState.selectedTypes.add(objectType);
      }
    });
    selectAllBtn.textContent = 'Deselect All';
  }

  // Update extract button
  updateExtractButton();
}

// Make functions available to window for onclick handlers
window.showExtractionModal = showExtractionModal;
window.closeExtractionModal = closeExtractionModal;
window.toggleObjectType = toggleObjectType;
window.toggleObjectTypeByLabel = toggleObjectTypeByLabel;
window.toggleSelectAll = toggleSelectAll;
window.browseSaveFolder = browseSaveFolder;
window.startExtraction = startExtraction;
window.cancelExtraction = cancelExtraction;

console.log('Webview script loaded and ready for messages');
