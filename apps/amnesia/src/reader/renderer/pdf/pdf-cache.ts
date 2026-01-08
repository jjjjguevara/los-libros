/**
 * PDF Page Cache using IndexedDB
 *
 * Provides persistent caching of rendered PDF pages to avoid
 * re-fetching from the server on page reloads.
 *
 * Features:
 * - Two-tier cache: Memory (hot) + IndexedDB (persistent)
 * - Scale tolerance: Returns cached pages within ±15% of requested scale
 * - Automatic eviction of entries older than 7 days
 * - LRU-like behavior in memory tier
 * - Telemetry integration for hit/miss tracking
 */

import { getTelemetry } from './pdf-telemetry';

interface CacheEntry {
  blob: Blob;
  timestamp: number;
  pdfId: string;
  page: number;
  scale: number;
}

/** Pending write entry for batch processing */
interface PendingWrite {
  key: string;
  pdfId: string;
  page: number;
  scale: number;
  blob: Blob;
  timestamp: number;
}

export class PdfPageCache {
  private dbName = 'amnesia-pdf-cache';
  private storeName = 'pages';
  private dbVersion = 5; // Incremented to match existing DB version
  private db: IDBDatabase | null = null;
  private memoryCache: Map<string, Blob> = new Map();
  private maxMemoryEntries = 40; // Increased from 20 for smoother navigation
  private maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  private initialized = false;

  // Batched IndexedDB writes - reduces transaction contention during fast scrolling
  private writeQueue: PendingWrite[] = [];
  private flushTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_FLUSH_DELAY_MS = 500; // Batch writes every 500ms

  /**
   * Initialize the cache (opens IndexedDB)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.warn('[PdfCache] Failed to open IndexedDB:', request.error);
        // Continue without persistence
        this.initialized = true;
        resolve();
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.initialized = true;
        // Evict old entries in the background
        this.evictOldEntries().catch(console.warn);
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName);
          // Create indexes for efficient queries
          store.createIndex('pdfId', 'pdfId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  /**
   * Generate cache key from page parameters
   */
  private getCacheKey(pdfId: string, page: number, scale: number): string {
    return `${pdfId}-${page}-${scale.toFixed(2)}`;
  }

  /**
   * Get a cached page blob with scale tolerance.
   *
   * Returns the closest cached scale within ±15% tolerance of the requested scale.
   * This dramatically improves cache hit rate when zoom level varies slightly.
   */
  async get(pdfId: string, page: number, scale: number): Promise<Blob | null> {
    const telemetry = getTelemetry();
    const tolerance = 0.15; // ±15% scale tolerance

    // Check memory cache first (L1 - hot tier) - exact match
    const exactKey = this.getCacheKey(pdfId, page, scale);
    if (this.memoryCache.has(exactKey)) {
      telemetry.trackCacheAccess('L1', true);
      return this.memoryCache.get(exactKey)!;
    }

    // Search memory cache for closest scale within tolerance
    let bestMatch: { key: string; scale: number; blob: Blob } | null = null;
    for (const [key, blob] of this.memoryCache) {
      const parsed = this.parseKeyScale(key, pdfId, page);
      if (parsed !== null) {
        const diff = Math.abs(parsed - scale) / scale;
        if (diff <= tolerance) {
          // Prefer closest match
          if (!bestMatch || Math.abs(parsed - scale) < Math.abs(bestMatch.scale - scale)) {
            bestMatch = { key, scale: parsed, blob };
          }
        }
      }
    }

    if (bestMatch) {
      telemetry.trackCacheAccess('L1', true);
      return bestMatch.blob;
    }

    // L1 miss
    telemetry.trackCacheAccess('L1', false);

    // Check IndexedDB (L2 - persistent tier)
    if (!this.db) {
      telemetry.trackCacheAccess('L2', false);
      return null;
    }

    // Try exact key first in IndexedDB
    const exactResult = await this.getFromIndexedDB(exactKey);
    if (exactResult) {
      this.addToMemory(exactKey, exactResult);
      telemetry.trackCacheAccess('L2', true);
      return exactResult;
    }

    // Search IndexedDB for tolerant match (check common scales)
    const scalesToCheck = [2.0, 1.5, 1.0, 3.0].filter(s => {
      const diff = Math.abs(s - scale) / scale;
      return diff <= tolerance;
    });

    for (const checkScale of scalesToCheck) {
      const checkKey = this.getCacheKey(pdfId, page, checkScale);
      const result = await this.getFromIndexedDB(checkKey);
      if (result) {
        this.addToMemory(checkKey, result);
        telemetry.trackCacheAccess('L2', true);
        return result;
      }
    }

    telemetry.trackCacheAccess('L2', false);
    return null;
  }

  /**
   * Parse scale from cache key if it matches the given pdfId and page
   */
  private parseKeyScale(key: string, pdfId: string, page: number): number | null {
    // Key format: "${pdfId}-${page}-${scale.toFixed(2)}"
    const prefix = `${pdfId}-${page}-`;
    if (!key.startsWith(prefix)) return null;
    const scaleStr = key.slice(prefix.length);
    const scale = parseFloat(scaleStr);
    return isNaN(scale) ? null : scale;
  }

  /**
   * Get entry from IndexedDB by key
   */
  private async getFromIndexedDB(key: string): Promise<Blob | null> {
    if (!this.db) return null;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const request = store.get(key);

        request.onsuccess = () => {
          const entry = request.result as CacheEntry | undefined;
          if (entry && Date.now() - entry.timestamp < this.maxAgeMs) {
            resolve(entry.blob);
          } else {
            resolve(null);
          }
        };

        request.onerror = () => {
          console.warn('[PdfCache] Failed to read from IndexedDB:', request.error);
          resolve(null);
        };
      } catch (error) {
        console.warn('[PdfCache] IndexedDB transaction error:', error);
        resolve(null);
      }
    });
  }

  /**
   * Cache a page blob
   *
   * Performance optimization: Memory cache update is synchronous and returns
   * immediately. IndexedDB writes are batched (500ms) to reduce transaction
   * contention during fast scrolling. This eliminates per-write overhead
   * while still persisting all entries.
   */
  async set(pdfId: string, page: number, scale: number, blob: Blob): Promise<void> {
    const key = this.getCacheKey(pdfId, page, scale);

    // Always add to memory cache (synchronous, critical path)
    this.addToMemory(key, blob);

    // Queue for batched IndexedDB write
    this.writeQueue.push({
      key,
      pdfId,
      page,
      scale,
      blob,
      timestamp: Date.now(),
    });

    // Schedule batch flush if not already scheduled
    if (!this.flushTimeoutId && this.db) {
      this.flushTimeoutId = setTimeout(() => {
        this.flushWrites();
      }, this.BATCH_FLUSH_DELAY_MS);
    }
  }

  /**
   * Flush queued writes to IndexedDB in a single transaction
   *
   * Batching multiple writes into one transaction is more efficient than
   * individual transactions, reducing disk I/O and improving scroll performance.
   */
  private flushWrites(): void {
    this.flushTimeoutId = null;

    if (!this.db || this.writeQueue.length === 0) {
      return;
    }

    // Take all pending writes
    const batch = this.writeQueue.splice(0);

    try {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);

      // Add all entries in single transaction
      for (const item of batch) {
        const entry: CacheEntry = {
          blob: item.blob,
          timestamp: item.timestamp,
          pdfId: item.pdfId,
          page: item.page,
          scale: item.scale,
        };
        store.put(entry, item.key);
      }

      tx.oncomplete = () => {
        // Success - entries persisted
      };

      tx.onerror = () => {
        console.warn('[PdfCache] Batch write failed:', tx.error);
        // Entries are still in memory cache, so no data loss
      };
    } catch (error) {
      console.warn('[PdfCache] Batch write error:', error);
    }
  }

  /**
   * Check if a page is cached (memory or disk)
   */
  async has(pdfId: string, page: number, scale: number): Promise<boolean> {
    const key = this.getCacheKey(pdfId, page, scale);

    // Check memory first
    if (this.memoryCache.has(key)) {
      return true;
    }

    // Check IndexedDB
    if (!this.db) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const request = store.getKey(key);

        request.onsuccess = () => resolve(request.result !== undefined);
        request.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Get the best available cached version of a page.
   * Tries scales from highest to lowest, returning the first available.
   *
   * This enables instant display: show thumbnail/low-res immediately
   * while full resolution loads in background.
   *
   * @param pdfId PDF document ID
   * @param page Page number
   * @param preferredScale Preferred scale (will try this and lower)
   * @returns Cached blob and its scale, or null if nothing cached
   */
  async getBestAvailable(
    pdfId: string,
    page: number,
    preferredScale: number = 2.0
  ): Promise<{ blob: Blob; scale: number } | null> {
    // Common scales to check, from highest to lowest
    // Includes thumbnail scale (72 DPI = 1.0 scale) as fallback
    const scalesToCheck = [preferredScale, 2.0, 1.5, 1.0].filter(
      (s) => s <= preferredScale
    );

    // Deduplicate and sort descending
    const uniqueScales = [...new Set(scalesToCheck)].sort((a, b) => b - a);

    for (const scale of uniqueScales) {
      const blob = await this.get(pdfId, page, scale);
      if (blob) {
        return { blob, scale };
      }
    }

    return null;
  }

  /**
   * Add to memory cache with LRU eviction
   */
  private addToMemory(key: string, blob: Blob): void {
    // If already exists, move to end (most recently used)
    if (this.memoryCache.has(key)) {
      this.memoryCache.delete(key);
    }

    this.memoryCache.set(key, blob);

    // Evict oldest if over limit
    if (this.memoryCache.size > this.maxMemoryEntries) {
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey) {
        this.memoryCache.delete(firstKey);
      }
    }
  }

  /**
   * Evict entries older than maxAgeMs
   */
  private async evictOldEntries(): Promise<void> {
    if (!this.db) return;

    const cutoffTime = Date.now() - this.maxAgeMs;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const index = store.index('timestamp');
        const range = IDBKeyRange.upperBound(cutoffTime);
        const request = index.openCursor(range);

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };

        tx.oncomplete = () => {
          console.log('[PdfCache] Evicted old entries');
          resolve();
        };
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Clear all cached pages for a specific PDF
   */
  async clearPdf(pdfId: string): Promise<void> {
    // Clear from memory
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(`${pdfId}-`)) {
        this.memoryCache.delete(key);
      }
    }

    // Clear from IndexedDB
    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const index = store.index('pdfId');
        const request = index.openCursor(IDBKeyRange.only(pdfId));

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Clear the entire cache
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();

    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.clear();

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Get cache statistics
   */
  getStats(): { memorySize: number; maxMemory: number } {
    return {
      memorySize: this.memoryCache.size,
      maxMemory: this.maxMemoryEntries,
    };
  }

  /**
   * Destroy the cache (close IndexedDB connection)
   */
  destroy(): void {
    // Cancel pending flush
    if (this.flushTimeoutId) {
      clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
    }

    // Flush any pending writes before closing
    if (this.db && this.writeQueue.length > 0) {
      this.flushWrites();
    }

    this.memoryCache.clear();
    this.writeQueue = [];

    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }
}
