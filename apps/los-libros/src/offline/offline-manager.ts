/**
 * Offline Manager
 *
 * Manages downloading books for offline reading. Coordinates with
 * the caching system to store book resources persistently.
 *
 * Features:
 * - Download books for offline reading
 * - Track download progress
 * - Resume interrupted downloads
 * - Manage offline library
 * - Storage quota management
 *
 * @see docs/specifications/file-system-architecture.md
 */

import type { TieredCache } from '../cache/tiered-cache';
import type { IndexedDBStore } from '../cache/indexed-db-store';

// ============================================================================
// Types
// ============================================================================

/**
 * Book metadata for offline storage
 */
export interface OfflineBook {
  /** Book ID */
  bookId: string;
  /** Book title */
  title: string;
  /** Book author */
  author?: string;
  /** Cover image blob URL */
  coverUrl?: string;
  /** Total size in bytes */
  totalSize: number;
  /** Downloaded size in bytes */
  downloadedSize: number;
  /** Number of resources */
  resourceCount: number;
  /** Number of downloaded resources */
  downloadedCount: number;
  /** Download status */
  status: DownloadStatus;
  /** Download started timestamp */
  startedAt?: number;
  /** Download completed timestamp */
  completedAt?: number;
  /** Last accessed timestamp */
  lastAccessedAt: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Download status
 */
export type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'partial';

/**
 * Download progress
 */
export interface DownloadProgress {
  /** Book ID */
  bookId: string;
  /** Current resource being downloaded */
  currentResource: string;
  /** Current resource index */
  currentIndex: number;
  /** Total resources */
  totalResources: number;
  /** Bytes downloaded */
  bytesDownloaded: number;
  /** Total bytes */
  totalBytes: number;
  /** Progress percentage (0-100) */
  percentage: number;
  /** Download speed in bytes/sec */
  speed: number;
  /** Estimated time remaining in seconds */
  eta: number;
}

/**
 * Download events
 */
export interface DownloadEvents {
  'start': { bookId: string };
  'progress': DownloadProgress;
  'complete': { bookId: string; book: OfflineBook };
  'pause': { bookId: string };
  'resume': { bookId: string };
  'error': { bookId: string; error: string };
  'cancel': { bookId: string };
}

/**
 * Event listener type
 */
export type DownloadEventListener<K extends keyof DownloadEvents> = (
  data: DownloadEvents[K]
) => void;

/**
 * Book resource manifest
 */
export interface BookManifest {
  /** Book ID */
  bookId: string;
  /** Book title */
  title: string;
  /** Book author */
  author?: string;
  /** Cover href */
  coverHref?: string;
  /** All resource hrefs */
  resources: ResourceInfo[];
}

/**
 * Resource info
 */
export interface ResourceInfo {
  /** Resource href */
  href: string;
  /** MIME type */
  mimeType: string;
  /** Size in bytes (if known) */
  size?: number;
  /** Whether resource is required for reading */
  required: boolean;
}

/**
 * Offline manager configuration
 */
export interface OfflineManagerConfig {
  /** Maximum concurrent downloads */
  concurrency: number;
  /** Retry failed resources */
  retryCount: number;
  /** Delay between retries in ms */
  retryDelay: number;
  /** Storage quota warning threshold (0-1) */
  quotaWarningThreshold: number;
}

/**
 * Default configuration
 */
export const DEFAULT_OFFLINE_CONFIG: OfflineManagerConfig = {
  concurrency: 3,
  retryCount: 3,
  retryDelay: 1000,
  quotaWarningThreshold: 0.9,
};

// ============================================================================
// Offline Manager
// ============================================================================

export class OfflineManager {
  private config: OfflineManagerConfig;
  private cache: TieredCache;
  private metaStore: IndexedDBStore;
  private offlineBooks: Map<string, OfflineBook> = new Map();
  private activeDownloads: Map<string, AbortController> = new Map();
  private listeners: Map<keyof DownloadEvents, Set<DownloadEventListener<any>>> = new Map();
  private initialized: boolean = false;

  constructor(
    cache: TieredCache,
    metaStore: IndexedDBStore,
    config: Partial<OfflineManagerConfig> = {}
  ) {
    this.cache = cache;
    this.metaStore = metaStore;
    this.config = { ...DEFAULT_OFFLINE_CONFIG, ...config };
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the offline manager
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await this.metaStore.init();
    await this.loadOfflineBooks();

    this.initialized = true;
  }

  /**
   * Load offline books from storage
   */
  private async loadOfflineBooks(): Promise<void> {
    try {
      const entries = await this.metaStore.getBookEntries('_offline_meta');

      for (const entry of entries) {
        try {
          const book = JSON.parse(
            new TextDecoder().decode(entry.data)
          ) as OfflineBook;
          this.offlineBooks.set(book.bookId, book);
        } catch {
          // Skip invalid entries
        }
      }
    } catch (error) {
      console.warn('[OfflineManager] Failed to load offline books:', error);
    }
  }

  /**
   * Save offline book metadata
   */
  private async saveBookMeta(book: OfflineBook): Promise<void> {
    const data = new TextEncoder().encode(JSON.stringify(book));
    await this.metaStore.set(
      '_offline_meta',
      book.bookId,
      data.buffer as ArrayBuffer,
      'application/json'
    );
  }

  // ==========================================================================
  // Download Management
  // ==========================================================================

  /**
   * Download a book for offline reading
   */
  async downloadBook(manifest: BookManifest): Promise<OfflineBook> {
    await this.init();

    const { bookId } = manifest;

    // Check if already downloading
    if (this.activeDownloads.has(bookId)) {
      throw new Error(`Book ${bookId} is already being downloaded`);
    }

    // Check storage quota
    await this.checkStorageQuota(manifest);

    // Create or update offline book entry
    let book = this.offlineBooks.get(bookId);
    const totalSize = manifest.resources.reduce((sum, r) => sum + (r.size || 0), 0);

    if (!book) {
      book = {
        bookId,
        title: manifest.title,
        author: manifest.author,
        totalSize,
        downloadedSize: 0,
        resourceCount: manifest.resources.length,
        downloadedCount: 0,
        status: 'pending',
        lastAccessedAt: Date.now(),
      };
      this.offlineBooks.set(bookId, book);
    }

    // Start download
    book.status = 'downloading';
    book.startedAt = Date.now();
    book.error = undefined;
    await this.saveBookMeta(book);

    this.emit('start', { bookId });

    // Create abort controller
    const controller = new AbortController();
    this.activeDownloads.set(bookId, controller);

    try {
      await this.downloadResources(manifest, book, controller.signal);

      book.status = 'completed';
      book.completedAt = Date.now();
      await this.saveBookMeta(book);

      this.emit('complete', { bookId, book });

      return book;
    } catch (error) {
      if (controller.signal.aborted) {
        // Download was cancelled
        book.status = 'paused';
      } else {
        book.status = 'failed';
        book.error = error instanceof Error ? error.message : String(error);
        this.emit('error', { bookId, error: book.error });
      }

      await this.saveBookMeta(book);
      throw error;
    } finally {
      this.activeDownloads.delete(bookId);
    }
  }

  /**
   * Download resources with progress tracking
   */
  private async downloadResources(
    manifest: BookManifest,
    book: OfflineBook,
    signal: AbortSignal
  ): Promise<void> {
    const { bookId, resources } = manifest;
    const startTime = Date.now();
    let bytesDownloaded = 0;

    // Filter out already cached resources
    const toDownload: ResourceInfo[] = [];
    for (const resource of resources) {
      const cached = await this.cache.has(bookId, resource.href);
      if (!cached) {
        toDownload.push(resource);
      } else {
        bytesDownloaded += resource.size || 0;
        book.downloadedCount++;
      }
    }

    // Download in batches with concurrency
    const queue = [...toDownload];
    const inProgress = new Set<Promise<void>>();

    while (queue.length > 0 || inProgress.size > 0) {
      // Check for abort
      if (signal.aborted) {
        throw new Error('Download cancelled');
      }

      // Fill up to concurrency limit
      while (queue.length > 0 && inProgress.size < this.config.concurrency) {
        const resource = queue.shift()!;

        const downloadPromise = this.downloadResource(bookId, resource, signal)
          .then((size) => {
            bytesDownloaded += size;
            book.downloadedSize = bytesDownloaded;
            book.downloadedCount++;

            // Calculate progress
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = bytesDownloaded / elapsed;
            const remaining = book.totalSize - bytesDownloaded;
            const eta = speed > 0 ? remaining / speed : 0;

            const progress: DownloadProgress = {
              bookId,
              currentResource: resource.href,
              currentIndex: book.downloadedCount,
              totalResources: resources.length,
              bytesDownloaded,
              totalBytes: book.totalSize,
              percentage: (bytesDownloaded / book.totalSize) * 100,
              speed,
              eta,
            };

            this.emit('progress', progress);
          })
          .finally(() => {
            inProgress.delete(downloadPromise);
          });

        inProgress.add(downloadPromise);
      }

      // Wait for at least one to complete
      if (inProgress.size > 0) {
        await Promise.race(inProgress);
      }
    }
  }

  /**
   * Download a single resource with retry
   */
  private async downloadResource(
    bookId: string,
    resource: ResourceInfo,
    signal: AbortSignal
  ): Promise<number> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
      if (signal.aborted) {
        throw new Error('Download cancelled');
      }

      try {
        const cached = await this.cache.get(bookId, resource.href);
        return cached.data.byteLength;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.config.retryCount) {
          await this.delay(this.config.retryDelay * (attempt + 1));
        }
      }
    }

    throw lastError || new Error(`Failed to download ${resource.href}`);
  }

  /**
   * Pause a download
   */
  pauseDownload(bookId: string): void {
    const controller = this.activeDownloads.get(bookId);
    if (controller) {
      controller.abort();
      this.emit('pause', { bookId });
    }
  }

  /**
   * Resume a paused download
   */
  async resumeDownload(manifest: BookManifest): Promise<OfflineBook> {
    const book = this.offlineBooks.get(manifest.bookId);

    if (!book || book.status !== 'paused') {
      throw new Error(`Book ${manifest.bookId} is not paused`);
    }

    this.emit('resume', { bookId: manifest.bookId });
    return this.downloadBook(manifest);
  }

  /**
   * Cancel a download
   */
  async cancelDownload(bookId: string): Promise<void> {
    // Abort active download
    const controller = this.activeDownloads.get(bookId);
    if (controller) {
      controller.abort();
    }

    // Remove from offline books
    await this.removeOfflineBook(bookId);

    this.emit('cancel', { bookId });
  }

  // ==========================================================================
  // Offline Library
  // ==========================================================================

  /**
   * Get all offline books
   */
  getOfflineBooks(): OfflineBook[] {
    return Array.from(this.offlineBooks.values());
  }

  /**
   * Get an offline book by ID
   */
  getOfflineBook(bookId: string): OfflineBook | null {
    return this.offlineBooks.get(bookId) || null;
  }

  /**
   * Check if a book is available offline
   */
  isBookOffline(bookId: string): boolean {
    const book = this.offlineBooks.get(bookId);
    return book?.status === 'completed';
  }

  /**
   * Update last accessed time
   */
  async markAccessed(bookId: string): Promise<void> {
    const book = this.offlineBooks.get(bookId);
    if (book) {
      book.lastAccessedAt = Date.now();
      await this.saveBookMeta(book);
    }
  }

  /**
   * Remove an offline book
   */
  async removeOfflineBook(bookId: string): Promise<void> {
    // Remove from cache
    await this.cache.deleteBook(bookId);

    // Remove metadata
    await this.metaStore.delete(this.metaStore.makeKey('_offline_meta', bookId));

    // Remove from memory
    this.offlineBooks.delete(bookId);
  }

  /**
   * Get total offline storage used
   */
  getTotalStorageUsed(): number {
    let total = 0;
    for (const book of this.offlineBooks.values()) {
      if (book.status === 'completed') {
        total += book.totalSize;
      } else {
        total += book.downloadedSize;
      }
    }
    return total;
  }

  // ==========================================================================
  // Storage Management
  // ==========================================================================

  /**
   * Check storage quota
   */
  private async checkStorageQuota(manifest: BookManifest): Promise<void> {
    if (!navigator.storage || !navigator.storage.estimate) {
      return; // Can't check quota
    }

    try {
      const estimate = await navigator.storage.estimate();
      const used = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const needed = manifest.resources.reduce((sum, r) => sum + (r.size || 0), 0);

      if (quota > 0) {
        const afterDownload = (used + needed) / quota;

        if (afterDownload > this.config.quotaWarningThreshold) {
          console.warn(
            `[OfflineManager] Storage usage will be at ${(afterDownload * 100).toFixed(1)}% after download`
          );
        }

        if (afterDownload > 1) {
          throw new Error(
            'Insufficient storage space. Please free up space or remove some offline books.'
          );
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Insufficient')) {
        throw error;
      }
      // Ignore other errors (quota check not supported)
    }
  }

  /**
   * Get storage info
   */
  async getStorageInfo(): Promise<{
    used: number;
    quota: number;
    available: number;
    percentage: number;
  }> {
    if (!navigator.storage || !navigator.storage.estimate) {
      return { used: 0, quota: 0, available: 0, percentage: 0 };
    }

    try {
      const estimate = await navigator.storage.estimate();
      const used = estimate.usage || 0;
      const quota = estimate.quota || 0;

      return {
        used,
        quota,
        available: quota - used,
        percentage: quota > 0 ? (used / quota) * 100 : 0,
      };
    } catch {
      return { used: 0, quota: 0, available: 0, percentage: 0 };
    }
  }

  /**
   * Clean up old offline books to free space
   */
  async cleanupOldBooks(targetBytes: number): Promise<string[]> {
    const books = this.getOfflineBooks()
      .filter((b) => b.status === 'completed')
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    const removed: string[] = [];
    let freedBytes = 0;

    for (const book of books) {
      if (freedBytes >= targetBytes) break;

      await this.removeOfflineBook(book.bookId);
      removed.push(book.bookId);
      freedBytes += book.totalSize;
    }

    return removed;
  }

  // ==========================================================================
  // Event System
  // ==========================================================================

  /**
   * Add event listener
   */
  on<K extends keyof DownloadEvents>(
    event: K,
    listener: DownloadEventListener<K>
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
  off<K extends keyof DownloadEvents>(
    event: K,
    listener: DownloadEventListener<K>
  ): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Emit event
   */
  private emit<K extends keyof DownloadEvents>(
    event: K,
    data: DownloadEvents[K]
  ): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          console.error(`[OfflineManager] Error in ${event} handler:`, error);
        }
      }
    }
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an offline manager
 */
export function createOfflineManager(
  cache: TieredCache,
  metaStore: IndexedDBStore,
  config?: Partial<OfflineManagerConfig>
): OfflineManager {
  return new OfflineManager(cache, metaStore, config);
}
