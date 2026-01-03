/**
 * Sync Manager
 *
 * Handles automatic background synchronization of:
 * - Reading progress
 * - Annotations/highlights
 * - Bookmarks
 *
 * Features:
 * - Offline operation queue
 * - Automatic background polling
 * - Conflict resolution
 */

import type {
  SyncOperation,
  SyncStatus,
  SyncConflict,
  PushResponse,
  Annotation,
  ReadingProgress,
} from './types';
import { ApiClient } from './api-client';

/**
 * Sync manager configuration
 */
export interface SyncManagerConfig {
  /** Device identifier */
  deviceId: string;
  /** Sync interval in milliseconds (default: 30000) */
  syncInterval?: number;
  /** Maximum retry attempts for failed syncs */
  maxRetries?: number;
  /** Callback for sync status changes */
  onStatusChange?: (status: SyncStatus) => void;
  /** Callback for conflict resolution */
  onConflict?: (conflicts: SyncConflict[]) => Promise<SyncConflict[]>;
}

/**
 * Stored operation for offline queue
 */
interface QueuedOperation extends SyncOperation {
  retryCount: number;
}

/**
 * Sync Manager
 */
export class SyncManager {
  private api: ApiClient;
  private config: Required<SyncManagerConfig>;

  // State
  private bookId: string = '';
  private localVersion = 0;
  private status: SyncStatus = {
    version: 0,
    pendingChanges: 0,
    inProgress: false,
  };

  // Operation queue (for offline support)
  private operationQueue: QueuedOperation[] = [];
  private queueStorageKey = 'amnesia-sync-queue';

  // Background sync
  private syncTimer: number | null = null;
  private isOnline = true;

  constructor(api: ApiClient, config: SyncManagerConfig) {
    this.api = api;
    this.config = {
      syncInterval: 30000,
      maxRetries: 3,
      onStatusChange: () => {},
      onConflict: async (conflicts) => conflicts,
      ...config,
    };

    this.setupNetworkListeners();
    this.loadQueueFromStorage();
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize sync for a book
   */
  async initialize(bookId: string): Promise<void> {
    this.bookId = bookId;

    // Get current sync status from server
    try {
      const status = await this.api.getSyncStatus(bookId);
      this.localVersion = status.version;
      this.updateStatus({
        ...status,
        pendingChanges: this.operationQueue.length,
      });
    } catch (e) {
      console.warn('Failed to get initial sync status:', e);
      this.updateStatus({
        version: 0,
        pendingChanges: this.operationQueue.length,
        inProgress: false,
        error: 'Failed to connect to server',
      });
    }

    // Start background sync
    this.startBackgroundSync();
  }

  /**
   * Stop sync and clean up
   */
  stop(): void {
    this.stopBackgroundSync();
    this.saveQueueToStorage();
  }

  // ============================================================================
  // Operations
  // ============================================================================

  /**
   * Queue a create operation
   */
  async create(
    entityType: 'annotation' | 'progress' | 'bookmark',
    entityId: string,
    payload: unknown
  ): Promise<void> {
    const operation: QueuedOperation = {
      id: this.generateId(),
      operationType: 'create',
      entityType,
      entityId,
      payload,
      baseVersion: this.localVersion,
      deviceId: this.config.deviceId,
      timestamp: new Date(),
      retryCount: 0,
    };

    this.queueOperation(operation);
    await this.trySyncNow();
  }

  /**
   * Queue an update operation
   */
  async update(
    entityType: 'annotation' | 'progress' | 'bookmark',
    entityId: string,
    payload: unknown
  ): Promise<void> {
    const operation: QueuedOperation = {
      id: this.generateId(),
      operationType: 'update',
      entityType,
      entityId,
      payload,
      baseVersion: this.localVersion,
      deviceId: this.config.deviceId,
      timestamp: new Date(),
      retryCount: 0,
    };

    this.queueOperation(operation);
    await this.trySyncNow();
  }

  /**
   * Queue a delete operation
   */
  async delete(
    entityType: 'annotation' | 'progress' | 'bookmark',
    entityId: string
  ): Promise<void> {
    const operation: QueuedOperation = {
      id: this.generateId(),
      operationType: 'delete',
      entityType,
      entityId,
      baseVersion: this.localVersion,
      deviceId: this.config.deviceId,
      timestamp: new Date(),
      retryCount: 0,
    };

    this.queueOperation(operation);
    await this.trySyncNow();
  }

  // ============================================================================
  // Sync Methods
  // ============================================================================

  /**
   * Force an immediate sync
   */
  async syncNow(): Promise<void> {
    if (this.status.inProgress || !this.isOnline) {
      return;
    }

    this.updateStatus({ ...this.status, inProgress: true, error: undefined });

    try {
      // Push local changes
      await this.pushChanges();

      // Pull remote changes
      await this.pullChanges();

      this.updateStatus({
        ...this.status,
        inProgress: false,
        lastSync: new Date(),
        pendingChanges: this.operationQueue.length,
      });
    } catch (e) {
      console.error('Sync failed:', e);
      this.updateStatus({
        ...this.status,
        inProgress: false,
        error: e instanceof Error ? e.message : 'Sync failed',
      });
    }
  }

  /**
   * Try to sync now (if online and not already syncing)
   */
  private async trySyncNow(): Promise<void> {
    if (this.isOnline && !this.status.inProgress) {
      await this.syncNow();
    }
  }

  /**
   * Push local changes to server
   */
  private async pushChanges(): Promise<void> {
    if (this.operationQueue.length === 0) {
      return;
    }

    const operations = this.operationQueue.map(({ retryCount, ...op }) => op);

    const response = await this.api.pushChanges({
      deviceId: this.config.deviceId,
      bookId: this.bookId,
      operations,
      lastKnownVersion: this.localVersion,
    });

    if (response.success) {
      // All operations accepted
      this.operationQueue = [];
      this.localVersion = response.version;
    } else {
      // Handle conflicts
      const resolvedConflicts = await this.config.onConflict(response.conflicts);

      // Remove accepted operations from queue
      const acceptedIds = new Set(
        operations
          .filter((_, i) => i < response.acceptedCount)
          .map((op) => op.id)
      );

      this.operationQueue = this.operationQueue.filter(
        (op) => !acceptedIds.has(op.id)
      );

      this.localVersion = response.version;

      // Re-queue conflicted operations if resolved to local_wins
      for (const conflict of resolvedConflicts) {
        if (conflict.resolution === 'local_wins') {
          // Find the original operation and re-queue with new base version
          const originalOp = operations.find(
            (op) => op.entityId === conflict.entityId
          );
          if (originalOp) {
            this.queueOperation({
              ...originalOp,
              id: this.generateId(),
              baseVersion: this.localVersion,
              retryCount: 0,
            });
          }
        }
      }
    }

    this.saveQueueToStorage();
  }

  /**
   * Pull remote changes from server
   */
  private async pullChanges(): Promise<void> {
    let hasMore = true;
    let sinceVersion = this.localVersion;

    while (hasMore) {
      const response = await this.api.pullChanges({
        deviceId: this.config.deviceId,
        bookId: this.bookId,
        sinceVersion,
      });

      // Apply operations
      for (const op of response.operations) {
        await this.applyRemoteOperation(op);
      }

      this.localVersion = response.currentVersion;
      hasMore = response.hasMore;
      sinceVersion = response.currentVersion;
    }
  }

  /**
   * Apply a remote operation locally
   */
  private async applyRemoteOperation(op: SyncOperation): Promise<void> {
    // Skip operations from this device
    if (op.deviceId === this.config.deviceId) {
      return;
    }

    // Emit event for local application
    // The consumer (ReaderContainer) will handle updating local state
    console.log('Applying remote operation:', op);

    // TODO: Emit event for operation application
  }

  // ============================================================================
  // Queue Management
  // ============================================================================

  /**
   * Add operation to queue
   */
  private queueOperation(operation: QueuedOperation): void {
    // Check for duplicate or superseding operations
    const existingIndex = this.operationQueue.findIndex(
      (op) => op.entityType === operation.entityType && op.entityId === operation.entityId
    );

    if (existingIndex !== -1) {
      // Replace existing operation (newer takes precedence)
      this.operationQueue[existingIndex] = operation;
    } else {
      this.operationQueue.push(operation);
    }

    this.updateStatus({
      ...this.status,
      pendingChanges: this.operationQueue.length,
    });

    this.saveQueueToStorage();
  }

  /**
   * Save queue to local storage
   */
  private saveQueueToStorage(): void {
    try {
      const data = JSON.stringify(this.operationQueue);
      localStorage.setItem(this.queueStorageKey, data);
    } catch (e) {
      console.warn('Failed to save sync queue to storage:', e);
    }
  }

  /**
   * Load queue from local storage
   */
  private loadQueueFromStorage(): void {
    try {
      const data = localStorage.getItem(this.queueStorageKey);
      if (data) {
        this.operationQueue = JSON.parse(data);
        // Convert date strings back to Date objects
        this.operationQueue.forEach((op) => {
          op.timestamp = new Date(op.timestamp);
        });
      }
    } catch (e) {
      console.warn('Failed to load sync queue from storage:', e);
      this.operationQueue = [];
    }
  }

  // ============================================================================
  // Background Sync
  // ============================================================================

  /**
   * Start background sync timer
   */
  private startBackgroundSync(): void {
    if (this.syncTimer) {
      return;
    }

    this.syncTimer = window.setInterval(() => {
      this.trySyncNow();
    }, this.config.syncInterval);
  }

  /**
   * Stop background sync timer
   */
  private stopBackgroundSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  // ============================================================================
  // Network Handling
  // ============================================================================

  /**
   * Set up network status listeners
   */
  private setupNetworkListeners(): void {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.trySyncNow();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.updateStatus({
        ...this.status,
        error: 'Offline - changes will sync when back online',
      });
    });

    this.isOnline = navigator.onLine;
  }

  // ============================================================================
  // Status
  // ============================================================================

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return { ...this.status };
  }

  /**
   * Update status and notify listener
   */
  private updateStatus(status: SyncStatus): void {
    this.status = status;
    this.config.onStatusChange(status);
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if there are pending changes
   */
  hasPendingChanges(): boolean {
    return this.operationQueue.length > 0;
  }

  /**
   * Get pending operation count
   */
  getPendingCount(): number {
    return this.operationQueue.length;
  }

  /**
   * Clear all pending operations
   */
  clearPendingOperations(): void {
    this.operationQueue = [];
    this.saveQueueToStorage();
    this.updateStatus({
      ...this.status,
      pendingChanges: 0,
    });
  }
}
