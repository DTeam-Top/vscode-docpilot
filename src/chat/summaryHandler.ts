import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { WebviewProvider } from '../webview/webviewProvider';
import { TextExtractor } from '../pdf/textExtractor';
import { TextProcessor } from './textProcessor';
import { SummaryCache } from '../cache/summaryCache';
import { FileWatcher } from '../cache/fileWatcher';
import { Logger } from '../utils/logger';
import { ChatErrorHandler } from '../utils/errorHandler';
import { InvalidFilePathError, PdfLoadError } from '../utils/errors';
import type { ChatCommandResult } from '../types/interfaces';

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
      const pdfPath = await this.resolvePdfPath(request.prompt, stream);

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

  private async resolvePdfPath(prompt: string, stream: vscode.ChatResponseStream): Promise<string> {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      // Show file picker if no file specified
      stream.markdown('📁 Opening file picker...\n\n');

      const result = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'PDF Files': ['pdf'] },
        title: 'Select PDF file to summarise',
      });

      if (!result || result.length === 0) {
        throw new InvalidFilePathError('No file selected');
      }

      return result[0].fsPath;
    }

    if (trimmedPrompt.startsWith('http')) {
      // Handle URL
      if (!WebviewProvider.validatePdfPath(trimmedPrompt)) {
        throw new InvalidFilePathError(`Invalid PDF URL: ${trimmedPrompt}`);
      }
      return trimmedPrompt;
    }

    // Handle file path - resolve relative to workspace
    let resolvedPath: string;
    if (path.isAbsolute(trimmedPrompt)) {
      resolvedPath = trimmedPrompt;
    } else {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new InvalidFilePathError(
          'No workspace folder found. Please provide an absolute path.'
        );
      }
      resolvedPath = path.join(workspaceFolder.uri.fsPath, trimmedPrompt);
    }

    // Check if file exists for local files
    if (!resolvedPath.startsWith('http') && !fs.existsSync(resolvedPath)) {
      throw new InvalidFilePathError(`File not found: ${resolvedPath}`);
    }

    if (!WebviewProvider.validatePdfPath(resolvedPath)) {
      throw new InvalidFilePathError(`Not a valid PDF file: ${resolvedPath}`);
    }

    return resolvedPath;
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

  private async getLanguageModel(): Promise<vscode.LanguageModelChat> {
    const models = await vscode.lm.selectChatModels({
      vendor: 'copilot',
      family: 'gpt-4',
    });

    if (models.length === 0) {
      throw new Error(
        'No compatible language models available. Please ensure GitHub Copilot is enabled.'
      );
    }

    SummaryHandler.logger.info(`Using language model: ${models[0].name}`);
    return models[0];
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
