/**
 * Sync Manager
 *
 * Handles background synchronization of user data between
 * offline storage and the server.
 *
 * Features:
 * - Sync annotations (highlights, notes, bookmarks)
 * - Sync reading progress
 * - Conflict resolution
 * - Offline queue with retry
 * - Automatic sync on reconnection
 *
 * @see docs/specifications/file-system-architecture.md
 */

import type { NetworkMonitor } from './network-monitor';

// ============================================================================
// Types
// ============================================================================

/**
 * Sync item types
 */
export type SyncItemType =
  | 'highlight'
  | 'note'
  | 'bookmark'
  | 'progress'
  | 'setting';

/**
 * Sync operation
 */
export type SyncOperation = 'create' | 'update' | 'delete';

/**
 * Sync item status
 */
export type SyncItemStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';

/**
 * Sync item in the queue
 */
export interface SyncItem {
  /** Unique ID */
  id: string;
  /** Item type */
  type: SyncItemType;
  /** Operation to perform */
  operation: SyncOperation;
  /** Book ID */
  bookId: string;
  /** Item data */
  data: Record<string, unknown>;
  /** Local timestamp */
  localTimestamp: number;
  /** Server timestamp (if synced) */
  serverTimestamp?: number;
  /** Sync status */
  status: SyncItemStatus;
  /** Retry count */
  retryCount: number;
  /** Error message */
  error?: string;
  /** Conflict data from server */
  conflictData?: Record<string, unknown>;
}

/**
 * Sync result
 */
export interface SyncResult {
  /** Number of items synced */
  synced: number;
  /** Number of items failed */
  failed: number;
  /** Number of conflicts */
  conflicts: number;
  /** Items that had conflicts */
  conflictItems: SyncItem[];
  /** Error messages */
  errors: string[];
}

/**
 * Sync events
 */
export interface SyncEvents {
  'sync-start': { itemCount: number };
  'sync-progress': { current: number; total: number; item: SyncItem };
  'sync-complete': SyncResult;
  'sync-error': { error: string };
  'conflict': { item: SyncItem };
  'item-synced': { item: SyncItem };
  'queue-change': { pending: number };
}

/**
 * Event listener type
 */
export type SyncEventListener<K extends keyof SyncEvents> = (
  data: SyncEvents[K]
) => void;

/**
 * Conflict resolution strategy
 */
export type ConflictStrategy = 'local' | 'server' | 'merge' | 'manual';

/**
 * Sync provider interface
 */
export interface SyncProvider {
  /** Push items to server */
  push(items: SyncItem[]): Promise<SyncPushResult[]>;
  /** Pull items from server */
  pull(since: number, types?: SyncItemType[]): Promise<SyncItem[]>;
  /** Resolve a conflict */
  resolveConflict?(item: SyncItem, resolution: ConflictStrategy): Promise<SyncItem>;
}

/**
 * Push result for a single item
 */
export interface SyncPushResult {
  /** Item ID */
  id: string;
  /** Success status */
  success: boolean;
  /** Server timestamp */
  serverTimestamp?: number;
  /** Error message */
  error?: string;
  /** Conflict data */
  conflict?: Record<string, unknown>;
}

/**
 * Sync manager configuration
 */
export interface SyncManagerConfig {
  /** Auto sync when online */
  autoSync: boolean;
  /** Sync interval in ms */
  syncInterval: number;
  /** Maximum retry count */
  maxRetries: number;
  /** Retry delay in ms */
  retryDelay: number;
  /** Batch size for sync operations */
  batchSize: number;
  /** Default conflict resolution strategy */
  conflictStrategy: ConflictStrategy;
}

/**
 * Default configuration
 */
export const DEFAULT_SYNC_CONFIG: SyncManagerConfig = {
  autoSync: true,
  syncInterval: 60000, // 1 minute
  maxRetries: 5,
  retryDelay: 5000, // 5 seconds
  batchSize: 50,
  conflictStrategy: 'manual',
};

// ============================================================================
// Sync Manager
// ============================================================================

export class SyncManager {
  private config: SyncManagerConfig;
  private provider: SyncProvider | null = null;
  private networkMonitor: NetworkMonitor | null = null;
  private queue: Map<string, SyncItem> = new Map();
  private listeners: Map<keyof SyncEvents, Set<SyncEventListener<any>>> = new Map();
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastSyncTimestamp: number = 0;
  private isSyncing: boolean = false;
  private storageKey = 'los-libros-sync-queue';

  constructor(config: Partial<SyncManagerConfig> = {}) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the sync manager
   */
  async init(
    provider: SyncProvider,
    networkMonitor?: NetworkMonitor
  ): Promise<void> {
    this.provider = provider;
    this.networkMonitor = networkMonitor || null;

    // Load queue from storage
    await this.loadQueue();

    // Set up network listener
    if (this.networkMonitor) {
      this.networkMonitor.on('online', () => {
        if (this.config.autoSync) {
          this.sync();
        }
      });
    }

    // Start auto sync
    if (this.config.autoSync) {
      this.startAutoSync();
    }
  }

  /**
   * Start automatic sync
   */
  startAutoSync(): void {
    if (this.syncIntervalId) return;

    this.syncIntervalId = setInterval(() => {
      if (this.networkMonitor?.isOnline() ?? navigator.onLine) {
        this.sync();
      }
    }, this.config.syncInterval);
  }

  /**
   * Stop automatic sync
   */
  stopAutoSync(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  // ==========================================================================
  // Queue Management
  // ==========================================================================

  /**
   * Add an item to the sync queue
   */
  async enqueue(
    type: SyncItemType,
    operation: SyncOperation,
    bookId: string,
    data: Record<string, unknown>,
    id?: string
  ): Promise<SyncItem> {
    const item: SyncItem = {
      id: id || this.generateId(),
      type,
      operation,
      bookId,
      data,
      localTimestamp: Date.now(),
      status: 'pending',
      retryCount: 0,
    };

    // Check for existing item with same ID
    const existing = this.queue.get(item.id);
    if (existing) {
      // Update existing item
      item.retryCount = existing.retryCount;
      if (existing.status === 'conflict') {
        item.conflictData = existing.conflictData;
      }
    }

    this.queue.set(item.id, item);
    await this.saveQueue();

    this.emit('queue-change', { pending: this.getPendingCount() });

    // Trigger sync if online
    if (
      this.config.autoSync &&
      (this.networkMonitor?.isOnline() ?? navigator.onLine)
    ) {
      this.sync();
    }

    return item;
  }

  /**
   * Remove an item from the queue
   */
  async dequeue(id: string): Promise<void> {
    this.queue.delete(id);
    await this.saveQueue();
    this.emit('queue-change', { pending: this.getPendingCount() });
  }

  /**
   * Get pending items count
   */
  getPendingCount(): number {
    let count = 0;
    for (const item of this.queue.values()) {
      if (item.status === 'pending' || item.status === 'failed') {
        count++;
      }
    }
    return count;
  }

  /**
   * Get all queued items
   */
  getQueue(): SyncItem[] {
    return Array.from(this.queue.values());
  }

  /**
   * Get items with conflicts
   */
  getConflicts(): SyncItem[] {
    return Array.from(this.queue.values()).filter(
      (item) => item.status === 'conflict'
    );
  }

  // ==========================================================================
  // Sync Operations
  // ==========================================================================

  /**
   * Perform sync
   */
  async sync(): Promise<SyncResult> {
    if (!this.provider) {
      throw new Error('Sync provider not configured');
    }

    if (this.isSyncing) {
      return { synced: 0, failed: 0, conflicts: 0, conflictItems: [], errors: [] };
    }

    this.isSyncing = true;

    const result: SyncResult = {
      synced: 0,
      failed: 0,
      conflicts: 0,
      conflictItems: [],
      errors: [],
    };

    try {
      // Get pending items
      const pendingItems = Array.from(this.queue.values()).filter(
        (item) =>
          item.status === 'pending' ||
          (item.status === 'failed' && item.retryCount < this.config.maxRetries)
      );

      if (pendingItems.length === 0) {
        return result;
      }

      this.emit('sync-start', { itemCount: pendingItems.length });

      // Process in batches
      for (let i = 0; i < pendingItems.length; i += this.config.batchSize) {
        const batch = pendingItems.slice(i, i + this.config.batchSize);

        // Mark as syncing
        for (const item of batch) {
          item.status = 'syncing';
        }

        try {
          const pushResults = await this.provider.push(batch);

          // Process results
          for (let j = 0; j < batch.length; j++) {
            const item = batch[j];
            const pushResult = pushResults[j];

            if (pushResult.success) {
              item.status = 'synced';
              item.serverTimestamp = pushResult.serverTimestamp;
              result.synced++;

              // Remove synced items from queue
              this.queue.delete(item.id);

              this.emit('item-synced', { item });
            } else if (pushResult.conflict) {
              item.status = 'conflict';
              item.conflictData = pushResult.conflict;
              result.conflicts++;
              result.conflictItems.push(item);

              this.emit('conflict', { item });
            } else {
              item.status = 'failed';
              item.error = pushResult.error;
              item.retryCount++;
              result.failed++;
              result.errors.push(pushResult.error || 'Unknown error');
            }

            this.emit('sync-progress', {
              current: i + j + 1,
              total: pendingItems.length,
              item,
            });
          }
        } catch (error) {
          // Batch failed - mark all as failed
          for (const item of batch) {
            item.status = 'failed';
            item.error = error instanceof Error ? error.message : String(error);
            item.retryCount++;
            result.failed++;
          }

          result.errors.push(
            error instanceof Error ? error.message : String(error)
          );
        }
      }

      this.lastSyncTimestamp = Date.now();
      await this.saveQueue();

      this.emit('sync-complete', result);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit('sync-error', { error: errorMessage });
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Pull updates from server
   */
  async pull(types?: SyncItemType[]): Promise<SyncItem[]> {
    if (!this.provider) {
      throw new Error('Sync provider not configured');
    }

    try {
      const items = await this.provider.pull(this.lastSyncTimestamp, types);
      this.lastSyncTimestamp = Date.now();
      return items;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit('sync-error', { error: errorMessage });
      throw error;
    }
  }

  // ==========================================================================
  // Conflict Resolution
  // ==========================================================================

  /**
   * Resolve a conflict
   */
  async resolveConflict(
    itemId: string,
    strategy: ConflictStrategy
  ): Promise<SyncItem> {
    const item = this.queue.get(itemId);
    if (!item) {
      throw new Error(`Item ${itemId} not found`);
    }

    if (item.status !== 'conflict') {
      throw new Error(`Item ${itemId} is not in conflict`);
    }

    if (!this.provider?.resolveConflict) {
      // Apply strategy locally
      return this.applyConflictStrategy(item, strategy);
    }

    try {
      const resolved = await this.provider.resolveConflict(item, strategy);
      resolved.status = 'pending';
      resolved.conflictData = undefined;

      this.queue.set(resolved.id, resolved);
      await this.saveQueue();

      // Trigger sync
      if (this.config.autoSync) {
        this.sync();
      }

      return resolved;
    } catch (error) {
      item.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Apply conflict resolution strategy locally
   */
  private applyConflictStrategy(
    item: SyncItem,
    strategy: ConflictStrategy
  ): SyncItem {
    switch (strategy) {
      case 'local':
        // Keep local data, re-queue
        item.status = 'pending';
        item.conflictData = undefined;
        break;

      case 'server':
        // Use server data
        if (item.conflictData) {
          item.data = { ...item.conflictData };
        }
        item.status = 'synced';
        item.conflictData = undefined;
        this.queue.delete(item.id);
        break;

      case 'merge':
        // Merge local and server data
        if (item.conflictData) {
          item.data = { ...item.conflictData, ...item.data };
        }
        item.status = 'pending';
        item.conflictData = undefined;
        break;

      case 'manual':
      default:
        // Leave as conflict for manual resolution
        break;
    }

    return item;
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Load queue from storage
   */
  private async loadQueue(): Promise<void> {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const items = JSON.parse(stored) as SyncItem[];
        for (const item of items) {
          // Reset syncing items to pending
          if (item.status === 'syncing') {
            item.status = 'pending';
          }
          this.queue.set(item.id, item);
        }
      }

      // Load last sync timestamp
      const lastSync = localStorage.getItem(`${this.storageKey}-timestamp`);
      if (lastSync) {
        this.lastSyncTimestamp = parseInt(lastSync, 10);
      }
    } catch (error) {
      console.warn('[SyncManager] Failed to load queue:', error);
    }
  }

  /**
   * Save queue to storage
   */
  private async saveQueue(): Promise<void> {
    try {
      const items = Array.from(this.queue.values());
      localStorage.setItem(this.storageKey, JSON.stringify(items));
      localStorage.setItem(
        `${this.storageKey}-timestamp`,
        String(this.lastSyncTimestamp)
      );
    } catch (error) {
      console.warn('[SyncManager] Failed to save queue:', error);
    }
  }

  /**
   * Clear the queue
   */
  async clearQueue(): Promise<void> {
    this.queue.clear();
    await this.saveQueue();
    this.emit('queue-change', { pending: 0 });
  }

  // ==========================================================================
  // Event System
  // ==========================================================================

  /**
   * Add event listener
   */
  on<K extends keyof SyncEvents>(
    event: K,
    listener: SyncEventListener<K>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    return () => this.off(event, listener);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof SyncEvents>(
    event: K,
    listener: SyncEventListener<K>
  ): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Emit event
   */
  private emit<K extends keyof SyncEvents>(
    event: K,
    data: SyncEvents[K]
  ): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          console.error(`[SyncManager] Error in ${event} handler:`, error);
        }
      }
    }
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get last sync timestamp
   */
  getLastSyncTimestamp(): number {
    return this.lastSyncTimestamp;
  }

  /**
   * Check if currently syncing
   */
  isSyncInProgress(): boolean {
    return this.isSyncing;
  }
}

// ============================================================================
// Factory
// ============================================================================

let syncInstance: SyncManager | null = null;

/**
 * Get or create the sync manager singleton
 */
export function getSyncManager(
  config?: Partial<SyncManagerConfig>
): SyncManager {
  if (!syncInstance) {
    syncInstance = new SyncManager(config);
  }
  return syncInstance;
}

/**
 * Create a new sync manager instance
 */
export function createSyncManager(
  config?: Partial<SyncManagerConfig>
): SyncManager {
  return new SyncManager(config);
}
