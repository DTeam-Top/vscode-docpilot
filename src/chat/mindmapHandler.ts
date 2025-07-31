import * as vscode from 'vscode';
import type { ChatCommandResult } from '../types/interfaces';
import { ChatErrorHandler } from '../utils/errorHandler';
import { PathResolver } from '../utils/pathResolver';
import { PdfProcessorBase } from './pdfProcessorBase';
import { TextProcessor } from './textProcessor';

export class MindmapHandler extends PdfProcessorBase {
  private readonly textProcessor: TextProcessor;

  constructor(extensionContext: vscode.ExtensionContext) {
    super(extensionContext, 'mindmap');
    this.textProcessor = new TextProcessor();
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
      const cachedMindmap = await this.getCachedResult(pdfPath);
      if (cachedMindmap) {
        stream.markdown('⚡ Found cached mindmap!\n\n');
        stream.markdown('## 🗺️ PDF Mindmap (Cached)\n\n');
        stream.markdown('```mermaid\n');
        stream.markdown(cachedMindmap);
        stream.markdown('\n```\n\n');
        
        // Create and open mindmap file
        const fileName = this.getFileName(pdfPath);
        await this.createMindmapFile(cachedMindmap, fileName, stream);
        
        stream.markdown('\n\n---\n*This mindmap was retrieved from cache for faster response.*');

        return {
          metadata: {
            command: 'mindmap',
            file: fileName,
            processingStrategy: 'cached',
            timestamp: Date.now(),
          },
          mindmapText: cachedMindmap,
        };
      }

      // Extract text from PDF
      const text = await this.extractText(panel, pdfPath, stream);
      const fileName = this.getFileName(pdfPath);

      // Generate mindmap
      const mindmapResult = await this.generateMindmap(text, fileName, stream, token);

      // Cache the result if processing was successful
      if (mindmapResult.metadata && !mindmapResult.metadata.error && mindmapResult.mindmapText) {
        await this.setCachedResult(pdfPath, mindmapResult.mindmapText, {
          processingStrategy: String(mindmapResult.metadata.processingStrategy) || 'unknown',
          textLength: Number(mindmapResult.metadata.textLength) || text.length,
        });
      }

      // Create and open mindmap file
      if (mindmapResult.mindmapText) {
        await this.createMindmapFile(mindmapResult.mindmapText, fileName, stream);
      }

      return mindmapResult;
    } catch (error) {
      PdfProcessorBase.logger.error('Mindmap handler error', error);
      return ChatErrorHandler.handle(error, stream, 'PDF mindmap generation');
    }
  }

  private async generateMindmap(
    text: string,
    fileName: string,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<ChatCommandResult> {
    const model = await this.getLanguageModel();

    const result = await this.textProcessor.processMindmapDocument({
      text,
      fileName,
      model,
      stream,
      cancellationToken: token,
    });

    return result;
  }

  private async createMindmapFile(
    mindmapContent: string,
    pdfFileName: string,
    stream: vscode.ChatResponseStream
  ): Promise<void> {
    try {
      // Generate unique filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const baseName = pdfFileName.replace(/\.pdf$/i, '');
      const mindmapFileName = `${baseName}-mindmap-${timestamp}.mmd`;

      // Create new untitled document with mindmap content
      const document = await vscode.workspace.openTextDocument({
        content: mindmapContent,
        language: 'mermaid',
      });

      // Open the document in editor
      await vscode.window.showTextDocument(document);

      stream.markdown(`\n\n📁 **Mindmap created:** ${mindmapFileName}\n`);
      stream.markdown('🔍 *The mindmap file has been opened in your editor*\n');

      PdfProcessorBase.logger.info(`Mindmap file created and opened: ${mindmapFileName}`);
    } catch (error) {
      PdfProcessorBase.logger.error('Error creating mindmap file', error);
      stream.markdown(
        '\n\n⚠️ *Mindmap generated but could not create file. Content shown above.*\n'
      );
    }
  }

  // Public methods for ChatParticipant cache management
  getMindmapCacheStats() {
    return super.getCacheStats();
  }

  async clearMindmapCache(): Promise<void> {
    await super.clearCache();
  }
}
