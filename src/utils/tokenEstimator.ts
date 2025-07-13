import { CONFIG } from './constants';
import type { TokenEstimationResult } from '../types/interfaces';

export class TokenEstimator {
  static estimate(text: string): number {
    const baseTokens = Math.ceil(text.length / CONFIG.TEXT_PROCESSING.CHARS_PER_TOKEN);
    return Math.ceil(baseTokens * (1 + CONFIG.TEXT_PROCESSING.TOKEN_OVERHEAD_RATIO));
  }

  static estimateWithMetadata(text: string): TokenEstimationResult {
    const tokens = this.estimate(text);

    return {
      tokens,
      characters: text.length,
      estimationMethod: 'character-based',
      confidence: this.calculateConfidence(text),
    };
  }

  private static calculateConfidence(text: string): number {
    // Higher confidence for typical document text
    // Lower confidence for code, special characters, etc.
    const alphaNumericRatio = (text.match(/[a-zA-Z0-9\s]/g) || []).length / text.length;
    const averageWordLength =
      text.split(/\s+/).reduce((sum, word) => sum + word.length, 0) / text.split(/\s+/).length;

    // Typical English text has ~4-5 character average word length
    const wordLengthScore = Math.max(0, 1 - Math.abs(averageWordLength - 4.5) / 10);

    return Math.min(0.95, 0.5 + alphaNumericRatio * 0.3 + wordLengthScore * 0.2);
  }

  static getOptimalChunkSize(maxModelTokens: number): number {
    const promptOverhead = CONFIG.TEXT_PROCESSING.PROMPT_OVERHEAD_TOKENS;
    const usableTokens = maxModelTokens - promptOverhead;
    return Math.floor(usableTokens * CONFIG.TEXT_PROCESSING.CHUNK_SIZE_RATIO);
  }

  static tokensToCharacters(tokens: number): number {
    return Math.floor(tokens * CONFIG.TEXT_PROCESSING.CHARS_PER_TOKEN);
  }

  static charactersToTokens(characters: number): number {
    return Math.ceil(characters / CONFIG.TEXT_PROCESSING.CHARS_PER_TOKEN);
  }
}
