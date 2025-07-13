import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../utils/logger';
import type { PdfViewerState } from '../types/interfaces';

export class WebviewProvider {
  private static readonly logger = Logger.getInstance();

  static createPdfViewer(
    pdfSource: string,
    extensionContext: vscode.ExtensionContext
  ): vscode.WebviewPanel {
    const fileName = this.getFileName(pdfSource);

    const panel = vscode.window.createWebviewPanel(
      'docpilotPdfViewer',
      `📄 ${fileName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionContext.extensionUri, 'src', 'webview'),
          vscode.Uri.file(path.dirname(pdfSource)),
        ],
      }
    );

    panel.webview.html = this.getWebviewContent(panel.webview, pdfSource, extensionContext);

    this.logger.info(`Created PDF viewer for: ${pdfSource}`);

    return panel;
  }

  private static getWebviewContent(
    webview: vscode.Webview,
    pdfSource: string,
    extensionContext: vscode.ExtensionContext
  ): string {
    const templateData = {
      pdfUri: this.resolvePdfUri(webview, pdfSource),
      isUrl: pdfSource.startsWith('http'),
      fileName: this.getFileName(pdfSource),
      scriptUri: this.getScriptUri(webview, extensionContext),
    };

    return this.renderTemplate(templateData, extensionContext);
  }

  private static resolvePdfUri(webview: vscode.Webview, pdfSource: string): string {
    if (pdfSource.startsWith('http')) {
      return pdfSource;
    }

    const fileUri = vscode.Uri.file(pdfSource);
    return webview.asWebviewUri(fileUri).toString();
  }

  private static getFileName(pdfSource: string): string {
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
      'src',
      'webview',
      'scripts',
      'pdfViewer.js'
    );
    return webview.asWebviewUri(scriptPath).toString();
  }

  private static renderTemplate(
    data: TemplateData,
    extensionContext: vscode.ExtensionContext
  ): string {
    const templatePath = path.join(
      extensionContext.extensionPath,
      'src',
      'webview',
      'templates',
      'pdfViewer.html'
    );

    try {
      let template = fs.readFileSync(templatePath, 'utf8');

      // Simple template replacement
      template = template.replace(/{{pdfUri}}/g, data.pdfUri);
      template = template.replace(/{{isUrl}}/g, data.isUrl.toString());
      template = template.replace(/{{fileName}}/g, this.escapeHtml(data.fileName));
      template = template.replace(/{{scriptUri}}/g, data.scriptUri);

      return template;
    } catch (error) {
      this.logger.error('Failed to load webview template', error);
      return this.getFallbackTemplate(data);
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
          <p>Loading ${this.escapeHtml(data.fileName)}...</p>
          <div id="pdfContainer"></div>
        </div>
        <script>
          const PDF_CONFIG = {
            pdfUri: '${data.pdfUri}',
            isUrl: ${data.isUrl},
            fileName: '${this.escapeHtml(data.fileName)}'
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
      return this.isValidUrl(pdfPath);
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
}
