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

/** Speed zone for adaptive prefetching */
export type SpeedZone = 'stationary' | 'slow' | 'medium' | 'fast';

/** Prefetch priority level */
export type PrefetchPriority = 0 | 1 | 2 | 3; // 0 = critical, 3 = background

/** Tile with priority information */
export interface PrioritizedTile extends TileCoordinate {
  priority: PrefetchPriority;
  distanceFromViewport: number; // In viewport units (0.5 = half viewport away)
}

/** Speed zone thresholds and settings */
export interface SpeedZoneConfig {
  /** Speed threshold in pixels/second to enter this zone */
  minSpeed: number;
  /** Number of viewports to look ahead */
  lookahead: number;
  /** Quality factor (0.5-1.0) for rendering */
  quality: number;
}

/** Scroll strategy configuration */
export interface ScrollStrategyConfig {
  /** Number of viewports ahead to prefetch (user-configurable, used as base) */
  prefetchViewports: number;
  /** Momentum decay factor for velocity prediction */
  momentumDecay: number;
  /** Velocity threshold for switching to low-res tiles */
  fastScrollThreshold: number;
  /** Tile size in pixels */
  tileSize: number;
  /** Enable adaptive velocity-based prefetching */
  adaptivePrefetch: boolean;
  /** Speed zone configurations */
  speedZones: Record<SpeedZone, SpeedZoneConfig>;
}

/**
 * Scroll Mode Strategy
 */
/** Default speed zone configurations based on plan analysis */
const DEFAULT_SPEED_ZONES: Record<SpeedZone, SpeedZoneConfig> = {
  stationary: { minSpeed: 0, lookahead: 1.0, quality: 1.0 },
  slow: { minSpeed: 50, lookahead: 1.5, quality: 0.9 },
  medium: { minSpeed: 200, lookahead: 2.5, quality: 0.75 },
  fast: { minSpeed: 500, lookahead: 4.0, quality: 0.5 },
};

export class ScrollStrategy {
  private config: ScrollStrategyConfig;

  constructor(config: Partial<ScrollStrategyConfig> = {}) {
    this.config = {
      prefetchViewports: config.prefetchViewports ?? 2, // User decision: 2 viewports ahead
      momentumDecay: config.momentumDecay ?? 0.95,
      fastScrollThreshold: config.fastScrollThreshold ?? 500, // px/s
      tileSize: config.tileSize ?? 256,
      adaptivePrefetch: config.adaptivePrefetch ?? true, // Enable by default
      speedZones: config.speedZones ?? DEFAULT_SPEED_ZONES,
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
   *
   * Now uses adaptive speed zones for graduated quality scaling.
   */
  getQualityFactorForVelocity(velocity: ScrollVelocity): number {
    if (this.config.adaptivePrefetch) {
      const zone = this.getSpeedZone(velocity);
      return this.config.speedZones[zone].quality;
    }
    // Legacy behavior
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

  // ============================================================
  // ADAPTIVE VELOCITY-BASED PREFETCHING
  // ============================================================

  /**
   * Determine the speed zone based on scroll velocity.
   *
   * Speed zones:
   * - stationary: <50 px/s - user is reading/examining
   * - slow: 50-200 px/s - casual browsing
   * - medium: 200-500 px/s - navigation scroll
   * - fast: >500 px/s - rapid scrolling (searching for something)
   */
  getSpeedZone(velocity: ScrollVelocity): SpeedZone {
    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
    const zones = this.config.speedZones;

    if (speed >= zones.fast.minSpeed) return 'fast';
    if (speed >= zones.medium.minSpeed) return 'medium';
    if (speed >= zones.slow.minSpeed) return 'slow';
    return 'stationary';
  }

  /**
   * Get adaptive lookahead distance based on velocity.
   *
   * Faster scrolling = look further ahead to have tiles ready.
   * Returns number of viewports to prefetch ahead.
   */
  getAdaptiveLookahead(velocity: ScrollVelocity): number {
    if (!this.config.adaptivePrefetch) {
      return this.config.prefetchViewports;
    }
    const zone = this.getSpeedZone(velocity);
    return this.config.speedZones[zone].lookahead;
  }

  /**
   * Get prefetch tiles with priority zones.
   *
   * Priority zones (in viewport units from current viewport edge):
   * - Critical (0-0.5): Priority 0 - must render immediately
   * - High (0.5-1.5): Priority 1 - prefetch soon
   * - Medium (1.5-2.5): Priority 2 - opportunistic
   * - Low (2.5-lookahead): Priority 3 - background
   *
   * @returns Tiles sorted by priority (lowest number = highest priority)
   */
  getPrefetchTilesWithPriority(
    viewport: Rect,
    velocity: ScrollVelocity,
    pageLayouts: PageLayout[],
    zoom: number,
    pixelRatio: number = 1
  ): PrioritizedTile[] {
    const lookahead = this.getAdaptiveLookahead(velocity);
    const quality = this.getQualityFactorForVelocity(velocity);
    const scale = this.getScaleForZoom(zoom, pixelRatio * quality);

    // Normalize velocity direction
    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
    const dirX = speed > 0 ? velocity.x / speed : 0;
    const dirY = speed > 0 ? velocity.y / speed : 0;

    // Expand viewport in scroll direction by lookahead amount
    const expandedViewport = this.expandViewportInDirection(
      viewport,
      dirX,
      dirY,
      lookahead
    );

    // Get current visible tiles to exclude
    const currentTiles = new Set(
      this.getVisibleTiles(viewport, pageLayouts, zoom, pixelRatio)
        .map(t => this.getTileKey(t))
    );

    const prioritizedTiles: PrioritizedTile[] = [];

    for (const layout of pageLayouts) {
      if (!this.rectsOverlap(expandedViewport, layout)) continue;

      const intersection = this.getIntersection(expandedViewport, layout);
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

      for (const tile of pageTiles) {
        if (currentTiles.has(this.getTileKey(tile))) continue;

        // Calculate distance from viewport in viewport units
        const distance = this.getTileDistanceFromViewport(tile, layout, viewport, dirX, dirY);

        // Assign priority based on distance
        const priority = this.getPriorityForDistance(distance);

        prioritizedTiles.push({
          ...tile,
          priority,
          distanceFromViewport: distance,
        });
      }
    }

    // Sort by priority (lower = higher priority), then by distance
    prioritizedTiles.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.distanceFromViewport - b.distanceFromViewport;
    });

    return prioritizedTiles;
  }

  /**
   * Expand viewport in scroll direction by a factor.
   */
  private expandViewportInDirection(
    viewport: Rect,
    dirX: number,
    dirY: number,
    factor: number
  ): Rect {
    // Expand asymmetrically - more in scroll direction, less behind
    const forwardFactor = factor;
    const backwardFactor = 0.5; // Keep half viewport behind

    const expandX = Math.abs(dirX) * viewport.width;
    const expandY = Math.abs(dirY) * viewport.height;

    return {
      x: viewport.x - (dirX < 0 ? expandX * forwardFactor : expandX * backwardFactor),
      y: viewport.y - (dirY < 0 ? expandY * forwardFactor : expandY * backwardFactor),
      width: viewport.width + expandX * (forwardFactor + backwardFactor),
      height: viewport.height + expandY * (forwardFactor + backwardFactor),
    };
  }

  /**
   * Calculate tile distance from viewport edge in scroll direction.
   * Returns distance in viewport units (1.0 = one viewport away).
   */
  private getTileDistanceFromViewport(
    tile: TileCoordinate,
    layout: PageLayout,
    viewport: Rect,
    dirX: number,
    dirY: number
  ): number {
    const tileSize = this.config.tileSize / tile.scale;
    const tileCenterX = layout.x + tile.tileX * tileSize + tileSize / 2;
    const tileCenterY = layout.y + tile.tileY * tileSize + tileSize / 2;

    const viewportCenterX = viewport.x + viewport.width / 2;
    const viewportCenterY = viewport.y + viewport.height / 2;

    // Project distance onto scroll direction
    const dx = tileCenterX - viewportCenterX;
    const dy = tileCenterY - viewportCenterY;

    // Distance along scroll direction (positive = ahead, negative = behind)
    const projectedDistance = dx * dirX + dy * dirY;

    // Normalize by viewport size in scroll direction
    const viewportSizeInDir = Math.abs(dirX) * viewport.width + Math.abs(dirY) * viewport.height;
    if (viewportSizeInDir === 0) {
      // Stationary - use Euclidean distance
      return Math.sqrt(dx * dx + dy * dy) / Math.max(viewport.width, viewport.height);
    }

    return Math.abs(projectedDistance) / viewportSizeInDir;
  }

  /**
   * Map distance (in viewport units) to priority level.
   *
   * Priority zones:
   * - 0-0.5 viewport: Critical (priority 0)
   * - 0.5-1.5 viewport: High (priority 1)
   * - 1.5-2.5 viewport: Medium (priority 2)
   * - 2.5+: Low (priority 3)
   */
  private getPriorityForDistance(distance: number): PrefetchPriority {
    if (distance < 0.5) return 0;
    if (distance < 1.5) return 1;
    if (distance < 2.5) return 2;
    return 3;
  }

  /**
   * Predict future viewport based on velocity
   *
   * Uses scroll direction and adaptive lookahead to determine prefetch area.
   * Faster scrolling = look further ahead.
   */
  private predictViewport(viewport: Rect, velocity: ScrollVelocity): Rect {
    // Use adaptive lookahead based on velocity
    const lookAheadFactor = this.getAdaptiveLookahead(velocity);

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
