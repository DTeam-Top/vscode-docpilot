/* global acquireVsCodeApi */

// This module centralizes the shared state of the PDF viewer.

// Make vscode API available first
const vscode = acquireVsCodeApi();
console.log('VSCode API initialized');

export const state = {
  vscode,
  pdfDoc: null,
  scale: 1.0,
  currentPage: 1,
  zoomTimeout: null,

  // UI Elements
  pagesContainer: document.getElementById('pdfContainer'),
  progressFill: document.getElementById('progressFill'),

  // Text layer management
  textSelectionEnabled: false,
  debugMode: false,
  textLayerStates: new Map(), // pageNum -> { textLayer, container, rendered, page }
  textLayerCache: new Map(), // LRU cache for text layers

  // Performance
  renderTimes: [],

  // Inspector
  inspectorEnabled: false,
  globalInspector: null,
  // These are legacy and should be removed after full refactor
  extractedImages: [],
  extractedTables: [],
};

// Constants can also be managed here if they are not hardcoded in functions
export const CONSTANTS = {
  MAX_CACHED_TEXT_LAYERS: 10,
  VISIBLE_PAGE_BUFFER: 2,
  MAX_TEXT_DIVS_PER_PAGE: 50000,
  PERFORMANCE_THRESHOLD: 500, // 500ms
};
