import * as vscode from 'vscode';
import { InvalidFilePathError } from '../utils/errors';
import { Logger } from '../utils/logger';
import { WebviewProvider } from '../webview/webviewProvider';
import { WebviewUtils } from '../utils/webviewUtils';
import { PdfProxy } from '../utils/pdfProxy';

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

    // Try to open PDF directly first, with fallback to proxy
    try {
      // Create and show PDF viewer using shared utility
      const panel = WebviewUtils.createAndRevealPdfViewer({
        title: `📄 Remote PDF`,
        source: url,
        context,
        viewColumn: vscode.ViewColumn.One,
        successMessage: `Opening PDF from: ${new URL(url).hostname}`,
      });

      // Set up message handling for fallback actions
      OpenPdfFromUrlCommand.setupFallbackHandling(panel, url, context);
      
      // Clean up old cached PDFs
      PdfProxy.cleanupCache();
    } catch (error) {
      OpenPdfFromUrlCommand.logger.error('Failed to open PDF directly, trying proxy', error);
      await OpenPdfFromUrlCommand.tryProxyDownload(url, context);
    }
  }

  private static setupFallbackHandling(
    panel: vscode.WebviewPanel,
    originalUrl: string,
    context: vscode.ExtensionContext
  ): void {
    panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'downloadPdfFallback':
          await OpenPdfFromUrlCommand.tryProxyDownload(originalUrl, context);
          break;
        case 'openInBrowser':
          await vscode.env.openExternal(vscode.Uri.parse(originalUrl));
          break;
        case 'textExtractionError':
          // Handle CORS errors by automatically trying proxy
          if (message.isCorsError && message.isUrl) {
            OpenPdfFromUrlCommand.logger.info('CORS error detected, attempting proxy download');
            await OpenPdfFromUrlCommand.tryProxyDownload(originalUrl, context);
          }
          break;
      }
    });
  }

  private static async tryProxyDownload(url: string, context: vscode.ExtensionContext): Promise<void> {
    try {
      OpenPdfFromUrlCommand.logger.info(`Attempting to download PDF via proxy: ${url}`);
      
      // Show progress indicator
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Downloading PDF...',
        cancellable: false
      }, async (progress) => {
        progress.report({ message: 'Downloading from server...' });
        
        const localPath = await PdfProxy.downloadPdf(url);
        
        progress.report({ message: 'Opening PDF...' });
        
        // Create PDF viewer with local path
        WebviewUtils.createAndRevealPdfViewer({
          title: `📄 ${new URL(url).hostname}`,
          source: localPath,
          context,
          viewColumn: vscode.ViewColumn.One,
          successMessage: `PDF downloaded and opened from: ${new URL(url).hostname}`,
        });
      });
    } catch (error) {
      OpenPdfFromUrlCommand.logger.error('Failed to download PDF via proxy', error);
      vscode.window.showErrorMessage(
        `Failed to download PDF: ${error instanceof Error ? error.message : 'Unknown error'}. Try opening the PDF directly in your browser.`
      );
    }
  }
}
