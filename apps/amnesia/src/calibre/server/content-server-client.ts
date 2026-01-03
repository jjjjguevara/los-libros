/**
 * ContentServerClient
 *
 * HTTP client for Calibre Content Server API.
 * Used as fallback when local database is unavailable.
 *
 * Calibre Content Server API endpoints:
 * - GET /ajax/library-info - Library metadata
 * - GET /ajax/books/{library_id}?ids=... - Book metadata
 * - GET /ajax/book/{book_id}/{library_id} - Single book details
 * - GET /get/{format}/{book_id}/{library_id} - Download book file
 * - GET /get/cover/{book_id}/{library_id} - Get cover image
 */

import { requestUrl } from 'obsidian';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import type {
  CalibreBookFull,
  CalibreAuthor,
  CalibreSeries,
  CalibreTag,
  CalibrePublisher,
  CalibreLanguage,
  CalibreFormat,
} from '../calibre-types';

/**
 * Content Server library info response
 */
interface LibraryInfo {
  library_map: Record<string, string>; // id -> name
  default_library: string;
}

/**
 * Content Server book metadata response
 */
interface ServerBookMetadata {
  title: string;
  authors: string[];
  author_sort: string;
  series: string | null;
  series_index: number | null;
  rating: number | null;
  tags: string[];
  publisher: string | null;
  pubdate: string | null;
  timestamp: string;
  last_modified: string;
  languages: string[];
  identifiers: Record<string, string>;
  uuid: string;
  comments: string | null;
  formats: string[];
  cover: string | null; // URL to cover
  format_metadata: Record<string, { path: string; size: number }>;
}

/**
 * Content Server books list response
 */
interface BooksListResponse {
  total_num: number;
  sort_order: string;
  library_id: string;
  offset: number;
  num: number;
  book_ids: number[];
}

/**
 * Client for Calibre Content Server API
 */
export class ContentServerClient {
  private baseUrl: string;
  private username?: string;
  private password?: string;
  private libraryId: string | null = null;
  private connected = false;

  constructor(
    baseUrl: string,
    options?: { username?: string; password?: string }
  ) {
    // Normalize URL (remove trailing slash)
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.username = options?.username;
    this.password = options?.password;
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the current library ID
   */
  getLibraryId(): string | null {
    return this.libraryId;
  }

  /**
   * Connect to the content server and verify it's accessible
   */
  async connect(): Promise<void> {
    try {
      const info = await this.getLibraryInfo();
      this.libraryId = info.default_library;
      this.connected = true;
      console.log('Connected to Calibre Content Server:', this.baseUrl);
    } catch (error) {
      this.connected = false;
      throw new Error(
        `Failed to connect to Calibre Content Server: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.connected = false;
    this.libraryId = null;
  }

  /**
   * Make an authenticated request
   */
  private async request<T>(
    path: string,
    options?: Partial<RequestUrlParam>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options?.headers,
    };

    // Add basic auth if credentials provided
    if (this.username && this.password) {
      const credentials = btoa(`${this.username}:${this.password}`);
      headers['Authorization'] = `Basic ${credentials}`;
    }

    try {
      const response: RequestUrlResponse = await requestUrl({
        url,
        headers,
        method: options?.method || 'GET',
        body: options?.body,
        throw: false,
      });

      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.text}`);
      }

      return response.json as T;
    } catch (error) {
      throw new Error(
        `Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get library information
   */
  async getLibraryInfo(): Promise<LibraryInfo> {
    return this.request<LibraryInfo>('/ajax/library-info');
  }

  /**
   * Get list of all book IDs in library
   */
  async getBookIds(
    libraryId?: string,
    options?: { offset?: number; num?: number; sort?: string }
  ): Promise<BooksListResponse> {
    const lib = libraryId || this.libraryId || '';
    const params = new URLSearchParams();

    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.num !== undefined) {
      params.set('num', String(options.num));
    }
    if (options?.sort) {
      params.set('sort', options.sort);
    }

    const query = params.toString();
    return this.request<BooksListResponse>(
      `/ajax/books/${lib}${query ? '?' + query : ''}`
    );
  }

  /**
   * Get metadata for specific books
   */
  async getBooksMetadata(
    bookIds: number[],
    libraryId?: string
  ): Promise<Record<string, ServerBookMetadata>> {
    const lib = libraryId || this.libraryId || '';
    const idsParam = bookIds.join(',');
    return this.request<Record<string, ServerBookMetadata>>(
      `/ajax/books/${lib}?ids=${idsParam}`
    );
  }

  /**
   * Get metadata for a single book
   */
  async getBookMetadata(
    bookId: number,
    libraryId?: string
  ): Promise<ServerBookMetadata> {
    const lib = libraryId || this.libraryId || '';
    return this.request<ServerBookMetadata>(`/ajax/book/${bookId}/${lib}`);
  }

  /**
   * Get all books from the server
   */
  async getAllBooks(libraryId?: string): Promise<CalibreBookFull[]> {
    const lib = libraryId || this.libraryId || '';

    // First get all book IDs
    const listResponse = await this.getBookIds(lib, { num: 100000 });

    if (listResponse.book_ids.length === 0) {
      return [];
    }

    // Fetch metadata in batches of 50
    const batchSize = 50;
    const books: CalibreBookFull[] = [];

    for (let i = 0; i < listResponse.book_ids.length; i += batchSize) {
      const batchIds = listResponse.book_ids.slice(i, i + batchSize);
      const metadata = await this.getBooksMetadata(batchIds, lib);

      for (const [idStr, meta] of Object.entries(metadata)) {
        const bookId = parseInt(idStr, 10);
        books.push(this.convertToBookFull(bookId, meta, lib));
      }
    }

    return books;
  }

  /**
   * Convert server metadata to CalibreBookFull
   */
  private convertToBookFull(
    id: number,
    meta: ServerBookMetadata,
    libraryId: string
  ): CalibreBookFull {
    // Build authors
    const authors: CalibreAuthor[] = meta.authors.map((name, index) => ({
      id: index + 1, // Fake ID since server doesn't provide it
      name,
      sort: name.split(' ').reverse().join(', '),
      link: '',
    }));

    // Build series
    const series: CalibreSeries | null = meta.series
      ? {
          id: 1, // Fake ID
          name: meta.series,
          sort: meta.series,
        }
      : null;

    // Build tags
    const tags: CalibreTag[] = meta.tags.map((name, index) => ({
      id: index + 1,
      name,
    }));

    // Build publisher
    const publisher: CalibrePublisher | null = meta.publisher
      ? {
          id: 1,
          name: meta.publisher,
          sort: meta.publisher,
        }
      : null;

    // Build languages
    const languages: CalibreLanguage[] = meta.languages.map((code, index) => ({
      id: index + 1,
      lang_code: code,
    }));

    // Build formats
    const formats: CalibreFormat[] = meta.formats.map((format, index) => ({
      id: index + 1,
      book: id,
      format,
      uncompressed_size: meta.format_metadata?.[format]?.size || 0,
      name: meta.title,
    }));

    // Find EPUB path
    const epubMeta = meta.format_metadata?.['EPUB'];
    const epubPath = epubMeta?.path || '';

    // Build cover URL
    const coverUrl = meta.cover
      ? `${this.baseUrl}/get/cover/${id}/${libraryId}`
      : null;

    return {
      id,
      uuid: meta.uuid,
      title: meta.title,
      titleSort: meta.title, // Server doesn't provide sort
      path: '', // Not available via content server
      hasCover: !!meta.cover,
      addedAt: new Date(meta.timestamp),
      lastModified: new Date(meta.last_modified),
      authors,
      series,
      seriesIndex: meta.series_index ?? null,
      tags,
      publisher,
      languages,
      formats,
      identifiers: meta.identifiers,
      rating: meta.rating ?? null,
      description: meta.comments ?? null,
      pubdate: meta.pubdate ? new Date(meta.pubdate) : null,
      coverPath: coverUrl,
      calibrePath: '', // Not available via content server
      epubPath: epubPath || `${this.baseUrl}/get/EPUB/${id}/${libraryId}`,
    };
  }

  /**
   * Download book file (EPUB)
   */
  async downloadBook(
    bookId: number,
    format: string = 'EPUB',
    libraryId?: string
  ): Promise<ArrayBuffer> {
    const lib = libraryId || this.libraryId || '';
    const url = `${this.baseUrl}/get/${format}/${bookId}/${lib}`;

    const headers: Record<string, string> = {};

    // Add basic auth if credentials provided
    if (this.username && this.password) {
      const credentials = btoa(`${this.username}:${this.password}`);
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const response = await requestUrl({
      url,
      headers,
      method: 'GET',
    });

    return response.arrayBuffer;
  }

  /**
   * Download book cover
   */
  async downloadCover(
    bookId: number,
    libraryId?: string
  ): Promise<ArrayBuffer> {
    const lib = libraryId || this.libraryId || '';
    const url = `${this.baseUrl}/get/cover/${bookId}/${lib}`;

    const headers: Record<string, string> = {};

    // Add basic auth if credentials provided
    if (this.username && this.password) {
      const credentials = btoa(`${this.username}:${this.password}`);
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const response = await requestUrl({
      url,
      headers,
      method: 'GET',
    });

    return response.arrayBuffer;
  }

  /**
   * Search for books
   */
  async searchBooks(
    query: string,
    libraryId?: string
  ): Promise<CalibreBookFull[]> {
    const lib = libraryId || this.libraryId || '';

    // Calibre Content Server search syntax
    const params = new URLSearchParams({
      search: query,
      num: '100',
    });

    const response = await this.request<BooksListResponse>(
      `/ajax/books/${lib}?${params.toString()}`
    );

    if (response.book_ids.length === 0) {
      return [];
    }

    const metadata = await this.getBooksMetadata(response.book_ids, lib);
    return Object.entries(metadata).map(([idStr, meta]) =>
      this.convertToBookFull(parseInt(idStr, 10), meta, lib)
    );
  }

  /**
   * Get cover URL for a book
   */
  getCoverUrl(bookId: number, libraryId?: string): string {
    const lib = libraryId || this.libraryId || '';
    return `${this.baseUrl}/get/cover/${bookId}/${lib}`;
  }

  /**
   * Get download URL for a book
   */
  getDownloadUrl(
    bookId: number,
    format: string = 'EPUB',
    libraryId?: string
  ): string {
    const lib = libraryId || this.libraryId || '';
    return `${this.baseUrl}/get/${format}/${bookId}/${lib}`;
  }
}
