/**
 * Lightbox Adapter
 *
 * Bridges the asset extraction system with lightbox UI components.
 * Provides reactive data for displaying image galleries in the reader.
 *
 * Features:
 * - Lazy image loading
 * - Preloading strategy
 * - Keyboard navigation support
 * - Touch gesture support
 * - Zoom and pan state management
 *
 * @see docs/specifications/file-system-architecture.md
 */

import type {
  LightboxImage,
  LightboxGallery,
  ResourceProvider,
} from './types';
import { ImageExtractor, type GalleryOptions, type ImageFilterOptions } from './image-extractor';

// ============================================================================
// Types
// ============================================================================

/**
 * Lightbox display state
 */
export interface LightboxState {
  /** Whether lightbox is open */
  isOpen: boolean;
  /** Current image index */
  currentIndex: number;
  /** Zoom level (1 = 100%) */
  zoomLevel: number;
  /** Pan offset from center */
  panOffset: { x: number; y: number };
  /** Whether image is loading */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
}

/**
 * Lightbox navigation direction
 */
export type NavigationDirection = 'next' | 'prev' | 'first' | 'last';

/**
 * Lightbox event types
 */
export interface LightboxEvents {
  'open': { index: number };
  'close': {};
  'navigate': { index: number; direction: NavigationDirection };
  'zoom': { level: number };
  'pan': { x: number; y: number };
  'load': { image: LightboxImage };
  'error': { error: string };
}

/**
 * Event listener type
 */
export type LightboxEventListener<K extends keyof LightboxEvents> = (
  data: LightboxEvents[K]
) => void;

// ============================================================================
// Lightbox Adapter
// ============================================================================

export class LightboxAdapter {
  private imageExtractor: ImageExtractor;
  private gallery: LightboxGallery | null = null;
  private state: LightboxState;
  private preloadedImages: Set<number> = new Set();
  private listeners: Map<keyof LightboxEvents, Set<LightboxEventListener<any>>> = new Map();

  constructor(provider: ResourceProvider) {
    this.imageExtractor = new ImageExtractor(provider);
    this.state = this.getInitialState();
  }

  // ==========================================================================
  // State Management
  // ==========================================================================

  /**
   * Get initial state
   */
  private getInitialState(): LightboxState {
    return {
      isOpen: false,
      currentIndex: 0,
      zoomLevel: 1,
      panOffset: { x: 0, y: 0 },
      isLoading: false,
      error: null,
    };
  }

  /**
   * Get current state
   */
  getState(): LightboxState {
    return { ...this.state };
  }

  /**
   * Get current gallery
   */
  getGallery(): LightboxGallery | null {
    return this.gallery;
  }

  /**
   * Get current image
   */
  getCurrentImage(): LightboxImage | null {
    if (!this.gallery || this.gallery.images.length === 0) {
      return null;
    }
    return this.gallery.images[this.state.currentIndex] || null;
  }

  // ==========================================================================
  // Gallery Management
  // ==========================================================================

  /**
   * Load a gallery for a book
   */
  async loadGallery(
    bookId: string,
    bookTitle: string,
    imageHrefs: string[],
    options?: Partial<GalleryOptions>,
    filter?: ImageFilterOptions
  ): Promise<LightboxGallery> {
    this.state.isLoading = true;
    this.state.error = null;

    try {
      this.gallery = await this.imageExtractor.buildGallery(
        bookId,
        bookTitle,
        imageHrefs,
        options,
        filter
      );

      this.preloadedImages.clear();

      return this.gallery;
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.state.isLoading = false;
    }
  }

  /**
   * Clear current gallery
   */
  clearGallery(): void {
    if (this.gallery) {
      this.imageExtractor.releaseBook(this.gallery.bookId);
    }
    this.gallery = null;
    this.preloadedImages.clear();
    this.state = this.getInitialState();
  }

  // ==========================================================================
  // Lightbox Control
  // ==========================================================================

  /**
   * Open lightbox at specific index
   */
  open(index: number = 0): void {
    if (!this.gallery || this.gallery.images.length === 0) {
      return;
    }

    const validIndex = Math.max(0, Math.min(index, this.gallery.images.length - 1));

    this.state.isOpen = true;
    this.state.currentIndex = validIndex;
    this.state.zoomLevel = 1;
    this.state.panOffset = { x: 0, y: 0 };

    this.gallery.currentIndex = validIndex;

    this.emit('open', { index: validIndex });
    this.preloadAdjacent(validIndex);
  }

  /**
   * Close lightbox
   */
  close(): void {
    this.state.isOpen = false;
    this.state.zoomLevel = 1;
    this.state.panOffset = { x: 0, y: 0 };

    this.emit('close', {});
  }

  /**
   * Navigate to next/prev image
   */
  navigate(direction: NavigationDirection): void {
    if (!this.gallery || !this.state.isOpen) {
      return;
    }

    let newIndex: number;

    switch (direction) {
      case 'next':
        newIndex = (this.state.currentIndex + 1) % this.gallery.images.length;
        break;
      case 'prev':
        newIndex = (this.state.currentIndex - 1 + this.gallery.images.length) % this.gallery.images.length;
        break;
      case 'first':
        newIndex = 0;
        break;
      case 'last':
        newIndex = this.gallery.images.length - 1;
        break;
    }

    this.goToIndex(newIndex, direction);
  }

  /**
   * Go to specific index
   */
  goToIndex(index: number, direction: NavigationDirection = 'next'): void {
    if (!this.gallery) {
      return;
    }

    const validIndex = Math.max(0, Math.min(index, this.gallery.images.length - 1));

    this.state.currentIndex = validIndex;
    this.state.zoomLevel = 1;
    this.state.panOffset = { x: 0, y: 0 };

    this.gallery.currentIndex = validIndex;

    this.emit('navigate', { index: validIndex, direction });
    this.preloadAdjacent(validIndex);
  }

  // ==========================================================================
  // Zoom and Pan
  // ==========================================================================

  /**
   * Set zoom level
   */
  setZoom(level: number): void {
    const clampedLevel = Math.max(0.5, Math.min(5, level));
    this.state.zoomLevel = clampedLevel;

    // Reset pan if zooming out to fit
    if (clampedLevel <= 1) {
      this.state.panOffset = { x: 0, y: 0 };
    }

    this.emit('zoom', { level: clampedLevel });
  }

  /**
   * Zoom in
   */
  zoomIn(step: number = 0.25): void {
    this.setZoom(this.state.zoomLevel + step);
  }

  /**
   * Zoom out
   */
  zoomOut(step: number = 0.25): void {
    this.setZoom(this.state.zoomLevel - step);
  }

  /**
   * Reset zoom to fit
   */
  resetZoom(): void {
    this.setZoom(1);
  }

  /**
   * Toggle between fit and full size
   */
  toggleZoom(): void {
    if (this.state.zoomLevel === 1) {
      this.setZoom(2);
    } else {
      this.resetZoom();
    }
  }

  /**
   * Set pan offset
   */
  setPan(x: number, y: number): void {
    this.state.panOffset = { x, y };
    this.emit('pan', { x, y });
  }

  /**
   * Adjust pan offset
   */
  pan(deltaX: number, deltaY: number): void {
    this.setPan(
      this.state.panOffset.x + deltaX,
      this.state.panOffset.y + deltaY
    );
  }

  // ==========================================================================
  // Preloading
  // ==========================================================================

  /**
   * Preload adjacent images
   */
  private preloadAdjacent(currentIndex: number, range: number = 2): void {
    if (!this.gallery) {
      return;
    }

    const toPreload: number[] = [];

    for (let i = 1; i <= range; i++) {
      // Next images
      const nextIndex = currentIndex + i;
      if (nextIndex < this.gallery.images.length) {
        toPreload.push(nextIndex);
      }

      // Previous images
      const prevIndex = currentIndex - i;
      if (prevIndex >= 0) {
        toPreload.push(prevIndex);
      }
    }

    // Preload images that haven't been loaded yet
    for (const index of toPreload) {
      if (!this.preloadedImages.has(index)) {
        this.preloadImage(index);
      }
    }
  }

  /**
   * Preload a specific image
   */
  private preloadImage(index: number): void {
    if (!this.gallery || index < 0 || index >= this.gallery.images.length) {
      return;
    }

    const image = this.gallery.images[index];
    const img = new Image();

    img.onload = () => {
      this.preloadedImages.add(index);
      this.emit('load', { image });
    };

    img.onerror = () => {
      this.emit('error', { error: `Failed to preload image: ${image.href}` });
    };

    img.src = image.src;
  }

  // ==========================================================================
  // Keyboard Shortcuts
  // ==========================================================================

  /**
   * Handle keyboard navigation
   */
  handleKeyboard(event: KeyboardEvent): boolean {
    if (!this.state.isOpen) {
      return false;
    }

    switch (event.key) {
      case 'Escape':
        this.close();
        return true;

      case 'ArrowRight':
      case 'ArrowDown':
        this.navigate('next');
        return true;

      case 'ArrowLeft':
      case 'ArrowUp':
        this.navigate('prev');
        return true;

      case 'Home':
        this.navigate('first');
        return true;

      case 'End':
        this.navigate('last');
        return true;

      case '+':
      case '=':
        this.zoomIn();
        return true;

      case '-':
        this.zoomOut();
        return true;

      case '0':
        this.resetZoom();
        return true;

      case 'Enter':
      case ' ':
        this.toggleZoom();
        return true;

      default:
        return false;
    }
  }

  // ==========================================================================
  // Event System
  // ==========================================================================

  /**
   * Add event listener
   */
  on<K extends keyof LightboxEvents>(
    event: K,
    listener: LightboxEventListener<K>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    return () => this.off(event, listener);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof LightboxEvents>(
    event: K,
    listener: LightboxEventListener<K>
  ): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Emit event
   */
  private emit<K extends keyof LightboxEvents>(
    event: K,
    data: LightboxEvents[K]
  ): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          console.error(`[LightboxAdapter] Error in ${event} handler:`, error);
        }
      }
    }
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Destroy the adapter
   */
  destroy(): void {
    this.clearGallery();
    this.listeners.clear();
    this.imageExtractor.destroy();
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a lightbox adapter
 */
export function createLightboxAdapter(provider: ResourceProvider): LightboxAdapter {
  return new LightboxAdapter(provider);
}
