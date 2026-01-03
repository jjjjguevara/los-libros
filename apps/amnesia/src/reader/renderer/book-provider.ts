/**
 * Book Provider Interface
 *
 * Abstraction layer for book content delivery.
 * Allows switching between server API and local WASM processing.
 */

import type {
  ParsedBook,
  ChapterContent,
} from './types';

/**
 * Interface for book content providers
 */
export interface BookProvider {
  /** Provider name for debugging */
  readonly name: string;

  /** Check if provider is available */
  isAvailable(): Promise<boolean>;

  /**
   * Load a book from raw bytes
   * @param data EPUB file as ArrayBuffer
   * @param filename Optional filename
   */
  loadBook(data: ArrayBuffer, filename?: string): Promise<ParsedBook>;

  /**
   * Load a book by ID (for providers that support persistent storage)
   */
  loadBookById?(bookId: string): Promise<ParsedBook>;

  /**
   * Get chapter content
   */
  getChapter(bookId: string, href: string): Promise<ChapterContent>;

  /**
   * Get a resource (image, CSS, font)
   */
  getResource(bookId: string, href: string): Promise<Uint8Array>;

  /**
   * Get resource as Blob URL for embedding in HTML
   */
  getResourceAsUrl(bookId: string, href: string): Promise<string>;

  /**
   * Unload a book to free resources
   */
  unloadBook?(bookId: string): void;

  /**
   * Search book content (optional)
   */
  search?(bookId: string, query: string, limit?: number): Promise<SearchResult[]>;
}

/**
 * Search result from provider
 */
export interface SearchResult {
  href: string;
  spineIndex: number;
  cfi: string;
  excerpt: string;
  position: number;
}

/**
 * Provider availability status
 */
export interface ProviderStatus {
  server: boolean;
  wasm: boolean;
  active: 'server' | 'wasm' | 'none';
}
