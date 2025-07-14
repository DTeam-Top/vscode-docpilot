import type * as vscode from 'vscode';
import type { TextExtractionOptions, WebviewMessage } from '../types/interfaces';
import { CONFIG, WEBVIEW_MESSAGES } from '../utils/constants';
import { TextExtractionError, TextExtractionTimeoutError } from '../utils/errors';
import { Logger } from '../utils/logger';

// biome-ignore lint/complexity/noStaticOnlyClass: This follows existing extension patterns
export class TextExtractor {
  private static readonly logger = Logger.getInstance();

  static async extractText(
    panel: vscode.WebviewPanel,
    pdfPath: string,
    options: TextExtractionOptions = {
      timeout: CONFIG.TIMEOUTS.TEXT_EXTRACTION_MS,
      retryAttempts: 1,
    }
  ): Promise<string> {
    const { timeout, progressCallback } = options;

    TextExtractor.logger.info(`Starting text extraction for: ${pdfPath}`);

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new TextExtractionTimeoutError(timeout));
      }, timeout);

      // Optional progress tracking with heartbeat
      let heartbeatInterval: NodeJS.Timeout | undefined;
      if (progressCallback) {
        heartbeatInterval = setInterval(() => {
          progressCallback(0.5); // We don't have real progress, so show 50%
        }, CONFIG.TIMEOUTS.HEARTBEAT_INTERVAL_MS);
      }

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
        panel.webview.onDidReceiveMessage((disposable) => disposable.dispose());
      };

      // Set up message listener
      const _messageDisposable = panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        TextExtractor.logger.debug('Received webview message', message);

        switch (message.type) {
          case WEBVIEW_MESSAGES.TEXT_EXTRACTED:
            cleanup();
            if (message.text) {
              TextExtractor.logger.info(
                `Text extraction completed: ${message.text.length} characters`
              );
              progressCallback?.(1.0);
              resolve(message.text);
            } else {
              reject(new TextExtractionError('No text content received'));
            }
            break;

          case WEBVIEW_MESSAGES.TEXT_EXTRACTION_ERROR: {
            cleanup();
            const error = new TextExtractionError(message.error || 'Unknown extraction error');
            TextExtractor.logger.error('Text extraction failed', error);
            reject(error);
            break;
          }
        }
      });

      // Request text extraction
      try {
        panel.webview.postMessage({ type: WEBVIEW_MESSAGES.EXTRACT_ALL_TEXT });
        TextExtractor.logger.debug('Text extraction request sent to webview');
      } catch (error) {
        cleanup();
        reject(new TextExtractionError('Failed to send extraction request', error as Error));
      }
    });
  }

  static async extractTextWithRetry(
    panel: vscode.WebviewPanel,
    pdfPath: string,
    options: TextExtractionOptions = {
      timeout: CONFIG.TIMEOUTS.TEXT_EXTRACTION_MS,
      retryAttempts: 2,
    }
  ): Promise<string> {
    const { retryAttempts = 2, timeout } = options;

    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
      try {
        TextExtractor.logger.debug(`Text extraction attempt ${attempt}/${retryAttempts}`);
        return await TextExtractor.extractText(panel, pdfPath, { ...options, timeout });
      } catch (error) {
        TextExtractor.logger.warn(`Text extraction attempt ${attempt} failed`, error);

        if (attempt === retryAttempts) {
          throw error;
        }

        // Brief delay before retry
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    throw new TextExtractionError('All extraction attempts failed');
  }
}
