import * as vscode from 'vscode';
import { InvalidFilePathError } from '../utils/errors';
import { Logger } from '../utils/logger';
import { WebviewProvider } from '../webview/webviewProvider';
import { WebviewUtils } from '../utils/webviewUtils';

// biome-ignore lint/complexity/noStaticOnlyClass: This follows existing extension patterns
export class OpenPdfFromUrlCommand {
  private static readonly logger = Logger.getInstance();

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('docpilot.openPdfFromUrl', async () => {
      try {
        await OpenPdfFromUrlCommand.execute(context);
      } catch (error) {
        OpenPdfFromUrlCommand.logger.error('Failed to open PDF from URL', error);
        vscode.window.showErrorMessage(
          `Failed to open PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  private static async execute(context: vscode.ExtensionContext): Promise<void> {
    OpenPdfFromUrlCommand.logger.info('Prompting for PDF URL');

    const url = await vscode.window.showInputBox({
      prompt: 'Enter PDF URL',
      placeHolder: 'https://example.com/document.pdf',
      validateInput: (value) => {
        if (!value) {
          return 'URL is required';
        }

        if (!value.startsWith('http://') && !value.startsWith('https://')) {
          return 'URL must start with http:// or https://';
        }

        if (!WebviewProvider.validatePdfPath(value)) {
          return 'URL must point to a PDF file';
        }

        return null;
      },
    });

    if (!url) {
      OpenPdfFromUrlCommand.logger.info('No URL provided');
      return;
    }

    OpenPdfFromUrlCommand.logger.info(`Opening PDF from URL: ${url}`);

    try {
      // Validate URL format
      new URL(url);
    } catch {
      throw new InvalidFilePathError(`Invalid URL format: ${url}`);
    }

    if (!WebviewProvider.validatePdfPath(url)) {
      throw new InvalidFilePathError(`URL does not appear to be a PDF: ${url}`);
    }

    // Create and show PDF viewer using shared utility
    WebviewUtils.createAndRevealPdfViewer({
      title: `📄 Remote PDF`,
      source: url,
      context,
      viewColumn: vscode.ViewColumn.One,
      successMessage: `Opening PDF from: ${new URL(url).hostname}`,
    });
  }
}
