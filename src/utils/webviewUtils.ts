import * as vscode from 'vscode';
import { WebviewProvider } from '../webview/webviewProvider';
import { Logger } from './logger';

export interface WebviewPanelOptions {
  title: string;
  source: string;
  context: vscode.ExtensionContext;
  viewColumn?: vscode.ViewColumn;
  successMessage?: string;
}

// biome-ignore lint/complexity/noStaticOnlyClass: This follows existing extension patterns
export class WebviewUtils {
  private static readonly logger = Logger.getInstance();

  static createAndRevealPdfViewer(options: WebviewPanelOptions): vscode.WebviewPanel {
    const { title, source, context, viewColumn = vscode.ViewColumn.One, successMessage } = options;

    // Create the webview panel
    const panel = WebviewProvider.createPdfViewer(source, context);

    // Update the title if different from default
    if (title !== panel.title) {
      panel.title = title;
    }

    // Focus the panel
    panel.reveal(viewColumn);

    WebviewUtils.logger.info(`PDF viewer created and revealed for: ${source}`);

    // Show success message if provided
    if (successMessage) {
      vscode.window.showInformationMessage(successMessage);
    }

    return panel;
  }
}
