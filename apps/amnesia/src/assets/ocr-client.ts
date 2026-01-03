/**
 * OCR Client Interface
 *
 * Provides an interface for sending images to OCR services.
 * Supports multiple OCR backends through a unified API.
 *
 * Features:
 * - Plugin-based OCR provider registration
 * - Batch processing with progress
 * - Result caching
 * - Language detection hints
 *
 * @see docs/specifications/file-system-architecture.md
 */

import type {
  ExtractedImage,
  OCRRequest,
  OCRResult,
  OCROptions,
  OCRWord,
} from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * OCR Provider interface
 * Implement this to add support for different OCR backends
 */
export interface OCRProvider {
  /** Provider name */
  readonly name: string;
  /** Whether the provider is available */
  isAvailable(): Promise<boolean>;
  /** Process a single image */
  processImage(request: OCRRequest): Promise<OCRResult>;
  /** Process multiple images (optional batch optimization) */
  processBatch?(requests: OCRRequest[]): Promise<OCRResult[]>;
  /** Supported languages */
  getSupportedLanguages?(): string[];
}

/**
 * OCR client configuration
 */
export interface OCRClientConfig {
  /** Default OCR options */
  defaultOptions: OCROptions;
  /** Maximum batch size */
  maxBatchSize: number;
  /** Enable result caching */
  enableCache: boolean;
  /** Cache TTL in milliseconds */
  cacheTTL: number;
  /** Concurrent request limit */
  concurrency: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_OCR_OPTIONS: OCROptions = {
  preprocess: true,
  outputFormat: 'text',
  confidenceThreshold: 0.5,
  analyzeLayout: false,
};

export const DEFAULT_OCR_CONFIG: OCRClientConfig = {
  defaultOptions: DEFAULT_OCR_OPTIONS,
  maxBatchSize: 10,
  enableCache: true,
  cacheTTL: 3600000, // 1 hour
  concurrency: 3,
};

// ============================================================================
// Result Cache
// ============================================================================

interface CachedResult {
  result: OCRResult;
  timestamp: number;
}

class OCRResultCache {
  private cache: Map<string, CachedResult> = new Map();
  private ttl: number;

  constructor(ttl: number) {
    this.ttl = ttl;
  }

  private key(bookId: string, href: string): string {
    return `${bookId}:${href}`;
  }

  get(bookId: string, href: string): OCRResult | null {
    const key = this.key(bookId, href);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if expired
    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return cached.result;
  }

  set(bookId: string, href: string, result: OCRResult): void {
    const key = this.key(bookId, href);
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

// ============================================================================
// OCR Client
// ============================================================================

export class OCRClient {
  private providers: Map<string, OCRProvider> = new Map();
  private defaultProvider: string | null = null;
  private config: OCRClientConfig;
  private cache: OCRResultCache;

  constructor(config: Partial<OCRClientConfig> = {}) {
    this.config = { ...DEFAULT_OCR_CONFIG, ...config };
    this.cache = new OCRResultCache(this.config.cacheTTL);
  }

  // ==========================================================================
  // Provider Management
  // ==========================================================================

  /**
   * Register an OCR provider
   */
  registerProvider(provider: OCRProvider, setAsDefault = false): void {
    this.providers.set(provider.name, provider);

    if (setAsDefault || this.defaultProvider === null) {
      this.defaultProvider = provider.name;
    }
  }

  /**
   * Get a provider by name
   */
  getProvider(name: string): OCRProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Set the default provider
   */
  setDefaultProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Unknown OCR provider: ${name}`);
    }
    this.defaultProvider = name;
  }

  /**
   * Get available providers
   */
  async getAvailableProviders(): Promise<string[]> {
    const available: string[] = [];

    for (const [name, provider] of this.providers) {
      if (await provider.isAvailable()) {
        available.push(name);
      }
    }

    return available;
  }

  // ==========================================================================
  // Single Image OCR
  // ==========================================================================

  /**
   * Process a single image with OCR
   */
  async processImage(
    image: ExtractedImage,
    options?: Partial<OCROptions>,
    providerName?: string
  ): Promise<OCRResult> {
    const startTime = performance.now();

    // Check cache first
    if (this.config.enableCache) {
      const cached = this.cache.get(image.bookId, image.href);
      if (cached) {
        return cached;
      }
    }

    // Get provider
    const provider = this.getActiveProvider(providerName);
    if (!provider) {
      return {
        imageHref: image.href,
        text: '',
        confidence: 0,
        processingTime: 0,
        error: 'No OCR provider available',
      };
    }

    // Build request
    const request: OCRRequest = {
      image,
      options: { ...this.config.defaultOptions, ...options },
    };

    try {
      const result = await provider.processImage(request);
      result.processingTime = performance.now() - startTime;

      // Cache result
      if (this.config.enableCache && !result.error) {
        this.cache.set(image.bookId, image.href, result);
      }

      return result;
    } catch (error) {
      return {
        imageHref: image.href,
        text: '',
        confidence: 0,
        processingTime: performance.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Batch OCR
  // ==========================================================================

  /**
   * Process multiple images with OCR
   */
  async processBatch(
    images: ExtractedImage[],
    options?: Partial<OCROptions>,
    providerName?: string,
    onProgress?: (current: number, total: number, result: OCRResult) => void
  ): Promise<OCRResult[]> {
    const results: OCRResult[] = [];
    const provider = this.getActiveProvider(providerName);

    if (!provider) {
      return images.map(img => ({
        imageHref: img.href,
        text: '',
        confidence: 0,
        processingTime: 0,
        error: 'No OCR provider available',
      }));
    }

    // Check if provider supports batch processing
    if (provider.processBatch && images.length > 1) {
      // Split into batches
      for (let i = 0; i < images.length; i += this.config.maxBatchSize) {
        const batch = images.slice(i, i + this.config.maxBatchSize);
        const requests = batch.map(image => ({
          image,
          options: { ...this.config.defaultOptions, ...options },
        }));

        try {
          const batchResults = await provider.processBatch(requests);
          results.push(...batchResults);

          if (onProgress) {
            for (let j = 0; j < batchResults.length; j++) {
              onProgress(i + j + 1, images.length, batchResults[j]);
            }
          }
        } catch (error) {
          // Fall back to individual processing on batch failure
          for (const image of batch) {
            const result = await this.processImage(image, options, providerName);
            results.push(result);

            if (onProgress) {
              onProgress(results.length, images.length, result);
            }
          }
        }
      }
    } else {
      // Process individually with concurrency control
      const semaphore = new Semaphore(this.config.concurrency);

      const promises = images.map(async (image, index) => {
        await semaphore.acquire();
        try {
          const result = await this.processImage(image, options, providerName);

          if (onProgress) {
            onProgress(index + 1, images.length, result);
          }

          return result;
        } finally {
          semaphore.release();
        }
      });

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);
    }

    return results;
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Get the active provider
   */
  private getActiveProvider(name?: string): OCRProvider | null {
    const providerName = name || this.defaultProvider;
    if (!providerName) {
      return null;
    }
    return this.providers.get(providerName) || null;
  }

  /**
   * Clear the result cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get supported languages from the default provider
   */
  getSupportedLanguages(providerName?: string): string[] {
    const provider = this.getActiveProvider(providerName);
    if (!provider || !provider.getSupportedLanguages) {
      return [];
    }
    return provider.getSupportedLanguages();
  }
}

// ============================================================================
// Semaphore for Concurrency Control
// ============================================================================

class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>(resolve => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      if (next) {
        next();
      }
    } else {
      this.permits++;
    }
  }
}

// ============================================================================
// Mock Provider (for testing/development)
// ============================================================================

/**
 * Mock OCR provider for testing
 * Returns placeholder text based on image metadata
 */
export class MockOCRProvider implements OCRProvider {
  readonly name = 'mock';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async processImage(request: OCRRequest): Promise<OCRResult> {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

    const { image } = request;
    const mockText = `[Mock OCR output for ${image.metadata.filename}]`;

    return {
      imageHref: image.href,
      text: mockText,
      confidence: 0.85 + Math.random() * 0.1,
      processingTime: 150,
      words: [
        { text: 'Mock', confidence: 0.9 },
        { text: 'OCR', confidence: 0.95 },
        { text: 'output', confidence: 0.88 },
      ],
    };
  }

  getSupportedLanguages(): string[] {
    return ['eng', 'fra', 'deu', 'spa', 'ita'];
  }
}

// ============================================================================
// Factory
// ============================================================================

let clientInstance: OCRClient | null = null;

/**
 * Get or create the OCR client singleton
 */
export function getOCRClient(config?: Partial<OCRClientConfig>): OCRClient {
  if (!clientInstance) {
    clientInstance = new OCRClient(config);
    // Register mock provider by default for development
    clientInstance.registerProvider(new MockOCRProvider(), true);
  }
  return clientInstance;
}

/**
 * Create a new OCR client instance
 */
export function createOCRClient(config?: Partial<OCRClientConfig>): OCRClient {
  return new OCRClient(config);
}
