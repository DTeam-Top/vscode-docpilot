import { defineConfig } from '@playwright/test';
import { loadEnvFile } from './src/test/helpers/envLoader';

// Load environment variables from .env file
loadEnvFile();

export default defineConfig({
  testDir: './src/test/e2e',
  workers: 1,
  timeout: 60000,
  use: {
    trace: 'on-first-retry'
  }
});