import * as vscode from 'vscode';
import { WebviewProvider } from '../webview/webviewProvider';
import { Logger } from '../utils/logger';
import { PdfLoadError } from '../utils/errors';

export class OpenLocalPdfCommand {
  private static readonly logger = Logger.getInstance();

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('docpilot.openLocalPdf', async () => {
      try {
        await this.execute(context);
      } catch (error) {
        this.logger.error('Failed to open local PDF', error);
        vscode.window.showErrorMessage(
          `Failed to open PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  private static async execute(context: vscode.ExtensionContext): Promise<void> {
    this.logger.info('Opening local PDF file picker');

    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'PDF Files': ['pdf'],
      },
      title: 'Select PDF file to open',
    });

    if (!result || result.length === 0) {
      this.logger.info('No file selected');
      return;
    }

    const filePath = result[0].fsPath;
    this.logger.info(`Selected PDF file: ${filePath}`);

    if (!WebviewProvider.validatePdfPath(filePath)) {
      throw new PdfLoadError(filePath, new Error('Invalid PDF file'));
    }

    // Create and show PDF viewer
    const panel = WebviewProvider.createPdfViewer(filePath, context);

    // Focus the panel
    panel.reveal(vscode.ViewColumn.One);

    this.logger.info(`PDF viewer created for: ${filePath}`);

    // Show success message
    vscode.window.showInformationMessage(`Opened PDF: ${result[0].path.split('/').pop()}`);
  }
}
