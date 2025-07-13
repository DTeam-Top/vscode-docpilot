import { CONFIG } from './constants';
import type { ErrorContext } from '../types/interfaces';

export abstract class DocPilotError extends Error {
  abstract readonly code: string;
  abstract readonly category: 'user' | 'system' | 'network';
  readonly timestamp: number;
  readonly context?: ErrorContext;

  constructor(message: string, context?: ErrorContext) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = Date.now();
    this.context = context;
  }
}

export class PdfLoadError extends DocPilotError {
  readonly code = CONFIG.ERROR_CODES.PDF_LOAD_FAILED;
  readonly category = 'user' as const;

  constructor(path: string, cause?: Error) {
    super(`Failed to load PDF: ${path}`, {
      operation: 'pdf-load',
      timestamp: Date.now(),
      additionalInfo: { path, originalError: cause?.message },
    });
    if (cause) {
      (this as any).cause = cause;
    }
  }
}

export class TextExtractionTimeoutError extends DocPilotError {
  readonly code = CONFIG.ERROR_CODES.TEXT_EXTRACTION_TIMEOUT;
  readonly category = 'system' as const;

  constructor(timeout: number) {
    super(`Text extraction timed out after ${timeout}ms`);
  }
}

export class TextExtractionError extends DocPilotError {
  readonly code = CONFIG.ERROR_CODES.TEXT_EXTRACTION_FAILED;
  readonly category = 'system' as const;

  constructor(reason: string, cause?: Error) {
    super(`Text extraction failed: ${reason}`);
    if (cause) {
      (this as any).cause = cause;
    }
  }
}

export class ModelRequestError extends DocPilotError {
  readonly code = CONFIG.ERROR_CODES.MODEL_REQUEST_FAILED;
  readonly category = 'network' as const;

  constructor(message: string, cause?: Error) {
    super(`AI model request failed: ${message}`);
    if (cause) {
      (this as any).cause = cause;
    }
  }
}

export class ChunkProcessingError extends DocPilotError {
  readonly code = CONFIG.ERROR_CODES.CHUNK_PROCESSING_FAILED;
  readonly category = 'system' as const;

  constructor(chunkIndex: number, cause?: Error) {
    super(`Failed to process chunk ${chunkIndex}`);
    if (cause) {
      (this as any).cause = cause;
    }
  }
}

export class InvalidFilePathError extends DocPilotError {
  readonly code = CONFIG.ERROR_CODES.INVALID_FILE_PATH;
  readonly category = 'user' as const;

  constructor(path: string) {
    super(`Invalid file path: ${path}`);
  }
}
