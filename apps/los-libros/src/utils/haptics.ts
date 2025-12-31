/**
 * Haptic Feedback Utility
 *
 * Cross-platform haptic feedback for reader interactions.
 * Uses Web Vibration API on supported devices (primarily mobile/tablet).
 * Fails silently on unsupported platforms (desktop).
 */

export type HapticPattern = 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'selection' | 'warning';

export interface HapticOptions {
  /** Whether haptics are enabled globally */
  enabled: boolean;
  /** Intensity multiplier (0.5-2.0) */
  intensity: number;
}

const DEFAULT_OPTIONS: HapticOptions = {
  enabled: true,
  intensity: 1.0,
};

/**
 * Haptic feedback patterns (in milliseconds)
 * Format: single number for vibration, or array [vibrate, pause, vibrate, ...]
 */
const PATTERNS: Record<HapticPattern, number | number[]> = {
  light: 10,
  medium: 25,
  heavy: 50,
  success: [20, 30, 20],
  error: [50, 30, 50, 30, 50],
  selection: 15,
  warning: [30, 20, 30],
};

export class HapticFeedback {
  private static options: HapticOptions = { ...DEFAULT_OPTIONS };

  /** Check if Vibration API is supported */
  private static get isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'vibrate' in navigator;
  }

  /**
   * Configure haptic feedback options
   */
  static configure(options: Partial<HapticOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Enable or disable haptics globally
   */
  static setEnabled(enabled: boolean): void {
    this.options.enabled = enabled;
  }

  /**
   * Set intensity multiplier (0.5 = half, 2.0 = double)
   */
  static setIntensity(intensity: number): void {
    this.options.intensity = Math.max(0.5, Math.min(2.0, intensity));
  }

  /**
   * Trigger a haptic pattern
   */
  private static trigger(pattern: number | number[]): void {
    if (!this.isSupported || !this.options.enabled) {
      return;
    }

    try {
      const scaled = this.scalePattern(pattern);
      navigator.vibrate(scaled);
    } catch (e) {
      // Silently fail - vibration may be blocked by user settings
      console.debug('Haptic feedback unavailable:', e);
    }
  }

  /**
   * Scale pattern by intensity
   */
  private static scalePattern(pattern: number | number[]): number | number[] {
    const { intensity } = this.options;

    if (typeof pattern === 'number') {
      return Math.round(pattern * intensity);
    }

    return pattern.map(p => Math.round(p * intensity));
  }

  /**
   * Light tap - UI button presses, selections
   */
  static light(): void {
    this.trigger(PATTERNS.light);
  }

  /**
   * Medium impact - highlight creation, important actions
   */
  static medium(): void {
    this.trigger(PATTERNS.medium);
  }

  /**
   * Heavy impact - deletion, significant changes
   */
  static heavy(): void {
    this.trigger(PATTERNS.heavy);
  }

  /**
   * Success pattern - action completed successfully
   */
  static success(): void {
    this.trigger(PATTERNS.success);
  }

  /**
   * Error pattern - action failed
   */
  static error(): void {
    this.trigger(PATTERNS.error);
  }

  /**
   * Selection feedback - text selection started
   */
  static selection(): void {
    this.trigger(PATTERNS.selection);
  }

  /**
   * Warning pattern - caution/confirmation needed
   */
  static warning(): void {
    this.trigger(PATTERNS.warning);
  }

  /**
   * Custom pattern
   */
  static custom(pattern: number | number[]): void {
    this.trigger(pattern);
  }

  /**
   * Stop any ongoing vibration
   */
  static stop(): void {
    if (this.isSupported) {
      navigator.vibrate(0);
    }
  }

  /**
   * Check if haptics are available on this device
   */
  static isAvailable(): boolean {
    return this.isSupported;
  }
}

export default HapticFeedback;
