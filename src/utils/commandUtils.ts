import * as vscode from 'vscode';
import type { Logger } from './logger';

export function createCommandHandler(
  commandId: string,
  handler: (...args: any[]) => any,
  logger: Logger,
  errorContext: string
) {
  return vscode.commands.registerCommand(commandId, async (...args: any[]) => {
    try {
      return await handler(...args);
    } catch (error) {
      logger.error(`Failed to execute ${errorContext}`, error);
      vscode.window.showErrorMessage(
        `Failed to ${errorContext}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      throw error;
    }
  });
}
