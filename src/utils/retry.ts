import type { RetryOptions } from '../types/interfaces';
import { Logger } from './logger';

// biome-ignore lint/complexity/noStaticOnlyClass: This follows existing extension patterns
export class RetryPolicy {
  private static readonly logger = Logger.getInstance();

  static async withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const { maxAttempts = 3, backoffMs = 1000, shouldRetry = () => true } = options;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        RetryPolicy.logger.debug(`Attempt ${attempt}/${maxAttempts}`);
        return await operation();
      } catch (error) {
        lastError = error as Error;

        RetryPolicy.logger.warn(`Attempt ${attempt} failed: ${lastError.message}`);

        if (attempt === maxAttempts || !shouldRetry(error)) {
          throw error;
        }

        const delay = backoffMs * 2 ** (attempt - 1); // Exponential backoff
        RetryPolicy.logger.debug(`Retrying in ${delay}ms...`);
        await RetryPolicy.delay(delay);
      }
    }

    if (lastError) {
      throw lastError;
    }
    throw new Error('Operation failed after all retries');
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static shouldRetryNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('ECONNRESET') ||
      message.includes('ENOTFOUND')
    );
  }

  static shouldRetryModelError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const message = error.message.toLowerCase();
    return (
      message.includes('rate limit') ||
      message.includes('quota exceeded') ||
      message.includes('service unavailable') ||
      message.includes('timeout')
    );
  }
}
