/**
 * Server PDF Provider
 *
 * Server-based PDF rendering provider with intelligent caching and prefetching.
 * Uses the Amnesia server for all PDF operations (parsing, rendering, text extraction).
 *
 * Features:
 * - Two-tier caching (Memory + IndexedDB)
 * - Sequential prefetching of adjacent pages
 * - Automatic cache eviction
 *
 * @example
 * ```typescript
 * import { HybridPdfProvider } from './hybrid-pdf-provider';
 *
 * const provider = new HybridPdfProvider({
 *   serverBaseUrl: 'http://localhost:3000',
 * });
 *
 * await provider.initialize();
 * await provider.loadDocument(pdfData);
 * const pageImage = await provider.renderPage(1, { scale: 1.5 });
 * ```
 */

import { ApiClient, getApiClient } from '../api-client';
import type {
  ParsedPdf,
  PdfTextLayerData,
  PdfRenderOptions,
  PdfSearchResult,
} from '../types';
import { PdfPageCache } from './pdf-cache';
import { WasmPdfRenderer, getSharedWasmRenderer, destroySharedWasmRenderer } from './wasm-renderer';

export type PdfProviderMode = 'server' | 'wasm' | 'auto';

export interface HybridPdfProviderConfig {
  /** Server base URL */
  serverBaseUrl?: string;
  /**
   * Preferred provider mode:
   * - 'server': Use server for all rendering (default)
   * - 'wasm': Use local WASM for rendering (faster, no server required for rendering)
   * - 'auto': Use WASM if available, fallback to server
   */
  preferMode?: PdfProviderMode;
  /** Timeout for server health check in ms */
  healthCheckTimeout?: number;
  /** Device ID for server requests */
  deviceId?: string;
  /** Enable page caching (default: true) */
  enableCache?: boolean;
  /** Enable prefetching of adjacent pages (default: true) */
  enablePrefetch?: boolean;
  /** Number of pages to prefetch ahead/behind (default: 2) */
  prefetchCount?: number;
  /** Enable WASM rendering when available (default: true) */
  enableWasm?: boolean;
}

export interface HybridPdfProviderStatus {
  activeMode: 'server' | 'wasm';
  serverAvailable: boolean;
  wasmAvailable: boolean;
  documentId: string | null;
  pageCount: number;
}

/**
 * Result of dual-resolution rendering
 */
export interface DualResRenderResult {
  /** The blob to display immediately (may be lower resolution) */
  initial: Blob;
  /** Scale of the initial blob */
  initialScale: number;
  /** Whether initial is at full requested quality */
  isFullQuality: boolean;
  /** Promise that resolves with full quality blob (only if initial was lower quality) */
  upgradePromise?: Promise<Blob>;
}

/**
 * Server-based PDF provider with caching and prefetching
 */
export class HybridPdfProvider {
  private config: Required<HybridPdfProviderConfig>;
  private apiClient: ApiClient | null = null;
  private serverAvailable: boolean = false;
  private documentId: string | null = null;
  private parsedPdf: ParsedPdf | null = null;
  private pdfData: ArrayBuffer | null = null;

  // WASM renderer
  private wasmRenderer: WasmPdfRenderer | null = null;
  private wasmAvailable: boolean = false;
  private wasmDocumentId: string | null = null;

  // Caching
  private pageCache: PdfPageCache;

  // Prefetching
  private prefetchQueue: number[] = [];
  private isPrefetching: boolean = false;
  private prefetchTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isDestroyed: boolean = false;

  constructor(config: HybridPdfProviderConfig = {}) {
    this.config = {
      serverBaseUrl: config.serverBaseUrl ?? '',
      preferMode: config.preferMode ?? 'auto',
      healthCheckTimeout: config.healthCheckTimeout ?? 5000,
      deviceId: config.deviceId ?? 'server-provider',
      enableCache: config.enableCache ?? true,
      enablePrefetch: config.enablePrefetch ?? true,
      prefetchCount: config.prefetchCount ?? 2,
      enableWasm: config.enableWasm ?? true,
    };

    this.pageCache = new PdfPageCache();
  }

  /**
   * Get current provider status
   */
  getStatus(): HybridPdfProviderStatus {
    return {
      activeMode: this.shouldUseWasm() ? 'wasm' : 'server',
      serverAvailable: this.serverAvailable,
      wasmAvailable: this.wasmAvailable,
      documentId: this.documentId,
      pageCount: this.parsedPdf?.pageCount ?? 0,
    };
  }

  /**
   * Check if WASM should be used for rendering
   */
  private shouldUseWasm(): boolean {
    if (!this.config.enableWasm || !this.wasmAvailable) return false;
    if (this.config.preferMode === 'wasm') return true;
    if (this.config.preferMode === 'auto') return true;
    return false;
  }

  /**
   * Check if server is available
   */
  async checkServerHealth(): Promise<boolean> {
    if (!this.config.serverBaseUrl) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.healthCheckTimeout
      );

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
   * Initialize the provider - checks server availability, initializes WASM renderer, and cache
   */
  async initialize(): Promise<void> {
    // Initialize cache if enabled
    if (this.config.enableCache) {
      await this.pageCache.initialize();
    }

    // Initialize WASM renderer if enabled (non-blocking)
    if (this.config.enableWasm) {
      try {
        const startTime = performance.now();
        this.wasmRenderer = await getSharedWasmRenderer();
        this.wasmAvailable = true;
        console.log(`[HybridPdfProvider] WASM renderer initialized in ${(performance.now() - startTime).toFixed(1)}ms`);
      } catch (error) {
        console.warn('[HybridPdfProvider] WASM renderer initialization failed:', error);
        this.wasmAvailable = false;
      }
    }

    // Check server availability
    if (await this.checkServerHealth()) {
      this.apiClient = getApiClient();
    } else if (!this.wasmAvailable) {
      // Only throw if WASM is also unavailable
      throw new Error('No PDF rendering available. Both server and WASM renderer are unavailable.');
    } else {
      console.log('[HybridPdfProvider] Server unavailable, using WASM-only mode');
    }
  }

  /**
   * Load a PDF document from ArrayBuffer
   * First checks if the PDF already exists on the server, if so uses it.
   * Otherwise uploads the PDF.
   *
   * Also loads the document into WASM renderer for fast local rendering.
   * After loading, starts background thumbnail generation for fast placeholder display.
   */
  async loadDocument(data: ArrayBuffer, documentId?: string): Promise<ParsedPdf> {
    if (!this.apiClient && !this.wasmAvailable) {
      throw new Error('Provider not initialized. Call initialize() first.');
    }

    this.pdfData = data;

    // Load into WASM renderer in parallel (for fast local rendering)
    const wasmLoadPromise = this.loadDocumentToWasm(data);

    // Try to get existing PDF first (by ID derived from filename)
    if (documentId && this.apiClient) {
      const pdfId = documentId.replace(/\.pdf$/i, '');
      try {
        this.parsedPdf = await this.apiClient.getPdf(pdfId);
        this.documentId = this.parsedPdf.id;
        console.log('[HybridPdfProvider] Using existing PDF from server:', pdfId);

        // Wait for WASM load to complete
        await wasmLoadPromise;

        // Start background thumbnail generation (non-blocking)
        this.generateThumbnails(this.parsedPdf.pageCount).catch((err) => {
          console.warn('[HybridPdfProvider] Thumbnail generation failed:', err);
        });

        return this.parsedPdf;
      } catch {
        // PDF doesn't exist, fall through to upload
        console.log('[HybridPdfProvider] PDF not found on server, uploading:', pdfId);
      }
    }

    // If API client is available, upload the PDF
    if (this.apiClient) {
      this.parsedPdf = await this.apiClient.uploadPdf(data, documentId);
      this.documentId = this.parsedPdf.id;
    } else {
      // WASM-only mode: create minimal ParsedPdf from WASM data
      const wasmResult = await wasmLoadPromise;
      this.parsedPdf = {
        id: wasmResult?.id ?? documentId ?? `wasm-${Date.now()}`,
        metadata: {
          title: documentId ?? 'Untitled PDF',
          keywords: [],
        },
        toc: [],
        pageCount: wasmResult?.pageCount ?? 0,
        hasTextLayer: true, // WASM always extracts text
        orientation: 'portrait',
      };
      this.documentId = this.parsedPdf.id;
    }

    // Wait for WASM load to complete (if not already done)
    await wasmLoadPromise;

    // Start background thumbnail generation (non-blocking)
    this.generateThumbnails(this.parsedPdf.pageCount).catch((err) => {
      console.warn('[HybridPdfProvider] Thumbnail generation failed:', err);
    });

    return this.parsedPdf;
  }

  /**
   * Load document into WASM renderer
   */
  private async loadDocumentToWasm(data: ArrayBuffer): Promise<{ id: string; pageCount: number } | null> {
    if (!this.wasmRenderer || !this.wasmAvailable) {
      return null;
    }

    try {
      const startTime = performance.now();
      const result = await this.wasmRenderer.loadDocument(data.slice(0)); // Clone to avoid transfer issues
      this.wasmDocumentId = result.id;
      console.log(`[HybridPdfProvider] WASM loaded document (${result.pageCount} pages) in ${(performance.now() - startTime).toFixed(1)}ms`);
      return result;
    } catch (error) {
      console.warn('[HybridPdfProvider] WASM document load failed:', error);
      this.wasmDocumentId = null;
      return null;
    }
  }

  /**
   * Load a PDF document from server by ID
   */
  async loadDocumentFromId(pdfId: string): Promise<ParsedPdf> {
    if (!this.apiClient) {
      throw new Error('Provider not initialized. Call initialize() first.');
    }

    this.parsedPdf = await this.apiClient.getPdf(pdfId);
    this.documentId = pdfId;

    // Start background thumbnail generation (non-blocking)
    this.generateThumbnails(this.parsedPdf.pageCount).catch((err) => {
      console.warn('[HybridPdfProvider] Thumbnail generation failed:', err);
    });

    return this.parsedPdf;
  }

  /**
   * Render a page to a blob (with caching)
   * Uses WASM renderer when available for faster local rendering.
   */
  async renderPage(pageNumber: number, options?: PdfRenderOptions): Promise<Blob> {
    if (!this.documentId && !this.wasmDocumentId) {
      throw new Error('No document loaded');
    }

    const scale = options?.scale ?? 1.5;

    // Check cache first (regardless of render source)
    if (this.config.enableCache && this.documentId) {
      const cached = await this.pageCache.get(this.documentId, pageNumber, scale);
      if (cached) {
        // Trigger prefetch in background
        if (this.config.enablePrefetch) {
          this.prefetchAdjacentPages(pageNumber, scale);
        }
        return cached;
      }
    }

    let blob: Blob;

    // Use WASM renderer if available and enabled
    if (this.shouldUseWasm() && this.wasmRenderer && this.wasmDocumentId) {
      const startTime = performance.now();
      blob = await this.wasmRenderer.renderPage(pageNumber, options);
      console.log(`[HybridPdfProvider] WASM rendered page ${pageNumber} @ ${scale}x in ${(performance.now() - startTime).toFixed(1)}ms`);
    } else if (this.apiClient && this.documentId) {
      // Fallback to server rendering
      blob = await this.apiClient.getPdfPage(this.documentId, pageNumber, options);
    } else {
      throw new Error('No rendering backend available');
    }

    // Cache for later (use documentId if available, otherwise wasmDocumentId)
    if (this.config.enableCache) {
      const cacheId = this.documentId ?? this.wasmDocumentId!;
      await this.pageCache.set(cacheId, pageNumber, scale, blob);
    }

    // Trigger prefetch in background
    if (this.config.enablePrefetch) {
      this.prefetchAdjacentPages(pageNumber, scale);
    }

    return blob;
  }

  /**
   * Alias for renderPage - used by multi-page container
   */
  async getPageImage(pageNumber: number, options?: PdfRenderOptions): Promise<Blob> {
    return this.renderPage(pageNumber, options);
  }

  /**
   * Render a page with dual-resolution strategy.
   *
   * This method implements the "never show blank pages" strategy:
   * 1. Returns the best available cached version IMMEDIATELY (even if low-res)
   * 2. If cached version is lower quality, starts background upgrade
   * 3. If nothing cached, fetches thumbnail first for instant display
   *
   * @param pageNumber Page to render (1-indexed)
   * @param options Render options (scale, format, etc.)
   * @returns Initial blob to display + optional upgrade promise
   */
  async renderPageDualRes(
    pageNumber: number,
    options?: PdfRenderOptions
  ): Promise<DualResRenderResult> {
    if (!this.apiClient || !this.documentId) {
      throw new Error('No document loaded');
    }

    const requestedScale = options?.scale ?? 1.5;

    // 1. Check for best available cached version
    const cached = await this.pageCache.getBestAvailable(
      this.documentId,
      pageNumber,
      requestedScale
    );

    if (cached) {
      // Check if it's at full requested quality
      if (cached.scale >= requestedScale) {
        // Full quality cached - return immediately
        return {
          initial: cached.blob,
          initialScale: cached.scale,
          isFullQuality: true,
        };
      }

      // Lower quality cached - return it and start upgrade
      const upgradePromise = this.renderPage(pageNumber, options);
      return {
        initial: cached.blob,
        initialScale: cached.scale,
        isFullQuality: false,
        upgradePromise,
      };
    }

    // 2. Nothing cached - try thumbnail first for instant display
    const thumbnailScale = HybridPdfProvider.THUMBNAIL_DPI / 72;
    const thumbnailCached = await this.pageCache.get(
      this.documentId,
      pageNumber,
      thumbnailScale
    );

    if (thumbnailCached) {
      // Thumbnail exists - return it and start full fetch
      const upgradePromise = this.renderPage(pageNumber, options);
      return {
        initial: thumbnailCached,
        initialScale: thumbnailScale,
        isFullQuality: false,
        upgradePromise,
      };
    }

    // 3. Nothing cached at all - fetch thumbnail first for speed
    // Race: get thumbnail quickly, then full quality
    const thumbnailOptions: PdfRenderOptions = {
      dpi: HybridPdfProvider.THUMBNAIL_DPI,
      format: 'png',
    };

    try {
      // Try to get thumbnail first (faster due to lower DPI)
      const thumbnail = await this.apiClient.getPdfPage(
        this.documentId,
        pageNumber,
        thumbnailOptions
      );

      // Cache the thumbnail
      await this.pageCache.set(this.documentId, pageNumber, thumbnailScale, thumbnail);

      // Start full resolution fetch in background
      const upgradePromise = this.renderPage(pageNumber, options);

      return {
        initial: thumbnail,
        initialScale: thumbnailScale,
        isFullQuality: false,
        upgradePromise,
      };
    } catch {
      // If thumbnail fails, just fetch full directly
      const fullBlob = await this.renderPage(pageNumber, options);
      return {
        initial: fullBlob,
        initialScale: requestedScale,
        isFullQuality: true,
      };
    }
  }

  /**
   * Render page directly to a canvas element
   */
  async renderPageToCanvas(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    options?: PdfRenderOptions
  ): Promise<void> {
    if (!this.apiClient || !this.documentId) {
      throw new Error('No document loaded');
    }

    const blob = await this.apiClient.getPdfPage(this.documentId, pageNumber, options);
    const img = await this.blobToImage(blob);

    const ctx = canvas.getContext('2d')!;
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
  }

  /**
   * Get text layer for a page
   * Uses WASM for accurate character-level positions when available.
   */
  async getTextLayer(pageNumber: number): Promise<PdfTextLayerData> {
    if (!this.documentId && !this.wasmDocumentId) {
      throw new Error('No document loaded');
    }

    // Prefer WASM for more accurate character positions
    if (this.shouldUseWasm() && this.wasmRenderer && this.wasmDocumentId) {
      return this.wasmRenderer.getTextLayer(pageNumber);
    }

    // Fallback to server
    if (this.apiClient && this.documentId) {
      return this.apiClient.getPdfTextLayer(this.documentId, pageNumber);
    }

    throw new Error('No text layer backend available');
  }

  /**
   * Get page dimensions
   * Uses WASM for accurate dimensions when available.
   */
  async getPageDimensions(pageNumber: number): Promise<{ width: number; height: number }> {
    if (!this.parsedPdf && !this.wasmDocumentId) {
      throw new Error('No document loaded');
    }

    // Use WASM for accurate dimensions
    if (this.wasmRenderer && this.wasmDocumentId) {
      return this.wasmRenderer.getPageDimensions(pageNumber);
    }

    // TODO: Add server API endpoint to get per-page dimensions
    // For now, return standard US Letter size
    return { width: 612, height: 792 }; // US Letter at 72 DPI
  }

  /**
   * Search for text
   * Uses WASM for search with bounding boxes when available.
   */
  async search(query: string, limit: number = 50): Promise<PdfSearchResult[]> {
    if (!this.documentId && !this.wasmDocumentId) {
      throw new Error('No document loaded');
    }

    // Use WASM for search with bounding boxes
    if (this.shouldUseWasm() && this.wasmRenderer && this.wasmDocumentId) {
      return this.wasmRenderer.search(query, limit);
    }

    // Fallback to server
    if (this.apiClient && this.documentId) {
      return this.apiClient.searchPdf(this.documentId, query, limit);
    }

    throw new Error('No search backend available');
  }

  /**
   * Get page count
   */
  getPageCount(): number {
    return this.parsedPdf?.pageCount ?? 0;
  }

  /**
   * Get parsed PDF metadata
   */
  getParsedPdf(): ParsedPdf | null {
    return this.parsedPdf;
  }

  /**
   * Destroy the provider and release resources
   */
  async destroy(): Promise<void> {
    // Signal destroy to stop in-progress operations
    this.isDestroyed = true;

    // Cancel pending prefetch
    this.cancelPrefetch();

    // Wait for any in-progress prefetch to complete
    let waitCount = 0;
    while (this.isPrefetching && waitCount < 20) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      waitCount++;
    }

    // Unload WASM document
    if (this.wasmRenderer && this.wasmDocumentId) {
      await this.wasmRenderer.unloadDocument();
    }

    // Destroy page cache
    this.pageCache.destroy();

    this.documentId = null;
    this.wasmDocumentId = null;
    this.parsedPdf = null;
    this.pdfData = null;
    this.apiClient = null;
    this.wasmRenderer = null;
  }

  /**
   * Clear cached pages for the current document
   */
  async clearCache(): Promise<void> {
    if (this.documentId) {
      await this.pageCache.clearPdf(this.documentId);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { memorySize: number; maxMemory: number } {
    return this.pageCache.getStats();
  }

  // Private methods

  /**
   * Prefetch adjacent pages in the background
   */
  private prefetchAdjacentPages(currentPage: number, scale: number): void {
    if (!this.documentId || !this.config.enablePrefetch) return;

    const pageCount = this.getPageCount();
    const pagesToPrefetch: number[] = [];

    // Add adjacent pages (forward bias - more ahead than behind)
    for (let i = 1; i <= this.config.prefetchCount; i++) {
      // Forward pages (higher priority)
      if (currentPage + i <= pageCount) {
        pagesToPrefetch.push(currentPage + i);
      }
      // Backward pages
      if (currentPage - i >= 1) {
        pagesToPrefetch.push(currentPage - i);
      }
    }

    // Add to queue if not already cached or queued
    for (const page of pagesToPrefetch) {
      if (!this.prefetchQueue.includes(page)) {
        // Check if already cached (sync check of memory cache)
        this.pageCache.has(this.documentId, page, scale).then((isCached) => {
          if (!isCached && !this.prefetchQueue.includes(page)) {
            this.prefetchQueue.push(page);
            this.processPrefetchQueue(scale);
          }
        });
      }
    }
  }

  /**
   * Process the prefetch queue sequentially
   */
  private async processPrefetchQueue(scale: number): Promise<void> {
    if (this.isDestroyed || this.isPrefetching || this.prefetchQueue.length === 0) return;
    if (!this.apiClient || !this.documentId) return;

    this.isPrefetching = true;
    const page = this.prefetchQueue.shift()!;

    try {
      // Check if already cached (might have been loaded by user navigation)
      const isCached = await this.pageCache.has(this.documentId, page, scale);
      if (!isCached) {
        const blob = await this.apiClient.getPdfPage(this.documentId, page, { scale });
        await this.pageCache.set(this.documentId, page, scale, blob);
        console.log(`[PDF] Prefetched page ${page}`);
      }
    } catch (error) {
      console.warn(`[PDF] Prefetch failed for page ${page}:`, error);
    }

    this.isPrefetching = false;

    // Process next with delay to avoid overwhelming server
    if (this.prefetchQueue.length > 0) {
      this.prefetchTimeoutId = setTimeout(() => {
        this.processPrefetchQueue(scale);
      }, 200);
    }
  }

  /**
   * Cancel pending prefetch operations
   */
  private cancelPrefetch(): void {
    if (this.prefetchTimeoutId) {
      clearTimeout(this.prefetchTimeoutId);
      this.prefetchTimeoutId = null;
    }
    this.prefetchQueue = [];
    this.isPrefetching = false;
  }

  /** Whether prefetching is paused (e.g., during mode transitions) */
  private prefetchPaused = false;

  /**
   * Pause prefetching (e.g., during mode transitions)
   * Preserves the queue but stops processing
   */
  pausePrefetch(): void {
    this.prefetchPaused = true;
    if (this.prefetchTimeoutId) {
      clearTimeout(this.prefetchTimeoutId);
      this.prefetchTimeoutId = null;
    }
  }

  /**
   * Resume prefetching after pause
   */
  resumePrefetch(): void {
    this.prefetchPaused = false;
    // Restart queue processing if there are pending items
    if (this.prefetchQueue.length > 0 && !this.isPrefetching) {
      const scale = 1.5; // Default scale for prefetch
      this.processPrefetchQueue(scale);
    }
  }

  /**
   * Check if prefetching is currently paused
   */
  isPrefetchPaused(): boolean {
    return this.prefetchPaused;
  }

  /** Track if thumbnail generation is in progress */
  private isGeneratingThumbnails = false;

  /** Thumbnail DPI - lower than full render for fast loading */
  private static readonly THUMBNAIL_DPI = 72;

  /**
   * Generate thumbnails for all pages in the background.
   * This runs non-blocking and yields to the main thread between batches.
   *
   * Benefits:
   * - Thumbnails are cached and available instantly when pages come into view
   * - Never shows blank pages - thumbnail is displayed while full-res loads
   * - Batched processing prevents memory spikes
   * - setTimeout yields prevent UI freezing
   */
  private async generateThumbnails(pageCount: number): Promise<void> {
    if (this.isGeneratingThumbnails) {
      console.log('[HybridPdfProvider] Thumbnail generation already in progress');
      return;
    }

    if (!this.documentId || !this.apiClient) {
      console.warn('[HybridPdfProvider] Cannot generate thumbnails - no document loaded');
      return;
    }

    this.isGeneratingThumbnails = true;
    const startTime = performance.now();
    const BATCH_SIZE = 5;
    const THUMBNAIL_OPTIONS: PdfRenderOptions = {
      dpi: HybridPdfProvider.THUMBNAIL_DPI,
      format: 'png',
    };

    let generated = 0;
    let skipped = 0;

    try {
      for (let i = 0; i < pageCount; i += BATCH_SIZE) {
        // Check if we should stop (e.g., document changed)
        if (!this.documentId) {
          console.log('[HybridPdfProvider] Thumbnail generation stopped - document unloaded');
          break;
        }

        const batchEnd = Math.min(i + BATCH_SIZE, pageCount);
        const batch: number[] = [];

        // Build batch of pages that need thumbnails
        for (let page = i + 1; page <= batchEnd; page++) {
          // Skip if already cached
          const isCached = await this.pageCache.has(
            this.documentId,
            page,
            THUMBNAIL_OPTIONS.dpi! / 72 // Convert DPI to scale
          );
          if (isCached) {
            skipped++;
          } else {
            batch.push(page);
          }
        }

        if (batch.length > 0) {
          // Render batch in parallel
          await Promise.all(
            batch.map(async (page) => {
              try {
                await this.renderPage(page, THUMBNAIL_OPTIONS);
                generated++;
              } catch (err) {
                // Individual page errors shouldn't stop the batch
                console.warn(`[HybridPdfProvider] Thumbnail failed for page ${page}:`, err);
              }
            })
          );
        }

        // Yield to main thread between batches to prevent UI freezing
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const duration = performance.now() - startTime;
      console.log(
        `[HybridPdfProvider] Thumbnail generation complete: ${generated} generated, ${skipped} skipped, ${duration.toFixed(0)}ms`
      );
    } finally {
      this.isGeneratingThumbnails = false;
    }
  }

  /**
   * Get a thumbnail for a page (low-DPI cached version)
   * Returns null if thumbnail not yet generated
   */
  async getThumbnail(pageNumber: number): Promise<Blob | null> {
    if (!this.documentId) return null;

    const thumbnailScale = HybridPdfProvider.THUMBNAIL_DPI / 72;
    return this.pageCache.get(this.documentId, pageNumber, thumbnailScale);
  }

  /**
   * Check if a thumbnail exists for a page
   */
  async hasThumbnail(pageNumber: number): Promise<boolean> {
    if (!this.documentId) return false;

    const thumbnailScale = HybridPdfProvider.THUMBNAIL_DPI / 72;
    return this.pageCache.has(this.documentId, pageNumber, thumbnailScale);
  }

  private blobToImage(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        resolve(img);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
  }
}

/**
 * Create a server PDF provider with default configuration
 */
export function createHybridPdfProvider(
  config?: HybridPdfProviderConfig
): HybridPdfProvider {
  return new HybridPdfProvider(config);
}
