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
      return handleChatError(error, stream, 'Document processing');
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
    const batchSize = configuration.textProcessingDefaultBatchSize;

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

      // Check for model rejection patterns
      if (
        result.toLowerCase().includes("sorry, i can't assist") ||
        result.toLowerCase().includes("i can't help") ||
        result.toLowerCase().includes('i cannot assist')
      ) {
        TextProcessor.logger.warn(
          `Model ${model.name} rejected chunk request. Chunk tokens: ${chunk.tokens}, Content length: ${chunk.content.length}`
        );
        throw new Error(
          `AI model (${model.name}) rejected the content. This may be due to content policy restrictions.`
        );
      }

      return result;
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

  async processMindmapDocument(options: ProcessDocumentOptions): Promise<ChatCommandResult> {
    const { text, fileName, model, stream, cancellationToken } = options;

    try {
      const result = await this.processWithMindmapChunking(
        text,
        fileName,
        model,
        stream,
        cancellationToken
      );

      if (!result.success && result.fallbackRequired) {
        return await this.handleMindmapFallback(
          text,
          fileName,
          model,
          stream,
          cancellationToken,
          result.error
        );
      }

      stream.markdown(
        `\n\n---\n*PDF opened in DocPilot viewer. Mindmap generated from ${text.length} characters*`
      );

      return {
        metadata: {
          command: 'mindmap',
          file: fileName,
          textLength: text.length,
          processingStrategy: result.success ? 'enhanced' : 'fallback',
          timestamp: Date.now(),
        },
        mindmapText: result.mindmapText,
      };
    } catch (error) {
      TextProcessor.logger.error('Mindmap document processing failed', error);
      return handleChatError(error, stream, 'Mindmap generation');
    }
  }

  private async processWithMindmapChunking(
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
        `🗺️ Generating mindmap from ${pdfText.length} characters (~${estimatedTokens} tokens)\n\n`
      );

      // Check if document fits in single chunk
      if (estimatedTokens <= config.maxTokensPerChunk) {
        return await this.processSingleMindmapChunk(pdfText, fileName, model, stream, token);
      }

      // Document is large, use chunking strategy
      return await this.processMultipleMindmapChunks(
        pdfText,
        fileName,
        model,
        stream,
        token,
        config
      );
    } catch (error) {
      TextProcessor.logger.error('Error in mindmap chunking process', error);
      return {
        success: false,
        fallbackRequired: true,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async processSingleMindmapChunk(
    pdfText: string,
    fileName: string,
    model: vscode.LanguageModelChat,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<ProcessingResult> {
    stream.markdown('🚀 Document fits in single chunk, generating mindmap directly...\n\n');

    const prompt = this.createSingleChunkMindmapPrompt(fileName, pdfText);

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

    stream.markdown('## 🗺️ PDF Mindmap\n\n```mermaid\n');

    let mindmapText = '';
    for await (const chunk of response.text) {
      mindmapText += chunk;
      stream.markdown(chunk);
      if (token.isCancellationRequested) {
        break;
      }
    }

    stream.markdown('\n```\n\n');

    return { success: true, fallbackRequired: false, mindmapText: mindmapText.trim() };
  }

  private async processMultipleMindmapChunks(
    pdfText: string,
    fileName: string,
    model: vscode.LanguageModelChat,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    config: ChunkingConfig
  ): Promise<ProcessingResult> {
    const estimatedTokens = TokenEstimator.estimate(pdfText);

    stream.markdown(
      `📚 Document is large (~${estimatedTokens} tokens), using intelligent chunking for mindmap...\n\n`
    );

    const chunks = ChunkingStrategy.createSemanticChunks(pdfText, config);

    if (!ChunkingStrategy.validateChunks(chunks, config)) {
      throw new Error('Chunk validation failed - chunks too large');
    }

    stream.markdown(`🔄 Created ${chunks.length} semantic chunks\n\n`);

    // Process chunks in batches for mindmap sections
    const chunkMindmaps = await this.processMindmapChunksInBatches(
      chunks,
      fileName,
      model,
      stream,
      token
    );

    // Consolidate mindmaps
    const finalMindmap = await this.consolidateMindmaps(
      chunkMindmaps,
      fileName,
      chunks,
      model,
      token
    );

    stream.markdown('## 🗺️ Comprehensive PDF Mindmap\n\n```mermaid\n');
    stream.markdown(finalMindmap);
    stream.markdown('\n```\n\n');

    const totalPages = chunks.length > 0 ? chunks[chunks.length - 1].endPage : 0;
    stream.markdown(
      `\n\n📊 **Processing Stats:** ${chunks.length} chunks processed, ${totalPages} pages analyzed\n`
    );
    stream.markdown(
      '✨ *Mindmap generated using semantic chunking and hierarchical consolidation*\n'
    );

    return { success: true, fallbackRequired: false, mindmapText: finalMindmap };
  }

  private async processMindmapChunksInBatches(
    chunks: DocumentChunk[],
    fileName: string,
    model: vscode.LanguageModelChat,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<string[]> {
    const chunkMindmaps: string[] = [];
    const batchSize = configuration.textProcessingDefaultBatchSize;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);

      const batchPromises = batch.map((chunk) => {
        stream.markdown(`📄 Processing pages ${chunk.startPage}-${chunk.endPage} for mindmap...\n`);
        return this.generateChunkMindmap(chunk, fileName, model, token);
      });

      const batchResults = await Promise.all(batchPromises);
      chunkMindmaps.push(...batchResults);

      stream.markdown(
        `✅ Completed ${Math.min(i + batchSize, chunks.length)}/${chunks.length} chunks\n\n`
      );

      if (token.isCancellationRequested) {
        throw new Error('Processing cancelled by user');
      }
    }

    return chunkMindmaps;
  }

  private async generateChunkMindmap(
    chunk: DocumentChunk,
    fileName: string,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken
  ): Promise<string> {
    const prompt = this.createChunkMindmapPrompt(chunk, fileName);

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

      let mindmap = '';
      for await (const textChunk of response.text) {
        mindmap += textChunk;
        if (token.isCancellationRequested) {
          break;
        }
      }

      return mindmap.trim();
    } catch (error) {
      TextProcessor.logger.error(`Error generating mindmap for chunk ${chunk.index}`, error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return `    ErrorSection${chunk.index}[Error: ${errorMsg}]`;
    }
  }

  private async consolidateMindmaps(
    chunkMindmaps: string[],
    fileName: string,
    chunks: DocumentChunk[],
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken
  ): Promise<string> {
    const totalPages = chunks.length > 0 ? chunks[chunks.length - 1].endPage : 0;
    const prompt = this.createMindmapConsolidationPrompt(chunkMindmaps, fileName, totalPages);

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

      let finalMindmap = '';
      for await (const textChunk of response.text) {
        finalMindmap += textChunk;
        if (token.isCancellationRequested) {
          break;
        }
      }

      return finalMindmap.trim();
    } catch (error) {
      TextProcessor.logger.error('Error consolidating mindmaps', error);
      // Fallback: create simple combined mindmap
      const baseName = fileName.replace(/\.pdf$/i, '');
      const combinedBranches = chunkMindmaps
        .map((mindmap, index) => `    Section${index + 1}[${mindmap.substring(0, 50)}...]`)
        .join('\n');

      return `mindmap\n  root((${baseName}))\n${combinedBranches}\n\n*Note: Automatic consolidation failed, showing section breakdown.*`;
    }
  }

  private async handleMindmapFallback(
    text: string,
    fileName: string,
    model: vscode.LanguageModelChat,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    originalError?: string
  ): Promise<ChatCommandResult> {
    stream.markdown('⚠️ Enhanced mindmap generation failed, using fallback approach...\n\n');

    const shortExcerpt = `${text.substring(0, 1000)}...\n\n[Showing excerpt only]`;
    const fallbackPrompt = `Create a simple Mermaid mindmap from this PDF excerpt:\n\n${shortExcerpt}`;

    try {
      const fallbackResponse = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(fallbackPrompt)],
        {},
        token
      );

      stream.markdown('## 🗺️ PDF Mindmap (Excerpt)\n\n```mermaid\n');

      let fallbackMindmapText = '';
      for await (const chunk of fallbackResponse.text) {
        fallbackMindmapText += chunk;
        stream.markdown(chunk);
        if (token.isCancellationRequested) {
          break;
        }
      }

      stream.markdown('\n```\n\n');
      stream.markdown(
        '\n\n⚠️ *Note: Mindmap based on document excerpt only due to size constraints.*'
      );

      return {
        metadata: {
          command: 'mindmap',
          file: fileName,
          processingStrategy: 'fallback',
          originalError,
          timestamp: Date.now(),
        },
        mindmapText: fallbackMindmapText.trim(),
      };
    } catch (_fallbackError) {
      stream.markdown(
        `❌ Both enhanced and fallback mindmap generation failed: ${originalError}\n\n`
      );
      throw new ModelRequestError(`Mindmap generation failed: ${originalError}`);
    }
  }

  private createSingleChunkMindmapPrompt(fileName: string, text: string): string {
    return `Create a Mermaid mindmap from this PDF document:

**File:** ${fileName}
**Strategy:** Full content analysis

**Content:**
${text}

Generate a comprehensive Mermaid mindmap using proper syntax:
1. Start with "mindmap" declaration
2. Use root node with document title: root((Document Title))
3. Create main branches for key topics
4. Add sub-branches for important details
5. Use clear, concise node labels
6. Structure hierarchically to show relationships

Example format:
\`\`\`
mindmap
  root((Document Title))
    Topic1
      SubTopic1
      SubTopic2
    Topic2
      SubTopic3
        Detail1
        Detail2
    Topic3
      SubTopic4
\`\`\`

Focus on the document's main themes, key findings, and logical structure.`;
  }

  private createChunkMindmapPrompt(chunk: DocumentChunk, fileName: string): string {
    return `Create a Mermaid mindmap section from this part of the PDF document:

**File:** ${fileName}
**Section:** Pages ${chunk.startPage}-${chunk.endPage} (Chunk ${chunk.index + 1})
**Content:**
${chunk.content}

Generate mindmap branches for this section that can be integrated into a larger mindmap:
1. Identify the main topics in this section
2. Create branches with clear, concise labels
3. Include important sub-topics and details
4. Use proper Mermaid mindmap syntax
5. Focus on content that will be meaningful in the overall document structure

Return only the branch structure (no "mindmap" declaration or root node), like:
\`\`\`
    MainConcept1
      SubConcept1
      SubConcept2
    MainConcept2
      SubConcept3
        Detail1
\`\`\``;
  }

  private createMindmapConsolidationPrompt(
    mindmaps: string[],
    fileName: string,
    totalPages: number
  ): string {
    const combinedMindmaps = mindmaps
      .map((mindmap, index) => `## Section ${index + 1}\n${mindmap}`)
      .join('\n\n');

    return `Create a unified Mermaid mindmap from these section mindmaps of a PDF document:

**File:** ${fileName}
**Total Pages:** ${totalPages}
**Section Mindmaps:**
${combinedMindmaps}

Create a comprehensive mindmap that:
1. Starts with "mindmap" declaration
2. Uses a root node with the document title: root((Document Title))
3. Organizes all section content into logical main branches
4. Maintains hierarchical structure showing relationships
5. Eliminates redundancy while preserving important details
6. Uses clear, concise node labels
7. Creates a coherent flow that represents the entire document

The final mindmap should give readers a complete visual understanding of the document's structure and key concepts using proper Mermaid syntax.`;
  }
}
