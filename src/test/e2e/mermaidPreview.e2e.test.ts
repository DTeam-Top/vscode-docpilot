import * as path from 'node:path';
import { type ElectronApplication, expect, type Frame, type Page, test } from '@playwright/test';
import { fillFileDialog, runCommand, setupTest } from './e2eSetup';

let electronApp: ElectronApplication | undefined;
let vscodeWindow: Page;

// VSCode 1.143+ ships a built-in Mermaid renderer for the markdown preview. DocPilot defers to it
// when present, so DocPilot's own rendering is tested with the built-in one disabled.
const BUILT_IN_MERMAID_EXTENSION = 'vscode.mermaid-markdown-features';
const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/markdowns/mermaid.md');

async function launchVSCode(extraArgs: string[] = []): Promise<void> {
  const { electronApp: app, vscodeWindow: window } = await setupTest(extraArgs);
  electronApp = app;
  vscodeWindow = window;
}

async function closeVSCode(): Promise<void> {
  await electronApp?.close();
  electronApp = undefined;
}

/**
 * Close every editor via the command palette. Unlike Cmd/Ctrl+W, this never closes the
 * window when nothing is open, and it clears editors restored from a previous run.
 */
async function closeAllEditors(window: Page): Promise<void> {
  await runCommand(window, 'View: Close All Editors');
  await window.waitForTimeout(500);
}

test.beforeEach(async () => {
  await closeAllEditors(vscodeWindow);
});

test.afterEach(async () => {
  await closeAllEditors(vscodeWindow);
});

/**
 * Helper function to open a markdown file and its preview
 */
async function openMarkdownPreview(window: Page, filePath: string): Promise<Frame> {
  // Open the markdown file using command palette - step 1: trigger command
  await runCommand(window, 'File: Open File...');

  // Step 2: fill in the file path
  await fillFileDialog(window, 'Open File', filePath);
  await window.waitForTimeout(2000);

  console.log('Markdown file opened in editor, opening preview...');

  // Open the preview via the command palette: the Cmd/Ctrl+Shift+V shortcut only works when the
  // markdown editor has focus, which is not the case on first launch (e.g. the Chat view takes it)
  await runCommand(window, 'Markdown: Open Preview');
  await window.waitForTimeout(2000);

  console.log('Waiting for markdown preview iframe to appear...');

  // Wait for the webview iframe to appear
  const webviewSelector = 'iframe.webview';
  await window.waitForSelector(webviewSelector, { timeout: 10000 });
  console.log('Found webview iframe');

  await window.waitForTimeout(2000);

  // Find the frame that hosts the markdown preview content. Frames of previously closed
  // webviews can linger, so pick by content rather than taking the first webview frame.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    for (const frame of window.frames()) {
      if (frame.isDetached() || !frame.url().includes('vscode-webview')) {
        continue;
      }
      const hasPreview = await frame
        .evaluate(() => document.querySelector('.markdown-body') !== null)
        .catch(() => false);
      if (hasPreview) {
        console.log(`Using preview frame with URL: ${frame.url()}`);
        return frame;
      }
    }
    await window.waitForTimeout(500);
  }

  throw new Error('Could not find markdown preview frame');
}

test.describe('DocPilot renderer', () => {
  test.beforeAll(async () => {
    await launchVSCode([`--disable-extension=${BUILT_IN_MERMAID_EXTENSION}`]);
  });

  test.afterAll(closeVSCode);

  test('should render mermaid diagrams with both formats and show errors for invalid syntax', async () => {
    // The fixture has both correct and error diagrams in both formats
    const previewFrame = await openMarkdownPreview(vscodeWindow, FIXTURE_PATH);

    // Wait for mermaid containers to appear (the renderer processes diagrams asynchronously)
    console.log('Waiting for mermaid diagrams to render...');
    await previewFrame.waitForSelector('.mermaid-container', { timeout: 10000 });

    // Should have 4 containers total (2 correct + 2 errors). Retry the count: the preview can
    // re-render its content, and diagrams appear as the renderer processes the new blocks.
    const allContainers = previewFrame.locator('.mermaid-container');
    await expect(allContainers).toHaveCount(4, { timeout: 15000 });

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

    // Test 3: The original source is kept on the container
    await expect(firstDiagram).toHaveAttribute('data-mermaid-source', /^flowchart TD/);

    console.log('\n✅ All tests passed:');
    console.log('  - Markdown code block format renders correctly');
    console.log('  - HTML pre block format renders correctly');
    console.log('  - Invalid markdown format shows error message');
    console.log('  - Invalid HTML pre format shows error message');
  });

  test('should not re-render blocks already rendered to SVG by another renderer', async () => {
    const previewFrame = await openMarkdownPreview(vscodeWindow, FIXTURE_PATH);
    const containers = previewFrame.locator('.mermaid-container');
    const errorContainers = previewFrame.locator('.mermaid-error-container');
    await expect(containers).toHaveCount(4, { timeout: 15000 });
    await expect(errorContainers).toHaveCount(2);

    // Simulate another renderer (e.g. VS Code's built-in preview or another extension) that has
    // already replaced a mermaid block's source with an SVG. Its textContent is SVG labels + CSS,
    // which previously got fed back to the renderer and produced "No diagram type detected".
    // Also append a fresh source block to prove the content observer still renders new diagrams.
    await previewFrame.evaluate(() => {
      const foreign = document.createElement('pre');
      foreign.className = 'mermaid';
      foreign.id = 'foreign-rendered';
      foreign.innerHTML =
        '<svg id="dmermaid-test" xmlns="http://www.w3.org/2000/svg">' +
        '<style>#dmermaid-test{font-family:sans-serif;fill:#616161;}</style>' +
        '<text>storage</text><text>agent LLM</text></svg>';
      document.body.appendChild(foreign);

      const fresh = document.createElement('pre');
      fresh.className = 'mermaid';
      fresh.textContent = 'graph LR\n  X[Injected] --> Y[Rendered]';
      document.body.appendChild(fresh);
    });

    // The fresh block is rendered, the foreign one is left alone and produces no error
    await expect(containers).toHaveCount(5, { timeout: 10000 });
    await expect(containers.nth(4)).toHaveClass(/mermaid-rendered/);
    await expect(containers.nth(4).locator('svg')).toBeVisible();
    await expect(errorContainers).toHaveCount(2);
    await expect(previewFrame.locator('#foreign-rendered > svg#dmermaid-test')).toHaveCount(1);
    console.log('✓ Blocks already rendered by another renderer are skipped');
  });
});

test.describe('with VSCode built-in Mermaid renderer', () => {
  test.beforeAll(async () => {
    await launchVSCode();
  });

  test.afterAll(closeVSCode);

  test('should defer to the built-in renderer', async () => {
    const previewFrame = await openMarkdownPreview(vscodeWindow, FIXTURE_PATH);

    // The built-in renderer's marker is present and it renders the two valid diagrams
    await expect(previewFrame.locator('#markdown-mermaid')).toHaveCount(1);
    await expect(previewFrame.locator('.mermaid svg').first()).toBeVisible({ timeout: 15000 });

    // DocPilot creates no containers, so there is no race and no "Mermaid Syntax Error" from it
    await previewFrame.waitForTimeout(2000);
    await expect(previewFrame.locator('.mermaid-container')).toHaveCount(0);
    console.log('✓ DocPilot defers to the built-in Mermaid renderer');
  });
});
