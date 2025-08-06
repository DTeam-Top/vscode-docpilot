import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { openPdf, setupTest } from './e2eSetup';

let electronApp: ElectronApplication;
let vscodeWindow: Page;
let tempDir: string;

const TEST_PDF_PATH = path.resolve(__dirname, '../fixtures/pdfs/normal.pdf');

test.beforeAll(async () => {
  const { electronApp: app, vscodeWindow: window } = await setupTest();
  electronApp = app;
  vscodeWindow = window;
});

test.afterAll(async () => {
  await electronApp?.close();
});

test('should perform end-to-end screenshot capture with folder selection and save', async () => {
  // Create temp directory for this test
  tempDir = await fs.mkdtemp(path.join(__dirname, 'e2e-screenshot-'));

  // Open the PDF and get the viewer frame
  const { pdfFrame } = await openPdf(vscodeWindow, TEST_PDF_PATH);

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
