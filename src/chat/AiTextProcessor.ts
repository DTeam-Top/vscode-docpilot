import * as vscode from 'vscode';
import * as ChunkingStrategy from '../pdf/chunkingStrategy';
import type {
  ChatCommandResult,
  ChunkingConfig,
  DocumentChunk,
  ProcessDocumentOptions,
  ProcessingResult,
} from '../types/interfaces';
import { configuration } from '../utils/configuration';
import { handleChatError } from '../utils/errorHandler';
import { ModelRequestError } from '../utils/errors';
import { Logger } from '../utils/logger';
import * as Retry from '../utils/retry';
import * as TokenEstimator from '../utils/tokenEstimator';
import {
  MindmapStrategy,
  type ProcessingStrategy,
  SummarizationStrategy,
} from './processingStrategies';

export class AiTextProcessor {
  private static readonly logger = Logger.getInstance();
  private readonly summarizationStrategy: ProcessingStrategy;
  private readonly mindmapStrategy: ProcessingStrategy;

  constructor() {
    this.summarizationStrategy = new SummarizationStrategy();
    this.mindmapStrategy = new MindmapStrategy();
  }

  async processDocument(options: ProcessDocumentOptions): Promise<ChatCommandResult> {
    return this.process(options, this.summarizationStrategy, 'summarise');
  }

  async processMindmapDocument(options: ProcessDocumentOptions): Promise<ChatCommandResult> {
    return this.process(options, this.mindmapStrategy, 'mindmap');
  }

  private async process(
    options: ProcessDocumentOptions,
    strategy: ProcessingStrategy,
    command: 'summarise' | 'mindmap'
  ): Promise<ChatCommandResult> {
    const { text, fileName, model, stream, cancellationToken } = options;

    try {
      const result = await this.processWithChunking(
        text,
        fileName,
        model,
        stream,
        cancellationToken,
        strategy
      );

      if (!result.success && result.fallbackRequired) {
        return await this.handleFallback(
          text,
          fileName,
          model,
          stream,
          cancellationToken,
          strategy,
          command,
          result.error
        );
      }

      stream.markdown(
        `\n\n---\n*PDF opened in DocPilot viewer. Text content: ${text.length} characters*`
      );

      return {
        metadata: {
          command,
          file: fileName,
          textLength: text.length,
          processingStrategy: result.success ? 'enhanced' : 'fallback',
          timestamp: Date.now(),
        },
        summaryText: command === 'summarise' ? result.summaryText : undefined,
        mindmapText: command === 'mindmap' ? result.mindmapText : undefined,
      };
    } catch (error) {
      AiTextProcessor.logger.error('Document processing failed', error);
      return handleChatError(error, stream, 'Document processing');
    }
  }

  private async processWithChunking(
    pdfText: string,
    fileName: string,
    model: vscode.LanguageModelChat,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    strategy: ProcessingStrategy
  ): Promise<ProcessingResult> {
    try {
      const estimatedTokens = TokenEstimator.estimate(pdfText);
      const maxTokensForModel = model.maxInputTokens || 4000;
      const config = ChunkingStrategy.getDefaultConfig(maxTokensForModel);

      stream.markdown(
        `📊 Processing ${pdfText.length} characters (~${estimatedTokens} tokens)\n\n`
      );

      if (estimatedTokens <= config.maxTokensPerChunk) {
        return await this.processSingleChunk(pdfText, fileName, model, stream, token, strategy);
      }

      return await this.processMultipleChunks(
        pdfText,
        fileName,
        model,
        stream,
        token,
        config,
        strategy
      );
    } catch (error) {
      AiTextProcessor.logger.error('Error in chunking process', error);
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
    token: vscode.CancellationToken,
    strategy: ProcessingStrategy
  ): Promise<ProcessingResult> {
    stream.markdown('🚀 Document fits in single chunk, processing directly...\n\n');

    const prompt = strategy.getPrompt('singleChunk', fileName, pdfText);

    const response = await Retry.withRetry(
      () =>
        Promise.resolve(
          model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token)
        ),
      {
        maxAttempts: 2,
        shouldRetry: Retry.shouldRetryModelError,
      }
    );

    let resultText = '';
    for await (const chunk of response.text) {
      resultText += chunk;
      stream.markdown(chunk);
      if (token.isCancellationRequested) {
        break;
      }
    }

    const formattedResult = strategy.formatResult(resultText, 'summary');
    return {
      success: true,
      fallbackRequired: false,
      summaryText: formattedResult,
      mindmapText: formattedResult,
    };
  }

  private async processMultipleChunks(
    pdfText: string,
    fileName: string,
    model: vscode.LanguageModelChat,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    config: ChunkingConfig,
    strategy: ProcessingStrategy
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

    const chunkSummaries = await this.processChunksInBatches(
      chunks,
      fileName,
      model,
      stream,
      token,
      strategy
    );

    const finalResult = await this.consolidateSummaries(
      chunkSummaries,
      fileName,
      chunks,
      model,
      token,
      strategy
    );

    stream.markdown(finalResult);

    const totalPages = chunks.length > 0 ? chunks[chunks.length - 1].endPage : 0;
    stream.markdown(
      `\n\n📊 **Processing Stats:** ${chunks.length} chunks processed, ${totalPages} pages analyzed\n`
    );
    stream.markdown(
      '✨ *Summary generated using semantic chunking and hierarchical consolidation*\n'
    );

    const formattedResult = strategy.formatResult(finalResult, 'summary');
    return {
      success: true,
      fallbackRequired: false,
      summaryText: formattedResult,
      mindmapText: formattedResult,
    };
  }

  private async processChunksInBatches(
    chunks: DocumentChunk[],
    fileName: string,
    model: vscode.LanguageModelChat,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    strategy: ProcessingStrategy
  ): Promise<string[]> {
    const chunkSummaries: string[] = [];
    const batchSize = configuration.textProcessingDefaultBatchSize;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);

      const batchPromises = batch.map((chunk) => {
        stream.markdown(`📄 Processing pages ${chunk.startPage}-${chunk.endPage}...\n`);
        return this.summarizeChunk(chunk, fileName, model, token, strategy);
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
    token: vscode.CancellationToken,
    strategy: ProcessingStrategy
  ): Promise<string> {
    const prompt = strategy.getPrompt('chunk', chunk, fileName);

    try {
      const response = await Retry.withRetry(
        () =>
          Promise.resolve(
            model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token)
          ),
        {
          maxAttempts: 2,
          shouldRetry: Retry.shouldRetryModelError,
        }
      );

      let summary = '';
      for await (const textChunk of response.text) {
        summary += textChunk;
        if (token.isCancellationRequested) {
          break;
        }
      }

      const result = summary.trim();

      if (
        result.toLowerCase().includes("sorry, i can't assist") ||
        result.toLowerCase().includes("i can't help") ||
        result.toLowerCase().includes('i cannot assist')
      ) {
        AiTextProcessor.logger.warn(
          `Model ${model.name} rejected chunk request. Chunk tokens: ${chunk.tokens}, Content length: ${chunk.content.length}`
        );
        throw new Error(
          `AI model (${model.name}) rejected the content. This may be due to content policy restrictions.`
        );
      }

      return result;
    } catch (error) {
      AiTextProcessor.logger.error(`Error summarizing chunk ${chunk.index}`, error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return `[Error summarizing pages ${chunk.startPage}-${chunk.endPage}: ${errorMsg}]`;
    }
  }

  private async consolidateSummaries(
    chunkSummaries: string[],
    fileName: string,
    chunks: DocumentChunk[],
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    strategy: ProcessingStrategy
  ): Promise<string> {
    const totalPages = chunks.length > 0 ? chunks[chunks.length - 1].endPage : 0;
    const prompt = strategy.getPrompt('consolidation', chunkSummaries, fileName, totalPages);

    try {
      const response = await Retry.withRetry(
        () =>
          Promise.resolve(
            model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token)
          ),
        {
          maxAttempts: 2,
          shouldRetry: Retry.shouldRetryModelError,
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
      AiTextProcessor.logger.error('Error consolidating summaries', error);
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
    strategy: ProcessingStrategy,
    command: 'summarise' | 'mindmap',
    originalError?: string
  ): Promise<ChatCommandResult> {
    stream.markdown('⚠️ Enhanced processing failed, using fallback approach...\n\n');

    const shortExcerpt = `${text.substring(0, 1000)}...\n\n[Showing excerpt only]`;
    const fallbackPrompt = strategy.getPrompt('fallback', shortExcerpt);

    try {
      const fallbackResponse = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(fallbackPrompt)],
        {},
        token
      );

      let fallbackResultText = '';
      for await (const chunk of fallbackResponse.text) {
        fallbackResultText += chunk;
        stream.markdown(chunk);
        if (token.isCancellationRequested) {
          break;
        }
      }

      stream.markdown(
        '\n\n⚠️ *Note: Result based on document excerpt only due to size constraints.*'
      );

      const resultType = command === 'summarise' ? 'summary' : 'mindmap';
      const formattedResult = strategy.formatResult(fallbackResultText, resultType);

      return {
        metadata: {
          command,
          file: fileName,
          processingStrategy: 'fallback',
          originalError,
          timestamp: Date.now(),
        },
        summaryText: command === 'summarise' ? formattedResult : undefined,
        mindmapText: command === 'mindmap' ? formattedResult : undefined,
      };
    } catch (_fallbackError) {
      stream.markdown(`❌ Both enhanced and fallback processing failed: ${originalError}\n\n`);
      throw new ModelRequestError(`Processing failed: ${originalError}`);
    }
  }
}
