/**
 * Render Coordinator
 *
 * Unified render queue that coordinates between mode-specific strategies.
 * Manages request deduplication, concurrency limiting, and mode transitions.
 *
 * Features:
 * - Request deduplication (same tile/page only rendered once)
 * - Semaphore-based concurrency limiting (no busy-wait)
 * - Mode transition handling (cancel obsolete requests)
 * - Abort signal support for cancellation
 * - Telemetry integration
 *
 * @example
 * ```typescript
 * const coordinator = getRenderCoordinator();
 * coordinator.setMode('scroll');
 *
 * // Request a tile render
 * const result = await coordinator.requestRender({
 *   type: 'tile',
 *   tile: { page: 1, tileX: 0, tileY: 0, scale: 2 },
 *   priority: 'critical',
 * });
 * ```
 */

import type { TileCoordinate } from './tile-render-engine';
import { getTileCacheManager } from './tile-cache-manager';
import { getPaginatedStrategy } from './paginated-strategy';
import { getScrollStrategy, type PrioritizedTile, type SpeedZone } from './scroll-strategy';
import { getGridStrategy } from './grid-strategy';
import { getTelemetry } from './pdf-telemetry';

/** Render request priority levels */
export type RenderPriority = 'critical' | 'high' | 'medium' | 'low';

/** Tile render request */
export interface TileRenderRequest {
  type: 'tile';
  tile: TileCoordinate;
  priority: RenderPriority;
  abortController?: AbortController;
}

/** Page render request */
export interface PageRenderRequest {
  type: 'page';
  page: number;
  scale: number;
  priority: RenderPriority;
  abortController?: AbortController;
}

/** Render request union type */
export type RenderRequest = TileRenderRequest | PageRenderRequest;

/** Render result */
export interface RenderResult {
  success: boolean;
  data?: ImageBitmap | Blob;
  error?: string;
  fromCache: boolean;
}

/** Render mode */
export type RenderMode = 'paginated' | 'scroll' | 'grid';

/**
 * Simple semaphore for concurrency limiting
 * Uses event-driven notification instead of busy-wait polling
 */
class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(maxPermits: number) {
    this.permits = maxPermits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    // Wait for a permit to become available
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    // If there's a waiter, give them the permit immediately
    const waiter = this.waitQueue.shift();
    if (waiter) {
      waiter();
    } else {
      this.permits++;
    }
  }

  get available(): number {
    return this.permits;
  }

  get waiting(): number {
    return this.waitQueue.length;
  }
}

/**
 * Render Coordinator
 */
export class RenderCoordinator {
  /** In-flight requests (for deduplication) */
  private inFlight = new Map<string, Promise<RenderResult>>();

  /** Current render mode */
  private currentMode: RenderMode = 'paginated';

  /** Render callback (injected by provider) */
  private renderTileCallback:
    | ((tile: TileCoordinate, docId: string) => Promise<Blob>)
    | null = null;
  private renderPageCallback:
    | ((page: number, scale: number, docId: string) => Promise<Blob>)
    | null = null;

  /** Current document ID */
  private documentId: string | null = null;

  /** Concurrency semaphore */
  private semaphore: Semaphore;

  /** Active render tracking for stats */
  private activeRenders = 0;

  /** Abort controllers for cancellation */
  private abortControllers = new Set<AbortController>();

  constructor(options?: { maxConcurrent?: number }) {
    this.semaphore = new Semaphore(options?.maxConcurrent ?? 8);
  }

  /**
   * Set render callbacks (provided by hybrid-pdf-provider)
   */
  setRenderCallbacks(callbacks: {
    renderTile: (tile: TileCoordinate, docId: string) => Promise<Blob>;
    renderPage: (page: number, scale: number, docId: string) => Promise<Blob>;
  }): void {
    this.renderTileCallback = callbacks.renderTile;
    this.renderPageCallback = callbacks.renderPage;
  }

  /**
   * Set current document
   */
  setDocument(docId: string): void {
    this.documentId = docId;
    getTileCacheManager().setDocument(docId);
  }

  /**
   * Get current mode
   */
  getMode(): RenderMode {
    return this.currentMode;
  }

  /**
   * Set render mode
   *
   * Handles mode transitions:
   * - Triggers cache transition (L1 evicted, L2/L3 preserved)
   */
  setMode(mode: RenderMode): void {
    if (mode === this.currentMode) return;

    const prevMode = this.currentMode;
    const transitionStart = performance.now();

    // Update mode
    this.currentMode = mode;

    // Trigger cache transition (user decision: only evict L1)
    getTileCacheManager().onModeTransition();

    // Track transition for telemetry
    const duration = performance.now() - transitionStart;
    getTelemetry().trackModeTransition(prevMode, mode, duration);
  }

  /**
   * Get the current strategy based on mode
   */
  getCurrentStrategy() {
    switch (this.currentMode) {
      case 'paginated':
        return getPaginatedStrategy();
      case 'scroll':
        return getScrollStrategy();
      case 'grid':
        return getGridStrategy();
    }
  }

  /**
   * Request a render
   *
   * Deduplicates requests and manages concurrency.
   * Returns immediately if result is in cache.
   */
  async requestRender(request: RenderRequest): Promise<RenderResult> {
    const key = this.getRequestKey(request);

    // Check cache first
    if (request.type === 'tile') {
      const cached = await getTileCacheManager().get(request.tile);
      if (cached) {
        return { success: true, data: cached, fromCache: true };
      }
    }

    // Check if already in flight (deduplication)
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    // Track abort controller
    if (request.abortController) {
      this.abortControllers.add(request.abortController);
    }

    // Create promise and add to in-flight
    const promise = this.executeRequest(request, key);
    this.inFlight.set(key, promise);

    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
      if (request.abortController) {
        this.abortControllers.delete(request.abortController);
      }
    }
  }

  /**
   * Request multiple renders
   */
  async requestBatch(requests: RenderRequest[]): Promise<RenderResult[]> {
    return Promise.all(requests.map((req) => this.requestRender(req)));
  }

  /**
   * Cancel all pending requests
   */
  cancelAll(): void {
    for (const controller of this.abortControllers) {
      controller.abort();
    }
    this.abortControllers.clear();
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    inFlightCount: number;
    activeRenders: number;
    waitingCount: number;
    mode: RenderMode;
  } {
    return {
      inFlightCount: this.inFlight.size,
      activeRenders: this.activeRenders,
      waitingCount: this.semaphore.waiting,
      mode: this.currentMode,
    };
  }

  /**
   * Get prefetch tiles based on current strategy
   *
   * Delegates to mode-specific strategy for intelligent prefetching:
   * - Paginated: prefetch ±1 pages
   * - Scroll: velocity-based prediction
   * - Grid: ripple from center
   */
  getPrefetchTiles(
    viewport: { x: number; y: number; width: number; height: number },
    pageLayouts: Array<{ page: number; x: number; y: number; width: number; height: number }>,
    velocity: { x: number; y: number },
    zoom: number
  ): TileCoordinate[] {
    const strategy = this.getCurrentStrategy();

    if (this.currentMode === 'scroll') {
      const scrollStrategy = strategy as ReturnType<typeof getScrollStrategy>;
      return scrollStrategy.getPrefetchTiles(viewport, velocity, pageLayouts, zoom);
    }

    // For paginated/grid, get visible tiles only (prefetch handled at page level)
    return [];
  }

  /**
   * Get prefetch tiles with priority information.
   *
   * Returns tiles sorted by priority (0 = critical, 3 = background).
   * Uses velocity-based adaptive lookahead in scroll mode.
   *
   * Priority zones (in viewport units):
   * - Critical (0-0.5): Priority 0 - must render immediately
   * - High (0.5-1.5): Priority 1 - prefetch soon
   * - Medium (1.5-2.5): Priority 2 - opportunistic
   * - Low (2.5-lookahead): Priority 3 - background
   */
  getPrefetchTilesWithPriority(
    viewport: { x: number; y: number; width: number; height: number },
    pageLayouts: Array<{ page: number; x: number; y: number; width: number; height: number }>,
    velocity: { x: number; y: number },
    zoom: number,
    pixelRatio: number = 1
  ): PrioritizedTile[] {
    if (this.currentMode !== 'scroll') {
      // Only scroll mode supports prioritized prefetching
      return [];
    }

    const scrollStrategy = this.getCurrentStrategy() as ReturnType<typeof getScrollStrategy>;
    return scrollStrategy.getPrefetchTilesWithPriority(
      viewport,
      velocity,
      pageLayouts,
      zoom,
      pixelRatio
    );
  }

  /**
   * Get the current speed zone based on velocity.
   * Used for adaptive quality/prefetch decisions.
   */
  getSpeedZone(velocity: { x: number; y: number }): SpeedZone {
    if (this.currentMode !== 'scroll') {
      return 'stationary';
    }

    const scrollStrategy = this.getCurrentStrategy() as ReturnType<typeof getScrollStrategy>;
    return scrollStrategy.getSpeedZone(velocity);
  }

  /**
   * Get pages to prefetch based on current strategy
   */
  getPrefetchPages(currentPage: number, pageCount: number): number[] {
    const strategy = this.getCurrentStrategy();

    if (this.currentMode === 'paginated') {
      const paginatedStrategy = strategy as ReturnType<typeof getPaginatedStrategy>;
      return paginatedStrategy.getPrefetchList(currentPage, pageCount).map(r => r.page);
    }

    // For scroll/grid, page prefetching is viewport-based, not page-number based
    return [];
  }

  /**
   * Determine if tiling should be used based on current mode and zoom.
   *
   * At HIGH zoom, tiling is MORE efficient because:
   * 1. Only a small portion of the page is visible = few tiles needed
   * 2. Full-page rendering at high scale creates massive images (e.g., 9600×12800)
   * 3. Tiles can be rendered at exactly the scale needed for the viewport
   */
  shouldUseTiling(zoom: number): boolean {
    const strategy = this.getCurrentStrategy();

    if (this.currentMode === 'paginated') {
      const paginatedStrategy = strategy as ReturnType<typeof getPaginatedStrategy>;
      // At high zoom (>4x), ALWAYS use tiling - full pages would be too large
      if (zoom > 4.0) return true;
      return paginatedStrategy.shouldUseTiling(zoom);
    }

    if (this.currentMode === 'scroll') {
      // Scroll mode uses tiling at any significant zoom
      return zoom > 1.5;
    }

    // Grid mode uses thumbnails (no tiling)
    return false;
  }

  /**
   * Get tile scale based on zoom level and optional pixel ratio.
   * For crisp rendering: scale = zoom * pixelRatio
   *
   * @param zoom Current zoom level
   * @param pixelRatio Device pixel ratio (default: 1)
   * @param velocity Optional scroll velocity for quality reduction during fast scroll
   */
  getTileScale(zoom: number, pixelRatio: number = 1, velocity?: { x: number; y: number }): number {
    // Base scale for crisp rendering at current zoom
    let scale = Math.max(1, Math.ceil(zoom * pixelRatio));

    // Optional: reduce quality during fast scroll
    if (velocity && this.currentMode === 'scroll') {
      const scrollStrategy = this.getCurrentStrategy() as ReturnType<typeof getScrollStrategy>;
      const qualityFactor = scrollStrategy.getQualityFactorForVelocity(velocity);
      scale = Math.max(1, Math.ceil(scale * qualityFactor));
    }

    return scale;
  }

  // Private helpers

  /**
   * Execute a render request with concurrency limiting
   */
  private async executeRequest(
    request: RenderRequest,
    key: string
  ): Promise<RenderResult> {
    // Check if aborted before acquiring permit
    if (request.abortController?.signal.aborted) {
      return { success: false, error: 'Aborted', fromCache: false };
    }

    // Wait for a permit (non-blocking, event-driven)
    await this.semaphore.acquire();
    this.activeRenders++;

    const startTime = performance.now();

    try {
      // Check if aborted after acquiring permit
      if (request.abortController?.signal.aborted) {
        return { success: false, error: 'Aborted', fromCache: false };
      }

      let blob: Blob | null = null;

      if (request.type === 'tile') {
        if (!this.renderTileCallback || !this.documentId) {
          return {
            success: false,
            error: 'No render callback configured',
            fromCache: false,
          };
        }

        blob = await this.renderTileCallback(request.tile, this.documentId);

        // Cache the result
        if (blob) {
          const tier = request.priority === 'critical' ? 'L1' : 'L2';
          await getTileCacheManager().set(request.tile, blob, tier);
        }
      } else {
        if (!this.renderPageCallback || !this.documentId) {
          return {
            success: false,
            error: 'No render callback configured',
            fromCache: false,
          };
        }

        blob = await this.renderPageCallback(
          request.page,
          request.scale,
          this.documentId
        );
      }

      // Track render time
      const duration = performance.now() - startTime;
      getTelemetry().trackRenderTime(
        duration,
        request.type === 'tile' ? 'tile' : 'page'
      );

      if (blob) {
        return { success: true, data: blob, fromCache: false };
      } else {
        return { success: false, error: 'Render failed', fromCache: false };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, fromCache: false };
    } finally {
      this.activeRenders--;
      this.semaphore.release();
    }
  }

  /**
   * Get unique key for a render request
   */
  private getRequestKey(request: RenderRequest): string {
    if (request.type === 'tile') {
      const t = request.tile;
      return `tile-p${t.page}-t${t.tileX}x${t.tileY}-s${t.scale}`;
    } else {
      return `page-${request.page}-s${request.scale.toFixed(2)}`;
    }
  }
}

// Singleton instance
let coordinatorInstance: RenderCoordinator | null = null;

/**
 * Get the shared render coordinator instance
 */
export function getRenderCoordinator(): RenderCoordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = new RenderCoordinator();
  }
  return coordinatorInstance;
}

/**
 * Reset the coordinator (for testing)
 */
export function resetRenderCoordinator(): void {
  if (coordinatorInstance) {
    coordinatorInstance.cancelAll();
  }
  coordinatorInstance = null;
}
