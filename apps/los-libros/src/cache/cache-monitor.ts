/**
 * Cache Monitor
 *
 * Provides real-time monitoring and diagnostics for the caching system.
 * Tracks performance metrics, alerts on issues, and supports debugging.
 *
 * Features:
 * - Real-time statistics tracking
 * - Performance alerts
 * - Memory pressure detection
 * - Historical metrics
 * - Diagnostic snapshots
 *
 * @see docs/specifications/file-system-architecture.md
 */

import type { TieredCache, TieredCacheStats } from './tiered-cache';

// ============================================================================
// Types
// ============================================================================

/**
 * Performance metric sample
 */
export interface MetricSample {
  /** Timestamp */
  timestamp: number;
  /** L1 size in bytes */
  l1Size: number;
  /** L2 size in bytes */
  l2Size: number;
  /** L1 hit ratio */
  l1HitRatio: number;
  /** L2 hit ratio */
  l2HitRatio: number;
  /** Average latency in ms */
  avgLatency: number;
  /** Requests per second */
  requestsPerSecond: number;
}

/**
 * Performance alert
 */
export interface CacheAlert {
  /** Alert ID */
  id: string;
  /** Alert type */
  type: 'warning' | 'critical';
  /** Alert category */
  category:
    | 'memory_pressure'
    | 'low_hit_ratio'
    | 'high_latency'
    | 'storage_full'
    | 'error';
  /** Alert message */
  message: string;
  /** Timestamp */
  timestamp: number;
  /** Additional data */
  data?: Record<string, unknown>;
}

/**
 * Monitor configuration
 */
export interface CacheMonitorConfig {
  /** Sampling interval in ms */
  sampleInterval: number;
  /** Maximum samples to keep */
  maxSamples: number;
  /** Enable alerting */
  enableAlerts: boolean;
  /** Memory pressure threshold (0-1) */
  memoryPressureThreshold: number;
  /** Low hit ratio threshold (0-1) */
  lowHitRatioThreshold: number;
  /** High latency threshold in ms */
  highLatencyThreshold: number;
  /** Alert callback */
  onAlert?: (alert: CacheAlert) => void;
}

/**
 * Diagnostic snapshot
 */
export interface DiagnosticSnapshot {
  /** Snapshot timestamp */
  timestamp: number;
  /** Current stats */
  stats: TieredCacheStats;
  /** Recent samples */
  samples: MetricSample[];
  /** Active alerts */
  alerts: CacheAlert[];
  /** Configuration */
  config: CacheMonitorConfig;
  /** Health status */
  health: 'healthy' | 'degraded' | 'critical';
  /** Health details */
  healthDetails: string[];
}

/**
 * Default monitor configuration
 */
export const DEFAULT_MONITOR_CONFIG: CacheMonitorConfig = {
  sampleInterval: 5000, // 5 seconds
  maxSamples: 100,
  enableAlerts: true,
  memoryPressureThreshold: 0.9, // 90% full
  lowHitRatioThreshold: 0.5, // 50% hit ratio
  highLatencyThreshold: 100, // 100ms
};

// ============================================================================
// Cache Monitor
// ============================================================================

export class CacheMonitor {
  private cache: TieredCache;
  private config: CacheMonitorConfig;
  private samples: MetricSample[] = [];
  private alerts: CacheAlert[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastSampleTime: number = 0;
  private requestCount: number = 0;
  private totalLatency: number = 0;
  private alertIdCounter: number = 0;

  constructor(cache: TieredCache, config: Partial<CacheMonitorConfig> = {}) {
    this.cache = cache;
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...config };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start monitoring
   */
  start(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(async () => {
      await this.collectSample();
    }, this.config.sampleInterval);

    // Collect initial sample
    this.collectSample();
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Check if monitoring is active
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }

  // ==========================================================================
  // Sample Collection
  // ==========================================================================

  /**
   * Collect a performance sample
   */
  private async collectSample(): Promise<void> {
    const now = Date.now();
    const stats = await this.cache.getStats();

    // Calculate request rate
    const timeDelta = now - this.lastSampleTime;
    const requestsPerSecond =
      this.lastSampleTime > 0 ? (this.requestCount / timeDelta) * 1000 : 0;

    // Calculate average latency
    const avgLatency =
      this.requestCount > 0 ? this.totalLatency / this.requestCount : 0;

    // Calculate hit ratios
    const totalHits =
      stats.combined.hitsByTier.L1 + stats.combined.hitsByTier.L2;
    const totalRequests =
      totalHits + stats.combined.hitsByTier.L3;
    const l1HitRatio =
      totalRequests > 0 ? stats.combined.hitsByTier.L1 / totalRequests : 0;
    const l2HitRatio =
      totalRequests > 0 ? stats.combined.hitsByTier.L2 / totalRequests : 0;

    const sample: MetricSample = {
      timestamp: now,
      l1Size: stats.l1.sizeBytes,
      l2Size: stats.l2?.sizeBytes || 0,
      l1HitRatio,
      l2HitRatio,
      avgLatency,
      requestsPerSecond,
    };

    // Add to samples
    this.samples.push(sample);
    if (this.samples.length > this.config.maxSamples) {
      this.samples.shift();
    }

    // Reset counters
    this.lastSampleTime = now;
    this.requestCount = 0;
    this.totalLatency = 0;

    // Check for alerts
    if (this.config.enableAlerts) {
      await this.checkAlerts(stats, sample);
    }
  }

  /**
   * Record a request for metrics
   */
  recordRequest(latencyMs: number): void {
    this.requestCount++;
    this.totalLatency += latencyMs;
  }

  // ==========================================================================
  // Alerting
  // ==========================================================================

  /**
   * Check for alert conditions
   */
  private async checkAlerts(
    stats: TieredCacheStats,
    sample: MetricSample
  ): Promise<void> {
    // Check memory pressure on L1
    const l1Usage = stats.l1.sizeBytes / stats.l1.maxSizeBytes;
    if (l1Usage > this.config.memoryPressureThreshold) {
      this.raiseAlert({
        type: l1Usage > 0.95 ? 'critical' : 'warning',
        category: 'memory_pressure',
        message: `L1 cache at ${(l1Usage * 100).toFixed(1)}% capacity`,
        data: { usage: l1Usage, sizeBytes: stats.l1.sizeBytes },
      });
    }

    // Check memory pressure on L2
    if (stats.l2) {
      const l2Usage = stats.l2.sizeBytes / stats.l2.maxSizeBytes;
      if (l2Usage > this.config.memoryPressureThreshold) {
        this.raiseAlert({
          type: l2Usage > 0.95 ? 'critical' : 'warning',
          category: 'storage_full',
          message: `L2 cache at ${(l2Usage * 100).toFixed(1)}% capacity`,
          data: { usage: l2Usage, sizeBytes: stats.l2.sizeBytes },
        });
      }
    }

    // Check hit ratio
    const combinedHitRatio = sample.l1HitRatio + sample.l2HitRatio;
    if (
      combinedHitRatio < this.config.lowHitRatioThreshold &&
      this.samples.length > 5
    ) {
      this.raiseAlert({
        type: combinedHitRatio < 0.25 ? 'critical' : 'warning',
        category: 'low_hit_ratio',
        message: `Cache hit ratio at ${(combinedHitRatio * 100).toFixed(1)}%`,
        data: {
          l1HitRatio: sample.l1HitRatio,
          l2HitRatio: sample.l2HitRatio,
        },
      });
    }

    // Check latency
    if (sample.avgLatency > this.config.highLatencyThreshold) {
      this.raiseAlert({
        type: sample.avgLatency > this.config.highLatencyThreshold * 2 ? 'critical' : 'warning',
        category: 'high_latency',
        message: `Average latency at ${sample.avgLatency.toFixed(1)}ms`,
        data: { avgLatency: sample.avgLatency },
      });
    }
  }

  /**
   * Raise an alert
   */
  private raiseAlert(
    alertData: Omit<CacheAlert, 'id' | 'timestamp'>
  ): void {
    // Check if similar alert already exists recently
    const recentAlerts = this.alerts.filter(
      (a) =>
        a.category === alertData.category &&
        Date.now() - a.timestamp < this.config.sampleInterval * 2
    );

    if (recentAlerts.length > 0) {
      return; // Debounce similar alerts
    }

    const alert: CacheAlert = {
      ...alertData,
      id: `alert-${++this.alertIdCounter}`,
      timestamp: Date.now(),
    };

    this.alerts.push(alert);

    // Keep only recent alerts
    const cutoff = Date.now() - this.config.sampleInterval * this.config.maxSamples;
    this.alerts = this.alerts.filter((a) => a.timestamp > cutoff);

    // Notify callback
    if (this.config.onAlert) {
      this.config.onAlert(alert);
    }
  }

  /**
   * Get active alerts
   */
  getAlerts(): CacheAlert[] {
    return [...this.alerts];
  }

  /**
   * Clear alerts
   */
  clearAlerts(): void {
    this.alerts = [];
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get recent samples
   */
  getSamples(): MetricSample[] {
    return [...this.samples];
  }

  /**
   * Get latest sample
   */
  getLatestSample(): MetricSample | null {
    return this.samples.length > 0
      ? this.samples[this.samples.length - 1]
      : null;
  }

  /**
   * Get average metrics over recent samples
   */
  getAverageMetrics(sampleCount: number = 10): MetricSample | null {
    const recent = this.samples.slice(-sampleCount);
    if (recent.length === 0) return null;

    const sum = recent.reduce(
      (acc, sample) => ({
        timestamp: Date.now(),
        l1Size: acc.l1Size + sample.l1Size,
        l2Size: acc.l2Size + sample.l2Size,
        l1HitRatio: acc.l1HitRatio + sample.l1HitRatio,
        l2HitRatio: acc.l2HitRatio + sample.l2HitRatio,
        avgLatency: acc.avgLatency + sample.avgLatency,
        requestsPerSecond: acc.requestsPerSecond + sample.requestsPerSecond,
      }),
      {
        timestamp: 0,
        l1Size: 0,
        l2Size: 0,
        l1HitRatio: 0,
        l2HitRatio: 0,
        avgLatency: 0,
        requestsPerSecond: 0,
      }
    );

    const count = recent.length;
    return {
      timestamp: Date.now(),
      l1Size: sum.l1Size / count,
      l2Size: sum.l2Size / count,
      l1HitRatio: sum.l1HitRatio / count,
      l2HitRatio: sum.l2HitRatio / count,
      avgLatency: sum.avgLatency / count,
      requestsPerSecond: sum.requestsPerSecond / count,
    };
  }

  // ==========================================================================
  // Diagnostics
  // ==========================================================================

  /**
   * Create a diagnostic snapshot
   */
  async createSnapshot(): Promise<DiagnosticSnapshot> {
    const stats = await this.cache.getStats();
    const samples = this.getSamples();
    const alerts = this.getAlerts();

    // Determine health status
    const healthDetails: string[] = [];
    let health: 'healthy' | 'degraded' | 'critical' = 'healthy';

    // Check for critical alerts
    const criticalAlerts = alerts.filter((a) => a.type === 'critical');
    if (criticalAlerts.length > 0) {
      health = 'critical';
      healthDetails.push(`${criticalAlerts.length} critical alert(s)`);
    } else if (alerts.length > 0) {
      health = 'degraded';
      healthDetails.push(`${alerts.length} warning alert(s)`);
    }

    // Check cache efficiency
    const avgMetrics = this.getAverageMetrics();
    if (avgMetrics) {
      const totalHitRatio = avgMetrics.l1HitRatio + avgMetrics.l2HitRatio;
      if (totalHitRatio < 0.5 && samples.length > 5) {
        if (health === 'healthy') health = 'degraded';
        healthDetails.push(`Low hit ratio: ${(totalHitRatio * 100).toFixed(1)}%`);
      }
    }

    // Check capacity
    const l1Usage = stats.l1.sizeBytes / stats.l1.maxSizeBytes;
    if (l1Usage > 0.95) {
      if (health === 'healthy') health = 'degraded';
      healthDetails.push(`L1 near capacity: ${(l1Usage * 100).toFixed(1)}%`);
    }

    if (healthDetails.length === 0) {
      healthDetails.push('All systems operational');
    }

    return {
      timestamp: Date.now(),
      stats,
      samples,
      alerts,
      config: this.config,
      health,
      healthDetails,
    };
  }

  /**
   * Export metrics as JSON
   */
  async exportMetrics(): Promise<string> {
    const snapshot = await this.createSnapshot();
    return JSON.stringify(snapshot, null, 2);
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Format bytes for display
   */
  static formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  /**
   * Format duration for display
   */
  static formatDuration(ms: number): string {
    if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  /**
   * Get a summary string
   */
  async getSummary(): Promise<string> {
    const stats = await this.cache.getStats();
    const avgMetrics = this.getAverageMetrics();

    const lines = [
      '=== Cache Monitor Summary ===',
      `L1: ${CacheMonitor.formatBytes(stats.l1.sizeBytes)} / ${CacheMonitor.formatBytes(stats.l1.maxSizeBytes)} (${stats.l1.entries} entries)`,
    ];

    if (stats.l2) {
      lines.push(
        `L2: ${CacheMonitor.formatBytes(stats.l2.sizeBytes)} / ${CacheMonitor.formatBytes(stats.l2.maxSizeBytes)} (${stats.l2.entries} entries)`
      );
    }

    if (avgMetrics) {
      const hitRatio = (avgMetrics.l1HitRatio + avgMetrics.l2HitRatio) * 100;
      lines.push(
        `Hit Ratio: ${hitRatio.toFixed(1)}% (L1: ${(avgMetrics.l1HitRatio * 100).toFixed(1)}%, L2: ${(avgMetrics.l2HitRatio * 100).toFixed(1)}%)`
      );
      lines.push(`Avg Latency: ${CacheMonitor.formatDuration(avgMetrics.avgLatency)}`);
      lines.push(`Requests/s: ${avgMetrics.requestsPerSecond.toFixed(1)}`);
    }

    if (this.alerts.length > 0) {
      lines.push(`Alerts: ${this.alerts.length}`);
    }

    return lines.join('\n');
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a cache monitor
 */
export function createCacheMonitor(
  cache: TieredCache,
  config?: Partial<CacheMonitorConfig>
): CacheMonitor {
  return new CacheMonitor(cache, config);
}
