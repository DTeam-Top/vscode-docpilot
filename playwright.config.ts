import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src/test/e2e',
  workers: 1,
  timeout: 60000,
  use: {
    trace: 'on-first-retry'
  }
});