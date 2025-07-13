import { TokenEstimator } from '../utils/tokenEstimator';
import { Logger } from '../utils/logger';
import { CONFIG } from '../utils/constants';
import type { ChunkingConfig, DocumentChunk } from '../types/interfaces';

export class ChunkingStrategy {
  private static readonly logger = Logger.getInstance();

  static getDefaultConfig(maxInputTokens: number): ChunkingConfig {
    const maxTokensPerChunk = TokenEstimator.getOptimalChunkSize(maxInputTokens);

    return {
      maxTokensPerChunk,
      overlapRatio: CONFIG.TEXT_PROCESSING.OVERLAP_RATIO,
      sentenceBoundary: true,
      paragraphBoundary: true,
    };
  }

  static createSemanticChunks(pdfText: string, config: ChunkingConfig): DocumentChunk[] {
    this.logger.info('Creating semantic chunks', {
      textLength: pdfText.length,
      config,
    });

    const chunks: DocumentChunk[] = [];
    const pages = pdfText.split(/--- Page (\d+) ---/);

    let currentChunk = '';
    let currentTokens = 0;
    let chunkStartPage = 1;
    let chunkIndex = 0;

    for (let i = 1; i < pages.length; i += 2) {
      const pageNumber = parseInt(pages[i], 10);
      const pageContent = pages[i + 1]?.trim() || '';

      if (!pageContent) continue;

      // Split by paragraphs for semantic boundaries
      const paragraphs = config.paragraphBoundary
        ? this.splitIntoParagraphs(pageContent)
        : [pageContent];

      for (const paragraph of paragraphs) {
        if (!paragraph.trim()) continue;

        const paragraphTokens = TokenEstimator.estimate(paragraph);

        // Check if adding this paragraph would exceed chunk size
        if (currentTokens + paragraphTokens > config.maxTokensPerChunk && currentChunk) {
          // Create chunk with current content
          chunks.push(
            this.createChunk(
              currentChunk.trim(),
              chunkIndex++,
              chunkStartPage,
              pageNumber - 1,
              currentTokens
            )
          );

          // Start new chunk with overlap
          const overlapContent = this.createOverlap(currentChunk, config.overlapRatio);
          currentChunk = `${overlapContent}\n\n${paragraph}`;
          currentTokens = TokenEstimator.estimate(currentChunk);
          chunkStartPage = pageNumber;
        } else {
          // Add paragraph to current chunk
          if (currentChunk) {
            currentChunk += `\n\n${paragraph}`;
          } else {
            currentChunk = paragraph;
            chunkStartPage = pageNumber;
          }
          currentTokens += paragraphTokens;
        }
      }
    }

    // Add final chunk if there's remaining content
    if (currentChunk.trim()) {
      chunks.push(
        this.createChunk(
          currentChunk.trim(),
          chunkIndex,
          chunkStartPage,
          parseInt(pages[pages.length - 2], 10) || chunkStartPage,
          currentTokens
        )
      );
    }

    this.logger.info(`Created ${chunks.length} semantic chunks`);
    return chunks;
  }

  private static splitIntoParagraphs(text: string): string[] {
    return text
      .split(/\n\s*\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  private static createOverlap(text: string, overlapRatio: number): string {
    const overlapSize = Math.floor(text.length * overlapRatio);
    return text.slice(-overlapSize);
  }

  private static createChunk(
    content: string,
    index: number,
    startPage: number,
    endPage: number,
    tokens: number
  ): DocumentChunk {
    return {
      content,
      index,
      startPage,
      endPage,
      tokens,
    };
  }

  static estimateProcessingTime(chunks: DocumentChunk[]): number {
    // Rough estimation: 2-5 seconds per chunk
    const baseTimePerChunk = 3000; // 3 seconds
    const variabilityFactor = 0.5; // ±50%

    return chunks.length * baseTimePerChunk * (1 + variabilityFactor);
  }

  static validateChunks(chunks: DocumentChunk[], config: ChunkingConfig): boolean {
    for (const chunk of chunks) {
      if (chunk.tokens > config.maxTokensPerChunk * 1.1) {
        // Allow 10% tolerance
        this.logger.warn(`Chunk ${chunk.index} exceeds token limit`, {
          chunkTokens: chunk.tokens,
          limit: config.maxTokensPerChunk,
        });
        return false;
      }
    }
    return true;
  }
}
