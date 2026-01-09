/**
 * Incremental Sync for Calibre
 *
 * Tracks changes between syncs using content hashes to avoid
 * rescanning the entire library. Only syncs books that have
 * actually changed since the last sync.
 *
 * Key features:
 * - Hash-based change detection (title + authors + modified date)
 * - IndexedDB persistence for sync state
 * - Detects added, modified, and deleted books
 *
 * @module calibre/incremental-sync
 */

import type { CalibreBookFull } from './calibre-types';

/**
 * Hash record for a book
 */
export interface BookHash {
  id: number;
  hash: string;
  lastModified: number;
}

/**
 * Sync state stored in IndexedDB
 */
export interface IncrementalSyncState {
  lastSyncTimestamp: number;
  bookHashes: Map<number, BookHash>;
  version: number;
}

/**
 * Detected changes between syncs
 */
export interface ChangeSet {
  /** Books added since last sync */
  added: CalibreBookFull[];
  /** Books modified since last sync */
  modified: CalibreBookFull[];
  /** Book IDs deleted since last sync */
  deleted: number[];
  /** Statistics */
  stats: {
    totalBooks: number;
    addedCount: number;
    modifiedCount: number;
    deletedCount: number;
    unchangedCount: number;
  };
}

/**
 * Sync result after applying changes
 */
export interface IncrementalSyncResult {
  success: boolean;
  changes: ChangeSet;
  duration: number;
  error?: string;
}

// IndexedDB constants
const DB_NAME = 'amnesia-calibre-sync';
const DB_VERSION = 1;
const STORE_NAME = 'sync-state';
const STATE_KEY = 'calibre-incremental-state';

/**
 * Incremental Sync Manager
 *
 * Tracks Calibre library changes using content hashes to enable
 * efficient partial syncs instead of full library rescans.
 */
export class IncrementalSyncManager {
  private state: IncrementalSyncState | null = null;
  private db: IDBDatabase | null = null;

  /**
   * Initialize the sync manager
   * Opens IndexedDB and loads existing sync state
   */
  async initialize(): Promise<void> {
    await this.openDatabase();
    this.state = await this.loadState();

    if (!this.state) {
      this.state = {
        lastSyncTimestamp: 0,
        bookHashes: new Map(),
        version: 1,
      };
    }
  }

  /**
   * Detect changes between current Calibre library and last sync state
   */
  detectChanges(currentBooks: CalibreBookFull[]): ChangeSet {
    if (!this.state) {
      // No previous state - everything is new
      return {
        added: currentBooks,
        modified: [],
        deleted: [],
        stats: {
          totalBooks: currentBooks.length,
          addedCount: currentBooks.length,
          modifiedCount: 0,
          deletedCount: 0,
          unchangedCount: 0,
        },
      };
    }

    const added: CalibreBookFull[] = [];
    const modified: CalibreBookFull[] = [];
    const seenIds = new Set<number>();
    let unchangedCount = 0;

    // Check each current book
    for (const book of currentBooks) {
      seenIds.add(book.id);

      const existingHash = this.state.bookHashes.get(book.id);
      const currentHash = this.computeBookHash(book);

      if (!existingHash) {
        // New book
        added.push(book);
      } else if (existingHash.hash !== currentHash) {
        // Modified book
        modified.push(book);
      } else {
        unchangedCount++;
      }
    }

    // Find deleted books
    const deleted: number[] = [];
    for (const [id] of this.state.bookHashes) {
      if (!seenIds.has(id)) {
        deleted.push(id);
      }
    }

    return {
      added,
      modified,
      deleted,
      stats: {
        totalBooks: currentBooks.length,
        addedCount: added.length,
        modifiedCount: modified.length,
        deletedCount: deleted.length,
        unchangedCount,
      },
    };
  }

  /**
   * Update sync state after successful sync
   */
  async applyChanges(currentBooks: CalibreBookFull[]): Promise<void> {
    if (!this.state) {
      await this.initialize();
    }

    // Rebuild hash map with current state
    const newHashes = new Map<number, BookHash>();

    for (const book of currentBooks) {
      newHashes.set(book.id, {
        id: book.id,
        hash: this.computeBookHash(book),
        lastModified: book.lastModified.getTime(),
      });
    }

    this.state!.bookHashes = newHashes;
    this.state!.lastSyncTimestamp = Date.now();

    await this.saveState();
  }

  /**
   * Get the last sync timestamp
   */
  getLastSyncTime(): Date | null {
    if (!this.state || this.state.lastSyncTimestamp === 0) {
      return null;
    }
    return new Date(this.state.lastSyncTimestamp);
  }

  /**
   * Get the number of tracked books
   */
  getTrackedBookCount(): number {
    return this.state?.bookHashes.size ?? 0;
  }

  /**
   * Clear all sync state (forces full resync)
   */
  async reset(): Promise<void> {
    this.state = {
      lastSyncTimestamp: 0,
      bookHashes: new Map(),
      version: 1,
    };
    await this.saveState();
  }

  /**
   * Compute a hash for a book based on its key fields
   * Used to detect changes without comparing full objects
   */
  private computeBookHash(book: CalibreBookFull): string {
    // Hash based on fields that indicate meaningful changes
    const components = [
      book.title,
      book.authors.map(a => a.name).sort().join(','),
      book.tags.map(t => t.name).sort().join(','),
      book.series?.name ?? '',
      book.seriesIndex?.toString() ?? '',
      book.rating?.toString() ?? '',
      book.description?.slice(0, 100) ?? '', // First 100 chars of description
      book.lastModified.toISOString(),
    ];

    // Simple hash function (FNV-1a variant)
    const str = components.join('|');
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  // ===========================================================================
  // IndexedDB Operations
  // ===========================================================================

  /**
   * Open IndexedDB database
   */
  private openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.warn('[IncrementalSync] IndexedDB open failed:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });
  }

  /**
   * Load sync state from IndexedDB
   */
  private loadState(): Promise<IncrementalSyncState | null> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve(null);
        return;
      }

      const transaction = this.db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(STATE_KEY);

      request.onerror = () => {
        console.warn('[IncrementalSync] Load state failed:', request.error);
        resolve(null);
      };

      request.onsuccess = () => {
        const data = request.result;
        if (!data) {
          resolve(null);
          return;
        }

        // Deserialize Map from array
        const state: IncrementalSyncState = {
          lastSyncTimestamp: data.lastSyncTimestamp,
          version: data.version,
          bookHashes: new Map(data.bookHashes ?? []),
        };

        resolve(state);
      };
    });
  }

  /**
   * Save sync state to IndexedDB
   */
  private saveState(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db || !this.state) {
        resolve();
        return;
      }

      // Serialize Map to array for IndexedDB
      const data = {
        lastSyncTimestamp: this.state.lastSyncTimestamp,
        version: this.state.version,
        bookHashes: Array.from(this.state.bookHashes.entries()),
      };

      const transaction = this.db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(data, STATE_KEY);

      request.onerror = () => {
        console.warn('[IncrementalSync] Save state failed:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        resolve();
      };
    });
  }

  /**
   * Close database connection
   */
  dispose(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

/**
 * Create and initialize an incremental sync manager
 */
export async function createIncrementalSyncManager(): Promise<IncrementalSyncManager> {
  const manager = new IncrementalSyncManager();
  await manager.initialize();
  return manager;
}
