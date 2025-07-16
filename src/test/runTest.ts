import { runTests } from '@vscode/test-electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Load environment variables from .env file
function loadEnvFile() {
  const envPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const lines = envContent.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=');
          process.env[key] = value;
        }
      }
    }
  }
}

async function main() {
  try {
    // Load environment variables from .env file (needed for Copilot auth)
    loadEnvFile();

    // The folder containing the Extension Manifest package.json
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // The path to test runner
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Get test suite from command line args
    const args = process.argv.slice(2);
    const suiteIndex = args.findIndex((arg) => arg === '--suite');
    const suite = suiteIndex >= 0 ? args[suiteIndex + 1] : 'all';

    console.log(`Running ${suite} test suite...`);

    // Test configuration with fresh VS Code instance
    const testConfig = {
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-workspace-trust', '--skip-welcome', '--disable-telemetry'],
      extensionTestsEnv: {
        TEST_SUITE: suite,
        TEST_REPORTER: 'spec',
        NODE_ENV: 'test',
        // Pass the auth token to the extension test environment for Copilot integration
        ...(process.env.COPILOT_CHAT_AUTH_TOKEN && {
          COPILOT_CHAT_AUTH_TOKEN: process.env.COPILOT_CHAT_AUTH_TOKEN,
        }),
      },
      // Use downloadable VS Code version for clean environment
      version: 'stable' as const,
    };

    // Run the tests
    await runTests(testConfig);
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();
