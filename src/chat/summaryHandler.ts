import * as vscode from 'vscode';
import { FileWatcher } from '../cache/fileWatcher';
import { SummaryCache } from '../cache/summaryCache';
import { TextExtractor } from '../pdf/textExtractor';
import type { ChatCommandResult } from '../types/interfaces';
import { ChatErrorHandler } from '../utils/errorHandler';
import { PdfLoadError } from '../utils/errors';
import { Logger } from '../utils/logger';
import { PathResolver } from '../utils/pathResolver';
import { WebviewProvider } from '../webview/webviewProvider';
import { TextProcessor } from './textProcessor';

export class SummaryHandler {
  private static readonly logger = Logger.getInstance();
  private readonly textProcessor: TextProcessor;
  private readonly summaryCache: SummaryCache;
  private readonly fileWatcher: FileWatcher;

  constructor(private readonly extensionContext: vscode.ExtensionContext) {
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
      SummaryHandler.logger.error('Summary handler error', error);
      return ChatErrorHandler.handle(error, stream, 'PDF summarization');
    }
  }

  private async createPdfViewer(
    pdfPath: string,
    stream: vscode.ChatResponseStream
  ): Promise<vscode.WebviewPanel> {
    try {
      // Check if viewer already exists, otherwise create/reveal one
      const panel = WebviewProvider.createPdfViewer(pdfPath, this.extensionContext);

      // The createPdfViewer method now handles reuse internally, so we always get a valid panel
      const action = panel.visible ? 'Reusing existing' : 'Opening';
      stream.markdown(`📄 ${action} PDF viewer...\n\n`);

      SummaryHandler.logger.info(`PDF viewer ready for: ${pdfPath}`);
      return panel;
    } catch (error) {
      throw new PdfLoadError(pdfPath, error as Error);
    }
  }

  private async extractText(
    panel: vscode.WebviewPanel,
    pdfPath: string,
    stream: vscode.ChatResponseStream
  ): Promise<string> {
    stream.markdown('📝 Extracting text content...\n\n');

    const text = await TextExtractor.extractTextWithRetry(panel, pdfPath, {
      timeout: 30000,
      retryAttempts: 2,
      progressCallback: (progress) => {
        // Could update progress here if needed
        SummaryHandler.logger.debug(`Text extraction progress: ${Math.round(progress * 100)}%`);
      },
    });

    stream.markdown(`✅ Extracted ${text.length} characters from PDF\n\n`);
    return text;
  }

  private _isTestEnvironment(): boolean {
    return (
      process.env.NODE_ENV === 'test' ||
      process.env.VSCODE_PID === undefined ||
      (typeof global !== 'undefined' && 'suite' in global)
    );
  }

  private _createMockLanguageModel(id = 'test-model-id'): vscode.LanguageModelChat {
    SummaryHandler.logger.info(`Using mock language model for testing (id: ${id})`);
    return {
      id,
      name: 'test-model',
      vendor: 'copilot',
      family: 'gpt-4',
      version: '1.0.0',
      maxInputTokens: 8192,
      countTokens: async (text: string) => text.length / 4,
      sendRequest: async () => ({
        text: 'This is a test summary generated for integration testing purposes.',
        stream: async function* () {
          yield {
            index: 0,
            part: 'This is a test summary generated for integration testing purposes.',
          };
        },
      }),
    } as unknown as vscode.LanguageModelChat;
  }

  private async getLanguageModel(): Promise<vscode.LanguageModelChat> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });

      if (models.length > 0) {
        const selectedModel = models[0];
        SummaryHandler.logger.info(`Using language model: ${selectedModel.name}`, {
          modelName: selectedModel.name,
          maxInputTokens: selectedModel.maxInputTokens,
          vendor: selectedModel.vendor,
          family: selectedModel.family,
        });
        return selectedModel;
      }

      if (this._isTestEnvironment()) {
        return this._createMockLanguageModel();
      }

      throw new Error('No compatible language models available. Please ensure GitHub Copilot is enabled.');
    } catch (error) {
      if (this._isTestEnvironment()) {
        return this._createMockLanguageModel('test-model-fallback-id');
      }
      throw error;
    }
  }

  private getFileName(pdfPath: string): string {
    return WebviewProvider.getFileName(pdfPath);
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

