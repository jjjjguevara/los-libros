/**
 * API Client
 *
 * Communicates with the Amnesia server for:
 * - Book parsing and content retrieval
 * - Annotation sync
 * - Progress tracking
 */

import type {
  ParsedBook,
  ChapterContent,
  Annotation,
  ReadingProgress,
  SyncStatus,
  PushRequest,
  PushResponse,
  PullRequest,
  PullResponse,
  ApiResponse,
  ParsedPdf,
  PdfTextLayer,
  PdfRenderOptions,
} from './types';

/**
 * API Client configuration
 */
export interface ApiClientConfig {
  /** Base URL of the server (e.g., 'http://localhost:3000') */
  baseUrl: string;
  /** Device ID for sync */
  deviceId: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Custom headers */
  headers?: Record<string, string>;
}

/**
 * API error with status code and message
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Amnesia API Client
 */
export class ApiClient {
  private config: Required<ApiClientConfig>;
  private abortControllers: Map<string, AbortController> = new Map();

  // Chapter cache: bookId:href -> ChapterContent
  private chapterCache: Map<string, ChapterContent> = new Map();
  private pendingChapterRequests: Map<string, Promise<ChapterContent>> = new Map();

  constructor(config: ApiClientConfig) {
    this.config = {
      timeout: 30000,
      headers: {},
      ...config,
    };
  }

  /**
   * Get cache key for a chapter
   */
  private getChapterCacheKey(bookId: string, href: string): string {
    return `${bookId}:${href}`;
  }

  /**
   * Check if a chapter is cached
   */
  isChapterCached(bookId: string, href: string): boolean {
    return this.chapterCache.has(this.getChapterCacheKey(bookId, href));
  }

  /**
   * Clear chapter cache for a book
   */
  clearChapterCache(bookId?: string): void {
    if (bookId) {
      const prefix = `${bookId}:`;
      for (const key of this.chapterCache.keys()) {
        if (key.startsWith(prefix)) {
          this.chapterCache.delete(key);
        }
      }
    } else {
      this.chapterCache.clear();
    }
  }

  // ============================================================================
  // Book Operations
  // ============================================================================

  /**
   * Upload an EPUB file to the server
   */
  async uploadBook(file: File | ArrayBuffer, filename?: string): Promise<ParsedBook> {
    const formData = new FormData();

    if (file instanceof ArrayBuffer) {
      const blob = new Blob([file], { type: 'application/epub+zip' });
      const finalFilename = filename || 'book.epub';
      console.log('[ApiClient] Uploading book:', {
        size: file.byteLength,
        filename: finalFilename,
        blobSize: blob.size,
        blobType: blob.type,
      });
      formData.append('file', blob, finalFilename);
    } else {
      console.log('[ApiClient] Uploading book file:', {
        name: file.name,
        size: file.size,
        type: file.type,
      });
      formData.append('file', file);
    }

    // Log formData entries for debugging
    console.log('[ApiClient] FormData entries:');
    for (const [key, value] of formData.entries()) {
      if (value instanceof Blob) {
        console.log(`  ${key}: Blob(size=${value.size}, type=${value.type})`);
      } else {
        console.log(`  ${key}: ${value}`);
      }
    }

    // Upload returns just {id, title, message}, so we need to fetch full book data
    const uploadResponse = await this.request<{ id: string; title: string; message: string }>('/api/v1/books', {
      method: 'POST',
      body: formData,
      // Don't set Content-Type for FormData - browser will set with boundary
    });

    // Fetch full book details
    return this.getBook(uploadResponse.id);
  }

  /**
   * Get book metadata and structure
   */
  async getBook(bookId: string): Promise<ParsedBook> {
    return this.request<ParsedBook>(`/api/v1/books/${encodeURIComponent(bookId)}`);
  }

  /**
   * List all books on server
   */
  async listBooks(): Promise<ParsedBook[]> {
    return this.request<ParsedBook[]>('/api/v1/books');
  }

  /**
   * Delete a book from server
   */
  async deleteBook(bookId: string): Promise<void> {
    await this.request(`/api/v1/books/${encodeURIComponent(bookId)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get chapter HTML content
   * @param bookId Book identifier
   * @param href Chapter href from spine
   * @param includeHighlights Whether to inject highlight spans
   */
  async getChapter(
    bookId: string,
    href: string,
    includeHighlights = true
  ): Promise<ChapterContent> {
    const cacheKey = this.getChapterCacheKey(bookId, href);

    // Return cached version if available
    const cached = this.chapterCache.get(cacheKey);
    if (cached) {
      console.log('[ApiClient] Cache hit for chapter:', href);
      return cached;
    }

    // Check if there's already a pending request for this chapter
    const pending = this.pendingChapterRequests.get(cacheKey);
    if (pending) {
      console.log('[ApiClient] Waiting for pending request:', href);
      return pending;
    }

    // Fetch from server
    console.log('[ApiClient] Cache miss, fetching chapter:', href);
    const params = new URLSearchParams();
    if (includeHighlights) {
      params.set('highlights', 'true');
    }

    const url = `/api/v1/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(href)}?${params}`;

    const request = this.request<ChapterContent>(url).then((chapter) => {
      // Cache the result
      this.chapterCache.set(cacheKey, chapter);
      this.pendingChapterRequests.delete(cacheKey);
      return chapter;
    }).catch((error) => {
      this.pendingChapterRequests.delete(cacheKey);
      throw error;
    });

    this.pendingChapterRequests.set(cacheKey, request);
    return request;
  }

  /**
   * Preload a chapter without waiting for it
   */
  preloadChapter(bookId: string, href: string): void {
    const cacheKey = this.getChapterCacheKey(bookId, href);
    if (this.chapterCache.has(cacheKey) || this.pendingChapterRequests.has(cacheKey)) {
      return; // Already cached or loading
    }

    console.log('[ApiClient] Preloading chapter:', href);
    // Fire and forget - just trigger the caching
    this.getChapter(bookId, href, true).catch((error) => {
      console.warn('[ApiClient] Failed to preload chapter:', href, error);
    });
  }

  /**
   * Get a resource (image, CSS, font) from the book
   */
  async getResource(bookId: string, href: string): Promise<Blob> {
    const url = `/api/v1/books/${encodeURIComponent(bookId)}/resources/${encodeURIComponent(href)}`;

    const response = await this.fetch(url, {});
    return response.blob();
  }

  /**
   * Get resource as data URL for embedding
   */
  async getResourceAsDataUrl(bookId: string, href: string): Promise<string> {
    const blob = await this.getResource(bookId, href);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ============================================================================
  // Annotation Operations
  // ============================================================================

  /**
   * List annotations for a book
   */
  async listAnnotations(
    bookId: string,
    options?: {
      type?: string;
      chapter?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<Annotation[]> {
    const params = new URLSearchParams();
    if (options?.type) params.set('type', options.type);
    if (options?.chapter) params.set('chapter', options.chapter);
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());

    const url = `/api/v1/annotations/book/${encodeURIComponent(bookId)}?${params}`;
    return this.request<Annotation[]>(url);
  }

  /**
   * Create a new annotation
   */
  async createAnnotation(annotation: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>): Promise<Annotation> {
    return this.request<Annotation>('/api/v1/annotations', {
      method: 'POST',
      body: JSON.stringify(annotation),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Update an annotation
   */
  async updateAnnotation(
    annotationId: string,
    updates: Partial<Pick<Annotation, 'color' | 'note'>>
  ): Promise<Annotation> {
    return this.request<Annotation>(`/api/v1/annotations/${encodeURIComponent(annotationId)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Delete an annotation
   */
  async deleteAnnotation(annotationId: string): Promise<void> {
    await this.request(`/api/v1/annotations/${encodeURIComponent(annotationId)}`, {
      method: 'DELETE',
    });
  }

  // ============================================================================
  // Progress Operations
  // ============================================================================

  /**
   * Get reading progress for a book
   */
  async getProgress(bookId: string): Promise<ReadingProgress | null> {
    try {
      return await this.request<ReadingProgress>(
        `/api/v1/progress/${encodeURIComponent(bookId)}`
      );
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 404) {
        return null;
      }
      throw e;
    }
  }

  /**
   * Save reading progress
   */
  async saveProgress(progress: Omit<ReadingProgress, 'updatedAt'>): Promise<ReadingProgress> {
    return this.request<ReadingProgress>(
      `/api/v1/progress/${encodeURIComponent(progress.bookId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(progress),
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // ============================================================================
  // Sync Operations
  // ============================================================================

  /**
   * Get sync status for a book
   */
  async getSyncStatus(bookId: string): Promise<SyncStatus> {
    return this.request<SyncStatus>(`/api/v1/sync/status/${encodeURIComponent(bookId)}`);
  }

  /**
   * Push local changes to server
   */
  async pushChanges(request: PushRequest): Promise<PushResponse> {
    return this.request<PushResponse>('/api/v1/sync/push', {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Pull changes from server
   */
  async pullChanges(request: PullRequest): Promise<PullResponse> {
    return this.request<PullResponse>('/api/v1/sync/pull', {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ============================================================================
  // PDF Operations
  // ============================================================================

  /**
   * Upload a PDF file to the server
   * Uses XMLHttpRequest for reliable large file uploads in Electron
   * (fetch has known issues with streaming large FormData)
   */
  async uploadPdf(data: ArrayBuffer, filename?: string): Promise<ParsedPdf> {
    const finalFilename = filename || 'document.pdf';

    console.log('[ApiClient] Uploading PDF via XHR:', {
      size: data.byteLength,
      filename: finalFilename,
    });

    // Use XHR instead of fetch for large file uploads
    // Electron's fetch has known issues with streaming large FormData bodies
    const uploadResponse = await this.uploadFileViaXhr<{ id: string; message: string }>(
      '/api/v1/pdf',
      data,
      finalFilename,
      'application/pdf',
      300000 // 5 minute timeout for large/complex PDFs
    );

    // Fetch full PDF metadata
    return this.getPdf(uploadResponse.id);
  }

  /**
   * Upload a file using curl (most reliable method in Electron)
   */
  private uploadFileViaXhr<T>(
    path: string,
    data: ArrayBuffer,
    filename: string,
    mimeType: string,
    timeoutMs: number
  ): Promise<T> {
    // Use curl via child_process for reliable uploads
    // Electron's network stack has issues with large file uploads
    const { execFile } = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const nodePath = require('path');

    return new Promise((resolve, reject) => {
      const url = `${this.config.baseUrl}${path}`;
      const tempFile = nodePath.join(os.tmpdir(), `amnesia-upload-${Date.now()}.pdf`);

      console.log('[ApiClient] Uploading via curl:', {
        url,
        filename,
        dataSize: data.byteLength,
        tempFile,
      });

      // Write data to temp file
      const buffer = Buffer.from(data);
      fs.writeFileSync(tempFile, buffer);

      // Use curl to upload
      // Note: filename must be quoted to handle spaces and special characters
      // The double quotes inside the -F value are part of the curl syntax
      const safeFilename = filename.replace(/"/g, '\\"'); // Escape any quotes in filename
      const curlArgs = [
        '-s', // Silent mode
        '-X', 'POST',
        '-F', `file=@${tempFile};filename="${safeFilename}";type=${mimeType}`,
        '-H', `X-Device-ID: ${this.config.deviceId}`,
        '--max-time', String(Math.ceil(timeoutMs / 1000)),
        url,
      ];

      console.log('[ApiClient] Running curl...');

      // Use async execFile to not block the event loop
      execFile('curl', curlArgs, {
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: 50 * 1024 * 1024, // 50MB for large responses
      }, (error: any, stdout: string, stderr: string) => {
        // Clean up temp file
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {
          console.warn('[ApiClient] Failed to cleanup temp file:', e);
        }

        if (error) {
          console.error('[ApiClient] curl error:', {
            message: error.message,
            code: error.code,
            signal: error.signal,
            stderr: stderr?.substring?.(0, 500),
          });

          if (error.signal === 'SIGTERM' || error.killed) {
            reject(new Error(`Upload timed out after ${timeoutMs}ms`));
          } else {
            reject(new Error('Upload failed: ' + (stderr || error.message)));
          }
          return;
        }

        console.log('[ApiClient] curl response:', stdout?.substring?.(0, 500));

        try {
          const response = JSON.parse(stdout);
          if (response.error) {
            reject(new ApiError(response.error.message || 'Unknown error', 400, response.error.code));
          } else {
            resolve(response.data ?? response);
          }
        } catch (parseError) {
          console.error('[ApiClient] Failed to parse response:', stdout);
          reject(new Error('Failed to parse server response'));
        }
      });
    });
  }

  /**
   * Get PDF metadata and structure
   */
  async getPdf(pdfId: string): Promise<ParsedPdf> {
    return this.request<ParsedPdf>(`/api/v1/pdf/${encodeURIComponent(pdfId)}`);
  }

  /**
   * Delete a PDF from server
   */
  async deletePdf(pdfId: string): Promise<void> {
    await this.request(`/api/v1/pdf/${encodeURIComponent(pdfId)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get rendered page image
   * @param pdfId PDF identifier
   * @param page Page number (1-based)
   * @param options Render options (scale, rotation, format)
   */
  async getPdfPage(
    pdfId: string,
    page: number,
    options?: PdfRenderOptions
  ): Promise<Blob> {
    const params = new URLSearchParams();
    if (options?.scale) params.set('scale', options.scale.toString());
    if (options?.rotation) params.set('rotation', options.rotation.toString());
    if (options?.format) params.set('format', options.format);

    const url = `/api/v1/pdf/${encodeURIComponent(pdfId)}/pages/${page}?${params}`;
    const response = await this.fetch(url, {});
    return response.blob();
  }

  /**
   * Get text layer for a page
   * @param pdfId PDF identifier
   * @param page Page number (1-based)
   */
  async getPdfTextLayer(pdfId: string, page: number): Promise<PdfTextLayer> {
    return this.request<PdfTextLayer>(
      `/api/v1/pdf/${encodeURIComponent(pdfId)}/pages/${page}/text`
    );
  }

  /**
   * Get page thumbnail (low-resolution)
   * @param pdfId PDF identifier
   * @param page Page number (1-based)
   */
  async getPdfThumbnail(pdfId: string, page: number): Promise<Blob> {
    const url = `/api/v1/pdf/${encodeURIComponent(pdfId)}/pages/${page}/thumbnail`;
    const response = await this.fetch(url, {});
    return response.blob();
  }

  /**
   * Search PDF content
   * @param pdfId PDF identifier
   * @param query Search query
   * @param limit Maximum number of results
   */
  async searchPdf(
    pdfId: string,
    query: string,
    limit?: number
  ): Promise<Array<{
    page: number;
    text: string;
    prefix?: string;
    suffix?: string;
  }>> {
    const params = new URLSearchParams();
    params.set('q', query);
    if (limit) params.set('limit', limit.toString());

    return this.request<Array<{
      page: number;
      text: string;
      prefix?: string;
      suffix?: string;
    }>>(`/api/v1/pdf/${encodeURIComponent(pdfId)}/search?${params}`);
  }

  // ============================================================================
  // Request Helpers
  // ============================================================================

  /**
   * Cancel a pending request by key
   */
  cancelRequest(key: string): void {
    const controller = this.abortControllers.get(key);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(key);
    }
  }

  /**
   * Cancel all pending requests
   */
  cancelAllRequests(): void {
    Array.from(this.abortControllers.values()).forEach((controller) => {
      controller.abort();
    });
    this.abortControllers.clear();
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ApiClientConfig>): void {
    Object.assign(this.config, updates);
  }

  /**
   * Check if server is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request<{ status: string }>('/api/v1/health');
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Internal Methods
  // ============================================================================

  /**
   * Make a request with a custom timeout
   */
  private async requestWithTimeout<T>(
    path: string,
    init?: RequestInit & { requestKey?: string },
    timeoutMs?: number
  ): Promise<T> {
    const response = await this.fetchWithTimeout(path, init, timeoutMs);

    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      return undefined as unknown as T;
    }

    const data = await response.json();

    if (data.error) {
      throw new ApiError(
        data.error.message || 'Unknown error',
        response.status,
        data.error.code
      );
    }

    return data.data ?? data;
  }

  private async request<T>(
    path: string,
    init?: RequestInit & { requestKey?: string }
  ): Promise<T> {
    const response = await this.fetch(path, init);

    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      // Non-JSON response - return as-is if expected
      return undefined as unknown as T;
    }

    const data = await response.json();

    // Check for wrapped error response
    if (data.error) {
      throw new ApiError(
        data.error.message || 'Unknown error',
        response.status,
        data.error.code
      );
    }

    return data.data ?? data;
  }

  private async fetch(path: string, init?: RequestInit & { requestKey?: string }): Promise<Response> {
    return this.fetchWithTimeout(path, init, this.config.timeout);
  }

  private async fetchWithTimeout(
    path: string,
    init?: RequestInit & { requestKey?: string },
    timeoutMs?: number
  ): Promise<Response> {
    const url = `${this.config.baseUrl}${path}`;
    const { requestKey, ...fetchInit } = init || {};
    const timeout = timeoutMs ?? this.config.timeout;

    // Create abort controller for timeout and cancellation
    const controller = new AbortController();
    if (requestKey) {
      // Cancel any existing request with this key
      this.cancelRequest(requestKey);
      this.abortControllers.set(requestKey, controller);
    }

    // Set up timeout
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...fetchInit,
        signal: controller.signal,
        headers: {
          ...this.config.headers,
          'X-Device-ID': this.config.deviceId,
          ...fetchInit?.headers,
        },
      });

      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const error = await response.json();
          message = error.error?.message || error.message || message;
        } catch {
          // Ignore JSON parse errors
        }
        throw new ApiError(message, response.status);
      }

      return response;
    } finally {
      clearTimeout(timeoutId);
      if (requestKey) {
        this.abortControllers.delete(requestKey);
      }
    }
  }
}

/**
 * Create a singleton API client instance
 */
let clientInstance: ApiClient | null = null;

export function createApiClient(config: ApiClientConfig): ApiClient {
  clientInstance = new ApiClient(config);
  return clientInstance;
}

export function getApiClient(): ApiClient {
  if (!clientInstance) {
    throw new Error('API client not initialized. Call createApiClient first.');
  }
  return clientInstance;
}
