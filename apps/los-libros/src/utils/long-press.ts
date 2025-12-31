/**
 * Long Press Detector
 *
 * Detects long press gestures on both touch devices (iPadOS, mobile)
 * and desktop (Apple Trackpad, mouse).
 *
 * Features:
 * - Configurable press duration
 * - Movement tolerance (cancels if user moves too far)
 * - Works with both touch and mouse events
 * - Cleanup method to prevent memory leaks
 */

import { HapticFeedback } from './haptics';

export interface LongPressOptions {
  /** Duration in milliseconds before triggering (default: 500) */
  duration?: number;
  /** Pixel tolerance for movement (default: 10) */
  tolerance?: number;
  /** Whether to trigger haptic feedback (default: true) */
  hapticFeedback?: boolean;
  /** Prevent default on touchstart (default: false) */
  preventDefault?: boolean;
}

export interface LongPressEvent {
  /** Original event */
  originalEvent: TouchEvent | MouseEvent;
  /** X coordinate of press */
  clientX: number;
  /** Y coordinate of press */
  clientY: number;
  /** Target element */
  target: EventTarget | null;
  /** Duration of press in ms (when triggered) */
  duration: number;
}

export type LongPressCallback = (event: LongPressEvent) => void;

const DEFAULT_OPTIONS: Required<LongPressOptions> = {
  duration: 500,
  tolerance: 10,
  hapticFeedback: true,
  preventDefault: false,
};

export class LongPressDetector {
  private element: HTMLElement;
  private callback: LongPressCallback;
  private options: Required<LongPressOptions>;

  private timeoutId: number | null = null;
  private startTime: number = 0;
  private startX: number = 0;
  private startY: number = 0;
  private isActive: boolean = false;
  private destroyed: boolean = false;

  // Bound event handlers for cleanup
  private boundHandleStart: (e: TouchEvent | MouseEvent) => void;
  private boundHandleMove: (e: TouchEvent | MouseEvent) => void;
  private boundHandleEnd: (e: TouchEvent | MouseEvent) => void;
  private boundHandleCancel: () => void;

  constructor(
    element: HTMLElement,
    callback: LongPressCallback,
    options: LongPressOptions = {}
  ) {
    this.element = element;
    this.callback = callback;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Bind handlers
    this.boundHandleStart = this.handleStart.bind(this);
    this.boundHandleMove = this.handleMove.bind(this);
    this.boundHandleEnd = this.handleEnd.bind(this);
    this.boundHandleCancel = this.cancel.bind(this);

    this.bindEvents();
  }

  private bindEvents(): void {
    // Touch events (iPadOS, mobile)
    this.element.addEventListener('touchstart', this.boundHandleStart, {
      passive: !this.options.preventDefault,
    });
    this.element.addEventListener('touchend', this.boundHandleEnd);
    this.element.addEventListener('touchmove', this.boundHandleMove, {
      passive: true,
    });
    this.element.addEventListener('touchcancel', this.boundHandleCancel);

    // Mouse events (desktop, Apple Trackpad)
    this.element.addEventListener('mousedown', this.boundHandleStart);
    this.element.addEventListener('mouseup', this.boundHandleEnd);
    this.element.addEventListener('mousemove', this.boundHandleMove);
    this.element.addEventListener('mouseleave', this.boundHandleCancel);

    // Context menu prevention during long press
    this.element.addEventListener('contextmenu', this.handleContextMenu);
  }

  private unbindEvents(): void {
    this.element.removeEventListener('touchstart', this.boundHandleStart);
    this.element.removeEventListener('touchend', this.boundHandleEnd);
    this.element.removeEventListener('touchmove', this.boundHandleMove);
    this.element.removeEventListener('touchcancel', this.boundHandleCancel);

    this.element.removeEventListener('mousedown', this.boundHandleStart);
    this.element.removeEventListener('mouseup', this.boundHandleEnd);
    this.element.removeEventListener('mousemove', this.boundHandleMove);
    this.element.removeEventListener('mouseleave', this.boundHandleCancel);

    this.element.removeEventListener('contextmenu', this.handleContextMenu);
  }

  private handleContextMenu = (e: Event): void => {
    // Prevent context menu during active long press
    if (this.isActive) {
      e.preventDefault();
    }
  };

  private handleStart(e: TouchEvent | MouseEvent): void {
    if (this.destroyed) return;

    // Ignore right-click
    if ('button' in e && e.button !== 0) return;

    // Prevent default if requested (e.g., to prevent text selection)
    if (this.options.preventDefault && e.cancelable) {
      e.preventDefault();
    }

    const point = this.getPoint(e);
    this.startX = point.x;
    this.startY = point.y;
    this.startTime = Date.now();
    this.isActive = true;

    this.timeoutId = window.setTimeout(() => {
      if (!this.isActive) return;

      // Trigger haptic feedback
      if (this.options.hapticFeedback) {
        HapticFeedback.medium();
      }

      // Create event object
      const event: LongPressEvent = {
        originalEvent: e,
        clientX: this.startX,
        clientY: this.startY,
        target: e.target,
        duration: this.options.duration,
      };

      // Call the callback
      this.callback(event);

      // Reset state
      this.cancel();
    }, this.options.duration);
  }

  private handleMove(e: TouchEvent | MouseEvent): void {
    if (!this.isActive || this.timeoutId === null) return;

    const point = this.getPoint(e);
    const deltaX = Math.abs(point.x - this.startX);
    const deltaY = Math.abs(point.y - this.startY);

    // Cancel if moved beyond tolerance
    if (deltaX > this.options.tolerance || deltaY > this.options.tolerance) {
      this.cancel();
    }
  }

  private handleEnd(_e: TouchEvent | MouseEvent): void {
    this.cancel();
  }

  private getPoint(e: TouchEvent | MouseEvent): { x: number; y: number } {
    if ('touches' in e && e.touches.length > 0) {
      return {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    }

    if ('changedTouches' in e && e.changedTouches.length > 0) {
      return {
        x: e.changedTouches[0].clientX,
        y: e.changedTouches[0].clientY,
      };
    }

    return {
      x: (e as MouseEvent).clientX,
      y: (e as MouseEvent).clientY,
    };
  }

  /**
   * Cancel current long press detection
   */
  cancel(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.isActive = false;
  }

  /**
   * Update options dynamically
   */
  setOptions(options: Partial<LongPressOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Check if a long press is currently active
   */
  isPressed(): boolean {
    return this.isActive;
  }

  /**
   * Get elapsed time since press started (0 if not active)
   */
  getElapsedTime(): number {
    if (!this.isActive) return 0;
    return Date.now() - this.startTime;
  }

  /**
   * Destroy the detector and clean up event listeners
   */
  destroy(): void {
    if (this.destroyed) return;

    this.cancel();
    this.unbindEvents();
    this.destroyed = true;
  }
}

/**
 * Factory function for creating long press detectors
 */
export function createLongPressDetector(
  element: HTMLElement,
  callback: LongPressCallback,
  options?: LongPressOptions
): LongPressDetector {
  return new LongPressDetector(element, callback, options);
}

export default LongPressDetector;
