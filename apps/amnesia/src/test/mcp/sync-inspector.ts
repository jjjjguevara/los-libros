/**
 * Sync Inspector
 *
 * Live sync state inspection utilities for testing and debugging.
 * Works with Obsidian DevTools MCP to provide real-time sync monitoring.
 */

import type { SyncState, ConsoleLogEntry, ReaderState } from './devtools-helpers';

// ============================================================================
// Types
// ============================================================================

/**
 * Sync inspection result
 */
export interface SyncInspection {
  timestamp: Date;
  syncState: SyncState | null;
  readerState: ReaderState | null;
  recentLogs: ConsoleLogEntry[];
  errors: string[];
}

/**
 * Sync timeline event
 */
export interface SyncTimelineEvent {
  timestamp: number;
  type: 'start' | 'progress' | 'complete' | 'error' | 'cancel';
  data?: unknown;
}

/**
 * Sync metrics
 */
export interface SyncMetrics {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  averageDuration: number;
  totalBooksProcessed: number;
  lastSyncTime?: Date;
}

// ============================================================================
// Sync Inspector Class
// ============================================================================

/**
 * Inspector for monitoring sync operations
 */
export class SyncInspector {
  private timeline: SyncTimelineEvent[] = [];
  private metrics: SyncMetrics = {
    totalSyncs: 0,
    successfulSyncs: 0,
    failedSyncs: 0,
    averageDuration: 0,
    totalBooksProcessed: 0,
  };
  private currentSyncStart?: number;

  /**
   * Record sync start
   */
  recordSyncStart(): void {
    this.currentSyncStart = Date.now();
    this.timeline.push({
      timestamp: this.currentSyncStart,
      type: 'start',
    });
    this.metrics.totalSyncs++;
  }

  /**
   * Record sync progress
   */
  recordProgress(progress: number, data?: unknown): void {
    this.timeline.push({
      timestamp: Date.now(),
      type: 'progress',
      data: { progress, ...((data as object) || {}) },
    });
  }

  /**
   * Record sync completion
   */
  recordComplete(booksProcessed: number): void {
    const endTime = Date.now();
    const duration = this.currentSyncStart
      ? endTime - this.currentSyncStart
      : 0;

    this.timeline.push({
      timestamp: endTime,
      type: 'complete',
      data: { booksProcessed, duration },
    });

    this.metrics.successfulSyncs++;
    this.metrics.totalBooksProcessed += booksProcessed;
    this.metrics.lastSyncTime = new Date(endTime);

    // Update average duration
    const totalDuration =
      this.metrics.averageDuration * (this.metrics.successfulSyncs - 1) +
      duration;
    this.metrics.averageDuration = totalDuration / this.metrics.successfulSyncs;

    this.currentSyncStart = undefined;
  }

  /**
   * Record sync error
   */
  recordError(error: string): void {
    this.timeline.push({
      timestamp: Date.now(),
      type: 'error',
      data: { error },
    });
    this.metrics.failedSyncs++;
    this.currentSyncStart = undefined;
  }

  /**
   * Record sync cancellation
   */
  recordCancel(): void {
    this.timeline.push({
      timestamp: Date.now(),
      type: 'cancel',
    });
    this.currentSyncStart = undefined;
  }

  /**
   * Get timeline events
   */
  getTimeline(): SyncTimelineEvent[] {
    return [...this.timeline];
  }

  /**
   * Get timeline events since timestamp
   */
  getTimelineSince(since: number): SyncTimelineEvent[] {
    return this.timeline.filter((e) => e.timestamp >= since);
  }

  /**
   * Get current metrics
   */
  getMetrics(): SyncMetrics {
    return { ...this.metrics };
  }

  /**
   * Get sync success rate
   */
  getSuccessRate(): number {
    if (this.metrics.totalSyncs === 0) return 0;
    return this.metrics.successfulSyncs / this.metrics.totalSyncs;
  }

  /**
   * Check if sync is currently in progress
   */
  isInProgress(): boolean {
    return this.currentSyncStart !== undefined;
  }

  /**
   * Get current sync duration (if in progress)
   */
  getCurrentDuration(): number | null {
    if (!this.currentSyncStart) return null;
    return Date.now() - this.currentSyncStart;
  }

  /**
   * Clear all recorded data
   */
  clear(): void {
    this.timeline = [];
    this.metrics = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      averageDuration: 0,
      totalBooksProcessed: 0,
    };
    this.currentSyncStart = undefined;
  }

  /**
   * Generate summary report
   */
  generateReport(): string {
    const lines = [
      '=== Sync Inspector Report ===',
      '',
      'Metrics:',
      `  Total Syncs: ${this.metrics.totalSyncs}`,
      `  Successful: ${this.metrics.successfulSyncs}`,
      `  Failed: ${this.metrics.failedSyncs}`,
      `  Success Rate: ${(this.getSuccessRate() * 100).toFixed(1)}%`,
      `  Avg Duration: ${this.metrics.averageDuration.toFixed(0)}ms`,
      `  Books Processed: ${this.metrics.totalBooksProcessed}`,
      '',
    ];

    if (this.metrics.lastSyncTime) {
      lines.push(`Last Sync: ${this.metrics.lastSyncTime.toISOString()}`);
    }

    if (this.timeline.length > 0) {
      lines.push('', 'Recent Timeline:');
      const recent = this.timeline.slice(-10);
      for (const event of recent) {
        const time = new Date(event.timestamp).toISOString();
        lines.push(`  [${time}] ${event.type}`);
      }
    }

    return lines.join('\n');
  }
}

// ============================================================================
// Console Log Analyzer
// ============================================================================

/**
 * Analyze console logs for sync patterns
 */
export class ConsoleLogAnalyzer {
  private logs: ConsoleLogEntry[] = [];

  /**
   * Add logs for analysis
   */
  addLogs(logs: ConsoleLogEntry[]): void {
    this.logs.push(...logs);
  }

  /**
   * Clear stored logs
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * Find errors related to sync
   */
  findSyncErrors(): ConsoleLogEntry[] {
    return this.logs.filter(
      (log) =>
        log.level === 'error' &&
        /sync|calibre|upload|download/i.test(log.message)
    );
  }

  /**
   * Find warnings
   */
  findWarnings(): ConsoleLogEntry[] {
    return this.logs.filter((log) => log.level === 'warn');
  }

  /**
   * Extract book IDs mentioned in logs
   */
  extractBookIds(): string[] {
    const bookIdPattern = /book[_-]?id[:\s]+([a-zA-Z0-9-]+)/gi;
    const ids = new Set<string>();

    for (const log of this.logs) {
      let match;
      while ((match = bookIdPattern.exec(log.message)) !== null) {
        ids.add(match[1]);
      }
    }

    return Array.from(ids);
  }

  /**
   * Count log levels
   */
  countByLevel(): Record<string, number> {
    const counts: Record<string, number> = {
      log: 0,
      warn: 0,
      error: 0,
      info: 0,
      debug: 0,
    };

    for (const log of this.logs) {
      counts[log.level] = (counts[log.level] || 0) + 1;
    }

    return counts;
  }

  /**
   * Get logs in time range
   */
  getLogsInRange(startMs: number, endMs: number): ConsoleLogEntry[] {
    return this.logs.filter(
      (log) => log.timestamp >= startMs && log.timestamp <= endMs
    );
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new sync inspector
 */
export function createSyncInspector(): SyncInspector {
  return new SyncInspector();
}

/**
 * Create a new console log analyzer
 */
export function createConsoleLogAnalyzer(): ConsoleLogAnalyzer {
  return new ConsoleLogAnalyzer();
}
