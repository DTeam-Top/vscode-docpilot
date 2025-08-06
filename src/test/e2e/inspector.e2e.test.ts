import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import * as path from 'node:path';
import { openPdf, setupTest } from './e2eSetup';

let electronApp: ElectronApplication;
let vscodeWindow: Page;

const TEST_PDF_PATH = path.resolve(__dirname, '../fixtures/pdfs/normal.pdf');

test.beforeAll(async () => {
  const { electronApp: app, vscodeWindow: window } = await setupTest();
  electronApp = app;
  vscodeWindow = window;
});

test.afterAll(async () => {
  await electronApp?.close();
});

test('should perform end-to-end inspector testing', async () => {
  // Open the PDF and get the viewer frame
  const { pdfFrame } = await openPdf(vscodeWindow, TEST_PDF_PATH);
  const toolsDropdown = pdfFrame.locator('#toolsDropdown');
  await toolsDropdown.locator('.dropdown-btn').click();

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
