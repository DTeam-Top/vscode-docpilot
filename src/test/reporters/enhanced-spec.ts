import * as Mocha from 'mocha';

interface CustomTestStats {
  passes: number;
  failures: number;
  pending: number;
  duration: number;
  suites: Map<
    string,
    { passes: number; failures: number; pending: number; type: 'unit' | 'integration' | 'unknown' }
  >;
  slowTests: Array<{ title: string; duration: number; fullTitle: string }>;
}

class EnhancedSpecReporter extends Mocha.reporters.Spec {
  private customStats: CustomTestStats;
  private startTime: number;

  constructor(runner: Mocha.Runner, options?: Mocha.MochaOptions) {
    super(runner, options);

    this.customStats = {
      passes: 0,
      failures: 0,
      pending: 0,
      duration: 0,
      suites: new Map(),
      slowTests: [],
    };

    this.startTime = Date.now();

    // Override the default behavior to capture stats
    this.setupEventHandlers(runner);
  }

  private setupEventHandlers(runner: Mocha.Runner) {
    runner.on('pass', (test: Mocha.Test) => {
      this.customStats.passes++;
      this.updateSuiteStats(test.parent?.title || 'Unknown', 'pass', test.file);

      // Track slow tests (>500ms)
      if (test.duration && test.duration > 500) {
        this.customStats.slowTests.push({
          title: test.title,
          duration: test.duration,
          fullTitle: test.fullTitle(),
        });
      }
    });

    runner.on('fail', (test: Mocha.Test) => {
      this.customStats.failures++;
      this.updateSuiteStats(test.parent?.title || 'Unknown', 'fail', test.file);
    });

    runner.on('pending', (test: Mocha.Test) => {
      this.customStats.pending++;
      this.updateSuiteStats(test.parent?.title || 'Unknown', 'pending', test.file);
    });

    runner.on('end', () => {
      this.customStats.duration = Date.now() - this.startTime;
      this.printEnhancedSummary();
    });
  }

  private updateSuiteStats(
    suiteName: string,
    result: 'pass' | 'fail' | 'pending',
    filePath?: string
  ) {
    if (!this.customStats.suites.has(suiteName)) {
      const testType = this.getTestType(filePath);
      this.customStats.suites.set(suiteName, {
        passes: 0,
        failures: 0,
        pending: 0,
        type: testType,
      });
    }

    const suite = this.customStats.suites.get(suiteName)!;
    switch (result) {
      case 'pass':
        suite.passes++;
        break;
      case 'fail':
        suite.failures++;
        break;
      case 'pending':
        suite.pending++;
        break;
    }
  }

  private getTestType(filePath?: string): 'unit' | 'integration' | 'unknown' {
    if (!filePath) return 'unknown';

    if (filePath.includes('/unit/')) return 'unit';
    if (filePath.includes('/integration/')) return 'integration';

    return 'unknown';
  }

  private printEnhancedSummary() {
    const total = this.customStats.passes + this.customStats.failures + this.customStats.pending;
    const passRate = total > 0 ? ((this.customStats.passes / total) * 100).toFixed(1) : '0.0';
    const duration = (this.customStats.duration / 1000).toFixed(1);

    console.log(`\n${'='.repeat(50)}`);
    console.log('              TEST RESULTS SUMMARY');
    console.log('='.repeat(50));

    // Overall stats
    if (this.customStats.failures === 0) {
      console.log(`✅ Passed: ${this.customStats.passes}/${total} tests (${passRate}%)`);
    } else {
      console.log(
        `❌ Failed: ${this.customStats.failures}/${total} tests (${(100 - parseFloat(passRate)).toFixed(1)}%)`
      );
      console.log(`✅ Passed: ${this.customStats.passes}/${total} tests (${passRate}%)`);
    }

    if (this.customStats.pending > 0) {
      console.log(`⏳ Pending: ${this.customStats.pending}/${total} tests`);
    }

    console.log(`⏱️  Duration: ${duration}s`);
    console.log(`📁 Suites: ${this.customStats.suites.size}`);

    // Group suites by type
    const unitSuites = new Map<string, any>();
    const integrationSuites = new Map<string, any>();
    const unknownSuites = new Map<string, any>();

    for (const [suiteName, suiteStats] of this.customStats.suites) {
      switch (suiteStats.type) {
        case 'unit':
          unitSuites.set(suiteName, suiteStats);
          break;
        case 'integration':
          integrationSuites.set(suiteName, suiteStats);
          break;
        default:
          unknownSuites.set(suiteName, suiteStats);
          break;
      }
    }

    // Unit tests breakdown
    if (unitSuites.size > 0) {
      console.log('\n🧪 UNIT TESTS:');
      for (const [suiteName, suiteStats] of unitSuites) {
        const suiteTotal = suiteStats.passes + suiteStats.failures + suiteStats.pending;
        const icon = suiteStats.failures > 0 ? '❌' : '✅';
        const status =
          suiteStats.failures > 0
            ? `${suiteStats.failures}/${suiteTotal} failed`
            : `${suiteStats.passes}/${suiteTotal} passed`;

        console.log(`  ${icon} ${suiteName}: ${status}`);
      }
    }

    // Integration tests breakdown
    if (integrationSuites.size > 0) {
      console.log('\n🔗 INTEGRATION TESTS:');
      for (const [suiteName, suiteStats] of integrationSuites) {
        const suiteTotal = suiteStats.passes + suiteStats.failures + suiteStats.pending;
        const icon = suiteStats.failures > 0 ? '❌' : '✅';
        const status =
          suiteStats.failures > 0
            ? `${suiteStats.failures}/${suiteTotal} failed`
            : `${suiteStats.passes}/${suiteTotal} passed`;

        console.log(`  ${icon} ${suiteName}: ${status}`);
      }
    }

    // Unknown tests breakdown (fallback)
    if (unknownSuites.size > 0) {
      console.log('\n📦 OTHER TESTS:');
      for (const [suiteName, suiteStats] of unknownSuites) {
        const suiteTotal = suiteStats.passes + suiteStats.failures + suiteStats.pending;
        const icon = suiteStats.failures > 0 ? '❌' : '✅';
        const status =
          suiteStats.failures > 0
            ? `${suiteStats.failures}/${suiteTotal} failed`
            : `${suiteStats.passes}/${suiteTotal} passed`;

        console.log(`  ${icon} ${suiteName}: ${status}`);
      }
    }

    // Slow tests
    if (this.customStats.slowTests.length > 0) {
      console.log('\n🐌 SLOW TESTS (>500ms):');
      this.customStats.slowTests
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 5)
        .forEach((test) => {
          console.log(`  ⏱️  ${test.duration}ms - ${test.fullTitle}`);
        });
    }

    // Failed tests details
    if (this.customStats.failures > 0) {
      console.log('\n❌ FAILED TESTS:');
      // Note: Failed test details are already printed by the parent Spec reporter
      console.log('  (See details above)');
    }

    console.log('='.repeat(50));

    // Final status
    if (this.customStats.failures === 0) {
      console.log('🎉 ALL TESTS PASSED!');
    } else {
      console.log(`💥 ${this.customStats.failures} TEST(S) FAILED`);
    }

    console.log(`${'='.repeat(50)}\n`);
  }
}

export = EnhancedSpecReporter;
