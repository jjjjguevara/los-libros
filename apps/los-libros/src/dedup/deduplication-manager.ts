/**
 * Deduplication Manager
 *
 * Content-based deduplication for EPUB storage using SHA-256 hashing.
 * Detects identical books and resources to save storage space.
 *
 * Features:
 * - SHA-256 content hashing
 * - Book-level deduplication
 * - Resource-level deduplication
 * - Reference counting for cleanup
 * - Storage statistics
 *
 * @see docs/specifications/file-system-architecture.md
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Hash algorithm options
 */
export type HashAlgorithm = 'SHA-256' | 'SHA-384' | 'SHA-512';

/**
 * Deduplicated content entry
 */
export interface DedupEntry {
  /** Content hash (hex string) */
  hash: string;
  /** Original size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
  /** Reference count */
  refCount: number;
  /** First stored timestamp */
  createdAt: number;
  /** Last accessed timestamp */
  lastAccessedAt: number;
  /** Storage location (e.g., IndexedDB key) */
  storageKey: string;
}

/**
 * Reference to deduplicated content
 */
export interface DedupReference {
  /** Book ID */
  bookId: string;
  /** Resource path within book */
  resourcePath: string;
  /** Content hash */
  hash: string;
  /** Created timestamp */
  createdAt: number;
}

/**
 * Deduplication result
 */
export interface DedupResult {
  /** Content hash */
  hash: string;
  /** Whether content was already stored (deduplicated) */
  isDuplicate: boolean;
  /** Storage key for retrieval */
  storageKey: string;
  /** Bytes saved if duplicate */
  bytesSaved: number;
  /** Total reference count */
  refCount: number;
}

/**
 * Deduplication statistics
 */
export interface DedupStats {
  /** Total unique content entries */
  uniqueEntries: number;
  /** Total references */
  totalReferences: number;
  /** Total bytes stored (unique only) */
  bytesStored: number;
  /** Total bytes saved via dedup */
  bytesSaved: number;
  /** Deduplication ratio (saved/total) */
  dedupRatio: number;
  /** Most duplicated entries */
  topDuplicates: Array<{ hash: string; refCount: number; size: number }>;
}

/**
 * Storage backend interface
 */
export interface DedupStorage {
  /** Get entry by hash */
  getEntry(hash: string): Promise<DedupEntry | null>;
  /** Store entry */
  setEntry(entry: DedupEntry): Promise<void>;
  /** Delete entry */
  deleteEntry(hash: string): Promise<boolean>;
  /** Get all entries */
  getAllEntries(): Promise<DedupEntry[]>;

  /** Get content data by storage key */
  getContent(storageKey: string): Promise<ArrayBuffer | null>;
  /** Store content data */
  setContent(storageKey: string, data: ArrayBuffer): Promise<void>;
  /** Delete content data */
  deleteContent(storageKey: string): Promise<boolean>;

  /** Get reference */
  getReference(bookId: string, resourcePath: string): Promise<DedupReference | null>;
  /** Set reference */
  setReference(ref: DedupReference): Promise<void>;
  /** Delete reference */
  deleteReference(bookId: string, resourcePath: string): Promise<boolean>;
  /** Get all references for a book */
  getBookReferences(bookId: string): Promise<DedupReference[]>;
  /** Get all references for a hash */
  getHashReferences(hash: string): Promise<DedupReference[]>;
}

/**
 * Manager configuration
 */
export interface DedupManagerConfig {
  /** Hash algorithm */
  algorithm: HashAlgorithm;
  /** Minimum size for deduplication (smaller files not worth it) */
  minSize: number;
  /** Maximum entries to keep */
  maxEntries: number;
  /** Enable debug logging */
  debug: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_DEDUP_CONFIG: DedupManagerConfig = {
  algorithm: 'SHA-256',
  minSize: 1024, // 1KB minimum
  maxEntries: 10000,
  debug: false,
};

// ============================================================================
// In-Memory Storage (Default Implementation)
// ============================================================================

/**
 * Simple in-memory storage for deduplication
 */
export class InMemoryDedupStorage implements DedupStorage {
  private entries: Map<string, DedupEntry> = new Map();
  private content: Map<string, ArrayBuffer> = new Map();
  private references: Map<string, DedupReference> = new Map();

  private refKey(bookId: string, resourcePath: string): string {
    return `${bookId}:${resourcePath}`;
  }

  async getEntry(hash: string): Promise<DedupEntry | null> {
    return this.entries.get(hash) || null;
  }

  async setEntry(entry: DedupEntry): Promise<void> {
    this.entries.set(entry.hash, entry);
  }

  async deleteEntry(hash: string): Promise<boolean> {
    return this.entries.delete(hash);
  }

  async getAllEntries(): Promise<DedupEntry[]> {
    return Array.from(this.entries.values());
  }

  async getContent(storageKey: string): Promise<ArrayBuffer | null> {
    return this.content.get(storageKey) || null;
  }

  async setContent(storageKey: string, data: ArrayBuffer): Promise<void> {
    this.content.set(storageKey, data);
  }

  async deleteContent(storageKey: string): Promise<boolean> {
    return this.content.delete(storageKey);
  }

  async getReference(bookId: string, resourcePath: string): Promise<DedupReference | null> {
    return this.references.get(this.refKey(bookId, resourcePath)) || null;
  }

  async setReference(ref: DedupReference): Promise<void> {
    this.references.set(this.refKey(ref.bookId, ref.resourcePath), ref);
  }

  async deleteReference(bookId: string, resourcePath: string): Promise<boolean> {
    return this.references.delete(this.refKey(bookId, resourcePath));
  }

  async getBookReferences(bookId: string): Promise<DedupReference[]> {
    const result: DedupReference[] = [];
    for (const ref of this.references.values()) {
      if (ref.bookId === bookId) {
        result.push(ref);
      }
    }
    return result;
  }

  async getHashReferences(hash: string): Promise<DedupReference[]> {
    const result: DedupReference[] = [];
    for (const ref of this.references.values()) {
      if (ref.hash === hash) {
        result.push(ref);
      }
    }
    return result;
  }

  clear(): void {
    this.entries.clear();
    this.content.clear();
    this.references.clear();
  }
}

// ============================================================================
// Deduplication Manager
// ============================================================================

export class DeduplicationManager {
  private storage: DedupStorage;
  private config: DedupManagerConfig;
  private hashCache: Map<string, string> = new Map(); // Quick lookup

  constructor(storage?: DedupStorage, config: Partial<DedupManagerConfig> = {}) {
    this.storage = storage || new InMemoryDedupStorage();
    this.config = { ...DEFAULT_DEDUP_CONFIG, ...config };
  }

  // ==========================================================================
  // Core Operations
  // ==========================================================================

  /**
   * Store content with deduplication
   */
  async store(
    bookId: string,
    resourcePath: string,
    data: ArrayBuffer,
    mimeType: string
  ): Promise<DedupResult> {
    const size = data.byteLength;

    // Skip dedup for small files
    if (size < this.config.minSize) {
      return this.storeWithoutDedup(bookId, resourcePath, data, mimeType);
    }

    // Compute hash
    const hash = await this.computeHash(data);

    // Check for existing entry
    const existing = await this.storage.getEntry(hash);

    if (existing) {
      // Duplicate found - just add reference
      const ref: DedupReference = {
        bookId,
        resourcePath,
        hash,
        createdAt: Date.now(),
      };
      await this.storage.setReference(ref);

      // Update entry
      existing.refCount++;
      existing.lastAccessedAt = Date.now();
      await this.storage.setEntry(existing);

      this.log(`Dedup hit: ${bookId}/${resourcePath} -> ${hash.slice(0, 16)}...`);

      return {
        hash,
        isDuplicate: true,
        storageKey: existing.storageKey,
        bytesSaved: size,
        refCount: existing.refCount,
      };
    }

    // New content - store it
    const storageKey = `dedup:${hash}`;
    await this.storage.setContent(storageKey, data);

    const entry: DedupEntry = {
      hash,
      size,
      mimeType,
      refCount: 1,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      storageKey,
    };
    await this.storage.setEntry(entry);

    // Add reference
    const ref: DedupReference = {
      bookId,
      resourcePath,
      hash,
      createdAt: Date.now(),
    };
    await this.storage.setReference(ref);

    // Cache hash for quick lookup
    this.hashCache.set(`${bookId}:${resourcePath}`, hash);

    this.log(`Stored new: ${bookId}/${resourcePath} -> ${hash.slice(0, 16)}...`);

    return {
      hash,
      isDuplicate: false,
      storageKey,
      bytesSaved: 0,
      refCount: 1,
    };
  }

  /**
   * Store without deduplication (for small files)
   */
  private async storeWithoutDedup(
    bookId: string,
    resourcePath: string,
    data: ArrayBuffer,
    mimeType: string
  ): Promise<DedupResult> {
    // Use path-based key instead of hash
    const storageKey = `direct:${bookId}:${resourcePath}`;
    await this.storage.setContent(storageKey, data);

    // Create pseudo-hash from path
    const hash = await this.computeHash(new TextEncoder().encode(storageKey));

    const entry: DedupEntry = {
      hash,
      size: data.byteLength,
      mimeType,
      refCount: 1,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      storageKey,
    };
    await this.storage.setEntry(entry);

    const ref: DedupReference = {
      bookId,
      resourcePath,
      hash,
      createdAt: Date.now(),
    };
    await this.storage.setReference(ref);

    return {
      hash,
      isDuplicate: false,
      storageKey,
      bytesSaved: 0,
      refCount: 1,
    };
  }

  /**
   * Retrieve content by book and resource path
   */
  async retrieve(bookId: string, resourcePath: string): Promise<ArrayBuffer | null> {
    // Get reference
    const ref = await this.storage.getReference(bookId, resourcePath);
    if (!ref) {
      return null;
    }

    // Get entry
    const entry = await this.storage.getEntry(ref.hash);
    if (!entry) {
      // Orphaned reference - clean up
      await this.storage.deleteReference(bookId, resourcePath);
      return null;
    }

    // Update access time
    entry.lastAccessedAt = Date.now();
    await this.storage.setEntry(entry);

    // Get content
    return this.storage.getContent(entry.storageKey);
  }

  /**
   * Check if content exists (by hash)
   */
  async exists(data: ArrayBuffer): Promise<{ exists: boolean; hash: string }> {
    const hash = await this.computeHash(data);
    const entry = await this.storage.getEntry(hash);
    return { exists: !!entry, hash };
  }

  /**
   * Check if resource is stored
   */
  async hasResource(bookId: string, resourcePath: string): Promise<boolean> {
    const ref = await this.storage.getReference(bookId, resourcePath);
    return !!ref;
  }

  // ==========================================================================
  // Book Operations
  // ==========================================================================

  /**
   * Remove all resources for a book
   */
  async removeBook(bookId: string): Promise<{
    referencesRemoved: number;
    entriesRemoved: number;
    bytesFreed: number;
  }> {
    const refs = await this.storage.getBookReferences(bookId);
    let referencesRemoved = 0;
    let entriesRemoved = 0;
    let bytesFreed = 0;

    for (const ref of refs) {
      // Delete reference
      await this.storage.deleteReference(ref.bookId, ref.resourcePath);
      referencesRemoved++;

      // Decrement entry ref count
      const entry = await this.storage.getEntry(ref.hash);
      if (entry) {
        entry.refCount--;

        if (entry.refCount <= 0) {
          // No more references - delete content
          await this.storage.deleteContent(entry.storageKey);
          await this.storage.deleteEntry(ref.hash);
          entriesRemoved++;
          bytesFreed += entry.size;
        } else {
          await this.storage.setEntry(entry);
        }
      }

      // Clear from cache
      this.hashCache.delete(`${bookId}:${ref.resourcePath}`);
    }

    this.log(`Removed book ${bookId}: ${referencesRemoved} refs, ${entriesRemoved} entries, ${bytesFreed} bytes`);

    return { referencesRemoved, entriesRemoved, bytesFreed };
  }

  /**
   * Get all resources for a book
   */
  async getBookResources(bookId: string): Promise<Array<{
    resourcePath: string;
    hash: string;
    size: number;
    mimeType: string;
  }>> {
    const refs = await this.storage.getBookReferences(bookId);
    const result: Array<{
      resourcePath: string;
      hash: string;
      size: number;
      mimeType: string;
    }> = [];

    for (const ref of refs) {
      const entry = await this.storage.getEntry(ref.hash);
      if (entry) {
        result.push({
          resourcePath: ref.resourcePath,
          hash: ref.hash,
          size: entry.size,
          mimeType: entry.mimeType,
        });
      }
    }

    return result;
  }

  // ==========================================================================
  // Maintenance
  // ==========================================================================

  /**
   * Find and remove orphaned entries (no references)
   */
  async cleanup(): Promise<{
    orphansRemoved: number;
    bytesFreed: number;
  }> {
    const entries = await this.storage.getAllEntries();
    let orphansRemoved = 0;
    let bytesFreed = 0;

    for (const entry of entries) {
      const refs = await this.storage.getHashReferences(entry.hash);

      if (refs.length === 0 && entry.refCount !== refs.length) {
        // Orphaned entry
        await this.storage.deleteContent(entry.storageKey);
        await this.storage.deleteEntry(entry.hash);
        orphansRemoved++;
        bytesFreed += entry.size;
      } else if (entry.refCount !== refs.length) {
        // Fix ref count mismatch
        entry.refCount = refs.length;
        await this.storage.setEntry(entry);
      }
    }

    this.log(`Cleanup: ${orphansRemoved} orphans removed, ${bytesFreed} bytes freed`);

    return { orphansRemoved, bytesFreed };
  }

  /**
   * Verify integrity of all entries
   */
  async verify(): Promise<{
    totalEntries: number;
    validEntries: number;
    corruptedEntries: string[];
    missingContent: string[];
  }> {
    const entries = await this.storage.getAllEntries();
    const corruptedEntries: string[] = [];
    const missingContent: string[] = [];
    let validEntries = 0;

    for (const entry of entries) {
      const content = await this.storage.getContent(entry.storageKey);

      if (!content) {
        missingContent.push(entry.hash);
        continue;
      }

      // Verify hash
      const actualHash = await this.computeHash(content);
      if (actualHash !== entry.hash) {
        corruptedEntries.push(entry.hash);
        continue;
      }

      validEntries++;
    }

    return {
      totalEntries: entries.length,
      validEntries,
      corruptedEntries,
      missingContent,
    };
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get deduplication statistics
   */
  async getStats(): Promise<DedupStats> {
    const entries = await this.storage.getAllEntries();

    let bytesStored = 0;
    let bytesSaved = 0;
    let totalReferences = 0;

    const duplicates: Array<{ hash: string; refCount: number; size: number }> = [];

    for (const entry of entries) {
      bytesStored += entry.size;
      totalReferences += entry.refCount;

      // Bytes saved = (refCount - 1) * size (first copy is stored)
      if (entry.refCount > 1) {
        const saved = (entry.refCount - 1) * entry.size;
        bytesSaved += saved;
        duplicates.push({
          hash: entry.hash,
          refCount: entry.refCount,
          size: entry.size,
        });
      }
    }

    // Sort by savings (refCount * size)
    duplicates.sort((a, b) => (b.refCount * b.size) - (a.refCount * a.size));

    const totalBytes = bytesStored + bytesSaved;
    const dedupRatio = totalBytes > 0 ? bytesSaved / totalBytes : 0;

    return {
      uniqueEntries: entries.length,
      totalReferences,
      bytesStored,
      bytesSaved,
      dedupRatio,
      topDuplicates: duplicates.slice(0, 10),
    };
  }

  // ==========================================================================
  // Hashing
  // ==========================================================================

  /**
   * Compute content hash
   */
  async computeHash(data: ArrayBuffer | Uint8Array): Promise<string> {
    const buffer = data instanceof Uint8Array
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
      : data;

    const hashBuffer = await crypto.subtle.digest(this.config.algorithm, buffer);
    return this.bufferToHex(hashBuffer);
  }

  /**
   * Convert ArrayBuffer to hex string
   */
  private bufferToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Get configuration
   */
  getConfig(): DedupManagerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DedupManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Debug logging
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[Dedup] ${message}`);
    }
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    const entries = await this.storage.getAllEntries();
    for (const entry of entries) {
      await this.storage.deleteContent(entry.storageKey);
      await this.storage.deleteEntry(entry.hash);
    }
    this.hashCache.clear();
  }
}

// ============================================================================
// Factory
// ============================================================================

let defaultManager: DeduplicationManager | null = null;

/**
 * Get the default deduplication manager
 */
export function getDeduplicationManager(): DeduplicationManager {
  if (!defaultManager) {
    defaultManager = new DeduplicationManager();
  }
  return defaultManager;
}

/**
 * Create a deduplication manager
 */
export function createDeduplicationManager(
  storage?: DedupStorage,
  config?: Partial<DedupManagerConfig>
): DeduplicationManager {
  return new DeduplicationManager(storage, config);
}
