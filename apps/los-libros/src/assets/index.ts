/**
 * Asset Extraction Module
 *
 * Unified API for extracting and managing resources from EPUB files.
 * Supports images, audio, video, fonts, and other media types.
 *
 * @module assets
 * @see docs/specifications/file-system-architecture.md
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Media Types
  MediaCategory,
  MediaType,
  // Asset Types
  ExtractedAsset,
  ExtractedImage,
  ExtractedAudio,
  ExtractedVideo,
  ExtractedFont,
  AssetMetadata,
  ImageMetadata,
  AudioMetadata,
  VideoMetadata,
  FontMetadata,
  ImageRole,
  // Lightbox Types
  LightboxImage,
  LightboxGallery,
  // OCR Types
  OCRRequest,
  OCRResult,
  OCROptions,
  OCRWord,
  // Vault Export Types
  VaultExportOptions,
  VaultExportResult,
  NamingStrategy,
  // Extraction Options
  ExtractionOptions,
  // Provider Interface
  ResourceProvider,
} from './types';

export {
  // Default Options
  DEFAULT_EXTRACTION_OPTIONS,
  // Utility Functions
  getMediaCategory,
  guessMimeType,
  getExtension,
  getFilename,
  formatFileSize,
} from './types';

// ============================================================================
// Asset Extractor
// ============================================================================

export {
  AssetExtractor,
  getAssetExtractor,
  createAssetExtractor,
} from './asset-extractor';

// ============================================================================
// Image Extractor
// ============================================================================

export type {
  ImageFilterOptions,
  GalleryOptions,
} from './image-extractor';

export {
  ImageExtractor,
  createImageExtractor,
} from './image-extractor';

// ============================================================================
// Media Extractor
// ============================================================================

export type {
  PlaylistItem,
  MediaPlaylist,
  MediaOverlay,
  MediaExtractionResult,
} from './media-extractor';

export {
  MediaExtractor,
  createMediaExtractor,
} from './media-extractor';

// ============================================================================
// Vault Exporter
// ============================================================================

export {
  VaultExporter,
  createVaultExporter,
  DEFAULT_EXPORT_OPTIONS,
} from './vault-exporter';

// ============================================================================
// OCR Client
// ============================================================================

export type {
  OCRProvider,
  OCRClientConfig,
} from './ocr-client';

export {
  OCRClient,
  MockOCRProvider,
  getOCRClient,
  createOCRClient,
  DEFAULT_OCR_OPTIONS,
  DEFAULT_OCR_CONFIG,
} from './ocr-client';

// ============================================================================
// Lightbox Adapter
// ============================================================================

export type {
  LightboxState,
  NavigationDirection,
  LightboxEvents,
  LightboxEventListener,
} from './lightbox-adapter';

export {
  LightboxAdapter,
  createLightboxAdapter,
} from './lightbox-adapter';

// ============================================================================
// Cover Extractor
// ============================================================================

export type {
  BookCover,
  CoverExtractionOptions,
} from './cover-extractor';

export {
  CoverExtractor,
  createCoverExtractor,
  DEFAULT_COVER_OPTIONS,
} from './cover-extractor';
