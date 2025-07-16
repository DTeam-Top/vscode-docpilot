import * as vscode from 'vscode';
import * as path from 'node:path';
import { Logger } from '../utils/logger';
import { WebviewProvider } from '../webview/webviewProvider';

export class PdfCustomEditorProvider implements vscode.CustomReadonlyEditorProvider {
  private static readonly logger = Logger.getInstance();

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new PdfCustomEditorProvider(context);
    return vscode.window.registerCustomEditorProvider('docpilot.pdfEditor', provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    });
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CustomDocument> {
    return {
      uri,
      dispose: () => {
        // Cleanup resources if needed
      },
    };
  }

  public async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    PdfCustomEditorProvider.logger.info(
      `Opening PDF file via custom editor: ${document.uri.fsPath}`
    );

    // Check if there's already a viewer for this file
    const existingPanel = WebviewProvider.getExistingViewer(document.uri.fsPath);
    if (existingPanel) {
      // Close the new panel that VS Code created and reveal the existing one
      webviewPanel.dispose();
      existingPanel.reveal(vscode.ViewColumn.One);
      PdfCustomEditorProvider.logger.info(`Reusing existing viewer for: ${document.uri.fsPath}`);
      return;
    }

    // Configure webview with proper options
    const pdfDirectory = vscode.Uri.file(path.dirname(document.uri.fsPath));

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview'),
        pdfDirectory,
      ],
    };

    // Delegate to existing WebviewProvider for consistent functionality
    webviewPanel.webview.html = WebviewProvider.getWebviewContent(
      webviewPanel.webview,
      document.uri.fsPath,
      this.context
    );

    // Set up the same message handling as WebviewProvider
    this.setupMessageHandling(webviewPanel, document.uri.fsPath);

    // Set a proper title for the panel
    const fileName = path.basename(document.uri.fsPath);
    webviewPanel.title = `📄 ${fileName}`;

    // Register this panel in the tracking system (important!)
    this.registerPanelInTracking(webviewPanel, document.uri.fsPath);

    PdfCustomEditorProvider.logger.info(`PDF custom editor resolved for: ${document.uri.fsPath}`);
  }

  private registerPanelInTracking(panel: vscode.WebviewPanel, pdfPath: string): void {
    // Register this panel in WebviewProvider's tracking system
    WebviewProvider.registerExternalPanel(pdfPath, panel);
  }

  private setupMessageHandling(panel: vscode.WebviewPanel, pdfSource: string): void {
    // Use the same message handling pattern as WebviewProvider
    panel.webview.onDidReceiveMessage(async (message) => {
      // Import constants dynamically to match WebviewProvider pattern
      const { WEBVIEW_MESSAGES } = await import('../utils/constants');

      switch (message.type) {
        case WEBVIEW_MESSAGES.SUMMARIZE_REQUEST:
          await this.handleSummarizeRequest(panel, pdfSource);
          break;
        case WEBVIEW_MESSAGES.SUMMARIZE_ERROR:
          PdfCustomEditorProvider.logger.error('Webview summarization error:', message.error);
          vscode.window.showErrorMessage(`Summarization failed: ${message.error}`);
          break;
        case WEBVIEW_MESSAGES.EXPORT_TEXT:
          await this.handleExportRequest(panel, pdfSource);
          break;
        case WEBVIEW_MESSAGES.EXPORT_ERROR:
          PdfCustomEditorProvider.logger.error('Webview export error:', message.error);
          vscode.window.showErrorMessage(`Export failed: ${message.error}`);
          break;
        case WEBVIEW_MESSAGES.EXTRACT_ALL_TEXT:
        case WEBVIEW_MESSAGES.TEXT_EXTRACTED:
        case WEBVIEW_MESSAGES.TEXT_EXTRACTION_ERROR:
          PdfCustomEditorProvider.logger.debug('Text extraction message received:', message.type);
          break;
        default:
          PdfCustomEditorProvider.logger.debug('Unhandled webview message:', message.type);
          break;
      }
    });
  }

  private async handleSummarizeRequest(
    panel: vscode.WebviewPanel,
    pdfSource: string
  ): Promise<void> {
    try {
      PdfCustomEditorProvider.logger.info('Handling summarize request from custom editor', {
        pdfSource,
      });

      const { WEBVIEW_MESSAGES } = await import('../utils/constants');

      // Notify webview that summarization has started
      panel.webview.postMessage({
        type: WEBVIEW_MESSAGES.SUMMARIZE_STARTED,
      });

      // Open chat view first
      await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');

      // Create and send a chat request
      const chatInput = `@docpilot /summarise ${pdfSource}`;

      // Insert the chat command into the chat input
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: chatInput,
      });

      // Notify webview that summarization completed
      panel.webview.postMessage({
        type: WEBVIEW_MESSAGES.SUMMARIZE_COMPLETED,
      });

      PdfCustomEditorProvider.logger.info('Summarize request processed successfully');
    } catch (error) {
      PdfCustomEditorProvider.logger.error('Failed to handle summarize request', error);

      const { WEBVIEW_MESSAGES } = await import('../utils/constants');

      // Notify webview of error
      panel.webview.postMessage({
        type: WEBVIEW_MESSAGES.SUMMARIZE_ERROR,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      vscode.window.showErrorMessage(
        `Failed to summarize PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleExportRequest(panel: vscode.WebviewPanel, pdfSource: string): Promise<void> {
    try {
      PdfCustomEditorProvider.logger.info('Handling export request from custom editor', {
        pdfSource,
      });

      const { WEBVIEW_MESSAGES } = await import('../utils/constants');

      // Notify webview that export has started
      panel.webview.postMessage({
        type: WEBVIEW_MESSAGES.EXPORT_STARTED,
      });

      // Use the WebviewProvider's export method
      const { WebviewProvider } = await import('../webview/webviewProvider');
      await WebviewProvider.exportPdfToMarkdown(panel, pdfSource);

      // Notify webview that export completed
      panel.webview.postMessage({
        type: WEBVIEW_MESSAGES.EXPORT_COMPLETED,
      });

      PdfCustomEditorProvider.logger.info('Export request processed successfully');
    } catch (error) {
      PdfCustomEditorProvider.logger.error('Failed to handle export request', error);

      const { WEBVIEW_MESSAGES } = await import('../utils/constants');

      // Notify webview of error
      panel.webview.postMessage({
        type: WEBVIEW_MESSAGES.EXPORT_ERROR,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      vscode.window.showErrorMessage(
        `Failed to export PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
