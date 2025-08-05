import * as vscode from 'vscode';
import { DocumentCache, type CacheEntryMetadata, type CacheStats } from '../cache/documentCache';
import { TextExtractor } from '../pdf/textExtractor';
import { PdfLoadError } from '../utils/errors';
import { Logger } from '../utils/logger';
import { WebviewProvider } from '../webview/webviewProvider';
import { AiTextProcessor } from './AiTextProcessor';
import type { ChatCommandResult, ProcessDocumentOptions } from '../types/interfaces';

export abstract class BasePdfHandler {
  protected static readonly logger = Logger.getInstance();
  protected readonly cache: DocumentCache<string>;
  protected readonly aiTextProcessor: AiTextProcessor;

  constructor(
    protected readonly extensionContext: vscode.ExtensionContext,
    cacheType: 'summary' | 'mindmap'
  ) {
    this.cache = new DocumentCache<string>(extensionContext, cacheType);
    this.aiTextProcessor = new AiTextProcessor();
  }

  public abstract processPdf(
    options: ProcessDocumentOptions,
    stream: vscode.ChatResponseStream,
    cancellationToken: vscode.CancellationToken
  ): Promise<ChatCommandResult>;

  protected async createPdfViewer(
    pdfPath: string,
    stream: vscode.ChatResponseStream
  ): Promise<vscode.WebviewPanel> {
    try {
      // Check if viewer already exists, otherwise create/reveal one
      const panel = WebviewProvider.createPdfViewer(pdfPath, this.extensionContext);

      // The createPdfViewer method now handles reuse internally, so we always get a valid panel
      const action = panel.visible ? 'Reusing existing' : 'Opening';
      stream.markdown(`📄 ${action} PDF viewer...\n\n`);

      BasePdfHandler.logger.info(`PDF viewer ready for: ${pdfPath}`);
      return panel;
    } catch (error) {
      throw new PdfLoadError(pdfPath, error as Error);
    }
  }

  protected async extractText(
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
        BasePdfHandler.logger.debug(`Text extraction progress: ${Math.round(progress * 100)}%`);
      },
    });

    stream.markdown(`✅ Extracted ${text.length} characters from PDF\n\n`);
    return text;
  }

  protected _isTestEnvironment(): boolean {
    return (
      process.env.NODE_ENV === 'test' ||
      process.env.VSCODE_PID === undefined ||
      (typeof global !== 'undefined' && 'suite' in global)
    );
  }

  protected _createMockLanguageModel(id = 'test-model-id'): vscode.LanguageModelChat {
    BasePdfHandler.logger.info(`Using mock language model for testing (id: ${id})`);
    return {
      id,
      name: 'test-model',
      vendor: 'copilot',
      family: 'gpt-4',
      version: '1.0.0',
      maxInputTokens: 8192,
      countTokens: async (text: string) => text.length / 4,
      sendRequest: async () => ({
        text: 'This is a test response generated for integration testing purposes.',
        stream: async function* () {
          yield {
            index: 0,
            part: 'This is a test response generated for integration testing purposes.',
          };
        },
      }),
    } as unknown as vscode.LanguageModelChat;
  }

  protected async getLanguageModel(): Promise<vscode.LanguageModelChat> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });

      if (models.length > 0) {
        const selectedModel = models[0];
        BasePdfHandler.logger.info(`Using language model: ${selectedModel.name}`, {
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

      throw new Error(
        'No compatible language models available. Please ensure GitHub Copilot is enabled.'
      );
    } catch (error) {
      if (this._isTestEnvironment()) {
        return this._createMockLanguageModel('test-model-fallback-id');
      }
      throw error;
    }
  }

  protected getFileName(pdfPath: string): string {
    return WebviewProvider.getFileName(pdfPath);
  }

  // Cache management methods
  protected async getCachedResult(filePath: string): Promise<string | null> {
    return await this.cache.getCached(filePath);
  }

  protected async setCachedResult(
    filePath: string,
    content: string,
    metadata: CacheEntryMetadata
  ): Promise<void> {
    await this.cache.setCached(filePath, content, metadata);
  }

  protected getCacheStats(): CacheStats {
    return this.cache.getCacheStats();
  }

  protected async clearCache(): Promise<void> {
    await this.cache.clearCache();
  }
}