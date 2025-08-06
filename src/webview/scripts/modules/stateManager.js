/* global acquireVsCodeApi */

/**
 * Enhanced state manager for the PDF viewer with event-driven updates
 */
export class StateManager {
  constructor() {
    this.vscode = acquireVsCodeApi();
    this.listeners = new Map();
    this.state = {
      // PDF Document
      pdfDoc: null,
      scale: 1.0,
      currentPage: 1,
      totalPages: 0,
      
      // UI State
      textSelectionEnabled: false,
      debugMode: false,
      inspectorEnabled: false,
      searchMode: false,
      screenshotMode: false,
      
      // Performance tracking
      renderTimes: [],
      lastRenderTime: null,
      
      // Text layer management
      textLayerStates: new Map(),
      textLayerCache: new Map(),
      
      // Inspector data
      globalInspector: null,
      extractedImages: [],
      extractedTables: [],
      
      // UI Elements (lazy-loaded)
      elements: {},
    };
    
    // Constants
    this.CONSTANTS = {
      MAX_CACHED_TEXT_LAYERS: 10,
      VISIBLE_PAGE_BUFFER: 2,
      MAX_TEXT_DIVS_PER_PAGE: 50000,
      PERFORMANCE_THRESHOLD: 500,
    };
    
    console.log('StateManager initialized');
  }

  /**
   * Get a state value
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Set a state value and notify listeners
   */
  set(key, value) {
    const oldValue = this.state[key];
    this.state[key] = value;
    
    // Notify listeners if value changed
    if (oldValue !== value) {
      this.notify(key, value, oldValue);
    }
  }

  /**
   * Update multiple state values at once
   */
  update(updates) {
    const changes = [];
    
    for (const [key, value] of Object.entries(updates)) {
      const oldValue = this.state[key];
      if (oldValue !== value) {
        this.state[key] = value;
        changes.push({ key, value, oldValue });
      }
    }
    
    // Notify all listeners of changes
    changes.forEach(({ key, value, oldValue }) => {
      this.notify(key, value, oldValue);
    });
  }

  /**
   * Subscribe to state changes
   */
  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(callback);
    
    // Return unsubscribe function
    return () => {
      const keyListeners = this.listeners.get(key);
      if (keyListeners) {
        keyListeners.delete(callback);
        if (keyListeners.size === 0) {
          this.listeners.delete(key);
        }
      }
    };
  }

  /**
   * Notify listeners of state changes
   */
  notify(key, value, oldValue) {
    const keyListeners = this.listeners.get(key);
    if (keyListeners) {
      keyListeners.forEach(callback => {
        try {
          callback(value, oldValue, key);
        } catch (error) {
          console.error(`Error in state listener for ${key}:`, error);
        }
      });
    }
  }

  /**
   * Get or cache DOM elements
   */
  getElement(id) {
    if (!this.state.elements[id]) {
      this.state.elements[id] = document.getElementById(id);
    }
    return this.state.elements[id];
  }

  /**
   * Clear cached elements (useful when DOM changes)
   */
  clearElementCache() {
    this.state.elements = {};
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    const renderTimes = this.state.renderTimes;
    if (renderTimes.length === 0) return null;
    
    const avg = renderTimes.reduce((sum, time) => sum + time, 0) / renderTimes.length;
    const max = Math.max(...renderTimes);
    const min = Math.min(...renderTimes);
    
    return { avg, max, min, count: renderTimes.length };
  }

  /**
   * Add a render time measurement
   */
  addRenderTime(time) {
    this.state.renderTimes.push(time);
    this.state.lastRenderTime = time;
    
    // Keep only last 100 measurements
    if (this.state.renderTimes.length > 100) {
      this.state.renderTimes.shift();
    }
    
    // Notify performance listeners
    this.notify('renderTime', time, null);
  }

  /**
   * Reset state (useful for loading new documents)
   */
  reset() {
    const vscode = this.state.vscode;
    const elements = this.state.elements;
    
    this.state = {
      vscode,
      elements,
      pdfDoc: null,
      scale: 1.0,
      currentPage: 1,
      totalPages: 0,
      textSelectionEnabled: false,
      debugMode: false,
      inspectorEnabled: false,
      searchMode: false,
      screenshotMode: false,
      renderTimes: [],
      lastRenderTime: null,
      textLayerStates: new Map(),
      textLayerCache: new Map(),
      globalInspector: null,
      extractedImages: [],
      extractedTables: [],
    };
    
    this.notify('reset', true, false);
  }

  /**
   * Get the current state snapshot (for debugging)
   */
  getSnapshot() {
    return { ...this.state };
  }
}

// Create and export singleton instance
export const stateManager = new StateManager();

// For backward compatibility, export individual state values
export const state = {
  get vscode() { return stateManager.get('vscode'); },
  get pdfDoc() { return stateManager.get('pdfDoc'); },
  set pdfDoc(value) { stateManager.set('pdfDoc', value); },
  get scale() { return stateManager.get('scale'); },
  set scale(value) { stateManager.set('scale', value); },
  get currentPage() { return stateManager.get('currentPage'); },
  set currentPage(value) { stateManager.set('currentPage', value); },
  get textSelectionEnabled() { return stateManager.get('textSelectionEnabled'); },
  set textSelectionEnabled(value) { stateManager.set('textSelectionEnabled', value); },
  get debugMode() { return stateManager.get('debugMode'); },
  set debugMode(value) { stateManager.set('debugMode', value); },
  get inspectorEnabled() { return stateManager.get('inspectorEnabled'); },
  set inspectorEnabled(value) { stateManager.set('inspectorEnabled', value); },
  get textLayerStates() { return stateManager.get('textLayerStates'); },
  get textLayerCache() { return stateManager.get('textLayerCache'); },
  get renderTimes() { return stateManager.get('renderTimes'); },
  get globalInspector() { return stateManager.get('globalInspector'); },
  set globalInspector(value) { stateManager.set('globalInspector', value); },
  get extractedImages() { return stateManager.get('extractedImages'); },
  get extractedTables() { return stateManager.get('extractedTables'); },
  
  // Backward compatibility for commonly used elements
  get pagesContainer() { return stateManager.getElement('pdfContainer'); },
  get progressFill() { return stateManager.getElement('progressFill'); },
};

export const CONSTANTS = stateManager.CONSTANTS;