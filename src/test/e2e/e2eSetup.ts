import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type FrameLocator,
  type Page,
} from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadEnvFile } from '../helpers/envLoader';

const EXTENSION_PATH = path.resolve(__dirname, '../../../');
const USER_DATA_DIR = path.resolve(__dirname, '../../../.vscode-test');

/**
 * Use VSCode's own file dialog instead of the native OS one, so "File: Open"
 * shows a quick input that Playwright can fill (native dialogs can't be automated).
 */
function enableSimpleFileDialog(): void {
  const settingsPath = path.join(USER_DATA_DIR, 'User', 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    // Missing or unparsable settings: start from empty
  }
  settings['files.simpleDialog.enable'] = true;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

export async function setupTest(extraArgs: string[] = []): Promise<{
  electronApp: ElectronApplication;
  vscodeWindow: Page;
}> {
  loadEnvFile(path.resolve(__dirname, '../../../.env'));
  console.log('Environment variables loaded from .env file');

  enableSimpleFileDialog();

  const executablePath = await downloadAndUnzipVSCode();
  console.log('VSCode executable path:', executablePath);

  let electronApp: ElectronApplication;
  try {
    electronApp = await electron.launch({
      executablePath,
      args: [
        `--extensionDevelopmentPath=${EXTENSION_PATH}`,
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-workspace-trust',
        '--skip-welcome',
        '--disable-telemetry',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        ...extraArgs,
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

/**
 * Run a command from the command palette. The '>' prefix is kept explicitly: filling the
 * input replaces it, which would switch the palette to file search.
 */
export async function runCommand(vscodeWindow: Page, command: string): Promise<void> {
  await vscodeWindow.keyboard.press('F1');
  await vscodeWindow.fill('input[placeholder*="Type the name"]', `>${command}`);
  // Fuzzy matching may rank a similar command first (e.g. "Markdown: Open as Preview"), and
  // Enter does nothing when no row is selected, so click the row whose label matches exactly
  const exactLabel = new RegExp(`^${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const row = vscodeWindow.locator('.quick-input-list .monaco-list-row', {
    has: vscodeWindow.locator('.label-name', { hasText: exactLabel }),
  });
  await row.first().click({ timeout: 10000 });
}

/**
 * Fill VSCode's simple file dialog (enabled in setupTest) and accept it. The dialog is located
 * by its title: a bare input selector can match other inputs (keybinding widget, Chat input).
 */
export async function fillFileDialog(vscodeWindow: Page, title: string, filePath: string): Promise<void> {
  const dialog = vscodeWindow.locator('.quick-input-widget', {
    has: vscodeWindow.locator('.quick-input-title', { hasText: title }),
  });
  const pathInput = dialog.locator('.quick-input-box input');
  await pathInput.waitFor({ state: 'visible', timeout: 10000 });
  await pathInput.fill(filePath);
  await vscodeWindow.waitForTimeout(500);
  await pathInput.press('Enter');
}

export async function openPdf(
  vscodeWindow: Page,
  pdfPath: string
): Promise<{ pdfFrame: FrameLocator; outerFrame: FrameLocator }> {
  await runCommand(vscodeWindow, 'DocPilot: Open Local PDF');

  await fillFileDialog(vscodeWindow, 'Select PDF file to open', pdfPath);

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
