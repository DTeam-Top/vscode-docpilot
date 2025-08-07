import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import type {
  ExtractionSummary,
  FileExtractionConfig,
  ObjectCounts,
  ObjectData,
  ObjectExtractionProgress,
  ObjectExtractionRequest,
  ObjectExtractionResult,
  ObjectType,
  ObjectTypeResult,
  ProgressCallback,
  ProgressInfo,
  WebviewMessage,
} from '../types/interfaces';
import { configuration } from '../utils/configuration';
import { WEBVIEW_MESSAGES } from '../utils/constants';
import { Logger } from '../utils/logger';
import { TextExtractor } from './textExtractor';

// biome-ignore lint/complexity/noStaticOnlyClass: This follows existing extension patterns
export class ObjectExtractor {
  private static readonly logger = Logger.getInstance();
  private static extractionInProgress = false;
  private static cancellationRequested = false;

  // File extraction configurations for different object types
  private static readonly FILE_CONFIGS: Record<ObjectType, FileExtractionConfig> = {
    text: { type: 'text', extension: '.txt', encoding: 'utf8' },
    images: { type: 'images', extension: '.png', createSubfolder: true },
    tables: { type: 'tables', extension: '.csv', encoding: 'utf8', createSubfolder: true },
    fonts: { type: 'fonts', extension: '.json', encoding: 'utf8', createSubfolder: true },
    annotations: {
      type: 'annotations',
      extension: '.json',
      encoding: 'utf8',
      createSubfolder: true,
    },
    formFields: { type: 'formFields', extension: '.json', encoding: 'utf8', createSubfolder: true },
    attachments: { type: 'attachments', extension: '', createSubfolder: true }, // Variable extensions
    bookmarks: { type: 'bookmarks', extension: '.json', encoding: 'utf8' },
    javascript: { type: 'javascript', extension: '.js', encoding: 'utf8', createSubfolder: true },
    metadata: { type: 'metadata', extension: '.json', encoding: 'utf8' },
  };

  static async extractObjects(
    panel: vscode.WebviewPanel,
    request: ObjectExtractionRequest & { objectData?: ObjectData; webviewStartTime?: number }
  ): Promise<ObjectExtractionResult> {
    if (ObjectExtractor.extractionInProgress) {
      throw new Error('Another extraction is already in progress');
    }

    ObjectExtractor.extractionInProgress = true;
    ObjectExtractor.cancellationRequested = false;

    const startTime = Date.now();
    const { selectedTypes, saveFolder, fileName } = request;

    ObjectExtractor.logger.info('Starting object extraction', {
      selectedTypes,
      saveFolder,
      fileName,
    });

    try {
      // Validate save folder
      await ObjectExtractor.validateSaveFolder(saveFolder);

      // Create extraction folder structure
      const extractionFolder = await ObjectExtractor.createExtractionFolder(saveFolder, fileName);

      // Initialize progress tracking
      const progress: ObjectExtractionProgress = {
        overall: { current: 0, total: selectedTypes.length, percentage: 0, status: 'processing' },
        types: Object.fromEntries(
          selectedTypes.map((type) => [
            type,
            { current: 0, total: 0, percentage: 0, status: 'pending' },
          ])
        ) as Record<ObjectType, ProgressInfo>,
        filesCreated: [],
      };

      // Send initial progress
      ObjectExtractor.sendProgress(panel, progress);

      const results: ObjectTypeResult[] = [];
      let totalObjects = 0;

      // Extract each selected type progressively
      for (let i = 0; i < selectedTypes.length; i++) {
        if (ObjectExtractor.cancellationRequested) {
          throw new Error('Extraction cancelled by user');
        }

        const objectType = selectedTypes[i];
        progress.currentType = objectType;
        progress.types[objectType].status = 'processing';

        ObjectExtractor.logger.debug(`Extracting ${objectType}`, {
          progress: i + 1,
          total: selectedTypes.length,
        });

        try {
          // Use provided object data if available, otherwise extract normally
          const typeResult = request.objectData
            ? await ObjectExtractor.processObjectData(
                objectType,
                request.objectData[objectType],
                extractionFolder,
                path.parse(fileName).name,
                ObjectExtractor.FILE_CONFIGS[objectType],
                (typeProgress) => {
                  progress.types[objectType] = typeProgress;
                  progress.overall.current = i + typeProgress.percentage / 100;
                  progress.overall.percentage =
                    (progress.overall.current / selectedTypes.length) * 100;
                  ObjectExtractor.sendProgress(panel, progress);
                }
              )
            : await ObjectExtractor.extractObjectType(
                panel,
                objectType,
                extractionFolder,
                fileName,
                (typeProgress) => {
                  progress.types[objectType] = typeProgress;
                  progress.overall.current = i + typeProgress.percentage / 100;
                  progress.overall.percentage =
                    (progress.overall.current / selectedTypes.length) * 100;
                  ObjectExtractor.sendProgress(panel, progress);
                }
              );

          results.push(typeResult);
          totalObjects += typeResult.count;
          progress.filesCreated.push(...typeResult.files);
          progress.types[objectType].status = 'completed';
        } catch (error) {
          ObjectExtractor.logger.error(`Failed to extract ${objectType}`, error);
          results.push({
            count: 0,
            files: [],
            size: 0,
            status: 'failed',
            errors: [error instanceof Error ? error.message : String(error)],
          });
          progress.types[objectType].status = 'error';
        }

        progress.overall.current = i + 1;
        progress.overall.percentage = (progress.overall.current / selectedTypes.length) * 100;
        ObjectExtractor.sendProgress(panel, progress);
      }

      // Calculate total processing time including webview collection phase
      const totalProcessingTime = request.webviewStartTime
        ? Date.now() - request.webviewStartTime
        : Date.now() - startTime;

      // Generate extraction summary
      const summary = await ObjectExtractor.generateExtractionSummary(
        fileName,
        selectedTypes,
        results,
        totalProcessingTime
      );

      // Save summary file
      const summaryPath = path.join(extractionFolder, 'extraction_summary.json');
      await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
      progress.filesCreated.push(summaryPath);

      // Complete extraction
      progress.overall.status = 'completed';
      ObjectExtractor.sendProgress(panel, progress);

      const extractionResult: ObjectExtractionResult = {
        success: true,
        extractedTypes: selectedTypes,
        filesCreated: progress.filesCreated,
        folderPath: extractionFolder,
        totalObjects,
        processingTime: totalProcessingTime,
        summary,
      };

      ObjectExtractor.logger.info('Object extraction completed successfully', {
        totalObjects,
        filesCreated: progress.filesCreated.length,
        processingTime: extractionResult.processingTime,
      });

      return extractionResult;
    } catch (error) {
      ObjectExtractor.logger.error('Object extraction failed', error);

      // Send error to webview
      panel.webview.postMessage({
        type: WEBVIEW_MESSAGES.EXTRACTION_ERROR,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    } finally {
      ObjectExtractor.extractionInProgress = false;
      ObjectExtractor.cancellationRequested = false;
    }
  }

  static cancelExtraction(): void {
    if (ObjectExtractor.extractionInProgress) {
      ObjectExtractor.cancellationRequested = true;
      ObjectExtractor.extractionInProgress = false; // Reset flag to allow new extractions
      ObjectExtractor.logger.info('Extraction cancelled and reset for new operations');
    }
  }

  static async getObjectCounts(panel: vscode.WebviewPanel): Promise<ObjectCounts> {
    ObjectExtractor.logger.debug('Requesting object counts from webview');

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for object counts'));
      }, configuration.timeoutsPdfLoadMs);

      const messageDisposable = panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        if (message.type === WEBVIEW_MESSAGES.OBJECT_COUNTS_UPDATED) {
          clearTimeout(timeout);
          messageDisposable.dispose();
          resolve(message.data as ObjectCounts);
        }
      });

      // Request counts from webview
      panel.webview.postMessage({ type: WEBVIEW_MESSAGES.GET_OBJECT_COUNTS });
    });
  }

  private static async validateSaveFolder(saveFolder: string): Promise<void> {
    try {
      const stats = await fs.stat(saveFolder);
      if (!stats.isDirectory()) {
        throw new Error('Save path is not a directory');
      }
      // Test write access
      await fs.access(saveFolder, fs.constants.W_OK);
    } catch (error) {
      throw new Error(
        `Invalid save folder: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private static async createExtractionFolder(
    saveFolder: string,
    fileName: string
  ): Promise<string> {
    const baseName = path.parse(fileName).name;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const folderName = `${baseName}_extracted_${timestamp}`;
    const extractionFolder = path.join(saveFolder, folderName);

    await fs.mkdir(extractionFolder, { recursive: true });
    ObjectExtractor.logger.debug('Created extraction folder', { extractionFolder });

    return extractionFolder;
  }

  private static async extractObjectType(
    panel: vscode.WebviewPanel,
    objectType: ObjectType,
    extractionFolder: string,
    fileName: string,
    progressCallback: ProgressCallback
  ): Promise<ObjectTypeResult> {
    const config = ObjectExtractor.FILE_CONFIGS[objectType];
    const baseName = path.parse(fileName).name;

    switch (objectType) {
      case 'text':
        return ObjectExtractor.extractTextContent(
          panel,
          extractionFolder,
          baseName,
          progressCallback
        );

      case 'images':
      case 'tables':
      case 'fonts':
      case 'annotations':
      case 'formFields':
      case 'attachments':
      case 'bookmarks':
      case 'javascript':
      case 'metadata':
        return ObjectExtractor.extractWebviewObjects(
          panel,
          objectType,
          extractionFolder,
          baseName,
          config,
          progressCallback
        );

      default:
        throw new Error(`Unsupported object type: ${objectType}`);
    }
  }

  // New method to process object data directly from webview
  private static async processObjectData(
    objectType: ObjectType,
    objectTypeData: { count: number; data: string | Record<string, unknown> | unknown[] },
    extractionFolder: string,
    baseName: string,
    config: FileExtractionConfig,
    progressCallback: ProgressCallback
  ): Promise<ObjectTypeResult> {
    progressCallback({
      current: 0,
      total: 1,
      percentage: 0,
      status: 'processing',
      message: `Processing ${objectType}...`,
    });

    if (!objectTypeData || !objectTypeData.data) {
      progressCallback({
        current: 1,
        total: 1,
        percentage: 100,
        status: 'completed',
        message: `No ${objectType} found`,
      });
      return {
        count: 0,
        files: [],
        size: 0,
        status: 'success',
      };
    }

    try {
      const files = await ObjectExtractor.saveObjectFiles(
        objectTypeData.data,
        objectType,
        extractionFolder,
        baseName,
        config
      );

      const totalSize = await ObjectExtractor.calculateTotalSize(files);

      progressCallback({
        current: 1,
        total: 1,
        percentage: 100,
        status: 'completed',
        message: `${objectType} processing completed`,
      });

      return {
        count: Array.isArray(objectTypeData.data)
          ? objectTypeData.data.length
          : Object.keys(objectTypeData.data || {}).length,
        files,
        size: totalSize,
        status: 'success',
      };
    } catch (error) {
      progressCallback({
        current: 0,
        total: 1,
        percentage: 0,
        status: 'error',
        message: `Failed to process ${objectType}`,
      });
      throw error;
    }
  }

  private static async extractTextContent(
    panel: vscode.WebviewPanel,
    extractionFolder: string,
    baseName: string,
    progressCallback: ProgressCallback
  ): Promise<ObjectTypeResult> {
    progressCallback({
      current: 0,
      total: 1,
      percentage: 0,
      status: 'processing',
      message: 'Extracting text content...',
    });

    try {
      const text = await TextExtractor.extractText(panel, '');
      const textFile = path.join(extractionFolder, `${baseName}_text.txt`);

      await fs.writeFile(textFile, text, 'utf8');
      const stats = await fs.stat(textFile);

      progressCallback({
        current: 1,
        total: 1,
        percentage: 100,
        status: 'completed',
        message: 'Text extraction completed',
      });

      return {
        count: 1,
        files: [textFile],
        size: stats.size,
        status: 'success',
      };
    } catch (error) {
      progressCallback({
        current: 0,
        total: 1,
        percentage: 0,
        status: 'error',
        message: 'Text extraction failed',
      });
      throw error;
    }
  }

  private static async extractWebviewObjects(
    panel: vscode.WebviewPanel,
    objectType: ObjectType,
    extractionFolder: string,
    baseName: string,
    config: FileExtractionConfig,
    progressCallback: ProgressCallback
  ): Promise<ObjectTypeResult> {
    progressCallback({
      current: 0,
      total: 1,
      percentage: 0,
      status: 'processing',
      message: `Extracting ${objectType}...`,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout extracting ${objectType}`));
      }, configuration.timeoutsTextExtractionMs);

      const messageDisposable = panel.webview.onDidReceiveMessage(
        async (message: WebviewMessage) => {
          if (message.type === WEBVIEW_MESSAGES.EXTRACTION_COMPLETED && message.data) {
            clearTimeout(timeout);
            messageDisposable.dispose();

            try {
              const objectData = message.data as string | Record<string, unknown> | unknown[];
              const files = await ObjectExtractor.saveObjectFiles(
                objectData,
                objectType,
                extractionFolder,
                baseName,
                config
              );
              const totalSize = await ObjectExtractor.calculateTotalSize(files);

              progressCallback({
                current: 1,
                total: 1,
                percentage: 100,
                status: 'completed',
                message: `${objectType} extraction completed`,
              });

              resolve({
                count: Array.isArray(objectData)
                  ? objectData.length
                  : Object.keys(objectData).length,
                files,
                size: totalSize,
                status: 'success',
              });
            } catch (error) {
              progressCallback({
                current: 0,
                total: 1,
                percentage: 0,
                status: 'error',
                message: `Failed to save ${objectType}`,
              });
              reject(error);
            }
          } else if (message.type === WEBVIEW_MESSAGES.EXTRACTION_ERROR) {
            clearTimeout(timeout);
            messageDisposable.dispose();
            progressCallback({
              current: 0,
              total: 1,
              percentage: 0,
              status: 'error',
              message: `${objectType} extraction failed`,
            });
            reject(new Error(message.error || `Failed to extract ${objectType}`));
          }
        }
      );

      // Request extraction from webview
      panel.webview.postMessage({
        type: WEBVIEW_MESSAGES.EXTRACT_OBJECTS,
        data: { objectType },
      });
    });
  }

  private static async saveObjectFiles(
    objectData: string | Record<string, unknown> | unknown[],
    objectType: ObjectType,
    extractionFolder: string,
    baseName: string,
    config: FileExtractionConfig
  ): Promise<string[]> {
    const files: string[] = [];

    // Create subfolder if needed
    const targetFolder = config.createSubfolder
      ? path.join(extractionFolder, objectType)
      : extractionFolder;

    if (config.createSubfolder) {
      await fs.mkdir(targetFolder, { recursive: true });
    }

    switch (objectType) {
      case 'text': {
        const textFile = path.join(targetFolder, `${baseName}_text.txt`);
        await fs.writeFile(textFile, objectData as string, 'utf8');
        files.push(textFile);
        break;
      }

      case 'images':
        for (const [id, imageData] of Object.entries(
          objectData as Record<string, { base64: string }>
        )) {
          const imageFile = path.join(targetFolder, `${id}.png`);
          const base64Data = imageData.base64.replace(/^data:image\/[^;]+;base64,/, '');
          await fs.writeFile(imageFile, Buffer.from(base64Data, 'base64'));
          files.push(imageFile);
        }
        break;

      case 'tables':
        for (const [id, tableData] of Object.entries(
          objectData as Record<string, { rows: string[][] }>
        )) {
          const csvFile = path.join(targetFolder, `${id}.csv`);
          const csvContent = ObjectExtractor.convertTableToCSV(tableData);
          await fs.writeFile(csvFile, csvContent, 'utf8');
          files.push(csvFile);
        }
        break;

      case 'metadata':
      case 'fonts':
      case 'annotations':
      case 'formFields':
      case 'bookmarks': {
        const jsonFile = path.join(targetFolder, `${baseName}_${objectType}.json`);
        await fs.writeFile(jsonFile, JSON.stringify(objectData, null, 2), 'utf8');
        files.push(jsonFile);
        break;
      }

      case 'javascript':
        if (Array.isArray(objectData)) {
          for (let i = 0; i < objectData.length; i++) {
            const jsFile = path.join(targetFolder, `script_${i + 1}.js`);
            await fs.writeFile(jsFile, objectData[i] as string, 'utf8');
            files.push(jsFile);
          }
        }
        break;

      case 'attachments':
        for (const [name, attachmentData] of Object.entries(
          objectData as Record<string, { content: string }>
        )) {
          const attachmentFile = path.join(targetFolder, name);
          await fs.writeFile(attachmentFile, Buffer.from(attachmentData.content, 'base64'));
          files.push(attachmentFile);
        }
        break;

      default:
        throw new Error(`Unsupported object type for file saving: ${objectType}`);
    }

    return files;
  }

  private static convertTableToCSV(tableData: { rows: string[][] }): string {
    if (!tableData.rows || !Array.isArray(tableData.rows)) {
      return '';
    }

    return tableData.rows
      .map((row: string[]) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }

  private static async calculateTotalSize(files: string[]): Promise<number> {
    let totalSize = 0;
    for (const file of files) {
      try {
        const stats = await fs.stat(file);
        totalSize += stats.size;
      } catch (error) {
        ObjectExtractor.logger.warn(`Failed to get size for file: ${file}`, error);
      }
    }
    return totalSize;
  }

  private static async generateExtractionSummary(
    documentName: string,
    selectedTypes: ObjectType[],
    results: ObjectTypeResult[],
    processingTime: number
  ): Promise<ExtractionSummary> {
    const resultsMap = Object.fromEntries(
      selectedTypes.map((type, index) => [type, results[index]])
    ) as Record<ObjectType, ObjectTypeResult>;

    return {
      documentName,
      extractionDate: new Date().toISOString(),
      selectedTypes,
      results: resultsMap,
      totalFiles: results.reduce((sum, result) => sum + result.files.length, 0),
      totalSize: results.reduce((sum, result) => sum + result.size, 0),
      processingTime,
    };
  }

  private static sendProgress(
    panel: vscode.WebviewPanel,
    progress: ObjectExtractionProgress
  ): void {
    panel.webview.postMessage({
      type: WEBVIEW_MESSAGES.EXTRACTION_PROGRESS,
      data: progress,
    });
  }
}
