import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type FrameLocator,
  type Page,
} from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import * as path from 'node:path';
import { loadEnvFile } from '../helpers/envLoader';

const EXTENSION_PATH = path.resolve(__dirname, '../../../');

export async function setupTest(): Promise<{
  electronApp: ElectronApplication;
  vscodeWindow: Page;
}> {
  loadEnvFile(path.resolve(__dirname, '../../../.env'));
  console.log('Environment variables loaded from .env file');

  const executablePath = await downloadAndUnzipVSCode();
  console.log('VSCode executable path:', executablePath);

  let electronApp: ElectronApplication;
  try {
    electronApp = await electron.launch({
      executablePath,
      args: [
        `--extensionDevelopmentPath=${EXTENSION_PATH}`,
        `--user-data-dir=${path.resolve(__dirname, '../../../.vscode-test')}`,
        '--disable-workspace-trust',
        '--skip-welcome',
        '--disable-telemetry',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ...(process.env.COPILOT_CHAT_AUTH_TOKEN && {
          COPILOT_CHAT_AUTH_TOKEN: process.env.COPILOT_CHAT_AUTH_TOKEN,
        }),
      },
      timeout: 60000,
    });

    console.log('Electron app launched successfully');

    const vscodeWindow = await electronApp.firstWindow();
    console.log('Got first window');

    await vscodeWindow.waitForLoadState('domcontentloaded');
    console.log('Window loaded');

    await vscodeWindow.waitForSelector('.monaco-workbench', { timeout: 30000 });
    console.log('VSCode workbench ready');

    return { electronApp, vscodeWindow };
  } catch (error) {
    console.error('Failed in setupTest:', error);
    // @ts-ignore
    await electronApp?.close();
    throw error;
  }
}

export async function openPdf(
  vscodeWindow: Page,
  pdfPath: string
): Promise<{ pdfFrame: FrameLocator; outerFrame: FrameLocator }> {
  await vscodeWindow.keyboard.press('F1');
  await vscodeWindow.fill('input[placeholder*="Type the name"]', 'DocPilot: Open Local PDF');
  await vscodeWindow.keyboard.press('Enter');

  await vscodeWindow.waitForSelector('input[type="text"]', { timeout: 10000 });
  await vscodeWindow.fill('input[type="text"]', pdfPath);

  const inputValue = await vscodeWindow.locator('input[type="text"]').inputValue();
  // re-check the input value in case it was not set correctly
  if (!inputValue) {
    await vscodeWindow.fill('input[type="text"]', pdfPath);
    await vscodeWindow.waitForTimeout(2000);
  }
  await vscodeWindow.keyboard.press('Enter');

  // Wait a moment and check what happened after Enter
  await vscodeWindow.waitForTimeout(2000);
  console.log('Enter pressed, checking if command executed...');

  console.log('Waiting for webview to appear...');
  const webviewFrameLocator = vscodeWindow.locator('iframe[src*="vscode-webview"]');
  await expect(webviewFrameLocator).toBeVisible({ timeout: 10000 });
  console.log('PDF viewer loaded, getting frame content...');

  const outerFrame = await webviewFrameLocator.contentFrame();
  if (!outerFrame) {
    throw new Error('Could not access webview frame content');
  }

  const innerIframeLocator = outerFrame.locator('#active-frame');
  await expect(innerIframeLocator).toBeVisible({ timeout: 10000 });

  const pdfFrame = await innerIframeLocator.contentFrame();
  if (!pdfFrame) {
    throw new Error('Could not access inner PDF viewer frame content');
  }

  console.log('Successfully accessed PDF viewer frame');
  return { pdfFrame, outerFrame };
}
