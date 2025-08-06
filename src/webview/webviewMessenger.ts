import type * as vscode from 'vscode';
import type { ObjectCounts, ObjectData, ObjectType } from '../types/interfaces';
import { WEBVIEW_MESSAGES } from '../utils/constants';
import { Logger } from '../utils/logger';

// Message types for type safety
export interface WebviewMessage {
  type: string;
  data?: any;
  error?: string;
  fileName?: string;
  isUrl?: boolean;
  pdfUri?: string;
}

export type MessageHandler<T = any> = (data: T, panel: vscode.WebviewPanel) => Promise<void> | void;

export interface MessageHandlers {
  [key: string]: MessageHandler;
}

// Request-response types for type safety
export interface SummarizeRequest {
  type: typeof WEBVIEW_MESSAGES.SUMMARIZE_REQUEST;
}

export interface MindmapRequest {
  type: typeof WEBVIEW_MESSAGES.MINDMAP_REQUEST;
}

export interface ExtractObjectsRequest {
  type: typeof WEBVIEW_MESSAGES.EXTRACT_OBJECTS;
  data: {
    selectedTypes: ObjectType[];
    saveFolder: string;
    fileName: string;
    objectData?: ObjectData;
    webviewStartTime?: number;
  };
}

export interface ScreenshotSaveRequest {
  type: typeof WEBVIEW_MESSAGES.SCREENSHOT_SAVE_FILE;
  data: {
    fileName: string;
    imageData: string;
    currentPage?: number;
    saveFolder?: string;
  };
}

export interface BrowseFolderRequest {
  type: typeof WEBVIEW_MESSAGES.BROWSE_SAVE_FOLDER;
}

export interface GetObjectCountsRequest {
  type: typeof WEBVIEW_MESSAGES.GET_OBJECT_COUNTS;
}

export interface ShowMessageRequest {
  type: 'showMessage';
  data: {
    type: 'info' | 'warning' | 'error';
    message: string;
    actions?: string[];
    folderPath?: string;
  };
}

export interface OpenFolderRequest {
  type: 'openFolder';
  data: {
    folderPath: string;
  };
}

// Response types
export interface SummarizeResponse {
  type:
    | typeof WEBVIEW_MESSAGES.SUMMARIZE_STARTED
    | typeof WEBVIEW_MESSAGES.SUMMARIZE_COMPLETED
    | typeof WEBVIEW_MESSAGES.SUMMARIZE_ERROR;
  error?: string;
}

export interface MindmapResponse {
  type:
    | typeof WEBVIEW_MESSAGES.MINDMAP_STARTED
    | typeof WEBVIEW_MESSAGES.MINDMAP_COMPLETED
    | typeof WEBVIEW_MESSAGES.MINDMAP_ERROR;
  error?: string;
}

export interface FolderSelectedResponse {
  type: typeof WEBVIEW_MESSAGES.FOLDER_SELECTED;
  data: {
    folderPath: string;
  };
}

export interface ObjectCountsResponse {
  type: typeof WEBVIEW_MESSAGES.OBJECT_COUNTS_UPDATED;
  data: ObjectCounts;
}

export interface ExtractionResponse {
  type: typeof WEBVIEW_MESSAGES.EXTRACTION_COMPLETED | typeof WEBVIEW_MESSAGES.EXTRACTION_ERROR;
  data?: any;
  error?: string;
}

export interface ScreenshotResponse {
  type:
    | typeof WEBVIEW_MESSAGES.SCREENSHOT_FILE_SAVED
    | typeof WEBVIEW_MESSAGES.SCREENSHOT_SAVE_ERROR;
  data?: { filePath?: string; error?: string };
}

/**
 * Type-safe messenger for webview communication that abstracts postMessage/onDidReceiveMessage
 */
export class WebviewMessenger {
  private static readonly logger = Logger.getInstance();
  private readonly handlers = new Map<string, MessageHandler>();
  private readonly panel: vscode.WebviewPanel;

  constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.setupMessageHandling();
  }

  /**
   * Register a handler for a specific message type
   */
  public on<T = any>(messageType: string, handler: MessageHandler<T>): void {
    this.handlers.set(messageType, handler as MessageHandler);
    WebviewMessenger.logger.debug(`Registered handler for message type: ${messageType}`);
  }

  /**
   * Send a message to the webview
   */
  public async send(message: WebviewMessage): Promise<void> {
    try {
      await this.panel.webview.postMessage(message);
      WebviewMessenger.logger.debug('Sent message to webview:', message.type);
    } catch (error) {
      WebviewMessenger.logger.error('Failed to send message to webview', error);
      throw error;
    }
  }

  /**
   * Send a response message to the webview
   */
  public async sendResponse(type: string, data?: any, error?: string): Promise<void> {
    const message: WebviewMessage = { type };
    if (data !== undefined) message.data = data;
    if (error !== undefined) message.error = error;

    await this.send(message);
  }

  /**
   * Send an error response to the webview
   */
  public async sendError(type: string, error: string | Error): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error;
    await this.sendResponse(type, undefined, errorMessage);
  }

  /**
   * Send a success response to the webview
   */
  public async sendSuccess(type: string, data?: any): Promise<void> {
    await this.sendResponse(type, data);
  }

  /**
   * Remove a message handler
   */
  public off(messageType: string): void {
    this.handlers.delete(messageType);
    WebviewMessenger.logger.debug(`Removed handler for message type: ${messageType}`);
  }

  /**
   * Remove all message handlers
   */
  public clear(): void {
    this.handlers.clear();
    WebviewMessenger.logger.debug('Cleared all message handlers');
  }

  /**
   * Get the number of registered handlers
   */
  public get handlerCount(): number {
    return this.handlers.size;
  }

  /**
   * Check if a handler is registered for a message type
   */
  public hasHandler(messageType: string): boolean {
    return this.handlers.has(messageType);
  }

  /**
   * Setup message handling from webview
   */
  private setupMessageHandling(): void {
    this.panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      WebviewMessenger.logger.debug('Received webview message:', message.type);
      WebviewMessenger.logger.debug('Message details:', JSON.stringify(message, null, 2));

      const handler = this.handlers.get(message.type);
      if (handler) {
        try {
          await handler(message.data, this.panel);
        } catch (error) {
          WebviewMessenger.logger.error(`Error handling message ${message.type}:`, error);

          // Send error response back to webview if it's a request type
          if (this.isRequestMessage(message.type)) {
            const errorType = this.getErrorResponseType(message.type);
            if (errorType) {
              await this.sendError(
                errorType,
                error instanceof Error ? error.message : 'Unknown error'
              );
            }
          }
        }
      } else {
        WebviewMessenger.logger.debug('Unhandled webview message:', message.type);
      }
    });
  }

  /**
   * Check if a message type is a request that expects a response
   */
  private isRequestMessage(messageType: string): boolean {
    const requestTypes = [
      WEBVIEW_MESSAGES.SUMMARIZE_REQUEST,
      WEBVIEW_MESSAGES.MINDMAP_REQUEST,
      WEBVIEW_MESSAGES.EXTRACT_OBJECTS,
      WEBVIEW_MESSAGES.BROWSE_SAVE_FOLDER,
      WEBVIEW_MESSAGES.GET_OBJECT_COUNTS,
      WEBVIEW_MESSAGES.SCREENSHOT_SAVE_FILE,
    ];
    return requestTypes.includes(messageType as any);
  }

  /**
   * Get the corresponding error response type for a request message type
   */
  private getErrorResponseType(messageType: string): string | null {
    const errorMappings: Record<string, string> = {
      [WEBVIEW_MESSAGES.SUMMARIZE_REQUEST]: WEBVIEW_MESSAGES.SUMMARIZE_ERROR,
      [WEBVIEW_MESSAGES.MINDMAP_REQUEST]: WEBVIEW_MESSAGES.MINDMAP_ERROR,
      [WEBVIEW_MESSAGES.EXTRACT_OBJECTS]: WEBVIEW_MESSAGES.EXTRACTION_ERROR,
      [WEBVIEW_MESSAGES.SCREENSHOT_SAVE_FILE]: WEBVIEW_MESSAGES.SCREENSHOT_SAVE_ERROR,
    };
    return errorMappings[messageType] || null;
  }
}
