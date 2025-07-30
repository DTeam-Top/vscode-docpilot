import { expect } from 'chai';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ObjectExtractor } from '../../../pdf/objectExtractor';
import { openRealLocalPdf, cleanupPdfViewers, TEST_PDF_PATH } from '../../helpers/pdfTestUtils';
import { WebviewProvider } from '../../../webview/webviewProvider';

describe('ObjectExtractor Integration Test', () => {
  let tempDir: string;
  let panel: vscode.WebviewPanel | undefined;

  beforeEach(async function() {
    this.timeout(10000);
    // Create a temporary directory for extracted files
    const testDir = path.join(__dirname, 'temp_extraction');
    await fs.mkdir(testDir, { recursive: true });
    tempDir = await fs.realpath(testDir);

    panel = await openRealLocalPdf();
    if (!panel) {
        this.skip(); // Skip test if PDF could not be opened
    }
    // Give webview time to load
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterEach(async () => {
    await cleanupPdfViewers();
    if (tempDir) {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            console.error(`Failed to clean up temp directory: ${tempDir}`, error);
        }
    }
  });

  it('should extract text from a PDF and verify its content', async function () {
    this.timeout(20000);

    expect(panel).to.exist;
    if (!panel) {
        this.skip();
    }

    const fileName = WebviewProvider.getFileName(TEST_PDF_PATH);

    const result = await ObjectExtractor.extractObjects(panel, {
      selectedTypes: ['text'],
      saveFolder: tempDir,
      fileName,
    });

    expect(result.success).to.be.true;
    expect(result.filesCreated.length).to.be.at.least(1);

    const txtFile = result.filesCreated.find(f => f.endsWith('.txt'));
    expect(txtFile).to.exist;

    const content = await fs.readFile(txtFile!, 'utf-8');
    const lowerCaseContent = content.toLowerCase();

    const expectedWords = ["google’s", "hybrid", "approach", "to", "research"];
    for (const word of expectedWords) {
      expect(lowerCaseContent).to.include(word, `Expected to find "${word}" in extracted text`);
    }
  });
});
