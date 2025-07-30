import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { Logger } from './logger';

interface TemplateData {
  [key: string]: any;
}

export class TemplateEngine {
  private static readonly logger = Logger.getInstance();

  public static render(
    context: vscode.ExtensionContext,
    templateName: string,
    data: TemplateData
  ): string {
    const templatePath = path.join(
      context.extensionPath,
      'out',
      'webview',
      'templates',
      `${templateName}.html`
    );

    try {
      let template = fs.readFileSync(templatePath, 'utf8');
      for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          const value =
            typeof data[key] === 'string' ? this.escapeHtml(data[key]) : data[key];
          template = template.replace(new RegExp(`{{${key}}}`, 'g'), value);
        }
      }
      return template;
    } catch (error) {
      this.logger.error(`Failed to load or render template: ${templateName}`, error);
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
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>PDF Viewer</title>
      </head>
      <body>
        <div style="padding: 20px; text-align: center;">
          <h3>Error</h3>
          <p>Failed to load the PDF viewer content. Please try closing and reopening the file.</p>
          <pre>${this.escapeHtml(JSON.stringify(data, null, 2))}</pre>
        </div>
      </body>
      </html>
    `;
  }
}
