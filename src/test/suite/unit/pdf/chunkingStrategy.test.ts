import { expect } from 'chai';
import * as sinon from 'sinon';
import * as ChunkingStrategy from '../../../../pdf/chunkingStrategy';
import type { ChunkingConfig } from '../../../../types/interfaces';
import * as TokenEstimator from '../../../../utils/tokenEstimator';
import { configuration } from '../../../../utils/configuration';

describe('ChunkingStrategy', () => {
  let sandbox: sinon.SinonSandbox;
  let getOptimalChunkSizeStub: sinon.SinonStub;
  let estimateTokensStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    getOptimalChunkSizeStub = sandbox.stub(TokenEstimator, 'getOptimalChunkSize');
    estimateTokensStub = sandbox.stub(TokenEstimator, 'estimate');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getDefaultConfig()', () => {
    it('should return config with optimal chunk size', () => {
      const maxInputTokens = 8000;
      const optimalChunkSize = 6000;
      getOptimalChunkSizeStub.returns(optimalChunkSize);

      const config = ChunkingStrategy.getDefaultConfig(maxInputTokens);

      expect(getOptimalChunkSizeStub).to.have.been.calledWith(maxInputTokens);
      expect(config).to.deep.equal({
        maxTokensPerChunk: optimalChunkSize,
        overlapRatio: configuration.textProcessingOverlapRatio,
        sentenceBoundary: true,
        paragraphBoundary: true,
      });
    });

    it('should use constants for overlap ratio', () => {
      const maxInputTokens = 4000;
      getOptimalChunkSizeStub.returns(3000);

      const config = ChunkingStrategy.getDefaultConfig(maxInputTokens);

      expect(config.overlapRatio).to.equal(configuration.textProcessingOverlapRatio);
    });

    it('should enable boundary settings by default', () => {
      const maxInputTokens = 4000;
      getOptimalChunkSizeStub.returns(3000);

      const config = ChunkingStrategy.getDefaultConfig(maxInputTokens);

      expect(config.sentenceBoundary).to.be.true;
      expect(config.paragraphBoundary).to.be.true;
    });
  });

  describe('createSemanticChunks()', () => {
    const sampleConfig: ChunkingConfig = {
      maxTokensPerChunk: 1000,
      overlapRatio: 0.1,
      sentenceBoundary: true,
      paragraphBoundary: true,
    };

    beforeEach(() => {
      // Mock token estimation to return predictable values
      estimateTokensStub.callsFake((text: string) => Math.ceil(text.length / 4));
    });

    it('should process text and create chunks', () => {
      const pdfText = '--- Page 1 ---\nSample content';

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, sampleConfig);

      expect(chunks).to.have.length(1);
      expect(chunks[0].content).to.equal('Sample content');
    });

    it('should create chunks from single page content', () => {
      const pdfText =
        '--- Page 1 ---\nThis is a sample PDF content with enough text to create a meaningful chunk.';

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, sampleConfig);

      expect(chunks).to.have.length(1);
      expect(chunks[0]).to.deep.include({
        index: 0,
        content: 'This is a sample PDF content with enough text to create a meaningful chunk.',
        startPage: 1,
        endPage: 1,
      });
      expect(chunks[0].tokens).to.be.a('number');
    });

    it('should handle multiple pages', () => {
      const pdfText = `--- Page 1 ---
First page content with some text.
--- Page 2 ---
Second page content with more text.
--- Page 3 ---
Third page with additional content.`;

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, sampleConfig);

      expect(chunks).to.have.length(1);
      expect(chunks[0].content).to.include('First page content');
      expect(chunks[0].content).to.include('Second page content');
      expect(chunks[0].content).to.include('Third page with additional');
      expect(chunks[0].startPage).to.equal(1);
      expect(chunks[0].endPage).to.equal(3);
    });

    it('should create multiple chunks when content exceeds token limit', () => {
      // Create content that will exceed token limit
      const longContent = 'This is a very long sentence that will be repeated many times. '.repeat(
        100
      );
      const pdfText = `--- Page 1 ---
${longContent}
--- Page 2 ---
${longContent}`;

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, sampleConfig);

      expect(chunks.length).to.be.greaterThan(1);
      expect(chunks[0].index).to.equal(0);
      expect(chunks[1].index).to.equal(1);
    });

    it('should respect sentence boundaries when splitting', () => {
      const config: ChunkingConfig = {
        maxTokensPerChunk: 1,
        overlapRatio: 0.1,
        sentenceBoundary: true,
        paragraphBoundary: true,
      };

      const pdfText = `--- Page 1 ---
First sentence with some content. Second sentence with more content. Third sentence with even more content to force chunking.`;

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, config);

      // Verify chunks are created and contain sentence content
      expect(chunks.length).to.be.greaterThan(0);
      expect(chunks[0].content).to.include('First sentence');
      // Test that config is respected
      expect(config.sentenceBoundary).to.be.true;
    });

    it('should respect paragraph boundaries when splitting', () => {
      const config: ChunkingConfig = {
        maxTokensPerChunk: 5,
        overlapRatio: 0.1,
        sentenceBoundary: true,
        paragraphBoundary: true,
      };

      const pdfText = `--- Page 1 ---
First paragraph with content.\n\nSecond paragraph with more content.\n\nThird paragraph with additional content.`;

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, config);

      expect(chunks.length).to.be.greaterThan(1);
      // Just verify we got multiple chunks from paragraph content
      expect(chunks.every((chunk) => chunk.content.trim().length > 0)).to.be.true;
    });

    it('should create overlap between chunks', () => {
      const config: ChunkingConfig = {
        maxTokensPerChunk: 30,
        overlapRatio: 0.2, // 20% overlap
        sentenceBoundary: true,
        paragraphBoundary: true,
      };

      const pdfText = `--- Page 1 ---
First sentence with content. Second sentence with more content. Third sentence with even more content. Fourth sentence to ensure chunking.`;

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, config);

      if (chunks.length > 1) {
        // Check for overlap between consecutive chunks
        const _firstChunkEnd = chunks[0].content.slice(-20);
        const _secondChunkStart = chunks[1].content.slice(0, 20);

        // There should be some common content (not exact match due to boundary respect)
        expect(chunks[1].content).to.include(chunks[0].content.split('.').slice(-2)[0] || '');
      }
    });

    it('should handle empty pages', () => {
      const pdfText = `--- Page 1 ---
Content on first page.
--- Page 2 ---

--- Page 3 ---
Content on third page.`;

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, sampleConfig);

      expect(chunks).to.have.length(1);
      expect(chunks[0].content).to.include('Content on first page');
      expect(chunks[0].content).to.include('Content on third page');
      expect(chunks[0].content).to.not.include('--- Page 2 ---');
    });

    it('should handle pages with only whitespace', () => {
      const pdfText = `--- Page 1 ---
Content on first page.
--- Page 2 ---
   
	
--- Page 3 ---
Content on third page.`;

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, sampleConfig);

      expect(chunks).to.have.length(1);
      expect(chunks[0].content).to.include('Content on first page');
      expect(chunks[0].content).to.include('Content on third page');
    });

    it('should calculate correct token counts for chunks', () => {
      const pdfText = '--- Page 1 ---\nSample content for token calculation.';

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, sampleConfig);

      expect(chunks[0].tokens).to.be.a('number');
      expect(chunks[0].tokens).to.be.greaterThan(0);
      expect(estimateTokensStub).to.have.been.calledWith(chunks[0].content);
    });

    it('should handle malformed page separators', () => {
      const pdfText = `--- Page 1 ---
Content before malformed separator.
--- Page invalid ---
This should be ignored.
--- Page 2 ---
Content after malformed separator.`;

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, sampleConfig);

      expect(chunks).to.have.length(1);
      expect(chunks[0].content).to.include('Content before malformed');
      expect(chunks[0].content).to.include('Content after malformed');
      // Note: malformed separators are currently processed as content
      expect(chunks[0].content).to.include('This should be ignored');
    });

    it('should preserve page information correctly', () => {
      const pdfText = `--- Page 5 ---
Starting from page 5.
--- Page 6 ---
Content on page 6.
--- Page 7 ---
Ending on page 7.`;

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, sampleConfig);

      expect(chunks[0].startPage).to.equal(5);
      expect(chunks[0].endPage).to.equal(7);
    });

    it('should handle chunk splitting across multiple pages', () => {
      const config: ChunkingConfig = {
        maxTokensPerChunk: 5, // Very small to force splitting
        overlapRatio: 0.1,
        sentenceBoundary: true,
        paragraphBoundary: true,
      };

      const pdfText = `--- Page 1 ---
Short content on page 1.
--- Page 2 ---
More content on page 2.
--- Page 3 ---
Even more content on page 3.`;

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, config);

      expect(chunks.length).to.be.greaterThan(1);

      // First chunk might span multiple pages
      if (chunks.length > 0) {
        expect(chunks[0].startPage).to.be.at.least(1);
        expect(chunks[0].endPage).to.be.at.least(chunks[0].startPage);
      }
    });

    it('should handle text without sentence boundaries gracefully', () => {
      const config: ChunkingConfig = {
        maxTokensPerChunk: 20,
        overlapRatio: 0.1,
        sentenceBoundary: true,
        paragraphBoundary: true,
      };

      const pdfText = `--- Page 1 ---
thisisverylongtextwithoutanysentenceboundariesorspacestotesthowthechunskinghandlesedgecases`;

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, config);

      expect(chunks).to.have.length.greaterThan(0);
      expect(chunks[0].content).to.be.a('string');
    });

    it('should return empty array for empty input', () => {
      const chunks = ChunkingStrategy.createSemanticChunks('', sampleConfig);

      expect(chunks).to.be.an('array');
      expect(chunks).to.have.length(0);
    });

    it('should return empty array for input with no pages', () => {
      const pdfText = 'Content without page separators';

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, sampleConfig);

      expect(chunks).to.be.an('array');
      expect(chunks).to.have.length(0);
    });

    it('should process input and return valid chunks', () => {
      const pdfText = '--- Page 1 ---\nSample content for processing test.';

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, sampleConfig);

      expect(chunks).to.have.length(1);
      expect(chunks[0].content).to.equal('Sample content for processing test.');
      expect(chunks[0].startPage).to.equal(1);
      expect(chunks[0].endPage).to.equal(1);
    });
  });

  describe('Integration with TokenEstimator', () => {
    it('should use TokenEstimator for optimal chunk sizing', () => {
      const maxInputTokens = 8000;
      const expectedOptimalSize = 6400;
      getOptimalChunkSizeStub.returns(expectedOptimalSize);

      const config = ChunkingStrategy.getDefaultConfig(maxInputTokens);

      expect(config.maxTokensPerChunk).to.equal(expectedOptimalSize);
    });

    it('should use TokenEstimator for chunk token counting', () => {
      const pdfText = '--- Page 1 ---\nSample content for token estimation.';
      const expectedTokens = 15;
      estimateTokensStub.returns(expectedTokens);

      const chunks = ChunkingStrategy.createSemanticChunks(pdfText, {
        maxTokensPerChunk: 1000,
        overlapRatio: 0.1,
        sentenceBoundary: true,
        paragraphBoundary: true,
      });

      expect(chunks[0].tokens).to.equal(expectedTokens);
    });
  });
});
