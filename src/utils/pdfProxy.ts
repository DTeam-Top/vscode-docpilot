import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Logger } from './logger';

const logger = Logger.getInstance();
const CACHE_DIR = path.join(os.tmpdir(), 'vscode-docpilot-pdf-cache');
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

// Use built-in fetch for Node.js 18+
// biome-ignore lint/suspicious/noExplicitAny: globalThis.fetch typing is complex
const fetch = (globalThis as any).fetch;

function getCacheKey(url: string): string {
    return crypto.createHash('md5').update(url).digest('hex');
}

export async function downloadPdf(url: string): Promise<string> {
    try {
        // Ensure cache directory exists
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
        }

        const cacheKey = getCacheKey(url);
        const cachedPath = path.join(CACHE_DIR, `${cacheKey}.pdf`);

        // Check if cached file exists and is still valid
        if (fs.existsSync(cachedPath)) {
            const stats = fs.statSync(cachedPath);
            if (Date.now() - stats.mtime.getTime() < CACHE_EXPIRY) {
                logger.info(`Using cached PDF: ${url}`);
                return cachedPath;
            }
        }

        logger.info(`Downloading PDF: ${url}`);

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

        logger.info(`PDF downloaded and cached: ${url} -> ${cachedPath}`);
        return cachedPath;
    } catch (error) {
        logger.error('Failed to download PDF', error);
        throw error;
    }
}

export async function checkCorsSupport(url: string): Promise<boolean> {
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
        logger.debug('CORS check failed', error);
        return false;
    }
}

export function cleanupCache(): void {
    try {
        if (!fs.existsSync(CACHE_DIR)) {
            return;
        }

        const files = fs.readdirSync(CACHE_DIR);
        const now = Date.now();

        for (const file of files) {
            const filePath = path.join(CACHE_DIR, file);
            const stats = fs.statSync(filePath);

            if (now - stats.mtime.getTime() > CACHE_EXPIRY) {
                fs.unlinkSync(filePath);
                logger.debug(`Cleaned up expired cache file: ${file}`);
            }
        }
    } catch (error) {
        logger.error('Failed to cleanup cache', error);
    }
}