import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { InvalidFilePathError } from './errors';
import { WebviewProvider } from '../webview/webviewProvider';

export class PathResolver {
  static async resolve(prompt: string, stream: vscode.ChatResponseStream): Promise<string> {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      return this.showFilePicker(stream);
    }

    if (trimmedPrompt.startsWith('http')) {
      return this.resolveUrl(trimmedPrompt);
    }

    return this.resolveLocalPath(trimmedPrompt);
  }

  private static async showFilePicker(stream: vscode.ChatResponseStream): Promise<string> {
    stream.markdown('📁 Opening file picker...\n\n');
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'PDF Files': ['pdf'] },
      title: 'Select PDF file to summarise',
    });

    if (!result || result.length === 0) {
      throw new InvalidFilePathError('No file selected');
    }

    return result[0].fsPath;
  }

  private static resolveUrl(url: string): string {
    if (!WebviewProvider.validatePdfPath(url)) {
      throw new InvalidFilePathError(`Invalid PDF URL: ${url}`);
    }
    return url;
  }

  private static resolveLocalPath(filePath: string): string {
    let resolvedPath: string;
    if (path.isAbsolute(filePath)) {
      resolvedPath = filePath;
    }
    else {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new InvalidFilePathError('No workspace folder found. Please provide an absolute path.');
      }
      resolvedPath = path.join(workspaceFolder.uri.fsPath, filePath);
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new InvalidFilePathError(`File not found: ${resolvedPath}`);
    }

    if (!WebviewProvider.validatePdfPath(resolvedPath)) {
      throw new InvalidFilePathError(`Not a valid PDF file: ${resolvedPath}`);
    }

    return resolvedPath;
  }
}
