import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { TemplateEngine } from '../utils/templateEngine';
import { WebviewMessenger } from './webviewMessenger';

// biome-ignore lint/complexity/noStaticOnlyClass: This follows existing extension patterns
export class SlideViewerProvider {
  private static readonly logger = Logger.getInstance();
  private static readonly activePanels = new Map<string, vscode.WebviewPanel>();

  static createSlideViewer(
    markdownPath: string,
    extensionContext: vscode.ExtensionContext
  ): vscode.WebviewPanel {
    // Check if panel already exists for this markdown file
    const normalizedPath = SlideViewerProvider.normalizePath(markdownPath);
    const existingPanel = SlideViewerProvider.activePanels.get(normalizedPath);

    if (existingPanel) {
      // Reveal existing panel instead of creating new one
      existingPanel.reveal(vscode.ViewColumn.One);
      SlideViewerProvider.logger.info(
        `Reusing existing slide viewer for: ${markdownPath} (normalized: ${normalizedPath})`
      );
      return existingPanel;
    }

    const fileName = SlideViewerProvider.getFileName(markdownPath);

    const panel = vscode.window.createWebviewPanel(
      'docpilotSlideViewer',
      `🎞️ ${fileName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionContext.extensionUri, 'out', 'webview'),
          vscode.Uri.file(path.dirname(markdownPath)),
        ],
      }
    );

    panel.webview.html = SlideViewerProvider.getWebviewContent(
      panel.webview,
      markdownPath,
      extensionContext
    );

    // Set up message handling
    SlideViewerProvider.setupMessageHandling(panel, markdownPath);

    // Track this panel and clean up when disposed
    SlideViewerProvider.activePanels.set(normalizedPath, panel);
    panel.onDidDispose(() => {
      SlideViewerProvider.activePanels.delete(normalizedPath);
      SlideViewerProvider.logger.info(`Slide viewer disposed for: ${markdownPath}`);
    });

    SlideViewerProvider.logger.info(
      `Created slide viewer for: ${markdownPath} (normalized: ${normalizedPath})`
    );

    return panel;
  }

  private static normalizePath(markdownPath: string): string {
    // Normalize file paths for consistent tracking
    return path.resolve(markdownPath).toLowerCase();
  }

  static getExistingViewer(markdownPath: string): vscode.WebviewPanel | undefined {
    const normalizedPath = SlideViewerProvider.normalizePath(markdownPath);
    return SlideViewerProvider.activePanels.get(normalizedPath);
  }

  private static setupMessageHandling(panel: vscode.WebviewPanel, markdownPath: string): void {
    const messenger = new WebviewMessenger(panel);

    // Handle settings changes
    messenger.on('getSettings', async () => {
      await SlideViewerProvider.handleGetSettings(panel);
    });

    // Handle file content request
    messenger.on('getMarkdownContent', async () => {
      await SlideViewerProvider.handleGetMarkdownContent(panel, markdownPath);
    });

    // Store messenger on panel for potential cleanup
    (panel as any)._messenger = messenger;
  }

  private static async handleGetSettings(panel: vscode.WebviewPanel): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('docpilot.reveal');
      const settings = {
        theme: config.get<string>('theme', 'black'),
        transition: config.get<string>('transition', 'slide'),
        controls: config.get<boolean>('controls', true),
        progress: config.get<boolean>('progress', true),
        slideNumber: config.get<boolean>('slideNumber', false),
      };

      panel.webview.postMessage({
        type: 'settingsLoaded',
        data: settings,
      });

      SlideViewerProvider.logger.debug('Settings sent to webview', settings);
    } catch (error) {
      SlideViewerProvider.logger.error('Failed to get settings', error);
    }
  }

  private static async handleGetMarkdownContent(
    panel: vscode.WebviewPanel,
    markdownPath: string
  ): Promise<void> {
    try {
      const content = await fs.promises.readFile(markdownPath, 'utf-8');

      panel.webview.postMessage({
        type: 'markdownContentLoaded',
        data: { content },
      });

      SlideViewerProvider.logger.debug('Markdown content sent to webview', {
        length: content.length,
      });
    } catch (error) {
      SlideViewerProvider.logger.error('Failed to read markdown file', error);

      panel.webview.postMessage({
        type: 'markdownContentError',
        error: error instanceof Error ? error.message : 'Failed to read markdown file',
      });
    }
  }

  static getWebviewContent(
    webview: vscode.Webview,
    markdownPath: string,
    extensionContext: vscode.ExtensionContext
  ): string {
    const templateData = {
      fileName: SlideViewerProvider.getFileName(markdownPath),
      scriptUri: SlideViewerProvider.getScriptUri(webview, extensionContext),
      cssUri: SlideViewerProvider.getCssUri(webview, extensionContext),
    };

    return TemplateEngine.render(extensionContext, 'slideViewer', templateData);
  }

  static getFileName(markdownPath: string): string {
    return path.basename(markdownPath);
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
      'slideViewer.min.js'
    );
    return webview.asWebviewUri(scriptPath).toString();
  }

  private static getCssUri(
    webview: vscode.Webview,
    extensionContext: vscode.ExtensionContext
  ): string {
    const cssPath = vscode.Uri.joinPath(
      extensionContext.extensionUri,
      'out',
      'webview',
      'styles',
      'slideViewer.min.css'
    );
    return webview.asWebviewUri(cssPath).toString();
  }

  static validateMarkdownPath(markdownPath: string): boolean {
    return fs.existsSync(markdownPath) && markdownPath.toLowerCase().endsWith('.md');
  }
}
