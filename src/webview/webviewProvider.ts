import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { TextExtractor } from '../pdf/textExtractor';
import { ObjectExtractor } from '../pdf/objectExtractor';
import { WEBVIEW_MESSAGES } from '../utils/constants';
import { Logger } from '../utils/logger';
import type { ObjectExtractionRequest, ObjectCounts, ObjectData, ObjectType } from '../types/interfaces';

interface LocalWebviewMessage {
  type: string;
  error?: string;
  fileName?: string;
  isUrl?: boolean;
  pdfUri?: string;
  data?: {
    selectedTypes: string[];
    saveFolder: string;
    fileName: string;
    extractionId: string;
    objectData: ObjectData;
    webviewStartTime: number;
  };
}

// biome-ignore lint/complexity/noStaticOnlyClass: This follows existing extension patterns
export class WebviewProvider {
  private static readonly logger = Logger.getInstance();
  private static readonly activePanels = new Map<string, vscode.WebviewPanel>();

  static createPdfViewer(
    pdfSource: string,
    extensionContext: vscode.ExtensionContext
  ): vscode.WebviewPanel {
    // Check if panel already exists for this PDF
    const normalizedPath = WebviewProvider.normalizePath(pdfSource);
    const existingPanel = WebviewProvider.activePanels.get(normalizedPath);

    if (existingPanel) {
      // Reveal existing panel instead of creating new one
      existingPanel.reveal(vscode.ViewColumn.One);
      WebviewProvider.logger.info(
        `Reusing existing PDF viewer for: ${pdfSource} (normalized: ${normalizedPath})`
      );
      return existingPanel;
    }

    const fileName = WebviewProvider.getFileName(pdfSource);

    const panel = vscode.window.createWebviewPanel(
      'docpilotPdfViewer',
      `📄 ${fileName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionContext.extensionUri, 'out', 'webview'),
          vscode.Uri.file(path.dirname(pdfSource)),
        ],
      }
    );

    panel.webview.html = WebviewProvider.getWebviewContent(
      panel.webview,
      pdfSource,
      extensionContext
    );

    // Set up message handling for summarize requests
    WebviewProvider.setupMessageHandling(panel, pdfSource, extensionContext);

    // Track this panel and clean up when disposed
    WebviewProvider.activePanels.set(normalizedPath, panel);
    panel.onDidDispose(() => {
      WebviewProvider.activePanels.delete(normalizedPath);
      WebviewProvider.logger.info(`PDF viewer disposed for: ${pdfSource}`);
    });

    WebviewProvider.logger.info(
      `Created PDF viewer for: ${pdfSource} (normalized: ${normalizedPath})`
    );

    return panel;
  }

  private static normalizePath(pdfSource: string): string {
    // Normalize file paths for consistent tracking
    if (pdfSource.startsWith('http')) {
      return pdfSource.toLowerCase();
    }
    // For file paths, resolve to absolute path and normalize
    // Handle both file:// URLs and regular file paths
    let filePath = pdfSource;
    if (filePath.startsWith('file://')) {
      filePath = filePath.substring(7);
    }
    return path.resolve(filePath).toLowerCase();
  }

  static getExistingViewer(pdfSource: string): vscode.WebviewPanel | undefined {
    const normalizedPath = WebviewProvider.normalizePath(pdfSource);
    return WebviewProvider.activePanels.get(normalizedPath);
  }

  static getAllActiveViewers(): Map<string, vscode.WebviewPanel> {
    return new Map(WebviewProvider.activePanels);
  }

  static registerExternalPanel(pdfSource: string, panel: vscode.WebviewPanel): void {
    const normalizedPath = WebviewProvider.normalizePath(pdfSource);
    WebviewProvider.activePanels.set(normalizedPath, panel);

    // Set up cleanup when panel is disposed
    panel.onDidDispose(() => {
      WebviewProvider.activePanels.delete(normalizedPath);
      WebviewProvider.logger.info(`External panel disposed for: ${pdfSource}`);
    });
  }

  private static setupMessageHandling(
    panel: vscode.WebviewPanel,
    pdfSource: string,
    extensionContext: vscode.ExtensionContext
  ): void {
    panel.webview.onDidReceiveMessage(async (message) => {
      WebviewProvider.logger.debug('Received webview message:', message.type);
      WebviewProvider.logger.debug('Message details:', JSON.stringify(message, null, 2));
      WebviewProvider.logger.debug('EXPORT_TEXT constant:', WEBVIEW_MESSAGES.EXPORT_TEXT);
      switch (message.type) {
        case WEBVIEW_MESSAGES.SUMMARIZE_REQUEST:
          await WebviewProvider.handleSummarizeRequest(panel, pdfSource, message, extensionContext);
          break;
        case WEBVIEW_MESSAGES.SUMMARIZE_ERROR:
          WebviewProvider.logger.error('Webview summarization error:', message.error);
          vscode.window.showErrorMessage(`Summarization failed: ${message.error}`);
          break;
        // Legacy EXPORT_TEXT message removed - webview now uses enhanced extraction
        // But keeping EXPORT_STARTED/COMPLETED/ERROR for pdfCustomEditor.ts compatibility
        case WEBVIEW_MESSAGES.EXTRACT_ALL_TEXT:
        case WEBVIEW_MESSAGES.TEXT_EXTRACTED:
        case WEBVIEW_MESSAGES.TEXT_EXTRACTION_ERROR:
          // These are handled by TextExtractor, just log for now
          WebviewProvider.logger.debug('Text extraction message received:', message.type);
          break;
        // Enhanced object extraction messages
        case WEBVIEW_MESSAGES.EXTRACT_OBJECTS:
          await WebviewProvider.handleExtractObjectsRequest(panel, pdfSource, message);
          break;
        case WEBVIEW_MESSAGES.EXTRACTION_CANCELLED:
          await WebviewProvider.handleExtractionCancellation(message);
          break;
        case WEBVIEW_MESSAGES.BROWSE_SAVE_FOLDER:
          WebviewProvider.logger.info('Received BROWSE_SAVE_FOLDER message from webview');
          await WebviewProvider.handleBrowseSaveFolder(panel);
          break;
        case WEBVIEW_MESSAGES.GET_OBJECT_COUNTS:
          await WebviewProvider.handleGetObjectCounts(panel);
          break;
        default:
          WebviewProvider.logger.debug('Unhandled webview message:', message.type);
          break;
      }
    });
  }

  private static async handleSummarizeRequest(
    panel: vscode.WebviewPanel,
    pdfSource: string,
    _message: LocalWebviewMessage,
    _extensionContext: vscode.ExtensionContext
  ): Promise<void> {
    try {
      WebviewProvider.logger.info('Handling summarize request from webview', { pdfSource });

      // Notify webview that summarization has started
      panel.webview.postMessage({
        type: WEBVIEW_MESSAGES.SUMMARIZE_STARTED,
      });

      // Open chat view first
      await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');

      // Create and send a chat request
      const chatInput = pdfSource.startsWith('http')
        ? `@docpilot /summarise ${pdfSource}`
        : `@docpilot /summarise ${pdfSource}`;

      // Insert the chat command into the chat input
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: chatInput,
      });

      // Notify webview that summarization completed
      panel.webview.postMessage({
        type: WEBVIEW_MESSAGES.SUMMARIZE_COMPLETED,
      });

      WebviewProvider.logger.info('Summarize request processed successfully');
    } catch (error) {
      WebviewProvider.logger.error('Failed to handle summarize request', error);

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

  // Removed handleExportRequest - no longer used by webview (uses enhanced extraction)
  // exportPdfToMarkdown kept as utility method for pdfCustomEditor.ts

  static async exportPdfToMarkdown(panel: vscode.WebviewPanel, pdfSource: string): Promise<void> {
    // Show progress
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Extracting text from PDF...',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ increment: 0 });

        // Extract text from PDF
        const extractedText = await TextExtractor.extractTextWithRetry(panel, pdfSource, {
          timeout: 30000,
          retryAttempts: 2,
          progressCallback: (percent) => {
            progress.report({ increment: percent * 50 });
          },
        });

        progress.report({ increment: 50, message: 'Formatting text...' });

        // Convert text to clean format
        const textContent = WebviewProvider.convertToText(extractedText, pdfSource);

        progress.report({ increment: 25, message: 'Saving file...' });

        // Choose save location
        const saveResult = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(
            path.join(path.dirname(pdfSource), `${path.basename(pdfSource, '.pdf')}.txt`)
          ),
          filters: {
            'Text Files': ['txt'],
            'Markdown Files': ['md'],
          },
          title: 'Save exported text',
        });

        if (saveResult) {
          // Write text content to file
          fs.writeFileSync(saveResult.fsPath, textContent, 'utf8');

          progress.report({ increment: 25, message: 'Complete!' });

          // Show success message and option to open
          const openFile = await vscode.window.showInformationMessage(
            `PDF exported successfully: ${path.basename(saveResult.fsPath)}`,
            'Open File'
          );

          if (openFile === 'Open File') {
            const doc = await vscode.workspace.openTextDocument(saveResult);
            await vscode.window.showTextDocument(doc);
          }

          WebviewProvider.logger.info(`PDF exported: ${saveResult.fsPath}`);
        } else {
          WebviewProvider.logger.info('Save cancelled by user');
        }
      }
    );
  }

  private static convertToText(text: string, pdfPath: string): string {
    const path = require('node:path');
    const fileName = path.basename(pdfPath, '.pdf');
    const exportDate = new Date().toISOString().split('T')[0];

    // Simple text header
    let output = `${fileName}\n`;
    output += `Exported from PDF on ${exportDate}\n`;
    output += `Source: ${pdfPath}\n`;
    output += `${'='.repeat(50)}\n\n`;

    // Clean up the text
    const cleanedText = text
      .replace(/\n\n\n+/g, '\n\n') // Remove excessive line breaks
      .trim();

    output += cleanedText;

    return output;
  }

  static getWebviewContent(
    webview: vscode.Webview,
    pdfSource: string,
    extensionContext: vscode.ExtensionContext
  ): string {
    const templateData = {
      pdfUri: WebviewProvider.resolvePdfUri(webview, pdfSource),
      isUrl: pdfSource.startsWith('http'),
      fileName: WebviewProvider.getFileName(pdfSource),
      scriptUri: WebviewProvider.getScriptUri(webview, extensionContext),
      assetUri: WebviewProvider.getAssetUri(webview, extensionContext),
    };

    return WebviewProvider.renderTemplate(templateData, extensionContext);
  }

  private static resolvePdfUri(webview: vscode.Webview, pdfSource: string): string {
    if (pdfSource.startsWith('http')) {
      return pdfSource;
    }

    const fileUri = vscode.Uri.file(pdfSource);
    return webview.asWebviewUri(fileUri).toString();
  }

  static getFileName(pdfSource: string): string {
    if (pdfSource.startsWith('http')) {
      return 'Remote PDF';
    }
    return path.basename(pdfSource);
  }

  private static getScriptUri(
    webview: vscode.Webview,
    extensionContext: vscode.ExtensionContext
  ): string {
    const scriptPath = vscode.Uri.joinPath(
      extensionContext.extensionUri,
      'out',
      'webview',
      'scripts',
      'pdfViewer.js'
    );
    return webview.asWebviewUri(scriptPath).toString();
  }

  private static getAssetUri(
    webview: vscode.Webview,
    extensionContext: vscode.ExtensionContext
  ): string {
    const assetPath = vscode.Uri.joinPath(
      extensionContext.extensionUri,
      'out',
      'webview',
      'assets'
    );
    return webview.asWebviewUri(assetPath).toString();
  }

  private static renderTemplate(
    data: TemplateData,
    extensionContext: vscode.ExtensionContext
  ): string {
    const templatePath = path.join(
      extensionContext.extensionPath,
      'out',
      'webview',
      'templates',
      'pdfViewer.html'
    );

    try {
      let template = fs.readFileSync(templatePath, 'utf8');

      // Simple template replacement
      template = template.replace(/{{pdfUri}}/g, data.pdfUri);
      template = template.replace(/{{isUrl}}/g, data.isUrl.toString());
      template = template.replace(/{{fileName}}/g, WebviewProvider.escapeHtml(data.fileName));
      template = template.replace(/{{scriptUri}}/g, data.scriptUri);
      template = template.replace(/{{assetUri}}/g, data.assetUri);

      return template;
    } catch (error) {
      WebviewProvider.logger.error('Failed to load webview template', error);
      return WebviewProvider.getFallbackTemplate(data);
    }
  }

  private static escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  // Enhanced object extraction handlers
  public static async handleExtractObjectsRequest(
    panel: vscode.WebviewPanel,
    pdfSource: string,
    message: LocalWebviewMessage
  ): Promise<void> {
    try {
      WebviewProvider.logger.info('Handling extract objects request', {
        pdfSource,
        data: message.data,
      });

      if (!message.data) {
        throw new Error('Missing extraction request data');
      }

      const request: ObjectExtractionRequest & {
        objectData?: ObjectData;
        webviewStartTime?: number;
      } = {
        selectedTypes: message.data.selectedTypes as ObjectType[],
        saveFolder: message.data.saveFolder,
        fileName: message.data.fileName || WebviewProvider.getFileName(pdfSource),
        objectData: message.data.objectData, // Pass through object data from webview
        webviewStartTime: message.data.webviewStartTime, // Pass through webview start time
      };

      // Start extraction in background
      const result = await ObjectExtractor.extractObjects(panel, request);

      // Send completion message to webview
      panel.webview.postMessage({
        type: WEBVIEW_MESSAGES.EXTRACTION_COMPLETED,
        data: result,
      });

      WebviewProvider.logger.info('Object extraction completed successfully', {
        totalObjects: result.totalObjects,
        filesCreated: result.filesCreated.length,
        processingTime: result.processingTime,
      });
    } catch (error) {
      WebviewProvider.logger.error('Failed to extract objects', error);

      // Send error to webview
      panel.webview.postMessage({
        type: WEBVIEW_MESSAGES.EXTRACTION_ERROR,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public static async handleExtractionCancellation(message: {
    data?: { extractionId: string };
  }): Promise<void> {
    try {
      WebviewProvider.logger.info('Handling extraction cancellation', {
        extractionId: message.data?.extractionId,
      });
      ObjectExtractor.cancelExtraction();
    } catch (error) {
      WebviewProvider.logger.error('Failed to cancel extraction', error);
    }
  }

  public static async handleBrowseSaveFolder(panel: vscode.WebviewPanel): Promise<void> {
    try {
      WebviewProvider.logger.info('Handling browse save folder request');

      // Show immediate feedback to user
      vscode.window.showInformationMessage('Opening folder selection dialog...');

      const folderUri = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Save Folder',
        title: 'Select folder to save extracted PDF objects',
      });

      if (folderUri?.[0]) {
        const folderPath = folderUri[0].fsPath;
        WebviewProvider.logger.debug('Folder selected:', folderPath);

        // Send folder path to webview
        panel.webview.postMessage({
          type: WEBVIEW_MESSAGES.FOLDER_SELECTED,
          data: { folderPath },
        });
      } else {
        WebviewProvider.logger.debug('Folder selection cancelled');
      }
    } catch (error) {
      WebviewProvider.logger.error('Failed to browse save folder', error);
      vscode.window.showErrorMessage(
        `Failed to select folder: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  public static async handleGetObjectCounts(panel: vscode.WebviewPanel): Promise<void> {
    try {
      WebviewProvider.logger.info('Handling get object counts request');

      // Request object counts (this would typically come from the PDF Object Inspector)
      const counts = await ObjectExtractor.getObjectCounts(panel);

      // Send counts to webview
      panel.webview.postMessage({
        type: WEBVIEW_MESSAGES.OBJECT_COUNTS_UPDATED,
        data: counts,
      });

      WebviewProvider.logger.debug('Object counts sent to webview', counts);
    } catch (error) {
      WebviewProvider.logger.error('Failed to get object counts', error);

      // Send empty counts on error
      const emptyCounts: ObjectCounts = {
        text: 0,
        images: 0,
        tables: 0,
        fonts: 0,
        annotations: 0,
        formFields: 0,
        attachments: 0,
        bookmarks: 0,
        javascript: 0,
        metadata: 0,
      };

      panel.webview.postMessage({
        type: WEBVIEW_MESSAGES.OBJECT_COUNTS_UPDATED,
        data: emptyCounts,
      });
    }
  }

  private static getFallbackTemplate(data: TemplateData): string {
    // Minimal fallback template if file loading fails
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>PDF Viewer</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
      </head>
      <body>
        <div style="padding: 20px; text-align: center;">
          <h3>PDF Viewer</h3>
          <p>Loading ${WebviewProvider.escapeHtml(data.fileName)}...</p>
          <div id="pdfContainer"></div>
        </div>
        <script>
          const PDF_CONFIG = {
            pdfUri: '${data.pdfUri}',
            isUrl: ${data.isUrl},
            fileName: '${WebviewProvider.escapeHtml(data.fileName)}'
          };
          // Basic PDF loading fallback
          const vscode = acquireVsCodeApi();
          console.log('Fallback template loaded');
        </script>
      </body>
      </html>
    `;
  }

  static validatePdfPath(pdfPath: string): boolean {
    if (pdfPath.startsWith('http')) {
      return WebviewProvider.isValidUrl(pdfPath);
    }

    return fs.existsSync(pdfPath) && pdfPath.toLowerCase().endsWith('.pdf');
  }

  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return url.toLowerCase().includes('.pdf') || url.includes('pdf');
    } catch {
      return false;
    }
  }
}

interface TemplateData {
  pdfUri: string;
  isUrl: boolean;
  fileName: string;
  scriptUri: string;
  assetUri: string;
}
