/**
 * WASM PDF Renderer
 *
 * Client-side PDF rendering using MuPDF WASM for fast, local rendering.
 * Provides <50ms first paint by eliminating server round-trips.
 *
 * Features:
 * - Local WASM-based rendering (no server required)
 * - Accurate text layer with character-level positions
 * - Search with bounding boxes
 * - Memory-efficient caching
 *
 * @example
 * ```typescript
 * import { WasmPdfRenderer } from './wasm-renderer';
 *
 * const renderer = new WasmPdfRenderer();
 * await renderer.initialize();
 * await renderer.loadDocument(pdfArrayBuffer);
 * const pageBlob = await renderer.renderPage(1, { scale: 1.5 });
 * ```
 */

import { MuPDFBridge, getSharedMuPDFBridge, destroySharedMuPDFBridge } from './mupdf-bridge';
import type { TextLayerData, TextItem, CharPosition, SearchResult } from './mupdf-worker';
import type { PdfTextLayerData, PdfRenderOptions, PdfSearchResult } from '../types';

/**
 * Configuration for WASM renderer
 */
export interface WasmRendererConfig {
  /** Enable memory caching of rendered pages (default: true) */
  enableCache?: boolean;
  /** Maximum number of pages to cache in memory (default: 10) */
  cacheSize?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * Cached page data
 */
interface CachedPage {
  blob: Blob;
  scale: number;
  timestamp: number;
}

/**
 * WASM-based PDF renderer using MuPDF
 */
export class WasmPdfRenderer {
  private bridge: MuPDFBridge | null = null;
  private documentId: string | null = null;
  private pageCount: number = 0;
  private config: Required<WasmRendererConfig>;

  // Page cache: Map<pageNum, Map<scale, CachedPage>>
  private pageCache: Map<number, Map<number, CachedPage>> = new Map();

  // Text layer cache: Map<pageNum, TextLayerData>
  private textLayerCache: Map<number, TextLayerData> = new Map();

  constructor(config: WasmRendererConfig = {}) {
    this.config = {
      enableCache: config.enableCache ?? true,
      cacheSize: config.cacheSize ?? 10,
      debug: config.debug ?? false,
    };
  }

  /**
   * Initialize the WASM renderer
   * Spawns the Web Worker and loads MuPDF WASM
   */
  async initialize(): Promise<void> {
    if (this.bridge) return;

    const startTime = performance.now();

    this.bridge = await getSharedMuPDFBridge();

    if (this.config.debug) {
      console.log(`[WasmRenderer] Initialized in ${(performance.now() - startTime).toFixed(1)}ms`);
    }
  }

  /**
   * Load a PDF document from ArrayBuffer
   *
   * @param data PDF file as ArrayBuffer
   * @returns Page count and document info
   */
  async loadDocument(data: ArrayBuffer): Promise<{ pageCount: number; id: string }> {
    if (!this.bridge) {
      throw new Error('Renderer not initialized. Call initialize() first.');
    }

    const startTime = performance.now();

    // Clear any existing caches
    this.clearCache();

    const result = await this.bridge.loadDocumentWithId(data);
    this.documentId = result.id;
    this.pageCount = result.pageCount;

    if (this.config.debug) {
      console.log(
        `[WasmRenderer] Loaded document with ${result.pageCount} pages in ` +
          `${(performance.now() - startTime).toFixed(1)}ms`
      );
    }

    return result;
  }

  /**
   * Render a page to PNG blob
   *
   * @param pageNumber 1-indexed page number
   * @param options Render options (scale, etc.)
   * @returns PNG blob
   */
  async renderPage(pageNumber: number, options?: PdfRenderOptions): Promise<Blob> {
    if (!this.bridge || !this.documentId) {
      throw new Error('No document loaded');
    }

    const scale = options?.scale ?? 1.5;
    const startTime = performance.now();

    // Check cache first
    if (this.config.enableCache) {
      const cached = this.getCachedPage(pageNumber, scale);
      if (cached) {
        if (this.config.debug) {
          console.log(`[WasmRenderer] Cache hit for page ${pageNumber} @ ${scale}x`);
        }
        return cached;
      }
    }

    // Render via worker
    const result = await this.bridge.renderPage(this.documentId, pageNumber, scale);

    // Convert Uint8Array PNG to Blob
    // Create a new Uint8Array to ensure we have a clean copy
    const pngData = new Uint8Array(result.data);
    const blob = new Blob([pngData], { type: 'image/png' });

    // Cache the result
    if (this.config.enableCache) {
      this.setCachedPage(pageNumber, scale, blob);
    }

    if (this.config.debug) {
      console.log(
        `[WasmRenderer] Rendered page ${pageNumber} @ ${scale}x ` +
          `(${result.width}x${result.height}) in ${(performance.now() - startTime).toFixed(1)}ms`
      );
    }

    return blob;
  }

  /**
   * Render a specific tile (256x256 region) of a page
   *
   * @param pageNumber 1-indexed page number
   * @param tileX Tile X coordinate (0-indexed)
   * @param tileY Tile Y coordinate (0-indexed)
   * @param options Render options (scale, tileSize)
   * @returns PNG blob of the tile
   */
  async renderTile(
    pageNumber: number,
    tileX: number,
    tileY: number,
    options?: { scale?: number; tileSize?: number }
  ): Promise<Blob> {
    if (!this.bridge || !this.documentId) {
      throw new Error('No document loaded');
    }

    const scale = options?.scale ?? 2;
    const tileSize = options?.tileSize ?? 256;
    const startTime = performance.now();

    // Note: Tile caching is handled by TileCacheManager at a higher level
    // This method just renders the tile

    const result = await this.bridge.renderTile(
      this.documentId,
      pageNumber,
      tileX,
      tileY,
      tileSize,
      scale
    );

    // Convert Uint8Array PNG to Blob
    const pngData = new Uint8Array(result.data);
    const blob = new Blob([pngData], { type: 'image/png' });

    if (this.config.debug) {
      console.log(
        `[WasmRenderer] Rendered tile (${pageNumber}, ${tileX}, ${tileY}) @ ${scale}x ` +
          `(${result.width}x${result.height}) in ${(performance.now() - startTime).toFixed(1)}ms`
      );
    }

    return blob;
  }

  /**
   * Get the document ID (needed by RenderCoordinator)
   */
  getDocumentId(): string | null {
    return this.documentId;
  }

  /**
   * Get text layer with character positions
   *
   * @param pageNumber 1-indexed page number
   * @returns Text layer data compatible with existing text layer format
   */
  async getTextLayer(pageNumber: number): Promise<PdfTextLayerData> {
    if (!this.bridge || !this.documentId) {
      throw new Error('No document loaded');
    }

    // Check cache
    const cached = this.textLayerCache.get(pageNumber);
    if (cached) {
      return this.convertTextLayerData(cached);
    }

    const startTime = performance.now();
    const textLayer = await this.bridge.getTextLayer(this.documentId, pageNumber);

    // Cache for reuse
    this.textLayerCache.set(pageNumber, textLayer);

    if (this.config.debug) {
      console.log(
        `[WasmRenderer] Extracted text layer for page ${pageNumber} ` +
          `(${textLayer.items.length} items) in ${(performance.now() - startTime).toFixed(1)}ms`
      );
    }

    return this.convertTextLayerData(textLayer);
  }

  /**
   * Search document for text
   *
   * @param query Search query
   * @param maxHits Maximum number of results (default: 100)
   * @returns Search results with bounding boxes
   */
  async search(query: string, maxHits: number = 100): Promise<PdfSearchResult[]> {
    if (!this.bridge || !this.documentId) {
      throw new Error('No document loaded');
    }

    const startTime = performance.now();
    const results = await this.bridge.search(this.documentId, query, maxHits);

    if (this.config.debug) {
      console.log(
        `[WasmRenderer] Search "${query}" found ${results.length} results ` +
          `in ${(performance.now() - startTime).toFixed(1)}ms`
      );
    }

    return this.convertSearchResults(results);
  }

  /**
   * Get page dimensions at scale 1.0 (72 DPI)
   *
   * @param pageNumber 1-indexed page number
   * @returns Width and height in points
   */
  async getPageDimensions(pageNumber: number): Promise<{ width: number; height: number }> {
    if (!this.bridge || !this.documentId) {
      throw new Error('No document loaded');
    }

    return this.bridge.getPageDimensions(this.documentId, pageNumber);
  }

  /**
   * Get page count
   */
  getPageCount(): number {
    return this.pageCount;
  }

  /**
   * Check if a document is loaded
   */
  isDocumentLoaded(): boolean {
    return this.documentId !== null;
  }

  /**
   * Unload current document and free resources
   */
  async unloadDocument(): Promise<void> {
    if (this.bridge && this.documentId) {
      await this.bridge.unloadDocument(this.documentId);
    }

    this.documentId = null;
    this.pageCount = 0;
    this.clearCache();
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.pageCache.clear();
    this.textLayerCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { pageCount: number; textLayerCount: number } {
    let pageCount = 0;
    for (const scaleMap of this.pageCache.values()) {
      pageCount += scaleMap.size;
    }

    return {
      pageCount,
      textLayerCount: this.textLayerCache.size,
    };
  }

  /**
   * Destroy the renderer and release all resources
   */
  destroy(): void {
    this.clearCache();
    this.documentId = null;
    this.pageCount = 0;
    this.bridge = null;

    // Note: We don't destroy the shared bridge here since it may be used by other renderers
    // Call destroySharedMuPDFBridge() explicitly when done with all renderers
  }

  // Private methods

  /**
   * Get cached page if exists
   */
  private getCachedPage(pageNumber: number, scale: number): Blob | null {
    const scaleMap = this.pageCache.get(pageNumber);
    if (!scaleMap) return null;

    // Normalize scale for cache key (2 decimal places)
    const normalizedScale = Math.round(scale * 100) / 100;
    const cached = scaleMap.get(normalizedScale);

    return cached?.blob ?? null;
  }

  /**
   * Set cached page
   */
  private setCachedPage(pageNumber: number, scale: number, blob: Blob): void {
    // Enforce cache size limit by evicting oldest entries
    this.evictOldestIfNeeded();

    let scaleMap = this.pageCache.get(pageNumber);
    if (!scaleMap) {
      scaleMap = new Map();
      this.pageCache.set(pageNumber, scaleMap);
    }

    const normalizedScale = Math.round(scale * 100) / 100;
    scaleMap.set(normalizedScale, {
      blob,
      scale: normalizedScale,
      timestamp: Date.now(),
    });
  }

  /**
   * Evict oldest cache entries if over limit
   */
  private evictOldestIfNeeded(): void {
    // Count total cached pages
    let totalCached = 0;
    for (const scaleMap of this.pageCache.values()) {
      totalCached += scaleMap.size;
    }

    // Evict oldest while over limit
    while (totalCached >= this.config.cacheSize) {
      let oldestTime = Infinity;
      let oldestPage = -1;
      let oldestScale = -1;

      for (const [pageNum, scaleMap] of this.pageCache) {
        for (const [scale, cached] of scaleMap) {
          if (cached.timestamp < oldestTime) {
            oldestTime = cached.timestamp;
            oldestPage = pageNum;
            oldestScale = scale;
          }
        }
      }

      if (oldestPage >= 0) {
        const scaleMap = this.pageCache.get(oldestPage);
        if (scaleMap) {
          scaleMap.delete(oldestScale);
          if (scaleMap.size === 0) {
            this.pageCache.delete(oldestPage);
          }
        }
        totalCached--;
      } else {
        break;
      }
    }
  }

  /**
   * Convert MuPDF text layer to standard format
   */
  private convertTextLayerData(data: TextLayerData): PdfTextLayerData {
    return {
      page: data.pageNum,
      width: data.width,
      height: data.height,
      items: data.items.map((item) => ({
        text: item.text,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        fontSize: item.fontSize,
        // Add character-level positions
        charPositions: item.charPositions.map((char) => ({
          char: char.char,
          x: char.x,
          y: char.y,
          width: char.width,
          height: char.height,
          fontSize: char.fontSize,
          fontName: char.fontName,
        })),
      })),
    };
  }

  /**
   * Convert MuPDF search results to standard format
   */
  private convertSearchResults(results: SearchResult[]): PdfSearchResult[] {
    return results.map((result) => ({
      page: result.page,
      text: result.text,
      bounds: result.quads.map((quad) => ({
        x: quad.x,
        y: quad.y,
        width: quad.width,
        height: quad.height,
      })),
    }));
  }
}

/**
 * Singleton instance for shared use - use promise to prevent race conditions
 */
let sharedRendererPromise: Promise<WasmPdfRenderer> | null = null;
let sharedRendererInstance: WasmPdfRenderer | null = null;

/**
 * Get or create the shared WASM renderer instance.
 * Uses promise-based singleton to prevent race conditions when multiple
 * callers invoke this concurrently during initialization.
 */
export async function getSharedWasmRenderer(): Promise<WasmPdfRenderer> {
  if (!sharedRendererPromise) {
    sharedRendererPromise = (async () => {
      const renderer = new WasmPdfRenderer();
      await renderer.initialize();
      sharedRendererInstance = renderer;
      return renderer;
    })();
  }
  return sharedRendererPromise;
}

/**
 * Destroy the shared WASM renderer
 */
export function destroySharedWasmRenderer(): void {
  if (sharedRendererInstance) {
    sharedRendererInstance.destroy();
    sharedRendererInstance = null;
  }
  sharedRendererPromise = null;
  destroySharedMuPDFBridge();
}

/**
 * Factory function to create a WASM renderer
 */
export function createWasmRenderer(config?: WasmRendererConfig): WasmPdfRenderer {
  return new WasmPdfRenderer(config);
}
