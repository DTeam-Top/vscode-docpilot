import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Load environment variables from .env file
 * Used across test suites for consistent environment loading
 */
export function loadEnvFile(envPath?: string): void {
  const resolvedPath = envPath || path.resolve(process.cwd(), '.env');

  if (fs.existsSync(resolvedPath)) {
    const envContent = fs.readFileSync(resolvedPath, 'utf-8');
    const lines = envContent.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=');
          process.env[key] = value;
        }
      }
    }
  }
}
