/**
 * Tile Cache Manager
 *
 * 3-tier cache system inspired by Preview.app's caching strategy:
 *
 * - **L1 Cache**: Visible tiles as ImageBitmaps (GPU-ready)
 *   - Fast access for currently visible tiles
 *   - Limited size (50 tiles = ~6 pages)
 *   - Evicted on mode transition
 *
 * - **L2 Cache**: Prefetched tiles as Blobs
 *   - Quick decode to ImageBitmap
 *   - Larger capacity (200 tiles = ~25 pages)
 *   - Preserved across mode transitions
 *
 * - **L3 Cache**: Document metadata (page dimensions, text layer refs)
 *   - Never evicted during session
 *   - Shared across all modes
 *
 * @example
 * ```typescript
 * const cacheManager = getTileCacheManager();
 * const tile = { page: 1, tileX: 0, tileY: 0, scale: 2 };
 *
 * // Try to get tile from cache
 * const bitmap = await cacheManager.get(tile);
 * if (!bitmap) {
 *   // Render and cache
 *   const blob = await renderTile(tile);
 *   await cacheManager.set(tile, blob, 'L2');
 * }
 * ```
 */

import { getTelemetry } from './pdf-telemetry';
import type { TileCoordinate, TileScale } from './tile-render-engine';

/** Page metadata cached in L3 */
export interface PageMetadata {
  page: number;
  width: number;
  height: number;
  hasTextLayer: boolean;
  textLayerData?: unknown; // Cached text layer
}

/** L1/L2 cache entry with timestamp for LRU */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  size: number; // Approximate size in bytes
}

/**
 * Simple LRU cache implementation with optional cleanup callback
 */
class LRUCache<K, V> {
  private cache = new Map<K, CacheEntry<V>>();
  private maxSize: number;
  private currentSize = 0;
  private maxBytes: number;
  private onEvict?: (value: V) => void;

  constructor(options: { maxSize?: number; maxBytes?: number; onEvict?: (value: V) => void }) {
    this.maxSize = options.maxSize ?? 100;
    this.maxBytes = options.maxBytes ?? 100 * 1024 * 1024; // 100MB default
    this.onEvict = options.onEvict;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      // Update timestamp (move to end for LRU)
      entry.timestamp = Date.now();
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry.value;
    }
    return undefined;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  set(key: K, value: V, size: number = 0): void {
    // Remove existing entry if present
    if (this.cache.has(key)) {
      const existing = this.cache.get(key)!;
      this.currentSize -= existing.size;
      this.cache.delete(key);
    }

    // Evict entries if over limits
    while (
      (this.cache.size >= this.maxSize || this.currentSize + size > this.maxBytes) &&
      this.cache.size > 0
    ) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        const oldest = this.cache.get(oldestKey)!;
        // Call cleanup callback before evicting (e.g., ImageBitmap.close())
        this.onEvict?.(oldest.value);
        this.currentSize -= oldest.size;
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { value, timestamp: Date.now(), size });
    this.currentSize += size;
  }

  delete(key: K): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentSize -= entry.size;
      return this.cache.delete(key);
    }
    return false;
  }

  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  get bytes(): number {
    return this.currentSize;
  }

  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  entries(): IterableIterator<[K, CacheEntry<V>]> {
    return this.cache.entries();
  }
}

/**
 * Tile Cache Manager with 2-tier caching
 *
 * NOTE: We store Blobs only (not ImageBitmaps) to avoid lifecycle issues.
 * ImageBitmaps are created fresh on each get() call - the caller owns them
 * and is responsible for closing them after use.
 */
export class TileCacheManager {
  /** L1: Hot tiles as Blobs (recently accessed, smaller capacity) */
  private l1Cache: LRUCache<string, Blob>;

  /** L2: Prefetched tiles as Blobs (larger capacity) */
  private l2Cache: LRUCache<string, Blob>;

  /** L3: Document metadata cache */
  private l3Cache: Map<number, PageMetadata>;

  /** Current document ID */
  private documentId: string | null = null;

  constructor(options?: {
    l1MaxSize?: number;
    l2MaxSize?: number;
    l2MaxBytes?: number;
  }) {
    // L1: 50 tiles (~6 pages at 256×256) - hot tiles, no eviction callback needed
    this.l1Cache = new LRUCache<string, Blob>({
      maxSize: options?.l1MaxSize ?? 50,
    });

    // L2: 200 tiles (~25 pages), 200MB max
    this.l2Cache = new LRUCache<string, Blob>({
      maxSize: options?.l2MaxSize ?? 200,
      maxBytes: options?.l2MaxBytes ?? 200 * 1024 * 1024,
    });

    // L3: Unbounded metadata cache
    this.l3Cache = new Map();
  }

  /**
   * Set the current document ID
   */
  setDocument(docId: string): void {
    if (this.documentId !== docId) {
      // Clear L1/L2 when switching documents
      this.l1Cache.clear();
      this.l2Cache.clear();
      this.l3Cache.clear();
      this.documentId = docId;
    }
  }

  /**
   * Get tile cache key
   */
  private getTileKey(tile: TileCoordinate): string {
    return `${this.documentId}-p${tile.page}-t${tile.tileX}x${tile.tileY}-s${tile.scale}`;
  }

  /**
   * Get a tile from cache as a fresh ImageBitmap
   *
   * Checks L1 first, then L2. Creates a new ImageBitmap from cached Blob.
   * The caller owns the returned ImageBitmap and should close() it after use.
   *
   * Returns null if not cached
   */
  async get(tile: TileCoordinate): Promise<ImageBitmap | null> {
    const key = this.getTileKey(tile);
    const telemetry = getTelemetry();

    // L1 check (hot tiles)
    const l1Result = this.l1Cache.get(key);
    if (l1Result) {
      telemetry.trackCacheAccess('L1', true);
      try {
        // Create fresh ImageBitmap - caller owns it
        return await createImageBitmap(l1Result);
      } catch (error) {
        console.warn('[TileCacheManager] Failed to decode L1 blob:', error);
        this.l1Cache.delete(key);
      }
    }
    telemetry.trackCacheAccess('L1', false);

    // L2 check (prefetched tiles)
    const l2Result = this.l2Cache.get(key);
    if (l2Result) {
      telemetry.trackCacheAccess('L2', true);
      try {
        // Create fresh ImageBitmap - caller owns it
        const bitmap = await createImageBitmap(l2Result);
        // Promote to L1
        this.l1Cache.set(key, l2Result, l2Result.size);
        return bitmap;
      } catch (error) {
        console.warn('[TileCacheManager] Failed to decode L2 blob:', error);
        this.l2Cache.delete(key);
      }
    }
    telemetry.trackCacheAccess('L2', false);

    return null;
  }

  /**
   * Get tile as Blob (without decoding to ImageBitmap)
   */
  async getBlob(tile: TileCoordinate): Promise<Blob | null> {
    const key = this.getTileKey(tile);

    // Check L2 directly
    const l2Result = this.l2Cache.get(key);
    if (l2Result) {
      return l2Result;
    }

    return null;
  }

  /**
   * Check if tile is cached (L1 or L2)
   */
  has(tile: TileCoordinate): boolean {
    const key = this.getTileKey(tile);
    return this.l1Cache.has(key) || this.l2Cache.has(key);
  }

  /**
   * Set a tile in cache
   *
   * @param tile Tile coordinate
   * @param data Blob (ImageBitmaps are not stored - only Blobs for lifecycle safety)
   * @param tier Which tier to cache in ('L1' for hot, 'L2' for prefetch)
   */
  async set(
    tile: TileCoordinate,
    data: Blob,
    tier: 'L1' | 'L2' = 'L2'
  ): Promise<void> {
    const key = this.getTileKey(tile);

    // Always store in L2 (larger capacity)
    this.l2Cache.set(key, data, data.size);

    // If L1 requested, also store in hot cache
    if (tier === 'L1') {
      this.l1Cache.set(key, data, data.size);
    }
  }

  /**
   * Get low-res tile as fallback
   *
   * If high-res (scale=2) tile isn't available, try to get low-res (scale=1)
   */
  async getFallback(tile: TileCoordinate): Promise<ImageBitmap | null> {
    // If already requesting low-res, no fallback
    if (tile.scale === 1) {
      return null;
    }

    // Try low-res version
    const lowResTile: TileCoordinate = { ...tile, scale: 1 };
    return this.get(lowResTile);
  }

  /**
   * Get page metadata from L3 cache
   */
  getPageMetadata(page: number): PageMetadata | undefined {
    const result = this.l3Cache.get(page);
    if (result) {
      getTelemetry().trackCacheAccess('L3', true);
    } else {
      getTelemetry().trackCacheAccess('L3', false);
    }
    return result;
  }

  /**
   * Set page metadata in L3 cache
   */
  setPageMetadata(page: number, metadata: PageMetadata): void {
    this.l3Cache.set(page, metadata);
  }

  /**
   * Called on mode transition (paginated ↔ scroll ↔ grid)
   *
   * User decision: Only evict L1, keep L2/L3
   * This allows tiles rendered in one mode to be reused in another
   */
  onModeTransition(): void {
    // Clear L1 only (hot tiles)
    // Since we store Blobs, no need to close anything
    this.l1Cache.clear();

    // L2 and L3 preserved for cross-mode sharing
  }

  /**
   * Evict tiles that are no longer near the viewport
   *
   * Called during scroll to free memory for new tiles
   */
  evictDistantTiles(
    currentPage: number,
    keepRadius: number = 5
  ): void {
    const keysToEvict: string[] = [];

    for (const key of this.l1Cache.keys()) {
      const match = key.match(/-p(\d+)-/);
      if (match) {
        const tilePage = parseInt(match[1], 10);
        if (Math.abs(tilePage - currentPage) > keepRadius) {
          keysToEvict.push(key);
        }
      }
    }

    for (const key of keysToEvict) {
      this.l1Cache.delete(key);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    l1Count: number;
    l1Bytes: number;
    l2Count: number;
    l2Bytes: number;
    l3Count: number;
  } {
    return {
      l1Count: this.l1Cache.size,
      l1Bytes: this.l1Cache.bytes,
      l2Count: this.l2Cache.size,
      l2Bytes: this.l2Cache.bytes,
      l3Count: this.l3Cache.size,
    };
  }

  /**
   * Clear all caches
   */
  clear(): void {
    // Since we store Blobs (not ImageBitmaps), no need to close anything
    this.l1Cache.clear();
    this.l2Cache.clear();
    this.l3Cache.clear();
    this.documentId = null;
  }
}

// Singleton instance
let tileCacheManagerInstance: TileCacheManager | null = null;

/**
 * Get the shared tile cache manager instance
 */
export function getTileCacheManager(): TileCacheManager {
  if (!tileCacheManagerInstance) {
    tileCacheManagerInstance = new TileCacheManager();
  }
  return tileCacheManagerInstance;
}

/**
 * Reset the tile cache manager (for testing)
 */
export function resetTileCacheManager(): void {
  if (tileCacheManagerInstance) {
    tileCacheManagerInstance.clear();
  }
  tileCacheManagerInstance = null;
}
