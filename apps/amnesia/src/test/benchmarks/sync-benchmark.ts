/**
 * Sync Benchmark
 *
 * Performance benchmarking utilities for sync operations.
 *
 * @see docs/plans/unified-sync-architecture-prd.md
 */

import type { UnifiedSyncEngine } from '../../sync/unified-sync-engine';
import type { SyncProgress, SyncResult } from '../../sync/types';
import { MockServerHarness } from '../harness/mock-server-harness';
import { getFixture, type FixtureName } from '../fixtures/library-fixtures';

// ============================================================================
// Types
// ============================================================================

/**
 * Benchmark result
 */
export interface BenchmarkResult {
  /** Benchmark name */
  name: string;
  /** Number of iterations */
  iterations: number;
  /** Metrics */
  metrics: {
    /** Total time in ms */
    totalTime: number;
    /** Average time per item in ms */
    avgTime: number;
    /** Throughput (items/sec) */
    throughput: number;
    /** Peak memory in MB */
    peakMemory: number;
    /** Network bytes transferred */
    networkBytes: number;
  };
  /** Individual run times */
  runTimes: number[];
  /** Statistics */
  stats: {
    min: number;
    max: number;
    median: number;
    p95: number;
    stdDev: number;
  };
}

/**
 * Benchmark configuration
 */
export interface BenchmarkConfig {
  /** Number of iterations */
  iterations: number;
  /** Warmup iterations (not counted) */
  warmupIterations: number;
  /** Delay between iterations in ms */
  iterationDelay: number;
  /** Track memory usage */
  trackMemory: boolean;
}

/**
 * Default benchmark configuration
 */
export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  iterations: 5,
  warmupIterations: 1,
  iterationDelay: 100,
  trackMemory: true,
};

/**
 * Benchmark target times
 */
export const BENCHMARK_TARGETS = {
  'full-sync-100': 10000,    // 10s
  'full-sync-1000': 60000,   // 60s
  'full-sync-5000': 180000,  // 3 min
  'incremental-50': 30000,   // 30s
  'cover-download-100': 30000, // 30s
  'chunked-upload-50mb': 60000, // 60s
} as const;

// ============================================================================
// Sync Benchmark
// ============================================================================

/**
 * Benchmark runner for sync operations
 */
export class SyncBenchmark {
  private syncEngine: UnifiedSyncEngine;
  private mockServer: MockServerHarness;
  private config: BenchmarkConfig;
  private results: BenchmarkResult[] = [];

  constructor(
    syncEngine: UnifiedSyncEngine,
    config: Partial<BenchmarkConfig> = {}
  ) {
    this.syncEngine = syncEngine;
    this.mockServer = new MockServerHarness({ latencyMin: 0, latencyMax: 10 });
    this.config = { ...DEFAULT_BENCHMARK_CONFIG, ...config };
  }

  // ==========================================================================
  // Benchmark Scenarios
  // ==========================================================================

  /**
   * Run full sync benchmark
   */
  async runFullSync(bookCount: number): Promise<BenchmarkResult> {
    const name = `full-sync-${bookCount}`;

    // Setup fixture
    this.setupFixture(bookCount);

    return this.runBenchmark(name, async () => {
      const result = await this.syncEngine.fullSync({ dryRun: true });
      return result.stats.total;
    });
  }

  /**
   * Run incremental sync benchmark
   */
  async runIncrementalSync(changeCount: number): Promise<BenchmarkResult> {
    const name = `incremental-sync-${changeCount}`;

    // Setup with changes
    this.mockServer.seedBooks(1000);

    return this.runBenchmark(name, async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = await this.syncEngine.incrementalSync({
        since,
        dryRun: true,
      });
      return result.stats.total;
    });
  }

  /**
   * Run cover download benchmark
   */
  async runCoverDownload(count: number, concurrency: number): Promise<BenchmarkResult> {
    const name = `cover-download-${count}-c${concurrency}`;

    this.mockServer.seedBooks(count);

    return this.runBenchmark(name, async () => {
      const result = await this.syncEngine.fullSync({
        includeCovers: true,
        dryRun: true,
      });
      return result.stats.total;
    });
  }

  /**
   * Run all benchmark scenarios
   */
  async runAllScenarios(): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];

    // Full sync benchmarks
    results.push(await this.runFullSync(100));
    results.push(await this.runFullSync(1000));

    // Incremental sync
    results.push(await this.runIncrementalSync(50));

    // Cover downloads
    results.push(await this.runCoverDownload(100, 5));

    this.results = results;
    return results;
  }

  // ==========================================================================
  // Core Benchmark Runner
  // ==========================================================================

  /**
   * Run a benchmark with the given function
   */
  private async runBenchmark(
    name: string,
    fn: () => Promise<number>
  ): Promise<BenchmarkResult> {
    const runTimes: number[] = [];
    let totalItems = 0;
    let peakMemory = 0;

    // Warmup
    for (let i = 0; i < this.config.warmupIterations; i++) {
      await fn();
      await this.delay(this.config.iterationDelay);
    }

    // Actual runs
    for (let i = 0; i < this.config.iterations; i++) {
      const memBefore = this.getMemoryUsage();
      const start = performance.now();

      totalItems = await fn();

      const duration = performance.now() - start;
      const memAfter = this.getMemoryUsage();

      runTimes.push(duration);
      peakMemory = Math.max(peakMemory, memAfter - memBefore);

      await this.delay(this.config.iterationDelay);
    }

    const totalTime = runTimes.reduce((a, b) => a + b, 0);
    const avgTime = totalTime / this.config.iterations;

    return {
      name,
      iterations: this.config.iterations,
      metrics: {
        totalTime: avgTime,
        avgTime: totalItems > 0 ? avgTime / totalItems : 0,
        throughput: totalItems > 0 ? (totalItems / avgTime) * 1000 : 0,
        peakMemory: peakMemory / (1024 * 1024), // MB
        networkBytes: 0, // TODO: Track network
      },
      runTimes,
      stats: this.calculateStats(runTimes),
    };
  }

  // ==========================================================================
  // Comparison & Reporting
  // ==========================================================================

  /**
   * Compare two benchmark results
   */
  compareResults(
    baseline: BenchmarkResult,
    current: BenchmarkResult
  ): {
    name: string;
    improved: boolean;
    percentChange: number;
    baselineTime: number;
    currentTime: number;
  } {
    const percentChange =
      ((current.metrics.totalTime - baseline.metrics.totalTime) /
        baseline.metrics.totalTime) *
      100;

    return {
      name: current.name,
      improved: percentChange < 0,
      percentChange,
      baselineTime: baseline.metrics.totalTime,
      currentTime: current.metrics.totalTime,
    };
  }

  /**
   * Generate markdown report
   */
  generateReport(results: BenchmarkResult[]): string {
    const lines: string[] = [
      '# Sync Benchmark Report',
      '',
      `Generated: ${new Date().toISOString()}`,
      `Iterations: ${this.config.iterations}`,
      '',
      '## Results',
      '',
      '| Scenario | Total Time | Avg/Item | Throughput | Peak Memory | Status |',
      '|----------|------------|----------|------------|-------------|--------|',
    ];

    for (const result of results) {
      const target = BENCHMARK_TARGETS[result.name as keyof typeof BENCHMARK_TARGETS];
      const status = target
        ? result.metrics.totalTime <= target
          ? '✅ Pass'
          : '❌ Fail'
        : '⚪ N/A';

      lines.push(
        `| ${result.name} | ${this.formatTime(result.metrics.totalTime)} | ${this.formatTime(result.metrics.avgTime)} | ${result.metrics.throughput.toFixed(1)}/s | ${result.metrics.peakMemory.toFixed(1)}MB | ${status} |`
      );
    }

    lines.push('', '## Statistics', '');

    for (const result of results) {
      lines.push(`### ${result.name}`);
      lines.push(`- Min: ${this.formatTime(result.stats.min)}`);
      lines.push(`- Max: ${this.formatTime(result.stats.max)}`);
      lines.push(`- Median: ${this.formatTime(result.stats.median)}`);
      lines.push(`- P95: ${this.formatTime(result.stats.p95)}`);
      lines.push(`- StdDev: ${this.formatTime(result.stats.stdDev)}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get all results
   */
  getResults(): BenchmarkResult[] {
    return [...this.results];
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Setup fixture for benchmark
   */
  private setupFixture(bookCount: number): void {
    this.mockServer.clear();

    if (bookCount <= 10) {
      this.mockServer.loadFixture('small-library');
    } else if (bookCount <= 100) {
      this.mockServer.loadFixture('medium-library');
    } else if (bookCount <= 1000) {
      this.mockServer.loadFixture('large-library');
    } else {
      this.mockServer.seedBooks(bookCount);
    }
  }

  /**
   * Calculate statistics
   */
  private calculateStats(times: number[]): BenchmarkResult['stats'] {
    const sorted = [...times].sort((a, b) => a - b);
    const n = sorted.length;

    const mean = times.reduce((a, b) => a + b, 0) / n;
    const variance = times.reduce((sum, t) => sum + (t - mean) ** 2, 0) / n;

    return {
      min: sorted[0],
      max: sorted[n - 1],
      median: sorted[Math.floor(n / 2)],
      p95: sorted[Math.floor(n * 0.95)],
      stdDev: Math.sqrt(variance),
    };
  }

  /**
   * Get current memory usage
   */
  private getMemoryUsage(): number {
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      return (performance as unknown as { memory: { usedJSHeapSize: number } }).memory
        .usedJSHeapSize;
    }
    return 0;
  }

  /**
   * Format time for display
   */
  private formatTime(ms: number): string {
    if (ms < 1000) {
      return `${ms.toFixed(0)}ms`;
    }
    if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${(ms / 60000).toFixed(1)}m`;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
