/**
 * Tile Render Engine
 *
 * CATiledLayer-style tile rendering for PDF pages.
 * Breaks pages into 256x256 tiles for efficient viewport-based rendering.
 *
 * Features:
 * - Multi-resolution tiles (1x low-res, 2x high-res)
 * - Viewport-based tile calculation
 * - Low-res fallback (never show blank)
 * - Async tile rendering via MuPDF worker
 */

import { getTelemetry } from './pdf-telemetry';

/** Tile size in pixels (matches CATiledLayer default) */
export const TILE_SIZE = 256;

/**
 * Tile scale factor for rendering resolution.
 * Scale determines how many pixels are rendered per PDF unit.
 * For crisp display: scale = zoom * pixelRatio
 *
 * Examples:
 * - scale 1: 72 DPI (1 pixel per PDF point)
 * - scale 2: 144 DPI (2 pixels per PDF point, for Retina at 1x zoom)
 * - scale 4: 288 DPI (for 2x zoom on Retina)
 * - scale 32: 2304 DPI (for 16x zoom on Retina)
 */
export type TileScale = number;

/** Tile coordinate within a page */
export interface TileCoordinate {
  /** Page number (1-indexed) */
  page: number;
  /** Tile X index (0-indexed from left) */
  tileX: number;
  /** Tile Y index (0-indexed from top) */
  tileY: number;
  /** Scale factor for rendering resolution. Higher = more detail. */
  scale: TileScale;
}

/** Tile render request with priority */
export interface TileRenderRequest {
  tile: TileCoordinate;
  priority: 'critical' | 'high' | 'medium' | 'low';
  abortSignal?: AbortSignal;
}

/** Page layout information */
export interface PageLayout {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Viewport rectangle */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Tile Render Engine
 */
export class TileRenderEngine {
  private readonly tileSize = TILE_SIZE;

  // Callbacks for tile rendering (injected by provider)
  private renderTileCallback:
    | ((tile: TileCoordinate, docId: string) => Promise<Blob>)
    | null = null;

  // Current document info
  private documentId: string | null = null;
  private pageCount = 0;
  public pageDimensions: Map<number, { width: number; height: number }> = new Map();

  /**
   * Set the document for tile rendering
   */
  setDocument(
    docId: string,
    pageCount: number,
    pageDimensions: Map<number, { width: number; height: number }>
  ): void {
    this.documentId = docId;
    this.pageCount = pageCount;
    this.pageDimensions = pageDimensions;
  }

  /**
   * Set the tile render callback (provided by hybrid-pdf-provider)
   */
  setRenderCallback(
    callback: (tile: TileCoordinate, docId: string) => Promise<Blob>
  ): void {
    this.renderTileCallback = callback;
  }

  /**
   * Get tile grid for a page at a given scale.
   * For crisp rendering, scale should be zoom * pixelRatio.
   */
  getPageTileGrid(page: number, scale: TileScale = 1): TileCoordinate[] {
    const dims = this.pageDimensions.get(page);
    if (!dims) return [];

    const tiles: TileCoordinate[] = [];
    const scaledWidth = dims.width * scale;
    const scaledHeight = dims.height * scale;

    const tilesX = Math.ceil(scaledWidth / this.tileSize);
    const tilesY = Math.ceil(scaledHeight / this.tileSize);

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        tiles.push({ page, tileX: tx, tileY: ty, scale });
      }
    }

    return tiles;
  }

  /**
   * Get tiles visible within a viewport.
   * For crisp rendering, scale should be zoom * pixelRatio.
   */
  getVisibleTiles(
    viewport: Rect,
    pageLayouts: PageLayout[],
    zoom: number,
    scale?: TileScale
  ): TileCoordinate[] {
    const tiles: TileCoordinate[] = [];
    // Use provided scale, or default to zoom for basic HiDPI support
    const effectiveScale: TileScale = scale ?? Math.max(1, Math.ceil(zoom));

    for (const layout of pageLayouts) {
      if (!this.rectsOverlap(viewport, layout)) continue;

      const intersection = this.intersectRects(viewport, layout);

      // Convert from canvas/world coordinates to PDF page coordinates
      // Canvas uses layout.width (e.g., 400), PDF uses actual dimensions (e.g., 612)
      const pdfScale = this.canvasToPdfScale(layout.page, layout.width);

      const pdfRect: Rect = {
        x: (intersection.x - layout.x) * pdfScale,
        y: (intersection.y - layout.y) * pdfScale,
        width: intersection.width * pdfScale,
        height: intersection.height * pdfScale,
      };

      const pageTiles = this.getTilesInRect(pdfRect, layout.page, effectiveScale);

      tiles.push(...pageTiles);
    }

    // Sort by distance from viewport center
    const centerX = viewport.x + viewport.width / 2;
    const centerY = viewport.y + viewport.height / 2;

    tiles.sort((a, b) => {
      const distA = this.tileDistanceFromCenter(a, pageLayouts, centerX, centerY);
      const distB = this.tileDistanceFromCenter(b, pageLayouts, centerX, centerY);
      return distA - distB;
    });

    return tiles;
  }

  /**
   * Get prefetch tiles based on scroll velocity
   */
  getPrefetchTiles(
    viewport: Rect,
    pageLayouts: PageLayout[],
    velocity: { x: number; y: number },
    viewportsAhead: number = 2
  ): TileCoordinate[] {
    const predictedViewport: Rect = {
      x: viewport.x + velocity.x * viewportsAhead,
      y: viewport.y + velocity.y * viewportsAhead,
      width: viewport.width,
      height: viewport.height,
    };

    const futureTiles = this.getVisibleTiles(predictedViewport, pageLayouts, 1);
    const currentTiles = new Set(
      this.getVisibleTiles(viewport, pageLayouts, 1).map((t) => this.getTileKey(t))
    );

    return futureTiles.filter((t) => !currentTiles.has(this.getTileKey(t)));
  }

  /**
   * Render a single tile
   */
  async renderTile(tile: TileCoordinate): Promise<Blob | null> {
    if (!this.renderTileCallback || !this.documentId) {
      console.warn('[TileRenderEngine] No render callback or document set');
      return null;
    }

    const startTime = performance.now();

    try {
      const blob = await this.renderTileCallback(tile, this.documentId);
      const duration = performance.now() - startTime;
      getTelemetry().trackRenderTime(duration, 'tile');
      return blob;
    } catch (error) {
      console.error('[TileRenderEngine] Tile render failed:', error);
      return null;
    }
  }

  /**
   * Get unique key for a tile (for caching)
   */
  getTileKey(tile: TileCoordinate): string {
    return `p${tile.page}-t${tile.tileX}x${tile.tileY}-s${tile.scale}`;
  }

  /**
   * Get PDF native dimensions for a page
   * Returns null if page dimensions not available
   */
  getPageDimensions(page: number): { width: number; height: number } | null {
    return this.pageDimensions.get(page) ?? null;
  }

  /**
   * Get the bounding box of a tile in page coordinates
   */
  getTileBounds(tile: TileCoordinate): Rect {
    const size = this.tileSize / tile.scale;
    return {
      x: tile.tileX * size,
      y: tile.tileY * size,
      width: size,
      height: size,
    };
  }

  /**
   * Draw a checkerboard placeholder for a missing tile
   */
  drawPlaceholder(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number = this.tileSize,
    height: number = this.tileSize
  ): void {
    const checkSize = 16;
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(x, y, width, height);

    ctx.fillStyle = '#e8e8e8';
    for (let ty = 0; ty < height / checkSize; ty++) {
      for (let tx = 0; tx < width / checkSize; tx++) {
        if ((tx + ty) % 2 === 0) {
          ctx.fillRect(x + tx * checkSize, y + ty * checkSize, checkSize, checkSize);
        }
      }
    }
  }

  /**
   * Get quality factor for current scroll velocity.
   * Returns a multiplier (0.5 = reduced quality for fast scroll, 1.0 = full quality when stopped)
   */
  getQualityFactorForVelocity(velocity: number): number {
    // Fast scroll: reduce quality by half for faster rendering
    // Stopped/slow: full quality
    return Math.abs(velocity) > 500 ? 0.5 : 1.0;
  }

  /**
   * Check if tiling should be used based on mode and zoom
   */
  shouldUseTiling(mode: 'paginated' | 'scroll' | 'grid', zoom: number): boolean {
    switch (mode) {
      case 'paginated':
        return zoom > 2.0; // User decision: tile only at high zoom
      case 'scroll':
        return true; // Always use tiling for scroll mode
      case 'grid':
        return false; // Grid mode uses thumbnails
    }
  }

  // Private helpers

  /**
   * Get the scale factor to convert from canvas to PDF coordinates.
   * Canvas layout uses a fixed width (e.g., 400 units), but PDF pages
   * have their own dimensions (e.g., 612×792 for US Letter).
   *
   * @param page Page number
   * @param canvasWidth Width of the page in canvas/layout units
   * @returns Scale factor: pdfWidth / canvasWidth
   */
  private canvasToPdfScale(page: number, canvasWidth: number): number {
    const dims = this.pageDimensions.get(page);
    if (!dims || canvasWidth === 0) return 1;
    return dims.width / canvasWidth;
  }

  private rectsOverlap(a: Rect, b: Rect): boolean {
    return !(
      a.x + a.width < b.x ||
      b.x + b.width < a.x ||
      a.y + a.height < b.y ||
      b.y + b.height < a.y
    );
  }

  private intersectRects(a: Rect, b: Rect): Rect {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const width = Math.min(a.x + a.width, b.x + b.width) - x;
    const height = Math.min(a.y + a.height, b.y + b.height) - y;
    return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
  }

  private getTilesInRect(
    rect: Rect,
    page: number,
    scale: TileScale
  ): TileCoordinate[] {
    const tiles: TileCoordinate[] = [];
    const tileSize = this.tileSize / scale;

    const startX = Math.floor(rect.x / tileSize);
    const startY = Math.floor(rect.y / tileSize);
    const endX = Math.ceil((rect.x + rect.width) / tileSize);
    const endY = Math.ceil((rect.y + rect.height) / tileSize);

    for (let ty = startY; ty < endY; ty++) {
      for (let tx = startX; tx < endX; tx++) {
        if (tx >= 0 && ty >= 0) {
          tiles.push({ page, tileX: tx, tileY: ty, scale });
        }
      }
    }

    return tiles;
  }

  private tileDistanceFromCenter(
    tile: TileCoordinate,
    pageLayouts: PageLayout[],
    centerX: number,
    centerY: number
  ): number {
    const layout = pageLayouts.find((p) => p.page === tile.page);
    if (!layout) return Infinity;

    const tileSize = this.tileSize / tile.scale;
    const tileCenterX = layout.x + tile.tileX * tileSize + tileSize / 2;
    const tileCenterY = layout.y + tile.tileY * tileSize + tileSize / 2;

    return Math.sqrt(
      Math.pow(tileCenterX - centerX, 2) + Math.pow(tileCenterY - centerY, 2)
    );
  }
}

// Singleton instance
let tileEngineInstance: TileRenderEngine | null = null;

/**
 * Get the shared tile render engine instance
 */
export function getTileEngine(): TileRenderEngine {
  if (!tileEngineInstance) {
    tileEngineInstance = new TileRenderEngine();
  }
  return tileEngineInstance;
}

/**
 * Reset the tile engine (for testing)
 */
export function resetTileEngine(): void {
  tileEngineInstance = null;
}
