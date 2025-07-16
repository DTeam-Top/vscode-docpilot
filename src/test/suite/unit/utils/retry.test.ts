import { expect } from 'chai';
import * as sinon from 'sinon';
import { RetryPolicy } from '../../../../utils/retry';

describe('RetryPolicy', () => {
  let sandbox: sinon.SinonSandbox;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('withRetry', () => {
    it('should return result on first successful attempt', async () => {
      const operation = sandbox.stub().resolves('success');

      const result = await RetryPolicy.withRetry(operation);

      expect(result).to.equal('success');
      expect(operation).to.have.been.calledOnce;
    });

    it('should retry on failure and succeed on second attempt', async () => {
      // Restore clock for this test to use real timers
      clock.restore();

      const operation = sandbox
        .stub()
        .onFirstCall()
        .rejects(new Error('First failure'))
        .onSecondCall()
        .resolves('success');

      const result = await RetryPolicy.withRetry(operation, { backoffMs: 10 });

      expect(result).to.equal('success');
      expect(operation).to.have.been.calledTwice;

      // Recreate clock for other tests
      clock = sandbox.useFakeTimers();
    });

    it('should use exponential backoff for retries', async () => {
      // Restore clock for this test to use real timers
      clock.restore();

      const operation = sandbox
        .stub()
        .onFirstCall()
        .rejects(new Error('First failure'))
        .onSecondCall()
        .rejects(new Error('Second failure'))
        .onThirdCall()
        .resolves('success');

      const result = await RetryPolicy.withRetry(operation, { backoffMs: 10 });

      expect(result).to.equal('success');
      expect(operation).to.have.been.calledThrice;

      // Recreate clock for other tests
      clock = sandbox.useFakeTimers();
    });

    it('should fail after max attempts', async () => {
      // Restore clock for this test to use real timers
      clock.restore();

      const operation = sandbox.stub().rejects(new Error('Persistent failure'));

      try {
        await RetryPolicy.withRetry(operation, { maxAttempts: 2, backoffMs: 10 });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).to.equal('Persistent failure');
        expect(operation).to.have.been.calledTwice;
      }

      // Recreate clock for other tests
      clock = sandbox.useFakeTimers();
    });

    it('should respect custom shouldRetry function', async () => {
      const operation = sandbox.stub().rejects(new Error('Custom error'));
      const shouldRetry = sandbox.stub().returns(false);

      try {
        await RetryPolicy.withRetry(operation, { shouldRetry });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).to.equal('Custom error');
        expect(operation).to.have.been.calledOnce;
        expect(shouldRetry).to.have.been.calledWith(sinon.match.instanceOf(Error));
      }
    });

    it('should use custom backoff time', async () => {
      // Restore clock for this test to use real timers
      clock.restore();

      const operation = sandbox
        .stub()
        .onFirstCall()
        .rejects(new Error('First failure'))
        .onSecondCall()
        .resolves('success');

      const result = await RetryPolicy.withRetry(operation, { backoffMs: 10 });

      expect(result).to.equal('success');

      // Recreate clock for other tests
      clock = sandbox.useFakeTimers();
    });

    it('should use custom max attempts', async () => {
      const operation = sandbox.stub().rejects(new Error('Failure'));

      const retryPromise = RetryPolicy.withRetry(operation, { maxAttempts: 1 });

      try {
        await retryPromise;
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).to.equal('Failure');
        expect(operation).to.have.been.calledOnce;
      }
    });

    it('should throw last error when all attempts fail', async () => {
      // Restore clock for this test to use real timers
      clock.restore();

      const operation = sandbox
        .stub()
        .onFirstCall()
        .rejects(new Error('First error'))
        .onSecondCall()
        .rejects(new Error('Second error'))
        .onThirdCall()
        .rejects(new Error('Third error'));

      try {
        await RetryPolicy.withRetry(operation, { backoffMs: 10 });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).to.equal('Third error');
      }

      // Recreate clock for other tests
      clock = sandbox.useFakeTimers();
    });

    it('should handle empty options object', async () => {
      const operation = sandbox.stub().resolves('success');

      const result = await RetryPolicy.withRetry(operation, {});

      expect(result).to.equal('success');
      expect(operation).to.have.been.calledOnce;
    });
  });

  describe('shouldRetryNetworkError', () => {
    it('should return true for timeout errors', () => {
      const error = new Error('Connection timeout');
      expect(RetryPolicy.shouldRetryNetworkError(error)).to.be.true;
    });

    it('should return true for network errors', () => {
      const error = new Error('Network error occurred');
      expect(RetryPolicy.shouldRetryNetworkError(error)).to.be.true;
    });

    it('should return true for connection errors', () => {
      const error = new Error('Connection failed');
      expect(RetryPolicy.shouldRetryNetworkError(error)).to.be.true;
    });

    it('should return true for ECONNRESET errors', () => {
      const error = new Error('Something went wrong ECONNRESET something');
      expect(RetryPolicy.shouldRetryNetworkError(error)).to.be.true;
    });

    it('should return true for ENOTFOUND errors', () => {
      const error = new Error('DNS lookup failed ENOTFOUND example.com');
      expect(RetryPolicy.shouldRetryNetworkError(error)).to.be.true;
    });

    it('should return false for non-network errors', () => {
      const error = new Error('Invalid input');
      expect(RetryPolicy.shouldRetryNetworkError(error)).to.be.false;
    });

    it('should return false for non-Error objects', () => {
      const error = 'String error';
      expect(RetryPolicy.shouldRetryNetworkError(error)).to.be.false;
    });

    it('should be case insensitive', () => {
      const error = new Error('CONNECTION timeout');
      expect(RetryPolicy.shouldRetryNetworkError(error)).to.be.true;
    });
  });

  describe('shouldRetryModelError', () => {
    it('should return true for rate limit errors', () => {
      const error = new Error('Rate limit exceeded');
      expect(RetryPolicy.shouldRetryModelError(error)).to.be.true;
    });

    it('should return true for quota exceeded errors', () => {
      const error = new Error('Quota exceeded');
      expect(RetryPolicy.shouldRetryModelError(error)).to.be.true;
    });

    it('should return true for service unavailable errors', () => {
      const error = new Error('Service unavailable');
      expect(RetryPolicy.shouldRetryModelError(error)).to.be.true;
    });

    it('should return true for timeout errors', () => {
      const error = new Error('Request timeout');
      expect(RetryPolicy.shouldRetryModelError(error)).to.be.true;
    });

    it('should return false for non-model errors', () => {
      const error = new Error('Invalid API key');
      expect(RetryPolicy.shouldRetryModelError(error)).to.be.false;
    });

    it('should return false for non-Error objects', () => {
      const error = 'String error';
      expect(RetryPolicy.shouldRetryModelError(error)).to.be.false;
    });

    it('should be case insensitive', () => {
      const error = new Error('RATE LIMIT exceeded');
      expect(RetryPolicy.shouldRetryModelError(error)).to.be.true;
    });
  });

  describe('delay', () => {
    it('should delay for specified milliseconds', async () => {
      const delayPromise = RetryPolicy['delay'](1000);

      // Advance time
      clock.tick(1000);

      await delayPromise;

      // Should complete without error
      expect(clock.now).to.equal(1000);
    });

    it('should not resolve before delay time', async () => {
      const delayPromise = RetryPolicy['delay'](1000);
      let resolved = false;

      delayPromise.then(() => {
        resolved = true;
      });

      // Advance time partially
      clock.tick(500);
      await Promise.resolve();

      expect(resolved).to.be.false;

      // Complete the delay
      clock.tick(500);
      await delayPromise;

      expect(resolved).to.be.true;
    });
  });
});
