/**
 * PDF Telemetry Module
 *
 * Tracks performance metrics for PDF rendering to guide optimization decisions.
 * Provides real-time visibility into cache hit rates, render times, worker utilization,
 * and memory usage.
 *
 * Features:
 * - L1/L2/L3 cache tier tracking
 * - Page and tile render time tracking
 * - First tile time for initial load performance
 * - Mode transition tracking
 * - Worker utilization monitoring
 * - Memory usage tracking with peak detection
 *
 * Usage:
 * ```typescript
 * const telemetry = getTelemetry();
 * telemetry.trackCacheAccess('L1', true);
 * telemetry.trackRenderTime(45, 'tile');
 * console.log(telemetry.getStats());
 * ```
 */

export interface TelemetryMetrics {
  // Cache metrics (tier-specific - overall computed from these in getStats())
  l1Hits: number;
  l1Misses: number;
  l2Hits: number;
  l2Misses: number;
  l3Hits: number;
  l3Misses: number;

  // Render metrics (rolling window)
  renderTimes: number[];
  tileRenderTimes: number[];
  firstTileTime: number | null;

  // Worker metrics
  workerUtilization: number[];
  activeWorkers: number;
  totalWorkers: number;
  pendingTasks: number;

  // Memory metrics
  memorySnapshots: number[];
  peakMemory: number;

  // Mode transition metrics
  modeTransitions: ModeTransition[];

  // Session metrics
  sessionStartTime: number;
  totalRenders: number;
  totalTileRenders: number;
}

export interface ModeTransition {
  from: string;
  to: string;
  duration: number;
  timestamp: number;
}

export interface TelemetryStats {
  // Cache statistics
  overallHitRate: number;
  l1HitRate: number;
  l2HitRate: number;
  l3HitRate: number;

  // Render statistics
  avgRenderTime: number;
  avgTileRenderTime: number;
  p95RenderTime: number;
  p95TileRenderTime: number;
  firstTileTime: number | null;

  // Worker statistics
  avgWorkerUtilization: number;
  currentActiveWorkers: number;
  currentTotalWorkers: number;
  currentPendingTasks: number;

  // Memory statistics
  avgMemoryMB: number;
  peakMemoryMB: number;
  currentMemoryMB: number;

  // Mode statistics
  totalModeTransitions: number;
  avgTransitionDuration: number;

  // Session statistics
  sessionDuration: number;
  totalRenders: number;
  totalTileRenders: number;
  rendersPerSecond: number;

  // Legacy compat
  hitRate: number;
  cacheHits: number;
  cacheMisses: number;
}

export class PdfTelemetry {
  private metrics: TelemetryMetrics;
  private readonly maxSamples = 100;

  constructor() {
    this.metrics = this.createEmptyMetrics();
  }

  private createEmptyMetrics(): TelemetryMetrics {
    return {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      l3Hits: 0,
      l3Misses: 0,
      renderTimes: [],
      tileRenderTimes: [],
      firstTileTime: null,
      workerUtilization: [],
      activeWorkers: 0,
      totalWorkers: 0,
      pendingTasks: 0,
      memorySnapshots: [],
      peakMemory: 0,
      modeTransitions: [],
      sessionStartTime: Date.now(),
      totalRenders: 0,
      totalTileRenders: 0,
    };
  }

  /**
   * Track cache access with tier information
   * @param tier Cache tier (L1 = visible, L2 = prefetch, L3 = metadata)
   * @param hit Whether it was a cache hit
   *
   * Note: The overall cacheHits/cacheMisses counters are computed from tier
   * counters in getStats() to avoid double counting.
   */
  trackCacheAccess(tier: 'L1' | 'L2' | 'L3', hit: boolean): void;
  /**
   * Track cache access (legacy overload for backward compatibility)
   * @param hit Whether it was a cache hit
   */
  trackCacheAccess(hit: boolean): void;
  trackCacheAccess(tierOrHit: 'L1' | 'L2' | 'L3' | boolean, hit?: boolean): void {
    // Handle legacy call signature: trackCacheAccess(true/false)
    // For legacy, we only update overall counters (assume L1)
    if (typeof tierOrHit === 'boolean') {
      if (tierOrHit) {
        this.metrics.l1Hits++;
      } else {
        this.metrics.l1Misses++;
      }
      return;
    }

    // Handle new call signature: trackCacheAccess('L1', true/false)
    // Only update tier-specific counters - overall is computed in getStats()
    const tier = tierOrHit;
    const wasHit = hit ?? false;

    switch (tier) {
      case 'L1':
        wasHit ? this.metrics.l1Hits++ : this.metrics.l1Misses++;
        break;
      case 'L2':
        wasHit ? this.metrics.l2Hits++ : this.metrics.l2Misses++;
        break;
      case 'L3':
        wasHit ? this.metrics.l3Hits++ : this.metrics.l3Misses++;
        break;
    }
  }

  /**
   * Track render time
   * @param ms Duration in milliseconds
   * @param type 'page' for full page renders, 'tile' for tile renders
   */
  trackRenderTime(ms: number, type?: 'page' | 'tile'): void {
    const renderType = type ?? 'page';

    if (renderType === 'page') {
      this.metrics.renderTimes.push(ms);
      this.metrics.totalRenders++;

      if (this.metrics.renderTimes.length > this.maxSamples) {
        this.metrics.renderTimes.shift();
      }
    } else {
      this.metrics.tileRenderTimes.push(ms);
      this.metrics.totalTileRenders++;

      // Track first tile time for initial load performance
      if (this.metrics.firstTileTime === null) {
        this.metrics.firstTileTime = ms;
      }

      if (this.metrics.tileRenderTimes.length > this.maxSamples) {
        this.metrics.tileRenderTimes.shift();
      }
    }
  }

  /**
   * Track first tile render time explicitly
   */
  trackFirstTile(ms: number): void {
    if (this.metrics.firstTileTime === null) {
      this.metrics.firstTileTime = ms;
    }
  }

  /**
   * Track mode transition (paginated <-> scroll <-> grid)
   */
  trackModeTransition(from: string, to: string, durationMs: number): void {
    this.metrics.modeTransitions.push({
      from,
      to,
      duration: durationMs,
      timestamp: Date.now(),
    });

    // Keep last 50 transitions
    if (this.metrics.modeTransitions.length > 50) {
      this.metrics.modeTransitions.shift();
    }
  }

  /**
   * Track worker task started (legacy compat)
   */
  trackWorkerTaskStart(): void {
    this.metrics.pendingTasks++;
  }

  /**
   * Track worker task completed (legacy compat)
   */
  trackWorkerTaskComplete(): void {
    if (this.metrics.pendingTasks > 0) {
      this.metrics.pendingTasks--;
    }
  }

  /**
   * Track worker utilization snapshot
   */
  trackWorkerUtilization(activeWorkers: number, totalWorkers: number, pendingTasks?: number): void {
    const utilization = totalWorkers > 0 ? activeWorkers / totalWorkers : 0;
    this.metrics.workerUtilization.push(utilization);
    this.metrics.activeWorkers = activeWorkers;
    this.metrics.totalWorkers = totalWorkers;
    if (pendingTasks !== undefined) {
      this.metrics.pendingTasks = pendingTasks;
    }

    if (this.metrics.workerUtilization.length > this.maxSamples) {
      this.metrics.workerUtilization.shift();
    }
  }

  /**
   * Take memory snapshot
   */
  snapshotMemory(): void {
    const memory = this.getMemoryUsage();
    if (memory > 0) {
      this.metrics.memorySnapshots.push(memory);
      this.metrics.peakMemory = Math.max(this.metrics.peakMemory, memory);

      if (this.metrics.memorySnapshots.length > this.maxSamples) {
        this.metrics.memorySnapshots.shift();
      }
    }
  }

  /**
   * Get current memory usage in bytes
   */
  private getMemoryUsage(): number {
    const perf = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    return perf?.memory?.usedJSHeapSize ?? 0;
  }

  /**
   * Calculate percentile from array
   */
  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Calculate average from array
   */
  private average(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * Calculate hit rate
   */
  private hitRate(hits: number, misses: number): number {
    const total = hits + misses;
    return total > 0 ? hits / total : 0;
  }

  /**
   * Get comprehensive statistics
   */
  getStats(): TelemetryStats {
    const now = Date.now();
    const sessionDuration = (now - this.metrics.sessionStartTime) / 1000;
    const currentMemory = this.getMemoryUsage();

    // Compute overall cache hits/misses from tier counters to avoid double counting
    const totalCacheHits = this.metrics.l1Hits + this.metrics.l2Hits + this.metrics.l3Hits;
    const totalCacheMisses = this.metrics.l1Misses + this.metrics.l2Misses + this.metrics.l3Misses;
    const overallHitRate = this.hitRate(totalCacheHits, totalCacheMisses);

    return {
      // Cache statistics
      overallHitRate,
      l1HitRate: this.hitRate(this.metrics.l1Hits, this.metrics.l1Misses),
      l2HitRate: this.hitRate(this.metrics.l2Hits, this.metrics.l2Misses),
      l3HitRate: this.hitRate(this.metrics.l3Hits, this.metrics.l3Misses),

      // Render statistics
      avgRenderTime: this.average(this.metrics.renderTimes),
      avgTileRenderTime: this.average(this.metrics.tileRenderTimes),
      p95RenderTime: this.percentile(this.metrics.renderTimes, 95),
      p95TileRenderTime: this.percentile(this.metrics.tileRenderTimes, 95),
      firstTileTime: this.metrics.firstTileTime,

      // Worker statistics
      avgWorkerUtilization: this.average(this.metrics.workerUtilization),
      currentActiveWorkers: this.metrics.activeWorkers,
      currentTotalWorkers: this.metrics.totalWorkers,
      currentPendingTasks: this.metrics.pendingTasks,

      // Memory statistics
      avgMemoryMB: this.average(this.metrics.memorySnapshots) / (1024 * 1024),
      peakMemoryMB: this.metrics.peakMemory / (1024 * 1024),
      currentMemoryMB: currentMemory / (1024 * 1024),

      // Mode statistics
      totalModeTransitions: this.metrics.modeTransitions.length,
      avgTransitionDuration: this.average(
        this.metrics.modeTransitions.map((t) => t.duration)
      ),

      // Session statistics
      sessionDuration,
      totalRenders: this.metrics.totalRenders,
      totalTileRenders: this.metrics.totalTileRenders,
      rendersPerSecond:
        sessionDuration > 0
          ? (this.metrics.totalRenders + this.metrics.totalTileRenders) / sessionDuration
          : 0,

      // Legacy compat - use computed totals
      hitRate: overallHitRate,
      cacheHits: totalCacheHits,
      cacheMisses: totalCacheMisses,
    };
  }

  /**
   * Get raw metrics (for detailed analysis)
   */
  getRawMetrics(): Readonly<TelemetryMetrics> {
    return { ...this.metrics };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics = this.createEmptyMetrics();
  }

  /**
   * Expose telemetry to window for DevTools MCP access
   */
  exposeToWindow(): void {
    (globalThis as Record<string, unknown>).pdfTelemetry = this;
  }

  /**
   * Get a formatted summary string
   */
  getSummary(): string {
    const stats = this.getStats();
    return [
      `[PDF Telemetry Summary]`,
      `  Cache: ${(stats.overallHitRate * 100).toFixed(1)}% hit rate (L1: ${(stats.l1HitRate * 100).toFixed(1)}%, L2: ${(stats.l2HitRate * 100).toFixed(1)}%)`,
      `  Render: avg ${stats.avgRenderTime.toFixed(1)}ms, p95 ${stats.p95RenderTime.toFixed(1)}ms`,
      `  Tiles: avg ${stats.avgTileRenderTime.toFixed(1)}ms, first ${stats.firstTileTime?.toFixed(1) ?? 'N/A'}ms`,
      `  Workers: ${(stats.avgWorkerUtilization * 100).toFixed(0)}% utilization, ${stats.currentPendingTasks} pending`,
      `  Memory: ${stats.currentMemoryMB.toFixed(1)}MB current, ${stats.peakMemoryMB.toFixed(1)}MB peak`,
      `  Session: ${stats.sessionDuration.toFixed(1)}s, ${stats.totalRenders + stats.totalTileRenders} renders`,
    ].join('\n');
  }

  /**
   * Log current stats to console
   */
  logStats(): void {
    console.log(this.getSummary());
  }

  /**
   * Start periodic memory tracking
   * @returns Cleanup function to stop tracking
   */
  startPeriodicMemoryTracking(intervalMs: number = 5000): () => void {
    const interval = setInterval(() => {
      this.snapshotMemory();
    }, intervalMs);
    return () => clearInterval(interval);
  }
}

// Singleton instance
let telemetryInstance: PdfTelemetry | null = null;

/**
 * Get the shared telemetry instance
 */
export function getTelemetry(): PdfTelemetry {
  if (!telemetryInstance) {
    telemetryInstance = new PdfTelemetry();
    telemetryInstance.exposeToWindow();
  }
  return telemetryInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetTelemetry(): void {
  telemetryInstance = null;
}

/**
 * Convenience function to track cache access
 */
export function trackCacheAccess(tier: 'L1' | 'L2' | 'L3', hit: boolean): void;
export function trackCacheAccess(hit: boolean): void;
export function trackCacheAccess(tierOrHit: 'L1' | 'L2' | 'L3' | boolean, hit?: boolean): void {
  if (typeof tierOrHit === 'boolean') {
    getTelemetry().trackCacheAccess(tierOrHit);
  } else {
    getTelemetry().trackCacheAccess(tierOrHit, hit ?? false);
  }
}

/**
 * Convenience function to track render time
 */
export function trackRenderTime(ms: number, type?: 'page' | 'tile'): void {
  getTelemetry().trackRenderTime(ms, type);
}

/**
 * Decorator/wrapper for timing async functions
 */
export async function withTelemetry<T>(
  type: 'page' | 'tile',
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const duration = performance.now() - start;
    getTelemetry().trackRenderTime(duration, type);
  }
}

/**
 * Create a timer for manual timing
 */
export function createRenderTimer(type: 'page' | 'tile'): () => void {
  const start = performance.now();
  return () => {
    const duration = performance.now() - start;
    getTelemetry().trackRenderTime(duration, type);
  };
}
