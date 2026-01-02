/**
 * Asset Extractor
 *
 * Core service for extracting resources from EPUB files.
 * Provides unified API for extracting images, fonts, audio, video,
 * and other assets from loaded books.
 *
 * Features:
 * - Lazy extraction (on-demand)
 * - Caching with blob URL management
 * - Metadata extraction
 * - Thumbnail generation
 * - Batch operations
 *
 * @see docs/specifications/file-system-architecture.md
 */

import type {
  ExtractedAsset,
  ExtractedImage,
  ExtractedAudio,
  ExtractedVideo,
  ExtractedFont,
  ExtractionOptions,
  ResourceProvider,
  MediaCategory,
  MediaType,
  AssetMetadata,
  ImageMetadata,
} from './types';
import {
  DEFAULT_EXTRACTION_OPTIONS,
  getMediaCategory,
  guessMimeType,
  getExtension,
  getFilename,
} from './types';

// ============================================================================
// Asset Cache
// ============================================================================

interface CachedAsset {
  asset: ExtractedAsset;
  lastAccessed: number;
}

/**
 * LRU cache for extracted assets
 */
class AssetCache {
  private cache: Map<string, CachedAsset> = new Map();
  private maxSize: number;
  private currentSize: number = 0;

  constructor(maxSizeBytes: number = 50 * 1024 * 1024) {
    this.maxSize = maxSizeBytes;
  }

  /**
   * Generate cache key
   */
  private key(bookId: string, href: string): string {
    return `${bookId}:${href}`;
  }

  /**
   * Get asset from cache
   */
  get(bookId: string, href: string): ExtractedAsset | null {
    const key = this.key(bookId, href);
    const cached = this.cache.get(key);

    if (cached) {
      cached.lastAccessed = Date.now();
      return cached.asset;
    }

    return null;
  }

  /**
   * Store asset in cache
   */
  set(bookId: string, href: string, asset: ExtractedAsset): void {
    const key = this.key(bookId, href);

    // Evict if necessary
    while (this.currentSize + asset.size > this.maxSize && this.cache.size > 0) {
      this.evictOldest();
    }

    // Store asset
    this.cache.set(key, {
      asset,
      lastAccessed: Date.now(),
    });
    this.currentSize += asset.size;
  }

  /**
   * Remove assets for a book
   */
  removeBook(bookId: string): void {
    for (const [key, cached] of this.cache.entries()) {
      if (key.startsWith(`${bookId}:`)) {
        // Revoke blob URL
        URL.revokeObjectURL(cached.asset.blobUrl);
        this.currentSize -= cached.asset.size;
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached assets
   */
  clear(): void {
    for (const cached of this.cache.values()) {
      URL.revokeObjectURL(cached.asset.blobUrl);
    }
    this.cache.clear();
    this.currentSize = 0;
  }

  /**
   * Evict oldest entry
   */
  private evictOldest(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [key, cached] of this.cache.entries()) {
      if (cached.lastAccessed < oldestTime) {
        oldest = key;
        oldestTime = cached.lastAccessed;
      }
    }

    if (oldest) {
      const cached = this.cache.get(oldest);
      if (cached) {
        URL.revokeObjectURL(cached.asset.blobUrl);
        this.currentSize -= cached.asset.size;
      }
      this.cache.delete(oldest);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { count: number; size: number; maxSize: number } {
    return {
      count: this.cache.size,
      size: this.currentSize,
      maxSize: this.maxSize,
    };
  }
}

// ============================================================================
// Asset Extractor
// ============================================================================

export class AssetExtractor {
  private provider: ResourceProvider;
  private cache: AssetCache;
  private thumbnailCache: Map<string, string> = new Map();

  constructor(provider: ResourceProvider, maxCacheSize?: number) {
    this.provider = provider;
    this.cache = new AssetCache(maxCacheSize);
  }

  // ==========================================================================
  // Single Asset Extraction
  // ==========================================================================

  /**
   * Extract a single resource by href
   */
  async extractResource(
    bookId: string,
    href: string,
    options: Partial<ExtractionOptions> = {}
  ): Promise<ExtractedAsset> {
    const opts = { ...DEFAULT_EXTRACTION_OPTIONS, ...options };

    // Check cache first
    const cached = this.cache.get(bookId, href);
    if (cached) {
      return cached;
    }

    // Fetch resource
    const bytes = await this.provider.getResource(bookId, href);
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    // Check size limit
    if (opts.maxAssetSize && data.byteLength > opts.maxAssetSize) {
      throw new Error(`Asset exceeds size limit: ${data.byteLength} > ${opts.maxAssetSize}`);
    }

    // Determine type
    const mimeType = guessMimeType(href);
    const category = getMediaCategory(mimeType);

    // Create blob URL
    const blob = new Blob([data], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);

    // Extract metadata
    const metadata = await this.extractMetadata(data, href, mimeType, category, opts);

    // Build asset
    const asset: ExtractedAsset = {
      bookId,
      href,
      mimeType,
      category,
      data,
      blobUrl,
      size: data.byteLength,
      metadata,
      extractedAt: Date.now(),
    };

    // Cache if data is included
    if (opts.includeData) {
      this.cache.set(bookId, href, asset);
    }

    return asset;
  }

  /**
   * Extract an image resource
   */
  async extractImage(
    bookId: string,
    href: string,
    options: Partial<ExtractionOptions> = {}
  ): Promise<ExtractedImage> {
    const asset = await this.extractResource(bookId, href, options);

    if (asset.category !== 'image') {
      throw new Error(`Resource is not an image: ${href} (${asset.mimeType})`);
    }

    return asset as ExtractedImage;
  }

  // ==========================================================================
  // Bulk Extraction
  // ==========================================================================

  /**
   * Extract all images from a book
   */
  async extractAllImages(
    bookId: string,
    imageHrefs: string[],
    options: Partial<ExtractionOptions> = {}
  ): Promise<ExtractedImage[]> {
    const opts = { ...DEFAULT_EXTRACTION_OPTIONS, ...options };
    const results: ExtractedImage[] = [];
    const limit = opts.limit ?? imageHrefs.length;

    for (const href of imageHrefs.slice(0, limit)) {
      try {
        const image = await this.extractImage(bookId, href, opts);
        results.push(image);
      } catch (error) {
        console.warn(`[AssetExtractor] Failed to extract image ${href}:`, error);
      }
    }

    return results;
  }

  /**
   * Extract all media of specified types
   */
  async extractAllMedia(
    bookId: string,
    resourceHrefs: string[],
    options: Partial<ExtractionOptions> = {}
  ): Promise<ExtractedAsset[]> {
    const opts = { ...DEFAULT_EXTRACTION_OPTIONS, ...options };
    const results: ExtractedAsset[] = [];
    const limit = opts.limit ?? resourceHrefs.length;

    for (const href of resourceHrefs.slice(0, limit)) {
      const mimeType = guessMimeType(href);
      const category = getMediaCategory(mimeType);

      // Filter by type
      if (opts.includeTypes && !opts.includeTypes.includes(category)) {
        continue;
      }
      if (opts.excludeTypes && opts.excludeTypes.includes(category)) {
        continue;
      }

      try {
        const asset = await this.extractResource(bookId, href, opts);
        results.push(asset);
      } catch (error) {
        console.warn(`[AssetExtractor] Failed to extract ${href}:`, error);
      }
    }

    return results;
  }

  // ==========================================================================
  // Metadata Extraction
  // ==========================================================================

  /**
   * Extract metadata for an asset
   */
  private async extractMetadata(
    data: ArrayBuffer,
    href: string,
    mimeType: MediaType,
    category: MediaCategory,
    options: ExtractionOptions
  ): Promise<AssetMetadata> {
    const base: AssetMetadata = {
      filename: getFilename(href),
      extension: getExtension(href),
    };

    if (!options.extractMetadata) {
      return base;
    }

    switch (category) {
      case 'image':
        return await this.extractImageMetadata(data, mimeType, base);
      case 'audio':
        return this.extractAudioMetadata(data, mimeType, base);
      case 'video':
        return this.extractVideoMetadata(data, mimeType, base);
      default:
        return base;
    }
  }

  /**
   * Extract image dimensions and metadata
   */
  private async extractImageMetadata(
    data: ArrayBuffer,
    mimeType: MediaType,
    base: AssetMetadata
  ): Promise<ImageMetadata> {
    const metadata: ImageMetadata = { ...base };

    try {
      // Create an image element to get dimensions
      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);

      const dimensions = await this.getImageDimensions(url);
      URL.revokeObjectURL(url);

      metadata.width = dimensions.width;
      metadata.height = dimensions.height;
      metadata.aspectRatio = dimensions.width / dimensions.height;

      // Detect if it's likely a cover image
      const filename = base.filename.toLowerCase();
      metadata.isCover = filename.includes('cover') ||
                         filename.includes('title') ||
                         filename === 'cover.jpg' ||
                         filename === 'cover.png';

      // Guess image role
      metadata.role = this.guessImageRole(filename, metadata);

    } catch (error) {
      console.warn('[AssetExtractor] Failed to extract image metadata:', error);
    }

    return metadata;
  }

  /**
   * Get image dimensions using Image element
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
   * Guess image role based on filename and metadata
   */
  private guessImageRole(filename: string, metadata: ImageMetadata): ImageMetadata['role'] {
    if (metadata.isCover) return 'cover';
    if (filename.includes('icon') || filename.includes('bullet')) return 'icon';
    if (filename.includes('diagram') || filename.includes('chart')) return 'diagram';
    if (filename.includes('map')) return 'map';
    if (filename.includes('photo') || filename.includes('photograph')) return 'photograph';
    if (filename.includes('fig') || filename.includes('illustration')) return 'illustration';

    // Check aspect ratio for decorative images (very wide or very tall)
    if (metadata.aspectRatio && (metadata.aspectRatio > 5 || metadata.aspectRatio < 0.2)) {
      return 'decorative';
    }

    return 'unknown';
  }

  /**
   * Extract audio metadata (placeholder)
   */
  private extractAudioMetadata(
    data: ArrayBuffer,
    mimeType: MediaType,
    base: AssetMetadata
  ): AssetMetadata {
    // Audio metadata extraction would require parsing the audio file format
    // For now, return base metadata
    return base;
  }

  /**
   * Extract video metadata (placeholder)
   */
  private extractVideoMetadata(
    data: ArrayBuffer,
    mimeType: MediaType,
    base: AssetMetadata
  ): AssetMetadata {
    // Video metadata extraction would require parsing the video file format
    // For now, return base metadata
    return base;
  }

  // ==========================================================================
  // Thumbnail Generation
  // ==========================================================================

  /**
   * Generate a thumbnail for an image
   */
  async generateThumbnail(
    bookId: string,
    href: string,
    maxSize: number = 200
  ): Promise<string> {
    const cacheKey = `${bookId}:${href}:${maxSize}`;

    // Check cache
    const cached = this.thumbnailCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Get the image
    const image = await this.extractImage(bookId, href);

    // Create thumbnail using canvas
    const thumbnailUrl = await this.resizeImage(image.blobUrl, maxSize);

    // Cache and return
    this.thumbnailCache.set(cacheKey, thumbnailUrl);
    return thumbnailUrl;
  }

  /**
   * Resize an image using canvas
   */
  private async resizeImage(srcUrl: string, maxSize: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        // Calculate new dimensions maintaining aspect ratio
        let width = img.naturalWidth;
        let height = img.naturalHeight;

        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Draw resized image
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to blob URL
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const url = URL.createObjectURL(blob);
              resolve(url);
            } else {
              reject(new Error('Failed to create thumbnail blob'));
            }
          },
          'image/jpeg',
          0.8
        );
      };

      img.onerror = () => reject(new Error('Failed to load image for thumbnail'));
      img.src = srcUrl;
    });
  }

  // ==========================================================================
  // Blob URL Management
  // ==========================================================================

  /**
   * Get blob URL for a resource
   */
  async getResourceUrl(bookId: string, href: string): Promise<string> {
    // Check cache first
    const cached = this.cache.get(bookId, href);
    if (cached) {
      return cached.blobUrl;
    }

    // Extract and return URL
    const asset = await this.extractResource(bookId, href);
    return asset.blobUrl;
  }

  /**
   * Release resources for a book
   */
  releaseBook(bookId: string): void {
    this.cache.removeBook(bookId);

    // Clear thumbnail cache for this book
    for (const key of this.thumbnailCache.keys()) {
      if (key.startsWith(`${bookId}:`)) {
        const url = this.thumbnailCache.get(key);
        if (url) {
          URL.revokeObjectURL(url);
        }
        this.thumbnailCache.delete(key);
      }
    }
  }

  /**
   * Release all resources
   */
  destroy(): void {
    this.cache.clear();

    // Clear all thumbnail URLs
    for (const url of this.thumbnailCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.thumbnailCache.clear();
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get cache statistics
   */
  getCacheStats(): { count: number; size: number; maxSize: number } {
    return this.cache.getStats();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let extractorInstance: AssetExtractor | null = null;

/**
 * Get or create the asset extractor instance
 */
export function getAssetExtractor(provider: ResourceProvider): AssetExtractor {
  if (!extractorInstance) {
    extractorInstance = new AssetExtractor(provider);
  }
  return extractorInstance;
}

/**
 * Create a new asset extractor instance
 */
export function createAssetExtractor(
  provider: ResourceProvider,
  maxCacheSize?: number
): AssetExtractor {
  return new AssetExtractor(provider, maxCacheSize);
}
