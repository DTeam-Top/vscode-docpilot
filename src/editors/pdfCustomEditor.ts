import * as vscode from 'vscode';
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
      `Resolving custom editor for: ${document.uri.fsPath}`
    );

    // Delegate the entire panel creation and management to WebviewProvider
    const managedPanel = WebviewProvider.createPdfViewer(document.uri.fsPath, this.context);

    // If the returned panel is different from the one provided by VS Code,
    // it means an existing panel was reused. We should close the new one.
    if (managedPanel !== webviewPanel) {
      webviewPanel.dispose();
    }
  }
}
