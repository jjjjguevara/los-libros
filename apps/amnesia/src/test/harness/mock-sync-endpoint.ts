/**
 * Mock Sync Endpoint
 *
 * Simulates the sync API endpoints for testing synchronization operations.
 * Supports change detection, batch operations, and manifest generation.
 *
 * @see docs/plans/unified-sync-architecture-prd.md
 */

import type {
  SyncChange,
  SyncManifest,
  ManifestEntry,
  BatchOperation,
  BatchOperationResult,
  SyncAdapterType,
} from '../../sync/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Sync endpoint configuration
 */
export interface MockSyncConfig {
  /** Simulate network latency (min ms) */
  latencyMin: number;
  /** Simulate network latency (max ms) */
  latencyMax: number;
  /** Random failure rate (0-1) */
  failureRate: number;
  /** Enable change tracking */
  trackChanges: boolean;
  /** Maximum batch size */
  maxBatchSize: number;
}

/**
 * Default configuration
 */
export const DEFAULT_SYNC_CONFIG: MockSyncConfig = {
  latencyMin: 10,
  latencyMax: 50,
  failureRate: 0,
  trackChanges: true,
  maxBatchSize: 100,
};

/**
 * Stored entity for sync
 */
export interface SyncEntity {
  id: string;
  type: SyncChange['entityType'];
  data: unknown;
  hash: string;
  lastModified: Date;
  version: number;
}

/**
 * Recorded sync operation
 */
export interface RecordedSyncOp {
  timestamp: Date;
  operation: 'getChanges' | 'push' | 'batch' | 'getManifest';
  success: boolean;
  error?: string;
  request?: unknown;
  response?: unknown;
}

// ============================================================================
// Mock Sync Endpoint
// ============================================================================

/**
 * Mock sync endpoint for testing
 */
export class MockSyncEndpoint {
  private config: MockSyncConfig;
  private entities = new Map<string, SyncEntity>();
  private changes: SyncChange[] = [];
  private recordedOps: RecordedSyncOp[] = [];
  private lastSyncTimestamp = new Date(0);

  constructor(config: Partial<MockSyncConfig> = {}) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Update configuration
   */
  setConfig(config: Partial<MockSyncConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set failure rate
   */
  setFailureRate(rate: number): void {
    this.config.failureRate = Math.max(0, Math.min(1, rate));
  }

  /**
   * Reset to defaults
   */
  reset(): void {
    this.config = { ...DEFAULT_SYNC_CONFIG };
    this.entities.clear();
    this.changes = [];
    this.recordedOps = [];
    this.lastSyncTimestamp = new Date(0);
  }

  // ==========================================================================
  // Sync API Endpoints
  // ==========================================================================

  /**
   * GET /api/v1/sync/changes
   *
   * Get changes since a given timestamp
   */
  async getChanges(since?: Date): Promise<{
    changes: SyncChange[];
    serverTime: Date;
    hasMore: boolean;
  }> {
    await this.simulateLatency();

    const recordEntry: RecordedSyncOp = {
      timestamp: new Date(),
      operation: 'getChanges',
      success: false,
      request: { since },
    };

    try {
      if (this.shouldFail()) {
        throw new Error('Simulated getChanges failure');
      }

      const sinceTime = since || new Date(0);
      const filteredChanges = this.changes.filter(
        (c) => c.timestamp > sinceTime
      );

      // Sort by timestamp
      filteredChanges.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      const response = {
        changes: filteredChanges,
        serverTime: new Date(),
        hasMore: false, // Simplified - no pagination
      };

      recordEntry.success = true;
      recordEntry.response = response;
      this.recordedOps.push(recordEntry);

      return response;
    } catch (error) {
      recordEntry.error = error instanceof Error ? error.message : String(error);
      this.recordedOps.push(recordEntry);
      throw error;
    }
  }

  /**
   * POST /api/v1/sync/push
   *
   * Push local changes to server
   */
  async pushChanges(changes: SyncChange[]): Promise<{
    accepted: string[];
    rejected: Array<{ id: string; reason: string }>;
    conflicts: Array<{ id: string; serverVersion: unknown }>;
  }> {
    await this.simulateLatency();

    const recordEntry: RecordedSyncOp = {
      timestamp: new Date(),
      operation: 'push',
      success: false,
      request: { changeCount: changes.length },
    };

    try {
      if (this.shouldFail()) {
        throw new Error('Simulated push failure');
      }

      const accepted: string[] = [];
      const rejected: Array<{ id: string; reason: string }> = [];
      const conflicts: Array<{ id: string; serverVersion: unknown }> = [];

      for (const change of changes) {
        const existing = this.entities.get(change.entityId);

        // Check for conflicts
        if (existing && change.operation === 'update') {
          const existingTime = existing.lastModified.getTime();
          const changeTime = change.timestamp.getTime();

          if (existingTime > changeTime) {
            conflicts.push({
              id: change.id,
              serverVersion: existing.data,
            });
            continue;
          }
        }

        // Apply change
        try {
          this.applyChange(change);
          accepted.push(change.id);
        } catch (err) {
          rejected.push({
            id: change.id,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const response = { accepted, rejected, conflicts };

      recordEntry.success = true;
      recordEntry.response = response;
      this.recordedOps.push(recordEntry);

      return response;
    } catch (error) {
      recordEntry.error = error instanceof Error ? error.message : String(error);
      this.recordedOps.push(recordEntry);
      throw error;
    }
  }

  /**
   * POST /api/v1/books/batch
   *
   * Execute batch operations
   */
  async batch(operations: BatchOperation[]): Promise<BatchOperationResult[]> {
    await this.simulateLatency();

    const recordEntry: RecordedSyncOp = {
      timestamp: new Date(),
      operation: 'batch',
      success: false,
      request: { operationCount: operations.length },
    };

    try {
      if (this.shouldFail()) {
        throw new Error('Simulated batch failure');
      }

      if (operations.length > this.config.maxBatchSize) {
        throw new Error(`Batch too large: ${operations.length} > ${this.config.maxBatchSize}`);
      }

      const results: BatchOperationResult[] = [];

      for (const op of operations) {
        try {
          let data: unknown;

          switch (op.op) {
            case 'get':
              const entity = this.entities.get(op.id);
              data = entity?.data || null;
              break;

            case 'create':
              this.entities.set(op.id, {
                id: op.id,
                type: op.type,
                data: op.data,
                hash: this.hashData(op.data),
                lastModified: new Date(),
                version: 1,
              });
              data = op.data;
              break;

            case 'update':
              const existing = this.entities.get(op.id);
              if (!existing) {
                throw new Error('Entity not found');
              }
              existing.data = { ...existing.data as object, ...op.data as object };
              existing.hash = this.hashData(existing.data);
              existing.lastModified = new Date();
              existing.version++;
              data = existing.data;
              break;

            case 'delete':
              this.entities.delete(op.id);
              data = { deleted: true };
              break;
          }

          results.push({ id: op.id, success: true, data });
        } catch (err) {
          results.push({
            id: op.id,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      recordEntry.success = true;
      recordEntry.response = { resultCount: results.length };
      this.recordedOps.push(recordEntry);

      return results;
    } catch (error) {
      recordEntry.error = error instanceof Error ? error.message : String(error);
      this.recordedOps.push(recordEntry);
      throw error;
    }
  }

  /**
   * GET /api/v1/sync/manifest
   *
   * Get full manifest for change detection
   */
  async getManifest(source: SyncAdapterType = 'server'): Promise<SyncManifest> {
    await this.simulateLatency();

    const recordEntry: RecordedSyncOp = {
      timestamp: new Date(),
      operation: 'getManifest',
      success: false,
      request: { source },
    };

    try {
      if (this.shouldFail()) {
        throw new Error('Simulated getManifest failure');
      }

      const entries: ManifestEntry[] = [];
      let totalSize = 0;

      for (const entity of this.entities.values()) {
        const size = JSON.stringify(entity.data).length;
        entries.push({
          id: entity.id,
          type: entity.type,
          hash: entity.hash,
          lastModified: entity.lastModified,
          size,
          metadata: { version: entity.version },
        });
        totalSize += size;
      }

      const manifest: SyncManifest = {
        version: 1,
        generatedAt: new Date(),
        source,
        entries,
        totalCount: entries.length,
        totalSize,
      };

      recordEntry.success = true;
      recordEntry.response = { entryCount: entries.length };
      this.recordedOps.push(recordEntry);

      return manifest;
    } catch (error) {
      recordEntry.error = error instanceof Error ? error.message : String(error);
      this.recordedOps.push(recordEntry);
      throw error;
    }
  }

  // ==========================================================================
  // Test Helpers
  // ==========================================================================

  /**
   * Seed entities for testing
   */
  seedEntities(entities: Array<{ id: string; type: SyncChange['entityType']; data: unknown }>): void {
    for (const entity of entities) {
      this.entities.set(entity.id, {
        id: entity.id,
        type: entity.type,
        data: entity.data,
        hash: this.hashData(entity.data),
        lastModified: new Date(),
        version: 1,
      });
    }
  }

  /**
   * Seed changes for testing
   */
  seedChanges(changes: SyncChange[]): void {
    this.changes.push(...changes);
  }

  /**
   * Create a change and add to history
   */
  createChange(
    entityType: SyncChange['entityType'],
    entityId: string,
    operation: SyncChange['operation'],
    data?: unknown
  ): SyncChange {
    const change: SyncChange = {
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      source: 'server',
      entityType,
      entityId,
      operation,
      timestamp: new Date(),
      data,
    };

    if (this.config.trackChanges) {
      this.changes.push(change);
    }

    return change;
  }

  /**
   * Get all recorded operations
   */
  getRecordedOps(): RecordedSyncOp[] {
    return [...this.recordedOps];
  }

  /**
   * Get entity by ID
   */
  getEntity(id: string): SyncEntity | undefined {
    return this.entities.get(id);
  }

  /**
   * Get all entities
   */
  getEntities(): SyncEntity[] {
    return Array.from(this.entities.values());
  }

  /**
   * Get change history
   */
  getChangeHistory(): SyncChange[] {
    return [...this.changes];
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.entities.clear();
    this.changes = [];
    this.recordedOps = [];
    this.lastSyncTimestamp = new Date(0);
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private applyChange(change: SyncChange): void {
    switch (change.operation) {
      case 'create':
        if (this.entities.has(change.entityId)) {
          throw new Error('Entity already exists');
        }
        this.entities.set(change.entityId, {
          id: change.entityId,
          type: change.entityType,
          data: change.data,
          hash: this.hashData(change.data),
          lastModified: change.timestamp,
          version: 1,
        });
        break;

      case 'update':
        const entity = this.entities.get(change.entityId);
        if (!entity) {
          throw new Error('Entity not found');
        }
        entity.data = change.data ?? entity.data;
        entity.hash = this.hashData(entity.data);
        entity.lastModified = change.timestamp;
        entity.version++;
        break;

      case 'delete':
        this.entities.delete(change.entityId);
        break;

      case 'sync':
        // Sync operation - update if exists, create if not
        const existing = this.entities.get(change.entityId);
        if (existing) {
          existing.data = change.data ?? existing.data;
          existing.hash = this.hashData(existing.data);
          existing.lastModified = change.timestamp;
          existing.version++;
        } else {
          this.entities.set(change.entityId, {
            id: change.entityId,
            type: change.entityType,
            data: change.data,
            hash: this.hashData(change.data),
            lastModified: change.timestamp,
            version: 1,
          });
        }
        break;
    }

    // Track change
    if (this.config.trackChanges) {
      this.changes.push(change);
    }
  }

  private hashData(data: unknown): string {
    // Simple hash for testing - in production would use crypto
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  private async simulateLatency(): Promise<void> {
    const latency =
      this.config.latencyMin +
      Math.random() * (this.config.latencyMax - this.config.latencyMin);
    await new Promise((resolve) => setTimeout(resolve, latency));
  }

  private shouldFail(): boolean {
    return Math.random() < this.config.failureRate;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a mock sync endpoint
 */
export function createMockSyncEndpoint(
  config?: Partial<MockSyncConfig>
): MockSyncEndpoint {
  return new MockSyncEndpoint(config);
}
