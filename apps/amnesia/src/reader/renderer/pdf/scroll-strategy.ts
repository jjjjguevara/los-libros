/**
 * Scroll Mode Strategy
 *
 * Rendering strategy for continuous scroll PDF viewing.
 *
 * Key characteristics:
 * - Always uses tiled rendering (256×256)
 * - Viewport-based tile priority (center tiles first)
 * - Momentum-based scroll prediction for prefetching
 * - Dynamic resolution based on scroll velocity (low-res during fast scroll)
 *
 * @example
 * ```typescript
 * const strategy = new ScrollStrategy({ prefetchViewports: 2 });
 *
 * // Get visible tiles
 * const visible = strategy.getVisibleTiles(viewport, pageLayouts, zoom);
 *
 * // Get prefetch tiles based on scroll direction
 * const prefetch = strategy.getPrefetchTiles(viewport, velocity, pageLayouts);
 * ```
 */

import type { TileCoordinate, TileScale, Rect, PageLayout } from './tile-render-engine';

/** Scroll velocity vector */
export interface ScrollVelocity {
  x: number; // Pixels per second
  y: number;
}

/** Scroll strategy configuration */
export interface ScrollStrategyConfig {
  /** Number of viewports ahead to prefetch (user-configurable) */
  prefetchViewports: number;
  /** Momentum decay factor for velocity prediction */
  momentumDecay: number;
  /** Velocity threshold for switching to low-res tiles */
  fastScrollThreshold: number;
  /** Tile size in pixels */
  tileSize: number;
}

/**
 * Scroll Mode Strategy
 */
export class ScrollStrategy {
  private config: ScrollStrategyConfig;

  constructor(config: Partial<ScrollStrategyConfig> = {}) {
    this.config = {
      prefetchViewports: config.prefetchViewports ?? 2, // User decision: 2 viewports ahead
      momentumDecay: config.momentumDecay ?? 0.95,
      fastScrollThreshold: config.fastScrollThreshold ?? 500, // px/s
      tileSize: config.tileSize ?? 256,
    };
  }

  /**
   * Update configuration (e.g., when user changes settings)
   */
  updateConfig(updates: Partial<ScrollStrategyConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get the prefetch viewports setting
   */
  get prefetchViewports(): number {
    return this.config.prefetchViewports;
  }

  /**
   * Always use tiling in scroll mode
   */
  shouldUseTiling(): boolean {
    return true;
  }

  /**
   * Get tiles visible within the current viewport.
   * For crisp rendering, pass pixelRatio to calculate proper scale.
   */
  getVisibleTiles(
    viewport: Rect,
    pageLayouts: PageLayout[],
    zoom: number,
    pixelRatio: number = 1
  ): TileCoordinate[] {
    const tiles: TileCoordinate[] = [];
    const scale = this.getScaleForZoom(zoom, pixelRatio);
    const tileSize = this.config.tileSize;

    for (const layout of pageLayouts) {
      // Check if page overlaps viewport
      if (!this.rectsOverlap(viewport, layout)) continue;

      // Calculate intersection in page coordinates
      const intersection = this.getIntersection(viewport, layout);
      const pageTiles = this.getTilesInPageRect(
        {
          x: intersection.x - layout.x,
          y: intersection.y - layout.y,
          width: intersection.width,
          height: intersection.height,
        },
        layout.page,
        scale,
        layout.width,
        layout.height
      );

      tiles.push(...pageTiles);
    }

    // Sort by distance from viewport center (prioritize central tiles)
    const centerX = viewport.x + viewport.width / 2;
    const centerY = viewport.y + viewport.height / 2;

    tiles.sort((a, b) => {
      const distA = this.getTileDistanceFromPoint(a, pageLayouts, centerX, centerY);
      const distB = this.getTileDistanceFromPoint(b, pageLayouts, centerX, centerY);
      return distA - distB;
    });

    return tiles;
  }

  /**
   * Get tiles to prefetch based on scroll velocity
   *
   * User decision: prefetch N viewports ahead (configurable)
   * Uses velocity-based resolution: lower res during fast scroll for efficiency
   */
  getPrefetchTiles(
    viewport: Rect,
    velocity: ScrollVelocity,
    pageLayouts: PageLayout[],
    zoom: number
  ): TileCoordinate[] {
    // Predict future viewport position based on scroll direction
    const predictedViewport = this.predictViewport(viewport, velocity);

    // Get current visible tile keys to exclude from prefetch
    const currentTiles = new Set(
      this.getVisibleTiles(viewport, pageLayouts, zoom).map(t => this.getTileKey(t))
    );

    // Determine prefetch scale based on zoom and scroll velocity
    // Fast scrolling = reduced quality for faster rendering
    const qualityFactor = this.getQualityFactorForVelocity(velocity);
    const prefetchScale = Math.max(1, Math.ceil(this.getScaleForZoom(zoom) * qualityFactor));

    // Get tiles in predicted viewport that aren't already visible
    const prefetchTiles: TileCoordinate[] = [];

    for (const layout of pageLayouts) {
      if (!this.rectsOverlap(predictedViewport, layout)) continue;

      const intersection = this.getIntersection(predictedViewport, layout);
      const pageTiles = this.getTilesInPageRect(
        {
          x: intersection.x - layout.x,
          y: intersection.y - layout.y,
          width: intersection.width,
          height: intersection.height,
        },
        layout.page,
        prefetchScale, // Use velocity-based scale directly
        layout.width,
        layout.height
      );

      for (const tile of pageTiles) {
        if (!currentTiles.has(this.getTileKey(tile))) {
          prefetchTiles.push(tile);
        }
      }
    }

    return prefetchTiles;
  }

  /**
   * Get quality factor based on scroll velocity.
   * Returns a multiplier (0.5 = reduced for fast scroll, 1.0 = full quality)
   */
  getQualityFactorForVelocity(velocity: ScrollVelocity): number {
    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
    return speed > this.config.fastScrollThreshold ? 0.5 : 1.0;
  }

  /**
   * Get tile scale based on zoom level and pixel ratio.
   * For crisp rendering: scale = zoom * pixelRatio
   */
  getScaleForZoom(zoom: number, pixelRatio: number = 1): TileScale {
    // Scale matches display requirements for crisp rendering
    return Math.max(1, Math.ceil(zoom * pixelRatio));
  }

  /**
   * @deprecated Use getQualityFactorForVelocity instead
   */
  getResolutionForVelocity(velocity: ScrollVelocity): number {
    return this.getQualityFactorForVelocity(velocity) * 2;
  }

  /**
   * Predict future viewport based on velocity
   *
   * Uses scroll direction to determine which way to look ahead.
   * The lookAheadFactor is multiplied by viewport dimensions, not velocity.
   */
  private predictViewport(viewport: Rect, velocity: ScrollVelocity): Rect {
    // Predict N viewports ahead in scroll direction
    const lookAheadFactor = this.config.prefetchViewports;

    // Determine direction (-1, 0, or 1) based on velocity sign
    // This handles both forward and backward scrolling
    const directionX = velocity.x > 0 ? 1 : velocity.x < 0 ? -1 : 0;
    const directionY = velocity.y > 0 ? 1 : velocity.y < 0 ? -1 : 0;

    return {
      x: viewport.x + directionX * lookAheadFactor * viewport.width,
      y: viewport.y + directionY * lookAheadFactor * viewport.height,
      width: viewport.width,
      height: viewport.height,
    };
  }

  /**
   * Get scroll buffer extent based on velocity direction
   */
  getScrollBuffer(velocity: ScrollVelocity): Rect {
    const bufferSize = this.config.prefetchViewports;
    const bufferX = Math.sign(velocity.x) * bufferSize;
    const bufferY = Math.sign(velocity.y) * bufferSize;

    return {
      x: bufferX,
      y: bufferY,
      width: bufferSize,
      height: bufferSize,
    };
  }

  /**
   * Get pages that should be rendered based on viewport
   */
  getVisiblePages(viewport: Rect, pageLayouts: PageLayout[]): number[] {
    return pageLayouts
      .filter(layout => this.rectsOverlap(viewport, layout))
      .map(layout => layout.page);
  }

  /**
   * Calculate momentum decay for smooth scroll prediction
   */
  decayVelocity(velocity: ScrollVelocity, deltaTime: number): ScrollVelocity {
    const decay = Math.pow(this.config.momentumDecay, deltaTime / 16); // 60fps baseline
    return {
      x: velocity.x * decay,
      y: velocity.y * decay,
    };
  }

  // Private helpers

  private rectsOverlap(a: Rect, b: Rect): boolean {
    return !(
      a.x + a.width < b.x ||
      b.x + b.width < a.x ||
      a.y + a.height < b.y ||
      b.y + b.height < a.y
    );
  }

  private getIntersection(a: Rect, b: Rect): Rect {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const width = Math.min(a.x + a.width, b.x + b.width) - x;
    const height = Math.min(a.y + a.height, b.y + b.height) - y;
    return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
  }

  private getTilesInPageRect(
    rect: Rect,
    page: number,
    scale: TileScale,
    pageWidth: number,
    pageHeight: number
  ): TileCoordinate[] {
    const tiles: TileCoordinate[] = [];
    const tileSize = this.config.tileSize / scale;

    const startX = Math.max(0, Math.floor(rect.x / tileSize));
    const startY = Math.max(0, Math.floor(rect.y / tileSize));
    const endX = Math.ceil((rect.x + rect.width) / tileSize);
    const endY = Math.ceil((rect.y + rect.height) / tileSize);

    const maxTileX = Math.ceil(pageWidth / tileSize);
    const maxTileY = Math.ceil(pageHeight / tileSize);

    for (let tileY = startY; tileY < Math.min(endY, maxTileY); tileY++) {
      for (let tileX = startX; tileX < Math.min(endX, maxTileX); tileX++) {
        tiles.push({ page, tileX, tileY, scale });
      }
    }

    return tiles;
  }

  private getTileDistanceFromPoint(
    tile: TileCoordinate,
    pageLayouts: PageLayout[],
    pointX: number,
    pointY: number
  ): number {
    const layout = pageLayouts.find(p => p.page === tile.page);
    if (!layout) return Infinity;

    const tileSize = this.config.tileSize / tile.scale;
    const tileCenterX = layout.x + tile.tileX * tileSize + tileSize / 2;
    const tileCenterY = layout.y + tile.tileY * tileSize + tileSize / 2;

    return Math.sqrt(
      Math.pow(tileCenterX - pointX, 2) + Math.pow(tileCenterY - pointY, 2)
    );
  }

  private getTileKey(tile: TileCoordinate): string {
    return `p${tile.page}-t${tile.tileX}x${tile.tileY}-s${tile.scale}`;
  }
}

// Singleton instance
let scrollStrategyInstance: ScrollStrategy | null = null;

/**
 * Get the shared scroll strategy instance
 */
export function getScrollStrategy(): ScrollStrategy {
  if (!scrollStrategyInstance) {
    scrollStrategyInstance = new ScrollStrategy();
  }
  return scrollStrategyInstance;
}

/**
 * Reset the strategy (for testing or settings changes)
 */
export function resetScrollStrategy(config?: Partial<ScrollStrategyConfig>): void {
  scrollStrategyInstance = config ? new ScrollStrategy(config) : null;
}

/**
 * Update scroll strategy settings
 */
export function updateScrollStrategyConfig(updates: Partial<ScrollStrategyConfig>): void {
  getScrollStrategy().updateConfig(updates);
}
