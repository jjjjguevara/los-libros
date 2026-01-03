/**
 * Media Extractor
 *
 * Specialized extractor for audio and video content in EPUBs.
 * Handles EPUB 3 media overlays, embedded audio/video, and
 * provides playback-ready resources.
 *
 * Features:
 * - Audio extraction with metadata
 * - Video extraction with poster frames
 * - Media overlay synchronization support
 * - Playlist generation
 *
 * @see docs/specifications/file-system-architecture.md
 */

import type {
  ExtractedAsset,
  ExtractedAudio,
  ExtractedVideo,
  AudioMetadata,
  VideoMetadata,
  ResourceProvider,
  ExtractionOptions,
} from './types';
import {
  DEFAULT_EXTRACTION_OPTIONS,
  getMediaCategory,
  guessMimeType,
  getFilename,
  getExtension,
} from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Media playlist item
 */
export interface PlaylistItem {
  /** Track index */
  index: number;
  /** Media asset reference */
  href: string;
  /** Display title */
  title: string;
  /** Duration in seconds (if known) */
  duration?: number;
  /** Blob URL for playback */
  src: string;
  /** MIME type */
  mimeType: string;
}

/**
 * Media playlist
 */
export interface MediaPlaylist {
  /** Book ID */
  bookId: string;
  /** Playlist title */
  title: string;
  /** All items in playlist */
  items: PlaylistItem[];
  /** Current item index */
  currentIndex: number;
  /** Total duration in seconds (if known) */
  totalDuration?: number;
}

/**
 * SMIL media overlay reference
 */
export interface MediaOverlay {
  /** SMIL file href */
  smilHref: string;
  /** Text fragment reference */
  textRef: string;
  /** Audio file reference */
  audioRef: string;
  /** Clip begin time in seconds */
  clipBegin: number;
  /** Clip end time in seconds */
  clipEnd: number;
}

/**
 * Media extraction result with playback info
 */
export interface MediaExtractionResult<T extends ExtractedAudio | ExtractedVideo> {
  /** Extracted media asset */
  asset: T;
  /** Ready-to-use source URL */
  src: string;
  /** Whether media can be played */
  canPlay: boolean;
  /** Error if media cannot be played */
  error?: string;
}

// ============================================================================
// Media Extractor
// ============================================================================

export class MediaExtractor {
  private provider: ResourceProvider;
  private audioCache: Map<string, ExtractedAudio> = new Map();
  private videoCache: Map<string, ExtractedVideo> = new Map();
  private blobUrls: Map<string, string> = new Map();

  constructor(provider: ResourceProvider) {
    this.provider = provider;
  }

  // ==========================================================================
  // Audio Extraction
  // ==========================================================================

  /**
   * Extract a single audio file
   */
  async extractAudio(
    bookId: string,
    href: string,
    options: Partial<ExtractionOptions> = {}
  ): Promise<ExtractedAudio> {
    const cacheKey = `${bookId}:${href}`;

    // Check cache
    const cached = this.audioCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const opts = { ...DEFAULT_EXTRACTION_OPTIONS, ...options };

    // Fetch resource
    const bytes = await this.provider.getResource(bookId, href);
    const data = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;

    // Check size limit
    if (opts.maxAssetSize && data.byteLength > opts.maxAssetSize) {
      throw new Error(`Audio exceeds size limit: ${data.byteLength} > ${opts.maxAssetSize}`);
    }

    // Determine type
    const mimeType = guessMimeType(href);
    const category = getMediaCategory(mimeType);

    if (category !== 'audio') {
      throw new Error(`Resource is not audio: ${href} (${mimeType})`);
    }

    // Create blob URL
    const blob = new Blob([data], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    this.blobUrls.set(cacheKey, blobUrl);

    // Extract metadata
    const metadata = await this.extractAudioMetadata(data, href, mimeType, opts);

    const audio: ExtractedAudio = {
      bookId,
      href,
      mimeType,
      category: 'audio',
      data,
      blobUrl,
      size: data.byteLength,
      metadata,
      extractedAt: Date.now(),
    };

    // Cache
    this.audioCache.set(cacheKey, audio);

    return audio;
  }

  /**
   * Extract all audio files from a book
   */
  async extractAllAudio(
    bookId: string,
    audioHrefs: string[],
    options: Partial<ExtractionOptions> = {}
  ): Promise<ExtractedAudio[]> {
    const results: ExtractedAudio[] = [];

    for (const href of audioHrefs) {
      try {
        const audio = await this.extractAudio(bookId, href, options);
        results.push(audio);
      } catch (error) {
        console.warn(`[MediaExtractor] Failed to extract audio ${href}:`, error);
      }
    }

    return results;
  }

  /**
   * Extract audio metadata
   */
  private async extractAudioMetadata(
    data: ArrayBuffer,
    href: string,
    mimeType: string,
    options: ExtractionOptions
  ): Promise<AudioMetadata> {
    const base: AudioMetadata = {
      filename: getFilename(href),
      extension: getExtension(href),
    };

    if (!options.extractMetadata) {
      return base;
    }

    // Try to get duration using Audio element
    try {
      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const duration = await this.getAudioDuration(url);
      URL.revokeObjectURL(url);

      base.duration = duration;
    } catch (error) {
      console.warn('[MediaExtractor] Failed to extract audio duration:', error);
    }

    return base;
  }

  /**
   * Get audio duration using Audio element
   */
  private getAudioDuration(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const audio = new Audio();

      audio.onloadedmetadata = () => {
        resolve(audio.duration);
      };

      audio.onerror = () => {
        reject(new Error('Failed to load audio metadata'));
      };

      audio.src = url;
    });
  }

  // ==========================================================================
  // Video Extraction
  // ==========================================================================

  /**
   * Extract a single video file
   */
  async extractVideo(
    bookId: string,
    href: string,
    options: Partial<ExtractionOptions> = {}
  ): Promise<ExtractedVideo> {
    const cacheKey = `${bookId}:${href}`;

    // Check cache
    const cached = this.videoCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const opts = { ...DEFAULT_EXTRACTION_OPTIONS, ...options };

    // Fetch resource
    const bytes = await this.provider.getResource(bookId, href);
    const data = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;

    // Check size limit
    if (opts.maxAssetSize && data.byteLength > opts.maxAssetSize) {
      throw new Error(`Video exceeds size limit: ${data.byteLength} > ${opts.maxAssetSize}`);
    }

    // Determine type
    const mimeType = guessMimeType(href);
    const category = getMediaCategory(mimeType);

    if (category !== 'video') {
      throw new Error(`Resource is not video: ${href} (${mimeType})`);
    }

    // Create blob URL
    const blob = new Blob([data], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    this.blobUrls.set(cacheKey, blobUrl);

    // Extract metadata
    const metadata = await this.extractVideoMetadata(data, href, mimeType, opts);

    const video: ExtractedVideo = {
      bookId,
      href,
      mimeType,
      category: 'video',
      data,
      blobUrl,
      size: data.byteLength,
      metadata,
      extractedAt: Date.now(),
    };

    // Cache
    this.videoCache.set(cacheKey, video);

    return video;
  }

  /**
   * Extract all video files from a book
   */
  async extractAllVideo(
    bookId: string,
    videoHrefs: string[],
    options: Partial<ExtractionOptions> = {}
  ): Promise<ExtractedVideo[]> {
    const results: ExtractedVideo[] = [];

    for (const href of videoHrefs) {
      try {
        const video = await this.extractVideo(bookId, href, options);
        results.push(video);
      } catch (error) {
        console.warn(`[MediaExtractor] Failed to extract video ${href}:`, error);
      }
    }

    return results;
  }

  /**
   * Extract video metadata
   */
  private async extractVideoMetadata(
    data: ArrayBuffer,
    href: string,
    mimeType: string,
    options: ExtractionOptions
  ): Promise<VideoMetadata> {
    const base: VideoMetadata = {
      filename: getFilename(href),
      extension: getExtension(href),
    };

    if (!options.extractMetadata) {
      return base;
    }

    // Try to get metadata using Video element
    try {
      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const metadata = await this.getVideoMetadata(url);
      URL.revokeObjectURL(url);

      base.duration = metadata.duration;
      base.width = metadata.width;
      base.height = metadata.height;
    } catch (error) {
      console.warn('[MediaExtractor] Failed to extract video metadata:', error);
    }

    return base;
  }

  /**
   * Get video metadata using Video element
   */
  private getVideoMetadata(
    url: string
  ): Promise<{ duration: number; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');

      video.onloadedmetadata = () => {
        resolve({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        });
      };

      video.onerror = () => {
        reject(new Error('Failed to load video metadata'));
      };

      video.src = url;
    });
  }

  /**
   * Generate a poster frame from video
   */
  async generatePosterFrame(
    bookId: string,
    videoHref: string,
    timeOffset: number = 0
  ): Promise<string> {
    const video = await this.extractVideo(bookId, videoHref);

    return new Promise((resolve, reject) => {
      const videoEl = document.createElement('video');
      videoEl.crossOrigin = 'anonymous';

      videoEl.onloadeddata = () => {
        videoEl.currentTime = timeOffset;
      };

      videoEl.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = videoEl.videoWidth;
          canvas.height = videoEl.videoHeight;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

          canvas.toBlob(
            (blob) => {
              if (blob) {
                const posterUrl = URL.createObjectURL(blob);
                resolve(posterUrl);
              } else {
                reject(new Error('Failed to create poster blob'));
              }
            },
            'image/jpeg',
            0.8
          );
        } catch (error) {
          reject(error);
        }
      };

      videoEl.onerror = () => {
        reject(new Error('Failed to load video for poster generation'));
      };

      videoEl.src = video.blobUrl;
    });
  }

  // ==========================================================================
  // Playlist Generation
  // ==========================================================================

  /**
   * Build an audio playlist from extracted audio files
   */
  async buildAudioPlaylist(
    bookId: string,
    title: string,
    audioHrefs: string[]
  ): Promise<MediaPlaylist> {
    const items: PlaylistItem[] = [];
    let totalDuration = 0;

    for (let i = 0; i < audioHrefs.length; i++) {
      const href = audioHrefs[i];

      try {
        const audio = await this.extractAudio(bookId, href);

        items.push({
          index: i,
          href,
          title: audio.metadata.title || audio.metadata.filename,
          duration: audio.metadata.duration,
          src: audio.blobUrl,
          mimeType: audio.mimeType,
        });

        if (audio.metadata.duration) {
          totalDuration += audio.metadata.duration;
        }
      } catch (error) {
        console.warn(`[MediaExtractor] Skipping audio ${href}:`, error);
      }
    }

    return {
      bookId,
      title,
      items,
      currentIndex: 0,
      totalDuration: totalDuration > 0 ? totalDuration : undefined,
    };
  }

  // ==========================================================================
  // Media Overlay Support
  // ==========================================================================

  /**
   * Parse SMIL media overlay file
   * Note: This is a simplified parser; full SMIL parsing would be more complex
   */
  async parseMediaOverlay(
    bookId: string,
    smilHref: string
  ): Promise<MediaOverlay[]> {
    const overlays: MediaOverlay[] = [];

    try {
      const bytes = await this.provider.getResource(bookId, smilHref);
      const text = new TextDecoder().decode(bytes);

      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'application/xml');

      // Find all par elements (parallel containers with text + audio sync)
      const parElements = doc.querySelectorAll('par');

      for (const par of parElements) {
        const textEl = par.querySelector('text');
        const audioEl = par.querySelector('audio');

        if (textEl && audioEl) {
          const textSrc = textEl.getAttribute('src') || '';
          const audioSrc = audioEl.getAttribute('src') || '';
          const clipBegin = this.parseClockValue(audioEl.getAttribute('clipBegin') || '0');
          const clipEnd = this.parseClockValue(audioEl.getAttribute('clipEnd') || '0');

          overlays.push({
            smilHref,
            textRef: textSrc,
            audioRef: audioSrc,
            clipBegin,
            clipEnd,
          });
        }
      }
    } catch (error) {
      console.warn(`[MediaExtractor] Failed to parse media overlay ${smilHref}:`, error);
    }

    return overlays;
  }

  /**
   * Parse SMIL clock value (e.g., "00:01:23.456" or "1.5s") to seconds
   */
  private parseClockValue(value: string): number {
    if (!value) return 0;

    // Handle seconds format (e.g., "1.5s")
    if (value.endsWith('s')) {
      return parseFloat(value.slice(0, -1)) || 0;
    }

    // Handle milliseconds format (e.g., "1500ms")
    if (value.endsWith('ms')) {
      return (parseFloat(value.slice(0, -2)) || 0) / 1000;
    }

    // Handle clock format (e.g., "00:01:23.456")
    const parts = value.split(':').map(parseFloat);

    if (parts.length === 3) {
      // HH:MM:SS.sss
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      // MM:SS.sss
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 1) {
      // SS.sss
      return parts[0];
    }

    return 0;
  }

  // ==========================================================================
  // Playback Helpers
  // ==========================================================================

  /**
   * Check if a media type can be played by the browser
   */
  canPlayType(mimeType: string): boolean {
    // Check audio
    const audio = new Audio();
    if (audio.canPlayType(mimeType)) {
      return true;
    }

    // Check video
    const video = document.createElement('video');
    if (video.canPlayType(mimeType)) {
      return true;
    }

    return false;
  }

  /**
   * Get media for playback with can-play check
   */
  async getAudioForPlayback(
    bookId: string,
    href: string
  ): Promise<MediaExtractionResult<ExtractedAudio>> {
    try {
      const audio = await this.extractAudio(bookId, href);
      const canPlay = this.canPlayType(audio.mimeType);

      return {
        asset: audio,
        src: audio.blobUrl,
        canPlay,
        error: canPlay ? undefined : `Browser cannot play ${audio.mimeType}`,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get video for playback with can-play check
   */
  async getVideoForPlayback(
    bookId: string,
    href: string
  ): Promise<MediaExtractionResult<ExtractedVideo>> {
    try {
      const video = await this.extractVideo(bookId, href);
      const canPlay = this.canPlayType(video.mimeType);

      return {
        asset: video,
        src: video.blobUrl,
        canPlay,
        error: canPlay ? undefined : `Browser cannot play ${video.mimeType}`,
      };
    } catch (error) {
      throw error;
    }
  }

  // ==========================================================================
  // Resource Management
  // ==========================================================================

  /**
   * Release resources for a book
   */
  releaseBook(bookId: string): void {
    // Clear audio cache
    for (const [key, audio] of this.audioCache.entries()) {
      if (key.startsWith(`${bookId}:`)) {
        URL.revokeObjectURL(audio.blobUrl);
        this.audioCache.delete(key);
      }
    }

    // Clear video cache
    for (const [key, video] of this.videoCache.entries()) {
      if (key.startsWith(`${bookId}:`)) {
        URL.revokeObjectURL(video.blobUrl);
        this.videoCache.delete(key);
      }
    }

    // Clear blob URLs
    for (const [key, url] of this.blobUrls.entries()) {
      if (key.startsWith(`${bookId}:`)) {
        URL.revokeObjectURL(url);
        this.blobUrls.delete(key);
      }
    }
  }

  /**
   * Destroy the extractor and release all resources
   */
  destroy(): void {
    // Revoke all blob URLs
    for (const audio of this.audioCache.values()) {
      URL.revokeObjectURL(audio.blobUrl);
    }
    for (const video of this.videoCache.values()) {
      URL.revokeObjectURL(video.blobUrl);
    }
    for (const url of this.blobUrls.values()) {
      URL.revokeObjectURL(url);
    }

    this.audioCache.clear();
    this.videoCache.clear();
    this.blobUrls.clear();
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a media extractor
 */
export function createMediaExtractor(provider: ResourceProvider): MediaExtractor {
  return new MediaExtractor(provider);
}
