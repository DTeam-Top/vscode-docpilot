import { expect } from 'chai';
import { afterEach, beforeEach, describe, it } from 'mocha';
import * as sinon from 'sinon';
import type * as vscode from 'vscode';
import { WEBVIEW_MESSAGES } from '../../../../utils/constants';
import { WebviewMessenger } from '../../../../webview/webviewMessenger';

describe('WebviewMessenger', () => {
  let mockPanel: sinon.SinonStubbedInstance<vscode.WebviewPanel>;
  let mockWebview: sinon.SinonStubbedInstance<vscode.Webview>;
  let messenger: WebviewMessenger;
  let messageListener: (message: any) => void;

  beforeEach(() => {
    // Create mock webview
    mockWebview = {
      postMessage: sinon.stub().resolves(),
      onDidReceiveMessage: sinon.stub(),
    } as any;

    // Create mock panel
    mockPanel = {
      webview: mockWebview,
    } as any;

    // Capture the message listener when it's registered
    mockWebview.onDidReceiveMessage.callsFake((listener) => {
      messageListener = listener;
      return { dispose: sinon.stub() };
    });

    messenger = new WebviewMessenger(mockPanel as any);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('constructor', () => {
    it('should initialize with panel and setup message handling', () => {
      expect(mockWebview.onDidReceiveMessage.calledOnce).to.be.true;
      expect(messenger.handlerCount).to.equal(0);
    });
  });

  describe('message handler registration', () => {
    it('should register a message handler', () => {
      const handler = sinon.stub();
      messenger.on('test-message', handler);

      expect(messenger.handlerCount).to.equal(1);
      expect(messenger.hasHandler('test-message')).to.be.true;
    });

    it('should call registered handler when message is received', async () => {
      const handler = sinon.stub();
      const testData = { value: 'test' };

      messenger.on('test-message', handler);

      // Simulate receiving a message
      await messageListener({ type: 'test-message', data: testData });

      expect(handler.calledOnce).to.be.true;
      expect(handler.calledWith(testData, mockPanel)).to.be.true;
    });

    it('should handle multiple handlers for different message types', async () => {
      const handler1 = sinon.stub();
      const handler2 = sinon.stub();

      messenger.on('message-1', handler1);
      messenger.on('message-2', handler2);

      await messageListener({ type: 'message-1', data: 'data1' });
      await messageListener({ type: 'message-2', data: 'data2' });

      expect(handler1.calledOnce).to.be.true;
      expect(handler1.calledWith('data1', mockPanel)).to.be.true;
      expect(handler2.calledOnce).to.be.true;
      expect(handler2.calledWith('data2', mockPanel)).to.be.true;
    });

    it('should not call handler for unregistered message type', async () => {
      const handler = sinon.stub();
      messenger.on('registered-message', handler);

      await messageListener({ type: 'unregistered-message', data: 'data' });

      expect(handler.called).to.be.false;
    });
  });

  describe('message sending', () => {
    it('should send message to webview', async () => {
      const message = { type: 'test', data: { value: 123 } };

      await messenger.send(message);

      expect(mockWebview.postMessage.calledOnce).to.be.true;
      expect(mockWebview.postMessage.calledWith(message)).to.be.true;
    });

    it('should send response message with data', async () => {
      const responseData = { result: 'success' };

      await messenger.sendResponse('test-response', responseData);

      expect(mockWebview.postMessage.calledOnce).to.be.true;
      const sentMessage = mockWebview.postMessage.firstCall.args[0];
      expect(sentMessage.type).to.equal('test-response');
      expect(sentMessage.data).to.deep.equal(responseData);
    });

    it('should send error response', async () => {
      const errorMessage = 'Test error';

      await messenger.sendError('test-error', errorMessage);

      expect(mockWebview.postMessage.calledOnce).to.be.true;
      const sentMessage = mockWebview.postMessage.firstCall.args[0];
      expect(sentMessage.type).to.equal('test-error');
      expect(sentMessage.error).to.equal(errorMessage);
    });

    it('should send success response', async () => {
      const successData = { status: 'completed' };

      await messenger.sendSuccess('test-success', successData);

      expect(mockWebview.postMessage.calledOnce).to.be.true;
      const sentMessage = mockWebview.postMessage.firstCall.args[0];
      expect(sentMessage.type).to.equal('test-success');
      expect(sentMessage.data).to.deep.equal(successData);
    });
  });

  describe('handler management', () => {
    it('should remove handler when off is called', () => {
      const handler = sinon.stub();
      messenger.on('test-message', handler);

      expect(messenger.hasHandler('test-message')).to.be.true;

      messenger.off('test-message');

      expect(messenger.hasHandler('test-message')).to.be.false;
      expect(messenger.handlerCount).to.equal(0);
    });

    it('should clear all handlers when clear is called', () => {
      messenger.on('message-1', sinon.stub());
      messenger.on('message-2', sinon.stub());

      expect(messenger.handlerCount).to.equal(2);

      messenger.clear();

      expect(messenger.handlerCount).to.equal(0);
    });
  });

  describe('error handling', () => {
    it('should handle errors in message handlers gracefully', async () => {
      const handler = sinon.stub().throws(new Error('Handler error'));
      messenger.on(WEBVIEW_MESSAGES.SUMMARIZE_REQUEST, handler);

      // Should not throw
      await messageListener({ type: WEBVIEW_MESSAGES.SUMMARIZE_REQUEST });

      expect(handler.calledOnce).to.be.true;
    });

    it('should send error response for request messages when handler fails', async () => {
      const handler = sinon.stub().throws(new Error('Handler failed'));
      messenger.on(WEBVIEW_MESSAGES.SUMMARIZE_REQUEST, handler);

      await messageListener({ type: WEBVIEW_MESSAGES.SUMMARIZE_REQUEST });

      // Should send error response
      expect(mockWebview.postMessage.calledOnce).to.be.true;
      const sentMessage = mockWebview.postMessage.firstCall.args[0];
      expect(sentMessage.type).to.equal(WEBVIEW_MESSAGES.SUMMARIZE_ERROR);
      expect(sentMessage.error).to.include('Handler failed');
    });

    it('should handle Error objects in sendError', async () => {
      const error = new Error('Test error object');

      await messenger.sendError('test-error', error);

      const sentMessage = mockWebview.postMessage.firstCall.args[0];
      expect(sentMessage.error).to.equal('Test error object');
    });
  });

  describe('request/response mapping', () => {
    it('should identify request messages correctly', () => {
      // Test with known request types
      const requestTypes = [
        WEBVIEW_MESSAGES.SUMMARIZE_REQUEST,
        WEBVIEW_MESSAGES.MINDMAP_REQUEST,
        WEBVIEW_MESSAGES.EXTRACT_OBJECTS,
        WEBVIEW_MESSAGES.BROWSE_SAVE_FOLDER,
        WEBVIEW_MESSAGES.GET_OBJECT_COUNTS,
        WEBVIEW_MESSAGES.SCREENSHOT_SAVE_FILE,
      ];

      // These should all be identified as request messages
      requestTypes.forEach((type) => {
        expect((messenger as any).isRequestMessage(type)).to.be.true;
      });

      // Non-request message should return false
      expect((messenger as any).isRequestMessage('random-message')).to.be.false;
    });

    it('should map request types to error response types correctly', () => {
      const mappings = [
        { request: WEBVIEW_MESSAGES.SUMMARIZE_REQUEST, error: WEBVIEW_MESSAGES.SUMMARIZE_ERROR },
        { request: WEBVIEW_MESSAGES.MINDMAP_REQUEST, error: WEBVIEW_MESSAGES.MINDMAP_ERROR },
        { request: WEBVIEW_MESSAGES.EXTRACT_OBJECTS, error: WEBVIEW_MESSAGES.EXTRACTION_ERROR },
        {
          request: WEBVIEW_MESSAGES.SCREENSHOT_SAVE_FILE,
          error: WEBVIEW_MESSAGES.SCREENSHOT_SAVE_ERROR,
        },
      ];

      mappings.forEach(({ request, error }) => {
        expect((messenger as any).getErrorResponseType(request)).to.equal(error);
      });

      // Unknown request should return null
      expect((messenger as any).getErrorResponseType('unknown-request')).to.be.null;
    });
  });
});
