/**
 * Image Extractor
 *
 * Specialized extractor for image assets with features for:
 * - Lightbox integration
 * - Cover extraction
 * - Image gallery building
 * - Batch image operations
 *
 * @see docs/specifications/file-system-architecture.md
 */

import type {
  ExtractedImage,
  LightboxImage,
  LightboxGallery,
  ExtractionOptions,
  ResourceProvider,
  ImageRole,
} from './types';
import { AssetExtractor } from './asset-extractor';

// ============================================================================
// Types
// ============================================================================

/**
 * Image extraction filter options
 */
export interface ImageFilterOptions {
  /** Minimum width in pixels */
  minWidth?: number;
  /** Minimum height in pixels */
  minHeight?: number;
  /** Include only specific roles */
  roles?: ImageRole[];
  /** Exclude specific roles */
  excludeRoles?: ImageRole[];
  /** Include cover images */
  includeCover?: boolean;
  /** Only cover images */
  coverOnly?: boolean;
}

/**
 * Image gallery options
 */
export interface GalleryOptions {
  /** Generate thumbnails */
  generateThumbnails?: boolean;
  /** Thumbnail size (max dimension) */
  thumbnailSize?: number;
  /** Include image captions */
  includeCaptions?: boolean;
  /** Sort order */
  sortBy?: 'href' | 'size' | 'dimensions' | 'role';
  /** Sort direction */
  sortDirection?: 'asc' | 'desc';
}

// ============================================================================
// Image Extractor
// ============================================================================

export class ImageExtractor {
  private extractor: AssetExtractor;
  private provider: ResourceProvider;

  constructor(provider: ResourceProvider, extractor?: AssetExtractor) {
    this.provider = provider;
    this.extractor = extractor || new AssetExtractor(provider);
  }

  // ==========================================================================
  // Single Image Operations
  // ==========================================================================

  /**
   * Extract a single image
   */
  async extractImage(
    bookId: string,
    href: string,
    options?: Partial<ExtractionOptions>
  ): Promise<ExtractedImage> {
    return this.extractor.extractImage(bookId, href, options);
  }

  /**
   * Get image for lightbox display
   */
  async getImageForLightbox(
    bookId: string,
    href: string,
    index: number,
    total: number,
    options?: Partial<GalleryOptions>
  ): Promise<LightboxImage> {
    const opts = {
      generateThumbnails: true,
      thumbnailSize: 200,
      ...options,
    };

    const image = await this.extractor.extractImage(bookId, href);

    let thumbnail = image.blobUrl;
    if (opts.generateThumbnails) {
      try {
        thumbnail = await this.extractor.generateThumbnail(bookId, href, opts.thumbnailSize);
      } catch (error) {
        console.warn('[ImageExtractor] Failed to generate thumbnail:', error);
      }
    }

    return {
      src: image.blobUrl,
      thumbnail,
      alt: image.metadata.altText || image.metadata.filename,
      caption: image.metadata.caption,
      index,
      totalImages: total,
      href,
      width: image.metadata.width,
      height: image.metadata.height,
    };
  }

  // ==========================================================================
  // Bulk Image Operations
  // ==========================================================================

  /**
   * Extract all images from a list of hrefs
   */
  async extractAllImages(
    bookId: string,
    imageHrefs: string[],
    options?: Partial<ExtractionOptions>,
    filter?: ImageFilterOptions
  ): Promise<ExtractedImage[]> {
    const images = await this.extractor.extractAllImages(bookId, imageHrefs, options);

    if (!filter) {
      return images;
    }

    return this.filterImages(images, filter);
  }

  /**
   * Get all images for lightbox gallery
   */
  async getAllImagesForLightbox(
    bookId: string,
    imageHrefs: string[],
    options?: Partial<GalleryOptions>,
    filter?: ImageFilterOptions
  ): Promise<LightboxImage[]> {
    // Extract all images first
    let images = await this.extractAllImages(bookId, imageHrefs, undefined, filter);

    // Sort if requested
    if (options?.sortBy) {
      images = this.sortImages(images, options.sortBy, options.sortDirection || 'asc');
    }

    // Convert to lightbox format
    const total = images.length;
    const lightboxImages: LightboxImage[] = [];

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const lightboxImage = await this.getImageForLightbox(
        bookId,
        image.href,
        i,
        total,
        options
      );
      lightboxImages.push(lightboxImage);
    }

    return lightboxImages;
  }

  /**
   * Build a complete lightbox gallery
   */
  async buildGallery(
    bookId: string,
    bookTitle: string,
    imageHrefs: string[],
    options?: Partial<GalleryOptions>,
    filter?: ImageFilterOptions
  ): Promise<LightboxGallery> {
    const images = await this.getAllImagesForLightbox(bookId, imageHrefs, options, filter);

    return {
      bookId,
      bookTitle,
      images,
      currentIndex: 0,
    };
  }

  // ==========================================================================
  // Cover Extraction
  // ==========================================================================

  /**
   * Extract the book cover image
   */
  async extractCover(
    bookId: string,
    coverHref: string | undefined,
    allImageHrefs: string[]
  ): Promise<ExtractedImage | null> {
    // If cover href is provided, try that first
    if (coverHref) {
      try {
        return await this.extractor.extractImage(bookId, coverHref);
      } catch (error) {
        console.warn('[ImageExtractor] Failed to extract cover from href:', error);
      }
    }

    // Try to find cover by filename patterns
    const coverPatterns = [
      /cover\.(jpg|jpeg|png|gif|webp)$/i,
      /title\.(jpg|jpeg|png|gif|webp)$/i,
      /front\.(jpg|jpeg|png|gif|webp)$/i,
      /cover[-_]image\.(jpg|jpeg|png|gif|webp)$/i,
    ];

    for (const href of allImageHrefs) {
      for (const pattern of coverPatterns) {
        if (pattern.test(href)) {
          try {
            const image = await this.extractor.extractImage(bookId, href);
            if (image.metadata.width && image.metadata.height) {
              // Check if it looks like a cover (portrait orientation)
              const aspectRatio = image.metadata.width / image.metadata.height;
              if (aspectRatio < 1) {
                return image;
              }
            }
            return image;
          } catch (error) {
            console.warn('[ImageExtractor] Failed to extract potential cover:', error);
          }
        }
      }
    }

    // Fall back to first portrait image
    for (const href of allImageHrefs.slice(0, 10)) {
      try {
        const image = await this.extractor.extractImage(bookId, href);
        if (image.metadata.width && image.metadata.height) {
          const aspectRatio = image.metadata.width / image.metadata.height;
          if (aspectRatio < 1) {
            return image;
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Generate a cover thumbnail
   */
  async getCoverThumbnail(
    bookId: string,
    coverHref: string | undefined,
    allImageHrefs: string[],
    size: number = 200
  ): Promise<string | null> {
    const cover = await this.extractCover(bookId, coverHref, allImageHrefs);
    if (!cover) {
      return null;
    }

    try {
      return await this.extractor.generateThumbnail(bookId, cover.href, size);
    } catch {
      return cover.blobUrl;
    }
  }

  // ==========================================================================
  // Filtering and Sorting
  // ==========================================================================

  /**
   * Filter images based on criteria
   */
  private filterImages(
    images: ExtractedImage[],
    filter: ImageFilterOptions
  ): ExtractedImage[] {
    return images.filter(image => {
      // Minimum dimensions
      if (filter.minWidth && (image.metadata.width || 0) < filter.minWidth) {
        return false;
      }
      if (filter.minHeight && (image.metadata.height || 0) < filter.minHeight) {
        return false;
      }

      // Role filtering
      if (filter.roles && !filter.roles.includes(image.metadata.role || 'unknown')) {
        return false;
      }
      if (filter.excludeRoles && filter.excludeRoles.includes(image.metadata.role || 'unknown')) {
        return false;
      }

      // Cover filtering
      if (filter.coverOnly && !image.metadata.isCover) {
        return false;
      }
      if (filter.includeCover === false && image.metadata.isCover) {
        return false;
      }

      return true;
    });
  }

  /**
   * Sort images
   */
  private sortImages(
    images: ExtractedImage[],
    sortBy: 'href' | 'size' | 'dimensions' | 'role',
    direction: 'asc' | 'desc'
  ): ExtractedImage[] {
    const sorted = [...images].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'href':
          comparison = a.href.localeCompare(b.href);
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
        case 'dimensions':
          const aArea = (a.metadata.width || 0) * (a.metadata.height || 0);
          const bArea = (b.metadata.width || 0) * (b.metadata.height || 0);
          comparison = aArea - bArea;
          break;
        case 'role':
          comparison = (a.metadata.role || 'unknown').localeCompare(b.metadata.role || 'unknown');
          break;
      }

      return direction === 'desc' ? -comparison : comparison;
    });

    return sorted;
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Get image blob URL
   */
  async getImageUrl(bookId: string, href: string): Promise<string> {
    return this.extractor.getResourceUrl(bookId, href);
  }

  /**
   * Get thumbnail URL
   */
  async getThumbnailUrl(bookId: string, href: string, size?: number): Promise<string> {
    return this.extractor.generateThumbnail(bookId, href, size);
  }

  /**
   * Release resources for a book
   */
  releaseBook(bookId: string): void {
    this.extractor.releaseBook(bookId);
  }

  /**
   * Destroy the extractor
   */
  destroy(): void {
    this.extractor.destroy();
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an image extractor
 */
export function createImageExtractor(
  provider: ResourceProvider,
  extractor?: AssetExtractor
): ImageExtractor {
  return new ImageExtractor(provider, extractor);
}
