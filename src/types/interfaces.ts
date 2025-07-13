import * as vscode from 'vscode';

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
  readonly type: 'textExtracted' | 'textExtractionError' | 'extractAllText';
  readonly text?: string;
  readonly error?: string;
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
}

export interface RetryOptions {
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
  readonly shouldRetry?: (error: unknown) => boolean;
}
