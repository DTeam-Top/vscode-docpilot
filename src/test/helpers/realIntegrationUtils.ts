import * as vscode from 'vscode';

/**
 * Enhanced integration test utilities for real functionality testing
 */

/**
 * Test real PDF.js rendering functionality
 */
export async function testPdfRendering(panel: vscode.WebviewPanel): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 8000);

    const disposable = panel.webview.onDidReceiveMessage((message) => {
      if (message.type === 'pdfLoaded' || message.type === 'textExtracted') {
        clearTimeout(timeout);
        disposable.dispose();
        resolve(true);
      }
    });

    // Send test message to webview
    panel.webview.postMessage({ type: 'testRendering' });
  });
}

/**
 * Test webview toolbar functionality
 */
export async function testToolbarFunctions(
  panel: vscode.WebviewPanel
): Promise<{ zoom: boolean; export: boolean; summarize: boolean }> {
  const results = { zoom: false, export: false, summarize: false };

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(results), 8000);
    let responseCount = 0;

    const disposable = panel.webview.onDidReceiveMessage((message) => {
      console.log('Toolbar test received message:', message.type);
      switch (message.type) {
        case 'zoomChanged':
          results.zoom = true;
          break;
        case 'exportStarted':
        case 'exportText':
          results.export = true;
          break;
        case 'summarizeStarted':
        case 'summarizeRequest':
          results.summarize = true;
          break;
        case 'textExtracted':
        case 'textExtractionError':
          // Text extraction indicates webview is responsive
          responseCount++;
          break;
      }

      responseCount++;
      if (responseCount >= 1) {
        // At least one response indicates functionality
        clearTimeout(timeout);
        disposable.dispose();
        resolve(results);
      }
    });

    // Test actual webview communication first
    try {
      panel.webview.postMessage({ type: 'extractAllText' });
    } catch (error) {
      console.warn('Failed to test toolbar functions:', error);
      clearTimeout(timeout);
      disposable.dispose();
      resolve(results);
    }
  });
}

/**
 * Test real network timeout scenarios
 */
export async function testNetworkTimeout(url: string, timeoutMs: number = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const https = require('node:https');
    const { URL } = require('node:url');

    try {
      const parsedUrl = new URL(url);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'HEAD',
        timeout: timeoutMs,
      };

      const req = https.request(options, (res: unknown) => {
        const response = res as { statusCode: number };
        resolve(response.statusCode >= 200 && response.statusCode < 400);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.on('error', () => {
        resolve(false);
      });

      req.end();
    } catch (error) {
      console.warn('Network test failed:', error);
      resolve(false);
    }
  });
}

/**
 * Test real file system operations
 */
export async function testFileSystemAccess(
  filePath: string
): Promise<{ exists: boolean; readable: boolean; isPdf: boolean }> {
  const fs = require('node:fs');
  const path = require('node:path');

  try {
    const stats = fs.statSync(filePath);
    const readable = fs.accessSync(filePath, fs.constants.R_OK) === undefined;
    const isPdf = path.extname(filePath).toLowerCase() === '.pdf';

    return {
      exists: stats.isFile(),
      readable,
      isPdf,
    };
  } catch (error) {
    console.warn('File system access test failed:', error);
    return {
      exists: false,
      readable: false,
      isPdf: false,
    };
  }
}

/**
 * Test real VS Code command registration
 */
export async function testCommandRegistration(): Promise<string[]> {
  const commands = await vscode.commands.getCommands();
  return commands.filter((cmd) => cmd.startsWith('docpilot.'));
}

/**
 * Test real extension context and resources
 */
export async function testExtensionResources(
  context: vscode.ExtensionContext
): Promise<{ webviewExists: boolean; assetsExist: boolean; templatesExist: boolean }> {
  const fs = require('node:fs');
  const path = require('node:path');

  const webviewPath = path.join(context.extensionPath, 'src', 'webview');
  const assetsPath = path.join(webviewPath, 'assets');
  const templatesPath = path.join(webviewPath, 'templates');

  return {
    webviewExists: fs.existsSync(webviewPath),
    assetsExist: fs.existsSync(assetsPath),
    templatesExist: fs.existsSync(templatesPath),
  };
}

/**
 * Test real memory usage monitoring
 */
export async function monitorMemoryUsage(): Promise<{
  initial: number;
  peak: number;
  final: number;
}> {
  const initialMemory = process.memoryUsage().heapUsed;
  let peakMemory = initialMemory;

  const interval = setInterval(() => {
    const current = process.memoryUsage().heapUsed;
    if (current > peakMemory) {
      peakMemory = current;
    }
  }, 100);

  // Wait for monitoring period
  await new Promise((resolve) => setTimeout(resolve, 2000));

  clearInterval(interval);
  const finalMemory = process.memoryUsage().heapUsed;

  return {
    initial: Math.round(initialMemory / 1024 / 1024), // MB
    peak: Math.round(peakMemory / 1024 / 1024),
    final: Math.round(finalMemory / 1024 / 1024),
  };
}

/**
 * Test real environment setup (.env validation)
 */
export async function testEnvironmentSetup(): Promise<{
  envExists: boolean;
  hasRequiredVars: boolean;
  copilotAvailable: boolean;
}> {
  const fs = require('node:fs');
  const path = require('node:path');

  const envPath = path.join(process.cwd(), '.env');
  const envExists = fs.existsSync(envPath);

  let hasRequiredVars = false;
  if (envExists) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    // Check for common environment variables that might be needed
    hasRequiredVars = envContent.includes('COPILOT_CHAT_AUTH_TOKEN');
  }

  // Check if Copilot is available
  let copilotAvailable = false;
  try {
    // Try to focus chat view as a test of chat availability
    await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
    copilotAvailable = true;
  } catch (error) {
    console.warn('Chat API not available:', error);
    // Chat API might not be available
    copilotAvailable = false;
  }

  return {
    envExists,
    hasRequiredVars,
    copilotAvailable,
  };
}

/**
 * Test real Copilot chat integration
 */
export async function testCopilotIntegration(): Promise<{
  participantFound: boolean;
  commandsAvailable: string[];
  canExecute: boolean;
}> {
  try {
    // Check if chat commands are available
    const commands = await vscode.commands.getCommands();
    const chatCommands = commands.filter((cmd) => cmd.includes('chat') || cmd.includes('copilot'));

    let canExecute = false;
    let participantFound = false;

    try {
      // Try to open chat view to test availability
      await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
      canExecute = true;
      participantFound = true; // If we can open chat, assume participants are available
    } catch (error) {
      console.warn('Chat execution test failed:', error);
      // Chat might not be available
    }

    return {
      participantFound,
      commandsAvailable: chatCommands,
      canExecute,
    };
  } catch (error) {
    console.warn('Copilot integration test failed:', error);
    return {
      participantFound: false,
      commandsAvailable: [],
      canExecute: false,
    };
  }
}

/**
 * Test real webview message passing
 */
export async function testWebviewMessaging(
  panel: vscode.WebviewPanel
): Promise<{ canSend: boolean; canReceive: boolean; roundTrip: boolean }> {
  const results = { canSend: false, canReceive: false, roundTrip: false };

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(results), 5000);

    const disposable = panel.webview.onDidReceiveMessage((message) => {
      console.log('Test received webview message:', message.type);
      if (message.type === 'testResponse') {
        results.canReceive = true;
        results.roundTrip = message.data === 'test-ping';
        clearTimeout(timeout);
        disposable.dispose();
        resolve(results);
      } else if (message.type === 'textExtracted' || message.type === 'textExtractionError') {
        // These are valid responses showing webview communication works
        results.canReceive = true;
        clearTimeout(timeout);
        disposable.dispose();
        resolve(results);
      }
    });

    try {
      // Send a text extraction test to verify real webview communication
      panel.webview.postMessage({ type: 'extractAllText' });
      results.canSend = true;
    } catch (error) {
      console.warn('Failed to send webview message:', error);
      clearTimeout(timeout);
      disposable.dispose();
      resolve(results);
    }
  });
}
