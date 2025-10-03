import * as path from 'node:path';
import { type ElectronApplication, expect, type Frame, type Page, test } from '@playwright/test';
import { setupTest } from './e2eSetup';

let electronApp: ElectronApplication;
let vscodeWindow: Page;

test.beforeAll(async () => {
  const { electronApp: app, vscodeWindow: window } = await setupTest();
  electronApp = app;
  vscodeWindow = window;
});

test.afterAll(async () => {
  await electronApp?.close();
});

/**
 * Helper function to open a markdown file and its preview
 */
async function openMarkdownPreview(window: Page, filePath: string): Promise<Frame> {
  // Open the markdown file using command palette - step 1: trigger command
  await window.keyboard.press('F1');
  await window.fill('input[placeholder*="Type the name"]', 'File: Open');
  await window.keyboard.press('Enter');

  // Step 2: fill in the file path
  await window.waitForSelector('input[type="text"]', { timeout: 10000 });
  await window.fill('input[type="text"]', filePath);

  const inputValue = await window.locator('input[type="text"]').inputValue();
  if (!inputValue) {
    await window.fill('input[type="text"]', filePath);
    await window.waitForTimeout(2000);
  }
  await window.keyboard.press('Enter');
  await window.waitForTimeout(2000);

  console.log('Markdown file opened in editor, opening preview...');

  // Open the preview with Cmd+Shift+V (Mac) or Ctrl+Shift+V (Windows/Linux)
  const isMac = process.platform === 'darwin';
  const previewShortcut = isMac ? 'Meta+Shift+V' : 'Control+Shift+V';
  await window.keyboard.press(previewShortcut);
  await window.waitForTimeout(2000);

  console.log('Waiting for markdown preview iframe to appear...');

  // Wait for the webview iframe to appear
  const webviewSelector = 'iframe.webview';
  await window.waitForSelector(webviewSelector, { timeout: 10000 });
  console.log('Found webview iframe');

  await window.waitForTimeout(2000);

  // Get all frames and find the webview frames
  const frames = window.frames();
  console.log(`Total frames: ${frames.length}`);

  // Find the outer webview frame
  let outerFrame: Frame | null = null;
  for (const frame of frames) {
    const url = frame.url();
    if (url.includes('vscode-webview')) {
      outerFrame = frame;
      console.log(`Found outer webview frame with URL: ${url}`);
      break;
    }
  }

  if (!outerFrame) {
    console.log('Available frames:');
    for (const frame of frames) {
      console.log(`  - ${frame.url()}`);
    }
    throw new Error('Could not find outer webview frame');
  }

  // Check if there are child frames (nested iframes)
  const childFrames = outerFrame.childFrames();
  console.log(`Child frames in outer frame: ${childFrames.length}`);

  if (childFrames.length > 0) {
    console.log(`Using first child frame with URL: ${childFrames[0].url()}`);
    return childFrames[0];
  }

  console.log('No child frames, using outer frame');
  return outerFrame;
}

test('should render mermaid diagrams with both formats and show errors for invalid syntax', async () => {
  // Use the test fixture file that has both correct and error formats
  const testFilePath = path.resolve(__dirname, '../fixtures/markdowns/mermaid.md');

  const previewFrame = await openMarkdownPreview(vscodeWindow, testFilePath);

  // Wait for mermaid containers to appear (the renderer processes diagrams asynchronously)
  console.log('Waiting for mermaid diagrams to render...');
  await previewFrame.waitForSelector('.mermaid-container', { timeout: 10000 });

  // Wait a bit more for all diagrams to finish rendering
  await previewFrame.waitForTimeout(2000);

  // Get all mermaid containers (both rendered and error)
  const allContainers = previewFrame.locator('.mermaid-container');
  const containerCount = await allContainers.count();

  console.log(`Total mermaid containers found: ${containerCount}`);

  // Should have 4 containers total (2 correct + 2 errors)
  expect(containerCount).toBe(4);

  // Test 1: Verify correctly rendered diagrams (first 2 should be correct)
  // First diagram: Markdown code block format (correct)
  const firstDiagram = allContainers.nth(0);
  await expect(firstDiagram).toHaveClass(/mermaid-rendered/);
  const firstSvg = firstDiagram.locator('svg');
  await expect(firstSvg).toBeVisible();
  console.log('✓ First diagram (markdown format) rendered correctly');

  // Second diagram: HTML pre block format (correct)
  const secondDiagram = allContainers.nth(1);
  await expect(secondDiagram).toHaveClass(/mermaid-rendered/);
  const secondSvg = secondDiagram.locator('svg');
  await expect(secondSvg).toBeVisible();
  console.log('✓ Second diagram (HTML pre format) rendered correctly');

  // Test 2: Verify error messages for invalid diagrams (last 2 should be errors)
  // Third diagram: Markdown code block format (error - flowchart1 instead of flowchart)
  const thirdDiagram = allContainers.nth(2);
  await expect(thirdDiagram).toHaveClass(/mermaid-error-container/);
  const thirdError = thirdDiagram.locator('.mermaid-error');
  await expect(thirdError).toBeVisible();
  const thirdErrorText = await thirdError.textContent();
  expect(thirdErrorText).toMatch(/error|Error|syntax/i);
  console.log('✓ Third diagram (markdown format error) shows error message');

  // Fourth diagram: HTML pre block format (error - --+> instead of -->)
  const fourthDiagram = allContainers.nth(3);
  await expect(fourthDiagram).toHaveClass(/mermaid-error-container/);
  const fourthError = fourthDiagram.locator('.mermaid-error');
  await expect(fourthError).toBeVisible();
  const fourthErrorText = await fourthError.textContent();
  expect(fourthErrorText).toMatch(/error|Error|syntax/i);
  console.log('✓ Fourth diagram (HTML pre format error) shows error message');

  console.log('\n✅ All tests passed:');
  console.log('  - Markdown code block format renders correctly');
  console.log('  - HTML pre block format renders correctly');
  console.log('  - Invalid markdown format shows error message');
  console.log('  - Invalid HTML pre format shows error message');

  // Cleanup: Close all opened editors
  const isMac = process.platform === 'darwin';
  const closeShortcut = isMac ? 'Meta+W' : 'Control+W';

  // Close preview tab
  await vscodeWindow.keyboard.press(closeShortcut);
  await vscodeWindow.waitForTimeout(500);

  // Close markdown file tab
  await vscodeWindow.keyboard.press(closeShortcut);
  await vscodeWindow.waitForTimeout(500);
});
