/**
 * IndexedDB Store
 *
 * Persistent storage layer using IndexedDB for caching EPUB resources.
 * Provides async storage with size limits and automatic cleanup.
 *
 * Features:
 * - Async get/set operations
 * - Size tracking and limits
 * - LRU-like eviction
 * - Book-level cleanup
 * - Metadata storage
 *
 * @see docs/specifications/file-system-architecture.md
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Stored entry in IndexedDB
 */
export interface StoredEntry {
  /** Unique key */
  key: string;
  /** Book ID for grouping */
  bookId: string;
  /** Resource href within the book */
  href: string;
  /** Binary data */
  data: ArrayBuffer;
  /** MIME type */
  mimeType: string;
  /** Size in bytes */
  size: number;
  /** Creation timestamp */
  createdAt: number;
  /** Last access timestamp */
  accessedAt: number;
  /** Access count */
  accessCount: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * IndexedDB store configuration
 */
export interface IndexedDBStoreConfig {
  /** Database name */
  dbName: string;
  /** Store name */
  storeName: string;
  /** Database version */
  version: number;
  /** Maximum size in bytes (default: 500MB) */
  maxSizeBytes: number;
  /** Maximum entries (default: 5000) */
  maxEntries: number;
}

/**
 * Store statistics
 */
export interface StoreStats {
  /** Number of entries */
  entries: number;
  /** Total size in bytes */
  sizeBytes: number;
  /** Maximum size in bytes */
  maxSizeBytes: number;
  /** Number of books stored */
  bookCount: number;
  /** Size per book */
  sizeByBook: Map<string, number>;
}

/**
 * Default store configuration
 */
export const DEFAULT_IDB_CONFIG: IndexedDBStoreConfig = {
  dbName: 'amnesia-cache',
  storeName: 'resources',
  version: 1,
  maxSizeBytes: 500 * 1024 * 1024, // 500MB
  maxEntries: 5000,
};

// ============================================================================
// IndexedDB Store
// ============================================================================

export class IndexedDBStore {
  private config: IndexedDBStoreConfig;
  private db: IDBDatabase | null = null;
  private currentSize: number = 0;
  private initPromise: Promise<void> | null = null;

  constructor(config: Partial<IndexedDBStoreConfig> = {}) {
    this.config = { ...DEFAULT_IDB_CONFIG, ...config };
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the database
   */
  async init(): Promise<void> {
    if (this.db) return;

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.openDatabase();
    await this.initPromise;

    // Calculate current size
    await this.calculateCurrentSize();
  }

  private async openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, this.config.version);

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.config.storeName)) {
          const store = db.createObjectStore(this.config.storeName, {
            keyPath: 'key',
          });

          // Create indexes
          store.createIndex('bookId', 'bookId', { unique: false });
          store.createIndex('accessedAt', 'accessedAt', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('size', 'size', { unique: false });
        }
      };
    });
  }

  /**
   * Ensure database is initialized
   */
  private async ensureInit(): Promise<IDBDatabase> {
    await this.init();
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  // ==========================================================================
  // Core Operations
  // ==========================================================================

  /**
   * Get an entry by key
   */
  async get(key: string): Promise<StoredEntry | null> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readwrite');
      const store = transaction.objectStore(this.config.storeName);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entry = request.result as StoredEntry | undefined;

        if (entry) {
          // Update access metadata
          entry.accessedAt = Date.now();
          entry.accessCount++;
          store.put(entry);
        }

        resolve(entry || null);
      };
    });
  }

  /**
   * Store an entry
   */
  async set(
    bookId: string,
    href: string,
    data: ArrayBuffer,
    mimeType: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const db = await this.ensureInit();
    const key = this.makeKey(bookId, href);
    const size = data.byteLength;
    const now = Date.now();

    // Check if we need to evict
    await this.evictIfNeeded(size);

    const entry: StoredEntry = {
      key,
      bookId,
      href,
      data,
      mimeType,
      size,
      createdAt: now,
      accessedAt: now,
      accessCount: 1,
      metadata,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readwrite');
      const store = transaction.objectStore(this.config.storeName);

      // Check if entry exists to update size tracking
      const getRequest = store.get(key);

      getRequest.onsuccess = () => {
        const existing = getRequest.result as StoredEntry | undefined;

        if (existing) {
          this.currentSize -= existing.size;
        }

        const putRequest = store.put(entry);

        putRequest.onerror = () => reject(putRequest.error);
        putRequest.onsuccess = () => {
          this.currentSize += size;
          resolve();
        };
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Check if an entry exists
   */
  async has(key: string): Promise<boolean> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readonly');
      const store = transaction.objectStore(this.config.storeName);
      const request = store.count(IDBKeyRange.only(key));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result > 0);
    });
  }

  /**
   * Delete an entry
   */
  async delete(key: string): Promise<boolean> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readwrite');
      const store = transaction.objectStore(this.config.storeName);

      // Get entry first to update size
      const getRequest = store.get(key);

      getRequest.onsuccess = () => {
        const entry = getRequest.result as StoredEntry | undefined;

        if (!entry) {
          resolve(false);
          return;
        }

        const deleteRequest = store.delete(key);

        deleteRequest.onerror = () => reject(deleteRequest.error);
        deleteRequest.onsuccess = () => {
          this.currentSize -= entry.size;
          resolve(true);
        };
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Clear all entries
   */
  async clear(): Promise<void> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readwrite');
      const store = transaction.objectStore(this.config.storeName);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.currentSize = 0;
        resolve();
      };
    });
  }

  // ==========================================================================
  // Book-Level Operations
  // ==========================================================================

  /**
   * Get all entries for a book
   */
  async getBookEntries(bookId: string): Promise<StoredEntry[]> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readonly');
      const store = transaction.objectStore(this.config.storeName);
      const index = store.index('bookId');
      const request = index.getAll(IDBKeyRange.only(bookId));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  /**
   * Delete all entries for a book
   */
  async deleteBook(bookId: string): Promise<number> {
    const db = await this.ensureInit();
    const entries = await this.getBookEntries(bookId);

    if (entries.length === 0) return 0;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readwrite');
      const store = transaction.objectStore(this.config.storeName);
      let deleted = 0;
      let sizeFreed = 0;

      for (const entry of entries) {
        const request = store.delete(entry.key);

        request.onsuccess = () => {
          deleted++;
          sizeFreed += entry.size;

          if (deleted === entries.length) {
            this.currentSize -= sizeFreed;
            resolve(deleted);
          }
        };

        request.onerror = () => reject(request.error);
      }
    });
  }

  /**
   * Get size used by a book
   */
  async getBookSize(bookId: string): Promise<number> {
    const entries = await this.getBookEntries(bookId);
    return entries.reduce((sum, entry) => sum + entry.size, 0);
  }

  /**
   * List all book IDs in the store
   */
  async listBooks(): Promise<string[]> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readonly');
      const store = transaction.objectStore(this.config.storeName);
      const index = store.index('bookId');
      const request = index.openKeyCursor(null, 'nextunique');
      const books: string[] = [];

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          books.push(cursor.key as string);
          cursor.continue();
        } else {
          resolve(books);
        }
      };
    });
  }

  // ==========================================================================
  // Eviction
  // ==========================================================================

  /**
   * Evict entries if needed to make room for new data
   */
  private async evictIfNeeded(incomingSize: number): Promise<void> {
    const db = await this.ensureInit();
    const targetSize = this.config.maxSizeBytes - incomingSize;

    if (this.currentSize <= targetSize) return;

    // Get oldest entries by access time
    const entries = await this.getEntriesByAccessTime();

    const toDelete: string[] = [];
    let sizeToFree = this.currentSize - targetSize;

    for (const entry of entries) {
      if (sizeToFree <= 0) break;
      toDelete.push(entry.key);
      sizeToFree -= entry.size;
    }

    if (toDelete.length === 0) return;

    // Delete entries
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readwrite');
      const store = transaction.objectStore(this.config.storeName);
      let deleted = 0;

      for (const key of toDelete) {
        const request = store.delete(key);

        request.onsuccess = () => {
          deleted++;
          if (deleted === toDelete.length) {
            resolve();
          }
        };

        request.onerror = () => reject(request.error);
      }
    });
  }

  /**
   * Get entries sorted by access time (oldest first)
   */
  private async getEntriesByAccessTime(): Promise<StoredEntry[]> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readonly');
      const store = transaction.objectStore(this.config.storeName);
      const index = store.index('accessedAt');
      const request = index.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        // Sort by accessedAt ascending (oldest first)
        const entries = (request.result as StoredEntry[]) || [];
        entries.sort((a, b) => a.accessedAt - b.accessedAt);
        resolve(entries);
      };
    });
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get store statistics
   */
  async getStats(): Promise<StoreStats> {
    const db = await this.ensureInit();
    const books = await this.listBooks();
    const sizeByBook = new Map<string, number>();

    for (const bookId of books) {
      const size = await this.getBookSize(bookId);
      sizeByBook.set(bookId, size);
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readonly');
      const store = transaction.objectStore(this.config.storeName);
      const request = store.count();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        resolve({
          entries: request.result,
          sizeBytes: this.currentSize,
          maxSizeBytes: this.config.maxSizeBytes,
          bookCount: books.length,
          sizeByBook,
        });
      };
    });
  }

  /**
   * Calculate and update current size
   */
  private async calculateCurrentSize(): Promise<void> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readonly');
      const store = transaction.objectStore(this.config.storeName);
      const request = store.openCursor();
      let totalSize = 0;

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const entry = cursor.value as StoredEntry;
          totalSize += entry.size;
          cursor.continue();
        } else {
          this.currentSize = totalSize;
          resolve();
        }
      };
    });
  }

  /**
   * Get current size
   */
  get size(): number {
    return this.currentSize;
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Make a storage key from bookId and href
   */
  makeKey(bookId: string, href: string): string {
    return `${bookId}:${href}`;
  }

  /**
   * Parse a storage key
   */
  parseKey(key: string): { bookId: string; href: string } | null {
    const colonIndex = key.indexOf(':');
    if (colonIndex === -1) return null;

    return {
      bookId: key.substring(0, colonIndex),
      href: key.substring(colonIndex + 1),
    };
  }

  /**
   * Close the database
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initPromise = null;
  }

  /**
   * Delete the entire database
   */
  async destroy(): Promise<void> {
    this.close();

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.config.dbName);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.currentSize = 0;
        resolve();
      };
    });
  }
}

// ============================================================================
// Factory
// ============================================================================

let storeInstance: IndexedDBStore | null = null;

/**
 * Get or create the IndexedDB store singleton
 */
export function getIndexedDBStore(
  config?: Partial<IndexedDBStoreConfig>
): IndexedDBStore {
  if (!storeInstance) {
    storeInstance = new IndexedDBStore(config);
  }
  return storeInstance;
}

/**
 * Create a new IndexedDB store instance
 */
export function createIndexedDBStore(
  config?: Partial<IndexedDBStoreConfig>
): IndexedDBStore {
  return new IndexedDBStore(config);
}
