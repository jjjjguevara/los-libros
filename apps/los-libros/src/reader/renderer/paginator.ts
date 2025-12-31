/**
 * Paginator
 *
 * Handles CSS multi-column pagination for paginated reading mode.
 * Uses CSS columns for layout and scroll snapping for page turns.
 */

import type { RendererConfig, ColumnLayout } from './types';

export interface PageInfo {
  current: number;
  total: number;
}

export type PageChangeCallback = (page: PageInfo) => void;

/**
 * CSS Multi-column Paginator with live gesture support
 */
export type StyleUpdateCallback = () => void;

export class Paginator {
  private iframe: HTMLIFrameElement;
  private config: RendererConfig;
  private onPageChange: PageChangeCallback;
  private onStyleUpdate?: StyleUpdateCallback;

  // Pagination state
  private currentPage = 0;
  private totalPages = 1;
  private columnWidth = 0;
  private containerWidth = 0;
  private initialized = false;

  // Gesture state for live drag
  private gestureOffset = 0;           // Accumulated drag offset
  private gestureActive = false;        // Whether a gesture is in progress
  private gestureEndTimeout: number | null = null;  // Timer for gesture end detection
  private baseTransform = 0;            // Transform at start of gesture

  // Velocity tracking for momentum
  private velocityHistory: Array<{ delta: number; time: number }> = [];
  private momentumAnimationId: number | null = null;
  private currentTransform = 0;         // Current transform position during momentum

  // Performance tracking
  private lastFrameTime = 0;
  private frameCount = 0;
  private frameTimes: number[] = [];

  // First page handling (for cover display)
  private isFirstPage = true;

  // Cached values to avoid reflow during gestures
  private cachedScrollWidth = 0;
  private cachedMaxOffset = 0;

  // Throttling for DOM updates
  private lastDomUpdate = 0;
  private pendingTransform = 0;
  private rafId: number | null = null;

  constructor(
    iframe: HTMLIFrameElement,
    config: RendererConfig,
    onPageChange: PageChangeCallback,
    onStyleUpdate?: StyleUpdateCallback
  ) {
    this.iframe = iframe;
    this.config = config;
    this.onPageChange = onPageChange;
    this.onStyleUpdate = onStyleUpdate;
  }

  /**
   * Set style update callback (called when column layout changes)
   */
  setStyleUpdateCallback(callback: StyleUpdateCallback): void {
    this.onStyleUpdate = callback;
  }

  /**
   * Initialize pagination after content is loaded
   * @param initialPosition - 'start', 'end', or a specific page number
   */
  async initialize(initialPosition: 'start' | 'end' | number = 'start'): Promise<void> {
    const doc = this.iframe.contentDocument;
    if (!doc) return;

    const container = doc.getElementById('content-container');

    // CRITICAL: Reset transform BEFORE calculating dimensions
    // This ensures fresh state and accurate measurements when switching chapters
    // Without this, the old chapter's transform persists and causes content to disappear
    if (container) {
      container.style.transition = 'none';
      container.style.transform = 'translate3d(0, 0, 0)';
    }

    // Wait for content to render
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Calculate dimensions (this determines totalPages)
    this.calculateDimensions();

    // Set initial page based on position parameter
    // This allows us to go directly to the target page without showing page 0 first
    if (initialPosition === 'end') {
      this.currentPage = Math.max(0, this.totalPages - 1);
      this.isFirstPage = false; // Not on first page
    } else if (typeof initialPosition === 'number') {
      this.currentPage = Math.max(0, Math.min(initialPosition, this.totalPages - 1));
      this.isFirstPage = (this.currentPage === 0);
    } else {
      this.currentPage = 0;
      this.isFirstPage = true;
    }

    this.initialized = true;

    // Set transform directly to target position without animation
    // This prevents the jarring "reset from left to right" effect when navigating backwards
    this.scrollToCurrentPage(false);

    this.notifyPageChange();
  }

  /**
   * Calculate pagination dimensions
   */
  private calculateDimensions(): void {
    const doc = this.iframe.contentDocument;
    if (!doc) return;

    const container = doc.getElementById('content-container');
    if (!container) return;

    // Get viewport dimensions from iframe (what's visible)
    const iframeRect = this.iframe.getBoundingClientRect();
    const viewportWidth = iframeRect.width - (this.config.margin * 2);
    const viewportHeight = iframeRect.height - (this.config.margin * 2);

    this.containerWidth = viewportWidth;

    // Calculate column width based on settings
    const columns = this.getColumnCount();
    const totalGaps = (columns - 1) * this.config.columnGap;
    this.columnWidth = Math.floor((viewportWidth - totalGaps) / columns);

    // Clear transform to get accurate content measurement
    // NOTE: We intentionally do NOT restore the old transform here.
    // The caller (initialize or handleResize) is responsible for setting the correct transform
    // via scrollToCurrentPage(). Restoring old transforms caused state desync bugs.
    container.style.transition = 'none';
    container.style.transform = 'none';

    // Force reflow to get accurate measurements
    void container.offsetWidth;

    // Measure the actual content width using scrollWidth
    // Note: We removed 'width: max-content' from CSS because it gave incorrect values.
    // Now scrollWidth correctly reflects the column-wrapped content width.
    const actualContentWidth = container.scrollWidth;

    // Each "page" is viewport width (columns visible at once) + gap to next page
    const pageWidth = viewportWidth + this.config.columnGap;

    // Calculate total pages based on actual content width
    if (actualContentWidth <= viewportWidth) {
      this.totalPages = 1;
    } else {
      this.totalPages = Math.max(1, Math.ceil(actualContentWidth / pageWidth));
    }
  }

  /**
   * Get number of columns based on config
   * Forces single column on first page in 'auto' mode for cover display
   */
  private getColumnCount(): number {
    if (this.config.columns === 'single') return 1;
    if (this.config.columns === 'dual') return 2;

    // Auto mode: force single column on first page for cover display
    if (this.isFirstPage) return 1;

    // Auto: use 2 columns if wide enough
    return this.containerWidth > 800 ? 2 : 1;
  }

  /**
   * Get column count for external style application
   * Called by renderer.applyRendererStyles() to ensure CSS matches paginator logic
   */
  getColumnCountForStyles(): number {
    return this.getColumnCount();
  }

  /**
   * Go to next page
   * @returns true if there was a next page, false if at end
   */
  nextPage(): boolean {
    if (!this.initialized) {
      return false;
    }
    if (this.currentPage < this.totalPages - 1) {
      // Transition from first page to normal layout if in auto mode
      if (this.isFirstPage && this.config.columns === 'auto') {
        this.isFirstPage = false;
        // Notify renderer to update CSS column styles
        this.onStyleUpdate?.();
        // Recalculate dimensions for dual column layout
        this.calculateDimensions();
      }
      this.currentPage++;
      this.scrollToCurrentPage();
      return true;
    }
    return false;
  }

  /**
   * Go to previous page
   * @returns true if there was a previous page, false if at start
   */
  prevPage(): boolean {
    if (this.currentPage > 0) {
      this.currentPage--;
      // Restore first page mode when going back to page 0 in auto mode
      if (this.currentPage === 0 && this.config.columns === 'auto' && !this.isFirstPage) {
        this.isFirstPage = true;
        // Notify renderer to update CSS column styles
        this.onStyleUpdate?.();
        this.calculateDimensions();
      }
      this.scrollToCurrentPage();
      return true;
    }
    return false;
  }

  /**
   * Go to a specific page
   */
  goToPage(pageNumber: number): void {
    const page = Math.max(0, Math.min(pageNumber, this.totalPages - 1));
    if (page !== this.currentPage) {
      // Handle first page mode transitions in auto mode
      if (this.config.columns === 'auto') {
        const wasFirstPage = this.isFirstPage;
        this.isFirstPage = (page === 0);
        if (wasFirstPage !== this.isFirstPage) {
          // Notify renderer to update CSS column styles
          this.onStyleUpdate?.();
          this.calculateDimensions();
        }
      }
      this.currentPage = page;
      this.scrollToCurrentPage();
    }
  }

  /**
   * Go to the last page
   */
  goToLastPage(): void {
    this.goToPage(this.totalPages - 1);
  }

  /**
   * Go to the first page
   */
  goToFirstPage(): void {
    this.goToPage(0);
  }

  /**
   * Get current page info
   */
  getCurrentPage(): PageInfo {
    return {
      current: this.currentPage,
      total: this.totalPages,
    };
  }

  /**
   * Get the width of each column (page)
   */
  getColumnWidth(): number {
    return this.columnWidth;
  }

  /**
   * Get the gap between columns
   */
  getGap(): number {
    return this.config.columnGap;
  }

  /**
   * Get page progress (0-1)
   */
  getProgress(): number {
    if (this.totalPages <= 1) return 0;
    return this.currentPage / (this.totalPages - 1);
  }

  /**
   * Navigate to a percentage within the chapter
   */
  goToPercentage(percentage: number): void {
    const page = Math.floor((percentage / 100) * this.totalPages);
    this.goToPage(page);
  }

  /**
   * Scroll to an element by ID
   */
  scrollToElement(elementId: string): boolean {
    const doc = this.iframe.contentDocument;
    if (!doc) return false;

    const element = doc.getElementById(elementId);
    if (!element) return false;

    // Calculate which page the element is on
    const rect = element.getBoundingClientRect();
    const containerRect = doc.getElementById('content-container')?.getBoundingClientRect();
    if (!containerRect) return false;

    const offsetX = rect.left - containerRect.left;
    const pageWidth = this.containerWidth + this.config.columnGap;
    const page = Math.floor(offsetX / pageWidth);

    this.goToPage(page);
    return true;
  }

  /**
   * Handle resize
   */
  handleResize(): void {
    if (!this.initialized) return;

    // Cancel any active gesture or momentum animation before resize
    // This prevents stale animation frames from running with outdated values
    if (this.momentumAnimationId) {
      cancelAnimationFrame(this.momentumAnimationId);
      this.momentumAnimationId = null;
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.gestureEndTimeout) {
      clearTimeout(this.gestureEndTimeout);
      this.gestureEndTimeout = null;
    }
    this.gestureActive = false;
    this.gestureOffset = 0;
    this.velocityHistory = [];

    // Save absolute position before recalculating
    // We want to preserve the ACTUAL position, not percentage
    // because percentage changes when chapters load
    const previousPage = this.currentPage;
    const previousTransform = this.currentTransform;

    // Recalculate dimensions
    this.calculateDimensions();

    // Preserve absolute page position (clamped to new bounds)
    // Don't use percentage - that causes jumps when chapters load
    this.currentPage = Math.min(previousPage, this.totalPages - 1);

    // Restore transform if it was set (during momentum/gesture)
    if (previousTransform > 0) {
      const pageWidth = this.containerWidth + this.config.columnGap;
      const maxOffset = Math.max(0, this.cachedScrollWidth - this.containerWidth);
      this.currentTransform = Math.min(previousTransform, maxOffset);
    }

    this.scrollToCurrentPage(false); // No animation on resize
  }

  /**
   * Update configuration
   */
  updateConfig(config: RendererConfig): void {
    this.config = config;
    if (this.initialized) {
      this.handleResize();
    }
  }

  // ============================================================================
  // Gesture Handling - Live drag for smooth page turns with momentum
  // ============================================================================

  /**
   * Handle gesture input (trackpad/touch drag)
   * This provides live visual feedback as the user drags
   * @param deltaX - The change in X position (positive = drag right, negative = drag left)
   */
  handleGestureInput(deltaX: number): void {
    if (!this.initialized) return;

    const doc = this.iframe.contentDocument;
    if (!doc) return;

    const container = doc.getElementById('content-container');
    if (!container) return;

    // Cancel any ongoing momentum animation
    if (this.momentumAnimationId) {
      cancelAnimationFrame(this.momentumAnimationId);
      this.momentumAnimationId = null;
    }

    const now = performance.now();

    // Start gesture if not already active
    if (!this.gestureActive) {
      this.gestureActive = true;
      // Calculate the base transform from current page
      const pageWidth = this.containerWidth + this.config.columnGap;
      this.baseTransform = this.currentPage * pageWidth;
      this.gestureOffset = 0;
      this.velocityHistory = [];
      // Cache scrollWidth to avoid reflow on every frame - this is critical for performance!
      this.cachedScrollWidth = container.scrollWidth;
      this.cachedMaxOffset = Math.max(0, this.cachedScrollWidth - this.containerWidth);
      // Reset perf tracking
      this.lastFrameTime = now;
      this.frameCount = 0;
      this.frameTimes = [];
      this.lastDomUpdate = now;
      console.log(`[Paginator:Perf] Gesture started, scrollWidth=${this.cachedScrollWidth}, maxOffset=${this.cachedMaxOffset}`);
    }

    // Track velocity - store recent deltas with timestamps
    this.velocityHistory.push({ delta: deltaX, time: now });
    // Keep only last 100ms of history for velocity calculation
    this.velocityHistory = this.velocityHistory.filter(v => now - v.time < 100);

    // Accumulate the drag offset
    this.gestureOffset += deltaX;

    // Calculate the live transform
    let liveTransform = this.baseTransform - this.gestureOffset;

    // Clamp to content bounds with rubber-band effect at edges
    // Use cached maxOffset to avoid reflow!
    if (liveTransform < 0) {
      // Rubber-band at start - reduce the overshoot
      liveTransform = liveTransform * 0.3;
    } else if (liveTransform > this.cachedMaxOffset) {
      // Rubber-band at end - reduce the overshoot
      const overshoot = liveTransform - this.cachedMaxOffset;
      liveTransform = this.cachedMaxOffset + overshoot * 0.3;
    }

    this.currentTransform = liveTransform;
    this.pendingTransform = liveTransform;

    // Batch DOM updates using requestAnimationFrame
    // This prevents multiple DOM updates per frame when wheel events come faster than 60fps
    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        const frameStart = performance.now();

        // Track frame timing
        if (this.lastDomUpdate > 0) {
          const frameDelta = frameStart - this.lastDomUpdate;
          this.frameTimes.push(frameDelta);
          if (frameDelta > 20) {
            console.warn(`[Paginator:Perf] Slow frame: ${frameDelta.toFixed(1)}ms (${(1000/frameDelta).toFixed(0)}fps)`);
          }
        }
        this.lastDomUpdate = frameStart;
        this.frameCount++;

        // Apply the pending transform
        container.style.transition = 'none';
        container.style.transform = `translate3d(-${this.pendingTransform}px, 0, 0)`;
      });
    }

    // Reset the gesture end timer
    if (this.gestureEndTimeout) {
      clearTimeout(this.gestureEndTimeout);
    }
    this.gestureEndTimeout = window.setTimeout(() => {
      this.handleGestureEnd();
    }, 100); // End gesture if no input for 100ms
  }

  /**
   * Calculate velocity from recent gesture history
   * @returns velocity in pixels per millisecond
   */
  private calculateVelocity(): number {
    if (this.velocityHistory.length < 2) return 0;

    const recent = this.velocityHistory.slice(-5); // Use last 5 samples
    if (recent.length < 2) return 0;

    const first = recent[0];
    const last = recent[recent.length - 1];
    const timeDelta = last.time - first.time;

    if (timeDelta === 0) return 0;

    // Sum all deltas
    const totalDelta = recent.reduce((sum, v) => sum + v.delta, 0);

    // Return velocity in pixels per ms
    return totalDelta / timeDelta;
  }

  /**
   * Explicitly end the gesture and apply momentum if needed
   */
  handleGestureEnd(): void {
    if (!this.gestureActive) return;

    // Cancel any pending RAF
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Log performance summary
    if (this.frameTimes.length > 0) {
      const avgFrame = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      const maxFrame = Math.max(...this.frameTimes);
      const minFrame = Math.min(...this.frameTimes);
      const avgFps = 1000 / avgFrame;
      console.log(`[Paginator:Perf] Gesture ended - ${this.frameCount} frames, avg: ${avgFrame.toFixed(1)}ms (${avgFps.toFixed(0)}fps), min: ${minFrame.toFixed(1)}ms, max: ${maxFrame.toFixed(1)}ms`);
    }

    if (this.gestureEndTimeout) {
      clearTimeout(this.gestureEndTimeout);
      this.gestureEndTimeout = null;
    }

    const doc = this.iframe.contentDocument;
    if (!doc) return;

    const container = doc.getElementById('content-container');
    if (!container) return;

    // Calculate velocity for momentum
    const velocity = this.calculateVelocity();
    const pageWidth = this.containerWidth + this.config.columnGap;
    console.log(`[Paginator:Perf] Velocity: ${velocity.toFixed(2)}px/ms, will ${Math.abs(velocity) > 0.5 ? 'apply momentum' : 'snap to page'}`);

    // Reset gesture state
    this.gestureActive = false;
    this.gestureOffset = 0;
    this.baseTransform = 0;
    this.velocityHistory = [];

    // Check if we have significant velocity for momentum scrolling
    const velocityThreshold = 0.5; // pixels per ms
    if (Math.abs(velocity) > velocityThreshold) {
      // Apply momentum animation
      this.applyMomentum(velocity, container);
    } else {
      // No significant velocity - snap to nearest page based on current position
      this.snapToNearestPage(container);
    }
  }

  /**
   * Apply momentum animation with deceleration
   */
  private applyMomentum(initialVelocity: number, container: HTMLElement): void {
    const friction = 0.95; // Deceleration factor (lower = more friction)
    const minVelocity = 0.1; // Stop when velocity is below this
    // Use cached maxOffset to avoid reflow during animation!
    const maxOffset = this.cachedMaxOffset;

    let velocity = initialVelocity;
    let transform = this.currentTransform;
    let momentumFrameCount = 0;
    let lastMomentumFrame = performance.now();
    const momentumFrameTimes: number[] = [];

    const animate = () => {
      const frameStart = performance.now();
      const frameDelta = frameStart - lastMomentumFrame;
      momentumFrameTimes.push(frameDelta);
      lastMomentumFrame = frameStart;
      momentumFrameCount++;

      // Apply velocity to transform (velocity is in gesture direction, so subtract)
      transform -= velocity;

      // Apply friction
      velocity *= friction;

      // Bounce at edges
      if (transform < 0) {
        transform = 0;
        velocity = -velocity * 0.3; // Bounce back with reduced energy
      } else if (transform > maxOffset) {
        transform = maxOffset;
        velocity = -velocity * 0.3;
      }

      // Update transform
      container.style.transition = 'none';
      container.style.transform = `translate3d(-${transform}px, 0, 0)`;
      this.currentTransform = transform;

      // Continue animation if velocity is still significant
      if (Math.abs(velocity) > minVelocity) {
        this.momentumAnimationId = requestAnimationFrame(animate);
      } else {
        // Log momentum performance
        if (momentumFrameTimes.length > 1) {
          const avgFrame = momentumFrameTimes.slice(1).reduce((a, b) => a + b, 0) / (momentumFrameTimes.length - 1);
          console.log(`[Paginator:Perf] Momentum ended - ${momentumFrameCount} frames, avg: ${avgFrame.toFixed(1)}ms (${(1000/avgFrame).toFixed(0)}fps)`);
        }
        // Momentum exhausted - snap to nearest page
        this.momentumAnimationId = null;
        this.snapToNearestPage(container);
      }
    };

    this.momentumAnimationId = requestAnimationFrame(animate);
  }

  /**
   * Snap to the nearest page based on current transform position
   */
  private snapToNearestPage(container: HTMLElement): void {
    const pageWidth = this.containerWidth + this.config.columnGap;
    // Use cached maxOffset - it's still valid from gesture start
    const maxOffset = this.cachedMaxOffset;

    // Calculate nearest page from current transform
    let nearestPage = Math.round(this.currentTransform / pageWidth);
    nearestPage = Math.max(0, Math.min(nearestPage, this.totalPages - 1));

    // Update current page and animate to it
    this.currentPage = nearestPage;

    // Calculate target transform
    let targetTransform = nearestPage * pageWidth;
    targetTransform = Math.min(targetTransform, maxOffset);

    // Animate to target with GPU-accelerated transform
    container.style.transition = 'transform 0.3s ease-out';
    container.style.transform = `translate3d(-${targetTransform}px, 0, 0)`;

    this.notifyPageChange();
  }

  /**
   * Check if a gesture is currently active
   */
  isGestureActive(): boolean {
    return this.gestureActive;
  }

  /**
   * Cancel any active gesture or momentum without changing page
   */
  cancelGesture(): void {
    if (this.gestureEndTimeout) {
      clearTimeout(this.gestureEndTimeout);
      this.gestureEndTimeout = null;
    }
    if (this.momentumAnimationId) {
      cancelAnimationFrame(this.momentumAnimationId);
      this.momentumAnimationId = null;
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.gestureActive) {
      this.gestureActive = false;
      this.gestureOffset = 0;
      this.baseTransform = 0;
      this.velocityHistory = [];
      this.scrollToCurrentPage(true);
    }
  }

  /**
   * Reset to first page mode (for new books/chapters)
   */
  resetFirstPage(): void {
    this.isFirstPage = true;
  }

  /**
   * Destroy the paginator
   */
  destroy(): void {
    this.cancelGesture();
    this.initialized = false;
  }

  /**
   * Scroll container to current page
   */
  private scrollToCurrentPage(animate = true): void {
    const doc = this.iframe.contentDocument;
    if (!doc) return;

    const container = doc.getElementById('content-container');
    if (!container) return;

    // Use viewport width (containerWidth) + gap for page translation
    const pageWidth = this.containerWidth + this.config.columnGap;
    let scrollLeft = this.currentPage * pageWidth;

    // SAFETY: Clamp transform to content bounds to prevent content from disappearing
    // This guards against state desync where currentPage * pageWidth exceeds actual content
    const maxOffset = Math.max(0, container.scrollWidth - this.containerWidth);
    scrollLeft = Math.min(scrollLeft, maxOffset);

    // Use transform for smoother page turns
    container.style.transition = animate ? 'transform 0.3s ease-out' : 'none';
    container.style.transform = `translate3d(-${scrollLeft}px, 0, 0)`;

    this.notifyPageChange();
  }

  /**
   * Notify listener of page change
   */
  private notifyPageChange(): void {
    this.onPageChange({
      current: this.currentPage,
      total: this.totalPages,
    });
  }

  /**
   * Get the content container element (for transform sync)
   */
  getContentContainer(): HTMLElement | null {
    const doc = this.iframe.contentDocument;
    if (!doc) return null;
    return doc.getElementById('content-container');
  }
}
