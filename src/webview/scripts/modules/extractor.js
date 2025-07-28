import { state } from './state.js';

// ===== EXTRACTION MODAL STATE =====

const extractionState = {
  selectedTypes: new Set(),
  saveFolder: '',
  fileName: 'extracted_objects',
  isExtracting: false,
  startTime: null,
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
  state.vscode.postMessage({
    type: 'browseSaveFolder',
  });
}

export function startExtraction() {
  if (extractionState.selectedTypes.size === 0) return;

  extractionState.isExtracting = true;
  extractionState.startTime = Date.now();

  const progressSection = document.querySelector('.extraction-progress');
  if (progressSection) {
    progressSection.classList.remove('hidden');
  }

  state.vscode.postMessage({
    type: 'startExtraction',
    data: {
      selectedTypes: Array.from(extractionState.selectedTypes),
      saveFolder: extractionState.saveFolder,
      fileName: extractionState.fileName,
      webviewStartTime: extractionState.startTime,
    },
  });
}

export function cancelExtraction() {
  extractionState.isExtracting = false;

  const progressSection = document.querySelector('.extraction-progress');
  if (progressSection) {
    progressSection.classList.add('hidden');
  }

  state.vscode.postMessage({
    type: 'cancelExtraction',
  });
}

function updateExtractButton() {
  const extractBtn = document.getElementById('startExtractionBtn');
  if (extractBtn) {
    extractBtn.disabled = extractionState.selectedTypes.size === 0 || extractionState.isExtracting;
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
