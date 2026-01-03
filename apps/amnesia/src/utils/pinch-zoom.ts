/**
 * Pinch-to-Zoom Detector
 *
 * Detects pinch gestures on touch devices and provides
 * callbacks for zoom in/out actions. Used for font size adjustment.
 */

export interface PinchZoomConfig {
  /** Minimum scale change to trigger (default: 0.1) */
  threshold?: number;
  /** Debounce time in ms (default: 100) */
  debounce?: number;
}

export interface PinchZoomCallbacks {
  onZoomIn?: (scale: number) => void;
  onZoomOut?: (scale: number) => void;
  onZoomChange?: (scale: number, direction: 'in' | 'out') => void;
}

interface TouchInfo {
  initialDistance: number;
  lastScale: number;
}

export class PinchZoomDetector {
  private element: HTMLElement;
  private config: Required<PinchZoomConfig>;
  private callbacks: PinchZoomCallbacks;
  private touchInfo: TouchInfo | null = null;
  private isEnabled = true;
  private debounceTimer: number | null = null;
  private lastTriggerTime = 0;

  constructor(
    element: HTMLElement,
    callbacks: PinchZoomCallbacks,
    config: PinchZoomConfig = {}
  ) {
    this.element = element;
    this.callbacks = callbacks;
    this.config = {
      threshold: config.threshold ?? 0.1,
      debounce: config.debounce ?? 100,
    };

    this.bindEvents();
  }

  private bindEvents(): void {
    this.element.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    this.element.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    this.element.addEventListener('touchend', this.handleTouchEnd, { passive: true });
    this.element.addEventListener('touchcancel', this.handleTouchEnd, { passive: true });

    // Also support wheel zoom with Ctrl (desktop)
    this.element.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  private handleTouchStart = (e: TouchEvent): void => {
    if (!this.isEnabled) return;

    // Need exactly 2 touches for pinch
    if (e.touches.length === 2) {
      e.preventDefault();
      const distance = this.getDistance(e.touches[0], e.touches[1]);
      this.touchInfo = {
        initialDistance: distance,
        lastScale: 1,
      };
    }
  };

  private handleTouchMove = (e: TouchEvent): void => {
    if (!this.isEnabled || !this.touchInfo || e.touches.length !== 2) return;

    e.preventDefault();

    const currentDistance = this.getDistance(e.touches[0], e.touches[1]);
    const scale = currentDistance / this.touchInfo.initialDistance;
    const scaleDiff = scale - this.touchInfo.lastScale;

    // Check if we've exceeded the threshold
    if (Math.abs(scaleDiff) >= this.config.threshold) {
      const now = Date.now();

      // Debounce rapid changes
      if (now - this.lastTriggerTime >= this.config.debounce) {
        this.lastTriggerTime = now;
        this.touchInfo.lastScale = scale;

        if (scaleDiff > 0) {
          this.callbacks.onZoomIn?.(scale);
          this.callbacks.onZoomChange?.(scale, 'in');
        } else {
          this.callbacks.onZoomOut?.(scale);
          this.callbacks.onZoomChange?.(scale, 'out');
        }
      }
    }
  };

  private handleTouchEnd = (): void => {
    this.touchInfo = null;
  };

  private handleWheel = (e: WheelEvent): void => {
    if (!this.isEnabled) return;

    // Only handle Ctrl+wheel for zoom
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();

      const now = Date.now();
      if (now - this.lastTriggerTime < this.config.debounce) return;
      this.lastTriggerTime = now;

      if (e.deltaY < 0) {
        // Scroll up = zoom in
        this.callbacks.onZoomIn?.(1.1);
        this.callbacks.onZoomChange?.(1.1, 'in');
      } else {
        // Scroll down = zoom out
        this.callbacks.onZoomOut?.(0.9);
        this.callbacks.onZoomChange?.(0.9, 'out');
      }
    }
  };

  private getDistance(touch1: Touch, touch2: Touch): number {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Enable pinch detection
   */
  enable(): void {
    this.isEnabled = true;
  }

  /**
   * Disable pinch detection
   */
  disable(): void {
    this.isEnabled = false;
    this.touchInfo = null;
  }

  /**
   * Update callbacks
   */
  setCallbacks(callbacks: Partial<PinchZoomCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Cleanup event listeners
   */
  destroy(): void {
    this.element.removeEventListener('touchstart', this.handleTouchStart);
    this.element.removeEventListener('touchmove', this.handleTouchMove);
    this.element.removeEventListener('touchend', this.handleTouchEnd);
    this.element.removeEventListener('touchcancel', this.handleTouchEnd);
    this.element.removeEventListener('wheel', this.handleWheel);
    this.touchInfo = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }
}

/**
 * Create a pinch-to-zoom detector
 */
export function createPinchZoomDetector(
  element: HTMLElement,
  callbacks: PinchZoomCallbacks,
  config?: PinchZoomConfig
): PinchZoomDetector {
  return new PinchZoomDetector(element, callbacks, config);
}
