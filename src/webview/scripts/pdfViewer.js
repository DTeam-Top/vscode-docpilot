/* global PDF_CONFIG */

import {
  initializeMessageListener,
  reportError,
  requestDownloadFallback,
  requestOpenInBrowser,
} from './modules/communication.js';
import { initializeLazyInspector, initializePDFInspector } from './modules/inspector.js';
import { initializeTextSelection, renderAllPages } from './modules/renderer.js';
import { initializeScreenshot } from './modules/screenshot.js';
import { state } from './modules/state.js';
import {
  fitToWidth,
  initializeEventListeners,
  setupScrollListener,
  updatePageInfo,
} from './modules/ui.js';
import { waitForPdfJs } from './modules/utils.js';

// Create global action registry for dynamic HTML error messages
const globalActions = {
  downloadPdfFallback: requestDownloadFallback,
  openInBrowser: requestOpenInBrowser,
};

// Expose minimal global handler for error message buttons only
window.handleGlobalAction = (actionName) => {
  const action = globalActions[actionName];
  if (action && typeof action === 'function') {
    action();
  } else {
    console.warn(`Unknown global action: ${actionName}`);
  }
};

/**
 * Main initialization function for the PDF viewer.
 * This function orchestrates the setup of the entire viewer.
 */
async function initializePdf() {
  await waitForPdfJs();

  const loadingTask = window.pdfjsLib.getDocument(PDF_CONFIG.pdfUri);

  loadingTask.onProgress = (progress) => {
    if (progress.total > 0) {
      const percent = (progress.loaded / progress.total) * 100;
      state.progressFill.style.width = `${percent}%`;
    }
  };

  try {
    const pdf = await loadingTask.promise;
    state.pdfDoc = pdf;
    state.pagesContainer.innerHTML = '<div class="pdf-pages" id="pdfPages"></div>';

    updatePageInfo();
    initializeTextSelection();
    initializePDFInspector();
    initializeScreenshot();
    initializeEventListeners();

    if (state.inspectorEnabled) {
      await initializeLazyInspector();
    }

    await renderAllPages();

    setupScrollListener();
    fitToWidth(); // Default view

    console.log('PDF loaded successfully.');

    // Signal that the viewer is ready
    state.vscode.postMessage({ type: 'viewerReady' });
  } catch (error) {
    console.error('Error loading PDF:', error);
    let errorMessage = 'Failed to load PDF. The file may be corrupted or inaccessible.';
    let isCorsError = false;

    if (error.message?.includes('CORS') || error.message?.includes('fetch')) {
      errorMessage = 'Failed to load PDF due to cross-origin restrictions.';
      isCorsError = true;
    } else if (error.message?.includes('InvalidPDFException')) {
      errorMessage = 'The file is not a valid PDF or is corrupted.';
    }

    let errorHtml = `<div class="error">${errorMessage}</div>`;
    if (isCorsError && PDF_CONFIG.isUrl) {
      errorHtml += `
              <div class="error-suggestions">
                <p>This PDF cannot be loaded directly due to server restrictions.</p>
                <button onclick="handleGlobalAction('downloadPdfFallback')" class="suggestion-btn">Download PDF</button>
                <button onclick="handleGlobalAction('openInBrowser')" class="suggestion-btn">Open in Browser</button>
              </div>`;
    }
    state.pagesContainer.innerHTML = errorHtml;
    reportError(error, isCorsError);
  }
}

// Initialize all parts of the application
initializeMessageListener();
window.addEventListener('DOMContentLoaded', initializePdf);
