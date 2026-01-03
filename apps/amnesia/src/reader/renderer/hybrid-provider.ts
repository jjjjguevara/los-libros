/**
 * Hybrid Book Provider
 *
 * Combines server API and WASM for flexible book loading:
 * - Uses server when enabled and available
 * - Falls back to WASM for offline reading
 * - Can be configured to prefer WASM or server
 */

import type { ParsedBook, ChapterContent } from './types';
import type { BookProvider, SearchResult, ProviderStatus } from './book-provider';
import { ApiClient } from './api-client';
import { WasmBookProvider } from './wasm-provider';

export type ProviderMode = 'server' | 'wasm' | 'auto';

export interface HybridProviderConfig {
  /** Server URL (required for server mode) */
  serverUrl?: string;
  /** Device ID for server sync */
  deviceId: string;
  /** Which provider to use: 'server', 'wasm', or 'auto' (tries server, falls back to wasm) */
  mode: ProviderMode;
  /** Callback when provider status changes */
  onStatusChange?: (status: ProviderStatus) => void;
  /** WASM source (path, URL, or bytes) for offline mode */
  wasmSource?: string | ArrayBuffer;
}

/**
 * Hybrid provider that combines server and WASM capabilities
 */
export class HybridBookProvider implements BookProvider {
  readonly name = 'hybrid';

  private serverProvider: ApiClient | null = null;
  private wasmProvider: WasmBookProvider;
  private activeProvider: 'server' | 'wasm' | 'none' = 'none';
  private config: HybridProviderConfig;

  // Track which provider was used to load each book
  private bookProviders: Map<string, 'server' | 'wasm'> = new Map();

  constructor(config: HybridProviderConfig) {
    this.config = config;
    this.wasmProvider = new WasmBookProvider();

    // Set WASM source if provided
    if (config.wasmSource) {
      this.wasmProvider.setWasmSource(config.wasmSource);
    }

    if (config.serverUrl && config.mode !== 'wasm') {
      this.serverProvider = new ApiClient({
        baseUrl: config.serverUrl,
        deviceId: config.deviceId,
      });
    }
  }

  /**
   * Check if any provider is available
   */
  async isAvailable(): Promise<boolean> {
    const status = await this.getStatus();
    return status.active !== 'none';
  }

  /**
   * Get current provider status
   */
  async getStatus(): Promise<ProviderStatus> {
    let serverAvailable = false;
    let wasmAvailable = false;

    // Check server if configured
    if (this.serverProvider && this.config.mode !== 'wasm') {
      try {
        serverAvailable = await this.serverProvider.healthCheck();
      } catch {
        serverAvailable = false;
      }
    }

    // Check WASM
    if (this.config.mode !== 'server') {
      wasmAvailable = await this.wasmProvider.isAvailable();
    }

    // Determine active provider based on mode and availability
    let active: 'server' | 'wasm' | 'none' = 'none';

    if (this.config.mode === 'server') {
      active = serverAvailable ? 'server' : 'none';
    } else if (this.config.mode === 'wasm') {
      active = wasmAvailable ? 'wasm' : 'none';
    } else {
      // Auto mode: prefer server, fallback to wasm
      if (serverAvailable) {
        active = 'server';
      } else if (wasmAvailable) {
        active = 'wasm';
      }
    }

    this.activeProvider = active;

    const status = { server: serverAvailable, wasm: wasmAvailable, active };
    this.config.onStatusChange?.(status);
    return status;
  }

  /**
   * Load a book from raw bytes
   */
  async loadBook(data: ArrayBuffer, filename?: string): Promise<ParsedBook> {
    const status = await this.getStatus();

    if (status.active === 'server' && this.serverProvider) {
      console.log('[HybridProvider] Loading book via server');
      const book = await this.serverProvider.uploadBook(data, filename);
      this.bookProviders.set(book.id, 'server');
      return book;
    }

    if (status.active === 'wasm') {
      console.log('[HybridProvider] Loading book via WASM');
      const book = await this.wasmProvider.loadBook(data, filename);
      this.bookProviders.set(book.id, 'wasm');
      return book;
    }

    throw new Error('No provider available. Enable server connection or ensure WASM is supported.');
  }

  /**
   * Load a book by ID (server only)
   */
  async loadBookById(bookId: string): Promise<ParsedBook> {
    if (!this.serverProvider) {
      throw new Error('Server provider not configured');
    }

    const book = await this.serverProvider.getBook(bookId);
    this.bookProviders.set(book.id, 'server');
    return book;
  }

  /**
   * Get chapter content
   */
  async getChapter(bookId: string, href: string): Promise<ChapterContent> {
    const provider = this.bookProviders.get(bookId);

    if (provider === 'server' && this.serverProvider) {
      return this.serverProvider.getChapter(bookId, href);
    }

    if (provider === 'wasm') {
      return this.wasmProvider.getChapter(bookId, href);
    }

    // Try to determine provider from current status
    const status = await this.getStatus();
    if (status.active === 'server' && this.serverProvider) {
      return this.serverProvider.getChapter(bookId, href);
    }
    if (status.active === 'wasm') {
      return this.wasmProvider.getChapter(bookId, href);
    }

    throw new Error('No provider available for book');
  }

  /**
   * Get a resource
   */
  async getResource(bookId: string, href: string): Promise<Uint8Array> {
    const provider = this.bookProviders.get(bookId);

    if (provider === 'server' && this.serverProvider) {
      const blob = await this.serverProvider.getResource(bookId, href);
      return new Uint8Array(await blob.arrayBuffer());
    }

    if (provider === 'wasm') {
      return this.wasmProvider.getResource(bookId, href);
    }

    throw new Error('No provider available for book');
  }

  /**
   * Get resource as URL
   */
  async getResourceAsUrl(bookId: string, href: string): Promise<string> {
    const provider = this.bookProviders.get(bookId);

    if (provider === 'server' && this.serverProvider) {
      return this.serverProvider.getResourceAsDataUrl(bookId, href);
    }

    if (provider === 'wasm') {
      return this.wasmProvider.getResourceAsUrl(bookId, href);
    }

    throw new Error('No provider available for book');
  }

  /**
   * Unload a book
   */
  unloadBook(bookId: string): void {
    const provider = this.bookProviders.get(bookId);

    if (provider === 'wasm') {
      this.wasmProvider.unloadBook(bookId);
    }

    // Server doesn't need explicit unload
    this.bookProviders.delete(bookId);
  }

  /**
   * Search book content (WASM only currently)
   */
  async search(bookId: string, query: string, limit = 50): Promise<SearchResult[]> {
    const provider = this.bookProviders.get(bookId);

    if (provider === 'wasm') {
      return this.wasmProvider.search(bookId, query, limit);
    }

    // Server search could be implemented here
    throw new Error('Search not available for this book');
  }

  /**
   * Get the underlying server API client (for sync operations)
   */
  getServerClient(): ApiClient | null {
    return this.serverProvider;
  }

  /**
   * Update server configuration
   */
  updateServerConfig(serverUrl: string): void {
    if (serverUrl) {
      this.serverProvider = new ApiClient({
        baseUrl: serverUrl,
        deviceId: this.config.deviceId,
      });
    } else {
      this.serverProvider = null;
    }
  }

  /**
   * Update provider mode
   */
  updateMode(mode: ProviderMode): void {
    this.config.mode = mode;
    // Re-evaluate status
    this.getStatus();
  }

  /**
   * Get current active provider
   */
  getActiveProvider(): 'server' | 'wasm' | 'none' {
    return this.activeProvider;
  }
}

/**
 * Create a hybrid provider with settings-based configuration
 */
export function createHybridProvider(config: HybridProviderConfig): HybridBookProvider {
  return new HybridBookProvider(config);
}
