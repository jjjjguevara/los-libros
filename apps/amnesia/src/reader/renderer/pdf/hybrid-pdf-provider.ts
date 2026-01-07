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

import { ApiClient, ApiError, getApiClient } from '../api-client';
import type {
  ParsedPdf,
  PdfTextLayerData,
  PdfRenderOptions,
  PdfSearchResult,
} from '../types';
import { PdfPageCache, type CacheStats } from './pdf-cache';
import { AdaptivePrefetcher, type PrefetchStrategy, type PrefetchStats } from './adaptive-prefetcher';

export type PdfProviderMode = 'server' | 'auto';

export interface HybridPdfProviderConfig {
  /** Server base URL */
  serverBaseUrl?: string;
  /** Preferred provider mode (server or auto - both use server) */
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
  /** Maximum number of pages to keep in memory cache (default: 10) */
  cacheSize?: number;
  /** Memory budget for cache in MB (default: 200) - overrides cacheSize */
  memoryBudgetMB?: number;
  /** Enable batch page requests (default: true) */
  enableBatchRequests?: boolean;
  /** Number of pages per batch request (default: 5) */
  batchSize?: number;
  /** Prefetch strategy: 'none', 'fixed', or 'adaptive' (default: 'adaptive') */
  prefetchStrategy?: PrefetchStrategy;
  /** DPI for server-side rendering. Default: 150 */
  renderDpi?: number;
  /**
   * @deprecated Scale is no longer used. Use renderDpi for quality control.
   * This field is ignored.
   */
  renderScale?: number;
  /** Image format for rendered pages. Default: 'png' */
  imageFormat?: 'png' | 'jpeg' | 'webp';
  /** Image quality for lossy formats (1-100). Default: 85 */
  imageQuality?: number;
}

export interface HybridPdfProviderStatus {
  activeMode: 'server';
  serverAvailable: boolean;
  documentId: string | null;
  pageCount: number;
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

  // Caching
  private pageCache: PdfPageCache;

  // Prefetching
  private prefetchQueue: number[] = [];
  private isPrefetching: boolean = false;
  private prefetchTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Adaptive prefetcher
  private adaptivePrefetcher: AdaptivePrefetcher | null = null;

  constructor(config: HybridPdfProviderConfig = {}) {
    this.config = {
      serverBaseUrl: config.serverBaseUrl ?? '',
      preferMode: config.preferMode ?? 'auto',
      healthCheckTimeout: config.healthCheckTimeout ?? 5000,
      deviceId: config.deviceId ?? 'server-provider',
      enableCache: config.enableCache ?? true,
      enablePrefetch: config.enablePrefetch ?? true,
      prefetchCount: config.prefetchCount ?? 2,
      cacheSize: config.cacheSize ?? 10,
      memoryBudgetMB: config.memoryBudgetMB ?? 200,
      enableBatchRequests: config.enableBatchRequests ?? true,
      batchSize: config.batchSize ?? 5,
      prefetchStrategy: config.prefetchStrategy ?? 'adaptive',
      // Render quality settings - wired from plugin settings
      // Note: renderScale is deprecated, only DPI is used for quality
      renderDpi: config.renderDpi ?? 150,
      renderScale: 1.0, // Deprecated, kept for type compatibility
      imageFormat: config.imageFormat ?? 'png',
      imageQuality: config.imageQuality ?? 85,
    };

    // Use byte-based cache if memoryBudgetMB is set, otherwise fall back to entry count
    if (config.memoryBudgetMB !== undefined) {
      this.pageCache = new PdfPageCache({
        maxMemoryBytes: this.config.memoryBudgetMB * 1024 * 1024,
      });
    } else {
      // Legacy: convert entry count to byte estimate
      this.pageCache = PdfPageCache.fromEntryCount(this.config.cacheSize);
    }

    // Create adaptive prefetcher if strategy is adaptive
    if (this.config.prefetchStrategy === 'adaptive') {
      this.adaptivePrefetcher = new AdaptivePrefetcher({
        strategy: 'adaptive',
        basePrefetchCount: this.config.prefetchCount,
        maxPrefetchCount: Math.min(this.config.prefetchCount * 4, 10),
      });
    }
  }

  /**
   * Get current provider status
   */
  getStatus(): HybridPdfProviderStatus {
    return {
      activeMode: 'server',
      serverAvailable: this.serverAvailable,
      documentId: this.documentId,
      pageCount: this.parsedPdf?.pageCount ?? 0,
    };
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
   * Initialize the provider - checks server availability and initializes cache
   */
  async initialize(): Promise<void> {
    // Initialize cache if enabled
    if (this.config.enableCache) {
      await this.pageCache.initialize();
    }

    if (await this.checkServerHealth()) {
      this.apiClient = getApiClient();
    } else {
      throw new Error('Amnesia server is not available. PDF rendering requires a running server.');
    }
  }

  /**
   * Load a PDF document from ArrayBuffer
   * First checks if the PDF already exists on the server, if so uses it.
   * Otherwise uploads the PDF.
   */
  async loadDocument(data: ArrayBuffer, documentId?: string): Promise<ParsedPdf> {
    if (!this.apiClient) {
      throw new Error('Provider not initialized. Call initialize() first.');
    }

    this.pdfData = data;

    // Try to get existing PDF first (by ID derived from filename)
    if (documentId) {
      const pdfId = documentId.replace(/\.pdf$/i, '');
      try {
        this.parsedPdf = await this.apiClient.getPdf(pdfId);
        this.documentId = this.parsedPdf.id;
        console.log('[HybridPdfProvider] Using existing PDF from server:', pdfId);
        this.initializePrefetcher();
        return this.parsedPdf;
      } catch (error) {
        // Only fall through to upload on 404 (not found)
        // Other errors (timeout, server error, etc.) should be propagated
        if (error instanceof ApiError && error.statusCode === 404) {
          console.log('[HybridPdfProvider] PDF not found on server, uploading:', pdfId);
        } else {
          // Re-throw non-404 errors (timeout, server error, etc.)
          console.error('[HybridPdfProvider] Server error:', error);
          throw error;
        }
      }
    }

    // Upload the PDF
    this.parsedPdf = await this.apiClient.uploadPdf(data, documentId);
    this.documentId = this.parsedPdf.id;
    this.initializePrefetcher();
    return this.parsedPdf;
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
    this.initializePrefetcher();
    return this.parsedPdf;
  }

  /**
   * Initialize adaptive prefetcher with page count and fetch callback
   */
  private initializePrefetcher(): void {
    if (this.adaptivePrefetcher && this.parsedPdf) {
      this.adaptivePrefetcher.initialize(
        this.parsedPdf.pageCount,
        async (page: number) => {
          // Fetch and cache the page using config values (DPI only, scale deprecated)
          const dpi = this.config.renderDpi;
          const format = this.config.imageFormat;
          const quality = this.config.imageQuality;
          const renderOptions = { dpi, format, quality };
          const blob = await this.apiClient!.getPdfPage(this.documentId!, page, renderOptions);

          // Validate blob before caching (prefetch should not cache bad data)
          const validImageTypes = ['image/png', 'image/jpeg', 'image/webp'];
          if (!validImageTypes.includes(blob.type) || blob.size === 0) {
            console.warn(`[HybridPdfProvider] Prefetch rejected invalid blob for page ${page}: type=${blob.type}, size=${blob.size}`);
            return; // Skip caching invalid blob
          }

          await this.pageCache.set(this.documentId!, page, renderOptions, blob);
          this.adaptivePrefetcher?.markCached(page);
        }
      );
    }
  }

  /**
   * Render a page to a blob (with caching)
   *
   * Note: Scale is deprecated. Only DPI is used for quality control.
   */
  async renderPage(pageNumber: number, options?: PdfRenderOptions): Promise<Blob> {
    if (!this.apiClient || !this.documentId) {
      throw new Error('No document loaded');
    }

    // Merge caller options with config defaults (scale is deprecated, ignored)
    const mergedOptions: PdfRenderOptions = {
      dpi: options?.dpi ?? this.config.renderDpi,
      format: options?.format ?? this.config.imageFormat,
      quality: options?.quality ?? this.config.imageQuality,
    };

    console.log('[HybridPdfProvider] renderPage called:', {
      page: pageNumber,
      requestedDpi: options?.dpi,
      mergedOptions,
    });

    // Check cache first - now includes DPI, format, quality in cache key
    if (this.config.enableCache) {
      const cached = await this.pageCache.get(this.documentId, pageNumber, mergedOptions);
      if (cached) {
        console.log('[HybridPdfProvider] Cache hit for page', pageNumber, 'with options:', mergedOptions);
        // Trigger prefetch in background
        if (this.config.enablePrefetch) {
          this.prefetchAdjacentPages(pageNumber, mergedOptions);
        }
        return cached;
      }
    }

    // Fetch from server with merged options
    console.log('[HybridPdfProvider] Fetching from server:', { page: pageNumber, ...mergedOptions });
    const blob = await this.apiClient.getPdfPage(this.documentId, pageNumber, mergedOptions);

    // Validate blob type and size before caching (defense in depth)
    const validImageTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!validImageTypes.includes(blob.type)) {
      throw new ApiError(`Invalid image type for page ${pageNumber}: ${blob.type}`, 400);
    }
    if (blob.size === 0) {
      throw new ApiError(`Empty blob received for page ${pageNumber}`, 500);
    }

    // Cache for later - includes all render options in cache key
    if (this.config.enableCache) {
      await this.pageCache.set(this.documentId, pageNumber, mergedOptions, blob);
    }

    // Trigger prefetch in background
    if (this.config.enablePrefetch) {
      this.prefetchAdjacentPages(pageNumber, mergedOptions);
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
   */
  async getTextLayer(pageNumber: number): Promise<PdfTextLayerData> {
    if (!this.apiClient || !this.documentId) {
      throw new Error('No document loaded');
    }

    return this.apiClient.getPdfTextLayer(this.documentId, pageNumber);
  }

  /**
   * Get SVG text layer for crisp text at any zoom level
   * Returns an SVG document string with transparent text elements positioned
   * to match the PDF layout.
   */
  async getSvgTextLayer(pageNumber: number): Promise<string> {
    if (!this.apiClient || !this.documentId) {
      throw new Error('No document loaded');
    }

    return this.apiClient.getPdfSvgTextLayer(this.documentId, pageNumber);
  }

  /**
   * Get page dimensions
   * Note: Server should provide page dimensions in a future API endpoint.
   * For now, returns standard US Letter dimensions at 72 DPI.
   */
  async getPageDimensions(_pageNumber: number): Promise<{ width: number; height: number }> {
    if (!this.parsedPdf) {
      throw new Error('No document loaded');
    }

    // TODO: Add server API endpoint to get per-page dimensions
    // For now, return standard US Letter size
    return { width: 612, height: 792 }; // US Letter at 72 DPI
  }

  /**
   * Search for text
   */
  async search(query: string, limit: number = 50): Promise<PdfSearchResult[]> {
    if (!this.apiClient || !this.documentId) {
      throw new Error('No document loaded');
    }

    return this.apiClient.searchPdf(this.documentId, query, limit);
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
    // Cancel pending prefetch
    this.cancelPrefetch();

    // Destroy adaptive prefetcher
    if (this.adaptivePrefetcher) {
      this.adaptivePrefetcher.destroy();
      this.adaptivePrefetcher = null;
    }

    // Destroy page cache
    this.pageCache.destroy();

    this.documentId = null;
    this.parsedPdf = null;
    this.pdfData = null;
    this.apiClient = null;
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
   * Get prefetch statistics (for debugging/monitoring)
   */
  getPrefetchStats(): PrefetchStats | null {
    if (this.adaptivePrefetcher) {
      return this.adaptivePrefetcher.getStats();
    }
    return null;
  }

  /**
   * Notify provider of page change (for adaptive prefetching)
   */
  notifyPageChange(page: number): void {
    if (this.adaptivePrefetcher && this.config.prefetchStrategy === 'adaptive') {
      this.adaptivePrefetcher.onPageChange(page);
    }
  }

  /**
   * Update prefetch strategy at runtime
   */
  setPrefetchStrategy(strategy: PrefetchStrategy): void {
    this.config.prefetchStrategy = strategy;

    if (strategy === 'adaptive' && !this.adaptivePrefetcher) {
      // Create adaptive prefetcher if switching to adaptive
      this.adaptivePrefetcher = new AdaptivePrefetcher({
        strategy: 'adaptive',
        basePrefetchCount: this.config.prefetchCount,
        maxPrefetchCount: Math.min(this.config.prefetchCount * 4, 10),
      });
      this.initializePrefetcher();
    } else if (strategy !== 'adaptive' && this.adaptivePrefetcher) {
      // Destroy adaptive prefetcher if switching away
      this.adaptivePrefetcher.destroy();
      this.adaptivePrefetcher = null;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return this.pageCache.getStats();
  }

  /**
   * Update memory budget at runtime
   */
  setMemoryBudget(mb: number): void {
    this.pageCache.setMemoryBudget(mb * 1024 * 1024);
  }

  // Private methods

  /**
   * Prefetch adjacent pages in the background
   */
  private prefetchAdjacentPages(currentPage: number, options: PdfRenderOptions): void {
    if (!this.documentId || !this.config.enablePrefetch) return;
    if (this.config.prefetchStrategy === 'none') return;

    // Use adaptive prefetcher if strategy is adaptive
    if (this.config.prefetchStrategy === 'adaptive' && this.adaptivePrefetcher) {
      this.adaptivePrefetcher.onPageChange(currentPage);
      return;
    }

    // Fixed prefetch strategy (legacy behavior)
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
        this.pageCache.has(this.documentId, page, options).then((isCached) => {
          if (!isCached && !this.prefetchQueue.includes(page)) {
            this.prefetchQueue.push(page);
            this.processPrefetchQueue(options);
          }
        });
      }
    }
  }

  /**
   * Process the prefetch queue - uses batch or sequential based on config
   */
  private async processPrefetchQueue(options: PdfRenderOptions): Promise<void> {
    if (this.isPrefetching || this.prefetchQueue.length === 0) return;
    if (!this.apiClient || !this.documentId) return;

    this.isPrefetching = true;

    try {
      if (this.config.enableBatchRequests && this.prefetchQueue.length > 1) {
        // Use batch requests for multiple pages
        await this.processPrefetchBatch(options);
      } else {
        // Process single page
        await this.processPrefetchSingle(options);
      }
    } catch (error) {
      console.warn('[PDF] Prefetch error:', error);
    }

    this.isPrefetching = false;

    // Process remaining pages with delay
    if (this.prefetchQueue.length > 0) {
      this.prefetchTimeoutId = setTimeout(() => {
        this.processPrefetchQueue(options);
      }, 100);
    }
  }

  /**
   * Process prefetch queue using batch requests
   */
  private async processPrefetchBatch(options: PdfRenderOptions): Promise<void> {
    if (!this.apiClient || !this.documentId) return;

    // Take up to batchSize pages from queue
    const batchSize = Math.min(this.config.batchSize, this.prefetchQueue.length);
    const pages = this.prefetchQueue.splice(0, batchSize);

    // Filter out already-cached pages
    const uncachedPages: number[] = [];
    for (const page of pages) {
      const isCached = await this.pageCache.has(this.documentId, page, options);
      if (!isCached) {
        uncachedPages.push(page);
      }
    }

    if (uncachedPages.length === 0) return;

    try {
      const blobs = await this.apiClient.getPdfPagesBatch(
        this.documentId,
        uncachedPages,
        options
      );

      // Cache all fetched pages with full render options (validate before caching)
      const validImageTypes = ['image/png', 'image/jpeg', 'image/webp'];
      let cachedCount = 0;
      for (const [page, blob] of blobs) {
        // Skip invalid blobs
        if (!validImageTypes.includes(blob.type) || blob.size === 0) {
          console.warn(`[PDF] Batch prefetch rejected invalid blob for page ${page}: type=${blob.type}, size=${blob.size}`);
          continue;
        }
        await this.pageCache.set(this.documentId, page, options, blob);
        cachedCount++;
      }

      console.log(`[PDF] Batch prefetched ${cachedCount} pages: ${Array.from(blobs.keys()).join(', ')}`);
    } catch (error) {
      console.warn('[PDF] Batch prefetch failed:', error);
      // Re-add pages to queue for retry
      this.prefetchQueue.push(...uncachedPages);
    }
  }

  /**
   * Process a single page from the prefetch queue
   */
  private async processPrefetchSingle(options: PdfRenderOptions): Promise<void> {
    if (!this.apiClient || !this.documentId) return;

    const page = this.prefetchQueue.shift();
    if (!page) return;

    try {
      const isCached = await this.pageCache.has(this.documentId, page, options);
      if (!isCached) {
        const blob = await this.apiClient.getPdfPage(this.documentId, page, options);

        // Validate blob before caching
        const validImageTypes = ['image/png', 'image/jpeg', 'image/webp'];
        if (!validImageTypes.includes(blob.type) || blob.size === 0) {
          console.warn(`[PDF] Prefetch rejected invalid blob for page ${page}: type=${blob.type}, size=${blob.size}`);
          return; // Skip caching invalid blob
        }

        await this.pageCache.set(this.documentId, page, options, blob);
        console.log(`[PDF] Prefetched page ${page}`);
      }
    } catch (error) {
      console.warn(`[PDF] Prefetch failed for page ${page}:`, error);
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
