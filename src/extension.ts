import * as vscode from 'vscode';
import { ChatParticipant } from './chat/chatParticipant';
import { OpenLocalPdfCommand } from './commands/openLocalPdf';
import { OpenPdfFromUrlCommand } from './commands/openPdfFromUrl';
import { QuickPromptsCommand } from './commands/quickPromptsCommand';
import { registerToggleRevealModeCommand } from './commands/toggleRevealModeCommand';
import { PdfCustomEditorProvider } from './editors/pdfCustomEditor';
import { Logger } from './utils/logger';
import { configuration } from './utils/configuration';

export function activate(context: vscode.ExtensionContext): void {
  const logger = Logger.getInstance();
  logger.info('Activating DocPilot extension...');

  try {
    // Register chat participant
    const chatParticipant = ChatParticipant.register(context);
    context.subscriptions.push(chatParticipant);

    // Register standard commands
    context.subscriptions.push(
      OpenLocalPdfCommand.register(context),
      OpenPdfFromUrlCommand.register(context),
      QuickPromptsCommand.register(context),
      registerToggleRevealModeCommand(context)
    );

    // Register custom PDF editor for automatic activation when opening PDFs via File -> Open
    context.subscriptions.push(PdfCustomEditorProvider.register(context));

    // Watch for configuration changes and refresh settings
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('docpilot')) {
          configuration.refresh();
          logger.info('DocPilot configuration refreshed', {
            quickPromptsCount: configuration.quickPrompts.length,
          });
        }
      })
    );

    logger.info('DocPilot extension activated successfully');

    // Log activation telemetry (if needed)
    logger.info('Extension activation complete', {
      chatParticipantId: 'docpilot.chat-participant',
      commandsRegistered: [
        'docpilot.openLocalPdf',
        'docpilot.openPdfFromUrl',
        'docpilot.quickPrompts',
        'docpilot.toggleRevealMode',
      ],
      customEditorRegistered: 'docpilot.pdfEditor',
      customPromptsCount: configuration.quickPrompts.length,
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
