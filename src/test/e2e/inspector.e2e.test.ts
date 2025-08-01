import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import * as path from 'node:path';
import { loadEnvFile } from '../helpers/envLoader';

let electronApp: ElectronApplication;
let vscodeWindow: Page;

const EXTENSION_PATH = path.resolve(__dirname, '../../../');
const TEST_PDF_PATH = path.resolve(__dirname, '../fixtures/pdfs/normal.pdf');

test.beforeAll(async () => {
  loadEnvFile(path.resolve(__dirname, '../../../.env'));
  const executablePath = await downloadAndUnzipVSCode();

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

  vscodeWindow = await electronApp.firstWindow();
  await vscodeWindow.waitForLoadState('domcontentloaded');
  await vscodeWindow.waitForSelector('.monaco-workbench', { timeout: 30000 });
});

test.afterAll(async () => {
  await electronApp?.close();
});

test('should perform end-to-end inspector testing', async () => {
  // Open PDF via command palette
  await vscodeWindow.keyboard.press('F1');
  await vscodeWindow.fill('input[placeholder*="Type the name"]', 'DocPilot: Open Local PDF');
  await vscodeWindow.keyboard.press('Enter');

  // Wait for file input and provide path
  await vscodeWindow.waitForSelector('input[type="text"]', { timeout: 10000 });
  await vscodeWindow.fill('input[type="text"]', TEST_PDF_PATH);

  // Debug the input state before pressing Enter
  const inputValue = await vscodeWindow.locator('input[type="text"]').inputValue();
  console.log('Input value before Enter:', inputValue);

  await vscodeWindow.keyboard.press('Enter');

  // Wait a moment and check what happened after Enter
  await vscodeWindow.waitForTimeout(2000);
  console.log('Enter pressed, checking if command executed...');

  // Check if command palette is still open (shouldn't be if command executed)
  const commandPaletteStillOpen = await vscodeWindow
    .locator('input[placeholder*="Type the name"]')
    .isVisible();
  console.log('Command palette still open:', commandPaletteStillOpen);

  // Check for any error notifications
  const notifications = await vscodeWindow
    .locator('.notifications-toasts .notification-toast')
    .count();
  console.log('Notification count:', notifications);

  if (notifications > 0) {
    const notificationText = await vscodeWindow
      .locator('.notifications-toasts .notification-toast')
      .first()
      .textContent();
    console.log('Notification text:', notificationText);
  }

  // Wait for webview to load
  console.log('Waiting for webview to appear...');
  const webviewFrame = vscodeWindow.locator('iframe[src*="vscode-webview"]');

  // Wait for PDF viewer to load
  await expect(webviewFrame).toBeVisible({ timeout: 10000 });
  console.log('PDF viewer loaded, getting frame content...');

  // Get the outer webview frame
  const outerFrame = webviewFrame.contentFrame();
  if (!outerFrame) {
    throw new Error('Could not access webview frame content');
  }

  const innerIframe = outerFrame.locator('#active-frame');
  await expect(innerIframe).toBeVisible({ timeout: 10000 });

  const pdfFrame = innerIframe.contentFrame();
  if (!pdfFrame) {
    throw new Error('Could not access inner PDF viewer frame content');
  }

  // 1. Open the inspector
  const inspectorBtn = pdfFrame.locator('#inspectorBtn');
  await expect(inspectorBtn).toBeVisible();
  await inspectorBtn.click();

  const inspectorSidebar = pdfFrame.locator('#inspectorSidebar');
  await expect(inspectorSidebar).toBeVisible();
  await expect(inspectorSidebar).toHaveClass(/open/);

  // 2. Test mode switching
  const objectsModeBtn = pdfFrame.locator('.mode-btn[data-mode="objects"]');
  const pagesModeBtn = pdfFrame.locator('.mode-btn[data-mode="pages"]');

  // Default is 'objects' mode
  await objectsModeBtn.click();
  await expect(objectsModeBtn).toHaveClass(/active/);
  await expect(pagesModeBtn).not.toHaveClass(/active/);

  // Switch to 'pages' mode
  await pagesModeBtn.click();
  await expect(pagesModeBtn).toHaveClass(/active/);
  await expect(objectsModeBtn).not.toHaveClass(/active/);
  await expect(pdfFrame.locator('.tree-node[data-node="page-1"]')).toBeVisible();

  // Switch back to 'objects' mode
  await objectsModeBtn.click();
  await expect(objectsModeBtn).toHaveClass(/active/);
  await expect(pagesModeBtn).not.toHaveClass(/active/);
  await expect(pdfFrame.locator('.tree-node[data-node="images"]')).toBeVisible();

  // 3. Test object-centric scanning
  // Scan for metadata
  const metadataNode = pdfFrame.locator('.tree-node[data-node="metadata"]');
  await metadataNode.click();
  await expect(metadataNode).toHaveClass(/expanded/);
  await expect(pdfFrame.locator('.metadata-table tbody tr')).toHaveCount(14, { timeout: 5000 });

  // Test scanning for images (should be empty)
  const imagesNode = pdfFrame.locator('.tree-node[data-node="images"]');
  await imagesNode.click();
  await expect(imagesNode).toHaveClass(/expanded/);
  await expect(pdfFrame.locator('.tree-node[data-node="images"] .empty-message')).toHaveText(
    'No images found'
  );

  // Test scanning for tables
  const tablesNode = pdfFrame.locator('.tree-node[data-node="tables"]');
  await tablesNode.click();
  await expect(tablesNode).toHaveClass(/expanded/);
  await expect(
    pdfFrame
      .locator('.tree-node[data-node="tables"] .tree-object-preview[data-object-type="tables"]')
      .first()
  ).toBeVisible();

  // 4. Test page-centric scanning
  await pagesModeBtn.click();
  const page1Node = pdfFrame.locator('.tree-node[data-node="page-1"]');
  await page1Node.click();
  await expect(page1Node).toHaveClass(/expanded/);

  // Check for some objects within page 1
  await expect(
    pdfFrame
      .locator('.tree-node[data-node="page-1"] .tree-object-preview[data-object-type="fonts"]')
      .first()
  ).toBeVisible();
});
