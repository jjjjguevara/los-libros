/**
 * Cover Extractor
 *
 * Specialized service for extracting and caching book cover images.
 * Provides optimized cover retrieval with thumbnail generation and caching.
 *
 * Features:
 * - Extract covers from EPUB metadata
 * - Fallback cover detection
 * - Multiple resolution thumbnails
 * - Persistent cover cache
 * - Placeholder generation
 *
 * @see docs/specifications/file-system-architecture.md
 */

import type { ResourceProvider, ExtractedImage } from './types';
import { guessMimeType, getMediaCategory } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Cover image with multiple resolutions
 */
export interface BookCover {
  /** Book ID */
  bookId: string;
  /** Original cover blob URL */
  originalUrl: string;
  /** Thumbnail URL (small, ~100px) */
  thumbnailUrl: string;
  /** Medium size URL (~300px) */
  mediumUrl: string;
  /** Cover dimensions */
  width: number;
  height: number;
  /** Aspect ratio */
  aspectRatio: number;
  /** MIME type */
  mimeType: string;
  /** Is placeholder (no real cover) */
  isPlaceholder: boolean;
  /** Extraction timestamp */
  extractedAt: number;
}

/**
 * Cover extraction options
 */
export interface CoverExtractionOptions {
  /** Thumbnail size (max dimension) */
  thumbnailSize: number;
  /** Medium size (max dimension) */
  mediumSize: number;
  /** Generate placeholder if no cover found */
  generatePlaceholder: boolean;
  /** Placeholder background colors */
  placeholderColors: string[];
  /** JPEG quality for thumbnails */
  quality: number;
}

/**
 * Default options
 */
export const DEFAULT_COVER_OPTIONS: CoverExtractionOptions = {
  thumbnailSize: 100,
  mediumSize: 300,
  generatePlaceholder: true,
  placeholderColors: [
    '#e74c3c', '#3498db', '#2ecc71', '#f1c40f',
    '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
  ],
  quality: 0.85,
};

// ============================================================================
// Cover Extractor
// ============================================================================

export class CoverExtractor {
  private provider: ResourceProvider;
  private options: CoverExtractionOptions;
  private coverCache: Map<string, BookCover> = new Map();
  private blobUrls: Set<string> = new Set();

  constructor(provider: ResourceProvider, options: Partial<CoverExtractionOptions> = {}) {
    this.provider = provider;
    this.options = { ...DEFAULT_COVER_OPTIONS, ...options };
  }

  // ==========================================================================
  // Cover Extraction
  // ==========================================================================

  /**
   * Extract cover for a book
   */
  async extractCover(
    bookId: string,
    coverHref: string | undefined,
    fallbackHrefs: string[],
    bookTitle: string
  ): Promise<BookCover> {
    // Check cache
    const cached = this.coverCache.get(bookId);
    if (cached) {
      return cached;
    }

    // Try to extract cover
    let coverImage: ExtractedImage | null = null;

    // Try explicit cover href
    if (coverHref) {
      coverImage = await this.tryExtractImage(bookId, coverHref);
    }

    // Try fallback hrefs with cover patterns
    if (!coverImage) {
      for (const href of fallbackHrefs) {
        if (this.isCoverCandidate(href)) {
          coverImage = await this.tryExtractImage(bookId, href);
          if (coverImage) break;
        }
      }
    }

    // Try first portrait image
    if (!coverImage) {
      for (const href of fallbackHrefs.slice(0, 10)) {
        const image = await this.tryExtractImage(bookId, href);
        if (image && this.isPortrait(image)) {
          coverImage = image;
          break;
        }
      }
    }

    // Generate cover
    let cover: BookCover;
    if (coverImage) {
      cover = await this.processImage(bookId, coverImage);
    } else if (this.options.generatePlaceholder) {
      cover = await this.generatePlaceholder(bookId, bookTitle);
    } else {
      throw new Error('No cover found and placeholder generation disabled');
    }

    // Cache and return
    this.coverCache.set(bookId, cover);
    return cover;
  }

  /**
   * Get cached cover
   */
  getCachedCover(bookId: string): BookCover | null {
    return this.coverCache.get(bookId) || null;
  }

  /**
   * Check if cover is cached
   */
  hasCachedCover(bookId: string): boolean {
    return this.coverCache.has(bookId);
  }

  // ==========================================================================
  // Image Processing
  // ==========================================================================

  /**
   * Try to extract an image, returning null on failure
   */
  private async tryExtractImage(
    bookId: string,
    href: string
  ): Promise<ExtractedImage | null> {
    try {
      const mimeType = guessMimeType(href);
      if (getMediaCategory(mimeType) !== 'image') {
        return null;
      }

      const bytes = await this.provider.getResource(bookId, href);
      const data = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;

      const blob = new Blob([data], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);
      this.blobUrls.add(blobUrl);

      // Get dimensions
      const dimensions = await this.getImageDimensions(blobUrl);

      return {
        bookId,
        href,
        mimeType,
        category: 'image',
        data,
        blobUrl,
        size: data.byteLength,
        metadata: {
          filename: href.split('/').pop() || href,
          extension: href.split('.').pop() || '',
          width: dimensions.width,
          height: dimensions.height,
          aspectRatio: dimensions.width / dimensions.height,
        },
        extractedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Process extracted image into cover
   */
  private async processImage(
    bookId: string,
    image: ExtractedImage
  ): Promise<BookCover> {
    const width = image.metadata.width || 200;
    const height = image.metadata.height || 300;

    // Generate thumbnails
    const [thumbnailUrl, mediumUrl] = await Promise.all([
      this.resizeImage(image.blobUrl, this.options.thumbnailSize),
      this.resizeImage(image.blobUrl, this.options.mediumSize),
    ]);

    this.blobUrls.add(thumbnailUrl);
    this.blobUrls.add(mediumUrl);

    return {
      bookId,
      originalUrl: image.blobUrl,
      thumbnailUrl,
      mediumUrl,
      width,
      height,
      aspectRatio: width / height,
      mimeType: image.mimeType,
      isPlaceholder: false,
      extractedAt: Date.now(),
    };
  }

  /**
   * Generate placeholder cover
   */
  private async generatePlaceholder(
    bookId: string,
    bookTitle: string
  ): Promise<BookCover> {
    const width = 200;
    const height = 300;

    // Choose color based on title hash
    const colorIndex = this.hashString(bookTitle) % this.options.placeholderColors.length;
    const backgroundColor = this.options.placeholderColors[colorIndex];

    // Generate all sizes
    const [originalUrl, thumbnailUrl, mediumUrl] = await Promise.all([
      this.createPlaceholderImage(width, height, backgroundColor, bookTitle),
      this.createPlaceholderImage(
        Math.round((this.options.thumbnailSize * width) / height),
        this.options.thumbnailSize,
        backgroundColor,
        bookTitle
      ),
      this.createPlaceholderImage(
        Math.round((this.options.mediumSize * width) / height),
        this.options.mediumSize,
        backgroundColor,
        bookTitle
      ),
    ]);

    this.blobUrls.add(originalUrl);
    this.blobUrls.add(thumbnailUrl);
    this.blobUrls.add(mediumUrl);

    return {
      bookId,
      originalUrl,
      thumbnailUrl,
      mediumUrl,
      width,
      height,
      aspectRatio: width / height,
      mimeType: 'image/png',
      isPlaceholder: true,
      extractedAt: Date.now(),
    };
  }

  /**
   * Create placeholder image with text
   */
  private async createPlaceholderImage(
    width: number,
    height: number,
    backgroundColor: string,
    title: string
  ): Promise<string> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    // Background
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Title text
    const fontSize = Math.max(12, Math.min(24, width / 8));
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Word wrap
    const words = title.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';
    const maxWidth = width - 20;

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }

    // Limit lines
    const displayLines = lines.slice(0, 4);
    const lineHeight = fontSize * 1.3;
    const startY = height / 2 - ((displayLines.length - 1) * lineHeight) / 2;

    for (let i = 0; i < displayLines.length; i++) {
      ctx.fillText(displayLines[i], width / 2, startY + i * lineHeight, maxWidth);
    }

    // Convert to blob URL
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(URL.createObjectURL(blob));
          } else {
            reject(new Error('Failed to create placeholder blob'));
          }
        },
        'image/png'
      );
    });
  }

  // ==========================================================================
  // Image Utilities
  // ==========================================================================

  /**
   * Get image dimensions
   */
  private getImageDimensions(url: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = url;
    });
  }

  /**
   * Resize image using canvas
   */
  private async resizeImage(srcUrl: string, maxSize: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        let width = img.naturalWidth;
        let height = img.naturalHeight;

        // Calculate new dimensions
        if (width > height) {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        } else {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(URL.createObjectURL(blob));
            } else {
              reject(new Error('Failed to create thumbnail blob'));
            }
          },
          'image/jpeg',
          this.options.quality
        );
      };

      img.onerror = () => reject(new Error('Failed to load image for resize'));
      img.src = srcUrl;
    });
  }

  /**
   * Check if href is likely a cover image
   */
  private isCoverCandidate(href: string): boolean {
    const lower = href.toLowerCase();
    return (
      lower.includes('cover') ||
      lower.includes('title') ||
      lower.includes('front') ||
      lower.endsWith('cover.jpg') ||
      lower.endsWith('cover.png')
    );
  }

  /**
   * Check if image is portrait orientation
   */
  private isPortrait(image: ExtractedImage): boolean {
    const width = image.metadata.width || 0;
    const height = image.metadata.height || 0;
    return height > width;
  }

  /**
   * Simple string hash for color selection
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  // ==========================================================================
  // Resource Management
  // ==========================================================================

  /**
   * Release cover for a book
   */
  releaseCover(bookId: string): void {
    const cover = this.coverCache.get(bookId);
    if (cover) {
      this.revokeUrl(cover.originalUrl);
      this.revokeUrl(cover.thumbnailUrl);
      this.revokeUrl(cover.mediumUrl);
      this.coverCache.delete(bookId);
    }
  }

  /**
   * Revoke a blob URL
   */
  private revokeUrl(url: string): void {
    if (this.blobUrls.has(url)) {
      URL.revokeObjectURL(url);
      this.blobUrls.delete(url);
    }
  }

  /**
   * Release all resources
   */
  destroy(): void {
    for (const url of this.blobUrls) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls.clear();
    this.coverCache.clear();
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a cover extractor
 */
export function createCoverExtractor(
  provider: ResourceProvider,
  options?: Partial<CoverExtractionOptions>
): CoverExtractor {
  return new CoverExtractor(provider, options);
}
