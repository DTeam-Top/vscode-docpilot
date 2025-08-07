import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { Logger } from '../utils/logger';

interface CacheEntry<T> {
  data: T;
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
  entries: Record<string, CacheEntry<any>>;
}

export interface CacheStats {
  totalEntries: number;
  totalSizeKB: number;
  oldestEntry: Date | null;
}

export interface CacheEntryMetadata {
  processingStrategy: string;
  textLength: number;
}

export class DocumentCache<T> {
  private static readonly logger = Logger.getInstance();
  private static readonly CACHE_VERSION = '1.0.0';
  private static readonly MAX_CACHE_SIZE = 100;
  private static readonly CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  private readonly cachePath: string;
  private readonly cacheType: string;
  private cache: Map<string, CacheEntry<T>> = new Map();

  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    cacheType: 'summary' | 'mindmap'
  ) {
    this.cacheType = cacheType;
    this.cachePath = path.join(extensionContext.globalStorageUri.fsPath, `${cacheType}-cache.json`);
    this.loadCache();
  }

  async getCached(filePath: string): Promise<T | null> {
    try {
      const cacheKey = this.generateCacheKey(filePath);
      const entry = this.cache.get(cacheKey);

      if (!entry) {
        DocumentCache.logger.debug(`No ${this.cacheType} cache entry found for: ${filePath}`);
        return null;
      }

      // Check if cache entry is expired
      if (this.isCacheExpired(entry)) {
        DocumentCache.logger.debug(`${this.cacheType} cache entry expired for: ${filePath}`);
        this.cache.delete(cacheKey);
        await this.saveCache();
        return null;
      }

      // For local files, validate file hasn't changed
      if (!filePath.startsWith('http')) {
        const isValid = await this.validateLocalFileCache(filePath, entry);
        if (!isValid) {
          DocumentCache.logger.debug(
            `${this.cacheType} cache invalidated due to file changes: ${filePath}`
          );
          this.cache.delete(cacheKey);
          await this.saveCache();
          return null;
        }
      }

      DocumentCache.logger.info(`${this.cacheType} cache hit for: ${filePath}`);
      return entry.data;
    } catch (error) {
      DocumentCache.logger.error(`Error retrieving cached ${this.cacheType}`, error);
      return null;
    }
  }

  async setCached(filePath: string, data: T, metadata: CacheEntryMetadata): Promise<void> {
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

      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        fileHash,
        fileSize,
        lastModified,
        filePath,
        processingStrategy: metadata.processingStrategy,
        textLength: metadata.textLength,
      };

      this.cache.set(cacheKey, entry);

      // Cleanup old entries if cache is too large
      await this.cleanupCache();

      await this.saveCache();

      DocumentCache.logger.info(`Cached ${this.cacheType} for: ${filePath}`);
    } catch (error) {
      DocumentCache.logger.error(`Error caching ${this.cacheType}`, error);
    }
  }

  async clearCache(): Promise<void> {
    try {
      this.cache.clear();
      await this.saveCache();
      DocumentCache.logger.info(`${this.cacheType} cache cleared`);
    } catch (error) {
      DocumentCache.logger.error(`Error clearing ${this.cacheType} cache`, error);
    }
  }

  async invalidateFile(filePath: string): Promise<void> {
    try {
      const cacheKey = this.generateCacheKey(filePath);
      if (this.cache.delete(cacheKey)) {
        await this.saveCache();
        DocumentCache.logger.info(`${this.cacheType} cache invalidated for: ${filePath}`);
      }
    } catch (error) {
      DocumentCache.logger.error(`Error invalidating ${this.cacheType} cache entry`, error);
    }
  }

  getCacheStats(): CacheStats {
    const entries = Array.from(this.cache.values());
    const totalSizeKB = Math.round(
      entries.reduce((size, entry) => {
        // Safely handle potentially malformed entries
        if (!entry || typeof entry !== 'object' || entry.data === undefined) {
          DocumentCache.logger.warn(`Malformed cache entry found, skipping: ${JSON.stringify(entry)}`);
          return size;
        }

        // Calculate size based on data type
        const dataSize =
          typeof entry.data === 'string' ? entry.data.length : JSON.stringify(entry.data).length;
        return size + dataSize;
      }, 0) / 1024
    );

    // Safely get timestamps, filtering out malformed entries
    const validEntries = entries.filter(e => e && typeof e === 'object' && typeof e.timestamp === 'number');
    const oldestTimestamp =
      validEntries.length > 0 ? Math.min(...validEntries.map((e) => e.timestamp)) : null;

    return {
      totalEntries: validEntries.length,
      totalSizeKB,
      oldestEntry: oldestTimestamp ? new Date(oldestTimestamp) : null,
    };
  }

  getAllCacheEntries(): Array<{ filePath: string; data: T; timestamp: number }> {
    const entries = Array.from(this.cache.values());
    return entries
      .filter(entry => entry && typeof entry === 'object' && entry.data !== undefined)
      .map(entry => ({
        filePath: entry.filePath,
        data: entry.data,
        timestamp: entry.timestamp,
      }));
  }

  private generateCacheKey(filePath: string): string {
    // Normalize path for consistent caching
    const normalizedPath = filePath.startsWith('http')
      ? filePath.toLowerCase()
      : path.resolve(filePath).toLowerCase();

    return crypto.createHash('md5').update(`${this.cacheType}:${normalizedPath}`).digest('hex');
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

  private async validateLocalFileCache(filePath: string, entry: CacheEntry<T>): Promise<boolean> {
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
      DocumentCache.logger.warn(`Error validating ${this.cacheType} cache for ${filePath}`, error);
      return false;
    }
  }

  private isCacheExpired(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp > DocumentCache.CACHE_TTL_MS;
  }

  private isValidCacheEntry(entry: any): entry is CacheEntry<T> {
    return (
      entry &&
      typeof entry === 'object' &&
      entry.data !== undefined &&
      typeof entry.timestamp === 'number' &&
      typeof entry.fileHash === 'string' &&
      typeof entry.fileSize === 'number' &&
      typeof entry.lastModified === 'number' &&
      typeof entry.filePath === 'string' &&
      typeof entry.processingStrategy === 'string' &&
      typeof entry.textLength === 'number'
    );
  }

  private async cleanupCache(): Promise<void> {
    if (this.cache.size <= DocumentCache.MAX_CACHE_SIZE) {
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
    if (this.cache.size > DocumentCache.MAX_CACHE_SIZE) {
      const entries = Array.from(this.cache.entries());
      entries.sort(([, a], [, b]) => a.timestamp - b.timestamp);

      const entriesToRemove = entries.slice(0, this.cache.size - DocumentCache.MAX_CACHE_SIZE);
      for (const [key] of entriesToRemove) {
        this.cache.delete(key);
      }
    }

    DocumentCache.logger.debug(
      `${this.cacheType} cache cleanup completed. Entries: ${this.cache.size}`
    );
  }

  private async loadCache(): Promise<void> {
    try {
      // Ensure storage directory exists
      await fs.promises.mkdir(path.dirname(this.cachePath), { recursive: true });

      if (!fs.existsSync(this.cachePath)) {
        DocumentCache.logger.debug(`No existing ${this.cacheType} cache file found`);
        return;
      }

      const cacheData = await fs.promises.readFile(this.cachePath, 'utf8');
      const metadata: CacheMetadata = JSON.parse(cacheData);

      // Check cache version compatibility
      if (metadata.version !== DocumentCache.CACHE_VERSION) {
        DocumentCache.logger.info(`${this.cacheType} cache version mismatch, clearing cache`);
        await fs.promises.unlink(this.cachePath);
        return;
      }

      // Load valid entries with proper validation
      for (const [key, entry] of Object.entries(metadata.entries)) {
        // Validate entry structure before loading
        if (this.isValidCacheEntry(entry) && !this.isCacheExpired(entry)) {
          this.cache.set(key, entry as CacheEntry<T>);
        } else if (!this.isValidCacheEntry(entry)) {
          DocumentCache.logger.warn(`Skipping malformed cache entry with key: ${key}`);
        }
      }

      DocumentCache.logger.info(`Loaded ${this.cache.size} ${this.cacheType} cache entries`);
    } catch (error) {
      DocumentCache.logger.warn(`Error loading ${this.cacheType} cache, starting fresh`, error);
      // If cache is corrupted, remove it
      try {
        if (fs.existsSync(this.cachePath)) {
          await fs.promises.unlink(this.cachePath);
        }
      } catch (unlinkError) {
        DocumentCache.logger.error(
          `Error removing corrupted ${this.cacheType} cache file`,
          unlinkError
        );
      }
    }
  }

  private async saveCache(): Promise<void> {
    try {
      const metadata: CacheMetadata = {
        version: DocumentCache.CACHE_VERSION,
        entries: Object.fromEntries(this.cache.entries()),
      };

      await fs.promises.writeFile(this.cachePath, JSON.stringify(metadata, null, 2), 'utf8');

      DocumentCache.logger.debug(`${this.cacheType} cache saved with ${this.cache.size} entries`);
    } catch (error) {
      DocumentCache.logger.error(`Error saving ${this.cacheType} cache`, error);
    }
  }
}
