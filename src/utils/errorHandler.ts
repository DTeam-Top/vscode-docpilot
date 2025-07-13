import * as vscode from 'vscode';
import { DocPilotError } from './errors';
import { Logger } from './logger';
import type { ChatCommandResult } from '../types/interfaces';

export class ChatErrorHandler {
  private static readonly logger = Logger.getInstance();

  static handle(
    error: unknown,
    stream: vscode.ChatResponseStream,
    context: string
  ): ChatCommandResult {
    const errorInfo = this.analyzeError(error);

    this.logger.error(`Error in ${context}`, error);

    // Send user-friendly message to chat
    stream.markdown(`❌ ${this.getUserMessage(errorInfo, context)}`);

    // Add technical details for debugging
    if (errorInfo.isDocPilotError) {
      stream.markdown(`\n*Error Code: ${errorInfo.code}*`);
    }

    return {
      metadata: {
        error: errorInfo.message,
        code: errorInfo.code,
        context,
        timestamp: Date.now(),
        category: errorInfo.category,
      },
    };
  }

  private static analyzeError(error: unknown): ErrorAnalysis {
    if (error instanceof DocPilotError) {
      return {
        message: error.message,
        code: error.code,
        category: error.category,
        isDocPilotError: true,
        isRecoverable: error.category !== 'user',
      };
    }

    if (error instanceof Error) {
      return {
        message: error.message,
        code: 'UNKNOWN_ERROR',
        category: 'system',
        isDocPilotError: false,
        isRecoverable: true,
      };
    }

    return {
      message: 'An unknown error occurred',
      code: 'UNKNOWN_ERROR',
      category: 'system',
      isDocPilotError: false,
      isRecoverable: true,
    };
  }

  private static getUserMessage(errorInfo: ErrorAnalysis, context: string): string {
    const baseMessage = `${context} failed: ${errorInfo.message}`;

    switch (errorInfo.category) {
      case 'user':
        return `${baseMessage}\n\nPlease check your input and try again.`;

      case 'network':
        return `${baseMessage}\n\nThis appears to be a network issue. Please check your connection and try again.`;

      case 'system':
        if (errorInfo.isRecoverable) {
          return `${baseMessage}\n\nThis is a temporary issue. Please try again in a moment.`;
        }
        return `${baseMessage}\n\nPlease check the output panel for more details.`;

      default:
        return baseMessage;
    }
  }

  static handleWithFallback<T>(
    operation: () => Promise<T>,
    fallback: () => Promise<T>,
    stream: vscode.ChatResponseStream,
    context: string
  ): Promise<T> {
    return operation().catch(async (error) => {
      this.logger.warn(`${context} failed, attempting fallback`, error);
      stream.markdown(`⚠️ ${context} encountered an issue, trying alternative approach...\n\n`);

      try {
        return await fallback();
      } catch (fallbackError) {
        this.logger.error(`Fallback also failed for ${context}`, fallbackError);
        throw error; // Throw original error
      }
    });
  }
}

interface ErrorAnalysis {
  message: string;
  code: string;
  category: 'user' | 'system' | 'network';
  isDocPilotError: boolean;
  isRecoverable: boolean;
}
