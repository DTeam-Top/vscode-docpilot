import { use } from 'chai';
import * as Mocha from 'mocha';
import * as fs from 'node:fs';
import * as path from 'node:path';

const sinonChai = require('sinon-chai');

// Set test environment for language model mocking
process.env.NODE_ENV = 'test';

// Configure chai with sinon-chai
use(sinonChai);

function findTestFiles(dir: string, files: string[] = []): string[] {
  const entries = fs.readdirSync(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      findTestFiles(fullPath, files);
    } else if (entry.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

export function run(): Promise<void> {
  const testSuite = process.env.TEST_SUITE || 'all';
  const testReporter = process.env.TEST_REPORTER || 'enhanced-spec';

  console.log(`Setting up ${testSuite} tests with ${testReporter} reporter...`);
  console.log(
    `Environment variables: TEST_SUITE=${process.env.TEST_SUITE}, TEST_REPORTER=${process.env.TEST_REPORTER}`
  );

  // Configure reporter options with test-reports directory
  const reporterOptions: Record<string, string> = {};
  let outputFile: string | undefined;

  const reportsDir = path.resolve(__dirname, '../../..', 'test-reports');

  // Ensure test-reports directory exists
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
    console.log(`Created test-reports directory: ${reportsDir}`);
  }

  let actualReporter = testReporter;

  switch (testReporter) {
    case 'enhanced-spec':
      actualReporter = path.resolve(__dirname, '../reporters/enhanced-spec.js');
      console.log(`Using enhanced spec reporter with summary`);
      break;
    case 'spec':
      actualReporter = 'spec';
      console.log(`Using basic spec reporter`);
      break;
    case 'junit':
      outputFile = path.resolve(reportsDir, `${testSuite}-results.xml`);
      reporterOptions.mochaFile = outputFile;
      actualReporter = 'mocha-junit-reporter';
      console.log(`JUnit reporter will write to: ${outputFile}`);
      break;
    case 'json':
      outputFile = path.resolve(reportsDir, `${testSuite}-results.json`);
      actualReporter = 'json';
      console.log(`JSON reporter will write to: ${outputFile}`);
      break;
    case 'html':
    case 'mochawesome':
      outputFile = path.resolve(reportsDir, `${testSuite}-report`);
      reporterOptions.reportDir = outputFile;
      reporterOptions.reportFilename = 'index';
      reporterOptions.reportTitle = `DocPilot ${testSuite} Test Results`;
      reporterOptions.reportPageTitle = `DocPilot ${testSuite} Tests`;
      actualReporter = 'mochawesome';
      console.log(`HTML reporter will write to: ${outputFile}/index.html`);
      break;
    default:
      console.log(`Using ${testReporter} reporter (no file output)`);
  }

  console.log(`Final reporter configuration: ${actualReporter}, options:`, reporterOptions);

  // Create the mocha test
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    timeout: 10000,
    reporter: actualReporter,
    reporterOptions,
  });

  const testsRoot = path.resolve(__dirname, '..');

  return new Promise((resolve, reject) => {
    try {
      let files: string[] = [];

      if (testSuite === 'all') {
        // Run both unit and integration tests
        const unitDir = path.join(testsRoot, 'suite', 'unit');
        const integrationDir = path.join(testsRoot, 'suite', 'integration');

        if (fs.existsSync(unitDir)) {
          files = files.concat(findTestFiles(unitDir));
        }

        if (fs.existsSync(integrationDir)) {
          files = files.concat(findTestFiles(integrationDir));
        }
      } else {
        // Run specific test suite
        const suiteDir = path.join(testsRoot, 'suite', testSuite);

        if (!fs.existsSync(suiteDir)) {
          reject(new Error(`Test suite directory not found: ${suiteDir}`));
          return;
        }

        files = findTestFiles(suiteDir);
      }

      // Add files to the test suite
      files.forEach((f) => mocha.addFile(f));

      if (files.length === 0) {
        console.log(`No test files found for suite: ${testSuite}`);
        resolve();
        return;
      }

      // Log output file if specified
      if (outputFile) {
        console.log(`Test results will be written to: ${outputFile}`);
      }

      // Run the mocha test
      mocha.run((_failures) => {
        if (outputFile) {
          console.log(`Test results written to: ${outputFile}`);
        }

        // Always resolve to ensure reports are generated, regardless of test failures
        // The shell script will handle the exit code properly
        resolve();
      });
    } catch (err) {
      console.error(err);
      reject(err);
    }
  });
}
