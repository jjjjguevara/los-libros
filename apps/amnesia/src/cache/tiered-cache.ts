/**
 * Tiered Cache
 *
 * 3-tier caching system that provides fast access with persistence:
 * - L1: Memory (LRU) - 50MB, fastest access
 * - L2: IndexedDB - 500MB, persistent across sessions
 * - L3: Server/Provider - unlimited, requires network
 *
 * Features:
 * - Automatic promotion (L3 → L2 → L1 on access)
 * - Write-through to L2 on set
 * - Graceful fallback when layers unavailable
 * - Unified statistics across all tiers
 *
 * @see docs/specifications/file-system-architecture.md
 */

import { BinaryCache, type LRUCacheConfig, type CacheStats as L1Stats } from './lru-cache';
import {
  IndexedDBStore,
  type IndexedDBStoreConfig,
  type StoreStats as L2Stats,
} from './indexed-db-store';

// ============================================================================
// Types
// ============================================================================

/**
 * Resource data returned from cache
 */
export interface CachedResource {
  /** Binary data */
  data: ArrayBuffer;
  /** MIME type */
  mimeType: string;
  /** Blob URL (only for L1 hits) */
  blobUrl?: string;
  /** Cache tier that provided the data */
  tier: 'L1' | 'L2' | 'L3';
  /** Access latency in ms */
  latency: number;
}

/**
 * Remote data provider (L3)
 */
export interface RemoteProvider {
  /** Fetch resource from server/WASM */
  getResource(bookId: string, href: string): Promise<Uint8Array>;
  /** Get MIME type for a resource */
  getMimeType?(bookId: string, href: string): string;
}

/**
 * Tiered cache configuration
 */
export interface TieredCacheConfig {
  /** L1 (memory) configuration */
  l1: Partial<LRUCacheConfig>;
  /** L2 (IndexedDB) configuration */
  l2: Partial<IndexedDBStoreConfig>;
  /** Enable L2 persistence */
  enableL2: boolean;
  /** Enable automatic promotion from L2 to L1 */
  promoteOnAccess: boolean;
  /** Enable write-through to L2 on set */
  writeThrough: boolean;
}

/**
 * Combined cache statistics
 */
export interface TieredCacheStats {
  /** L1 (memory) stats */
  l1: L1Stats;
  /** L2 (IndexedDB) stats */
  l2: L2Stats | null;
  /** Combined statistics */
  combined: {
    /** Total cache size */
    totalSizeBytes: number;
    /** Total entries */
    totalEntries: number;
    /** Hits by tier */
    hitsByTier: { L1: number; L2: number; L3: number };
    /** Overall hit ratio */
    hitRatio: number;
  };
}

/**
 * Default tiered cache configuration
 */
export const DEFAULT_TIERED_CONFIG: TieredCacheConfig = {
  l1: {
    maxSizeBytes: 50 * 1024 * 1024, // 50MB
    maxEntries: 500,
  },
  l2: {
    maxSizeBytes: 500 * 1024 * 1024, // 500MB
    maxEntries: 5000,
  },
  enableL2: true,
  promoteOnAccess: true,
  writeThrough: true,
};

// ============================================================================
// Tiered Cache
// ============================================================================

export class TieredCache {
  private config: TieredCacheConfig;
  private l1: BinaryCache;
  private l2: IndexedDBStore | null = null;
  private provider: RemoteProvider;

  // Statistics
  private l1Hits: number = 0;
  private l2Hits: number = 0;
  private l3Hits: number = 0;
  private totalRequests: number = 0;

  constructor(provider: RemoteProvider, config: Partial<TieredCacheConfig> = {}) {
    this.config = { ...DEFAULT_TIERED_CONFIG, ...config };
    this.provider = provider;

    // Initialize L1 (memory cache)
    this.l1 = new BinaryCache(this.config.l1);

    // Initialize L2 if enabled
    if (this.config.enableL2) {
      this.l2 = new IndexedDBStore(this.config.l2);
    }
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the cache (required for L2)
   */
  async init(): Promise<void> {
    if (this.l2) {
      await this.l2.init();
    }
  }

  // ==========================================================================
  // Core Operations
  // ==========================================================================

  /**
   * Get a resource from the cache hierarchy
   * Checks L1 → L2 → L3, promoting on access
   */
  async get(bookId: string, href: string): Promise<CachedResource> {
    const startTime = performance.now();
    this.totalRequests++;
    const key = this.makeKey(bookId, href);

    // Check L1 (memory)
    const l1Entry = this.l1.get(key);
    if (l1Entry) {
      this.l1Hits++;
      return {
        data: l1Entry.data,
        mimeType: l1Entry.mimeType,
        blobUrl: this.l1.getBlobUrl(key) || undefined,
        tier: 'L1',
        latency: performance.now() - startTime,
      };
    }

    // Check L2 (IndexedDB)
    if (this.l2) {
      try {
        const l2Entry = await this.l2.get(key);
        if (l2Entry) {
          this.l2Hits++;

          // Promote to L1
          if (this.config.promoteOnAccess) {
            this.l1.setBinary(key, l2Entry.data, l2Entry.mimeType, l2Entry.metadata);
          }

          return {
            data: l2Entry.data,
            mimeType: l2Entry.mimeType,
            blobUrl: this.config.promoteOnAccess
              ? this.l1.getBlobUrl(key) || undefined
              : undefined,
            tier: 'L2',
            latency: performance.now() - startTime,
          };
        }
      } catch (error) {
        console.warn('[TieredCache] L2 get failed:', error);
      }
    }

    // Fetch from L3 (remote provider)
    const bytes = await this.provider.getResource(bookId, href);
    const data = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;

    const mimeType = this.provider.getMimeType?.(bookId, href) || this.guessMimeType(href);

    this.l3Hits++;

    // Store in caches
    await this.set(bookId, href, data, mimeType);

    return {
      data,
      mimeType,
      blobUrl: this.l1.getBlobUrl(key) || undefined,
      tier: 'L3',
      latency: performance.now() - startTime,
    };
  }

  /**
   * Store a resource in the cache
   * Writes to L1 and optionally L2
   */
  async set(
    bookId: string,
    href: string,
    data: ArrayBuffer,
    mimeType: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const key = this.makeKey(bookId, href);

    // Always write to L1
    this.l1.setBinary(key, data, mimeType, metadata);

    // Write-through to L2 if enabled
    if (this.l2 && this.config.writeThrough) {
      try {
        await this.l2.set(bookId, href, data, mimeType, metadata);
      } catch (error) {
        console.warn('[TieredCache] L2 set failed:', error);
      }
    }
  }

  /**
   * Check if a resource is cached (L1 or L2)
   */
  async has(bookId: string, href: string): Promise<boolean> {
    const key = this.makeKey(bookId, href);

    // Check L1
    if (this.l1.has(key)) {
      return true;
    }

    // Check L2
    if (this.l2) {
      try {
        return await this.l2.has(key);
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Delete a resource from all cache tiers
   */
  async delete(bookId: string, href: string): Promise<void> {
    const key = this.makeKey(bookId, href);

    this.l1.delete(key);

    if (this.l2) {
      try {
        await this.l2.delete(key);
      } catch (error) {
        console.warn('[TieredCache] L2 delete failed:', error);
      }
    }
  }

  /**
   * Clear all caches
   */
  async clear(): Promise<void> {
    this.l1.clear();

    if (this.l2) {
      try {
        await this.l2.clear();
      } catch (error) {
        console.warn('[TieredCache] L2 clear failed:', error);
      }
    }

    this.resetStats();
  }

  // ==========================================================================
  // Book-Level Operations
  // ==========================================================================

  /**
   * Delete all cached resources for a book
   */
  async deleteBook(bookId: string): Promise<void> {
    const prefix = `${bookId}:`;

    // Clear from L1
    this.l1.deleteByPrefix(prefix);

    // Clear from L2
    if (this.l2) {
      try {
        await this.l2.deleteBook(bookId);
      } catch (error) {
        console.warn('[TieredCache] L2 deleteBook failed:', error);
      }
    }
  }

  /**
   * Preload resources into cache
   */
  async preload(
    bookId: string,
    hrefs: string[],
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    for (let i = 0; i < hrefs.length; i++) {
      const href = hrefs[i];

      // Skip if already cached
      if (await this.has(bookId, href)) {
        onProgress?.(i + 1, hrefs.length);
        continue;
      }

      try {
        await this.get(bookId, href);
      } catch (error) {
        console.warn(`[TieredCache] Failed to preload ${href}:`, error);
      }

      onProgress?.(i + 1, hrefs.length);
    }
  }

  /**
   * Check which resources are cached for a book
   */
  async getCachedHrefs(bookId: string): Promise<string[]> {
    const hrefs: Set<string> = new Set();
    const prefix = `${bookId}:`;

    // Check L1
    for (const key of this.l1.keys()) {
      if (key.startsWith(prefix)) {
        hrefs.add(key.substring(prefix.length));
      }
    }

    // Check L2
    if (this.l2) {
      try {
        const entries = await this.l2.getBookEntries(bookId);
        for (const entry of entries) {
          hrefs.add(entry.href);
        }
      } catch (error) {
        console.warn('[TieredCache] L2 getCachedHrefs failed:', error);
      }
    }

    return Array.from(hrefs);
  }

  // ==========================================================================
  // Blob URL Management
  // ==========================================================================

  /**
   * Get or create a blob URL for a cached resource
   */
  async getBlobUrl(bookId: string, href: string): Promise<string> {
    const key = this.makeKey(bookId, href);

    // Check if L1 already has it
    const existingUrl = this.l1.getBlobUrl(key);
    if (existingUrl) {
      return existingUrl;
    }

    // Fetch to L1 and get URL
    await this.get(bookId, href);
    const url = this.l1.getBlobUrl(key);

    if (!url) {
      throw new Error(`Failed to get blob URL for ${href}`);
    }

    return url;
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get combined cache statistics
   */
  async getStats(): Promise<TieredCacheStats> {
    const l1Stats = this.l1.getStats();
    let l2Stats: L2Stats | null = null;

    if (this.l2) {
      try {
        l2Stats = await this.l2.getStats();
      } catch {
        l2Stats = null;
      }
    }

    const totalHits = this.l1Hits + this.l2Hits + this.l3Hits;

    return {
      l1: l1Stats,
      l2: l2Stats,
      combined: {
        totalSizeBytes: l1Stats.sizeBytes + (l2Stats?.sizeBytes || 0),
        totalEntries: l1Stats.entries + (l2Stats?.entries || 0),
        hitsByTier: {
          L1: this.l1Hits,
          L2: this.l2Hits,
          L3: this.l3Hits,
        },
        hitRatio: this.totalRequests > 0 ? totalHits / this.totalRequests : 0,
      },
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.l1.resetStats();
    this.l1Hits = 0;
    this.l2Hits = 0;
    this.l3Hits = 0;
    this.totalRequests = 0;
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Enable or disable L2 (IndexedDB)
   */
  async setL2Enabled(enabled: boolean): Promise<void> {
    if (enabled && !this.l2) {
      this.l2 = new IndexedDBStore(this.config.l2);
      await this.l2.init();
    } else if (!enabled && this.l2) {
      this.l2.close();
      this.l2 = null;
    }

    this.config.enableL2 = enabled;
  }

  /**
   * Get current configuration
   */
  getConfig(): TieredCacheConfig {
    return { ...this.config };
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Make a cache key
   */
  private makeKey(bookId: string, href: string): string {
    return `${bookId}:${href}`;
  }

  /**
   * Guess MIME type from file extension
   */
  private guessMimeType(href: string): string {
    const ext = href.split('.').pop()?.toLowerCase() || '';

    const mimeMap: Record<string, string> = {
      // Documents
      xhtml: 'application/xhtml+xml',
      html: 'text/html',
      htm: 'text/html',
      xml: 'application/xml',
      css: 'text/css',
      // Images
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      // Fonts
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      otf: 'font/otf',
      // Audio
      mp3: 'audio/mpeg',
      ogg: 'audio/ogg',
      wav: 'audio/wav',
      // Video
      mp4: 'video/mp4',
      webm: 'video/webm',
    };

    return mimeMap[ext] || 'application/octet-stream';
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Close the cache and release resources
   */
  close(): void {
    this.l1.clear();
    if (this.l2) {
      this.l2.close();
    }
  }

  /**
   * Destroy the cache completely (including L2 database)
   */
  async destroy(): Promise<void> {
    this.l1.clear();
    if (this.l2) {
      await this.l2.destroy();
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

let cacheInstance: TieredCache | null = null;

/**
 * Get or create the tiered cache singleton
 */
export function getTieredCache(
  provider: RemoteProvider,
  config?: Partial<TieredCacheConfig>
): TieredCache {
  if (!cacheInstance) {
    cacheInstance = new TieredCache(provider, config);
  }
  return cacheInstance;
}

/**
 * Create a new tiered cache instance
 */
export function createTieredCache(
  provider: RemoteProvider,
  config?: Partial<TieredCacheConfig>
): TieredCache {
  return new TieredCache(provider, config);
}
