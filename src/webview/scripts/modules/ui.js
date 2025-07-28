import { requestSummary } from './communication.js';
import {
  browseSaveFolder,
  cancelExtraction,
  extractionState,
  initializeSelectionState,
  resetProcessState,
  startExtraction,
  toggleObjectType,
  toggleObjectTypeByLabel,
  toggleSelectAll,
  updateExtractButton,
} from './extractor.js';
import { toggleInspector } from './inspector.js';
import { renderVisibleTextLayers, rerenderAllPages, toggleTextSelection } from './renderer.js';
import { closeSearch, searchNext, searchPrevious, toggleSearch } from './search.js';
import { state } from './state.js';

// This module handles UI interactions, event listeners, and DOM updates.

export function setupScrollListener() {
  const container = state.pagesContainer;
  let scrollTimeout;

  container.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      updateCurrentPage();
      if (state.textSelectionEnabled) {
        renderVisibleTextLayers();
      }
    }, 150);
  });
}

export function updateCurrentPage() {
  const containerRect = state.pagesContainer.getBoundingClientRect();
  const pages = document.querySelectorAll('.pdf-page');

  for (let i = 0; i < pages.length; i++) {
    const pageRect = pages[i].getBoundingClientRect();
    if (pageRect.top <= containerRect.height / 2 && pageRect.bottom >= containerRect.height / 2) {
      state.currentPage = i + 1;
      updatePageInfo();
      updateNavigationButtons();
      break;
    }
  }
}

export function setZoom(newScale, immediate = false) {
  state.scale = parseFloat(newScale);
  document.getElementById('zoomSlider').value = state.scale;
  updateZoomInfo();

  clearTimeout(state.zoomTimeout);
  if (immediate) {
    rerenderAllPages();
  } else {
    state.zoomTimeout = setTimeout(() => {
      rerenderAllPages();
    }, 150);
  }
}

// --- UI Update Functions ---
export function updatePageInfo() {
  if (state.pdfDoc) {
    document.getElementById('pageInfo').textContent =
      `Page ${state.currentPage} of ${state.pdfDoc.numPages}`;
  }
}

export function updateZoomInfo() {
  document.getElementById('zoomLevel').textContent = `${Math.round(state.scale * 100)}%`;
}

export function updateNavigationButtons() {
  if (!state.pdfDoc) return;
  document.getElementById('firstPageBtn').disabled = state.currentPage <= 1;
  document.getElementById('prevPageBtn').disabled = state.currentPage <= 1;
  document.getElementById('nextPageBtn').disabled = state.currentPage >= state.pdfDoc.numPages;
  document.getElementById('lastPageBtn').disabled = state.currentPage >= state.pdfDoc.numPages;
}

// --- Event Handlers ---
export function goToPage(pageNum) {
  const pageElement = document.getElementById(`page-${pageNum}`);
  if (pageElement) {
    pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

export function zoomIn() {
  setZoom(Math.min(state.scale + 0.25, 3), true);
}
export function zoomOut() {
  setZoom(Math.max(state.scale - 0.25, 0.25), true);
}
export function fitToWidth() {
  const containerWidth = state.pagesContainer.clientWidth - 40;
  const firstCanvas = document.querySelector('.pdf-page canvas');
  if (firstCanvas) {
    setZoom(containerWidth / (firstCanvas.width / state.scale), true);
  }
}
export function fitToPage() {
  const containerHeight = state.pagesContainer.clientHeight - 40;
  const containerWidth = state.pagesContainer.clientWidth - 40;
  const firstCanvas = document.querySelector('.pdf-page canvas');
  if (firstCanvas) {
    const scaleX = containerWidth / (firstCanvas.width / state.scale);
    const scaleY = containerHeight / (firstCanvas.height / state.scale);
    setZoom(Math.min(scaleX, scaleY), true);
  }
}

export function goToFirstPage() {
  goToPage(1);
}
export function goToPreviousPage() {
  if (state.currentPage > 1) goToPage(state.currentPage - 1);
}
export function goToNextPage() {
  if (state.currentPage < state.pdfDoc.numPages) goToPage(state.currentPage + 1);
}
export function goToLastPage() {
  goToPage(state.pdfDoc.numPages);
}

export function toggleDebug() {
  state.debugMode = !state.debugMode;
  const icon = document.getElementById('debugIcon');
  const baseUrl = icon.src.substring(0, icon.src.lastIndexOf('/') + 1);
  icon.src = state.debugMode ? `${baseUrl}bug-play.svg` : `${baseUrl}bug-off.svg`;
  document.getElementById('debugBtn').style.backgroundColor = state.debugMode
    ? '#ff6b6b'
    : 'var(--vscode-button-background)';

  state.textLayerStates.forEach((textState) => {
    if (textState.container && textState.rendered) {
      const spans = textState.container.querySelectorAll('span');
      spans.forEach((span) => {
        span.style.backgroundColor = state.debugMode ? 'rgba(255, 0, 0, 0.1)' : '';
        span.style.border = state.debugMode ? '1px solid red' : '';
      });
    }
  });
}

export async function summarizeDocument() {
  const summarizeBtn = document.getElementById('summarizeBtn');
  if (!state.pdfDoc) return;
  summarizeBtn.disabled = true;
  summarizeBtn.style.opacity = '0.6';
  summarizeBtn.title = 'Summarizing...';
  requestSummary();
}

export function showExtractionModal() {
  const overlay = document.getElementById('extractionOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    
    // Reset only process state (progress, completion status)
    resetProcessState();
    
    // Initialize selection state (preserves previous selections)
    initializeSelectionState();
    
    // Update extract button state
    updateExtractButton();
  }
}

export function closeExtractionModal() {
  const overlay = document.getElementById('extractionOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }

  // Cancel any ongoing extraction and reset process state
  if (extractionState.extractionId && extractionState.isExtracting) {
    cancelExtraction();
  }
  resetProcessState();
}

export function initializeEventListeners() {
  // Toolbar buttons
  document.getElementById('zoomOutBtn').addEventListener('click', zoomOut);
  document.getElementById('zoomInBtn').addEventListener('click', zoomIn);
  document.getElementById('zoomSlider').addEventListener('input', (e) => setZoom(e.target.value));
  document.getElementById('fitWidthBtn').addEventListener('click', fitToWidth);
  document.getElementById('fitPageBtn').addEventListener('click', fitToPage);
  document.getElementById('firstPageBtn').addEventListener('click', goToFirstPage);
  document.getElementById('prevPageBtn').addEventListener('click', goToPreviousPage);
  document.getElementById('nextPageBtn').addEventListener('click', goToNextPage);
  document.getElementById('lastPageBtn').addEventListener('click', goToLastPage);
  document.getElementById('textSelectionBtn').addEventListener('click', toggleTextSelection);
  document.getElementById('inspectorBtn').addEventListener('click', toggleInspector);
  document.getElementById('debugBtn').addEventListener('click', toggleDebug);
  document.getElementById('summarizeBtn').addEventListener('click', summarizeDocument);
  document.getElementById('exportBtn').addEventListener('click', showExtractionModal);
  document.getElementById('searchBtn').addEventListener('click', toggleSearch);

  // Search overlay
  document.getElementById('searchPrevBtn').addEventListener('click', searchPrevious);
  document.getElementById('searchNextBtn').addEventListener('click', searchNext);
  document.getElementById('searchCloseBtn').addEventListener('click', closeSearch);

  // Extraction modal
  document.querySelector('.extraction-close').addEventListener('click', closeExtractionModal);
  document.querySelector('.select-all-btn').addEventListener('click', toggleSelectAll);
  document.querySelectorAll('.object-type-item input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => toggleObjectType(checkbox.id.replace('type-', '')));
  });
  document.querySelectorAll('.object-type-label').forEach((label) => {
    label.addEventListener('click', () =>
      toggleObjectTypeByLabel(
        label.previousElementSibling.previousElementSibling.id.replace('type-', '')
      )
    );
  });
  document.querySelector('.folder-browse-btn').addEventListener('click', browseSaveFolder);
  document.getElementById('startExtractionBtn').addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    if (action === 'close') {
      closeExtractionModal();
    } else {
      startExtraction();
    }
  });
  document.getElementById('cancelExtractionBtn').addEventListener('click', closeExtractionModal);
  document.querySelector('.progress-cancel').addEventListener('click', cancelExtraction);

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
        setZoom(1, true);
      } else if (e.key === 'f' || e.key === 'F') {
        if (e.target.tagName !== 'INPUT') {
          e.preventDefault();
          toggleSearch();
        }
      }
    } else {
      switch (e.key) {
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          goToPreviousPage();
          break;
        case 'ArrowRight':
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

  // Mouse wheel zoom
  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else zoomOut();
    }
  });
}
