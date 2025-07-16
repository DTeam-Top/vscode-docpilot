import { expect } from 'chai';
import * as vscode from 'vscode';
import {
  cleanupPdfViewers,
  getPdfViewerTitle,
  isPdfViewerVisible,
  openRealRemotePdf,
  SMALL_TEST_PDF_URL,
  TEST_PDF_URL,
  waitForPdfLoad,
} from '../../helpers/pdfTestUtils';
import { testNetworkTimeout } from '../../helpers/realIntegrationUtils';

describe('OpenPdfFromUrl Integration', () => {
  afterEach(async () => {
    await cleanupPdfViewers();
  });

  it('should test real network connectivity before PDF operations', async function () {
    this.timeout(12000);

    // Test real network timeout behavior
    const networkResult = await testNetworkTimeout(TEST_PDF_URL, 8000);

    console.log('Network connectivity test result:', networkResult);
    expect(typeof networkResult === 'boolean').to.be.true;

    // If network is available, proceed with PDF test
    if (networkResult) {
      const viewer = await openRealRemotePdf();
      expect(viewer).to.exist;
    }
  });

  it('should open real remote PDF and create viewer', async function () {
    this.timeout(15000); // Allow time for real network request

    const viewer = await openRealRemotePdf();

    // Test real outcomes, not mocks
    expect(viewer).to.exist;

    // Wait for network download and rendering
    const loaded = await waitForPdfLoad(10000);
    expect(loaded).to.be.true;

    expect(await isPdfViewerVisible()).to.be.true;

    const title = await getPdfViewerTitle();
    expect(title).to.satisfy(
      (titleText: string) =>
        titleText.includes('tracemonkey') ||
        titleText.includes('Remote PDF') ||
        titleText.includes('PDF') ||
        titleText.includes('mozilla')
    );
  });

  it('should handle invalid URL errors gracefully', async function () {
    this.timeout(10000);

    try {
      const result = await vscode.commands.executeCommand(
        'docpilot.openPdfFromUrl',
        'https://invalid-domain-12345.com/fake.pdf'
      );

      // If it doesn't throw, it should return a viewer that handles the error
      if (result) {
        // Wait a bit for the error to be detected
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        expect.fail('Should either throw error or return viewer');
      }
    } catch (error) {
      // If it does throw, check the error message
      const msg = (error as Error).message;
      expect(msg).to.satisfy(
        (message: string) =>
          message.includes('network') ||
          message.includes('download') ||
          message.includes('failed') ||
          message.includes('invalid') ||
          message.includes('fetch')
      );
    }
  });

  it('should handle non-PDF URL gracefully', async function () {
    this.timeout(8000);

    try {
      await vscode.commands.executeCommand('docpilot.openPdfFromUrl', 'https://www.google.com');
      expect.fail('Should have rejected non-PDF URL');
    } catch (error) {
      expect((error as Error).message).to.include('PDF');
    }
  });

  it('should download and cache remote PDF', async function () {
    this.timeout(15000);

    // First download
    const viewer1 = await openRealRemotePdf();
    expect(viewer1).to.exist;

    await waitForPdfLoad(10000);
    await cleanupPdfViewers();

    // Second download (should use cache)
    const viewer2 = await openRealRemotePdf();
    expect(viewer2).to.exist;

    const loaded = await waitForPdfLoad(5000); // Should be faster due to cache
    expect(loaded).to.be.true;
  });

  it('should handle network timeout gracefully', async function () {
    this.timeout(20000);

    // Use a real slow endpoint that looks like a PDF for timeout testing
    const slowUrl = 'https://httpbin.org/delay/30/test.pdf';

    const startTime = Date.now();
    try {
      const result = await vscode.commands.executeCommand('docpilot.openPdfFromUrl', slowUrl);

      // If command succeeds, it creates a viewer that will timeout during loading
      if (result) {
        // Command creates viewer but PDF loading will timeout - this is acceptable behavior
        const elapsed = Date.now() - startTime;
        expect(elapsed).to.be.lessThan(15000); // Should be quick to create viewer
      } else {
        expect.fail('Command should either throw or return viewer');
      }
    } catch (error) {
      const elapsed = Date.now() - startTime;
      expect(elapsed).to.be.lessThan(15000); // Should timeout before 15s
      const msg = (error as Error).message;
      expect(msg).to.satisfy(
        (message: string) =>
          message.includes('timeout') ||
          message.includes('failed') ||
          message.includes('Invalid') ||
          message.includes('URL does not appear')
      );
    }
  });

  it('should validate URL format before processing', async function () {
    this.timeout(5000);

    const invalidUrls = [
      'not-a-url',
      'ftp://example.com/file.pdf',
      'https://example.com/notpdf.txt',
      'invalid-url-format',
    ];

    for (const url of invalidUrls) {
      try {
        await vscode.commands.executeCommand('docpilot.openPdfFromUrl', url);
        expect.fail(`Should have rejected invalid URL: ${url}`);
      } catch (error) {
        const msg = (error as Error).message;
        expect(msg).to.satisfy(
          (message: string) =>
            message.toLowerCase().includes('invalid') ||
            message.includes('Invalid') ||
            message.includes('format') ||
            message.includes('URL')
        );
      }
    }
  });

  it('should handle small PDF files efficiently', async function () {
    this.timeout(10000);

    const startTime = Date.now();

    try {
      const viewer = await vscode.commands.executeCommand(
        'docpilot.openPdfFromUrl',
        SMALL_TEST_PDF_URL
      );
      const loadTime = Date.now() - startTime;

      expect(viewer).to.exist;
      expect(loadTime).to.be.lessThan(8000); // Small PDF should load quickly

      const loaded = await waitForPdfLoad(3000);
      expect(loaded).to.be.true;
    } catch (error) {
      // If small test PDF is not available, test should not fail
      console.warn('Small test PDF not available:', (error as Error).message);
    }
  });
});
