/**
 * Asset Extraction Types
 *
 * Type definitions for the asset extraction infrastructure.
 * Supports extracting images, fonts, audio, video, and other resources
 * from EPUB files for use in lightbox, vault export, OCR, etc.
 *
 * @see docs/specifications/file-system-architecture.md
 */

// ============================================================================
// Media Types
// ============================================================================

/**
 * Supported media type categories
 */
export type MediaCategory = 'image' | 'audio' | 'video' | 'font' | 'style' | 'document' | 'other';

/**
 * Common media types found in EPUBs
 */
export type MediaType =
  // Images
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp'
  | 'image/svg+xml'
  | 'image/bmp'
  | 'image/tiff'
  // Audio
  | 'audio/mpeg'
  | 'audio/ogg'
  | 'audio/wav'
  | 'audio/webm'
  | 'audio/aac'
  | 'audio/flac'
  // Video
  | 'video/mp4'
  | 'video/webm'
  | 'video/ogg'
  // Fonts
  | 'font/woff'
  | 'font/woff2'
  | 'font/ttf'
  | 'font/otf'
  | 'application/font-woff'
  | 'application/font-woff2'
  // Styles
  | 'text/css'
  // Documents
  | 'application/xhtml+xml'
  | 'text/html'
  | 'application/xml'
  // Other
  | 'application/octet-stream'
  | string;

// ============================================================================
// Extracted Asset
// ============================================================================

/**
 * Base interface for all extracted assets
 */
export interface ExtractedAsset {
  /** Book ID this asset belongs to */
  bookId: string;
  /** Original href/path within the EPUB */
  href: string;
  /** MIME type of the asset */
  mimeType: MediaType;
  /** Media category */
  category: MediaCategory;
  /** Raw binary data */
  data: ArrayBuffer;
  /** Blob URL for displaying in browser */
  blobUrl: string;
  /** File size in bytes */
  size: number;
  /** Asset metadata (varies by type) */
  metadata: AssetMetadata;
  /** Extraction timestamp */
  extractedAt: number;
}

/**
 * Common asset metadata
 */
export interface AssetMetadata {
  /** Original filename */
  filename: string;
  /** File extension */
  extension: string;
  /** Alternative text (for images) */
  altText?: string;
  /** Caption (for figures) */
  caption?: string;
  /** Chapter/spine index where asset was found */
  spineIndex?: number;
  /** Chapter href where asset was found */
  chapterHref?: string;
}

// ============================================================================
// Image-Specific Types
// ============================================================================

/**
 * Extracted image with additional metadata
 */
export interface ExtractedImage extends ExtractedAsset {
  category: 'image';
  metadata: ImageMetadata;
}

/**
 * Image-specific metadata
 */
export interface ImageMetadata extends AssetMetadata {
  /** Image width in pixels */
  width?: number;
  /** Image height in pixels */
  height?: number;
  /** Aspect ratio (width/height) */
  aspectRatio?: number;
  /** Whether image is the book cover */
  isCover?: boolean;
  /** Image role (cover, illustration, diagram, etc.) */
  role?: ImageRole;
  /** Color mode (rgb, grayscale, etc.) */
  colorMode?: string;
  /** Has transparency */
  hasAlpha?: boolean;
}

/**
 * Image roles in EPUB content
 */
export type ImageRole =
  | 'cover'
  | 'illustration'
  | 'diagram'
  | 'photograph'
  | 'icon'
  | 'decorative'
  | 'chart'
  | 'map'
  | 'unknown';

// ============================================================================
// Audio/Video Types
// ============================================================================

/**
 * Extracted audio asset
 */
export interface ExtractedAudio extends ExtractedAsset {
  category: 'audio';
  metadata: AudioMetadata;
}

/**
 * Audio-specific metadata
 */
export interface AudioMetadata extends AssetMetadata {
  /** Duration in seconds */
  duration?: number;
  /** Sample rate */
  sampleRate?: number;
  /** Number of channels */
  channels?: number;
  /** Bitrate in kbps */
  bitrate?: number;
  /** Track title */
  title?: string;
  /** Artist/narrator */
  artist?: string;
}

/**
 * Extracted video asset
 */
export interface ExtractedVideo extends ExtractedAsset {
  category: 'video';
  metadata: VideoMetadata;
}

/**
 * Video-specific metadata
 */
export interface VideoMetadata extends AssetMetadata {
  /** Duration in seconds */
  duration?: number;
  /** Width in pixels */
  width?: number;
  /** Height in pixels */
  height?: number;
  /** Frame rate */
  frameRate?: number;
  /** Video codec */
  codec?: string;
  /** Has audio track */
  hasAudio?: boolean;
}

// ============================================================================
// Font Types
// ============================================================================

/**
 * Extracted font asset
 */
export interface ExtractedFont extends ExtractedAsset {
  category: 'font';
  metadata: FontMetadata;
}

/**
 * Font-specific metadata
 */
export interface FontMetadata extends AssetMetadata {
  /** Font family name */
  fontFamily?: string;
  /** Font weight */
  fontWeight?: string | number;
  /** Font style (normal, italic, oblique) */
  fontStyle?: string;
  /** Font format (woff, woff2, ttf, otf) */
  format?: string;
}

// ============================================================================
// Lightbox Types
// ============================================================================

/**
 * Image prepared for lightbox display
 */
export interface LightboxImage {
  /** Full-size image blob URL */
  src: string;
  /** Thumbnail blob URL */
  thumbnail: string;
  /** Alternative text */
  alt: string;
  /** Optional caption */
  caption?: string;
  /** Index in the image collection */
  index: number;
  /** Total number of images */
  totalImages: number;
  /** Original href for reference */
  href: string;
  /** Image dimensions */
  width?: number;
  height?: number;
}

/**
 * Lightbox gallery configuration
 */
export interface LightboxGallery {
  /** Book ID */
  bookId: string;
  /** All images in the gallery */
  images: LightboxImage[];
  /** Current image index */
  currentIndex: number;
  /** Book title for display */
  bookTitle: string;
}

// ============================================================================
// OCR Types
// ============================================================================

/**
 * OCR request for an image
 */
export interface OCRRequest {
  /** Image to process */
  image: ExtractedImage;
  /** Target language(s) */
  languages?: string[];
  /** OCR processing options */
  options?: OCROptions;
}

/**
 * OCR processing options
 */
export interface OCROptions {
  /** Enable preprocessing (deskew, denoise, etc.) */
  preprocess?: boolean;
  /** Output format */
  outputFormat?: 'text' | 'hocr' | 'json';
  /** Confidence threshold (0-1) */
  confidenceThreshold?: number;
  /** Enable layout analysis */
  analyzeLayout?: boolean;
}

/**
 * OCR result for an image
 */
export interface OCRResult {
  /** Original image href */
  imageHref: string;
  /** Extracted text */
  text: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Processing time in ms */
  processingTime: number;
  /** Word-level results (if available) */
  words?: OCRWord[];
  /** Error message (if failed) */
  error?: string;
}

/**
 * Individual word from OCR
 */
export interface OCRWord {
  /** The word text */
  text: string;
  /** Confidence score */
  confidence: number;
  /** Bounding box */
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// ============================================================================
// Vault Export Types
// ============================================================================

/**
 * Options for exporting assets to vault
 */
export interface VaultExportOptions {
  /** Target folder path (relative to vault root) */
  folder: string;
  /** Naming strategy for files */
  naming: NamingStrategy;
  /** Whether to create subfolders by type */
  organizeByType: boolean;
  /** Whether to overwrite existing files */
  overwrite: boolean;
  /** Include metadata in frontmatter (for markdown) */
  includeMetadata: boolean;
  /** Maximum file size to export (bytes) */
  maxFileSize?: number;
}

/**
 * Naming strategy for exported files
 */
export type NamingStrategy =
  | 'original'      // Keep original filename
  | 'sequential'    // book-001.jpg, book-002.jpg, etc.
  | 'descriptive'   // book-title-cover.jpg, book-title-chapter1-image1.jpg
  | 'hash';         // Use content hash for deduplication

/**
 * Result of exporting an asset to vault
 */
export interface VaultExportResult {
  /** Original asset href */
  href: string;
  /** Path in vault where file was saved */
  vaultPath: string;
  /** Whether file was newly created or already existed */
  created: boolean;
  /** File size in bytes */
  size: number;
  /** Error message (if failed) */
  error?: string;
}

// ============================================================================
// Extraction Options
// ============================================================================

/**
 * Options for asset extraction
 */
export interface ExtractionOptions {
  /** Media types to include */
  includeTypes?: MediaCategory[];
  /** Media types to exclude */
  excludeTypes?: MediaCategory[];
  /** Maximum number of assets to extract */
  limit?: number;
  /** Skip assets larger than this size (bytes) */
  maxAssetSize?: number;
  /** Include binary data in result (vs. just metadata) */
  includeData?: boolean;
  /** Generate thumbnails for images */
  generateThumbnails?: boolean;
  /** Thumbnail size (max dimension) */
  thumbnailSize?: number;
  /** Extract metadata (dimensions, duration, etc.) */
  extractMetadata?: boolean;
}

/**
 * Default extraction options
 */
export const DEFAULT_EXTRACTION_OPTIONS: ExtractionOptions = {
  includeTypes: ['image', 'audio', 'video', 'font'],
  excludeTypes: [],
  limit: 1000,
  maxAssetSize: 50 * 1024 * 1024, // 50MB
  includeData: true,
  generateThumbnails: true,
  thumbnailSize: 200,
  extractMetadata: true,
};

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Interface for content providers that can supply raw resources
 */
export interface ResourceProvider {
  /** Get a resource as raw bytes */
  getResource(bookId: string, href: string): Promise<Uint8Array>;
  /** Get a resource as blob URL */
  getResourceAsUrl(bookId: string, href: string): Promise<string>;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get media category from MIME type
 */
export function getMediaCategory(mimeType: string): MediaCategory {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('font/') || mimeType.includes('font')) return 'font';
  if (mimeType === 'text/css') return 'style';
  if (mimeType.includes('html') || mimeType.includes('xml')) return 'document';
  return 'other';
}

/**
 * Guess MIME type from file extension
 */
export function guessMimeType(href: string): MediaType {
  const ext = href.split('.').pop()?.toLowerCase() || '';

  const mimeMap: Record<string, MediaType> = {
    // Images
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    // Audio
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    aac: 'audio/aac',
    flac: 'audio/flac',
    // Video
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogv: 'video/ogg',
    // Fonts
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    // Styles
    css: 'text/css',
    // Documents
    xhtml: 'application/xhtml+xml',
    html: 'text/html',
    htm: 'text/html',
    xml: 'application/xml',
  };

  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Get file extension from href
 */
export function getExtension(href: string): string {
  const parts = href.split('.');
  return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
}

/**
 * Get filename from href
 */
export function getFilename(href: string): string {
  return href.split('/').pop() || href;
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
