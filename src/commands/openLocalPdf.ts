import * as vscode from 'vscode';
import { PdfLoadError } from '../utils/errors';
import { Logger } from '../utils/logger';
import { WebviewProvider } from '../webview/webviewProvider';
import { WebviewUtils } from '../utils/webviewUtils';

// biome-ignore lint/complexity/noStaticOnlyClass: This follows existing extension patterns
export class OpenLocalPdfCommand {
  private static readonly logger = Logger.getInstance();

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('docpilot.openLocalPdf', async () => {
      try {
        await OpenLocalPdfCommand.execute(context);
      } catch (error) {
        OpenLocalPdfCommand.logger.error('Failed to open local PDF', error);
        vscode.window.showErrorMessage(
          `Failed to open PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  private static async execute(context: vscode.ExtensionContext): Promise<void> {
    OpenLocalPdfCommand.logger.info('Opening local PDF file picker');

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
      OpenLocalPdfCommand.logger.info('No file selected');
      return;
    }

    const filePath = result[0].fsPath;
    OpenLocalPdfCommand.logger.info(`Selected PDF file: ${filePath}`);

    if (!WebviewProvider.validatePdfPath(filePath)) {
      throw new PdfLoadError(filePath, new Error('Invalid PDF file'));
    }

    // Create and show PDF viewer using shared utility
    WebviewUtils.createAndRevealPdfViewer({
      title: `📄 ${result[0].path.split('/').pop()}`,
      source: filePath,
      context,
      viewColumn: vscode.ViewColumn.One,
      successMessage: `Opened PDF: ${result[0].path.split('/').pop()}`,
    });
  }
}
