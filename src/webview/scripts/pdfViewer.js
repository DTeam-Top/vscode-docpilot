// Global variables provided by VS Code webview and PDF.js
/* global acquireVsCodeApi, pdfjsLib, PDF_CONFIG */

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

// Load PDF
const loadingTask = pdfjsLib.getDocument(PDF_CONFIG.pdfUri);
loadingTask.onProgress = (progress) => {
  if (progress.total > 0) {
    const percent = (progress.loaded / progress.total) * 100;
    progressFill.style.width = `${percent}%`;
  }
};

loadingTask.promise
  .then((pdf) => {
    pdfDoc = pdf;
    pagesContainer.innerHTML = '<div class="pdf-pages" id="pdfPages"></div>';
    updatePageInfo();
    initializeTextSelection();
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

// biome-ignore lint/correctness/noUnusedVariables: Used by HTML onclick
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
    document.getElementById('textSelectionBtn').textContent = 'Enable Text Selection';
  } else {
    textSelectionEnabled = false; // Start disabled, let user choose
    document.getElementById('textSelectionBtn').textContent = 'Enable Text Selection';
  }
}

// biome-ignore lint/correctness/noUnusedVariables: Used by HTML onclick
function toggleTextSelection() {
  console.log('Text selection button clicked - function called');
  textSelectionEnabled = !textSelectionEnabled;
  const btn = document.getElementById('textSelectionBtn');
  btn.textContent = textSelectionEnabled ? 'Disable Text Selection' : 'Enable Text Selection';
  btn.style.backgroundColor = textSelectionEnabled
    ? 'var(--vscode-button-secondaryBackground)'
    : 'var(--vscode-button-background)';

  if (textSelectionEnabled) {
    console.log('Text selection enabled - rendering text layers for visible pages');
    renderVisibleTextLayers();
  } else {
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

// biome-ignore lint/correctness/noUnusedVariables: Used by HTML onclick
function toggleDebug() {
  debugMode = !debugMode;
  const btn = document.getElementById('debugBtn');
  btn.textContent = debugMode ? 'Debug ON' : 'Debug';
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
// biome-ignore lint/correctness/noUnusedVariables: Used by HTML onclick
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
    summarizeBtn.innerHTML = '⏳ Summarizing...';
    summarizeBtn.style.opacity = '0.6';

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
    summarizeBtn.innerHTML = '📝 Summarize';
    summarizeBtn.style.opacity = '1';

    vscode.postMessage({
      type: 'summarizeError',
      error: error.message || 'Failed to start summarization',
    });
  }
}

// biome-ignore lint/correctness/noUnusedVariables: Used by HTML onclick
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
    exportBtn.innerHTML = '⏳ Exporting...';
    exportBtn.style.opacity = '0.6';

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
    exportBtn.innerHTML = '📄 Export';
    exportBtn.style.opacity = '1';

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
      summarizeBtn.innerHTML = '📝 Summarize';
      summarizeBtn.style.opacity = '1';
      break;

    case 'summarizeError':
      console.error('Summarization error:', message.error);
      // Reset button state
      summarizeBtn.disabled = false;
      summarizeBtn.innerHTML = '📝 Summarize';
      summarizeBtn.style.opacity = '1';
      break;

    case 'exportStarted':
      console.log('Export started in extension');
      break;

    case 'exportCompleted':
      console.log('Export completed');
      // Reset button state
      exportBtn.disabled = false;
      exportBtn.innerHTML = '📄 Export';
      exportBtn.style.opacity = '1';
      break;

    case 'exportError':
      console.error('Export error:', message.error);
      // Reset button state
      exportBtn.disabled = false;
      exportBtn.innerHTML = '📄 Export';
      exportBtn.style.opacity = '1';
      break;
  }
});

// Fallback functions for CORS-blocked PDFs
// biome-ignore lint/correctness/noUnusedVariables: Used by HTML onclick
function downloadPdfFallback() {
  console.log('Download PDF fallback requested');
  vscode.postMessage({
    type: 'downloadPdfFallback',
    url: PDF_CONFIG.pdfUri,
  });
}

// biome-ignore lint/correctness/noUnusedVariables: Used by HTML onclick
function openInBrowser() {
  console.log('Open in browser requested');
  vscode.postMessage({
    type: 'openInBrowser',
    url: PDF_CONFIG.pdfUri,
  });
}

console.log('Webview script loaded and ready for messages');
