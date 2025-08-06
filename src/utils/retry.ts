import type { RetryOptions } from '../types/interfaces';
import { Logger } from './logger';

const logger = Logger.getInstance();

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, backoffMs = 1000, shouldRetry = () => true } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.debug(`Attempt ${attempt}/${maxAttempts}`);
      return await operation();
    } catch (error) {
      lastError = error as Error;

      logger.warn(`Attempt ${attempt} failed: ${lastError.message}`);

      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      const backoff = backoffMs * 2 ** (attempt - 1); // Exponential backoff
      logger.debug(`Retrying in ${backoff}ms...`);
      await delay(backoff);
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error('Operation failed after all retries');
}

export function shouldRetryNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('econnreset') ||
    message.includes('enotfound')
  );
}

export function shouldRetryModelError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes('rate limit') ||
    message.includes('quota exceeded') ||
    message.includes('service unavailable') ||
    message.includes('timeout')
  );
}
