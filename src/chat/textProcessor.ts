import * as vscode from 'vscode';
import { ChunkingStrategy } from '../pdf/chunkingStrategy';
import { TokenEstimator } from '../utils/tokenEstimator';
import { Logger } from '../utils/logger';
import { ChatErrorHandler } from '../utils/errorHandler';
import { RetryPolicy } from '../utils/retry';
import { ModelRequestError } from '../utils/errors';
import { CONFIG } from '../utils/constants';
import type {
  ProcessDocumentOptions,
  ProcessingResult,
  ChatCommandResult,
  DocumentChunk,
  ChunkingConfig,
} from '../types/interfaces';

export class TextProcessor {
  private static readonly logger = Logger.getInstance();

  async processDocument(options: ProcessDocumentOptions): Promise<ChatCommandResult> {
    const { text, fileName, model, stream, cancellationToken } = options;

    try {
      const result = await this.processWithChunking(
        text,
        fileName,
        model,
        stream,
        cancellationToken
      );

      if (!result.success && result.fallbackRequired) {
        return await this.handleFallback(
          text,
          fileName,
          model,
          stream,
          cancellationToken,
          result.error
        );
      }

      stream.markdown(
        `\n\n---\n*PDF opened in DocPilot viewer. Text content: ${text.length} characters*`
      );

      return {
        metadata: {
          command: 'summarise',
          file: fileName,
          textLength: text.length,
          processingStrategy: result.success ? 'enhanced' : 'fallback',
          timestamp: Date.now(),
        },
        summaryText: result.summaryText,
      };
    } catch (error) {
      TextProcessor.logger.error('Document processing failed', error);
      return ChatErrorHandler.handle(error, stream, 'Document processing');
    }
  }

  private async processWithChunking(
    pdfText: string,
    fileName: string,
    model: vscode.LanguageModelChat,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<ProcessingResult> {
    try {
      const estimatedTokens = TokenEstimator.estimate(pdfText);
      const maxTokensForModel = model.maxInputTokens || 4000;
      const config = ChunkingStrategy.getDefaultConfig(maxTokensForModel);

      stream.markdown(
        `📊 Processing ${pdfText.length} characters (~${estimatedTokens} tokens)\n\n`
      );

      // Check if document fits in single chunk
      if (estimatedTokens <= config.maxTokensPerChunk) {
        return await this.processSingleChunk(pdfText, fileName, model, stream, token);
      }

      // Document is large, use chunking strategy
      return await this.processMultipleChunks(pdfText, fileName, model, stream, token, config);
    } catch (error) {
      TextProcessor.logger.error('Error in chunking process', error);
      return {
        success: false,
        fallbackRequired: true,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async processSingleChunk(
    pdfText: string,
    fileName: string,
    model: vscode.LanguageModelChat,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<ProcessingResult> {
    stream.markdown('🚀 Document fits in single chunk, processing directly...\n\n');

    const prompt = this.createSingleChunkPrompt(fileName, pdfText);

    const response = await RetryPolicy.withRetry(
      () =>
        Promise.resolve(
          model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token)
        ),
      {
        maxAttempts: 2,
        shouldRetry: RetryPolicy.shouldRetryModelError,
      }
    );

    stream.markdown('## 📋 PDF Summary\n\n');

    let summaryText = '';
    for await (const chunk of response.text) {
      summaryText += chunk;
      stream.markdown(chunk);
      if (token.isCancellationRequested) {
        break;
      }
    }

    return { success: true, fallbackRequired: false, summaryText: summaryText.trim() };
  }

  private async processMultipleChunks(
    pdfText: string,
    fileName: string,
    model: vscode.LanguageModelChat,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    config: ChunkingConfig
  ): Promise<ProcessingResult> {
    const estimatedTokens = TokenEstimator.estimate(pdfText);

    stream.markdown(
      `📚 Document is large (~${estimatedTokens} tokens), using intelligent chunking...\n\n`
    );

    const chunks = ChunkingStrategy.createSemanticChunks(pdfText, config);

    if (!ChunkingStrategy.validateChunks(chunks, config)) {
      throw new Error('Chunk validation failed - chunks too large');
    }

    stream.markdown(`🔄 Created ${chunks.length} semantic chunks\n\n`);

    // Process chunks in batches
    const chunkSummaries = await this.processChunksInBatches(
      chunks,
      fileName,
      model,
      stream,
      token
    );

    // Consolidate summaries
    const finalSummary = await this.consolidateSummaries(
      chunkSummaries,
      fileName,
      chunks,
      model,
      token
    );

    stream.markdown('## 📋 Comprehensive PDF Summary\n\n');
    stream.markdown(finalSummary);

    const totalPages = chunks.length > 0 ? chunks[chunks.length - 1].endPage : 0;
    stream.markdown(
      `\n\n📊 **Processing Stats:** ${chunks.length} chunks processed, ${totalPages} pages analyzed\n`
    );
    stream.markdown(
      '✨ *Summary generated using semantic chunking and hierarchical consolidation*\n'
    );

    return { success: true, fallbackRequired: false, summaryText: finalSummary };
  }

  private async processChunksInBatches(
    chunks: DocumentChunk[],
    fileName: string,
    model: vscode.LanguageModelChat,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<string[]> {
    const chunkSummaries: string[] = [];
    const batchSize = CONFIG.TEXT_PROCESSING.DEFAULT_BATCH_SIZE;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);

      const batchPromises = batch.map((chunk) => {
        stream.markdown(`📄 Processing pages ${chunk.startPage}-${chunk.endPage}...\n`);
        return this.summarizeChunk(chunk, fileName, model, token);
      });

      const batchResults = await Promise.all(batchPromises);
      chunkSummaries.push(...batchResults);

      stream.markdown(
        `✅ Completed ${Math.min(i + batchSize, chunks.length)}/${chunks.length} chunks\n\n`
      );

      if (token.isCancellationRequested) {
        throw new Error('Processing cancelled by user');
      }
    }

    return chunkSummaries;
  }

  private async summarizeChunk(
    chunk: DocumentChunk,
    fileName: string,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken
  ): Promise<string> {
    const prompt = this.createChunkSummaryPrompt(chunk, fileName);

    try {
      const response = await RetryPolicy.withRetry(
        () =>
          Promise.resolve(
            model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token)
          ),
        {
          maxAttempts: 2,
          shouldRetry: RetryPolicy.shouldRetryModelError,
        }
      );

      let summary = '';
      for await (const textChunk of response.text) {
        summary += textChunk;
        if (token.isCancellationRequested) {
          break;
        }
      }

      return summary.trim();
    } catch (error) {
      TextProcessor.logger.error(`Error summarizing chunk ${chunk.index}`, error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return `[Error summarizing pages ${chunk.startPage}-${chunk.endPage}: ${errorMsg}]`;
    }
  }

  private async consolidateSummaries(
    chunkSummaries: string[],
    fileName: string,
    chunks: DocumentChunk[],
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken
  ): Promise<string> {
    const totalPages = chunks.length > 0 ? chunks[chunks.length - 1].endPage : 0;
    const prompt = this.createConsolidationPrompt(chunkSummaries, fileName, totalPages);

    try {
      const response = await RetryPolicy.withRetry(
        () =>
          Promise.resolve(
            model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token)
          ),
        {
          maxAttempts: 2,
          shouldRetry: RetryPolicy.shouldRetryModelError,
        }
      );

      let finalSummary = '';
      for await (const textChunk of response.text) {
        finalSummary += textChunk;
        if (token.isCancellationRequested) {
          break;
        }
      }

      return finalSummary.trim();
    } catch (error) {
      TextProcessor.logger.error('Error consolidating summaries', error);
      // Fallback: return combined summaries
      const combinedSummaries = chunkSummaries
        .map((summary, index) => `## Section ${index + 1}\n${summary}`)
        .join('\n\n');

      return `# Document Summary\n\n${combinedSummaries}\n\n*Note: Automatic consolidation failed, showing section summaries.*`;
    }
  }

  private async handleFallback(
    text: string,
    fileName: string,
    model: vscode.LanguageModelChat,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    originalError?: string
  ): Promise<ChatCommandResult> {
    stream.markdown('⚠️ Enhanced processing failed, using fallback approach...\n\n');

    const shortExcerpt = `${text.substring(0, 1000)}...\n\n[Showing excerpt only]`;
    const fallbackPrompt = `Provide a brief summary of this PDF excerpt:\n\n${shortExcerpt}`;

    try {
      const fallbackResponse = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(fallbackPrompt)],
        {},
        token
      );

      stream.markdown('## 📋 PDF Summary (Excerpt)\n\n');

      let fallbackSummaryText = '';
      for await (const chunk of fallbackResponse.text) {
        fallbackSummaryText += chunk;
        stream.markdown(chunk);
        if (token.isCancellationRequested) {
          break;
        }
      }

      stream.markdown(
        '\n\n⚠️ *Note: Summary based on document excerpt only due to size constraints.*'
      );

      return {
        metadata: {
          command: 'summarise',
          file: fileName,
          processingStrategy: 'fallback',
          originalError,
          timestamp: Date.now(),
        },
        summaryText: fallbackSummaryText.trim(),
      };
    } catch (_fallbackError) {
      stream.markdown(`❌ Both enhanced and fallback summarization failed: ${originalError}\n\n`);
      throw new ModelRequestError(`Summarization failed: ${originalError}`);
    }
  }

  private createSingleChunkPrompt(fileName: string, text: string): string {
    return `Summarize this PDF document:

**File:** ${fileName}
**Strategy:** Full content analysis

**Content:**
${text}

Provide:
1. Brief overview
2. Key points
3. Main findings
4. Document structure`;
  }

  private createChunkSummaryPrompt(chunk: DocumentChunk, fileName: string): string {
    return `Summarize this section of the PDF document:

**File:** ${fileName}
**Section:** Pages ${chunk.startPage}-${chunk.endPage} (Chunk ${chunk.index + 1})
**Content:**
${chunk.content}

Provide a comprehensive summary focusing on:
1. Main topics and themes
2. Key information and findings
3. Important details
4. Context and structure

Keep the summary detailed enough to preserve important information for later consolidation.`;
  }

  private createConsolidationPrompt(
    summaries: string[],
    fileName: string,
    totalPages: number
  ): string {
    const combinedSummaries = summaries
      .map((summary, index) => `## Section ${index + 1}\n${summary}`)
      .join('\n\n');

    return `Create a comprehensive final summary from these section summaries of a PDF document:

**File:** ${fileName}
**Total Pages:** ${totalPages}
**Section Summaries:**
${combinedSummaries}

Create a unified summary that:
1. Provides a clear overview of the entire document
2. Synthesizes key themes and findings across all sections
3. Maintains logical flow and coherence
4. Highlights the most important information
5. Notes the document structure and organization

The final summary should be comprehensive yet concise, giving readers a complete understanding of the document's content and significance.`;
  }
}
