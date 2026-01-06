/**
 * Test Calibre Client
 *
 * A test-friendly version of ContentServerClient that uses native fetch
 * instead of Obsidian's requestUrl API.
 *
 * @see src/calibre/server/content-server-client.ts
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Library info from Calibre Content Server
 */
export interface LibraryInfo {
  library_map: Record<string, string>; // id -> name
  default_library: string;
}

/**
 * Book metadata from Content Server
 */
export interface ServerBookMetadata {
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
  cover: string | null;
  format_metadata: Record<string, { path: string; size: number }>;
}

/**
 * Books list response
 */
export interface BooksListResponse {
  total_num: number;
  sort_order: string;
  library_id: string;
  offset: number;
  num: number;
  book_ids: number[];
}

/**
 * Normalized book for tests
 */
export interface TestCalibreBook {
  id: number;
  uuid: string;
  title: string;
  authors: string[];
  series?: { name: string; index: number };
  tags: string[];
  rating?: number;
  cover?: string;
  formats: string[];
  lastModified: Date;
}

// ============================================================================
// Test Calibre Client
// ============================================================================

/**
 * Test-friendly Calibre Content Server client using native fetch
 */
export class TestCalibreClient {
  private baseUrl: string;
  private username?: string;
  private password?: string;
  private libraryId: string | null = null;
  private connected = false;

  constructor(
    baseUrl: string,
    options?: { username?: string; password?: string }
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.username = options?.username;
    this.password = options?.password;
  }

  // ==========================================================================
  // Connection
  // ==========================================================================

  /**
   * Test connection to Calibre server
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getLibraryInfo();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Connect to server and get default library
   */
  async connect(): Promise<void> {
    const info = await this.getLibraryInfo();
    this.libraryId = info.default_library;
    this.connected = true;
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    this.connected = false;
    this.libraryId = null;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get current library ID
   */
  getLibraryId(): string | null {
    return this.libraryId;
  }

  // ==========================================================================
  // API Methods
  // ==========================================================================

  /**
   * Get library information
   */
  async getLibraryInfo(): Promise<LibraryInfo> {
    return this.request<LibraryInfo>('/ajax/library-info');
  }

  /**
   * Get available libraries
   */
  async getLibraries(): Promise<string[]> {
    const info = await this.getLibraryInfo();
    return Object.values(info.library_map);
  }

  /**
   * Get book IDs
   */
  async getBookIds(
    libraryId?: string,
    options?: { offset?: number; num?: number; sort?: string }
  ): Promise<BooksListResponse> {
    const lib = libraryId || this.libraryId || '';
    const params = new URLSearchParams();
    params.set('query', '');

    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.num !== undefined) {
      params.set('num', String(options.num));
    }
    if (options?.sort) {
      params.set('sort', options.sort);
    }

    return this.request<BooksListResponse>(
      `/ajax/search/${lib}?${params.toString()}`
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
   * Get single book metadata
   */
  async getBookMetadata(
    bookId: number,
    libraryId?: string
  ): Promise<ServerBookMetadata> {
    const lib = libraryId || this.libraryId || '';
    return this.request<ServerBookMetadata>(`/ajax/book/${bookId}/${lib}`);
  }

  /**
   * Get all books (with pagination)
   */
  async getBooks(libraryId?: string): Promise<TestCalibreBook[]> {
    const lib = libraryId || this.libraryId;

    // Get all book IDs
    const listResponse = await this.getBookIds(lib || undefined, { num: 100000 });

    if (listResponse.book_ids.length === 0) {
      return [];
    }

    // Fetch metadata in batches
    const batchSize = 50;
    const books: TestCalibreBook[] = [];

    for (let i = 0; i < listResponse.book_ids.length; i += batchSize) {
      const batchIds = listResponse.book_ids.slice(i, i + batchSize);
      const metadata = await this.getBooksMetadata(batchIds, lib || undefined);

      for (const [id, meta] of Object.entries(metadata)) {
        books.push(this.normalizeBook(parseInt(id), meta));
      }
    }

    return books;
  }

  /**
   * Get book by ID
   */
  async getBook(bookId: number, libraryId?: string): Promise<TestCalibreBook> {
    const meta = await this.getBookMetadata(bookId, libraryId);
    return this.normalizeBook(bookId, meta);
  }

  /**
   * Get cover URL for a book
   */
  getCoverUrl(bookId: number, libraryId?: string): string {
    const lib = libraryId || this.libraryId || '';
    return `${this.baseUrl}/get/cover/${bookId}/${lib}`;
  }

  /**
   * Download cover as ArrayBuffer
   */
  async downloadCover(bookId: number, libraryId?: string): Promise<ArrayBuffer | null> {
    const url = this.getCoverUrl(bookId, libraryId);
    try {
      const response = await this.fetchWithAuth(url);
      if (!response.ok) return null;
      return response.arrayBuffer();
    } catch {
      return null;
    }
  }

  /**
   * Get download URL for a format
   */
  getDownloadUrl(bookId: number, format: string, libraryId?: string): string {
    const lib = libraryId || this.libraryId || '';
    return `${this.baseUrl}/get/${format.toUpperCase()}/${bookId}/${lib}`;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Make authenticated fetch request
   */
  private async fetchWithAuth(url: string, options?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options?.headers as Record<string, string>),
    };

    if (this.username && this.password) {
      const credentials = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    return fetch(url, {
      ...options,
      headers,
    });
  }

  /**
   * Make JSON request
   */
  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Normalize server book metadata to test format
   */
  private normalizeBook(id: number, meta: ServerBookMetadata): TestCalibreBook {
    return {
      id,
      uuid: meta.uuid,
      title: meta.title,
      authors: meta.authors,
      series: meta.series
        ? { name: meta.series, index: meta.series_index || 1 }
        : undefined,
      tags: meta.tags,
      rating: meta.rating ? meta.rating / 2 : undefined, // Calibre uses 0-10, normalize to 0-5
      cover: meta.cover ? this.getCoverUrl(id) : undefined,
      formats: meta.formats,
      lastModified: new Date(meta.last_modified),
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a test Calibre client
 */
export function createTestCalibreClient(
  baseUrl: string,
  options?: { username?: string; password?: string }
): TestCalibreClient {
  return new TestCalibreClient(baseUrl, options);
}
