import * as vscode from 'vscode';
import { SummaryCache } from './summaryCache';
import { Logger } from '../utils/logger';

export class FileWatcher {
  private static readonly logger = Logger.getInstance();
  private readonly watchers: Map<string, vscode.FileSystemWatcher> = new Map();
  private readonly summaryCache: SummaryCache;

  constructor(summaryCache: SummaryCache) {
    this.summaryCache = summaryCache;
  }

  watchFile(filePath: string): void {
    // Only watch local files, not URLs
    if (filePath.startsWith('http')) {
      return;
    }

    // Don't create duplicate watchers
    if (this.watchers.has(filePath)) {
      return;
    }

    try {
      // Create a watcher for the specific file
      const watcher = vscode.workspace.createFileSystemWatcher(filePath);

      // Watch for file changes, deletions, and modifications
      watcher.onDidChange(() => this.handleFileChange(filePath));
      watcher.onDidDelete(() => this.handleFileDelete(filePath));

      this.watchers.set(filePath, watcher);
      FileWatcher.logger.debug(`Started watching file: ${filePath}`);
    } catch (error) {
      FileWatcher.logger.warn(`Failed to watch file: ${filePath}`, error);
    }
  }

  unwatchFile(filePath: string): void {
    const watcher = this.watchers.get(filePath);
    if (watcher) {
      watcher.dispose();
      this.watchers.delete(filePath);
      FileWatcher.logger.debug(`Stopped watching file: ${filePath}`);
    }
  }

  private async handleFileChange(filePath: string): Promise<void> {
    FileWatcher.logger.info(`File changed, invalidating cache: ${filePath}`);
    await this.summaryCache.invalidateFile(filePath);
    
    // Show a notification to the user about cache invalidation
    vscode.window.showInformationMessage(
      `PDF file was modified. Cached summary will be regenerated on next request.`,
      { title: 'Cache Updated' }
    );
  }

  private async handleFileDelete(filePath: string): Promise<void> {
    FileWatcher.logger.info(`File deleted, invalidating cache: ${filePath}`);
    await this.summaryCache.invalidateFile(filePath);
    this.unwatchFile(filePath);
  }

  dispose(): void {
    for (const [filePath, watcher] of this.watchers.entries()) {
      watcher.dispose();
      FileWatcher.logger.debug(`Disposed watcher for: ${filePath}`);
    }
    this.watchers.clear();
  }

  getWatchedFiles(): string[] {
    return Array.from(this.watchers.keys());
  }
}