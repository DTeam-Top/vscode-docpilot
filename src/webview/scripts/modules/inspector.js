import { state } from './state.js';
import { goToPage } from './ui.js';
import {
  extractAnnotationsFromPage,
  extractAttachments,
  extractBookmarks,
  extractFontsFromPage,
  extractFormFields,
  extractImagesFromPage,
  extractJavaScript,
  extractMetadata,
  extractTablesFromPage,
  showStatusMessage,
} from './utils.js';

// PDF Object Inspector class for dual-mode object viewing with lazy loading
export class PDFObjectInspector {
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

    // Progressive loading settings (simplified - images only)
    this.progressiveLoading = {
      pageMode: {
        batchSize: 10, // Show 10 pages at a time
        currentlyShown: 0, // How many pages currently shown
        showMoreInProgress: false, // Prevent duplicate show-more requests
      },
      imageProgressiveLoading: {
        batchSize: 6, // Process 6 pages per batch for near-real-time feedback
        scanningProgress: {
          current: 0,
          total: 0,
          results: [],
          isProgressive: false,
        },
      },
    };
  }

  hasObjectsOfType(type) {
    if (type === 'bookmarks') return this.objects.bookmarks.length > 0;
    if (type === 'javascript') return this.objects.javascript.length > 0;
    if (type === 'metadata') return Object.keys(this.objects.metadata).length > 0;
    return this.objects[type] && this.objects[type].size > 0;
  }

  // Progressive scanning for images only (computationally expensive)
  async scanImagesProgressively() {
    const allResults = [];
    const totalPages = state.pdfDoc.numPages;
    const batchSize = this.progressiveLoading.imageProgressiveLoading.batchSize;

    const progress = this.progressiveLoading.imageProgressiveLoading.scanningProgress;
    progress.total = totalPages;
    progress.isProgressive = true;

    this.expandedNodes.add('images');

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        progress.current = pageNum;
        const page = await state.pdfDoc.getPage(pageNum);
        const pageResults = await extractImagesFromPage(page, pageNum);
        if (pageResults && pageResults.length > 0) {
          allResults.push(...pageResults);
          progress.results = [...allResults];

          applyObjectScanResults('images', allResults);
          renderObjectTree();

          showStatusMessage(
            `🔍 Scanning images... ${pageNum}/${totalPages} pages (${allResults.length} found)`
          );
        }
        if (pageNum % batchSize === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.warn(`Failed to extract images from page ${pageNum}:`, error);
      }
    }
    return allResults;
  }

  // Simple batch scanning for lightweight object types (non-images)
  async scanAllPagesSimple(objectType, extractFunction) {
    console.log(`Batch scanning all pages for ${objectType}...`);
    const results = [];
    const totalPages = state.pdfDoc.numPages;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const page = await state.pdfDoc.getPage(pageNum);
        const pageResults = await extractFunction(page, pageNum);
        if (pageResults && pageResults.length > 0) {
          results.push(...pageResults);
        }
      } catch (error) {
        console.warn(`Failed to extract ${objectType} from page ${pageNum}:`, error);
      }
    }

    console.log(`Batch scanning complete for ${objectType}: ${results.length} items found`);
    return results;
  }

  generateCacheKey(type, pageNum = 1) {
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

export function toggleInspector() {
  state.inspectorEnabled = !state.inspectorEnabled;
  const sidebar = document.getElementById('inspectorSidebar');

  if (state.inspectorEnabled) {
    sidebar.classList.add('open');
    if (!state.globalInspector) {
      console.log('toggleInspector: initializing PDF inspector');
      initializePDFInspector();
    }
    initializeLazyInspector();
  } else {
    sidebar.classList.remove('open');
    clearExtractedContent();
  }
}

export function initializePDFInspector() {
  console.log('PDF inspector initialized');
  state.globalInspector = new PDFObjectInspector();
  initializeModeSwitching();

  const savedMode = localStorage.getItem('docpilot-inspector-mode');
  if (savedMode && (savedMode === 'objects' || savedMode === 'pages')) {
    state.globalInspector.currentMode = savedMode;
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
  if (!state.globalInspector || state.globalInspector.currentMode === newMode) return;

  state.globalInspector.currentMode = newMode;
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
    button.classList.toggle('active', button.dataset.mode === state.globalInspector.currentMode);
  });
}

function renderObjectTree() {
  if (!state.globalInspector) {
    console.warn('renderObjectTree: globalInspector not initialized');
    return;
  }
  const container = document.getElementById('objectTree');
  if (!container) {
    console.warn('renderObjectTree: objectTree container not found');
    return;
  }

  if (state.globalInspector.currentMode === 'objects') {
    container.innerHTML = renderObjectCentricTree();
  } else {
    container.innerHTML = renderPageCentricTree();
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
    const count = state.globalInspector.getObjectCount(type.key);
    const hasObjects = state.globalInspector.hasObjectsOfType(type.key);
    const isExpanded = state.globalInspector.expandedNodes.has(type.key);
    const cacheKey = state.globalInspector.generateCacheKey(type.key);
    const cacheEntry = state.globalInspector.sharedCache.get(cacheKey);
    const isScanned = hasObjects || (cacheEntry && cacheEntry.status === 'complete');

    let badgeContent = '';

    // Special handling for images progressive scanning
    if (type.key === 'images') {
      const scanProgress =
        state.globalInspector.progressiveLoading.imageProgressiveLoading.scanningProgress;
      if (scanProgress?.isProgressive) {
        const currentCount = scanProgress.results.length;
        badgeContent = `${currentCount} (${scanProgress.current}/${scanProgress.total})`;
      } else if (state.globalInspector.isScanPending(cacheKey)) {
        badgeContent = '🔍 Scanning...';
      } else if (count > 0) {
        badgeContent = count;
      }
    } else {
      // Simple handling for all other object types
      if (state.globalInspector.isScanPending(cacheKey)) {
        badgeContent = '🔍 Scanning...';
      } else if (count > 0) {
        badgeContent = count;
      }
    }

    html += `
      <div class="tree-node ${isScanned ? 'expandable' : 'clickable'} ${isExpanded ? 'expanded' : ''}" 
           data-node="${type.key}">
        <div class="tree-node-header">
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
  if (!state.pdfDoc) return '<div class="loading-message">PDF not loaded</div>';

  let html = '<div class="tree-root">';

  const totalPages = state.pdfDoc.numPages;
  const currentlyShown = state.globalInspector.progressiveLoading.pageMode.currentlyShown;
  const batchSize = state.globalInspector.progressiveLoading.pageMode.batchSize;
  const pagesToShow = Math.min(currentlyShown + batchSize, totalPages);

  for (let pageNum = 1; pageNum <= pagesToShow; pageNum++) {
    const pageObjects = state.globalInspector.pageObjects.get(pageNum) || new Set();
    const isExpanded = state.globalInspector.expandedNodes.has(`page-${pageNum}`);
    const cacheKey = state.globalInspector.generateCacheKey('page-objects', pageNum);
    const isScanned = pageObjects.size > 0 || state.globalInspector.getCachedData(cacheKey);

    let badgeContent = '';
    if (state.globalInspector.isScanPending(cacheKey)) {
      badgeContent = '🔍 Scanning...';
    } else if (pageObjects.size > 0) {
      badgeContent = pageObjects.size;
    }

    html += `
      <div class="tree-node ${isScanned ? 'expandable' : 'clickable'} ${isExpanded ? 'expanded' : ''}" 
           data-node="page-${pageNum}">
        <div class="tree-node-header">
          <span class="tree-expand-icon">${isScanned ? (isExpanded ? '▼' : '▶') : '▶'}</span>
          <span class="tree-icon">📄</span>
          <span class="tree-label">Page ${pageNum}</span>
          ${badgeContent ? `<span class="tree-badge">${badgeContent}</span>` : ''}
        </div>
        ${isScanned ? `<div class="tree-children">${renderPageObjectsList(pageNum, pageObjects)}</div>` : ''}
      </div>
    `;
  }

  if (pagesToShow < totalPages) {
    const remaining = totalPages - pagesToShow;
    const showMoreInProgress = state.globalInspector.progressiveLoading.pageMode.showMoreInProgress;
    html += `
      <div class="tree-node clickable load-more-pages">
        <div class="tree-node-header">
          <span class="tree-expand-icon">⬇️</span>
          <span class="tree-icon">📄</span>
          <span class="tree-label">${showMoreInProgress ? 'Loading...' : `Load More Pages (${remaining} remaining)`}</span>
        </div>
      </div>
    `;
  }

  return html;
}

// Generate a simple hash using timestamp for cache keys
function generatePdfFileHash() {
  state.globalInspector.pdfFileHash = `pdf_${Date.now()}`;
  console.log('PDF hash generated:', state.globalInspector.pdfFileHash);
}

export function initializeLazyInspector() {
  console.log('Initializing lazy inspector UI...');

  generatePdfFileHash();

  const objectTypes = [
    'images',
    'tables',
    'fonts',
    'annotations',
    'formFields',
    'attachments',
    'bookmarks',
    'javascript',
    'metadata',
  ];

  // Initialize progressive loading only for images
  state.globalInspector.progressiveLoading.imageProgressiveLoading.scanningProgress = {
    current: 0,
    total: 0,
    results: [],
    isProgressive: false,
  };

  state.globalInspector.progressiveLoading.pageMode.currentlyShown = 0;

  initializePDFProgression();
  renderLazyLoadingSkeleton();
  console.log('Lazy inspector initialized');
}

function initializePDFProgression() {
  if (!state.pdfDoc) return;

  const totalPages = state.pdfDoc.numPages;
  const initialBatch = Math.min(
    state.globalInspector.progressiveLoading.pageMode.batchSize,
    totalPages
  );

  state.globalInspector.progressiveLoading.pageMode.currentlyShown = initialBatch;
  console.log(`Initialized page progression: showing ${initialBatch} of ${totalPages} pages`);
}

function renderLazyLoadingSkeleton() {
  state.globalInspector.lazyScanning = true;
  renderObjectTree();
}

export function clearExtractedContent() {
  console.log('Clearing extracted content...');

  if (state.globalInspector) {
    state.globalInspector.objects.images.clear();
    state.globalInspector.objects.tables.clear();
    state.globalInspector.objects.fonts.clear();
    state.globalInspector.objects.annotations.clear();
    state.globalInspector.objects.formFields.clear();
    state.globalInspector.objects.attachments.clear();
    state.globalInspector.objects.bookmarks = [];
    state.globalInspector.objects.metadata = {};
    state.globalInspector.objects.javascript = [];

    state.globalInspector.pageObjects.clear();

    state.globalInspector.expandedNodes.clear();

    state.globalInspector.sharedCache.clear();
    state.globalInspector.pendingScans.clear();

    renderObjectTree();
  }

  console.log('Extracted content cleared');
}

function renderPageObjectsList(pageNum, pageObjects) {
  if (pageObjects.size === 0) {
    return '<div class="empty-message">No objects found on this page</div>';
  }

  let html = '';
  let unknownObjectsCount = 0;
  
  pageObjects.forEach((objId) => {
    // Skip invalid or empty object IDs
    if (!objId || typeof objId !== 'string' || objId.trim() === '') {
      console.warn(`Invalid object ID found on page ${pageNum}:`, objId);
      return;
    }

    // Identify object type from objId prefix and render with appropriate preview
    if (objId.startsWith('img_')) {
      const image = state.globalInspector.objects.images.get(objId);
      if (image) {
        html += renderImageObject(image, 'page-view');
      } else {
        console.warn(`Missing image object for ID: ${objId}`);
      }
    } else if (objId.startsWith('table_')) {
      const table = state.globalInspector.objects.tables.get(objId);
      if (table) {
        html += renderTableObject(table, 'page-view');
      } else {
        console.warn(`Missing table object for ID: ${objId}`);
      }
    } else if (objId.startsWith('font_')) {
      const font = state.globalInspector.objects.fonts.get(objId);
      if (font) {
        html += renderFontObject(font, 'page-view');
      } else {
        console.warn(`Missing font object for ID: ${objId}`);
      }
    } else if (objId.startsWith('annotation_')) {
      const annotation = state.globalInspector.objects.annotations.get(objId);
      if (annotation) {
        html += renderAnnotationObject(annotation, 'page-view');
      } else {
        console.warn(`Missing annotation object for ID: ${objId}`);
      }
    } else {
      // Log and skip unknown object types instead of displaying them
      console.warn(`Unknown object type found on page ${pageNum}: "${objId}" - skipping display`);
      unknownObjectsCount++;
    }
  });

  // Show a summary message if there were unknown objects
  if (unknownObjectsCount > 0) {
    html += `
      <div class="tree-leaf" style="color: var(--vscode-descriptionForeground); font-style: italic;">
        <span class="tree-icon">⚠️</span>
        <span class="tree-label">${unknownObjectsCount} unknown object${unknownObjectsCount > 1 ? 's' : ''} (filtered)</span>
      </div>
    `;
  }

  return html;
}

// Store the handler function so we can remove it
let treeClickHandler = null;

function attachTreeEventListeners() {
  const container = document.getElementById('objectTree');
  if (!container) return;

  // Remove existing handler if it exists
  if (treeClickHandler) {
    container.removeEventListener('click', treeClickHandler);
  }

  // Create new handler
  treeClickHandler = async (e) => {
    // Handle tree node headers (expand/collapse/scan)
    const header = e.target.closest('.tree-node-header');
    if (header) {
      const nodeElement = header.closest('.tree-node');
      const nodeId = nodeElement.getAttribute('data-node');

      if (nodeElement.classList.contains('expandable')) {
        toggleNode(nodeId);
      } else if (nodeElement.classList.contains('clickable')) {
        if (nodeId.startsWith('page-')) {
          await scanPageObjectsAndExpand(parseInt(nodeId.split('-')[1], 10));
        } else if (nodeElement.classList.contains('load-more-pages')) {
          loadMorePages();
        } else if (nodeId.startsWith('doc-')) {
          const objectType = nodeId.substring(4);
          await scanObjectTypeAndExpand(objectType);
        } else {
          await scanObjectTypeAndExpand(nodeId);
        }
      }
      return;
    }

    // Handle action buttons
    const actionBtn = e.target.closest('.tree-action-btn');
    if (actionBtn) {
      const action = actionBtn.getAttribute('data-action');

      // Handle metadata copy action
      if (action === 'copy-metadata') {
        copyMetadataAsJSON();
        return;
      }

      const objectPreview = actionBtn.closest('.tree-object-preview');
      if (objectPreview) {
        const objectId = objectPreview.getAttribute('data-object-id');
        const objectType = objectPreview.getAttribute('data-object-type');

        if (action === 'copy' && objectType === 'images') {
          copyImageToClipboard(objectId);
        } else if (action === 'copy-csv' && objectType === 'tables') {
          copyTableAsCSV(objectId);
        } else if (action === 'navigate') {
          // Navigate to page for fonts and annotations
          const pageNum = parseInt(objectPreview.getAttribute('data-page-num'), 10);
          if (pageNum) {
            navigateToObject(objectId, objectType, pageNum);
          }
        }
      }
      return;
    }

    // Handle tree leaf actions (bookmarks, attachments, etc.)
    const treeLeaf = e.target.closest('.tree-leaf[data-action]');
    if (treeLeaf) {
      const action = treeLeaf.getAttribute('data-action');

      switch (action) {
        case 'navigate-bookmark': {
          const index = parseInt(treeLeaf.getAttribute('data-bookmark-index'), 10);
          const pageNum = treeLeaf.getAttribute('data-page-num');
          navigateToBookmark(index, pageNum);
          break;
        }
        case 'download-attachment': {
          const filename = treeLeaf.getAttribute('data-filename');
          downloadAttachment(filename);
          break;
        }
        case 'view-javascript': {
          const index = parseInt(treeLeaf.getAttribute('data-js-index'), 10);
          viewJavaScript(index);
          break;
        }
        case 'navigate-object': {
          const objectId = treeLeaf.getAttribute('data-object-id');
          const objectType = treeLeaf.getAttribute('data-object-type');
          const pageNum = parseInt(treeLeaf.getAttribute('data-page-num'), 10);
          navigateToObject(objectId, objectType, pageNum);
          break;
        }
        default:
          console.warn(`Unknown tree leaf action: ${action}`);
      }
      return;
    }

    // Handle object info clicks (navigation)
    const objectInfo = e.target.closest('.tree-object-info');
    if (objectInfo) {
      const objectPreview = objectInfo.closest('.tree-object-preview');
      if (objectPreview) {
        const objectId = objectPreview.getAttribute('data-object-id');
        const objectType = objectPreview.getAttribute('data-object-type');
        const pageNum = parseInt(objectPreview.getAttribute('data-page-num'), 10);
        navigateToObject(objectId, objectType, pageNum);
      }
    }
  };

  // Attach the new handler
  container.addEventListener('click', treeClickHandler);
}

function toggleNode(nodeId) {
  if (state.globalInspector.expandedNodes.has(nodeId)) {
    state.globalInspector.expandedNodes.delete(nodeId);
  } else {
    state.globalInspector.expandedNodes.add(nodeId);
  }
  renderObjectTree();
}

async function scanObjectTypeAndExpand(type) {
  // Scan the object type first
  await scanObjectType(type);
  // Then expand the node to show results (handle both regular and doc- prefixed nodes)
  const nodeId = type.startsWith('doc-')
    ? type
    : state.globalInspector.currentMode === 'pages' &&
        ['metadata', 'bookmarks', 'attachments', 'formFields', 'javascript'].includes(type)
      ? `doc-${type}`
      : type;
  state.globalInspector.expandedNodes.add(nodeId);
  renderObjectTree();
}

async function scanPageObjectsAndExpand(pageNum) {
  // Scan the page objects first
  await scanPageObjects(pageNum);
  // Then expand the node to show results
  state.globalInspector.expandedNodes.add(`page-${pageNum}`);
  renderObjectTree();
}

async function startImageScanning() {
  try {
    showStatusMessage('🔍 Starting image scan...');
    const results = await state.globalInspector.scanImagesProgressively();
    applyObjectScanResults('images', results);
    renderObjectTree();
    showStatusMessage(`📷 Image scan completed: ${results.length} images found`);
  } catch (error) {
    console.error('Error during image scanning:', error);
    showStatusMessage('❌ Image scanning failed');
  }
}

async function scanObjectType(type) {
  const cacheKey = state.globalInspector.generateCacheKey(type);
  if (
    state.globalInspector.isScanPending(cacheKey) ||
    state.globalInspector.getCachedData(cacheKey)
  ) {
    return;
  }

  state.globalInspector.setCacheStatus(cacheKey, 'loading');
  state.globalInspector.pendingScans.add(cacheKey);
  renderObjectTree();

  try {
    let results = [];
    switch (type) {
      case 'images':
        // For images, just prepare for manual loading (don't auto-scan)
        results = [];
        showStatusMessage(`📷 Click "Load More Images" to scan for images`);
        break;
      case 'tables':
        // Use simple batch scanning for tables (eager loading)
        results = await state.globalInspector.scanAllPagesSimple(type, extractTablesFromPage);
        showStatusMessage(`📊 Scanning tables... ${results.length} found`);
        break;
      case 'metadata':
        // Extract document metadata (single operation)
        results = [await extractMetadata(state.pdfDoc)];
        showStatusMessage(`📑 Metadata extracted`);
        break;
      case 'bookmarks':
        // Extract bookmarks (single operation)
        results = await extractBookmarks(state.pdfDoc);
        showStatusMessage(`🔖 ${results.length} bookmarks found`);
        break;
      case 'annotations':
        // Use simple batch scanning for annotations (eager loading)
        results = await state.globalInspector.scanAllPagesSimple(type, extractAnnotationsFromPage);
        showStatusMessage(`📝 Scanning annotations... ${results.length} found`);
        break;
      case 'fonts':
        // Use simple batch scanning for fonts (eager loading)
        results = await state.globalInspector.scanAllPagesSimple(type, extractFontsFromPage);
        showStatusMessage(`🔤 Scanning fonts... ${results.length} found`);
        break;
      case 'formFields':
        // Extract form fields (document-level operation)
        results = await extractFormFields(state.pdfDoc);
        showStatusMessage(`📋 ${results.length} form fields found`);
        break;
      case 'attachments':
        // Extract attachments (document-level operation)
        results = await extractAttachments(state.pdfDoc);
        showStatusMessage(`📎 ${results.length} attachments found`);
        break;
      case 'javascript':
        // Extract JavaScript (document-level operation)
        results = await extractJavaScript(state.pdfDoc);
        showStatusMessage(`⚙️ ${results.length} JavaScript blocks found`);
        break;
      default:
        console.warn(`Unknown object type: ${type}`);
        results = [];
    }
    applyObjectScanResults(type, results);
    state.globalInspector.setCacheStatus(cacheKey, 'complete', results);
  } catch (error) {
    console.error(`Error scanning for ${type}:`, error);
    state.globalInspector.setCacheStatus(cacheKey, 'error');
  } finally {
    state.globalInspector.pendingScans.delete(cacheKey);
    renderObjectTree();
  }
}

async function scanPageObjects(pageNum) {
  console.log(`Scanning page: ${pageNum}`);
  const cacheKey = state.globalInspector.generateCacheKey('page-objects', pageNum);
  if (
    state.globalInspector.isScanPending(cacheKey) ||
    state.globalInspector.getCachedData(cacheKey)
  ) {
    return;
  }

  state.globalInspector.setCacheStatus(cacheKey, 'loading');
  state.globalInspector.pendingScans.add(cacheKey);
  renderObjectTree();

  try {
    const page = await state.pdfDoc.getPage(pageNum);
    const images = await extractImagesFromPage(page, pageNum);
    const tables = await extractTablesFromPage(page, pageNum);
    const fonts = await extractFontsFromPage(page, pageNum);
    const annotations = await extractAnnotationsFromPage(page, pageNum);

    const pageObjects = new Set();

    // Add images with previews
    images.forEach((img) => {
      state.globalInspector.objects.images.set(img.id, img);
      pageObjects.add(img.id);
    });

    // Add tables with previews
    tables.forEach((table) => {
      state.globalInspector.objects.tables.set(table.id, table);
      pageObjects.add(table.id);
    });

    // Add fonts (as simple entries)
    fonts.forEach((font) => {
      state.globalInspector.objects.fonts.set(font.id, font);
      pageObjects.add(font.id);
    });

    // Add annotations (as simple entries)
    annotations.forEach((annotation) => {
      state.globalInspector.objects.annotations.set(annotation.id, annotation);
      pageObjects.add(annotation.id);
    });

    state.globalInspector.pageObjects.set(pageNum, pageObjects);
    state.globalInspector.setCacheStatus(cacheKey, 'complete', Array.from(pageObjects));
  } catch (error) {
    console.error(`Error scanning page ${pageNum}:`, error);
    state.globalInspector.setCacheStatus(cacheKey, 'error');
  } finally {
    state.globalInspector.pendingScans.delete(cacheKey);
    renderObjectTree();
  }
}

async function loadMorePages() {
  if (state.globalInspector.progressiveLoading.pageMode.showMoreInProgress) return;

  state.globalInspector.progressiveLoading.pageMode.showMoreInProgress = true;
  renderObjectTree();

  await new Promise((resolve) => setTimeout(resolve, 300));

  state.globalInspector.progressiveLoading.pageMode.currentlyShown +=
    state.globalInspector.progressiveLoading.pageMode.batchSize;
  state.globalInspector.progressiveLoading.pageMode.showMoreInProgress = false;
  renderObjectTree();
}

function renderObjectTypeChildren(objectType) {
  const html = '';

  if (objectType === 'images') {
    return renderImageItems();
  } else if (objectType === 'tables') {
    return renderTableItems();
  } else if (objectType === 'fonts') {
    return renderFontItems();
  } else if (objectType === 'annotations') {
    return renderAnnotationItems();
  } else if (objectType === 'formFields') {
    return renderFormFieldItems();
  } else if (objectType === 'attachments') {
    return renderAttachmentItems();
  } else if (objectType === 'bookmarks') {
    return renderBookmarkItems(state.globalInspector.objects.bookmarks);
  } else if (objectType === 'javascript') {
    return renderJavaScriptItems();
  } else if (objectType === 'metadata') {
    return renderMetadataTable();
  }

  // Note: Progressive loading complexity removed - images use real-time updates,
  // other types load eagerly during scanning

  return html || '<div class="empty-message">No items found</div>';
}

// Helper functions to render individual object types consistently
function renderImageItems() {
  let html = '';
  const images = state.globalInspector.objects.images;
  const scanProgress =
    state.globalInspector.progressiveLoading.imageProgressiveLoading.scanningProgress;

  // Show existing images first
  images.forEach((obj, id) => {
    html += renderImageObject(obj, 'object-view');
  });

  // Single "Load More Images" button logic - immediate progressive scanning
  const hasImages = images.size > 0;
  const isScanning = scanProgress?.isProgressive;
  const hasMorePages = scanProgress && scanProgress.current < scanProgress.total;

  if (!hasImages && !isScanning) {
    // Initial state: Auto-start progressive scanning on first render
    // This will be triggered immediately when the images node is expanded
    setTimeout(() => {
      startImageScanning();
    }, 0);

    html += `
      <div class="load-more-container">
        <div class="scanning-status">📷 Starting image scan...</div>
      </div>
    `;
  } else if (isScanning && hasMorePages) {
    // Currently scanning: Show progress
    html += `
      <div class="load-more-container">
        <div class="scanning-status">📷 Scanning for images... (${scanProgress.current}/${scanProgress.total} pages)</div>
      </div>
    `;
  } else if (hasImages && !isScanning) {
    // Scanning complete: Show final count
    html += `
      <div class="load-more-container">
        <div class="scanning-complete">📷 Scan complete: ${images.size} images found</div>
      </div>
    `;
  }

  return html || '<div class="empty-message">No images found</div>';
}

function renderTableItems() {
  let html = '';
  const tables = state.globalInspector.objects.tables;

  if (tables.size === 0) {
    return '<div class="empty-message">No tables found</div>';
  }

  tables.forEach((obj, id) => {
    html += renderTableObject(obj, 'object-view');
  });

  return html;
}

function renderMetadataTable() {
  const metadata = state.globalInspector.objects.metadata;
  if (Object.keys(metadata).length === 0) {
    return '<div class="empty-message">No metadata found</div>';
  }

  let html = `
    <div class="metadata-table-container">
      <div class="metadata-table-header">
        <span class="metadata-table-title">PDF Metadata</span>
        <button class="tree-action-btn" data-action="copy-metadata" title="Copy all metadata as JSON">Copy JSON</button>
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
    const displayValue =
      String(value).length > 100 ? String(value).substring(0, 100) + '...' : String(value);
    html += `
      <tr>
        <td>${key}</td>
        <td title="${String(value)}">${displayValue}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
    </div>
  `;

  return html;
}

function renderBookmarkItems(bookmarks, level = 0) {
  if (!bookmarks || bookmarks.length === 0) {
    return '<div class="empty-message">No bookmarks found</div>';
  }

  let html = '';

  bookmarks.forEach((bookmark, index) => {
    // Use the enhanced pageNum from processed bookmarks
    const pageNum = bookmark.pageNum || 'Unknown';
    const title = bookmark.title || `Bookmark ${index + 1}`;

    // Show additional info if available
    let linkInfo = '';
    if (bookmark.url) {
      linkInfo = ` <span class="tree-details">(External Link)</span>`;
    } else if (pageNum !== 'Unknown') {
      linkInfo = ` <span class="tree-page-ref">(Page ${pageNum})</span>`;
    }

    html += `
      <div class="tree-leaf" style="padding-left: ${level * 16}px" data-action="navigate-bookmark" data-bookmark-index="${index}" data-page-num="${pageNum}">
        <span class="tree-icon">🔖</span>
        <span class="tree-label">${title}</span>${linkInfo}
      </div>
    `;

    // Render nested bookmarks if they exist
    if (bookmark.items && bookmark.items.length > 0) {
      html += renderBookmarkItems(bookmark.items, level + 1);
    }
  });

  return html;
}

function renderAttachmentItems() {
  let html = '';
  const attachments = state.globalInspector.objects.attachments;

  if (attachments.size === 0) {
    return '<div class="empty-message">No attachments found</div>';
  }

  attachments.forEach((attachment, filename) => {
    const sizeStr = attachment.content
      ? `${Math.round(attachment.content.length / 1024)} KB`
      : 'Unknown size';

    html += `
      <div class="tree-leaf" data-action="download-attachment" data-filename="${filename}">
        <span class="tree-icon">📎</span>
        <span class="tree-label">${filename}</span>
        <span class="tree-details">${sizeStr}</span>
      </div>
    `;
  });

  return html;
}

function renderJavaScriptItems() {
  const javascript = state.globalInspector.objects.javascript;

  if (!javascript || javascript.length === 0) {
    return '<div class="empty-message">No JavaScript found</div>';
  }

  let html = '';
  javascript.forEach((js, index) => {
    const preview = js.length > 50 ? js.substring(0, 50) + '...' : js;
    html += `
      <div class="tree-leaf" data-action="view-javascript" data-js-index="${index}">
        <span class="tree-icon">⚙️</span>
        <span class="tree-label">Script ${index + 1}</span>
        <span class="tree-details">${preview}</span>
      </div>
    `;
  });

  return html;
}

function renderFormFieldItems() {
  const formFields = state.globalInspector.objects.formFields;

  if (formFields.size === 0) {
    return '<div class="empty-message">No form fields found</div>';
  }

  let html = '';
  formFields.forEach((field, id) => {
    html += `
      <div class="tree-leaf">
        <span class="tree-icon">📋</span>
        <span class="tree-label">${field.name || field.id || id}</span>
        <span class="tree-details">${field.type || 'Unknown type'}</span>
      </div>
    `;
  });

  return html;
}

function renderFontItems() {
  const fonts = state.globalInspector.objects.fonts;

  if (fonts.size === 0) {
    return '<div class="empty-message">No fonts found</div>';
  }

  let html = '';
  fonts.forEach((font, id) => {
    html += renderFontObject(font, 'object-view');
  });

  return html;
}

function renderAnnotationItems() {
  const annotations = state.globalInspector.objects.annotations;

  if (annotations.size === 0) {
    return '<div class="empty-message">No annotations found</div>';
  }

  let html = '';
  annotations.forEach((obj, id) => {
    html += renderAnnotationObject(obj, 'object-view');
  });

  return html;
}

// Utility functions for object interactions
function copyMetadataAsJSON() {
  const metadata = state.globalInspector.objects.metadata;
  if (metadata && Object.keys(metadata).length > 0) {
    const jsonString = JSON.stringify(metadata, null, 2);
    navigator.clipboard
      .writeText(jsonString)
      .then(() => {
        console.log('Metadata copied as JSON to clipboard');
        showStatusMessage('Metadata copied as JSON! 📋');
      })
      .catch((err) => {
        console.error('Failed to copy metadata:', err);
        showStatusMessage('Failed to copy metadata ❌');
      });
  } else {
    showStatusMessage('No metadata to copy ❌');
  }
}

function navigateToBookmark(index, pageNum) {
  console.log(`Navigating to bookmark ${index} on page ${pageNum}`);
  if (pageNum !== 'Unknown' && pageNum > 0) {
    navigateToObject(`bookmark-${index}`, 'bookmarks', pageNum);
  }
}

function downloadAttachment(filename) {
  const attachment = state.globalInspector.objects.attachments.get(filename);
  if (attachment?.content) {
    try {
      // Create a blob from the attachment content
      const blob = new Blob([attachment.content], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);

      // Create a temporary download link
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showStatusMessage(`Downloaded ${filename} 📎`);
    } catch (error) {
      console.error('Failed to download attachment:', error);
      showStatusMessage('Failed to download attachment ❌');
    }
  } else {
    console.error('Attachment not found or has no content:', filename);
    showStatusMessage('Attachment not found ❌');
  }
}

function viewJavaScript(index) {
  const js = state.globalInspector.objects.javascript[index];
  if (js) {
    // Create a modal or alert to show JavaScript content
    alert(`JavaScript Code (${index + 1}):\n\n${js}`);
  } else {
    showStatusMessage('JavaScript not found ❌');
  }
}

// ===== REUSABLE OBJECT RENDERERS =====

/**
 * Render an image object consistently for both view modes
 * @param {Object} image - Image object data
 * @param {string} context - 'object-view' or 'page-view'
 * @returns {string} HTML string
 */
function renderImageObject(image, context = 'object-view') {
  if (!image) return '';
  
  const title = context === 'object-view' ? `Page ${image.pageNum} 🖼️` : '🖼️ Image';
  
  return `
    <div class="tree-object-preview" data-object-id="${image.id}" data-object-type="images" data-page-num="${image.pageNum}">
      <div class="tree-object-thumbnail">
        <img src="${image.base64}" title="Click to go to page ${image.pageNum}" style="max-width: 40px; max-height: 40px;">
      </div>
      <div class="tree-object-info">
        <div class="tree-object-info-title">${title}</div>
        <div class="tree-object-info-details">${image.width} × ${image.height}</div>
      </div>
      <div class="tree-object-actions">
        <button class="tree-action-btn" data-action="copy" title="Copy image to clipboard">Copy</button>
      </div>
    </div>
  `;
}

/**
 * Render a table object consistently for both view modes
 * @param {Object} table - Table object data
 * @param {string} context - 'object-view' or 'page-view'
 * @returns {string} HTML string
 */
function renderTableObject(table, context = 'object-view') {
  if (!table) return '';
  
  const maxCols = Math.max(...table.rows.map((row) => row.length));
  const title = context === 'object-view' ? `Page ${table.pageNum}` : '📊 Table';
  
  return `
    <div class="tree-object-preview" data-object-id="${table.id}" data-object-type="tables" data-page-num="${table.pageNum}">
      <div class="tree-object-thumbnail">📊</div>
      <div class="tree-object-info">
        <div class="tree-object-info-title">${title}</div>
        <div class="tree-object-info-details">${table.rows.length} × ${maxCols} table</div>
      </div>
      <div class="tree-object-actions">
        <button class="tree-action-btn" data-action="copy-csv" title="Copy table as CSV">Copy CSV</button>
      </div>
    </div>
  `;
}

/**
 * Render a font object consistently for both view modes
 * @param {Object} font - Font object data
 * @param {string} context - 'object-view' or 'page-view'
 * @returns {string} HTML string
 */
function renderFontObject(font, context = 'object-view') {
  if (!font) return '';
  
  const displayName = font.name || font.id || 'Unknown Font';
  const displayType = font.type || 'Unknown type';
  const title = context === 'object-view' ? displayName : `🔤 Font: ${displayName}`;
  
  return `
    <div class="tree-object-preview" data-object-id="${font.id}" data-object-type="fonts" data-page-num="${font.pageNum}">
      <div class="tree-object-thumbnail">🔤</div>
      <div class="tree-object-info">
        <div class="tree-object-info-title">${title}</div>
        <div class="tree-object-info-details">${displayType}</div>
      </div>
      <div class="tree-object-actions">
        <button class="tree-action-btn" data-action="navigate" title="Go to page">Go to Page</button>
      </div>
    </div>
  `;
}

/**
 * Render an annotation object consistently for both view modes
 * @param {Object} annotation - Annotation object data
 * @param {string} context - 'object-view' or 'page-view'
 * @returns {string} HTML string
 */
function renderAnnotationObject(annotation, context = 'object-view') {
  if (!annotation) return '';
  
  let displayContent = 'No content';
  if (annotation.content && annotation.content !== 'No content available') {
    displayContent = annotation.content.length > 30
      ? annotation.content.substring(0, 30) + '...'
      : annotation.content;
  }

  let icon = '📝';
  switch (annotation.type) {
    case 'Link':
      icon = '🔗';
      break;
    case 'Text':
    case 'Note':
      icon = '📝';
      break;
    case 'Highlight':
      icon = '🖍️';
      break;
    case 'Underline':
      icon = '📑';
      break;
    case 'FileAttachment':
      icon = '📎';
      break;
  }
  
  // Consistent tree-object-preview format for both contexts
  const title = context === 'object-view' 
    ? (annotation.title || annotation.contents || `${annotation.type || 'Annotation'} on Page ${annotation.pageNum}`)
    : `${icon} ${annotation.type || 'Annotation'}`;
    
  return `
    <div class="tree-object-preview" data-object-id="${annotation.id}" data-object-type="annotations" data-page-num="${annotation.pageNum}">
      <div class="tree-object-thumbnail">${icon}</div>
      <div class="tree-object-info">
        <div class="tree-object-info-title">${title}</div>
        <div class="tree-object-info-details">${displayContent}</div>
      </div>
      <div class="tree-object-actions">
        <button class="tree-action-btn" data-action="navigate" title="Go to page">Go to Page</button>
      </div>
    </div>
  `;
}

function getObjectIcon(type) {
  const iconMap = {
    images: '🖼️',
    tables: '📊',
    fonts: '🔤',
    annotations: '📝',
    formFields: '📋',
    attachments: '📎',
  };
  return iconMap[type] || '📄';
}

function applyObjectScanResults(objectType, allResults) {
  console.log(
    `Applying ${Array.isArray(allResults) ? allResults.length : 'object'} scan results for ${objectType}`
  );

  if (objectType === 'bookmarks') {
    state.globalInspector.objects.bookmarks = allResults || [];
  } else if (objectType === 'javascript') {
    state.globalInspector.objects.javascript = allResults || [];
  } else if (objectType === 'metadata') {
    state.globalInspector.objects.metadata = allResults[0] || {};
  } else {
    // Handle Map-based objects (images, tables, fonts, annotations, formFields, attachments)
    const objectsMap = state.globalInspector.objects[objectType];
    if (objectsMap instanceof Map) {
      objectsMap.clear();
      if (Array.isArray(allResults)) {
        allResults.forEach((result) => {
          if (result.id) {
            objectsMap.set(result.id, result);
          }
        });
      }
    } else {
      console.warn(`Unknown object type structure: ${objectType}`);
    }
  }
}

// Action functions for object interactions
function copyImageToClipboard(imageId) {
  const image = state.globalInspector?.objects.images.get(imageId);
  if (image) {
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
  const table = state.globalInspector?.objects.tables.get(tableId);
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

function navigateToObject(objectId, objectType, pageNum) {
  console.log(`Navigating to ${objectType} ${objectId} on page ${pageNum}`);
  goToPage(pageNum);
}
