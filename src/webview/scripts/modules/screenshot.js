import { state } from './state.js';

// This module handles screenshot functionality with drag selection and save/clipboard options.

// Import constants for proper message types
const WEBVIEW_MESSAGES = {
  BROWSE_SAVE_FOLDER: 'browseSaveFolder',
  SCREENSHOT_SAVE_FILE: 'screenshotSaveFile',
};

const screenshotState = {
  isActive: false,
  isSelecting: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  selectionRect: null,
  capturedImageData: null,
  selectedFolder: null,
};

/**
 * Initialize screenshot functionality
 */
export function initializeScreenshot() {
  const overlay = document.getElementById('screenshotOverlay');
  const selectionRect = document.getElementById('selectionRectangle');
  const modal = document.getElementById('screenshotModalOverlay');
  const modalClose = document.getElementById('screenshotModalClose');
  const saveBtn = document.getElementById('saveToFileBtn');
  const clipboardBtn = document.getElementById('copyToClipboardBtn');
  const browseBtn = document.getElementById('screenshotBrowseBtn');

  if (!overlay || !selectionRect || !modal) {
    console.error('Screenshot elements not found in DOM');
    return;
  }

  screenshotState.selectionRect = selectionRect;

  // Overlay mouse events
  overlay.addEventListener('mousedown', handleMouseDown);
  overlay.addEventListener('mousemove', handleMouseMove);
  overlay.addEventListener('mouseup', handleMouseUp);
  overlay.addEventListener('click', handleOverlayClick);

  // Modal events
  modalClose.addEventListener('click', closeScreenshotModal);
  saveBtn.addEventListener('click', handleSaveToFile);
  clipboardBtn.addEventListener('click', handleCopyToClipboard);
  if (browseBtn) {
    browseBtn.addEventListener('click', browseSaveFolder);
  }

  // Escape key to cancel
  document.addEventListener('keydown', handleKeyDown);
}

/**
 * Start screenshot selection mode
 */
export function startScreenshot() {
  if (screenshotState.isActive) return;

  screenshotState.isActive = true;
  screenshotState.isSelecting = false;
  screenshotState.startX = 0;
  screenshotState.startY = 0;
  screenshotState.currentX = 0;
  screenshotState.currentY = 0;

  const overlay = document.getElementById('screenshotOverlay');
  overlay.classList.add('active');
  
  // Change button appearance to indicate active state
  const screenshotBtn = document.getElementById('screenshotBtn');
  screenshotBtn.style.backgroundColor = 'var(--vscode-button-background)';
  screenshotBtn.title = 'Click and drag to select area (ESC to cancel)';
  
  console.log('Screenshot mode activated');
}

/**
 * Stop screenshot selection mode
 */
export function stopScreenshot() {
  if (!screenshotState.isActive) return;

  screenshotState.isActive = false;
  screenshotState.isSelecting = false;
  
  const overlay = document.getElementById('screenshotOverlay');
  overlay.classList.remove('active');
  
  const selectionRect = screenshotState.selectionRect;
  if (selectionRect) {
    selectionRect.classList.remove('visible');
  }

  // Reset button appearance
  const screenshotBtn = document.getElementById('screenshotBtn');
  screenshotBtn.style.backgroundColor = '';
  screenshotBtn.title = 'Take Screenshot';
  
  console.log('Screenshot mode deactivated');
}

/**
 * Handle mouse down event to start selection
 */
function handleMouseDown(e) {
  if (!screenshotState.isActive) return;
  
  e.preventDefault();
  screenshotState.isSelecting = true;
  screenshotState.startX = e.clientX;
  screenshotState.startY = e.clientY;
  screenshotState.currentX = e.clientX;
  screenshotState.currentY = e.clientY;
  
  updateSelectionRectangle();
}

/**
 * Handle mouse move event to update selection
 */
function handleMouseMove(e) {
  if (!screenshotState.isActive || !screenshotState.isSelecting) return;
  
  e.preventDefault();
  screenshotState.currentX = e.clientX;
  screenshotState.currentY = e.clientY;
  
  updateSelectionRectangle();
}

/**
 * Handle mouse up event to complete selection
 */
function handleMouseUp(e) {
  if (!screenshotState.isActive || !screenshotState.isSelecting) return;
  
  e.preventDefault();
  screenshotState.isSelecting = false;
  
  const width = Math.abs(screenshotState.currentX - screenshotState.startX);
  const height = Math.abs(screenshotState.currentY - screenshotState.startY);
  
  // Minimum selection size validation
  if (width < 10 || height < 10) {
    console.log('Selection too small, canceling screenshot');
    stopScreenshot();
    return;
  }
  
  // Capture the selected area
  captureSelectedArea();
}

/**
 * Handle click on overlay (outside selection) to cancel
 */
function handleOverlayClick(e) {
  if (!screenshotState.isActive || screenshotState.isSelecting) return;
  
  // If clicking on overlay itself (not during selection), cancel
  if (e.target.id === 'screenshotOverlay') {
    stopScreenshot();
  }
}

/**
 * Handle keyboard events
 */
function handleKeyDown(e) {
  if (!screenshotState.isActive) return;
  
  if (e.key === 'Escape') {
    e.preventDefault();
    stopScreenshot();
  }
}

/**
 * Update the visual selection rectangle
 */
function updateSelectionRectangle() {
  const rect = screenshotState.selectionRect;
  if (!rect) return;
  
  const left = Math.min(screenshotState.startX, screenshotState.currentX);
  const top = Math.min(screenshotState.startY, screenshotState.currentY);
  const width = Math.abs(screenshotState.currentX - screenshotState.startX);
  const height = Math.abs(screenshotState.currentY - screenshotState.startY);
  
  rect.style.left = `${left}px`;
  rect.style.top = `${top}px`;
  rect.style.width = `${width}px`;
  rect.style.height = `${height}px`;
  rect.classList.add('visible');
}

/**
 * Capture the selected area using html2canvas or similar approach
 */
async function captureSelectedArea() {
  try {
    const left = Math.min(screenshotState.startX, screenshotState.currentX);
    const top = Math.min(screenshotState.startY, screenshotState.currentY);
    const width = Math.abs(screenshotState.currentX - screenshotState.startX);
    const height = Math.abs(screenshotState.currentY - screenshotState.startY);
    
    console.log(`Capturing area: ${left}, ${top}, ${width}x${height}`);
    
    // Create a canvas to capture the selected area
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;
    
    // Get the device pixel ratio for high-DPI displays
    const devicePixelRatio = window.devicePixelRatio || 1;
    const backingStoreRatio = ctx.webkitBackingStorePixelRatio ||
                             ctx.mozBackingStorePixelRatio ||
                             ctx.msBackingStorePixelRatio ||
                             ctx.oBackingStorePixelRatio ||
                             ctx.backingStorePixelRatio || 1;
    const ratio = devicePixelRatio / backingStoreRatio;
    
    // Scale canvas for high-DPI
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(ratio, ratio);
    
    // Use html2canvas to capture the main content area
    // Note: We'll need to import html2canvas or use a simpler approach
    await captureUsingDrawWindow(canvas, ctx, left, top, width, height);
    
    // Convert to blob
    canvas.toBlob((blob) => {
      if (blob) {
        screenshotState.capturedImageData = blob;
        showScreenshotModal();
      } else {
        console.error('Failed to create image blob');
        stopScreenshot();
      }
    }, 'image/png');
    
  } catch (error) {
    console.error('Error capturing screenshot:', error);
    stopScreenshot();
  }
}

/**
 * Capture the webview content within the selected bounds
 */
async function captureUsingDrawWindow(canvas, ctx, left, top, width, height) {
  try {
    // Get all visible elements within the selected area
    const mainContent = document.querySelector('.main-content');
    const pdfContainer = document.querySelector('.pdf-container');
    
    if (!mainContent || !pdfContainer) {
      throw new Error('PDF container not found');
    }
    
    // Set background to white
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    
    // Get container bounds for coordinate translation
    const containerRect = pdfContainer.getBoundingClientRect();
    
    // Find all PDF page canvases within the selection area
    const pageElements = document.querySelectorAll('.pdf-page');
    
    for (const pageElement of pageElements) {
      const pageRect = pageElement.getBoundingClientRect();
      const canvas = pageElement.querySelector('canvas');
      
      if (!canvas) continue;
      
      // Check if this page intersects with our selection
      const pageLeft = pageRect.left;
      const pageTop = pageRect.top;
      const pageRight = pageRect.right;
      const pageBottom = pageRect.bottom;
      
      const selectionLeft = left;
      const selectionTop = top;
      const selectionRight = left + width;
      const selectionBottom = top + height;
      
      // Calculate intersection
      const intersectionLeft = Math.max(pageLeft, selectionLeft);
      const intersectionTop = Math.max(pageTop, selectionTop);
      const intersectionRight = Math.min(pageRight, selectionRight);
      const intersectionBottom = Math.min(pageBottom, selectionBottom);
      
      if (intersectionLeft < intersectionRight && intersectionTop < intersectionBottom) {
        // This page intersects with our selection
        const srcX = Math.max(0, selectionLeft - pageLeft);
        const srcY = Math.max(0, selectionTop - pageTop);
        const srcWidth = Math.min(canvas.width, intersectionRight - intersectionLeft);
        const srcHeight = Math.min(canvas.height, intersectionBottom - intersectionTop);
        
        const destX = intersectionLeft - selectionLeft;
        const destY = intersectionTop - selectionTop;
        
        // Draw the intersecting portion of this page canvas
        ctx.drawImage(
          canvas,
          srcX, srcY, srcWidth, srcHeight,
          destX, destY, srcWidth, srcHeight
        );
      }
    }
    
    console.log(`Captured ${pageElements.length} pages in selected area`);
    
  } catch (error) {
    console.error('Error in screenshot capture:', error);
    
    // Fallback: create a placeholder image
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, width, height);
    
    ctx.fillStyle = '#666';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Screenshot Captured', width / 2, height / 2 - 20);
    
    ctx.font = '12px Arial';
    ctx.fillText(`Area: ${width} × ${height}`, width / 2, height / 2);
    
    const timestamp = new Date().toLocaleString();
    ctx.fillText(timestamp, width / 2, height / 2 + 20);
  }
}

/**
 * Show the screenshot modal with save/clipboard options
 */
function showScreenshotModal() {
  stopScreenshot(); // Hide overlay
  
  const modal = document.getElementById('screenshotModalOverlay');
  modal.style.display = 'flex';
}

/**
 * Close the screenshot modal
 */
function closeScreenshotModal() {
  const modal = document.getElementById('screenshotModalOverlay');
  modal.style.display = 'none';
  
  // Reset modal state
  const folderSection = document.getElementById('folderSection');
  const folderInput = document.getElementById('screenshotFolderPath');
  const saveBtn = document.getElementById('saveToFileBtn');
  
  if (folderSection) {
    folderSection.style.display = 'none';
  }
  
  if (folderInput) {
    folderInput.value = '';
  }
  
  if (saveBtn) {
    saveBtn.textContent = '📁 Save to File';
    saveBtn.disabled = false;
  }
  
  // Reset state
  screenshotState.capturedImageData = null;
  screenshotState.selectedFolder = null;
}

/**
 * Handle save to file option
 */
function handleSaveToFile() {
  if (!screenshotState.capturedImageData) {
    console.error('No captured image data available');
    return;
  }
  
  // Check if folder is already selected
  if (screenshotState.selectedFolder) {
    // Folder already selected, proceed with save immediately
    proceedWithSave();
    return;
  }
  
  // Show folder selection section
  const folderSection = document.getElementById('folderSection');
  const saveBtn = document.getElementById('saveToFileBtn');
  
  if (folderSection) {
    folderSection.style.display = 'block';
    saveBtn.textContent = '💾 Save Screenshot';
    saveBtn.disabled = true; // Disabled until folder is selected
  }
}

/**
 * Browse for save folder
 */
function browseSaveFolder() {
  console.log('Browse save folder clicked');
  
  if (!state.vscode) {
    console.error('VSCode API not available');
    return;
  }

  console.log('Sending BROWSE_SAVE_FOLDER message to extension...');
  
  // Send message to extension to open folder picker
  state.vscode.postMessage({
    type: WEBVIEW_MESSAGES.BROWSE_SAVE_FOLDER
  });
  
  console.log('BROWSE_SAVE_FOLDER message sent');
}

/**
 * Handle folder selection response
 */
export function handleScreenshotFolderSelected(folderPath) {
  console.log('Screenshot folder selected:', folderPath);
  
  screenshotState.selectedFolder = folderPath;
  
  // Update UI
  const folderInput = document.getElementById('screenshotFolderPath');
  const saveBtn = document.getElementById('saveToFileBtn');
  
  if (folderInput) {
    folderInput.value = folderPath;
  }
  
  if (saveBtn) {
    saveBtn.disabled = false;
  }
}

/**
 * Proceed with saving after folder is selected
 */
function proceedWithSave() {
  if (!screenshotState.capturedImageData || !screenshotState.selectedFolder) {
    console.error('Missing image data or folder selection');
    return;
  }
  
  // Generate filename: screenshot-page-{pageNum}-{YYYYMMDD}-{HHMMSS}.png
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
                  (now.getMonth() + 1).toString().padStart(2, '0') +
                  now.getDate().toString().padStart(2, '0');
  const timeStr = now.getHours().toString().padStart(2, '0') +
                  now.getMinutes().toString().padStart(2, '0') +
                  now.getSeconds().toString().padStart(2, '0');
  
  const currentPage = state.currentPage || 1;
  const fileName = `screenshot-page-${currentPage}-${dateStr}-${timeStr}.png`;
  
  // Convert blob to data URL for sending to extension
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    
    // Send message to extension to save file
    state.vscode.postMessage({
      type: WEBVIEW_MESSAGES.SCREENSHOT_SAVE_FILE,
      data: {
        fileName: fileName,
        imageData: dataUrl,
        currentPage: currentPage,
        saveFolder: screenshotState.selectedFolder
      }
    });
  };
  reader.readAsDataURL(screenshotState.capturedImageData);
  
  // Don't close modal here - wait for save completion message from extension
}

/**
 * Handle copy to clipboard option
 */
async function handleCopyToClipboard() {
  if (!screenshotState.capturedImageData) {
    console.error('No captured image data available');
    return;
  }
  
  try {
    // Use the Clipboard API to copy the image
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': screenshotState.capturedImageData
      })
    ]);
    
    // Show success message
    state.vscode.postMessage({
      type: 'SCREENSHOT_COPY_SUCCESS',
      data: { message: 'Screenshot copied to clipboard!' }
    });
    
    console.log('Screenshot copied to clipboard');
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    
    // Fallback: show error message
    state.vscode.postMessage({
      type: 'SCREENSHOT_COPY_ERROR',
      data: { error: 'Failed to copy screenshot to clipboard' }
    });
  }
  
  closeScreenshotModal();
}

/**
 * Handle screenshot save completion
 */
export function handleScreenshotSaveCompleted(data) {
  console.log('Screenshot saved successfully:', data.filePath);
  closeScreenshotModal();
}

/**
 * Handle screenshot save error
 */
export function handleScreenshotSaveError(data) {
  console.error('Screenshot save failed:', data.error);
  // Don't close modal on error, let user try again
  alert(`Failed to save screenshot: ${data.error}`);
}

/**
 * Toggle screenshot mode
 */
export function toggleScreenshot() {
  if (screenshotState.isActive) {
    stopScreenshot();
  } else {
    startScreenshot();
  }
}

// Expose functions to window for HTML event handlers
window.toggleScreenshot = toggleScreenshot;
window.startScreenshot = startScreenshot;
window.stopScreenshot = stopScreenshot;