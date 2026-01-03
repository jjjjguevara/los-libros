/**
 * LRU Cache
 *
 * A generic Least Recently Used (LRU) cache with configurable size limits.
 * Supports both entry count and byte size limits with automatic eviction.
 *
 * Features:
 * - O(1) get/set operations
 * - Size-based eviction (bytes)
 * - Entry count limits
 * - TTL (time-to-live) support
 * - Statistics tracking
 * - Event callbacks for eviction
 *
 * @see docs/specifications/file-system-architecture.md
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T> {
  /** The cached value */
  value: T;
  /** Size in bytes */
  size: number;
  /** Creation timestamp */
  createdAt: number;
  /** Last access timestamp */
  accessedAt: number;
  /** Access count */
  accessCount: number;
  /** Optional TTL expiry timestamp */
  expiresAt?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Cache configuration
 */
export interface LRUCacheConfig {
  /** Maximum size in bytes (default: 50MB) */
  maxSizeBytes: number;
  /** Maximum number of entries (default: 1000) */
  maxEntries: number;
  /** Default TTL in milliseconds (0 = no expiry) */
  defaultTTL: number;
  /** Callback when entry is evicted */
  onEvict?: (key: string, entry: CacheEntry<unknown>) => void;
  /** Callback when entry expires */
  onExpire?: (key: string, entry: CacheEntry<unknown>) => void;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Number of entries */
  entries: number;
  /** Total size in bytes */
  sizeBytes: number;
  /** Maximum size in bytes */
  maxSizeBytes: number;
  /** Maximum entries */
  maxEntries: number;
  /** Cache hits */
  hits: number;
  /** Cache misses */
  misses: number;
  /** Hit ratio (0-1) */
  hitRatio: number;
  /** Number of evictions */
  evictions: number;
  /** Number of expirations */
  expirations: number;
}

/**
 * Default cache configuration
 */
export const DEFAULT_LRU_CONFIG: LRUCacheConfig = {
  maxSizeBytes: 50 * 1024 * 1024, // 50MB
  maxEntries: 1000,
  defaultTTL: 0, // No expiry
};

// ============================================================================
// LRU Cache Implementation
// ============================================================================

/**
 * Doubly linked list node for O(1) LRU operations
 */
class LRUNode<T> {
  key: string;
  entry: CacheEntry<T>;
  prev: LRUNode<T> | null = null;
  next: LRUNode<T> | null = null;

  constructor(key: string, entry: CacheEntry<T>) {
    this.key = key;
    this.entry = entry;
  }
}

/**
 * Generic LRU Cache
 */
export class LRUCache<T> {
  private config: LRUCacheConfig;
  private cache: Map<string, LRUNode<T>> = new Map();
  private head: LRUNode<T> | null = null;
  private tail: LRUNode<T> | null = null;
  private currentSize: number = 0;

  // Statistics
  private hits: number = 0;
  private misses: number = 0;
  private evictions: number = 0;
  private expirations: number = 0;

  constructor(config: Partial<LRUCacheConfig> = {}) {
    this.config = { ...DEFAULT_LRU_CONFIG, ...config };
  }

  // ==========================================================================
  // Core Operations
  // ==========================================================================

  /**
   * Get a value from the cache
   */
  get(key: string): T | null {
    const node = this.cache.get(key);

    if (!node) {
      this.misses++;
      return null;
    }

    // Check expiration
    if (this.isExpired(node.entry)) {
      this.delete(key);
      this.expirations++;
      if (this.config.onExpire) {
        this.config.onExpire(key, node.entry as CacheEntry<unknown>);
      }
      this.misses++;
      return null;
    }

    // Update access metadata
    node.entry.accessedAt = Date.now();
    node.entry.accessCount++;

    // Move to front (most recently used)
    this.moveToFront(node);

    this.hits++;
    return node.entry.value;
  }

  /**
   * Set a value in the cache
   */
  set(
    key: string,
    value: T,
    size: number,
    options?: { ttl?: number; metadata?: Record<string, unknown> }
  ): void {
    const now = Date.now();
    const ttl = options?.ttl ?? this.config.defaultTTL;

    // Create entry
    const entry: CacheEntry<T> = {
      value,
      size,
      createdAt: now,
      accessedAt: now,
      accessCount: 1,
      expiresAt: ttl > 0 ? now + ttl : undefined,
      metadata: options?.metadata,
    };

    // Check if key exists
    const existingNode = this.cache.get(key);
    if (existingNode) {
      // Update size tracking
      this.currentSize -= existingNode.entry.size;
      existingNode.entry = entry;
      this.currentSize += size;
      this.moveToFront(existingNode);
      return;
    }

    // Evict if necessary
    this.evictIfNeeded(size);

    // Create new node
    const node = new LRUNode(key, entry);
    this.cache.set(key, node);
    this.currentSize += size;
    this.addToFront(node);
  }

  /**
   * Check if key exists (without updating access time)
   */
  has(key: string): boolean {
    const node = this.cache.get(key);
    if (!node) return false;

    if (this.isExpired(node.entry)) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Peek at a value without updating access time
   */
  peek(key: string): T | null {
    const node = this.cache.get(key);
    if (!node) return null;

    if (this.isExpired(node.entry)) {
      this.delete(key);
      return null;
    }

    return node.entry.value;
  }

  /**
   * Delete an entry
   */
  delete(key: string): boolean {
    const node = this.cache.get(key);
    if (!node) return false;

    this.removeNode(node);
    this.cache.delete(key);
    this.currentSize -= node.entry.size;

    return true;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    // Call eviction callback for all entries
    if (this.config.onEvict) {
      for (const [key, node] of this.cache) {
        this.config.onEvict(key, node.entry as CacheEntry<unknown>);
      }
    }

    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.currentSize = 0;
    this.evictions += this.cache.size;
  }

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  /**
   * Get multiple values
   */
  getMany(keys: string[]): Map<string, T> {
    const results = new Map<string, T>();

    for (const key of keys) {
      const value = this.get(key);
      if (value !== null) {
        results.set(key, value);
      }
    }

    return results;
  }

  /**
   * Set multiple values
   */
  setMany(entries: Array<{ key: string; value: T; size: number }>): void {
    for (const { key, value, size } of entries) {
      this.set(key, value, size);
    }
  }

  /**
   * Delete entries matching a prefix
   */
  deleteByPrefix(prefix: string): number {
    const toDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.delete(key);
    }

    return toDelete.length;
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get all entries (ordered by recency, most recent first)
   */
  entries(): Array<{ key: string; entry: CacheEntry<T> }> {
    const result: Array<{ key: string; entry: CacheEntry<T> }> = [];
    let node = this.head;

    while (node) {
      if (!this.isExpired(node.entry)) {
        result.push({ key: node.key, entry: node.entry });
      }
      node = node.next;
    }

    return result;
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.hits + this.misses;

    return {
      entries: this.cache.size,
      sizeBytes: this.currentSize,
      maxSizeBytes: this.config.maxSizeBytes,
      maxEntries: this.config.maxEntries,
      hits: this.hits,
      misses: this.misses,
      hitRatio: totalRequests > 0 ? this.hits / totalRequests : 0,
      evictions: this.evictions,
      expirations: this.expirations,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.expirations = 0;
  }

  /**
   * Get current size in bytes
   */
  get size(): number {
    return this.currentSize;
  }

  /**
   * Get entry count
   */
  get count(): number {
    return this.cache.size;
  }

  // ==========================================================================
  // Maintenance
  // ==========================================================================

  /**
   * Prune expired entries
   */
  prune(): number {
    const toDelete: string[] = [];

    for (const [key, node] of this.cache) {
      if (this.isExpired(node.entry)) {
        toDelete.push(key);
        if (this.config.onExpire) {
          this.config.onExpire(key, node.entry as CacheEntry<unknown>);
        }
      }
    }

    for (const key of toDelete) {
      this.delete(key);
    }

    this.expirations += toDelete.length;
    return toDelete.length;
  }

  /**
   * Resize the cache (evicts if necessary)
   */
  resize(maxSizeBytes: number, maxEntries?: number): void {
    this.config.maxSizeBytes = maxSizeBytes;
    if (maxEntries !== undefined) {
      this.config.maxEntries = maxEntries;
    }

    // Evict excess entries
    this.evictIfNeeded(0);
  }

  // ==========================================================================
  // Internal: Linked List Operations
  // ==========================================================================

  private addToFront(node: LRUNode<T>): void {
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }

    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: LRUNode<T>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  private moveToFront(node: LRUNode<T>): void {
    if (node === this.head) return;

    this.removeNode(node);
    this.addToFront(node);
  }

  // ==========================================================================
  // Internal: Eviction
  // ==========================================================================

  private evictIfNeeded(incomingSize: number): void {
    // Evict by size
    while (
      this.currentSize + incomingSize > this.config.maxSizeBytes &&
      this.tail
    ) {
      this.evictOldest();
    }

    // Evict by count
    while (this.cache.size >= this.config.maxEntries && this.tail) {
      this.evictOldest();
    }
  }

  private evictOldest(): void {
    if (!this.tail) return;

    const node = this.tail;
    this.removeNode(node);
    this.cache.delete(node.key);
    this.currentSize -= node.entry.size;
    this.evictions++;

    if (this.config.onEvict) {
      this.config.onEvict(node.key, node.entry as CacheEntry<unknown>);
    }
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    if (!entry.expiresAt) return false;
    return Date.now() > entry.expiresAt;
  }
}

// ============================================================================
// Specialized Caches
// ============================================================================

/**
 * Cache entry for binary data (ArrayBuffer, Uint8Array)
 */
export interface BinaryCacheEntry {
  data: ArrayBuffer;
  mimeType: string;
  metadata?: Record<string, unknown>;
}

/**
 * Binary data cache with blob URL management
 */
export class BinaryCache extends LRUCache<BinaryCacheEntry> {
  private blobUrls: Map<string, string> = new Map();

  constructor(config: Partial<LRUCacheConfig> = {}) {
    super({
      ...config,
      onEvict: (key, entry) => {
        // Revoke blob URL on eviction
        const url = this.blobUrls.get(key);
        if (url) {
          URL.revokeObjectURL(url);
          this.blobUrls.delete(key);
        }
        // Call original callback
        config.onEvict?.(key, entry);
      },
    });
  }

  /**
   * Get or create blob URL for an entry
   */
  getBlobUrl(key: string): string | null {
    // Check existing URL
    const existingUrl = this.blobUrls.get(key);
    if (existingUrl) {
      // Verify entry still exists
      if (this.has(key)) {
        return existingUrl;
      }
      // Entry was evicted, clean up URL
      URL.revokeObjectURL(existingUrl);
      this.blobUrls.delete(key);
    }

    // Get entry and create URL
    const entry = this.get(key);
    if (!entry) return null;

    const blob = new Blob([entry.data], { type: entry.mimeType });
    const url = URL.createObjectURL(blob);
    this.blobUrls.set(key, url);

    return url;
  }

  /**
   * Set binary data with automatic size calculation
   */
  setBinary(
    key: string,
    data: ArrayBuffer,
    mimeType: string,
    metadata?: Record<string, unknown>
  ): void {
    this.set(key, { data, mimeType, metadata }, data.byteLength);
  }

  /**
   * Clear all blob URLs
   */
  override clear(): void {
    for (const url of this.blobUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls.clear();
    super.clear();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an LRU cache with default configuration
 */
export function createLRUCache<T>(
  config?: Partial<LRUCacheConfig>
): LRUCache<T> {
  return new LRUCache<T>(config);
}

/**
 * Create a binary cache for ArrayBuffer data
 */
export function createBinaryCache(
  config?: Partial<LRUCacheConfig>
): BinaryCache {
  return new BinaryCache(config);
}
