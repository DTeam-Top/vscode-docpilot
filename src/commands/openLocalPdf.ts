import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { PdfLoadError } from '../utils/errors';
import { Logger } from '../utils/logger';
import { WebviewUtils } from '../utils/webviewUtils';
import { WebviewProvider } from '../webview/webviewProvider';

// biome-ignore lint/complexity/noStaticOnlyClass: This follows existing extension patterns
export class OpenLocalPdfCommand {
  private static readonly logger = Logger.getInstance();

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('docpilot.openLocalPdf', async (filePath?: string) => {
      try {
        return await OpenLocalPdfCommand.execute(context, filePath);
      } catch (error) {
        OpenLocalPdfCommand.logger.error('Failed to open local PDF', error);

        // Show user-friendly error message
        vscode.window.showErrorMessage(
          `Failed to open PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
        );

        // Re-throw for test catching
        throw error;
      }
    });
  }

  private static async execute(
    context: vscode.ExtensionContext,
    filePath?: string
  ): Promise<vscode.WebviewPanel | undefined> {
    let selectedFilePath: string;

    if (filePath) {
      // Use provided file path (for programmatic calls)
      selectedFilePath = filePath;
      OpenLocalPdfCommand.logger.info(`Opening PDF file: ${filePath}`);
    } else {
      // Show file picker for user interaction
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
        return undefined;
      }

      selectedFilePath = result[0].fsPath;
    }

    const selectedFile = selectedFilePath;
    OpenLocalPdfCommand.logger.info(`Selected PDF file: ${selectedFile}`);

    // Check if file exists for local files (not URLs)
    if (!selectedFile.startsWith('http') && !fs.existsSync(selectedFile)) {
      throw new PdfLoadError(selectedFile, new Error(`File not found: ${selectedFile}`));
    }

    if (!WebviewProvider.validatePdfPath(selectedFile)) {
      throw new PdfLoadError(selectedFile, new Error('Invalid PDF file'));
    }

    // Create and show PDF viewer using shared utility
    const panel = WebviewUtils.createAndRevealPdfViewer({
      title: `📄 ${selectedFile.split('/').pop()}`,
      source: selectedFile,
      context,
      viewColumn: vscode.ViewColumn.One,
      successMessage: `Opened PDF: ${selectedFile.split('/').pop()}`,
    });

    return panel;
  }
}
