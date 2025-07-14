import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type * as vscode from 'vscode';
import { Logger } from '../utils/logger';

interface CacheEntry {
  summary: string;
  timestamp: number;
  fileHash: string;
  fileSize: number;
  lastModified: number;
  filePath: string;
  processingStrategy: string;
  textLength: number;
}

interface CacheMetadata {
  version: string;
  entries: Record<string, CacheEntry>;
}

export class SummaryCache {
  private static readonly logger = Logger.getInstance();
  private static readonly CACHE_VERSION = '1.0.0';
  private static readonly CACHE_FILE_NAME = 'summary-cache.json';
  private static readonly MAX_CACHE_SIZE = 100;
  private static readonly CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  private readonly cachePath: string;
  private cache: Map<string, CacheEntry> = new Map();

  constructor(private readonly extensionContext: vscode.ExtensionContext) {
    this.cachePath = path.join(
      extensionContext.globalStorageUri.fsPath,
      SummaryCache.CACHE_FILE_NAME
    );
    this.loadCache();
  }

  async getCachedSummary(filePath: string): Promise<string | null> {
    try {
      const cacheKey = this.generateCacheKey(filePath);
      const entry = this.cache.get(cacheKey);

      if (!entry) {
        SummaryCache.logger.debug(`No cache entry found for: ${filePath}`);
        return null;
      }

      // Check if cache entry is expired
      if (this.isCacheExpired(entry)) {
        SummaryCache.logger.debug(`Cache entry expired for: ${filePath}`);
        this.cache.delete(cacheKey);
        await this.saveCache();
        return null;
      }

      // For local files, validate file hasn't changed
      if (!filePath.startsWith('http')) {
        const isValid = await this.validateLocalFileCache(filePath, entry);
        if (!isValid) {
          SummaryCache.logger.debug(`Cache invalidated due to file changes: ${filePath}`);
          this.cache.delete(cacheKey);
          await this.saveCache();
          return null;
        }
      }

      SummaryCache.logger.info(`Cache hit for: ${filePath}`);
      return entry.summary;
    } catch (error) {
      SummaryCache.logger.error('Error retrieving cached summary', error);
      return null;
    }
  }

  async setCachedSummary(
    filePath: string,
    summary: string,
    processingStrategy: string,
    textLength: number
  ): Promise<void> {
    try {
      const cacheKey = this.generateCacheKey(filePath);
      
      // Get file metadata for local files
      let fileHash = '';
      let fileSize = 0;
      let lastModified = 0;

      if (!filePath.startsWith('http')) {
        const stats = await fs.promises.stat(filePath);
        fileSize = stats.size;
        lastModified = stats.mtime.getTime();
        fileHash = await this.calculateFileHash(filePath);
      } else {
        // For URLs, use URL as hash and current timestamp
        fileHash = crypto.createHash('md5').update(filePath).digest('hex');
        lastModified = Date.now();
      }

      const entry: CacheEntry = {
        summary,
        timestamp: Date.now(),
        fileHash,
        fileSize,
        lastModified,
        filePath,
        processingStrategy,
        textLength,
      };

      this.cache.set(cacheKey, entry);
      
      // Cleanup old entries if cache is too large
      await this.cleanupCache();
      
      await this.saveCache();
      
      SummaryCache.logger.info(`Cached summary for: ${filePath}`);
    } catch (error) {
      SummaryCache.logger.error('Error caching summary', error);
    }
  }

  async clearCache(): Promise<void> {
    try {
      this.cache.clear();
      await this.saveCache();
      SummaryCache.logger.info('Cache cleared');
    } catch (error) {
      SummaryCache.logger.error('Error clearing cache', error);
    }
  }

  async invalidateFile(filePath: string): Promise<void> {
    try {
      const cacheKey = this.generateCacheKey(filePath);
      if (this.cache.delete(cacheKey)) {
        await this.saveCache();
        SummaryCache.logger.info(`Cache invalidated for: ${filePath}`);
      }
    } catch (error) {
      SummaryCache.logger.error('Error invalidating cache entry', error);
    }
  }

  getCacheStats(): { totalEntries: number; totalSizeKB: number; oldestEntry: Date | null } {
    const entries = Array.from(this.cache.values());
    const totalSizeKB = Math.round(
      entries.reduce((size, entry) => size + entry.summary.length, 0) / 1024
    );
    
    const oldestTimestamp = entries.length > 0 
      ? Math.min(...entries.map(e => e.timestamp))
      : null;
    
    return {
      totalEntries: entries.length,
      totalSizeKB,
      oldestEntry: oldestTimestamp ? new Date(oldestTimestamp) : null,
    };
  }

  private generateCacheKey(filePath: string): string {
    // Normalize path for consistent caching
    const normalizedPath = filePath.startsWith('http') 
      ? filePath.toLowerCase()
      : path.resolve(filePath).toLowerCase();
    
    return crypto.createHash('md5').update(normalizedPath).digest('hex');
  }

  private async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private async validateLocalFileCache(filePath: string, entry: CacheEntry): Promise<boolean> {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const stats = await fs.promises.stat(filePath);
      
      // Check if file size or modification time changed
      if (stats.size !== entry.fileSize || stats.mtime.getTime() !== entry.lastModified) {
        return false;
      }

      // For extra safety, verify hash for files smaller than 50MB
      if (stats.size < 50 * 1024 * 1024) {
        const currentHash = await this.calculateFileHash(filePath);
        return currentHash === entry.fileHash;
      }

      return true;
    } catch (error) {
      SummaryCache.logger.warn(`Error validating cache for ${filePath}`, error);
      return false;
    }
  }

  private isCacheExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > SummaryCache.CACHE_TTL_MS;
  }

  private async cleanupCache(): Promise<void> {
    if (this.cache.size <= SummaryCache.MAX_CACHE_SIZE) {
      return;
    }

    // Remove expired entries first
    const expiredKeys: string[] = [];
    for (const [key, entry] of this.cache.entries()) {
      if (this.isCacheExpired(entry)) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.cache.delete(key);
    }

    // If still too large, remove oldest entries
    if (this.cache.size > SummaryCache.MAX_CACHE_SIZE) {
      const entries = Array.from(this.cache.entries());
      entries.sort(([, a], [, b]) => a.timestamp - b.timestamp);
      
      const entriesToRemove = entries.slice(0, this.cache.size - SummaryCache.MAX_CACHE_SIZE);
      for (const [key] of entriesToRemove) {
        this.cache.delete(key);
      }
    }

    SummaryCache.logger.debug(`Cache cleanup completed. Entries: ${this.cache.size}`);
  }

  private async loadCache(): Promise<void> {
    try {
      // Ensure storage directory exists
      await fs.promises.mkdir(path.dirname(this.cachePath), { recursive: true });

      if (!fs.existsSync(this.cachePath)) {
        SummaryCache.logger.debug('No existing cache file found');
        return;
      }

      const cacheData = await fs.promises.readFile(this.cachePath, 'utf8');
      const metadata: CacheMetadata = JSON.parse(cacheData);

      // Check cache version compatibility
      if (metadata.version !== SummaryCache.CACHE_VERSION) {
        SummaryCache.logger.info('Cache version mismatch, clearing cache');
        await fs.promises.unlink(this.cachePath);
        return;
      }

      // Load valid entries
      for (const [key, entry] of Object.entries(metadata.entries)) {
        if (!this.isCacheExpired(entry)) {
          this.cache.set(key, entry);
        }
      }

      SummaryCache.logger.info(`Loaded ${this.cache.size} cache entries`);
    } catch (error) {
      SummaryCache.logger.warn('Error loading cache, starting fresh', error);
      // If cache is corrupted, remove it
      try {
        if (fs.existsSync(this.cachePath)) {
          await fs.promises.unlink(this.cachePath);
        }
      } catch (unlinkError) {
        SummaryCache.logger.error('Error removing corrupted cache file', unlinkError);
      }
    }
  }

  private async saveCache(): Promise<void> {
    try {
      const metadata: CacheMetadata = {
        version: SummaryCache.CACHE_VERSION,
        entries: Object.fromEntries(this.cache.entries()),
      };

      await fs.promises.writeFile(
        this.cachePath,
        JSON.stringify(metadata, null, 2),
        'utf8'
      );

      SummaryCache.logger.debug(`Cache saved with ${this.cache.size} entries`);
    } catch (error) {
      SummaryCache.logger.error('Error saving cache', error);
    }
  }
}