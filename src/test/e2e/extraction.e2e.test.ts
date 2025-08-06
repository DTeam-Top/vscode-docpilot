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

test('should perform end-to-end object extraction and verify the summary', async () => {
  // Create temp directory for this test
  tempDir = await fs.mkdtemp(path.join(__dirname, 'e2e-extraction-'));

  // Open the PDF and get the viewer frame
  const { pdfFrame } = await openPdf(vscodeWindow, TEST_PDF_PATH);

  // 1. Open the extraction modal (now in Tools dropdown)
  const toolsDropdown = pdfFrame.locator('#toolsDropdown');
  await toolsDropdown.locator('.dropdown-btn').click();

  const exportBtn = pdfFrame.locator('#exportBtn');
  await expect(exportBtn).toBeVisible();
  await exportBtn.click();

  const extractionModal = pdfFrame.locator('#extractionOverlay');
  await expect(extractionModal).toBeVisible();

  // 2. Select object types (Text and Images)
  await pdfFrame.locator('#type-text').check();
  await pdfFrame.locator('#type-images').check();

  // 3. Set the save directory via browse button
  const browseBtn = pdfFrame.locator('.folder-browse-btn');
  await expect(browseBtn).toBeVisible();
  await browseBtn.click();

  // Wait a moment for the browse message to be sent
  await vscodeWindow.waitForTimeout(1000);

  // Simulate the extension's folderSelected message response
  // This is the proper way the webview receives folder selection from the extension
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

    console.log('Dispatching folderSelected message:', messageEvent.data);
    window.dispatchEvent(messageEvent);
  }, tempDir);

  // Wait for the message to be processed
  await vscodeWindow.waitForTimeout(1000);

  // Verify the folder path was set
  const folderInput = pdfFrame.locator('#folderPath');
  await expect(folderInput).toHaveValue(tempDir);

  // Check the button state
  const startExtractionBtn = pdfFrame.locator('#startExtractionBtn');
  const buttonText = await startExtractionBtn.textContent();
  const buttonEnabled = await startExtractionBtn.isEnabled();
  console.log('After folder selection - Button text:', buttonText);
  console.log('After folder selection - Button enabled:', buttonEnabled);

  // 4. Run the extraction
  await expect(startExtractionBtn).toBeEnabled();
  await startExtractionBtn.click();

  // 5. Wait for completion by checking for the summary file
  console.log('Extraction started, waiting for completion...');

  // Wait a bit for the extraction to start processing
  await vscodeWindow.waitForTimeout(3000);

  // Check what's in the temp directory
  const tempDirContents = await fs.readdir(tempDir);
  console.log('Temp directory contents:', tempDirContents);

  const extractionDirs = tempDirContents.filter((item) => item.startsWith('normal_extracted_'));
  console.log('Found extraction directories:', extractionDirs);

  const extractionDir = extractionDirs[0];
  expect(extractionDir).toBeDefined();

  if (!extractionDir) {
    throw new Error('Extraction directory not found');
  }

  // Check what's actually in the extraction directory
  const extractionDirPath = path.join(tempDir, extractionDir);
  const extractionDirContents = await fs.readdir(extractionDirPath);
  console.log('Extraction directory contents:', extractionDirContents);

  const summaryPath = path.join(extractionDirPath, 'extraction_summary.json');

  await expect
    .poll(
      async () => {
        try {
          await fs.access(summaryPath);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 15000 }
    )
    .toBe(true);

  // 6. Read and verify the summary file
  const summaryContent = await fs.readFile(summaryPath, 'utf-8');
  const summary = JSON.parse(summaryContent);

  // 7. Enhanced Assertions
  // Verify we have exactly the 2 types we selected (text and images)
  const resultTypes = Object.keys(summary.results);
  expect(resultTypes).toHaveLength(2);
  expect(resultTypes).toContain('text');
  expect(resultTypes).toContain('images');
  console.log('Summary contains expected result types:', resultTypes);

  // Verify text extraction results
  expect(summary.results.text.count).toBeGreaterThan(0);
  expect(summary.results.text.files).toHaveLength(1);
  expect(summary.results.text.files[0]).toMatch(/\.txt$/);
  console.log(
    'Text extraction - Count:',
    summary.results.text.count,
    'Files:',
    summary.results.text.files.length
  );

  // Verify images extraction results (should be empty for this PDF)
  expect(summary.results.images.count).toBe(0);
  expect(summary.results.images.files).toHaveLength(0);
  console.log(
    'Images extraction - Count:',
    summary.results.images.count,
    'Files:',
    summary.results.images.files.length
  );

  // Verify the images directory exists but is empty
  const imagesDirPath = path.join(extractionDirPath, 'images');
  const imagesDirExists = await fs
    .access(imagesDirPath)
    .then(() => true)
    .catch(() => false);
  expect(imagesDirExists).toBe(true);

  if (imagesDirExists) {
    const imagesDirContents = await fs.readdir(imagesDirPath);
    expect(imagesDirContents).toHaveLength(0);
    console.log('Images directory exists and is empty:', imagesDirContents.length === 0);
  }

  // 8. Verify text content
  // Check if the path in summary is absolute or relative
  const textFileFromSummary = summary.results.text.files[0];
  const textFilePath = path.isAbsolute(textFileFromSummary)
    ? textFileFromSummary
    : path.join(extractionDirPath, textFileFromSummary);

  console.log('Text file path from summary:', textFileFromSummary);
  console.log('Final text file path:', textFilePath);

  const extractedText = await fs.readFile(textFilePath, 'utf-8');
  const lowerCaseText = extractedText.toLowerCase();

  const expectedWords = ['google', 'hybrid', 'approach', 'research'];
  for (const word of expectedWords) {
    expect(lowerCaseText).toContain(word);
  }

  // Clean up temp directory
  await fs.rm(tempDir, { recursive: true, force: true });
});
