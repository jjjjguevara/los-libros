/**
 * Sync Telemetry Service
 *
 * Tracks performance metrics for Doc Doctor synchronization:
 * - Success/failure rates
 * - Average latency
 * - Conflict frequency
 * - Queue depth over time
 *
 * @module integrations/sync-telemetry
 */

import type { SyncResult, BatchSyncResult, SyncEventMap } from './sync-manager';

/**
 * Time-windowed metric for rate calculations
 */
interface WindowedMetric {
  /** Timestamp of the metric */
  timestamp: number;
  /** Value of the metric */
  value: number;
}

/**
 * Telemetry snapshot for a specific time period
 */
export interface TelemetrySnapshot {
  /** Time period start */
  periodStart: Date;
  /** Time period end */
  periodEnd: Date;
  /** Total sync attempts */
  totalAttempts: number;
  /** Successful syncs */
  successCount: number;
  /** Failed syncs */
  failureCount: number;
  /** Skipped syncs */
  skippedCount: number;
  /** Conflict count */
  conflictCount: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** P95 latency in ms */
  p95LatencyMs: number;
  /** Max latency in ms */
  maxLatencyMs: number;
  /** Average queue depth */
  avgQueueDepth: number;
  /** Peak queue depth */
  peakQueueDepth: number;
}

/**
 * Real-time telemetry metrics
 */
export interface RealtimeMetrics {
  /** Current queue depth */
  currentQueueDepth: number;
  /** Syncs in the last minute */
  lastMinuteCount: number;
  /** Success rate in the last minute */
  lastMinuteSuccessRate: number;
  /** Average latency in the last minute */
  lastMinuteAvgLatency: number;
  /** Is sync currently active */
  isSyncing: boolean;
  /** Current batch progress (if batch sync active) */
  batchProgress?: {
    current: number;
    total: number;
    percent: number;
  };
}

/**
 * Telemetry event for external consumption
 */
export interface TelemetryEvent {
  type: 'sync' | 'batch' | 'conflict' | 'error';
  timestamp: Date;
  duration?: number;
  details: Record<string, unknown>;
}

/**
 * Sync Telemetry Service
 *
 * Collects and aggregates sync performance metrics for monitoring
 * and debugging Doc Doctor integration.
 */
export class SyncTelemetry {
  // Sliding window for metrics (keep last 5 minutes)
  private readonly WINDOW_SIZE_MS = 5 * 60 * 1000;
  private readonly MAX_EVENTS = 1000;
  private readonly MAX_LISTENERS = 50;

  // Metric storage
  private latencies: WindowedMetric[] = [];
  private successes: WindowedMetric[] = [];
  private failures: WindowedMetric[] = [];
  private conflicts: WindowedMetric[] = [];
  private skipped: WindowedMetric[] = [];
  private queueDepths: WindowedMetric[] = [];

  // Cumulative counters (all-time)
  private totalSyncAttempts = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private totalConflicts = 0;
  private totalSkipped = 0;

  // Current state
  private currentQueueDepth = 0;
  private isSyncing = false;
  private batchProgress?: { current: number; total: number };

  // Event log for debugging
  private events: TelemetryEvent[] = [];

  // Listeners
  private listeners = new Set<(event: TelemetryEvent) => void>();

  /**
   * Record a sync operation result
   */
  recordSync(result: SyncResult, durationMs: number): void {
    const now = Date.now();
    this.totalSyncAttempts++;

    // Record latency
    this.latencies.push({ timestamp: now, value: durationMs });

    // Record outcome
    switch (result.status) {
      case 'synced':
        this.totalSuccesses++;
        this.successes.push({ timestamp: now, value: 1 });
        break;
      case 'error':
        this.totalFailures++;
        this.failures.push({ timestamp: now, value: 1 });
        break;
      case 'conflict':
        this.totalConflicts++;
        this.conflicts.push({ timestamp: now, value: 1 });
        break;
      case 'skipped':
      case 'already-synced':
        this.totalSkipped++;
        this.skipped.push({ timestamp: now, value: 1 });
        break;
    }

    // Log event
    this.logEvent({
      type: result.status === 'error' ? 'error' : 'sync',
      timestamp: new Date(now),
      duration: durationMs,
      details: {
        highlightId: result.highlightId,
        stubId: result.stubId,
        status: result.status,
        error: result.error,
      },
    });

    // Prune old data
    this.pruneOldData();
  }

  /**
   * Record a batch sync result
   */
  recordBatch(result: BatchSyncResult): void {
    const now = Date.now();

    this.logEvent({
      type: 'batch',
      timestamp: new Date(now),
      duration: result.duration,
      details: {
        total: result.total,
        synced: result.synced,
        errors: result.errors,
        conflicts: result.conflicts,
        skipped: result.skipped,
        alreadySynced: result.alreadySynced,
        throughput: result.total / (result.duration / 1000),
      },
    });
  }

  /**
   * Record a conflict occurrence
   */
  recordConflict(highlightId: string, stubId: string): void {
    const now = Date.now();
    this.conflicts.push({ timestamp: now, value: 1 });

    this.logEvent({
      type: 'conflict',
      timestamp: new Date(now),
      details: { highlightId, stubId },
    });
  }

  /**
   * Update queue depth
   */
  updateQueueDepth(depth: number): void {
    const now = Date.now();
    this.currentQueueDepth = depth;
    this.queueDepths.push({ timestamp: now, value: depth });
  }

  /**
   * Set sync active state
   */
  setSyncing(active: boolean, batchProgress?: { current: number; total: number }): void {
    this.isSyncing = active;
    this.batchProgress = batchProgress;
  }

  /**
   * Get real-time metrics
   */
  getRealtimeMetrics(): RealtimeMetrics {
    const oneMinuteAgo = Date.now() - 60 * 1000;

    const lastMinuteLatencies = this.latencies.filter(m => m.timestamp > oneMinuteAgo);
    const lastMinuteSuccesses = this.successes.filter(m => m.timestamp > oneMinuteAgo);
    const lastMinuteFailures = this.failures.filter(m => m.timestamp > oneMinuteAgo);

    const lastMinuteCount = lastMinuteLatencies.length;
    const lastMinuteSuccessCount = lastMinuteSuccesses.length;
    const lastMinuteSuccessRate = lastMinuteCount > 0
      ? lastMinuteSuccessCount / lastMinuteCount
      : 1;

    const lastMinuteAvgLatency = lastMinuteLatencies.length > 0
      ? lastMinuteLatencies.reduce((sum, m) => sum + m.value, 0) / lastMinuteLatencies.length
      : 0;

    return {
      currentQueueDepth: this.currentQueueDepth,
      lastMinuteCount,
      lastMinuteSuccessRate,
      lastMinuteAvgLatency,
      isSyncing: this.isSyncing,
      batchProgress: this.batchProgress ? {
        ...this.batchProgress,
        percent: (this.batchProgress.current / this.batchProgress.total) * 100,
      } : undefined,
    };
  }

  /**
   * Get telemetry snapshot for a time period
   */
  getSnapshot(periodMs: number = this.WINDOW_SIZE_MS): TelemetrySnapshot {
    const now = Date.now();
    const cutoff = now - periodMs;

    const periodLatencies = this.latencies.filter(m => m.timestamp > cutoff);
    const periodSuccesses = this.successes.filter(m => m.timestamp > cutoff);
    const periodFailures = this.failures.filter(m => m.timestamp > cutoff);
    const periodConflicts = this.conflicts.filter(m => m.timestamp > cutoff);
    const periodSkipped = this.skipped.filter(m => m.timestamp > cutoff);
    const periodQueueDepths = this.queueDepths.filter(m => m.timestamp > cutoff);

    const totalAttempts = periodLatencies.length;
    const successCount = periodSuccesses.length;
    const failureCount = periodFailures.length;
    const conflictCount = periodConflicts.length;
    const skippedCount = periodSkipped.length;

    // Calculate latency stats
    const latencyValues = periodLatencies.map(m => m.value).sort((a, b) => a - b);
    const avgLatencyMs = latencyValues.length > 0
      ? latencyValues.reduce((sum, v) => sum + v, 0) / latencyValues.length
      : 0;
    const p95Index = Math.floor(latencyValues.length * 0.95);
    const p95LatencyMs = latencyValues[p95Index] ?? 0;
    const maxLatencyMs = latencyValues[latencyValues.length - 1] ?? 0;

    // Calculate queue depth stats
    const queueValues = periodQueueDepths.map(m => m.value);
    const avgQueueDepth = queueValues.length > 0
      ? queueValues.reduce((sum, v) => sum + v, 0) / queueValues.length
      : 0;
    const peakQueueDepth = Math.max(...queueValues, 0);

    return {
      periodStart: new Date(cutoff),
      periodEnd: new Date(now),
      totalAttempts,
      successCount,
      failureCount,
      skippedCount,
      conflictCount,
      successRate: totalAttempts > 0 ? successCount / totalAttempts : 1,
      avgLatencyMs,
      p95LatencyMs,
      maxLatencyMs,
      avgQueueDepth,
      peakQueueDepth,
    };
  }

  /**
   * Get all-time cumulative stats
   */
  getCumulativeStats(): {
    totalAttempts: number;
    successRate: number;
    conflictRate: number;
    totalSuccesses: number;
    totalFailures: number;
    totalConflicts: number;
    totalSkipped: number;
  } {
    return {
      totalAttempts: this.totalSyncAttempts,
      successRate: this.totalSyncAttempts > 0
        ? this.totalSuccesses / this.totalSyncAttempts
        : 1,
      conflictRate: this.totalSyncAttempts > 0
        ? this.totalConflicts / this.totalSyncAttempts
        : 0,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      totalConflicts: this.totalConflicts,
      totalSkipped: this.totalSkipped,
    };
  }

  /**
   * Get recent events for debugging
   */
  getRecentEvents(limit: number = 50): TelemetryEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * Subscribe to telemetry events
   */
  subscribe(handler: (event: TelemetryEvent) => void): { dispose: () => void } {
    if (this.listeners.size >= this.MAX_LISTENERS) {
      console.warn('[SyncTelemetry] Max listeners reached, ignoring new subscription');
      return { dispose: () => {} };
    }

    this.listeners.add(handler);
    return {
      dispose: () => this.listeners.delete(handler),
    };
  }

  /**
   * Export telemetry data for debugging
   */
  export(): {
    snapshot: TelemetrySnapshot;
    cumulative: ReturnType<SyncTelemetry['getCumulativeStats']>;
    realtime: RealtimeMetrics;
    recentEvents: TelemetryEvent[];
  } {
    return {
      snapshot: this.getSnapshot(),
      cumulative: this.getCumulativeStats(),
      realtime: this.getRealtimeMetrics(),
      recentEvents: this.getRecentEvents(100),
    };
  }

  /**
   * Reset all telemetry data
   */
  reset(): void {
    this.latencies = [];
    this.successes = [];
    this.failures = [];
    this.conflicts = [];
    this.skipped = [];
    this.queueDepths = [];
    this.totalSyncAttempts = 0;
    this.totalSuccesses = 0;
    this.totalFailures = 0;
    this.totalConflicts = 0;
    this.totalSkipped = 0;
    this.events = [];
  }

  /**
   * Log a telemetry event
   */
  private logEvent(event: TelemetryEvent): void {
    this.events.push(event);

    // Trim events if too many
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(-this.MAX_EVENTS);
    }

    // Notify listeners
    this.listeners.forEach(handler => handler(event));
  }

  /**
   * Remove data older than the window size
   */
  private pruneOldData(): void {
    const cutoff = Date.now() - this.WINDOW_SIZE_MS;

    this.latencies = this.latencies.filter(m => m.timestamp > cutoff);
    this.successes = this.successes.filter(m => m.timestamp > cutoff);
    this.failures = this.failures.filter(m => m.timestamp > cutoff);
    this.conflicts = this.conflicts.filter(m => m.timestamp > cutoff);
    this.skipped = this.skipped.filter(m => m.timestamp > cutoff);
    this.queueDepths = this.queueDepths.filter(m => m.timestamp > cutoff);
  }
}

/**
 * Create a telemetry instance that auto-connects to sync manager events
 */
export function createSyncTelemetry(): SyncTelemetry {
  return new SyncTelemetry();
}

/**
 * Connect telemetry to sync manager event stream
 */
export function connectTelemetryToSyncManager(
  telemetry: SyncTelemetry,
  on: <K extends keyof SyncEventMap>(
    event: K,
    handler: (data: SyncEventMap[K]) => void
  ) => { dispose: () => void }
): { dispose: () => void } {
  const disposables: { dispose: () => void }[] = [];

  // Track sync timing with timeout cleanup to prevent memory leaks
  const syncStartTimes = new Map<string, number>();
  const SYNC_TIMEOUT_MS = 60000; // 1 minute timeout for stale entries

  disposables.push(
    on('sync-started', ({ highlightId }) => {
      syncStartTimes.set(highlightId, performance.now());

      // Cleanup stale entries after timeout
      setTimeout(() => {
        if (syncStartTimes.has(highlightId)) {
          console.warn('[SyncTelemetry] Sync timeout for:', highlightId);
          syncStartTimes.delete(highlightId);
        }
      }, SYNC_TIMEOUT_MS);
    })
  );

  disposables.push(
    on('sync-completed', ({ result }) => {
      const startTime = syncStartTimes.get(result.highlightId);
      const duration = startTime ? performance.now() - startTime : 0;
      syncStartTimes.delete(result.highlightId);
      telemetry.recordSync(result, duration);
    })
  );

  disposables.push(
    on('batch-started', ({ total }) => {
      telemetry.setSyncing(true, { current: 0, total });
    })
  );

  disposables.push(
    on('batch-progress', ({ current, total }) => {
      telemetry.setSyncing(true, { current, total });
    })
  );

  disposables.push(
    on('batch-completed', ({ result }) => {
      telemetry.setSyncing(false);
      telemetry.recordBatch(result);
    })
  );

  disposables.push(
    on('conflict-detected', ({ highlightId, stubId }) => {
      telemetry.recordConflict(highlightId, stubId);
    })
  );

  return {
    dispose: () => disposables.forEach(d => d.dispose()),
  };
}
