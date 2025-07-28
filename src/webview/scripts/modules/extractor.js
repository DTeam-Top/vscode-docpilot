import { state } from './state.js';
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
} from './utils.js';

// Import constants for proper message types
const WEBVIEW_MESSAGES = {
  EXTRACT_OBJECTS: 'extractObjects',
  BROWSE_SAVE_FOLDER: 'browseSaveFolder',
  EXTRACTION_CANCELLED: 'extractionCancelled',
};

// ===== EXTRACTION MODAL STATE =====

export const extractionState = {
  selectedTypes: new Set(),
  saveFolder: '',
  fileName: 'extracted_objects',
  isExtracting: false,
  isCompleted: false,
  startTime: null,
  extractionId: null,
};

export function toggleSelectAll() {
  const selectAllBtn = document.querySelector('.select-all-btn');
  const allCheckboxes = document.querySelectorAll('.object-types-grid input[type="checkbox"]');

  const allSelected = Array.from(allCheckboxes).every((checkbox) => checkbox.checked);

  if (allSelected) {
    allCheckboxes.forEach((checkbox) => {
      checkbox.checked = false;
      const objectType = checkbox.id.replace('type-', '');
      extractionState.selectedTypes.delete(objectType);
    });
    selectAllBtn.textContent = 'Select All';
  } else {
    allCheckboxes.forEach((checkbox) => {
      checkbox.checked = true;
      const objectType = checkbox.id.replace('type-', '');
      extractionState.selectedTypes.add(objectType);
    });
    selectAllBtn.textContent = 'Deselect All';
  }

  updateExtractButton();
}

export function toggleObjectType(objectType) {
  const checkbox = document.getElementById(`type-${objectType}`);
  if (!checkbox) return;

  if (checkbox.checked) {
    extractionState.selectedTypes.add(objectType);
  } else {
    extractionState.selectedTypes.delete(objectType);
  }

  console.log('Selected types after toggle:', Array.from(extractionState.selectedTypes));
  updateExtractButton();
  updateSelectAllButton();
}

export function toggleObjectTypeByLabel(objectType) {
  const checkbox = document.getElementById(`type-${objectType}`);
  if (!checkbox) return;

  checkbox.checked = !checkbox.checked;
  toggleObjectType(objectType);
}

export function browseSaveFolder() {
  console.log('Browse button clicked - starting folder selection');
  console.log('Current extraction state:', extractionState);

  try {
    // Check if vscode API is available
    if (typeof state.vscode === 'undefined') {
      console.error('VSCode API not available!');
      return;
    }

    console.log('VSCode API available, sending message...');

    // Send message to extension to open folder picker
    const message = {
      type: WEBVIEW_MESSAGES.BROWSE_SAVE_FOLDER,
    };
    console.log('Sending message:', message);

    state.vscode.postMessage(message);

    console.log('Message sent to extension for folder browsing');
  } catch (error) {
    console.error('Error in browseSaveFolder:', error);
  }
}

export function startExtraction() {
  if (extractionState.selectedTypes.size === 0 || !extractionState.saveFolder) {
    console.warn('Cannot start extraction: missing selection or folder');
    return;
  }

  extractionState.isExtracting = true;
  extractionState.extractionId = Date.now().toString();
  extractionState.startTime = Date.now();

  // Show progress container
  const progressSection = document.querySelector('.extraction-progress');
  if (progressSection) {
    progressSection.classList.add('show');
  }

  // Update UI
  updateExtractButton();

  // Collect all object data first, then send to extension
  collectObjectDataAndExtract();
}

export function cancelExtraction() {
  extractionState.isExtracting = false;

  const progressSection = document.querySelector('.extraction-progress');
  if (progressSection) {
    progressSection.classList.remove('show');
  }

  state.vscode.postMessage({
    type: WEBVIEW_MESSAGES.EXTRACTION_CANCELLED,
  });
}

// Handle folder selection from extension
export function handleFolderSelected(folderPath) {
  console.log('Folder selected:', folderPath);

  extractionState.saveFolder = folderPath;
  const folderInput = document.getElementById('folderPath');
  if (folderInput) {
    folderInput.value = folderPath;
  }

  updateExtractButton();
}

// Reset only process/progress state (not selection state)
export function resetProcessState() {
  extractionState.isExtracting = false;
  extractionState.isCompleted = false;
  extractionState.extractionId = null;
  extractionState.startTime = null;

  // Reset progress UI
  const progressSection = document.querySelector('.extraction-progress');
  if (progressSection) {
    progressSection.classList.remove('show');
  }

  const progressBarFill = document.getElementById('progressBarFill');
  if (progressBarFill) {
    progressBarFill.style.width = '0%';
  }

  const progressStatus = document.getElementById('progressStatus');
  if (progressStatus) {
    progressStatus.textContent = 'Ready to extract...';
  }

  const progressDetails = document.getElementById('progressDetails');
  if (progressDetails) {
    progressDetails.innerHTML = '';
  }
}

// Initialize selection state (only called once when modal first opens)
export function initializeSelectionState() {
  // Only reset if no previous selections exist
  if (extractionState.selectedTypes.size === 0) {
    extractionState.selectedTypes.add('text');

    // Sync checkbox UI with state
    const textCheckbox = document.getElementById('type-text');
    if (textCheckbox) {
      textCheckbox.checked = true;
    }
  }

  // Sync all checkboxes with current state
  syncCheckboxesWithState();
}

// Sync DOM checkboxes with JavaScript state
function syncCheckboxesWithState() {
  const allCheckboxes = document.querySelectorAll('.object-types-grid input[type="checkbox"]');

  allCheckboxes.forEach((checkbox) => {
    const objectType = checkbox.id.replace('type-', '');
    checkbox.checked = extractionState.selectedTypes.has(objectType);
  });

  updateSelectAllButton();
}

export function updateExtractButton() {
  const extractBtn = document.getElementById('startExtractionBtn');
  if (!extractBtn) return;

  const hasSelection = extractionState.selectedTypes.size > 0;
  const hasFolder = extractionState.saveFolder.length > 0;

  // Handle completion state
  if (extractionState.isCompleted) {
    extractBtn.disabled = false;
    extractBtn.textContent = 'Close';
    extractBtn.dataset.action = 'close';
    return;
  }

  // Reset action to extraction if not completed
  extractBtn.dataset.action = 'extract';

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
}

function updateSelectAllButton() {
  const selectAllBtn = document.querySelector('.select-all-btn');
  const allCheckboxes = document.querySelectorAll('.object-types-grid input[type="checkbox"]');

  if (selectAllBtn && allCheckboxes.length > 0) {
    const allSelected = Array.from(allCheckboxes).every((checkbox) => checkbox.checked);
    selectAllBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
  }
}

// Collect object data and send extraction request
async function collectObjectDataAndExtract() {
  try {
    console.log('Collecting object data for extraction...');

    const selectedTypesArray = Array.from(extractionState.selectedTypes);
    const totalTypes = selectedTypesArray.length;

    // Initialize object data collection
    const objectData = {};

    // Update initial progress
    updateExtractionProgress({
      overall: { current: 0, total: totalTypes, percentage: 0, status: 'processing' },
      currentOperation: 'Preparing object collection...',
      filesCreated: [],
    });

    for (let i = 0; i < selectedTypesArray.length; i++) {
      const objectType = selectedTypesArray[i];
      console.log(`Collecting ${objectType} data...`);

      // Update progress for current type
      updateExtractionProgress({
        overall: {
          current: i,
          total: totalTypes,
          percentage: (i / totalTypes) * 100,
          status: 'processing',
        },
        currentOperation: `Collecting ${objectType} data from PDF...`,
        filesCreated: [],
      });

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

      // Update progress after collection
      updateExtractionProgress({
        overall: {
          current: i + 1,
          total: totalTypes,
          percentage: ((i + 1) / totalTypes) * 100,
          status: 'processing',
        },
        currentOperation: `${objectType} collected (${objectData[objectType].count} items)`,
        filesCreated: [],
      });

      // Add a small delay to make progress visible for fast operations
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log('Collected object data:', objectData);

    // Final progress update before sending to extension
    updateExtractionProgress({
      overall: { current: totalTypes, total: totalTypes, percentage: 100, status: 'processing' },
      currentOperation: 'Sending data to extension for extraction...',
      filesCreated: [],
    });

    // Send extraction request with collected data
    state.vscode.postMessage({
      type: WEBVIEW_MESSAGES.EXTRACT_OBJECTS,
      data: {
        selectedTypes: selectedTypesArray,
        saveFolder: extractionState.saveFolder,
        fileName: PDF_CONFIG.fileName || extractionState.fileName,
        extractionId: extractionState.extractionId,
        objectData: objectData, // Include collected object data
        webviewStartTime: extractionState.startTime, // Include webview start time for accurate timing
      },
    });
  } catch (error) {
    console.error('Failed to collect object data:', error);
    // Handle collection error - will be enhanced in Phase 4
  }
}

// Object data collection functions
async function collectTextData() {
  if (!state.pdfDoc) return { count: 0, data: '' };

  try {
    const totalPages = state.pdfDoc.numPages;
    let fullText = '';

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const page = await state.pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Combine text items with spaces
        const pageText = textContent.items
          .map((item) => item.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (pageText) {
          fullText += `\n\n=== PAGE ${pageNum} ===\n${pageText}`;
        }
      } catch (pageError) {
        console.warn(`Failed to extract text from page ${pageNum}:`, pageError);
      }
    }

    return {
      count: fullText.length,
      data: fullText.trim(),
    };
  } catch (error) {
    console.error('Failed to extract text:', error);
    return { count: 0, data: '' };
  }
}

async function collectImageData() {
  if (!state.pdfDoc) return { count: 0, data: [] };

  try {
    const images = [];
    const totalPages = state.pdfDoc.numPages;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const page = await state.pdfDoc.getPage(pageNum);
        const pageImages = await extractImagesFromPage(page, pageNum);
        images.push(...pageImages);
      } catch (pageError) {
        console.warn(`Failed to extract images from page ${pageNum}:`, pageError);
      }
    }

    return {
      count: images.length,
      data: images,
    };
  } catch (error) {
    console.error('Failed to extract images:', error);
    return { count: 0, data: [] };
  }
}

async function collectTableData() {
  if (!state.pdfDoc) return { count: 0, data: [] };

  try {
    const tables = [];
    const totalPages = state.pdfDoc.numPages;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const page = await state.pdfDoc.getPage(pageNum);
        const pageTables = await extractTablesFromPage(page, pageNum);
        tables.push(...pageTables);
      } catch (pageError) {
        console.warn(`Failed to extract tables from page ${pageNum}:`, pageError);
      }
    }

    return {
      count: tables.length,
      data: tables,
    };
  } catch (error) {
    console.error('Failed to extract tables:', error);
    return { count: 0, data: [] };
  }
}

async function collectFontData() {
  if (!state.pdfDoc) return { count: 0, data: [] };

  try {
    const fonts = [];
    const totalPages = state.pdfDoc.numPages;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const page = await state.pdfDoc.getPage(pageNum);
        const pageFonts = await extractFontsFromPage(page, pageNum);
        fonts.push(...pageFonts);
      } catch (pageError) {
        console.warn(`Failed to extract fonts from page ${pageNum}:`, pageError);
      }
    }

    return {
      count: fonts.length,
      data: fonts,
    };
  } catch (error) {
    console.error('Failed to extract fonts:', error);
    return { count: 0, data: [] };
  }
}

async function collectAnnotationData() {
  if (!state.pdfDoc) return { count: 0, data: [] };

  try {
    const annotations = [];
    const totalPages = state.pdfDoc.numPages;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const page = await state.pdfDoc.getPage(pageNum);
        const pageAnnotations = await extractAnnotationsFromPage(page, pageNum);
        annotations.push(...pageAnnotations);
      } catch (pageError) {
        console.warn(`Failed to extract annotations from page ${pageNum}:`, pageError);
      }
    }

    return {
      count: annotations.length,
      data: annotations,
    };
  } catch (error) {
    console.error('Failed to extract annotations:', error);
    return { count: 0, data: [] };
  }
}

async function collectFormFieldData() {
  if (!state.pdfDoc) return { count: 0, data: [] };

  try {
    const formFields = await extractFormFields(state.pdfDoc);
    return {
      count: formFields.length,
      data: formFields,
    };
  } catch (error) {
    console.error('Failed to extract form fields:', error);
    return { count: 0, data: [] };
  }
}

async function collectAttachmentData() {
  if (!state.pdfDoc) return { count: 0, data: [] };

  try {
    const attachments = await extractAttachments(state.pdfDoc);
    return {
      count: attachments.length,
      data: attachments,
    };
  } catch (error) {
    console.error('Failed to extract attachments:', error);
    return { count: 0, data: [] };
  }
}

async function collectBookmarkData() {
  if (!state.pdfDoc) return { count: 0, data: [] };

  try {
    const bookmarks = await extractBookmarks(state.pdfDoc);
    return {
      count: bookmarks.length,
      data: bookmarks,
    };
  } catch (error) {
    console.error('Failed to extract bookmarks:', error);
    return { count: 0, data: [] };
  }
}

async function collectJavaScriptData() {
  if (!state.pdfDoc) return { count: 0, data: [] };

  try {
    const javascript = await extractJavaScript(state.pdfDoc);
    return {
      count: javascript.length,
      data: javascript,
    };
  } catch (error) {
    console.error('Failed to extract JavaScript:', error);
    return { count: 0, data: [] };
  }
}

async function collectMetadataData() {
  if (!state.pdfDoc) return { count: 0, data: {} };

  try {
    const metadata = await extractMetadata(state.pdfDoc);
    const metadataCount = Object.keys(metadata).length;
    return {
      count: metadataCount,
      data: metadata,
    };
  } catch (error) {
    console.error('Failed to extract metadata:', error);
    return { count: 0, data: {} };
  }
}

// ===== EXTRACTION COMPLETION HANDLERS =====

// Handle extraction completion from extension
export function handleExtractionCompleted(result) {
  console.log('Extraction completed:', result);

  extractionState.isExtracting = false;
  extractionState.isCompleted = true;

  // Calculate totals
  const objectCount = result.totalObjects || 0;
  const fileCount = result.filesCreated ? result.filesCreated.length : 0;
  const totalProcessingTime = result.processingTime ? Math.round(result.processingTime / 1000) : 0;

  // Update progress to show completion
  const progressStatus = document.getElementById('progressStatus');
  if (progressStatus) {
    progressStatus.textContent = `✅ Extraction completed! ${objectCount} objects extracted to ${fileCount} files in ${totalProcessingTime}s`;
  }

  // Update extract button
  updateExtractButton();

  // Show extraction summary in the dialog
  showExtractionSummary(result);

  // Show appropriate completion message
  setTimeout(() => {
    if (objectCount === 0) {
      state.vscode.postMessage({
        type: 'showMessage',
        data: {
          type: 'warning',
          message: `No objects found for the selected types.\n\nThe PDF may not contain: ${Array.from(extractionState.selectedTypes).join(', ')}.\n\nTry selecting different object types or check if the PDF has the content you're looking for.`,
        },
      });
    } else {
      state.vscode.postMessage({
        type: 'showMessage',
        data: {
          type: 'info',
          message: `Extraction completed successfully!\n\n${objectCount} objects extracted to ${fileCount} files in ${totalProcessingTime}s.\n\nWould you like to open the extraction folder?`,
          actions: ['Open Folder', 'Close'],
          folderPath: result.folderPath || extractionState.saveFolder,
        },
      });
    }
  }, 500);
}

// Handle extraction error from extension
export function handleExtractionError(error) {
  console.error('Extraction error:', error);

  extractionState.isExtracting = false;
  extractionState.isCompleted = false;

  // Update progress to show error
  const progressStatus = document.getElementById('progressStatus');
  if (progressStatus) {
    progressStatus.textContent = `❌ Extraction failed: ${error}`;
  }

  // Update extract button
  updateExtractButton();

  // Show error message
  state.vscode.postMessage({
    type: 'showMessage',
    data: {
      type: 'error',
      message: `Extraction failed: ${error}`,
    },
  });
}

// Update extraction progress (progress bar and status)
export function updateExtractionProgress(progress) {
  console.log('Updating extraction progress:', progress);

  // Update progress bar
  const progressBarFill = document.getElementById('progressBarFill');
  if (progressBarFill && progress.overall) {
    progressBarFill.style.width = `${progress.overall.percentage || 0}%`;
  }

  // Update progress status
  const progressStatus = document.getElementById('progressStatus');
  if (progressStatus) {
    if (progress.currentOperation) {
      progressStatus.textContent = progress.currentOperation;
    } else if (progress.currentType) {
      progressStatus.textContent = `Extracting ${progress.currentType}...`;
    } else if (progress.overall) {
      progressStatus.textContent = `${Math.round(progress.overall.percentage || 0)}% complete`;
    }
  }
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
              typeResult.status === 'failed'
                ? '<span class="type-error">❌ Failed</span>'
                : typeResult.status === 'partial'
                  ? '<span class="type-warning">⚠️ Partial</span>'
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
        <strong>📁 Saved to:</strong> ${result.folderPath || extractionState.saveFolder}
      </div>
    </div>
  `;

  if (progressDetails) {
    progressDetails.innerHTML = summaryHtml;
  }
}
