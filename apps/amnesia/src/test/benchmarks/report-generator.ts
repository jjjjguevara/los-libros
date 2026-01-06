/**
 * Report Generator
 *
 * Generates formatted benchmark and test reports.
 * Supports console, markdown, and JSON output formats.
 */

import type { UploadBenchmarkResult } from './upload-benchmark';
import type { MemoryTrackingResult } from './memory-tracker';
import { formatBytes } from './memory-tracker';

// ============================================================================
// Types
// ============================================================================

/**
 * Sync benchmark result (from sync-benchmark.ts)
 */
export interface SyncBenchmarkResult {
  name: string;
  bookCount: number;
  duration: number;
  throughput: number;
  peakMemory?: number;
  errors: number;
}

/**
 * Complete benchmark report
 */
export interface BenchmarkReport {
  timestamp: Date;
  environment: EnvironmentInfo;
  syncBenchmarks?: SyncBenchmarkResult[];
  uploadBenchmarks?: UploadBenchmarkResult[];
  memoryAnalysis?: MemoryTrackingResult;
  summary: ReportSummary;
}

/**
 * Environment information
 */
export interface EnvironmentInfo {
  nodeVersion: string;
  platform: string;
  arch: string;
  cpus: number;
  totalMemory: number;
  freeMemory: number;
}

/**
 * Report summary
 */
export interface ReportSummary {
  totalTests: number;
  passed: number;
  failed: number;
  warnings: string[];
  duration: number;
}

/**
 * Report format options
 */
export type ReportFormat = 'console' | 'markdown' | 'json';

// ============================================================================
// Environment Info
// ============================================================================

/**
 * Collect environment information
 */
export function getEnvironmentInfo(): EnvironmentInfo {
  const os = require('os');
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
  };
}

// ============================================================================
// Report Generator Class
// ============================================================================

/**
 * Generate benchmark reports
 */
export class ReportGenerator {
  private syncResults: SyncBenchmarkResult[] = [];
  private uploadResults: UploadBenchmarkResult[] = [];
  private memoryResult?: MemoryTrackingResult;
  private warnings: string[] = [];
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Add sync benchmark results
   */
  addSyncResults(results: SyncBenchmarkResult[]): void {
    this.syncResults.push(...results);
  }

  /**
   * Add upload benchmark results
   */
  addUploadResults(results: UploadBenchmarkResult[]): void {
    this.uploadResults.push(...results);
  }

  /**
   * Add memory analysis
   */
  addMemoryAnalysis(result: MemoryTrackingResult): void {
    this.memoryResult = result;
  }

  /**
   * Add warning
   */
  addWarning(warning: string): void {
    this.warnings.push(warning);
  }

  /**
   * Generate report
   */
  generate(format: ReportFormat = 'console'): string {
    const report = this.buildReport();

    switch (format) {
      case 'json':
        return this.formatJson(report);
      case 'markdown':
        return this.formatMarkdown(report);
      case 'console':
      default:
        return this.formatConsole(report);
    }
  }

  /**
   * Build the report object
   */
  private buildReport(): BenchmarkReport {
    const totalTests =
      this.syncResults.length + this.uploadResults.length + (this.memoryResult ? 1 : 0);

    const failedSync = this.syncResults.filter((r) => r.errors > 0).length;
    const failedUpload = this.uploadResults.filter((r) => !r.success).length;
    const failed = failedSync + failedUpload;

    return {
      timestamp: new Date(),
      environment: getEnvironmentInfo(),
      syncBenchmarks: this.syncResults.length > 0 ? this.syncResults : undefined,
      uploadBenchmarks: this.uploadResults.length > 0 ? this.uploadResults : undefined,
      memoryAnalysis: this.memoryResult,
      summary: {
        totalTests,
        passed: totalTests - failed,
        failed,
        warnings: this.warnings,
        duration: Date.now() - this.startTime,
      },
    };
  }

  // ==========================================================================
  // Format: Console
  // ==========================================================================

  private formatConsole(report: BenchmarkReport): string {
    const lines: string[] = [];

    lines.push('');
    lines.push('╔═══════════════════════════════════════════════════════════════╗');
    lines.push('║               BENCHMARK REPORT                                 ║');
    lines.push('╚═══════════════════════════════════════════════════════════════╝');
    lines.push('');

    // Environment
    lines.push('📋 Environment:');
    lines.push(`   Node: ${report.environment.nodeVersion}`);
    lines.push(`   Platform: ${report.environment.platform} (${report.environment.arch})`);
    lines.push(`   CPUs: ${report.environment.cpus}`);
    lines.push(`   Memory: ${formatBytes(report.environment.totalMemory)}`);
    lines.push('');

    // Sync Benchmarks
    if (report.syncBenchmarks && report.syncBenchmarks.length > 0) {
      lines.push('📊 Sync Benchmarks:');
      lines.push('   ┌────────────────────────┬───────────┬────────────┬──────────┐');
      lines.push('   │ Name                   │ Books     │ Duration   │ Books/s  │');
      lines.push('   ├────────────────────────┼───────────┼────────────┼──────────┤');
      for (const r of report.syncBenchmarks) {
        const name = r.name.padEnd(22).slice(0, 22);
        const books = String(r.bookCount).padStart(9);
        const duration = `${r.duration.toFixed(0)}ms`.padStart(10);
        const throughput = r.throughput.toFixed(1).padStart(8);
        lines.push(`   │ ${name} │ ${books} │ ${duration} │ ${throughput} │`);
      }
      lines.push('   └────────────────────────┴───────────┴────────────┴──────────┘');
      lines.push('');
    }

    // Upload Benchmarks
    if (report.uploadBenchmarks && report.uploadBenchmarks.length > 0) {
      lines.push('📤 Upload Benchmarks:');
      lines.push('   ┌────────────────────────┬────────────┬────────────┬──────────┐');
      lines.push('   │ Name                   │ Duration   │ MB/s       │ Status   │');
      lines.push('   ├────────────────────────┼────────────┼────────────┼──────────┤');
      for (const r of report.uploadBenchmarks) {
        const name = r.name.padEnd(22).slice(0, 22);
        const duration = `${r.duration.toFixed(0)}ms`.padStart(10);
        const throughput = r.throughputMBps.toFixed(2).padStart(10);
        const status = (r.success ? '✓' : '✗').padStart(8);
        lines.push(`   │ ${name} │ ${duration} │ ${throughput} │ ${status} │`);
      }
      lines.push('   └────────────────────────┴────────────┴────────────┴──────────┘');
      lines.push('');
    }

    // Memory Analysis
    if (report.memoryAnalysis) {
      const mem = report.memoryAnalysis;
      lines.push('🧠 Memory Analysis:');
      lines.push(`   Peak Heap: ${formatBytes(mem.peakHeapUsed)}`);
      lines.push(`   Heap Growth: ${formatBytes(mem.heapGrowth)}`);
      lines.push(`   Potential Leak: ${mem.potentialLeak ? '⚠️ YES' : '✓ No'}`);
      lines.push('');
    }

    // Summary
    lines.push('📈 Summary:');
    lines.push(`   Total Tests: ${report.summary.totalTests}`);
    lines.push(`   Passed: ${report.summary.passed} ✓`);
    lines.push(`   Failed: ${report.summary.failed} ${report.summary.failed > 0 ? '✗' : ''}`);
    lines.push(`   Duration: ${report.summary.duration}ms`);

    if (report.summary.warnings.length > 0) {
      lines.push('');
      lines.push('⚠️ Warnings:');
      for (const w of report.summary.warnings) {
        lines.push(`   - ${w}`);
      }
    }

    lines.push('');
    lines.push(`Generated: ${report.timestamp.toISOString()}`);
    lines.push('');

    return lines.join('\n');
  }

  // ==========================================================================
  // Format: Markdown
  // ==========================================================================

  private formatMarkdown(report: BenchmarkReport): string {
    const lines: string[] = [];

    lines.push('# Benchmark Report');
    lines.push('');
    lines.push(`Generated: ${report.timestamp.toISOString()}`);
    lines.push('');

    // Environment
    lines.push('## Environment');
    lines.push('');
    lines.push(`- **Node:** ${report.environment.nodeVersion}`);
    lines.push(`- **Platform:** ${report.environment.platform} (${report.environment.arch})`);
    lines.push(`- **CPUs:** ${report.environment.cpus}`);
    lines.push(`- **Memory:** ${formatBytes(report.environment.totalMemory)}`);
    lines.push('');

    // Sync Benchmarks
    if (report.syncBenchmarks && report.syncBenchmarks.length > 0) {
      lines.push('## Sync Benchmarks');
      lines.push('');
      lines.push('| Name | Books | Duration | Books/s |');
      lines.push('|------|-------|----------|---------|');
      for (const r of report.syncBenchmarks) {
        lines.push(`| ${r.name} | ${r.bookCount} | ${r.duration.toFixed(0)}ms | ${r.throughput.toFixed(1)} |`);
      }
      lines.push('');
    }

    // Upload Benchmarks
    if (report.uploadBenchmarks && report.uploadBenchmarks.length > 0) {
      lines.push('## Upload Benchmarks');
      lines.push('');
      lines.push('| Name | Duration | MB/s | Status |');
      lines.push('|------|----------|------|--------|');
      for (const r of report.uploadBenchmarks) {
        const status = r.success ? '✓' : '✗';
        lines.push(`| ${r.name} | ${r.duration.toFixed(0)}ms | ${r.throughputMBps.toFixed(2)} | ${status} |`);
      }
      lines.push('');
    }

    // Memory
    if (report.memoryAnalysis) {
      const mem = report.memoryAnalysis;
      lines.push('## Memory Analysis');
      lines.push('');
      lines.push(`- **Peak Heap:** ${formatBytes(mem.peakHeapUsed)}`);
      lines.push(`- **Heap Growth:** ${formatBytes(mem.heapGrowth)}`);
      lines.push(`- **Potential Leak:** ${mem.potentialLeak ? 'Yes ⚠️' : 'No'}`);
      lines.push('');
    }

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(`- **Total Tests:** ${report.summary.totalTests}`);
    lines.push(`- **Passed:** ${report.summary.passed}`);
    lines.push(`- **Failed:** ${report.summary.failed}`);
    lines.push(`- **Duration:** ${report.summary.duration}ms`);
    lines.push('');

    if (report.summary.warnings.length > 0) {
      lines.push('### Warnings');
      lines.push('');
      for (const w of report.summary.warnings) {
        lines.push(`- ${w}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ==========================================================================
  // Format: JSON
  // ==========================================================================

  private formatJson(report: BenchmarkReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Reset the generator
   */
  reset(): void {
    this.syncResults = [];
    this.uploadResults = [];
    this.memoryResult = undefined;
    this.warnings = [];
    this.startTime = Date.now();
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new report generator
 */
export function createReportGenerator(): ReportGenerator {
  return new ReportGenerator();
}
