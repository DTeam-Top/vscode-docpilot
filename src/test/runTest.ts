import { runTests } from '@vscode/test-electron';
import * as path from 'node:path';
import { loadEnvFile } from './helpers/envLoader';

async function main() {
  try {
    // Load environment variables from .env file (needed for Copilot auth)
    loadEnvFile(path.resolve(__dirname, '../../.env'));

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
        TEST_REPORTER: 'enhanced-spec',
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
