import * as vscode from 'vscode';
import { ChatParticipant } from './chat/chatParticipant';
import { OpenLocalPdfCommand } from './commands/openLocalPdf';
import { OpenPdfFromUrlCommand } from './commands/openPdfFromUrl';
import { Logger } from './utils/logger';

/**
 * Extension activation function
 */
export function activate(context: vscode.ExtensionContext): void {
  const logger = Logger.getInstance();
  logger.info('Activating DocPilot extension...');

  try {
    // Register chat participant
    const chatParticipant = ChatParticipant.register(context);
    context.subscriptions.push(chatParticipant);

    // Register commands
    context.subscriptions.push(
      OpenLocalPdfCommand.register(context),
      OpenPdfFromUrlCommand.register(context)
    );

    logger.info('DocPilot extension activated successfully');

    // Log activation telemetry (if needed)
    logger.info('Extension activation complete', {
      chatParticipantId: 'docpilot.chat-participant',
      commandsRegistered: ['docpilot.openLocalPdf', 'docpilot.openPdfFromUrl'],
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error('Failed to activate DocPilot extension', error);
    vscode.window.showErrorMessage(
      `DocPilot activation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Extension deactivation function
 */
export function deactivate(): void {
  const logger = Logger.getInstance();
  logger.info('Deactivating DocPilot extension...');

  try {
    // Cleanup logger
    logger.dispose();

    // Any additional cleanup would go here
  } catch (error) {
    console.error('Error during DocPilot deactivation:', error);
  }
}
