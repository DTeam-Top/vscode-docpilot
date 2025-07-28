import * as vscode from 'vscode';
import { ChatParticipant } from './chat/chatParticipant';
import { OpenLocalPdfCommand } from './commands/openLocalPdf';
import { OpenPdfFromUrlCommand } from './commands/openPdfFromUrl';
import { PdfCustomEditorProvider } from './editors/pdfCustomEditor';
import { Logger } from './utils/logger';

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

    // Register custom PDF editor for automatic activation when opening PDFs via File -> Open
    context.subscriptions.push(PdfCustomEditorProvider.register(context));

    logger.info('DocPilot extension activated successfully');

    // Log activation telemetry (if needed)
    logger.info('Extension activation complete', {
      chatParticipantId: 'docpilot.chat-participant',
      commandsRegistered: ['docpilot.openLocalPdf', 'docpilot.openPdfFromUrl'],
      customEditorRegistered: 'docpilot.pdfEditor',
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error('Failed to activate DocPilot extension', error);
    vscode.window.showErrorMessage(
      `DocPilot activation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export function deactivate(): void {
  const logger = Logger.getInstance();
  logger.info('Deactivating DocPilot extension...');

  try {
    logger.dispose();
  } catch (error) {
    console.error('Error during DocPilot deactivation:', error);
  }
}
