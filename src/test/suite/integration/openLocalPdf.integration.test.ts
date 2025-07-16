import { expect } from 'chai';
import * as vscode from 'vscode';
import {
  cleanupPdfViewers,
  getPdfViewerTitle,
  isPdfViewerVisible,
  openRealLocalPdf,
  TEST_PDF_PATH,
  waitForPdfLoad,
} from '../../helpers/pdfTestUtils';
import { monitorMemoryUsage, testFileSystemAccess } from '../../helpers/realIntegrationUtils';

describe('OpenLocalPdf Integration', () => {
  afterEach(async () => {
    await cleanupPdfViewers();
  });

  it('should validate real file system access before opening PDF', async function () {
    this.timeout(8000);

    // Test real file system validation
    const fileResults = await testFileSystemAccess(TEST_PDF_PATH);

    console.log('File system validation:', fileResults);
    expect(fileResults.exists).to.be.true;
    expect(fileResults.readable).to.be.true;
    expect(fileResults.isPdf).to.be.true;
  });

  it('should monitor real memory usage during PDF operations', async function () {
    this.timeout(15000);

    // Monitor memory while opening PDF
    const memoryPromise = monitorMemoryUsage();

    // Perform PDF operations
    const viewer = await openRealLocalPdf();
    expect(viewer).to.exist;

    await waitForPdfLoad(5000);

    const memoryResults = await memoryPromise;
    console.log('Memory usage during PDF operation:', memoryResults);

    expect(memoryResults.initial).to.be.a('number');
    expect(memoryResults.peak).to.be.a('number');
    expect(memoryResults.final).to.be.a('number');
  });

  it('should open real local PDF file and create viewer', async function () {
    this.timeout(10000); // Allow time for real PDF loading

    const viewer = await openRealLocalPdf();

    // Test real outcomes, not mocks
    expect(viewer).to.exist;

    // Wait for PDF to load before checking visibility
    const loaded = await waitForPdfLoad(3000);
    expect(loaded).to.be.true;

    expect(await isPdfViewerVisible()).to.be.true;

    const title = await getPdfViewerTitle();
    expect(title).to.include('normal.pdf');
  });

  it('should handle file not found errors gracefully', async function () {
    this.timeout(5000);

    try {
      await vscode.commands.executeCommand('docpilot.openLocalPdf', '/nonexistent/file.pdf');
      expect.fail('Should have thrown error for non-existent file');
    } catch (error) {
      const msg = (error as Error).message;
      console.log('Error message received:', msg);
      expect(msg).to.satisfy(
        (message: string) =>
          message.includes('not found') ||
          message.includes('ENOENT') ||
          message.includes('Invalid') ||
          message.includes('Failed to load PDF') ||
          message.includes('File not found')
      );
    }
  });

  it('should open real PDF and allow interaction', async function () {
    this.timeout(10000);

    const viewer = await openRealLocalPdf();
    expect(viewer).to.exist;

    // Wait for PDF to load
    const loaded = await waitForPdfLoad(5000);
    expect(loaded).to.be.true;

    // Verify viewer is visible and functional
    expect(await isPdfViewerVisible()).to.be.true;
  });

  it('should handle multiple PDF openings', async function () {
    this.timeout(15000);

    // Open first PDF
    const viewer1 = await openRealLocalPdf();
    expect(viewer1).to.exist;

    // Wait for first PDF to load
    await waitForPdfLoad(3000);

    // Open second PDF (same file) - should reuse viewer
    const viewer2 = await openRealLocalPdf();
    expect(viewer2).to.exist;

    // Should have PDF viewer visible
    expect(await isPdfViewerVisible()).to.be.true;

    // Verify title shows the PDF
    const title = await getPdfViewerTitle();
    expect(title).to.include('normal.pdf');
  });

  it('should maintain PDF state after opening', async function () {
    this.timeout(10000);

    const viewer = await openRealLocalPdf();
    expect(viewer).to.exist;

    await waitForPdfLoad(3000);

    // PDF should remain accessible
    expect(await isPdfViewerVisible()).to.be.true;
    expect(viewer?.visible).to.be.true;
  });
});
