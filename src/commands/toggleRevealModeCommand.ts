import * as vscode from 'vscode';
import { SlideViewerProvider } from '../webview/slideViewerProvider';
import { Logger } from '../utils/logger';

/**
 * Toggle Reveal.js Mode Command
 * Opens markdown file as reveal.js presentation in dedicated webview panel
 */
export function registerToggleRevealModeCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const logger = Logger.getInstance();

  return vscode.commands.registerCommand('docpilot.toggleRevealMode', async (uri?: vscode.Uri) => {
    try {
      // Get target file
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri;

      if (!targetUri) {
        vscode.window.showWarningMessage('Please select a markdown file to view as slides');
        return;
      }

      // Check if it's a markdown file
      if (!targetUri.fsPath.endsWith('.md') && !targetUri.fsPath.endsWith('.markdown')) {
        vscode.window.showWarningMessage('Slide viewer is only available for markdown files');
        return;
      }

      // Validate file exists
      if (!SlideViewerProvider.validateMarkdownPath(targetUri.fsPath)) {
        vscode.window.showErrorMessage(`Markdown file not found: ${targetUri.fsPath}`);
        return;
      }

      // Open slide viewer webview panel
      logger.info('Opening slide viewer', { path: targetUri.fsPath });
      SlideViewerProvider.createSlideViewer(targetUri.fsPath, context);

      logger.info('Slide viewer opened successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to open slide viewer', error);
      vscode.window.showErrorMessage(`Failed to open slide viewer: ${errorMessage}`);
    }
  });
}
