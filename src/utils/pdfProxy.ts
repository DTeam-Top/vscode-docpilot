import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { Logger } from './logger';

// Use built-in fetch for Node.js 18+
// biome-ignore lint/suspicious/noExplicitAny: globalThis.fetch typing is complex
const fetch = (globalThis as any).fetch;

// biome-ignore lint/complexity/noStaticOnlyClass: This follows existing extension patterns
export class PdfProxy {
  private static readonly logger = Logger.getInstance();
  private static readonly CACHE_DIR = path.join(os.tmpdir(), 'vscode-docpilot-pdf-cache');
  private static readonly CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

  static async downloadPdf(url: string): Promise<string> {
    try {
      // Ensure cache directory exists
      if (!fs.existsSync(PdfProxy.CACHE_DIR)) {
        fs.mkdirSync(PdfProxy.CACHE_DIR, { recursive: true });
      }

      const cacheKey = PdfProxy.getCacheKey(url);
      const cachedPath = path.join(PdfProxy.CACHE_DIR, `${cacheKey}.pdf`);

      // Check if cached file exists and is still valid
      if (fs.existsSync(cachedPath)) {
        const stats = fs.statSync(cachedPath);
        if (Date.now() - stats.mtime.getTime() < PdfProxy.CACHE_EXPIRY) {
          PdfProxy.logger.info(`Using cached PDF: ${url}`);
          return cachedPath;
        }
      }

      PdfProxy.logger.info(`Downloading PDF: ${url}`);

      // Download PDF using fetch
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/pdf')) {
        throw new Error(`Expected PDF but got ${contentType}`);
      }

      // Write to cache
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(cachedPath, Buffer.from(buffer));

      PdfProxy.logger.info(`PDF downloaded and cached: ${url} -> ${cachedPath}`);
      return cachedPath;
    } catch (error) {
      PdfProxy.logger.error('Failed to download PDF', error);
      throw error;
    }
  }

  static async checkCorsSupport(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: {
          Origin: 'vscode-webview://vscode-webview',
        },
      });

      // Check for CORS headers
      const corsHeader = response.headers.get('access-control-allow-origin');
      return corsHeader === '*' || corsHeader?.includes('vscode-webview');
    } catch (error) {
      PdfProxy.logger.debug('CORS check failed', error);
      return false;
    }
  }

  static cleanupCache(): void {
    try {
      if (!fs.existsSync(PdfProxy.CACHE_DIR)) {
        return;
      }

      const files = fs.readdirSync(PdfProxy.CACHE_DIR);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(PdfProxy.CACHE_DIR, file);
        const stats = fs.statSync(filePath);

        if (now - stats.mtime.getTime() > PdfProxy.CACHE_EXPIRY) {
          fs.unlinkSync(filePath);
          PdfProxy.logger.debug(`Cleaned up expired cache file: ${file}`);
        }
      }
    } catch (error) {
      PdfProxy.logger.error('Failed to cleanup cache', error);
    }
  }

  private static getCacheKey(url: string): string {
    return crypto.createHash('md5').update(url).digest('hex');
  }
}
