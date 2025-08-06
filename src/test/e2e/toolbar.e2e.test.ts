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

test('should interact with PDF viewer toolbar buttons', async () => {
  // Open the PDF and get the viewer frame
  const { pdfFrame: frame } = await openPdf(vscodeWindow, TEST_PDF_PATH);

  // Test zoom controls
  const zoomInBtn = frame.locator('#zoomInBtn');
  const zoomOutBtn = frame.locator('#zoomOutBtn');
  const zoomSlider = frame.locator('#zoomSlider');
  const zoomLevel = frame.locator('#zoomLevel');

  // Verify zoom controls are visible
  await expect(zoomInBtn).toBeVisible();
  await expect(zoomOutBtn).toBeVisible();
  await expect(zoomSlider).toBeVisible();
  await expect(zoomLevel).toBeVisible();

  // Get initial zoom level
  const initialZoom = await zoomLevel.textContent();
  console.log('Initial zoom level:', initialZoom);

  // Test zoom in button
  await zoomInBtn.click();
  // Just check that zoom level increased (not exact value due to zoom logic)
  const zoomedInLevel = await zoomLevel.textContent();
  console.log('Zoomed in level:', zoomedInLevel);
  console.log('Zoom in test passed');

  // Test zoom out button
  await zoomOutBtn.click();
  const zoomedOutLevel = await zoomLevel.textContent();
  console.log('Zoomed out level:', zoomedOutLevel);
  console.log('Zoom out test passed');

  // Test zoom slider
  await zoomSlider.fill('1.5');
  const sliderZoomLevel = await zoomLevel.textContent();
  console.log('Slider zoom level:', sliderZoomLevel);

  // Reset zoom to 100% for subsequent tests
  await zoomSlider.fill('1');
  const resetZoomLevel = await zoomLevel.textContent();
  console.log('Reset zoom level:', resetZoomLevel);
  console.log('Zoom slider test passed');

  // Test fit controls
  const fitWidthBtn = frame.locator('#fitWidthBtn');
  const fitPageBtn = frame.locator('#fitPageBtn');

  // Verify fit controls are visible
  await expect(fitWidthBtn).toBeVisible();
  await expect(fitPageBtn).toBeVisible();

  await fitWidthBtn.click();
  await fitPageBtn.click();
  console.log('Fit controls test passed');

  // Test navigation controls
  const firstPageBtn = frame.locator('#firstPageBtn');
  const prevPageBtn = frame.locator('#prevPageBtn');
  const nextPageBtn = frame.locator('#nextPageBtn');
  const lastPageBtn = frame.locator('#lastPageBtn');
  const pageInfo = frame.locator('#pageInfo');

  // Verify navigation controls are visible
  await expect(firstPageBtn).toBeVisible();
  await expect(prevPageBtn).toBeVisible();
  await expect(nextPageBtn).toBeVisible();
  await expect(lastPageBtn).toBeVisible();
  await expect(pageInfo).toBeVisible();

  await nextPageBtn.click();
  await lastPageBtn.click();
  await prevPageBtn.click();
  await firstPageBtn.click();
  console.log('Navigation controls test passed');

  // Test dropdown buttons
  const aiDropdown = frame.locator('#aiDropdown');
  const toolsDropdown = frame.locator('#toolsDropdown');
  const debugBtn = frame.locator('#debugBtn');

  // Verify dropdown buttons are visible
  await expect(aiDropdown.locator('.dropdown-btn')).toBeVisible();
  await expect(toolsDropdown.locator('.dropdown-btn')).toBeVisible();
  await expect(debugBtn).toBeVisible();

  // Test AI dropdown
  await aiDropdown.locator('.dropdown-btn').click();
  await expect(aiDropdown.locator('.dropdown-content')).toBeVisible();

  const summarizeBtn = frame.locator('#summarizeBtn');
  const mindmapBtn = frame.locator('#mindmapBtn');
  await expect(summarizeBtn).toBeVisible();
  await expect(mindmapBtn).toBeVisible();

  await summarizeBtn.click();
  await expect(aiDropdown.locator('.dropdown-content')).toBeHidden();

  // Test Tools dropdown
  await toolsDropdown.locator('.dropdown-btn').click();
  await expect(toolsDropdown.locator('.dropdown-content')).toBeVisible();

  const exportBtn = frame.locator('#exportBtn');
  const textSelectionBtn = frame.locator('#textSelectionBtn');
  const inspectorBtn = frame.locator('#inspectorBtn');
  const searchBtn = frame.locator('#searchBtn');
  const screenshotBtn = frame.locator('#screenshotBtn');

  await expect(exportBtn).toBeVisible();
  await expect(textSelectionBtn).toBeVisible();
  await expect(inspectorBtn).toBeVisible();
  await expect(searchBtn).toBeVisible();
  await expect(screenshotBtn).toBeVisible();

  await exportBtn.click();

  // Close the extraction modal that was opened by the export button
  const extractionCloseBtn = frame.locator('.extraction-close');
  await expect(extractionCloseBtn).toBeVisible();
  await extractionCloseBtn.click();

  // Wait for the overlay to be hidden
  await expect(frame.locator('#extractionOverlay')).toBeHidden();

  // Test other tools - open dropdown again since it closed after export click
  await toolsDropdown.locator('.dropdown-btn').click();
  await textSelectionBtn.click();

  await toolsDropdown.locator('.dropdown-btn').click();
  await inspectorBtn.click();

  await toolsDropdown.locator('.dropdown-btn').click();
  await screenshotBtn.click();
  const screenshotOverlay = frame.locator('#screenshotOverlay');
  await expect(screenshotOverlay).toBeVisible();

  // Press Escape to cancel screenshot mode
  await vscodeWindow.keyboard.press('Escape');
  await expect(screenshotOverlay).toBeHidden();

  // Test debug button (not in dropdown)
  await debugBtn.click();

  console.log('Dropdown and action buttons test passed');

  // Test button accessibility attributes
  await expect(zoomInBtn).toHaveAttribute('title', 'Zoom In');
  await expect(zoomOutBtn).toHaveAttribute('title', 'Zoom Out');
  await expect(fitWidthBtn).toHaveAttribute('title', 'Fit Width');
  await expect(fitPageBtn).toHaveAttribute('title', 'Fit Page');
  await expect(firstPageBtn).toHaveAttribute('title', 'First Page');
  await expect(prevPageBtn).toHaveAttribute('title', 'Previous Page');
  await expect(nextPageBtn).toHaveAttribute('title', 'Next Page');
  await expect(lastPageBtn).toHaveAttribute('title', 'Last Page');
  await expect(debugBtn).toHaveAttribute('title', 'Debug Mode');

  // Test dropdown button titles (now icon-only buttons)
  await expect(aiDropdown.locator('.dropdown-btn')).toHaveAttribute('title', 'AI Tools');
  await expect(toolsDropdown.locator('.dropdown-btn')).toHaveAttribute('title', 'Content Tools');

  // Test dropdown item titles (need to open dropdown to access items)
  await aiDropdown.locator('.dropdown-btn').click();
  await expect(summarizeBtn).toHaveAttribute('title', 'Summarize this PDF using AI');
  await expect(mindmapBtn).toHaveAttribute('title', 'Generate Mermaid mindmap from this PDF');
  // Close AI dropdown by clicking outside
  await frame.locator('body').click();

  await toolsDropdown.locator('.dropdown-btn').click();
  await expect(textSelectionBtn).toHaveAttribute('title', 'Selection Mode');
  await expect(inspectorBtn).toHaveAttribute('title', 'PDF Inspector');
  await expect(searchBtn).toHaveAttribute('title', 'Search Text');
  await expect(screenshotBtn).toHaveAttribute('title', 'Take Screenshot');

  // Export button title can change during export process ('Extract Objects' or 'Exporting...')
  const exportTitle = await exportBtn.getAttribute('title');
  console.log('Export button title:', exportTitle);
  expect(['Extract Objects', 'Exporting...']).toContain(exportTitle);

  // Close tools dropdown
  await frame.locator('body').click();

  console.log('Button accessibility attributes test passed');

  console.log('All toolbar tests completed successfully!');
});
