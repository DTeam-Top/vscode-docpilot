export const CONFIG = {
  TEXT_PROCESSING: {
    PROMPT_OVERHEAD_TOKENS: 500,
    CHUNK_SIZE_RATIO: 0.8,
    OVERLAP_RATIO: 0.1,
    DEFAULT_BATCH_SIZE: 3,
    MAX_BATCH_SIZE: 10,
    CHARS_PER_TOKEN: 3.5,
    TOKEN_OVERHEAD_RATIO: 0.1,
  },

  PDF_VIEWER: {
    MAX_CACHED_TEXT_LAYERS: 10,
    VISIBLE_PAGE_BUFFER: 2,
    MAX_TEXT_DIVS_PER_PAGE: 50000,
    PERFORMANCE_THRESHOLD_MS: 500,
    MIN_ZOOM: 0.25,
    MAX_ZOOM: 3.0,
    DEFAULT_ZOOM: 1.0,
  },

  TIMEOUTS: {
    TEXT_EXTRACTION_MS: 30000,
    MODEL_REQUEST_MS: 120000,
    PDF_LOAD_MS: 15000,
    HEARTBEAT_INTERVAL_MS: 2000,
  },

  ERROR_CODES: {
    PDF_LOAD_FAILED: 'PDF_LOAD_FAILED',
    TEXT_EXTRACTION_TIMEOUT: 'TEXT_EXTRACTION_TIMEOUT',
    TEXT_EXTRACTION_FAILED: 'TEXT_EXTRACTION_FAILED',
    MODEL_REQUEST_FAILED: 'MODEL_REQUEST_FAILED',
    CHUNK_PROCESSING_FAILED: 'CHUNK_PROCESSING_FAILED',
    INVALID_FILE_PATH: 'INVALID_FILE_PATH',
  },
} as const;

export const WEBVIEW_MESSAGES = {
  EXTRACT_ALL_TEXT: 'extractAllText',
  TEXT_EXTRACTED: 'textExtracted',
  TEXT_EXTRACTION_ERROR: 'textExtractionError',
  SUMMARIZE_REQUEST: 'summarizeRequest',
  SUMMARIZE_STARTED: 'summarizeStarted',
  SUMMARIZE_COMPLETED: 'summarizeCompleted',
  SUMMARIZE_ERROR: 'summarizeError',
  MINDMAP_REQUEST: 'mindmapRequest',
  MINDMAP_STARTED: 'mindmapStarted',
  MINDMAP_COMPLETED: 'mindmapCompleted',
  MINDMAP_ERROR: 'mindmapError',
  SEARCH_TEXT: 'searchText',
  SEARCH_NEXT: 'searchNext',
  SEARCH_PREVIOUS: 'searchPrevious',
  SEARCH_CLOSE: 'searchClose',
  EXTRACT_OBJECTS: 'extractObjects',
  EXTRACTION_PROGRESS: 'extractionProgress',
  EXTRACTION_COMPLETED: 'extractionCompleted',
  EXTRACTION_ERROR: 'extractionError',
  EXTRACTION_CANCELLED: 'extractionCancelled',
  BROWSE_SAVE_FOLDER: 'browseSaveFolder',
  FOLDER_SELECTED: 'folderSelected',
  GET_OBJECT_COUNTS: 'getObjectCounts',
  OBJECT_COUNTS_UPDATED: 'objectCountsUpdated',
  SCREENSHOT_SAVE_FILE: 'screenshotSaveFile',
  SCREENSHOT_COPY_SUCCESS: 'screenshotCopySuccess',
  SCREENSHOT_COPY_ERROR: 'screenshotCopyError',
  SCREENSHOT_FILE_SAVED: 'screenshotFileSaved',
  SCREENSHOT_SAVE_ERROR: 'screenshotSaveError',
} as const;

export const CHAT_COMMANDS = {
  SUMMARISE: 'summarise',
  MINDMAP: 'mindmap',
  CACHE_STATS: 'cache-stats',
  CLEAR_CACHE: 'clear-cache',
} as const;
