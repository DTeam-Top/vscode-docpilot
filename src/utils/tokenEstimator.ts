import type { TokenEstimationResult } from '../types/interfaces';
import { configuration } from './configuration';

export function estimate(text: string): number {
    const baseTokens = Math.ceil(text.length / configuration.textProcessingCharsPerToken);
    return Math.ceil(baseTokens * (1 + configuration.textProcessingTokenOverheadRatio));
}

function calculateConfidence(text: string): number {
    // Higher confidence for typical document text
    // Lower confidence for code, special characters, etc.
    const alphaNumericRatio = (text.match(/[a-zA-Z0-9\s]/g) || []).length / text.length;
    const averageWordLength =
        text.split(/\s+/).reduce((sum, word) => sum + word.length, 0) / text.split(/\s+/).length;

    // Typical English text has ~4-5 character average word length
    const wordLengthScore = Math.max(0, 1 - Math.abs(averageWordLength - 4.5) / 10);

    return Math.min(0.95, 0.5 + alphaNumericRatio * 0.3 + wordLengthScore * 0.2);
}

export function estimateWithMetadata(text: string): TokenEstimationResult {
    const tokens = estimate(text);

    return {
        tokens,
        characters: text.length,
        estimationMethod: 'character-based',
        confidence: calculateConfidence(text),
    };
}

export function getOptimalChunkSize(maxModelTokens: number): number {
    const promptOverhead = configuration.textProcessingPromptOverheadTokens;
    const usableTokens = maxModelTokens - promptOverhead;
    return Math.floor(usableTokens * configuration.textProcessingChunkSizeRatio);
}

export function tokensToCharacters(tokens: number): number {
    return Math.floor(tokens * configuration.textProcessingCharsPerToken);
}

export function charactersToTokens(characters: number): number {
    return Math.ceil(characters / configuration.textProcessingCharsPerToken);
}
