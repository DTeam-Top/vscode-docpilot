import type { RetryOptions } from '../types/interfaces';
import { Logger } from './logger';

export class RetryPolicy {
  private static readonly logger = Logger.getInstance();

  static async withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const { maxAttempts = 3, backoffMs = 1000, shouldRetry = () => true } = options;

    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.logger.debug(`Attempt ${attempt}/${maxAttempts}`);
        return await operation();
      } catch (error) {
        lastError = error as Error;

        this.logger.warn(`Attempt ${attempt} failed: ${lastError.message}`);

        if (attempt === maxAttempts || !shouldRetry(error)) {
          throw error;
        }

        const delay = backoffMs * Math.pow(2, attempt - 1); // Exponential backoff
        this.logger.debug(`Retrying in ${delay}ms...`);
        await this.delay(delay);
      }
    }

    throw lastError!;
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
