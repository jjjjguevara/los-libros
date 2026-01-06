/**
 * Upload Benchmark
 *
 * Performance benchmarks for chunked file uploads.
 * Tests throughput, retry handling, and parallel upload performance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockUploadEndpoint } from '../harness/mock-upload-endpoint';

// ============================================================================
// Types
// ============================================================================

/**
 * Upload benchmark result
 */
export interface UploadBenchmarkResult {
  name: string;
  fileSize: number;
  chunkSize: number;
  chunkCount: number;
  duration: number;
  throughputMBps: number;
  retries: number;
  success: boolean;
}

/**
 * Benchmark configuration
 */
export interface UploadBenchmarkConfig {
  /** File sizes to test (in bytes) */
  fileSizes: number[];
  /** Chunk sizes to test (in bytes) */
  chunkSizes: number[];
  /** Number of iterations per config */
  iterations: number;
  /** Simulated latency range */
  latencyRange: [number, number];
  /** Failure rate for retry testing */
  failureRate: number;
}

/**
 * Default benchmark configuration
 */
export const DEFAULT_UPLOAD_BENCHMARK_CONFIG: UploadBenchmarkConfig = {
  fileSizes: [
    1 * 1024 * 1024, // 1MB
    10 * 1024 * 1024, // 10MB
    50 * 1024 * 1024, // 50MB
  ],
  chunkSizes: [
    256 * 1024, // 256KB
    1 * 1024 * 1024, // 1MB
    4 * 1024 * 1024, // 4MB
  ],
  iterations: 3,
  latencyRange: [5, 20],
  failureRate: 0,
};

// ============================================================================
// Benchmark Utilities
// ============================================================================

/**
 * Generate mock file data
 */
function generateMockFile(size: number): ArrayBuffer {
  const buffer = new ArrayBuffer(size);
  const view = new Uint8Array(buffer);
  // Fill with pseudo-random data
  for (let i = 0; i < size; i++) {
    view[i] = (i * 17 + 43) % 256;
  }
  return buffer;
}

/**
 * Generate mock chunk hashes
 */
function generateChunkHashes(chunkCount: number): string[] {
  return Array.from({ length: chunkCount }, (_, i) => `hash-${i}-${Date.now()}`);
}

/**
 * Split file into chunks
 */
function splitIntoChunks(file: ArrayBuffer, chunkSize: number): ArrayBuffer[] {
  const chunks: ArrayBuffer[] = [];
  let offset = 0;
  while (offset < file.byteLength) {
    const end = Math.min(offset + chunkSize, file.byteLength);
    chunks.push(file.slice(offset, end));
    offset = end;
  }
  return chunks;
}

/**
 * Run single upload benchmark
 */
async function runSingleBenchmark(
  endpoint: MockUploadEndpoint,
  fileSize: number,
  chunkSize: number
): Promise<UploadBenchmarkResult> {
  const file = generateMockFile(fileSize);
  const chunks = splitIntoChunks(file, chunkSize);
  const chunkHashes = generateChunkHashes(chunks.length);
  const fileHash = `file-hash-${Date.now()}`;

  const startTime = performance.now();
  let retries = 0;
  let success = false;

  try {
    // Handshake
    const handshakeResult = await endpoint.handshake(
      'test-file.epub',
      fileSize,
      fileHash,
      chunkHashes,
      'application/epub+zip'
    );

    // Upload chunks
    for (let i = 0; i < chunks.length; i++) {
      if (handshakeResult.neededChunks.includes(i)) {
        let uploaded = false;
        let attempts = 0;
        while (!uploaded && attempts < 3) {
          try {
            await endpoint.uploadChunk(
              handshakeResult.sessionId,
              i,
              chunks[i],
              chunkHashes[i]
            );
            uploaded = true;
          } catch {
            attempts++;
            retries++;
            if (attempts >= 3) throw new Error(`Chunk ${i} failed after 3 attempts`);
          }
        }
      }
    }

    // Finalize
    await endpoint.finalize(handshakeResult.sessionId);
    success = true;
  } catch {
    success = false;
  }

  const duration = performance.now() - startTime;
  const throughputMBps = (fileSize / 1024 / 1024) / (duration / 1000);

  return {
    name: `${formatSize(fileSize)} @ ${formatSize(chunkSize)} chunks`,
    fileSize,
    chunkSize,
    chunkCount: chunks.length,
    duration,
    throughputMBps,
    retries,
    success,
  };
}

/**
 * Format size for display
 */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(0)}MB`;
  }
  return `${(bytes / 1024).toFixed(0)}KB`;
}

// ============================================================================
// Benchmark Runner
// ============================================================================

/**
 * Run upload benchmarks
 */
export async function runUploadBenchmarks(
  config: Partial<UploadBenchmarkConfig> = {}
): Promise<UploadBenchmarkResult[]> {
  const cfg = { ...DEFAULT_UPLOAD_BENCHMARK_CONFIG, ...config };
  const results: UploadBenchmarkResult[] = [];

  const endpoint = new MockUploadEndpoint({
    latencyMin: cfg.latencyRange[0],
    latencyMax: cfg.latencyRange[1],
    failureRate: cfg.failureRate,
  });

  for (const fileSize of cfg.fileSizes) {
    for (const chunkSize of cfg.chunkSizes) {
      const iterationResults: UploadBenchmarkResult[] = [];

      for (let i = 0; i < cfg.iterations; i++) {
        endpoint.reset();
        const result = await runSingleBenchmark(endpoint, fileSize, chunkSize);
        iterationResults.push(result);
      }

      // Average the results
      const avgResult: UploadBenchmarkResult = {
        name: iterationResults[0].name,
        fileSize,
        chunkSize,
        chunkCount: iterationResults[0].chunkCount,
        duration:
          iterationResults.reduce((sum, r) => sum + r.duration, 0) /
          cfg.iterations,
        throughputMBps:
          iterationResults.reduce((sum, r) => sum + r.throughputMBps, 0) /
          cfg.iterations,
        retries: iterationResults.reduce((sum, r) => sum + r.retries, 0),
        success: iterationResults.every((r) => r.success),
      };

      results.push(avgResult);
    }
  }

  return results;
}

/**
 * Print benchmark results as table
 */
export function printUploadBenchmarkResults(
  results: UploadBenchmarkResult[]
): void {
  console.log('\n=== Upload Benchmark Results ===\n');
  console.table(
    results.map((r) => ({
      Name: r.name,
      Duration: `${r.duration.toFixed(0)}ms`,
      'Throughput (MB/s)': r.throughputMBps.toFixed(2),
      Chunks: r.chunkCount,
      Retries: r.retries,
      Success: r.success ? '✓' : '✗',
    }))
  );
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Upload Benchmarks', () => {
  let endpoint: MockUploadEndpoint;

  beforeEach(() => {
    endpoint = new MockUploadEndpoint({
      latencyMin: 1,
      latencyMax: 5,
      failureRate: 0,
    });
  });

  afterEach(() => {
    endpoint.reset();
  });

  it('should benchmark small file upload (1MB)', async () => {
    const result = await runSingleBenchmark(endpoint, 1 * 1024 * 1024, 256 * 1024);

    expect(result.success).toBe(true);
    expect(result.chunkCount).toBe(4); // 1MB / 256KB = 4 chunks
    console.log(
      `1MB upload: ${result.duration.toFixed(0)}ms, ${result.throughputMBps.toFixed(2)} MB/s`
    );
  });

  it('should benchmark medium file upload (10MB)', async () => {
    const result = await runSingleBenchmark(endpoint, 10 * 1024 * 1024, 1 * 1024 * 1024);

    expect(result.success).toBe(true);
    expect(result.chunkCount).toBe(10); // 10MB / 1MB = 10 chunks
    console.log(
      `10MB upload: ${result.duration.toFixed(0)}ms, ${result.throughputMBps.toFixed(2)} MB/s`
    );
  });

  it('should handle retries gracefully', async () => {
    endpoint.setChunkFailures([2, 3]); // Fail chunks 2 and 3 first time

    const result = await runSingleBenchmark(endpoint, 5 * 1024 * 1024, 1 * 1024 * 1024);

    // Should still succeed due to retry logic
    expect(result.success).toBe(true);
    expect(result.retries).toBeGreaterThan(0);
  });

  it('should benchmark parallel uploads', async () => {
    const parallelCount = 3;
    const fileSize = 5 * 1024 * 1024;
    const chunkSize = 1 * 1024 * 1024;

    const startTime = performance.now();

    const promises = Array.from({ length: parallelCount }, () =>
      runSingleBenchmark(
        new MockUploadEndpoint({ latencyMin: 1, latencyMax: 5 }),
        fileSize,
        chunkSize
      )
    );

    const results = await Promise.all(promises);
    const duration = performance.now() - startTime;

    const totalBytes = fileSize * parallelCount;
    const throughput = (totalBytes / 1024 / 1024) / (duration / 1000);

    expect(results.every((r) => r.success)).toBe(true);
    console.log(
      `Parallel (${parallelCount}x): ${duration.toFixed(0)}ms, ${throughput.toFixed(2)} MB/s aggregate`
    );
  });

  it('should detect deduplication speedup', async () => {
    const fileSize = 10 * 1024 * 1024;
    const fileHash = 'duplicate-file-hash';

    // First upload
    const result1 = await runSingleBenchmark(endpoint, fileSize, 1024 * 1024);
    expect(result1.success).toBe(true);

    // Register as duplicate
    endpoint.addDuplicate(fileHash, 'existing-book-id');

    // Second upload of same file
    const file = generateMockFile(fileSize);
    const chunks = splitIntoChunks(file, 1024 * 1024);
    const chunkHashes = generateChunkHashes(chunks.length);

    const startTime = performance.now();
    const handshake = await endpoint.handshake(
      'duplicate.epub',
      fileSize,
      fileHash,
      chunkHashes,
      'application/epub+zip'
    );
    const duration = performance.now() - startTime;

    // Should be detected as duplicate immediately
    expect(handshake.isDuplicate).toBe(true);
    expect(handshake.neededChunks.length).toBe(0);
    // Deduplication should be fast (handshake only, no upload needed)
    expect(duration).toBeLessThan(100); // Under 100ms is acceptable
  });
});
