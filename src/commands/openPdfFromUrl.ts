import * as vscode from 'vscode';
import { createCommandHandler } from '../utils/commandUtils';
import { InvalidFilePathError } from '../utils/errors';
import { Logger } from '../utils/logger';
import * as PdfProxy from '../utils/pdfProxy';
import { WebviewUtils } from '../utils/webviewUtils';
import { WebviewProvider } from '../webview/webviewProvider';

export class OpenPdfFromUrlCommand {
  private static readonly logger = Logger.getInstance();

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return createCommandHandler(
      'docpilot.openPdfFromUrl',
      (url?: string) => OpenPdfFromUrlCommand.execute(context, url),
      OpenPdfFromUrlCommand.logger,
      'open PDF from URL'
    );
  }

  private static async execute(
    context: vscode.ExtensionContext,
    providedUrl?: string
  ): Promise<vscode.WebviewPanel | undefined> {
    let url: string;

    if (providedUrl) {
      // Use provided URL (for programmatic calls)
      url = providedUrl;
      OpenPdfFromUrlCommand.logger.info(`Opening PDF from URL: ${url}`);
    } else {
      // Prompt for URL for user interaction
      OpenPdfFromUrlCommand.logger.info('Prompting for PDF URL');

      const inputUrl = await vscode.window.showInputBox({
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

      if (!inputUrl) {
        OpenPdfFromUrlCommand.logger.info('No URL provided');
        return undefined;
      }

      url = inputUrl;
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

      return panel;
    } catch (error) {
      OpenPdfFromUrlCommand.logger.error('Failed to open PDF directly, trying proxy', error);
      const panel = await OpenPdfFromUrlCommand.tryProxyDownload(url, context);
      return panel;
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
          await OpenPdfFromUrlCommand.tryProxyDownload(originalUrl, context, panel);
          break;
        case 'openInBrowser':
          await vscode.env.openExternal(vscode.Uri.parse(originalUrl));
          break;
        case 'textExtractionError':
          // Handle CORS errors by automatically trying proxy
          if (message.isCorsError && message.isUrl) {
            OpenPdfFromUrlCommand.logger.info('CORS error detected, attempting proxy download');
            await OpenPdfFromUrlCommand.tryProxyDownload(originalUrl, context, panel);
          }
          break;
      }
    });
  }

  private static async tryProxyDownload(
    url: string,
    context: vscode.ExtensionContext,
    originalPanel?: vscode.WebviewPanel
  ): Promise<vscode.WebviewPanel | undefined> {
    try {
      OpenPdfFromUrlCommand.logger.info(`Attempting to download PDF via proxy: ${url}`);

      // Show progress indicator
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Downloading PDF...',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Downloading from server...' });

          const localPath = await PdfProxy.downloadPdf(url);

          progress.report({ message: 'Opening PDF...' });

          // Create PDF viewer with local path
          const panel = WebviewUtils.createAndRevealPdfViewer({
            title: `📄 ${new URL(url).hostname}`,
            source: localPath,
            context,
            viewColumn: vscode.ViewColumn.One,
            successMessage: `PDF downloaded and opened from: ${new URL(url).hostname}`,
          });

          // Close the original panel that showed the error
          if (originalPanel) {
            originalPanel.dispose();
            OpenPdfFromUrlCommand.logger.info(
              'Closed original PDF viewer after successful proxy download'
            );
          }

          return panel;
        }
      );
    } catch (error) {
      OpenPdfFromUrlCommand.logger.error('Failed to download PDF via proxy', error);
      vscode.window.showErrorMessage(
        `Failed to download PDF: ${error instanceof Error ? error.message : 'Unknown error'}. Try opening the PDF directly in your browser.`
      );
      return undefined;
    }
  }
}
