/**
 * Swipe Gesture Detector
 *
 * Detects horizontal and vertical swipe gestures on touch devices
 * with configurable thresholds and callbacks.
 */

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

export interface SwipeConfig {
  /** Minimum distance in pixels to trigger a swipe (default: 50) */
  threshold?: number;
  /** Maximum time in ms for a swipe gesture (default: 300) */
  maxTime?: number;
  /** Minimum velocity for a swipe in px/ms (default: 0.3) */
  minVelocity?: number;
  /** Allow diagonal swipes (default: false) */
  allowDiagonal?: boolean;
}

export interface SwipeCallbacks {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  onSwipe?: (direction: SwipeDirection) => void;
}

interface TouchInfo {
  startX: number;
  startY: number;
  startTime: number;
}

export class SwipeDetector {
  private element: HTMLElement;
  private config: Required<SwipeConfig>;
  private callbacks: SwipeCallbacks;
  private touchInfo: TouchInfo | null = null;
  private isEnabled = true;

  constructor(
    element: HTMLElement,
    callbacks: SwipeCallbacks,
    config: SwipeConfig = {}
  ) {
    this.element = element;
    this.callbacks = callbacks;
    this.config = {
      threshold: config.threshold ?? 50,
      maxTime: config.maxTime ?? 300,
      minVelocity: config.minVelocity ?? 0.3,
      allowDiagonal: config.allowDiagonal ?? false,
    };

    this.bindEvents();
  }

  private bindEvents(): void {
    this.element.addEventListener('touchstart', this.handleTouchStart, { passive: true });
    this.element.addEventListener('touchend', this.handleTouchEnd, { passive: true });
    this.element.addEventListener('touchcancel', this.handleTouchCancel, { passive: true });
  }

  private handleTouchStart = (e: TouchEvent): void => {
    if (!this.isEnabled || !e.touches[0]) return;

    this.touchInfo = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      startTime: Date.now(),
    };
  };

  private handleTouchEnd = (e: TouchEvent): void => {
    if (!this.isEnabled || !this.touchInfo || !e.changedTouches[0]) {
      this.touchInfo = null;
      return;
    }

    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const endTime = Date.now();

    const deltaX = endX - this.touchInfo.startX;
    const deltaY = endY - this.touchInfo.startY;
    const deltaTime = endTime - this.touchInfo.startTime;

    // Check time constraint
    if (deltaTime > this.config.maxTime) {
      this.touchInfo = null;
      return;
    }

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Check threshold
    const threshold = this.config.threshold;
    if (absX < threshold && absY < threshold) {
      this.touchInfo = null;
      return;
    }

    // Check velocity
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const velocity = distance / deltaTime;
    if (velocity < this.config.minVelocity) {
      this.touchInfo = null;
      return;
    }

    // Determine direction
    let direction: SwipeDirection | null = null;

    if (this.config.allowDiagonal) {
      // Allow diagonal: just use the larger axis
      if (absX > absY) {
        direction = deltaX > 0 ? 'right' : 'left';
      } else {
        direction = deltaY > 0 ? 'down' : 'up';
      }
    } else {
      // Strict horizontal/vertical: require dominant axis
      const ratio = absX / absY;
      if (ratio > 1.5 && absX >= threshold) {
        // Horizontal swipe
        direction = deltaX > 0 ? 'right' : 'left';
      } else if (ratio < 0.67 && absY >= threshold) {
        // Vertical swipe
        direction = deltaY > 0 ? 'down' : 'up';
      }
    }

    if (direction) {
      this.triggerSwipe(direction);
    }

    this.touchInfo = null;
  };

  private handleTouchCancel = (): void => {
    this.touchInfo = null;
  };

  private triggerSwipe(direction: SwipeDirection): void {
    // Call specific callback
    switch (direction) {
      case 'left':
        this.callbacks.onSwipeLeft?.();
        break;
      case 'right':
        this.callbacks.onSwipeRight?.();
        break;
      case 'up':
        this.callbacks.onSwipeUp?.();
        break;
      case 'down':
        this.callbacks.onSwipeDown?.();
        break;
    }

    // Call general callback
    this.callbacks.onSwipe?.(direction);
  }

  /**
   * Enable swipe detection
   */
  enable(): void {
    this.isEnabled = true;
  }

  /**
   * Disable swipe detection
   */
  disable(): void {
    this.isEnabled = false;
    this.touchInfo = null;
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<SwipeConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Update callbacks
   */
  setCallbacks(callbacks: Partial<SwipeCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Cleanup event listeners
   */
  destroy(): void {
    this.element.removeEventListener('touchstart', this.handleTouchStart);
    this.element.removeEventListener('touchend', this.handleTouchEnd);
    this.element.removeEventListener('touchcancel', this.handleTouchCancel);
    this.touchInfo = null;
  }
}

/**
 * Create a swipe detector with default configuration
 */
export function createSwipeDetector(
  element: HTMLElement,
  callbacks: SwipeCallbacks,
  config?: SwipeConfig
): SwipeDetector {
  return new SwipeDetector(element, callbacks, config);
}
