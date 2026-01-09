/**
 * Hybrid Document Provider
 *
 * Unified provider for PDF and EPUB document handling, combining server and WASM capabilities.
 * Provides a single interface for loading, rendering, and searching across both document formats.
 *
 * Features:
 * - Format-agnostic document operations
 * - Automatic server/WASM mode selection
 * - Two-tier caching (Memory + IndexedDB)
 * - Prefetching for adjacent pages/chapters
 * - Offline support via WASM
 *
 * @example
 * ```typescript
 * const provider = new HybridDocumentProvider({
 *   serverBaseUrl: 'http://localhost:3000',
 * });
 *
 * await provider.initialize();
 * const doc = await provider.loadDocument(pdfOrEpubData, 'document.pdf');
 * const pageBlob = await provider.renderItem(doc.id, 0, { scale: 1.5 });
 * ```
 */

import { ApiClient, getApiClient } from './api-client';
import { DocumentBridge, getSharedDocumentBridge, destroySharedDocumentBridge } from './document-bridge';
import type { ParsedDocument, StructuredText, SearchResult, DocumentFormat } from './document-worker';

// ============================================================================
// Types
// ============================================================================

export type ProviderMode = 'server' | 'wasm' | 'auto';

export interface HybridDocumentProviderConfig {
  /** Server base URL */
  serverBaseUrl?: string;
  /**
   * Preferred provider mode:
   * - 'server': Use server for all operations
   * - 'wasm': Use local WASM for operations (faster, offline capable)
   * - 'auto': Use WASM if available, fallback to server
   */
  preferMode?: ProviderMode;
  /** Timeout for server health check in ms */
  healthCheckTimeout?: number;
  /** Device ID for server requests */
  deviceId?: string;
  /** Enable caching (default: true) */
  enableCache?: boolean;
  /** Enable prefetching (default: true) */
  enablePrefetch?: boolean;
  /** Number of items to prefetch ahead/behind (default: 2) */
  prefetchCount?: number;
  /** Enable WASM rendering when available (default: true) */
  enableWasm?: boolean;
}

export interface ProviderStatus {
  activeMode: 'server' | 'wasm';
  serverAvailable: boolean;
  wasmAvailable: boolean;
  documentId: string | null;
  format: DocumentFormat | null;
  itemCount: number;
}

export interface RenderOptions {
  /** Render scale (1.0 = 72 DPI) */
  scale?: number;
  /** Image format */
  format?: 'png' | 'jpeg' | 'webp';
  /** Rotation in degrees (0, 90, 180, 270) */
  rotation?: number;
}

export interface TileRenderOptions extends RenderOptions {
  /** Tile size in pixels (default: 256) */
  tileSize?: number;
}

// ============================================================================
// Cache Implementation
// ============================================================================

interface CacheEntry {
  blob: Blob;
  timestamp: number;
}

class DocumentCache {
  private memoryCache = new Map<string, CacheEntry>();
  private maxMemoryEntries = 100;
  private maxMemoryBytes = 100 * 1024 * 1024; // 100MB
  private currentBytes = 0;

  private makeCacheKey(docId: string, itemIndex: number, scale: number): string {
    return `${docId}-${itemIndex}-${scale.toFixed(2)}`;
  }

  async get(docId: string, itemIndex: number, scale: number): Promise<Blob | null> {
    const key = this.makeCacheKey(docId, itemIndex, scale);
    const entry = this.memoryCache.get(key);
    return entry?.blob ?? null;
  }

  async set(docId: string, itemIndex: number, scale: number, blob: Blob): Promise<void> {
    const key = this.makeCacheKey(docId, itemIndex, scale);
    const size = blob.size;

    // Evict if necessary
    while (this.currentBytes + size > this.maxMemoryBytes && this.memoryCache.size > 0) {
      this.evictOldest();
    }

    const existing = this.memoryCache.get(key);
    if (existing) {
      this.currentBytes -= existing.blob.size;
    }

    this.memoryCache.set(key, { blob, timestamp: Date.now() });
    this.currentBytes += size;
  }

  async has(docId: string, itemIndex: number, scale: number): Promise<boolean> {
    const key = this.makeCacheKey(docId, itemIndex, scale);
    return this.memoryCache.has(key);
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.memoryCache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.memoryCache.get(oldestKey);
      if (entry) {
        this.currentBytes -= entry.blob.size;
        this.memoryCache.delete(oldestKey);
      }
    }
  }

  clearDocument(docId: string): void {
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(`${docId}-`)) {
        const entry = this.memoryCache.get(key);
        if (entry) {
          this.currentBytes -= entry.blob.size;
        }
        this.memoryCache.delete(key);
      }
    }
  }

  clear(): void {
    this.memoryCache.clear();
    this.currentBytes = 0;
  }

  getStats(): { size: number; bytes: number; maxBytes: number } {
    return {
      size: this.memoryCache.size,
      bytes: this.currentBytes,
      maxBytes: this.maxMemoryBytes,
    };
  }
}

// ============================================================================
// Provider Implementation
// ============================================================================

export class HybridDocumentProvider {
  private config: Required<HybridDocumentProviderConfig>;
  private apiClient: ApiClient | null = null;
  private serverAvailable = false;
  private wasmBridge: DocumentBridge | null = null;
  private wasmAvailable = false;

  // Current document state
  private documentId: string | null = null;
  private wasmDocumentId: string | null = null;
  private parsedDocument: ParsedDocument | null = null;
  private documentData: ArrayBuffer | null = null;

  // Caching
  private cache = new DocumentCache();

  // Prefetching
  private prefetchQueue: number[] = [];
  private isPrefetching = false;
  private isDestroyed = false;

  constructor(config: HybridDocumentProviderConfig = {}) {
    this.config = {
      serverBaseUrl: config.serverBaseUrl ?? '',
      preferMode: config.preferMode ?? 'auto',
      healthCheckTimeout: config.healthCheckTimeout ?? 5000,
      deviceId: config.deviceId ?? 'document-provider',
      enableCache: config.enableCache ?? true,
      enablePrefetch: config.enablePrefetch ?? true,
      prefetchCount: config.prefetchCount ?? 2,
      enableWasm: config.enableWasm ?? true,
    };
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the provider - checks server and WASM availability
   */
  async initialize(): Promise<void> {
    // Initialize WASM bridge if enabled
    if (this.config.enableWasm) {
      try {
        const startTime = performance.now();
        this.wasmBridge = await getSharedDocumentBridge();
        this.wasmAvailable = true;
        console.log(`[HybridDocumentProvider] WASM bridge initialized in ${(performance.now() - startTime).toFixed(1)}ms`);
      } catch (error) {
        console.warn('[HybridDocumentProvider] WASM initialization failed:', error);
        this.wasmAvailable = false;
      }
    }

    // Check server availability
    if (await this.checkServerHealth()) {
      this.apiClient = getApiClient();
    } else if (!this.wasmAvailable) {
      throw new Error('No document provider available. Both server and WASM are unavailable.');
    } else {
      console.log('[HybridDocumentProvider] Server unavailable, using WASM-only mode');
    }
  }

  /**
   * Check if server is available
   */
  private async checkServerHealth(): Promise<boolean> {
    if (!this.config.serverBaseUrl) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.healthCheckTimeout);

      const response = await fetch(`${this.config.serverBaseUrl}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);
      this.serverAvailable = response.ok;
      return this.serverAvailable;
    } catch {
      this.serverAvailable = false;
      return false;
    }
  }

  /**
   * Get current provider status
   */
  getStatus(): ProviderStatus {
    return {
      activeMode: this.shouldUseWasm() ? 'wasm' : 'server',
      serverAvailable: this.serverAvailable,
      wasmAvailable: this.wasmAvailable,
      documentId: this.documentId ?? this.wasmDocumentId,
      format: this.parsedDocument?.format ?? null,
      itemCount: this.parsedDocument?.itemCount ?? 0,
    };
  }

  /**
   * Check if WASM should be used
   */
  private shouldUseWasm(): boolean {
    if (!this.config.enableWasm || !this.wasmAvailable) return false;
    if (this.config.preferMode === 'wasm') return true;
    if (this.config.preferMode === 'auto') return true;
    return false;
  }

  // ============================================================================
  // Document Loading
  // ============================================================================

  /**
   * Load a document from ArrayBuffer
   * @param data Document bytes
   * @param filename Optional filename for identification and format detection
   */
  async loadDocument(data: ArrayBuffer, filename?: string): Promise<ParsedDocument> {
    if (!this.apiClient && !this.wasmAvailable) {
      throw new Error('Provider not initialized. Call initialize() first.');
    }

    this.documentData = data;

    // Load into WASM in parallel
    const wasmLoadPromise = this.loadDocumentToWasm(data, filename);

    // Try server if available
    if (this.apiClient && this.serverAvailable) {
      try {
        // Use unified documents API
        const response = await fetch(`${this.config.serverBaseUrl}/api/v1/documents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Document-Filename': filename ?? 'document',
          },
          body: data,
        });

        if (response.ok) {
          const result = await response.json();
          this.parsedDocument = {
            id: result.id,
            format: result.format,
            metadata: result.metadata,
            toc: result.toc ?? [],
            itemCount: result.item_count,
            hasTextLayer: result.has_text_layer,
          };
          this.documentId = result.id;
          console.log('[HybridDocumentProvider] Loaded via server:', result.id);

          // Wait for WASM load to complete
          await wasmLoadPromise;

          return this.parsedDocument;
        }
      } catch (error) {
        console.warn('[HybridDocumentProvider] Server load failed:', error);
      }
    }

    // Fallback to WASM-only
    const wasmResult = await wasmLoadPromise;
    if (wasmResult) {
      this.parsedDocument = wasmResult.document;
      this.wasmDocumentId = wasmResult.id;
      this.documentId = wasmResult.id;
      return this.parsedDocument;
    }

    throw new Error('Failed to load document with any available provider');
  }

  /**
   * Load document into WASM bridge
   */
  private async loadDocumentToWasm(
    data: ArrayBuffer,
    filename?: string
  ): Promise<{ id: string; document: ParsedDocument } | null> {
    if (!this.wasmBridge || !this.wasmAvailable) {
      return null;
    }

    try {
      const startTime = performance.now();
      const result = await this.wasmBridge.loadDocumentWithId(data.slice(0), filename);
      this.wasmDocumentId = result.id;
      console.log(`[HybridDocumentProvider] WASM loaded (${result.document.itemCount} items) in ${(performance.now() - startTime).toFixed(1)}ms`);
      return result;
    } catch (error) {
      console.warn('[HybridDocumentProvider] WASM document load failed:', error);
      this.wasmDocumentId = null;
      return null;
    }
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  /**
   * Render a document item (page or chapter) to Blob
   * @param itemIndex 0-indexed item number
   * @param options Render options
   */
  async renderItem(itemIndex: number, options?: RenderOptions): Promise<Blob> {
    if (!this.documentId && !this.wasmDocumentId) {
      throw new Error('No document loaded');
    }

    const scale = Math.min(options?.scale ?? 1.5, 12.0);

    // Check cache
    if (this.config.enableCache) {
      const docId = this.documentId ?? this.wasmDocumentId!;
      const cached = await this.cache.get(docId, itemIndex, scale);
      if (cached) {
        this.triggerPrefetch(itemIndex, scale);
        return cached;
      }
    }

    let blob: Blob;

    // Use WASM if available
    if (this.shouldUseWasm() && this.wasmBridge && this.wasmDocumentId) {
      const startTime = performance.now();
      const result = await this.wasmBridge.renderItem(this.wasmDocumentId, itemIndex, scale);
      // Create a new Uint8Array to ensure proper ArrayBuffer type for Blob
      const data = new Uint8Array(result.data);
      blob = new Blob([data], { type: 'image/png' });
      console.log(`[HybridDocumentProvider] WASM rendered item ${itemIndex} @ ${scale}x in ${(performance.now() - startTime).toFixed(1)}ms`);
    } else if (this.apiClient && this.documentId) {
      // Fallback to server
      const response = await fetch(
        `${this.config.serverBaseUrl}/api/v1/documents/${this.documentId}/items/${itemIndex}/render?scale=${scale}`
      );
      if (!response.ok) {
        throw new Error(`Server render failed: ${response.statusText}`);
      }
      blob = await response.blob();
    } else {
      throw new Error('No rendering backend available');
    }

    // Cache result
    if (this.config.enableCache) {
      const docId = this.documentId ?? this.wasmDocumentId!;
      await this.cache.set(docId, itemIndex, scale, blob);
    }

    // Trigger prefetch
    this.triggerPrefetch(itemIndex, scale);

    return blob;
  }

  /**
   * Render a tile of a document item
   */
  async renderTile(
    itemIndex: number,
    tileX: number,
    tileY: number,
    options?: TileRenderOptions
  ): Promise<Blob> {
    if (!this.wasmBridge || !this.wasmDocumentId) {
      throw new Error('WASM not available for tile rendering');
    }

    const scale = options?.scale ?? 1.5;
    const tileSize = options?.tileSize ?? 256;

    const result = await this.wasmBridge.renderTile(
      this.wasmDocumentId,
      itemIndex,
      tileX,
      tileY,
      tileSize,
      scale
    );

    // Create a new Uint8Array to ensure proper ArrayBuffer type for Blob
    const data = new Uint8Array(result.data);
    return new Blob([data], { type: 'image/png' });
  }

  // ============================================================================
  // Text Operations
  // ============================================================================

  /**
   * Get structured text with character positions
   */
  async getStructuredText(itemIndex: number): Promise<StructuredText> {
    if (!this.documentId && !this.wasmDocumentId) {
      throw new Error('No document loaded');
    }

    // Prefer WASM for accurate character positions
    if (this.shouldUseWasm() && this.wasmBridge && this.wasmDocumentId) {
      return this.wasmBridge.getStructuredText(this.wasmDocumentId, itemIndex);
    }

    // Fallback to server
    if (this.apiClient && this.documentId) {
      const response = await fetch(
        `${this.config.serverBaseUrl}/api/v1/documents/${this.documentId}/items/${itemIndex}/text`
      );
      if (!response.ok) {
        throw new Error(`Server text extraction failed: ${response.statusText}`);
      }
      return response.json();
    }

    throw new Error('No text extraction backend available');
  }

  /**
   * Search document
   */
  async search(query: string, limit: number = 50, includeContext: boolean = true): Promise<SearchResult[]> {
    if (!this.documentId && !this.wasmDocumentId) {
      throw new Error('No document loaded');
    }

    // Use WASM for search
    if (this.shouldUseWasm() && this.wasmBridge && this.wasmDocumentId) {
      return this.wasmBridge.search(this.wasmDocumentId, query, limit, includeContext);
    }

    // Fallback to server
    if (this.apiClient && this.documentId) {
      const params = new URLSearchParams({
        query,
        limit: String(limit),
        include_context: String(includeContext),
      });
      const response = await fetch(
        `${this.config.serverBaseUrl}/api/v1/documents/${this.documentId}/search?${params}`
      );
      if (!response.ok) {
        throw new Error(`Server search failed: ${response.statusText}`);
      }
      return response.json();
    }

    throw new Error('No search backend available');
  }

  // ============================================================================
  // EPUB-Specific Operations
  // ============================================================================

  /**
   * Get EPUB chapter XHTML content
   */
  async getEpubChapter(chapterIndex: number): Promise<string> {
    if (!this.parsedDocument || this.parsedDocument.format !== 'epub') {
      throw new Error('No EPUB document loaded');
    }

    if (this.wasmBridge && this.wasmDocumentId) {
      return this.wasmBridge.getEpubChapter(this.wasmDocumentId, chapterIndex);
    }

    // Server fallback
    if (this.apiClient && this.documentId) {
      const response = await fetch(
        `${this.config.serverBaseUrl}/api/v1/documents/${this.documentId}/items/${chapterIndex}/content`
      );
      if (!response.ok) {
        throw new Error(`Server chapter fetch failed: ${response.statusText}`);
      }
      return response.text();
    }

    throw new Error('No chapter content backend available');
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get item dimensions
   */
  async getItemDimensions(itemIndex: number): Promise<{ width: number; height: number }> {
    if (this.wasmBridge && this.wasmDocumentId) {
      return this.wasmBridge.getItemDimensions(this.wasmDocumentId, itemIndex);
    }

    // Default dimensions
    return { width: 612, height: 792 }; // US Letter at 72 DPI
  }

  /**
   * Get item count
   */
  getItemCount(): number {
    return this.parsedDocument?.itemCount ?? 0;
  }

  /**
   * Get parsed document metadata
   */
  getParsedDocument(): ParsedDocument | null {
    return this.parsedDocument;
  }

  /**
   * Get document format
   */
  getFormat(): DocumentFormat | null {
    return this.parsedDocument?.format ?? null;
  }

  /**
   * Check if WASM tile rendering is available
   */
  isTileRenderingAvailable(): boolean {
    return this.wasmAvailable && this.wasmDocumentId !== null;
  }

  // ============================================================================
  // Prefetching
  // ============================================================================

  /**
   * Trigger prefetch of adjacent items
   */
  private triggerPrefetch(currentItem: number, scale: number): void {
    if (!this.config.enablePrefetch) return;

    const itemCount = this.getItemCount();
    const toFetch: number[] = [];

    for (let i = 1; i <= this.config.prefetchCount; i++) {
      if (currentItem + i < itemCount) toFetch.push(currentItem + i);
      if (currentItem - i >= 0) toFetch.push(currentItem - i);
    }

    for (const item of toFetch) {
      if (!this.prefetchQueue.includes(item)) {
        this.prefetchQueue.push(item);
      }
    }

    this.processPrefetchQueue(scale);
  }

  /**
   * Process prefetch queue
   */
  private async processPrefetchQueue(scale: number): Promise<void> {
    if (this.isPrefetching || this.prefetchQueue.length === 0) return;

    this.isPrefetching = true;

    while (this.prefetchQueue.length > 0 && !this.isDestroyed) {
      const item = this.prefetchQueue.shift()!;
      const docId = this.documentId ?? this.wasmDocumentId;

      if (!docId) break;

      try {
        const isCached = await this.cache.has(docId, item, scale);
        if (!isCached) {
          const blob = await this.renderItem(item, { scale });
          console.log(`[HybridDocumentProvider] Prefetched item ${item}`);
        }
      } catch (error) {
        console.warn(`[HybridDocumentProvider] Prefetch failed for item ${item}:`, error);
      }

      // Yield to prevent blocking
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    this.isPrefetching = false;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Clear cache for current document
   */
  async clearCache(): Promise<void> {
    const docId = this.documentId ?? this.wasmDocumentId;
    if (docId) {
      this.cache.clearDocument(docId);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; bytes: number; maxBytes: number } {
    return this.cache.getStats();
  }

  /**
   * Destroy the provider and release resources
   */
  async destroy(): Promise<void> {
    this.isDestroyed = true;
    this.prefetchQueue = [];

    // Unload WASM document
    if (this.wasmBridge && this.wasmDocumentId) {
      await this.wasmBridge.unloadDocument(this.wasmDocumentId);
    }

    // Clear cache
    this.cache.clear();

    this.documentId = null;
    this.wasmDocumentId = null;
    this.parsedDocument = null;
    this.documentData = null;
    this.apiClient = null;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a hybrid document provider with default configuration
 */
export function createHybridDocumentProvider(
  config?: HybridDocumentProviderConfig
): HybridDocumentProvider {
  return new HybridDocumentProvider(config);
}

/**
 * Destroy shared document bridge (call on plugin unload)
 */
export function destroySharedResources(): void {
  destroySharedDocumentBridge();
}
