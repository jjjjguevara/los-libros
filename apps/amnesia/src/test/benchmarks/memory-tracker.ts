/**
 * Memory Tracker
 *
 * Utilities for tracking memory usage during sync operations.
 * Helps identify memory leaks and optimize resource usage.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Memory snapshot
 */
export interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
  label?: string;
}

/**
 * Memory tracking result
 */
export interface MemoryTrackingResult {
  snapshots: MemorySnapshot[];
  peakHeapUsed: number;
  peakRss: number;
  averageHeapUsed: number;
  heapGrowth: number;
  duration: number;
  potentialLeak: boolean;
}

/**
 * Memory threshold configuration
 */
export interface MemoryThresholds {
  /** Max heap growth before warning (bytes) */
  maxHeapGrowth: number;
  /** Max peak heap usage (bytes) */
  maxPeakHeap: number;
  /** Max RSS (bytes) */
  maxRss: number;
  /** Growth rate that indicates potential leak (bytes/ms) */
  leakThreshold: number;
}

/**
 * Default memory thresholds
 */
export const DEFAULT_MEMORY_THRESHOLDS: MemoryThresholds = {
  maxHeapGrowth: 50 * 1024 * 1024, // 50MB
  maxPeakHeap: 200 * 1024 * 1024, // 200MB
  maxRss: 500 * 1024 * 1024, // 500MB
  leakThreshold: 1024 * 10, // 10KB/ms
};

// ============================================================================
// Memory Tracker Class
// ============================================================================

/**
 * Track memory usage over time
 */
export class MemoryTracker {
  private snapshots: MemorySnapshot[] = [];
  private intervalId?: ReturnType<typeof setInterval>;
  private startTime?: number;

  /**
   * Take a memory snapshot
   */
  snapshot(label?: string): MemorySnapshot {
    const mem = process.memoryUsage();
    const snap: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      rss: mem.rss,
      label,
    };
    this.snapshots.push(snap);
    return snap;
  }

  /**
   * Start continuous tracking
   */
  startTracking(intervalMs = 100): void {
    this.startTime = Date.now();
    this.snapshot('start');
    this.intervalId = setInterval(() => {
      this.snapshot();
    }, intervalMs);
  }

  /**
   * Stop continuous tracking
   */
  stopTracking(): MemoryTrackingResult {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.snapshot('end');

    return this.analyze();
  }

  /**
   * Analyze collected snapshots
   */
  analyze(): MemoryTrackingResult {
    if (this.snapshots.length === 0) {
      return {
        snapshots: [],
        peakHeapUsed: 0,
        peakRss: 0,
        averageHeapUsed: 0,
        heapGrowth: 0,
        duration: 0,
        potentialLeak: false,
      };
    }

    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];

    const peakHeapUsed = Math.max(...this.snapshots.map((s) => s.heapUsed));
    const peakRss = Math.max(...this.snapshots.map((s) => s.rss));
    const averageHeapUsed =
      this.snapshots.reduce((sum, s) => sum + s.heapUsed, 0) /
      this.snapshots.length;
    const heapGrowth = last.heapUsed - first.heapUsed;
    const duration = last.timestamp - first.timestamp;

    // Check for potential leak (continuous growth)
    const potentialLeak = this.detectLeak();

    return {
      snapshots: this.snapshots,
      peakHeapUsed,
      peakRss,
      averageHeapUsed,
      heapGrowth,
      duration,
      potentialLeak,
    };
  }

  /**
   * Detect potential memory leak
   */
  private detectLeak(): boolean {
    if (this.snapshots.length < 5) return false;

    // Check if heap is consistently growing
    let growthCount = 0;
    for (let i = 1; i < this.snapshots.length; i++) {
      if (this.snapshots[i].heapUsed > this.snapshots[i - 1].heapUsed) {
        growthCount++;
      }
    }

    // If heap grew in >80% of snapshots, might be a leak
    return growthCount / (this.snapshots.length - 1) > 0.8;
  }

  /**
   * Clear tracked data
   */
  clear(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.snapshots = [];
    this.startTime = undefined;
  }

  /**
   * Get current snapshot count
   */
  getSnapshotCount(): number {
    return this.snapshots.length;
  }

  /**
   * Get snapshots
   */
  getSnapshots(): MemorySnapshot[] {
    return [...this.snapshots];
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} B`;
}

/**
 * Check memory against thresholds
 */
export function checkMemoryThresholds(
  result: MemoryTrackingResult,
  thresholds: MemoryThresholds = DEFAULT_MEMORY_THRESHOLDS
): { passed: boolean; violations: string[] } {
  const violations: string[] = [];

  if (result.heapGrowth > thresholds.maxHeapGrowth) {
    violations.push(
      `Heap growth ${formatBytes(result.heapGrowth)} exceeds threshold ${formatBytes(thresholds.maxHeapGrowth)}`
    );
  }

  if (result.peakHeapUsed > thresholds.maxPeakHeap) {
    violations.push(
      `Peak heap ${formatBytes(result.peakHeapUsed)} exceeds threshold ${formatBytes(thresholds.maxPeakHeap)}`
    );
  }

  if (result.peakRss > thresholds.maxRss) {
    violations.push(
      `Peak RSS ${formatBytes(result.peakRss)} exceeds threshold ${formatBytes(thresholds.maxRss)}`
    );
  }

  if (result.potentialLeak) {
    violations.push('Potential memory leak detected (continuous heap growth)');
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

/**
 * Print memory tracking report
 */
export function printMemoryReport(result: MemoryTrackingResult): void {
  console.log('\n=== Memory Tracking Report ===\n');
  console.log(`Duration: ${result.duration}ms`);
  console.log(`Snapshots: ${result.snapshots.length}`);
  console.log(`Peak Heap: ${formatBytes(result.peakHeapUsed)}`);
  console.log(`Peak RSS: ${formatBytes(result.peakRss)}`);
  console.log(`Average Heap: ${formatBytes(result.averageHeapUsed)}`);
  console.log(`Heap Growth: ${formatBytes(result.heapGrowth)}`);
  console.log(`Potential Leak: ${result.potentialLeak ? 'YES ⚠️' : 'No'}`);
}

/**
 * Run a function with memory tracking
 */
export async function trackMemory<T>(
  fn: () => Promise<T>,
  intervalMs = 100
): Promise<{ result: T; memory: MemoryTrackingResult }> {
  const tracker = new MemoryTracker();
  tracker.startTracking(intervalMs);

  try {
    const result = await fn();
    const memory = tracker.stopTracking();
    return { result, memory };
  } finally {
    tracker.clear();
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new memory tracker
 */
export function createMemoryTracker(): MemoryTracker {
  return new MemoryTracker();
}
