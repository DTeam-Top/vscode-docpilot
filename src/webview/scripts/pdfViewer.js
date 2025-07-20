// Global variables provided by VS Code webview and PDF.js
/* global acquireVsCodeApi, PDF_CONFIG */

// Content extractor variables
let extractorEnabled = false;
let extractedImages = [];
let extractedTables = [];

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
    .then((pdf) => {
      pdfDoc = pdf;
      pagesContainer.innerHTML = '<div class="pdf-pages" id="pdfPages"></div>';
      updatePageInfo();
      initializeTextSelection();
      initializeContentExtractor();
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

// Content extractor functions
function toggleExtractor() {
  extractorEnabled = !extractorEnabled;
  const sidebar = document.getElementById('extractorSidebar');
  
  if (extractorEnabled) {
    sidebar.classList.add('open');
    initializeTabSwitching();
    // Start automatic scanning when extractor is opened
    startAutomaticScanning();
  } else {
    sidebar.classList.remove('open');
    // Clear results when closed
    clearExtractedContent();
  }
}

function initializeTabSwitching() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.getAttribute('data-tab');
      
      // Update tab buttons
      tabButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      // Update tab content
      tabContents.forEach(content => content.classList.remove('active'));
      document.getElementById(targetTab + 'Tab').classList.add('active');
    });
  });
}

// ===== UI FUNCTIONS =====
function addImageToGallery(imageData) {
  const imagesList = document.getElementById('imagesList');
  if (imagesList.querySelector('.loading-message')) {
    imagesList.innerHTML = '';
  }
  
  const item = document.createElement('div');
  item.className = 'content-item';
  item.innerHTML = `
    <div class="content-thumbnail">
      <img src="${imageData.base64}" style="max-width: 100%; max-height: 100%; object-fit: contain;" title="Click to go to page ${imageData.pageNum}">
    </div>
    <div class="content-info">
      <div>Page ${imageData.pageNum} 🖼️</div>
      <div style="color: var(--vscode-descriptionForeground);">${imageData.width} × ${imageData.height}</div>
    </div>
    <div class="content-actions">
      <button class="action-btn" onclick="copyImageToClipboard('${imageData.id}')" title="Copy image to clipboard">Copy</button>
      <button class="action-btn" onclick="goToPage(${imageData.pageNum})" title="Navigate to this page">Go to Page</button>
    </div>
  `;
  
  item.addEventListener('click', () => goToPage(imageData.pageNum));
  imagesList.appendChild(item);
}

function addTableToList(tableData) {
  const tablesList = document.getElementById('tablesList');
  if (tablesList.querySelector('.loading-message')) {
    tablesList.innerHTML = '';
  }
  
  const maxCols = Math.max(...tableData.rows.map(row => row.length));
  
  const item = document.createElement('div');
  item.className = 'content-item';
  item.innerHTML = `
    <div class="content-thumbnail">
      📊
    </div>
    <div class="content-info">
      <div>Page ${tableData.pageNum}</div>
      <div style="color: var(--vscode-descriptionForeground);">${tableData.rows.length} × ${maxCols} table</div>
    </div>
    <div class="content-actions">
      <button class="action-btn" onclick="copyTableAsCSV('${tableData.id}')" title="Copy table as CSV">Copy CSV</button>
      <button class="action-btn" onclick="goToPage(${tableData.pageNum})" title="Navigate to this page">Go to Page</button>
    </div>
  `;
  
  item.addEventListener('click', () => goToPage(tableData.pageNum));
  tablesList.appendChild(item);
}

function copyImageToClipboard(imageId) {
  const image = extractedImages.find(img => img.id === imageId);
  if (image) {
    // Convert base64 to blob and copy to clipboard
    fetch(image.base64)
      .then(res => res.blob())
      .then(blob => {
        navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob })
        ]).then(() => {
          console.log('Image copied to clipboard');
          showStatusMessage('Image copied to clipboard! 📋');
        }).catch(err => {
          console.error('Failed to copy image:', err);
          showStatusMessage('Failed to copy image ❌');
        });
      });
  }
}

function copyTableAsCSV(tableId) {
  const table = extractedTables.find(tbl => tbl.id === tableId);
  if (table) {
    const csv = table.rows.map(row => row.join(',')).join('\n');
    navigator.clipboard.writeText(csv).then(() => {
      console.log('Table copied as CSV to clipboard');
      showStatusMessage('Table copied as CSV! 📋');
    }).catch(err => {
      console.error('Failed to copy table:', err);
      showStatusMessage('Failed to copy table ❌');
    });
  }
}

// Helper function to show status messages
function showStatusMessage(message) {
  // Create a temporary status message
  const statusDiv = document.createElement('div');
  statusDiv.style.cssText = `
    position: fixed;
    top: 50px;
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
          // Wait for the object to be available
          await new Promise((resolve) => {
            page.objs.get(objId, resolve);
          });
          
          const imgObj = page.objs.get(objId);
          console.log(`Image object ${objId}:`, imgObj);
          
          if (imgObj) {
            let base64Image = null;
            
            // Try different approaches to get image data
            if (imgObj.bitmap && imgObj.bitmap instanceof ImageBitmap) {
              console.log(`Found ImageBitmap, width: ${imgObj.width}, height: ${imgObj.height}`);
              base64Image = await convertImageBitmapToBase64(imgObj.bitmap);
            } else if (imgObj.data) {
              console.log(`Found image data, kind: ${imgObj.kind}, width: ${imgObj.width}, height: ${imgObj.height}`);
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
                y: 0
              };
              
              // Filter out very small images (likely icons, bullets, etc.)
              const minSize = 80; // Minimum width or height
              const minArea = 5000; // Minimum total area
              const area = extractedImage.width * extractedImage.height;
              
              if (extractedImage.width >= minSize || extractedImage.height >= minSize || area >= minArea) {
                console.log(`Successfully extracted meaningful image ${imageIndex} from page ${pageNum} (${extractedImage.width}×${extractedImage.height})`);
                images.push(extractedImage);
                imageIndex++;
              } else {
                console.log(`Skipped small image: ${extractedImage.width}×${extractedImage.height} (too small)`);
              }
            } else {
              console.warn(`Could not convert image object to base64:`, imgObj);
            }
          }
        } catch (objError) {
          console.warn(`Failed to extract image object ${objId}:`, objError);
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
      .filter(item => item.str && item.str.trim().length > 0)
      .map(item => {
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
          fontSize: Math.abs(transform[3]) || 12
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
    rgbaData[rgbaIndex] = data[i];     // R
    rgbaData[rgbaIndex + 1] = data[i + 1]; // G
    rgbaData[rgbaIndex + 2] = data[i + 2]; // B
    rgbaData[rgbaIndex + 3] = 255;     // A
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
      rgbaData[pixelIndex] = value;     // R
      rgbaData[pixelIndex + 1] = value; // G
      rgbaData[pixelIndex + 2] = value; // B
      rgbaData[pixelIndex + 3] = 255;   // A
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
    
    let tableRows = [firstRow];
    
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
        rows: tableRows.map(row => row.map(item => item.str))
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

// ===== AUTOMATIC CONTENT SCANNING =====
async function startAutomaticScanning() {
  if (!pdfDoc) {
    console.error('PDF not loaded yet');
    return;
  }
  
  // Show detecting message
  showDetectingMessages();
  
  console.log(`Starting automatic scan of ${pdfDoc.numPages} pages`);
  
  // Scan all pages
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    try {
      await scanPageForContent(pageNum);
    } catch (error) {
      console.error(`Error scanning page ${pageNum}:`, error);
    }
  }
  
  // Hide detecting messages
  hideDetectingMessages();
  console.log('Automatic scanning completed');
}

async function scanPageForContent(pageNum) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    
    // Extract images from this page
    const imageData = await extractImagesFromPage(page, pageNum);
    if (imageData.length > 0) {
      imageData.forEach(img => {
        if (!extractedImages.find(existing => existing.id === img.id)) {
          extractedImages.push(img);
          addImageToGallery(img);
        }
      });
    }
    
    // Extract tables from this page
    const tableData = await extractTablesFromPage(page, pageNum);
    if (tableData.length > 0) {
      tableData.forEach(table => {
        if (!extractedTables.find(existing => existing.id === table.id)) {
          extractedTables.push(table);
          addTableToList(table);
        }
      });
    }
    
    console.log(`Page ${pageNum}: Found ${imageData.length} images, ${tableData.length} tables`);
  } catch (error) {
    console.error(`Error scanning page ${pageNum}:`, error);
  }
}

function showDetectingMessages() {
  const imagesList = document.getElementById('imagesList');
  const tablesList = document.getElementById('tablesList');
  
  imagesList.innerHTML = '<div class="loading-message">🔍 Detecting images...</div>';
  tablesList.innerHTML = '<div class="loading-message">🔍 Detecting tables...</div>';
}

function hideDetectingMessages() {
  const imagesList = document.getElementById('imagesList');
  const tablesList = document.getElementById('tablesList');
  
  // Only hide if still showing detecting message
  if (imagesList.querySelector('.loading-message')?.textContent.includes('Detecting')) {
    if (extractedImages.length === 0) {
      imagesList.innerHTML = '<div class="loading-message">No images found in this PDF</div>';
    }
  }
  
  if (tablesList.querySelector('.loading-message')?.textContent.includes('Detecting')) {
    if (extractedTables.length === 0) {
      tablesList.innerHTML = '<div class="loading-message">No tables found in this PDF</div>';
    }
  }
}

function clearExtractedContent() {
  extractedImages = [];
  extractedTables = [];
  
  const imagesList = document.getElementById('imagesList');
  const tablesList = document.getElementById('tablesList');
  
  imagesList.innerHTML = '<div class="loading-message">Click the extractor button to scan for images</div>';
  tablesList.innerHTML = '<div class="loading-message">Click the extractor button to scan for tables</div>';
}

function initializeContentExtractor() {
  console.log('Content extractor initialized');
}

// ===== GLOBAL FUNCTION EXPORTS =====
// Expose functions globally for HTML onclick handlers
window.fitToWidth = fitToWidth;
window.fitToPage = fitToPage;
window.summarizeDocument = summarizeDocument;
window.exportText = exportText;
window.toggleTextSelection = toggleTextSelection;
window.toggleDebug = toggleDebug;
window.toggleExtractor = toggleExtractor;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.setZoom = setZoom;
window.downloadPdfFallback = downloadPdfFallback;
window.openInBrowser = openInBrowser;
window.copyImageToClipboard = copyImageToClipboard;
window.copyTableAsCSV = copyTableAsCSV;
window.goToPage = goToPage;

console.log('Webview script loaded and ready for messages');
