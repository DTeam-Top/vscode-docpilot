import * as vscode from 'vscode';

class ConfigurationManager {
  private static instance: ConfigurationManager;
  private readonly config: vscode.WorkspaceConfiguration;

  private constructor() {
    this.config = vscode.workspace.getConfiguration('docpilot');
  }

  public static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }

  public get<T>(key: string): T | undefined {
    return this.config.get<T>(key);
  }

  public get textProcessingPromptOverheadTokens(): number {
    return this.get<number>('textProcessing.promptOverheadTokens')!;
  }

  public get textProcessingChunkSizeRatio(): number {
    return this.get<number>('textProcessing.chunkSizeRatio')!;
  }

  public get textProcessingOverlapRatio(): number {
    return this.get<number>('textProcessing.overlapRatio')!;
  }

  public get textProcessingDefaultBatchSize(): number {
    return this.get<number>('textProcessing.defaultBatchSize')!;
  }

  public get textProcessingMaxBatchSize(): number {
    return this.get<number>('textProcessing.maxBatchSize')!;
  }

  public get textProcessingCharsPerToken(): number {
    return this.get<number>('textProcessing.charsPerToken')!;
  }

  public get textProcessingTokenOverheadRatio(): number {
    return this.get<number>('textProcessing.tokenOverheadRatio')!;
  }

  public get pdfViewerMaxCachedTextLayers(): number {
    return this.get<number>('pdfViewer.maxCachedTextLayers')!;
  }

  public get pdfViewerVisiblePageBuffer(): number {
    return this.get<number>('pdfViewer.visiblePageBuffer')!;
  }

  public get pdfViewerMaxTextDivsPerPage(): number {
    return this.get<number>('pdfViewer.maxTextDivsPerPage')!;
  }

  public get pdfViewerPerformanceThresholdMs(): number {
    return this.get<number>('pdfViewer.performanceThresholdMs')!;
  }

  public get pdfViewerMinZoom(): number {
    return this.get<number>('pdfViewer.minZoom')!;
  }

  public get pdfViewerMaxZoom(): number {
    return this.get<number>('pdfViewer.maxZoom')!;
  }

  public get pdfViewerDefaultZoom(): number {
    return this.get<number>('pdfViewer.defaultZoom')!;
  }

  public get timeoutsTextExtractionMs(): number {
    return this.get<number>('timeouts.textExtractionMs')!;
  }

  public get timeoutsModelRequestMs(): number {
    return this.get<number>('timeouts.modelRequestMs')!;
  }

  public get timeoutsPdfLoadMs(): number {
    return this.get<number>('timeouts.pdfLoadMs')!;
  }

  public get timeoutsHeartbeatIntervalMs(): number {
    return this.get<number>('timeouts.heartbeatIntervalMs')!;
  }
}

export const configuration = ConfigurationManager.getInstance();
