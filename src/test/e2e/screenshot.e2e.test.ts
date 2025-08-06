import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadEnvFile } from '../helpers/envLoader';

let electronApp: ElectronApplication;
let vscodeWindow: Page;
let tempDir: string;

const EXTENSION_PATH = path.resolve(__dirname, '../../../');

console.log('Extension path:', EXTENSION_PATH);

const TEST_PDF_PATH = path.resolve(__dirname, '../fixtures/pdfs/normal.pdf');

test.beforeAll(async () => {
  // Load environment variables from .env file (needed for Copilot auth)
  loadEnvFile(path.resolve(__dirname, '../../../.env'));
  console.log('Environment variables loaded from .env file');

  const executablePath = await downloadAndUnzipVSCode();
  console.log('VSCode executable path:', executablePath);

  try {
    // Launch with proper extension loading and workspace
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
        // Pass the auth token to the extension environment for Copilot integration
        ...(process.env.COPILOT_CHAT_AUTH_TOKEN && {
          COPILOT_CHAT_AUTH_TOKEN: process.env.COPILOT_CHAT_AUTH_TOKEN,
        }),
      },
      timeout: 60000,
    });

    console.log('Electron app launched successfully');

    // Check if any windows exist
    const windows = electronApp.windows();
    console.log('Number of windows:', windows.length);

    if (windows.length === 0) {
      console.log('Waiting for window...');
      await electronApp.waitForEvent('window', { timeout: 30000 });
    }

    vscodeWindow = await electronApp.firstWindow();
    console.log('Got first window');

    await vscodeWindow.waitForLoadState('domcontentloaded');
    console.log('Window loaded');

    // Wait for VSCode workbench to be ready
    await vscodeWindow.waitForSelector('.monaco-workbench', { timeout: 30000 });
    console.log('VSCode workbench ready');
  } catch (error) {
    console.error('Failed in beforeAll:', error);
    throw error;
  }
});

test.afterAll(async () => {
  await electronApp?.close();
});

test('should perform end-to-end screenshot capture with folder selection and save', async () => {
  // Create temp directory for this test
  tempDir = await fs.mkdtemp(path.join(__dirname, 'e2e-screenshot-'));

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

  // Access the inner iframe that contains the actual PDF viewer
  const innerIframe = outerFrame.locator('#active-frame');
  await expect(innerIframe).toBeVisible({ timeout: 10000 });

  const pdfFrame = innerIframe.contentFrame();
  if (!pdfFrame) {
    throw new Error('Could not access inner PDF viewer frame content');
  }

  console.log('Successfully accessed PDF viewer frame');

  // 1. Click screenshot button to start screenshot mode (now in Tools dropdown)
  const toolsDropdown = pdfFrame.locator('#toolsDropdown');
  await toolsDropdown.locator('.dropdown-btn').click();
  
  const screenshotBtn = pdfFrame.locator('#screenshotBtn');
  await expect(screenshotBtn).toBeVisible();
  await screenshotBtn.click();

  // Verify screenshot overlay is active
  const screenshotOverlay = pdfFrame.locator('#screenshotOverlay');
  await expect(screenshotOverlay).toBeVisible();
  await expect(screenshotOverlay).toHaveClass(/active/);

  console.log('Screenshot mode activated');

  // 2. Perform drag selection on the PDF content
  const pdfContainer = pdfFrame.locator('.pdf-container');
  await expect(pdfContainer).toBeVisible();

  // Get the bounds of the PDF container for drag selection
  const containerBounds = await pdfContainer.boundingBox();
  if (!containerBounds) {
    throw new Error('Could not get PDF container bounds');
  }

  // Simulate drag selection from top-left to bottom-right of a reasonable area
  const startX = containerBounds.x + 100;
  const startY = containerBounds.y + 100;
  const endX = containerBounds.x + 400;
  const endY = containerBounds.y + 300;

  // Perform the drag operation using the main page mouse (coordinates are relative to viewport)
  await vscodeWindow.mouse.move(startX, startY);
  await vscodeWindow.mouse.down();
  await vscodeWindow.mouse.move(endX, endY);
  await vscodeWindow.mouse.up();

  console.log(`Performed drag selection from (${startX}, ${startY}) to (${endX}, ${endY})`);

  // 3. Verify screenshot modal appears
  const screenshotModal = pdfFrame.locator('#screenshotModalOverlay');
  await expect(screenshotModal).toBeVisible({ timeout: 5000 });

  console.log('Screenshot modal opened');

  // 4. Click "Save to File" button to show folder selection
  const saveToFileBtn = pdfFrame.locator('#saveToFileBtn');
  await expect(saveToFileBtn).toBeVisible();
  await saveToFileBtn.click();

  // Verify folder selection section appears
  const folderSection = pdfFrame.locator('#folderSection');
  await expect(folderSection).toBeVisible();

  console.log('Folder selection section shown');

  // 5. Click browse button for folder selection
  const browseBtn = pdfFrame.locator('#screenshotBrowseBtn');
  await expect(browseBtn).toBeVisible();
  await browseBtn.click();

  // Wait a moment for the browse message to be sent
  await vscodeWindow.waitForTimeout(1000);

  // 6. Simulate the extension's folderSelected message response
  await pdfFrame.locator('body').evaluate((_, tempDir: string) => {
    // Simulate the message event that would come from the extension
    const messageEvent = new MessageEvent('message', {
      data: {
        type: 'folderSelected',
        data: {
          folderPath: tempDir,
        },
      },
      origin: 'vscode-webview://localhost',
    });

    console.log('Dispatching folderSelected message for screenshot:', messageEvent.data);
    window.dispatchEvent(messageEvent);
  }, tempDir);

  // Wait for the message to be processed
  await vscodeWindow.waitForTimeout(1000);

  // 7. Verify the folder path was set
  const folderInput = pdfFrame.locator('#screenshotFolderPath');
  await expect(folderInput).toHaveValue(tempDir);

  // Check the save button is now enabled
  const saveButtonEnabled = await saveToFileBtn.isEnabled();
  console.log('Save button enabled after folder selection:', saveButtonEnabled);
  expect(saveButtonEnabled).toBe(true);

  console.log('Folder path set successfully:', tempDir);

  // 8. Click save button to proceed with save
  await saveToFileBtn.click();

  // Wait for save operation to complete
  await vscodeWindow.waitForTimeout(2000);

  // 9. Verify screenshot file was created
  const tempDirContents = await fs.readdir(tempDir);
  console.log('Temp directory contents:', tempDirContents);

  // Look for screenshot files with the expected pattern: screenshot-page-1-YYYYMMDD-HHMMSS.png
  const screenshotFiles = tempDirContents.filter(
    (file) => file.startsWith('screenshot-page-') && file.endsWith('.png')
  );
  console.log('Found screenshot files:', screenshotFiles);

  expect(screenshotFiles).toHaveLength(1);
  const screenshotFile = screenshotFiles[0];

  // 10. Verify the screenshot file properties
  const screenshotPath = path.join(tempDir, screenshotFile);
  const stats = await fs.stat(screenshotPath);

  expect(stats.isFile()).toBe(true);
  expect(stats.size).toBeGreaterThan(0);
  console.log('Screenshot file created successfully:', screenshotFile, `Size: ${stats.size} bytes`);

  // 11. Verify filename format: screenshot-page-{pageNum}-{YYYYMMDD}-{HHMMSS}.png
  const fileNamePattern = /^screenshot-page-\d+-\d{8}-\d{6}\.png$/;
  expect(screenshotFile).toMatch(fileNamePattern);
  console.log('Screenshot filename matches expected pattern');

  // 12. Verify the modal was closed after successful save
  await expect(screenshotModal).toBeHidden();
  console.log('Screenshot modal closed after save');

  // 13. Verify screenshot mode was deactivated
  await expect(screenshotOverlay).toBeHidden();
  console.log('Screenshot mode deactivated');

  // Clean up temp directory
  await fs.rm(tempDir, { recursive: true, force: true });
  console.log('Screenshot E2E test completed successfully!');
});
