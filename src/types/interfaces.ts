import type * as vscode from 'vscode';

// Core interfaces
export interface PdfViewerState {
  readonly pdfSource: string;
  readonly panel: vscode.WebviewPanel;
  readonly isUrl: boolean;
  readonly fileName: string;
}

export interface TextExtractionOptions {
  readonly timeout: number;
  readonly retryAttempts: number;
  readonly progressCallback?: (progress: number) => void;
}

export interface WebviewMessage {
  readonly type:
    | 'textExtracted'
    | 'textExtractionError'
    | 'extractAllText'
    | 'extractObjects'
    | 'extractionProgress'
    | 'extractionCompleted'
    | 'extractionError'
    | 'extractionCancelled'
    | 'browseSaveFolder'
    | 'folderSelected'
    | 'getObjectCounts'
    | 'objectCountsUpdated';
  readonly text?: string;
  readonly error?: string;
  readonly data?:
    | ObjectData
    | ObjectCounts
    | ObjectExtractionProgress
    | { folderPath: string }
    | { extractionId: string }
    | ExtractionSummary;
}

export interface ExtractionProgressStatus {
  current: number;
  total: number;
  percentage: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  message?: string;
}

export interface ObjectData {
  [key: string]: {
    count: number;
    data: string | Record<string, unknown> | unknown[];
  };
}

// Chunking interfaces
export interface ChunkingConfig {
  maxTokensPerChunk: number;
  overlapRatio: number;
  sentenceBoundary: boolean;
  paragraphBoundary: boolean;
}

export interface DocumentChunk {
  content: string;
  index: number;
  startPage: number;
  endPage: number;
  tokens: number;
}

export interface ProcessingResult {
  success: boolean;
  fallbackRequired: boolean;
  error?: string;
  summaryText?: string;
  mindmapText?: string;
}

// Summary interfaces
export interface SummaryResult {
  readonly success: boolean;
  readonly summary?: string;
  readonly metadata: SummaryMetadata;
}

export interface SummaryMetadata {
  readonly pageCount: number;
  readonly characterCount: number;
  readonly processingTime: number;
  readonly chunkCount?: number;
  readonly strategy: 'single-chunk' | 'multi-chunk' | 'fallback';
}

export interface ProcessDocumentOptions {
  readonly text: string;
  readonly fileName: string;
  readonly model: vscode.LanguageModelChat;
  readonly stream: vscode.ChatResponseStream;
  readonly cancellationToken: vscode.CancellationToken;
  readonly strategy?: ProcessingStrategy;
}

export type ProcessingStrategy = 'auto' | 'single-chunk' | 'semantic-chunking' | 'fallback';

// Error interfaces
export interface ErrorContext {
  readonly operation: string;
  readonly timestamp: number;
  readonly additionalInfo?: Record<string, unknown>;
}

// Token estimation interface
export interface TokenEstimationResult {
  readonly tokens: number;
  readonly characters: number;
  readonly estimationMethod: string;
  readonly confidence: number;
}

// Configuration interfaces
export interface TextProcessingConfig {
  readonly batchSize: number;
  readonly chunkSizeRatio: number;
  readonly overlapRatio: number;
  readonly maxRetries: number;
}

export interface PdfViewerConfig {
  readonly maxCachedTextLayers: number;
  readonly visiblePageBuffer: number;
  readonly maxTextDivsPerPage: number;
  readonly performanceThresholdMs: number;
}

export interface TimeoutConfig {
  readonly textExtractionMs: number;
  readonly modelRequestMs: number;
  readonly pdfLoadMs: number;
}

// Chat participant types
export interface ChatCommandResult {
  readonly metadata: Record<string, unknown>;
  readonly summaryText?: string;
  readonly mindmapText?: string;
}

export interface RetryOptions {
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
  readonly shouldRetry?: (error: unknown) => boolean;
}

// Enhanced object extraction interfaces
export interface ObjectExtractionRequest {
  readonly selectedTypes: ObjectType[];
  readonly saveFolder: string;
  readonly fileName: string;
}

export interface ObjectExtractionProgress {
  overall: ProgressInfo;
  types: Record<ObjectType, ProgressInfo>;
  currentType?: ObjectType;
  currentOperation?: string;
  filesCreated: string[];
  estimatedTimeRemaining?: number;
}

export interface ProgressInfo {
  current: number;
  total: number;
  percentage: number;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
  message?: string;
}

export type ProgressCallback = (progress: ProgressInfo) => void;

export interface ObjectExtractionResult {
  readonly success: boolean;
  readonly extractedTypes: ObjectType[];
  readonly filesCreated: string[];
  readonly folderPath: string;
  readonly totalObjects: number;
  readonly processingTime: number;
  readonly errors?: string[];
  readonly summary?: ExtractionSummary;
}

export interface ExtractionSummary {
  readonly documentName: string;
  readonly extractionDate: string;
  readonly selectedTypes: ObjectType[];
  readonly results: Record<ObjectType, ObjectTypeResult>;
  readonly totalFiles: number;
  readonly totalSize: number;
  readonly processingTime: number;
}

export interface ObjectTypeResult {
  readonly count: number;
  readonly files: string[];
  readonly size: number;
  readonly status: 'success' | 'partial' | 'failed';
  readonly errors?: string[];
}

export interface ObjectCounts {
  readonly text: number;
  readonly images: number;
  readonly tables: number;
  readonly fonts: number;
  readonly annotations: number;
  readonly formFields: number;
  readonly attachments: number;
  readonly bookmarks: number;
  readonly javascript: number;
  readonly metadata: number;
}

export type ObjectType =
  | 'text'
  | 'images'
  | 'tables'
  | 'fonts'
  | 'annotations'
  | 'formFields'
  | 'attachments'
  | 'bookmarks'
  | 'javascript'
  | 'metadata';

export interface FileExtractionConfig {
  readonly type: ObjectType;
  readonly extension: string;
  readonly mimeType?: string;
  readonly encoding?: string;
  readonly createSubfolder?: boolean;
}
