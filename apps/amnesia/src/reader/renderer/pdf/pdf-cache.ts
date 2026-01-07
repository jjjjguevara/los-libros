/**
 * PDF Page Cache with Byte-Based Memory Management
 *
 * Provides two-tier caching of rendered PDF pages:
 * - L1 (Memory): Fast, byte-limited, LRU eviction
 * - L2 (IndexedDB): Persistent, time-based eviction
 *
 * Features:
 * - Byte-based memory quota (not entry count)
 * - True LRU with access tracking
 * - Automatic promotion from L2 to L1 on access
 * - Background eviction of stale L2 entries
 */

interface CacheEntry {
  blob: Blob;
  timestamp: number;
  pdfId: string;
  page: number;
  scale: number;
  dpi: number;
  format: string;
  quality: number;
  sizeBytes: number;
}

/** Render options for cache key generation */
export interface CacheRenderOptions {
  /** @deprecated Use dpi instead. Ignored for cache key. */
  scale?: number;
  dpi?: number;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
}

/**
 * Standard DPI tiers for caching
 * Cache keys snap to these tiers for better cache hit rate
 * Higher tiers (600) support crisp rendering at high zoom levels
 * Note: 800+ DPI causes server failures on large pages (images too large to encode)
 */
export const DPI_TIERS = [72, 96, 150, 200, 300, 600] as const;
export type DpiTier = typeof DPI_TIERS[number];

/**
 * Select the nearest DPI tier for a target DPI value
 * Uses a 90% threshold to allow for slight underrequests
 */
export function selectDpiTier(targetDpi: number): DpiTier {
  for (const tier of DPI_TIERS) {
    if (tier >= targetDpi * 0.9) return tier;
  }
  return DPI_TIERS[DPI_TIERS.length - 1]; // Return highest tier
}

interface MemoryCacheEntry {
  blob: Blob;
  sizeBytes: number;
}

export interface CacheConfig {
  /** Maximum memory usage in bytes. Default: 100MB */
  maxMemoryBytes?: number;
  /** Maximum age for L2 entries in ms. Default: 7 days */
  maxAgeMs?: number;
  /** Enable L2 (IndexedDB) persistence. Default: true */
  enableL2?: boolean;
}

export interface CacheStats {
  /** Current L1 memory usage in bytes */
  memoryBytes: number;
  /** Maximum L1 memory in bytes */
  maxMemoryBytes: number;
  /** Number of entries in L1 */
  memoryEntries: number;
  /** Memory usage as percentage (0-100) */
  memoryUsagePercent: number;
}

export class PdfPageCache {
  private dbName = 'amnesia-pdf-cache';
  private storeName = 'pages';
  private dbVersion = 4; // Bumped: scale removed from cache key, DPI tiers used
  private db: IDBDatabase | null = null;

  // L1 Memory Cache - byte-limited with LRU
  private memoryCache: Map<string, MemoryCacheEntry> = new Map();
  private accessOrder: string[] = []; // LRU tracking: oldest first
  private currentMemoryBytes = 0;
  private maxMemoryBytes: number;

  // Configuration
  private maxAgeMs: number;
  private enableL2: boolean;
  private initialized = false;

  constructor(config: CacheConfig = {}) {
    this.maxMemoryBytes = config.maxMemoryBytes ?? 100 * 1024 * 1024; // 100MB default
    this.maxAgeMs = config.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
    this.enableL2 = config.enableL2 ?? true;
  }

  /**
   * Legacy constructor support - converts entry count to byte estimate
   * @deprecated Use CacheConfig object instead
   */
  static fromEntryCount(maxEntries: number): PdfPageCache {
    // Estimate ~500KB per page at 150 DPI
    const estimatedBytesPerPage = 500 * 1024;
    return new PdfPageCache({
      maxMemoryBytes: maxEntries * estimatedBytesPerPage,
    });
  }

  /**
   * Initialize the cache (opens IndexedDB if enabled)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.enableL2) {
      this.initialized = true;
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.warn('[PdfCache] Failed to open IndexedDB:', request.error);
        // Continue without L2 persistence
        this.enableL2 = false;
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

        // Delete old store if exists (schema change)
        if (db.objectStoreNames.contains(this.storeName)) {
          db.deleteObjectStore(this.storeName);
        }

        const store = db.createObjectStore(this.storeName);
        store.createIndex('pdfId', 'pdfId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      };
    });
  }

  /**
   * Generate cache key from page parameters including render options
   *
   * Note: Scale is ignored (deprecated). Only DPI is used for quality.
   * DPI is snapped to nearest tier (72, 96, 150, 200, 300) for better cache hits.
   */
  private getCacheKey(pdfId: string, page: number, options: CacheRenderOptions = {}): string {
    // Snap to nearest DPI tier for better cache reuse
    const dpi = selectDpiTier(options.dpi ?? 150);
    const format = options.format ?? 'png';
    const quality = options.quality ?? 85;
    // Scale is deprecated and not included in cache key
    return `${pdfId}-${page}-d${dpi}-${format}-q${quality}`;
  }

  /**
   * Get a cached page blob
   */
  async get(pdfId: string, page: number, options: CacheRenderOptions = {}): Promise<Blob | null> {
    const key = this.getCacheKey(pdfId, page, options);

    // Check L1 (memory) first
    const memoryEntry = this.memoryCache.get(key);
    if (memoryEntry) {
      // Update access order (move to end = most recently used)
      this.updateAccessOrder(key);
      return memoryEntry.blob;
    }

    // Check L2 (IndexedDB)
    if (!this.db) return null;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const request = store.get(key);

        request.onsuccess = () => {
          const entry = request.result as CacheEntry | undefined;
          if (entry && Date.now() - entry.timestamp < this.maxAgeMs) {
            // Promote to L1
            this.addToMemory(key, entry.blob, entry.sizeBytes);
            resolve(entry.blob);
          } else {
            resolve(null);
          }
        };

        request.onerror = () => {
          console.warn('[PdfCache] Failed to read from L2:', request.error);
          resolve(null);
        };
      } catch (error) {
        console.warn('[PdfCache] L2 transaction error:', error);
        resolve(null);
      }
    });
  }

  /**
   * Cache a page blob
   */
  async set(pdfId: string, page: number, options: CacheRenderOptions, blob: Blob): Promise<void> {
    // Reject invalid blobs at cache level (triple defense)
    const validImageTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!validImageTypes.includes(blob.type) || blob.size === 0) {
      console.warn(`[PdfCache] Rejecting invalid blob for page ${page}: type=${blob.type}, size=${blob.size}`);
      return;
    }

    const key = this.getCacheKey(pdfId, page, options);
    const sizeBytes = blob.size;

    // Add to L1 (memory)
    this.addToMemory(key, blob, sizeBytes);

    // Persist to L2 (IndexedDB)
    if (!this.db) return;

    const entry: CacheEntry = {
      blob,
      timestamp: Date.now(),
      pdfId,
      page,
      scale: options.scale ?? 1.5,
      dpi: options.dpi ?? 150,
      format: options.format ?? 'png',
      quality: options.quality ?? 85,
      sizeBytes,
    };

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.put(entry, key);

        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          console.warn('[PdfCache] Failed to write to L2:', tx.error);
          resolve();
        };
      } catch (error) {
        console.warn('[PdfCache] L2 write error:', error);
        resolve();
      }
    });
  }

  /**
   * Check if a page is cached (L1 or L2)
   */
  async has(pdfId: string, page: number, options: CacheRenderOptions = {}): Promise<boolean> {
    const key = this.getCacheKey(pdfId, page, options);

    // Check L1 first
    if (this.memoryCache.has(key)) {
      return true;
    }

    // Check L2
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
   * Add to L1 memory cache with byte-based LRU eviction
   */
  private addToMemory(key: string, blob: Blob, sizeBytes: number): void {
    // If already exists, remove first (will re-add with updated access)
    if (this.memoryCache.has(key)) {
      this.removeFromMemory(key);
    }

    // Evict until we have space
    while (this.currentMemoryBytes + sizeBytes > this.maxMemoryBytes && this.accessOrder.length > 0) {
      const oldestKey = this.accessOrder[0];
      this.removeFromMemory(oldestKey);
    }

    // Add new entry
    this.memoryCache.set(key, { blob, sizeBytes });
    this.accessOrder.push(key);
    this.currentMemoryBytes += sizeBytes;
  }

  /**
   * Remove from L1 memory cache
   */
  private removeFromMemory(key: string): void {
    const entry = this.memoryCache.get(key);
    if (entry) {
      this.currentMemoryBytes -= entry.sizeBytes;
      this.memoryCache.delete(key);

      // Remove from access order
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) {
        this.accessOrder.splice(idx, 1);
      }
    }
  }

  /**
   * Update access order for LRU (move to end = most recent)
   */
  private updateAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
      this.accessOrder.push(key);
    }
  }

  /**
   * Evict L2 entries older than maxAgeMs
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

        let evictedCount = 0;
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            evictedCount++;
            cursor.continue();
          }
        };

        tx.oncomplete = () => {
          if (evictedCount > 0) {
            console.log(`[PdfCache] Evicted ${evictedCount} stale L2 entries`);
          }
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
    // Clear from L1
    const keysToRemove: string[] = [];
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(`${pdfId}-`)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      this.removeFromMemory(key);
    }

    // Clear from L2
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
   * Clear the entire cache (L1 and L2)
   */
  async clear(): Promise<void> {
    // Clear L1
    this.memoryCache.clear();
    this.accessOrder = [];
    this.currentMemoryBytes = 0;

    // Clear L2
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
  getStats(): CacheStats {
    return {
      memoryBytes: this.currentMemoryBytes,
      maxMemoryBytes: this.maxMemoryBytes,
      memoryEntries: this.memoryCache.size,
      memoryUsagePercent: Math.round((this.currentMemoryBytes / this.maxMemoryBytes) * 100),
    };
  }

  /**
   * Update memory budget at runtime
   */
  setMemoryBudget(bytes: number): void {
    this.maxMemoryBytes = bytes;

    // Evict if over new limit
    while (this.currentMemoryBytes > this.maxMemoryBytes && this.accessOrder.length > 0) {
      const oldestKey = this.accessOrder[0];
      this.removeFromMemory(oldestKey);
    }
  }

  /**
   * Destroy the cache (close IndexedDB connection)
   */
  destroy(): void {
    this.memoryCache.clear();
    this.accessOrder = [];
    this.currentMemoryBytes = 0;

    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }
}
