import type * as vscode from 'vscode';
import { FileWatcher } from '../cache/fileWatcher';
import { SummaryCache } from '../cache/summaryCache';
import type { ChatCommandResult } from '../types/interfaces';
import { ChatErrorHandler } from '../utils/errorHandler';
import { PathResolver } from '../utils/pathResolver';
import { PdfProcessorBase } from './pdfProcessorBase';
import { TextProcessor } from './textProcessor';

export class SummaryHandler extends PdfProcessorBase {
  private readonly textProcessor: TextProcessor;
  private readonly summaryCache: SummaryCache;
  private readonly fileWatcher: FileWatcher;

  constructor(extensionContext: vscode.ExtensionContext) {
    super(extensionContext);
    this.textProcessor = new TextProcessor();
    this.summaryCache = new SummaryCache(extensionContext);
    this.fileWatcher = new FileWatcher(this.summaryCache);
  }

  async handle(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<ChatCommandResult> {
    try {
      const pdfPath = await PathResolver.resolve(request.prompt, stream);

      // Always create PDF viewer first
      const panel = await this.createPdfViewer(pdfPath, stream);

      // Check cache first
      const cachedSummary = await this.summaryCache.getCachedSummary(pdfPath);
      if (cachedSummary) {
        stream.markdown('⚡ Found cached summary!\n\n');
        stream.markdown('## 📋 PDF Summary (Cached)\n\n');
        stream.markdown(cachedSummary);
        stream.markdown('\n\n---\n*This summary was retrieved from cache for faster response.*');

        return {
          metadata: {
            command: 'summarise',
            file: this.getFileName(pdfPath),
            processingStrategy: 'cached',
            timestamp: Date.now(),
          },
        };
      }

      const text = await this.extractText(panel, pdfPath, stream);
      const fileName = this.getFileName(pdfPath);

      const result = await this.textProcessor.processDocument({
        text,
        fileName,
        model: await this.getLanguageModel(),
        stream,
        cancellationToken: token,
      });

      // Cache the result if processing was successful
      if (result.metadata && !result.metadata.error && result.summaryText) {
        await this.summaryCache.setCachedSummary(
          pdfPath,
          result.summaryText,
          String(result.metadata.processingStrategy) || 'unknown',
          Number(result.metadata.textLength) || text.length
        );

        // Start watching the file for changes to invalidate cache
        this.fileWatcher.watchFile(pdfPath);
      }

      return result;
    } catch (error) {
      PdfProcessorBase.logger.error('Summary handler error', error);
      return ChatErrorHandler.handle(error, stream, 'PDF summarization');
    }
  }

  dispose(): void {
    this.fileWatcher.dispose();
  }

  getCacheStats() {
    return this.summaryCache.getCacheStats();
  }

  async clearCache(): Promise<void> {
    await this.summaryCache.clearCache();
  }
}
