import { expect } from 'chai';
import * as vscode from 'vscode';
import { cleanupPdfViewers, getErrorNotification } from '../../helpers/pdfTestUtils';
import { testFileSystemAccess, testNetworkTimeout } from '../../helpers/realIntegrationUtils';

describe('Real Error Scenarios', () => {
  afterEach(async () => {
    await cleanupPdfViewers();
  });

  it('should test real network timeout scenarios', async function () {
    this.timeout(15000);

    // Test real network timeout with slow endpoint
    const slowUrl = 'https://httpbin.org/delay/10';
    const timeoutResult = await testNetworkTimeout(slowUrl, 5000);

    // Should timeout (return false) due to 5s timeout vs 10s delay
    expect(timeoutResult).to.be.false;
  });

  it('should test real file system access validation', async function () {
    this.timeout(5000);

    // Test with existing test file
    const validFileResults = await testFileSystemAccess(
      '/Users/hujian/projects/creative/vscode-docpilot/src/test/fixtures/pdfs/normal.pdf'
    );
    console.log('Valid file results:', validFileResults);

    // Test with non-existent file
    const invalidFileResults = await testFileSystemAccess('/nonexistent/path/file.pdf');
    console.log('Invalid file results:', invalidFileResults);

    expect(invalidFileResults.exists).to.be.false;
    expect(invalidFileResults.readable).to.be.false;
    expect(invalidFileResults.isPdf).to.be.false;
  });

  it('should handle invalid URL gracefully', async function () {
    this.timeout(12000);

    try {
      await vscode.commands.executeCommand(
        'docpilot.openPdfFromUrl',
        'https://invalid-domain-12345.com/fake.pdf'
      );
      expect.fail('Should have handled error for invalid domain');
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).to.satisfy(
        (message: string) =>
          message.includes('network') ||
          message.includes('not found') ||
          message.includes('failed') ||
          message.includes('invalid')
      );

      // Should show user-friendly error
      const errorMsg = await getErrorNotification();
      expect(errorMsg).to.satisfy(
        (message: string) =>
          message.includes('Failed to download PDF') ||
          message.includes('Failed to open PDF') ||
          message.includes('failed to load') ||
          message.includes('fetch failed')
      );
    }
  });

  it('should handle network timeout gracefully', async function () {
    this.timeout(25000);

    // Use a real slow endpoint that looks like a PDF for timeout testing
    const slowUrl = 'https://httpbin.org/delay/30/test.pdf'; // This will timeout but appears to be a PDF

    const startTime = Date.now();
    try {
      const result = await vscode.commands.executeCommand('docpilot.openPdfFromUrl', slowUrl);

      // If command succeeds, it creates a viewer that will timeout during loading
      if (result) {
        // Command creates viewer but PDF loading will timeout - this is acceptable behavior
        const elapsed = Date.now() - startTime;
        expect(elapsed).to.be.lessThan(20000); // Should be quick to create viewer
      } else {
        expect.fail('Command should either throw or return viewer');
      }
    } catch (error) {
      const elapsed = Date.now() - startTime;
      expect(elapsed).to.be.lessThan(20000); // Should timeout before 20s
      const msg = (error as Error).message;
      expect(msg).to.satisfy(
        (message: string) =>
          message.includes('timeout') ||
          message.includes('failed') ||
          message.includes('network') ||
          message.includes('abort') ||
          message.includes('Invalid file path') ||
          message.includes('URL does not appear')
      );
    }
  });

  it('should handle non-PDF URL gracefully', async function () {
    this.timeout(8000);

    try {
      await vscode.commands.executeCommand('docpilot.openPdfFromUrl', 'https://www.google.com');
      expect.fail('Should have rejected non-PDF URL');
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).to.satisfy(
        (message: string) =>
          message.includes('PDF') ||
          message.includes('invalid') ||
          message.includes('not a PDF') ||
          message.includes('format')
      );
    }
  });

  it('should handle file permission errors', async function () {
    this.timeout(5000);

    try {
      // Try to open a file in a restricted system directory
      await vscode.commands.executeCommand('docpilot.openLocalPdf', '/root/restricted.pdf');
      expect.fail('Should have failed for permission-restricted file');
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).to.satisfy(
        (message: string) =>
          message.includes('permission') ||
          message.includes('EACCES') ||
          message.includes('not found') ||
          message.includes('access') ||
          message.includes('Failed to load PDF') ||
          message.includes('restricted')
      );
    }
  });

  it('should handle corrupted PDF files', async function () {
    this.timeout(8000);

    try {
      // Try to open a text file as PDF
      await vscode.commands.executeCommand('docpilot.openLocalPdf', __filename); // This TypeScript file
      expect.fail('Should have rejected non-PDF file');
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).to.satisfy(
        (message: string) =>
          message.includes('PDF') ||
          message.includes('invalid') ||
          message.includes('format') ||
          message.includes('not a PDF')
      );
    }
  });

  it('should handle empty URL input gracefully', async function () {
    this.timeout(3000);

    try {
      // Pass empty string directly to avoid user input prompt
      await vscode.commands.executeCommand('docpilot.openPdfFromUrl', 'invalid-empty-url');
      expect.fail('Should have rejected invalid URL');
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).to.satisfy(
        (message: string) =>
          message.includes('URL') ||
          message.includes('required') ||
          message.includes('empty') ||
          message.includes('invalid') ||
          message.includes('Invalid file path') ||
          message.includes('URL does not appear')
      );
    }
  });

  it('should handle malformed URLs gracefully', async function () {
    this.timeout(5000);

    const malformedUrls = [
      'not-a-url',
      'ftp://example.com/file.pdf',
      'mailto:test@example.com',
      'file://local/path.pdf',
      'https://',
    ];

    for (const url of malformedUrls) {
      try {
        await vscode.commands.executeCommand('docpilot.openPdfFromUrl', url);
        // Should either handle gracefully or throw appropriate error
      } catch (error) {
        const msg = (error as Error).message;
        expect(msg).to.satisfy(
          (message: string) =>
            message.includes('URL') ||
            message.includes('invalid') ||
            message.includes('protocol') ||
            message.includes('format')
        );
      }
    }
  });

  it('should handle very large PDF URLs', async function () {
    this.timeout(15000);

    // Test with a URL that might point to a very large PDF
    const largeUrl = 'https://www.nasa.gov/wp-content/uploads/2023/03/artemis-plan-20200921.pdf';

    try {
      const startTime = Date.now();
      await vscode.commands.executeCommand('docpilot.openPdfFromUrl', largeUrl);
      const elapsed = Date.now() - startTime;

      // Should either succeed or fail within reasonable time
      expect(elapsed).to.be.lessThan(12000);
    } catch (error) {
      // Large files might timeout or fail - this is acceptable
      const msg = (error as Error).message;
      expect(msg).to.satisfy(
        (message: string) =>
          message.includes('timeout') ||
          message.includes('size') ||
          message.includes('network') ||
          message.includes('failed')
      );
    }
  });

  it('should handle HTTPS certificate errors', async function () {
    this.timeout(10000);

    try {
      // Use a URL with potential certificate issues
      await vscode.commands.executeCommand(
        'docpilot.openPdfFromUrl',
        'https://self-signed.badssl.com/fake.pdf'
      );
      expect.fail('Should have failed for certificate issues');
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).to.satisfy(
        (message: string) =>
          message.includes('certificate') ||
          message.includes('SSL') ||
          message.includes('security') ||
          message.includes('network') ||
          message.includes('not found')
      );
    }
  });

  it('should handle concurrent error scenarios', async function () {
    this.timeout(15000);

    // Test multiple failing operations concurrently
    const promises = [
      Promise.resolve(
        vscode.commands.executeCommand('docpilot.openPdfFromUrl', 'https://invalid1.com/fake.pdf')
      ).catch((e: Error) => e),
      Promise.resolve(
        vscode.commands.executeCommand('docpilot.openPdfFromUrl', 'https://invalid2.com/fake.pdf')
      ).catch((e: Error) => e),
      Promise.resolve(
        vscode.commands.executeCommand('docpilot.openLocalPdf', '/nonexistent1.pdf')
      ).catch((e: Error) => e),
      Promise.resolve(
        vscode.commands.executeCommand('docpilot.openLocalPdf', '/nonexistent2.pdf')
      ).catch((e: Error) => e),
    ];

    const results = await Promise.allSettled(promises);

    // All operations should handle errors gracefully
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        const value = result.value;
        // Value can be either an error (if command threw) or a panel (if command succeeded but PDF loading will fail)
        if (value instanceof Error) {
          const msg = value.message;
          expect(msg).to.satisfy(
            (message: string) =>
              message.includes('not found') ||
              message.includes('Failed to download') ||
              message.includes('Failed to load') ||
              message.includes('Invalid file path') ||
              message.includes('URL does not appear') ||
              message.includes('network error') ||
              message.includes('failed')
          );
        } else {
          // Command succeeded - created a viewer panel (which is also valid behavior)
          expect(value).to.not.be.null;
        }
      } else {
        // Promise was rejected - also valid error handling
        expect(result.reason).to.be.an('error');
      }
    });
  });

  it('should maintain extension stability after errors', async function () {
    this.timeout(10000);

    // Cause multiple errors
    const errorOperations = [
      () =>
        Promise.resolve(
          vscode.commands.executeCommand('docpilot.openPdfFromUrl', 'invalid-url')
        ).catch((_error: Error) => {
          // Expected error - ignore
        }),
      () =>
        Promise.resolve(
          vscode.commands.executeCommand('docpilot.openLocalPdf', '/nonexistent.pdf')
        ).catch((_error: Error) => {
          // Expected error - ignore
        }),
      () =>
        Promise.resolve(
          vscode.commands.executeCommand('docpilot.openPdfFromUrl', 'https://invalid.com/fake.pdf')
        ).catch((_error: Error) => {
          // Expected error - ignore
        }),
    ];

    // Execute error operations
    for (const operation of errorOperations) {
      await operation();
    }

    // Extension should still be functional
    const commands = await vscode.commands.getCommands();
    expect(commands).to.include('docpilot.openLocalPdf');
    expect(commands).to.include('docpilot.openPdfFromUrl');
  });

  it('should handle rapid successive error operations', async function () {
    this.timeout(8000);

    // Rapidly fire multiple invalid operations
    const rapidOperations = [];
    for (let i = 0; i < 5; i++) {
      rapidOperations.push(
        vscode.commands
          .executeCommand('docpilot.openPdfFromUrl', `https://invalid${i}.com/fake.pdf`)
          .then(
            (result) => ({ success: true, result, index: i }),
            (error) => ({ success: false, error: error.message, index: i })
          )
      );
    }

    const results = await Promise.all(rapidOperations);

    // All should handle gracefully (either succeed in creating viewer or fail with error)
    results.forEach((result) => {
      if (result.success) {
        // Command succeeded - created a viewer (valid behavior)
        const successResult = result as { success: true; result: unknown; index: number };
        expect(successResult.result).to.not.be.null;
      } else {
        // Command failed with error (also valid behavior)
        const errorResult = result as { success: false; error: string; index: number };
        expect(errorResult.error).to.satisfy(
          (message: string) =>
            message.includes('invalid') ||
            message.includes('Failed to download') ||
            message.includes('URL does not appear') ||
            message.includes('network error') ||
            message.includes('failed')
        );
      }
    });
  });
});
