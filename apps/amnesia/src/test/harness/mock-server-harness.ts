/**
 * Mock Server Harness
 *
 * Simulates all server endpoints for testing sync operations.
 * Provides configurable latency, failure injection, and request recording.
 *
 * @see docs/plans/unified-sync-architecture-prd.md
 */

import type { ReadingProgress, ServerHighlight } from '../../server/amnesia-client';
import type {
  HandshakeResponse,
  ChunkInfo,
  UploadSession,
} from '../../upload/chunked-uploader';
import type { CalibreBookFull } from '../../calibre/calibre-types';

// ============================================================================
// Types
// ============================================================================

/**
 * Recorded request
 */
export interface RecordedRequest {
  id: string;
  timestamp: Date;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  response?: unknown;
  latency: number;
  error?: string;
}

/**
 * Mock configuration
 */
export interface MockServerConfig {
  /** Base latency range in ms */
  latencyMin: number;
  latencyMax: number;
  /** Failure rate (0-1) */
  failureRate: number;
  /** Specific chunk indices to fail */
  chunkFailures: number[];
  /** Enable request recording */
  recordRequests: boolean;
  /** Maximum recorded requests */
  maxRecordedRequests: number;
}

/**
 * Default configuration
 */
export const DEFAULT_MOCK_CONFIG: MockServerConfig = {
  latencyMin: 10,
  latencyMax: 50,
  failureRate: 0,
  chunkFailures: [],
  recordRequests: true,
  maxRecordedRequests: 1000,
};

/**
 * Stored book data
 */
export interface StoredBook {
  id: string;
  calibreId?: number;
  title: string;
  authors: string[];
  metadata: CalibreBookFull | null;
  progress: ReadingProgress | null;
  highlights: ServerHighlight[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Conflict scenario for testing
 */
export interface ConflictScenario {
  field: string;
  localValue: unknown;
  serverValue: unknown;
  serverNewer: boolean;
}

// ============================================================================
// Mock Server Harness
// ============================================================================

/**
 * Simulates server endpoints for testing
 */
export class MockServerHarness {
  private config: MockServerConfig;
  private books = new Map<string, StoredBook>();
  private uploadSessions = new Map<string, MockUploadSession>();
  private uploadedChunks = new Map<string, Map<number, ArrayBuffer>>();
  private recordedRequests: RecordedRequest[] = [];
  private requestId = 0;

  constructor(config: Partial<MockServerConfig> = {}) {
    this.config = { ...DEFAULT_MOCK_CONFIG, ...config };
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Set latency range
   */
  setLatency(min: number, max: number): void {
    this.config.latencyMin = min;
    this.config.latencyMax = max;
  }

  /**
   * Set failure rate
   */
  setFailureRate(rate: number): void {
    this.config.failureRate = Math.max(0, Math.min(1, rate));
  }

  /**
   * Set specific chunk failures
   */
  setChunkFailures(indices: number[]): void {
    this.config.chunkFailures = indices;
  }

  /**
   * Reset configuration to defaults
   */
  resetConfig(): void {
    this.config = { ...DEFAULT_MOCK_CONFIG };
  }

  // ==========================================================================
  // Health & Connection
  // ==========================================================================

  /**
   * Mock health check
   */
  async checkHealth(): Promise<{ status: 'ok' | 'error'; version: string }> {
    await this.simulateLatency();

    if (this.shouldFail()) {
      return { status: 'error', version: '0.0.0' };
    }

    return { status: 'ok', version: '1.0.0-mock' };
  }

  // ==========================================================================
  // Books CRUD
  // ==========================================================================

  /**
   * Get book by ID
   */
  async getBook(bookId: string): Promise<StoredBook | null> {
    await this.simulateLatency();
    this.recordRequest('GET', `/api/v1/books/${bookId}`);

    if (this.shouldFail()) {
      throw new Error('Simulated getBook failure');
    }

    return this.books.get(bookId) || null;
  }

  /**
   * Get all books
   */
  async getAllBooks(): Promise<StoredBook[]> {
    await this.simulateLatency();
    this.recordRequest('GET', '/api/v1/books');

    if (this.shouldFail()) {
      throw new Error('Simulated getAllBooks failure');
    }

    return Array.from(this.books.values());
  }

  /**
   * Create book
   */
  async createBook(book: Partial<StoredBook>): Promise<StoredBook> {
    await this.simulateLatency();

    if (this.shouldFail()) {
      throw new Error('Simulated createBook failure');
    }

    const id = book.id || crypto.randomUUID();
    const now = new Date();

    const stored: StoredBook = {
      id,
      calibreId: book.calibreId,
      title: book.title || 'Untitled',
      authors: book.authors || [],
      metadata: book.metadata || null,
      progress: book.progress || null,
      highlights: book.highlights || [],
      createdAt: now,
      updatedAt: now,
    };

    this.books.set(id, stored);
    this.recordRequest('POST', '/api/v1/books', book, stored);

    return stored;
  }

  /**
   * Update book
   */
  async updateBook(bookId: string, updates: Partial<StoredBook>): Promise<StoredBook | null> {
    await this.simulateLatency();

    if (this.shouldFail()) {
      throw new Error('Simulated updateBook failure');
    }

    const book = this.books.get(bookId);
    if (!book) {
      this.recordRequest('PUT', `/api/v1/books/${bookId}`, updates, null);
      return null;
    }

    const updated: StoredBook = {
      ...book,
      ...updates,
      updatedAt: new Date(),
    };

    this.books.set(bookId, updated);
    this.recordRequest('PUT', `/api/v1/books/${bookId}`, updates, updated);

    return updated;
  }

  /**
   * Delete book
   */
  async deleteBook(bookId: string): Promise<boolean> {
    await this.simulateLatency();

    if (this.shouldFail()) {
      throw new Error('Simulated deleteBook failure');
    }

    const deleted = this.books.delete(bookId);
    this.recordRequest('DELETE', `/api/v1/books/${bookId}`, undefined, { deleted });

    return deleted;
  }

  // ==========================================================================
  // Progress
  // ==========================================================================

  /**
   * Get progress for a book
   */
  async getProgress(bookId: string): Promise<ReadingProgress | null> {
    await this.simulateLatency();
    this.recordRequest('GET', `/api/v1/books/${bookId}/progress`);

    if (this.shouldFail()) {
      throw new Error('Simulated getProgress failure');
    }

    const book = this.books.get(bookId);
    return book?.progress || null;
  }

  /**
   * Update progress
   */
  async updateProgress(bookId: string, progress: ReadingProgress): Promise<ReadingProgress> {
    await this.simulateLatency();

    if (this.shouldFail()) {
      throw new Error('Simulated updateProgress failure');
    }

    let book = this.books.get(bookId);
    if (!book) {
      book = await this.createBook({ id: bookId, title: 'Unknown' });
    }

    book.progress = progress;
    book.updatedAt = new Date();

    this.recordRequest('PUT', `/api/v1/books/${bookId}/progress`, progress, progress);

    return progress;
  }

  // ==========================================================================
  // Highlights
  // ==========================================================================

  /**
   * Get highlights for a book
   */
  async getHighlights(bookId: string): Promise<ServerHighlight[]> {
    await this.simulateLatency();
    this.recordRequest('GET', `/api/v1/books/${bookId}/highlights`);

    if (this.shouldFail()) {
      throw new Error('Simulated getHighlights failure');
    }

    const book = this.books.get(bookId);
    return book?.highlights || [];
  }

  /**
   * Create highlight
   */
  async createHighlight(bookId: string, highlight: ServerHighlight): Promise<ServerHighlight> {
    await this.simulateLatency();

    if (this.shouldFail()) {
      throw new Error('Simulated createHighlight failure');
    }

    let book = this.books.get(bookId);
    if (!book) {
      book = await this.createBook({ id: bookId, title: 'Unknown' });
    }

    const newHighlight = {
      ...highlight,
      id: highlight.id || crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    book.highlights.push(newHighlight);
    book.updatedAt = new Date();

    this.recordRequest('POST', `/api/v1/books/${bookId}/highlights`, highlight, newHighlight);

    return newHighlight;
  }

  /**
   * Update highlight
   */
  async updateHighlight(
    bookId: string,
    highlightId: string,
    updates: Partial<ServerHighlight>
  ): Promise<ServerHighlight | null> {
    await this.simulateLatency();

    if (this.shouldFail()) {
      throw new Error('Simulated updateHighlight failure');
    }

    const book = this.books.get(bookId);
    if (!book) return null;

    const index = book.highlights.findIndex((h) => h.id === highlightId);
    if (index === -1) return null;

    const updated: ServerHighlight = {
      ...book.highlights[index],
      ...updates,
      updatedAt: new Date(),
    };

    book.highlights[index] = updated;
    book.updatedAt = new Date();

    this.recordRequest('PUT', `/api/v1/books/${bookId}/highlights/${highlightId}`, updates, updated);

    return updated;
  }

  /**
   * Delete highlight
   */
  async deleteHighlight(bookId: string, highlightId: string): Promise<boolean> {
    await this.simulateLatency();

    if (this.shouldFail()) {
      throw new Error('Simulated deleteHighlight failure');
    }

    const book = this.books.get(bookId);
    if (!book) return false;

    const initialLength = book.highlights.length;
    book.highlights = book.highlights.filter((h) => h.id !== highlightId);

    const deleted = book.highlights.length < initialLength;
    this.recordRequest('DELETE', `/api/v1/books/${bookId}/highlights/${highlightId}`, undefined, { deleted });

    return deleted;
  }

  // ==========================================================================
  // Upload Protocol
  // ==========================================================================

  /**
   * Handshake for chunked upload
   */
  async handshake(request: {
    fileName: string;
    fileSize: number;
    fileHash: string;
    chunkHashes: string[];
    mimeType: string;
  }): Promise<HandshakeResponse> {
    await this.simulateLatency();

    if (this.shouldFail()) {
      throw new Error('Simulated handshake failure');
    }

    // Check for duplicate
    for (const book of this.books.values()) {
      if (book.metadata?.uuid === request.fileHash) {
        const response: HandshakeResponse = {
          sessionId: crypto.randomUUID(),
          isDuplicate: true,
          existingBookId: book.id,
          neededChunks: [],
          existingChunks: request.chunkHashes.map((_, i) => i),
        };

        this.recordRequest('POST', '/api/v1/upload/handshake', request, response);
        return response;
      }
    }

    // New upload
    const sessionId = crypto.randomUUID();
    const session: MockUploadSession = {
      id: sessionId,
      fileName: request.fileName,
      fileSize: request.fileSize,
      fileHash: request.fileHash,
      chunkHashes: request.chunkHashes,
      mimeType: request.mimeType,
      receivedChunks: [],
      startedAt: Date.now(),
    };

    this.uploadSessions.set(sessionId, session);
    this.uploadedChunks.set(sessionId, new Map());

    const response: HandshakeResponse = {
      sessionId,
      isDuplicate: false,
      neededChunks: request.chunkHashes.map((_, i) => i),
      existingChunks: [],
    };

    this.recordRequest('POST', '/api/v1/upload/handshake', request, response);
    return response;
  }

  /**
   * Upload a chunk
   */
  async uploadChunk(
    sessionId: string,
    chunkIndex: number,
    data: ArrayBuffer,
    hash: string
  ): Promise<{ success: boolean; error?: string }> {
    await this.simulateLatency();

    if (this.shouldFail()) {
      return { success: false, error: 'Simulated chunk upload failure' };
    }

    const session = this.uploadSessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    // Check for injected failures
    if (this.config.chunkFailures.includes(chunkIndex)) {
      return { success: false, error: 'Injected chunk failure' };
    }

    // Verify hash
    if (session.chunkHashes[chunkIndex] !== hash) {
      return { success: false, error: 'Hash mismatch' };
    }

    // Store chunk
    const chunks = this.uploadedChunks.get(sessionId)!;
    chunks.set(chunkIndex, data);
    session.receivedChunks.push(chunkIndex);

    this.recordRequest('POST', `/api/v1/upload/${sessionId}/chunks/${chunkIndex}`, { hash }, { success: true });

    return { success: true };
  }

  /**
   * Finalize upload
   */
  async finalizeUpload(sessionId: string): Promise<{ bookId: string; title: string }> {
    await this.simulateLatency();

    if (this.shouldFail()) {
      throw new Error('Simulated finalize failure');
    }

    const session = this.uploadSessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Check all chunks received
    if (session.receivedChunks.length !== session.chunkHashes.length) {
      throw new Error('Missing chunks');
    }

    // Create book entry
    const bookId = crypto.randomUUID();
    await this.createBook({
      id: bookId,
      title: session.fileName.replace(/\.[^.]+$/, ''),
    });

    // Cleanup
    this.uploadSessions.delete(sessionId);
    this.uploadedChunks.delete(sessionId);

    const response = { bookId, title: session.fileName };
    this.recordRequest('POST', `/api/v1/upload/${sessionId}/finalize`, undefined, response);

    return response;
  }

  /**
   * Cancel upload
   */
  async cancelUpload(sessionId: string): Promise<void> {
    await this.simulateLatency();

    this.uploadSessions.delete(sessionId);
    this.uploadedChunks.delete(sessionId);

    this.recordRequest('DELETE', `/api/v1/upload/${sessionId}`);
  }

  // ==========================================================================
  // Fixtures
  // ==========================================================================

  /**
   * Load a fixture
   */
  loadFixture(name: 'empty' | 'small-library' | 'medium-library' | 'large-library'): void {
    this.clear();

    switch (name) {
      case 'empty':
        break;

      case 'small-library':
        this.seedBooks(10);
        break;

      case 'medium-library':
        this.seedBooks(100);
        break;

      case 'large-library':
        this.seedBooks(1000);
        break;
    }
  }

  /**
   * Seed books
   */
  seedBooks(count: number): StoredBook[] {
    const books: StoredBook[] = [];

    for (let i = 0; i < count; i++) {
      const book: StoredBook = {
        id: crypto.randomUUID(),
        calibreId: i + 1,
        title: `Book ${i + 1}`,
        authors: [`Author ${(i % 10) + 1}`],
        metadata: null,
        progress: {
          bookId: '',
          progress: Math.random() * 100,
          lastReadAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        highlights: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      book.progress!.bookId = book.id;

      this.books.set(book.id, book);
      books.push(book);
    }

    return books;
  }

  /**
   * Create conflict scenarios
   */
  createConflicts(scenarios: ConflictScenario[]): void {
    // Create books with conflicting data
    for (const scenario of scenarios) {
      const book = this.seedBooks(1)[0];
      if (scenario.field === 'progress') {
        book.progress = {
          bookId: book.id,
          progress: scenario.serverValue as number,
          lastReadAt: scenario.serverNewer ? new Date() : new Date(Date.now() - 1000),
          createdAt: new Date(),
          updatedAt: scenario.serverNewer ? new Date() : new Date(Date.now() - 1000),
        };
      }
    }
  }

  // ==========================================================================
  // State Inspection
  // ==========================================================================

  /**
   * Get recorded requests
   */
  getRecordedRequests(): RecordedRequest[] {
    return [...this.recordedRequests];
  }

  /**
   * Get uploaded chunks for session
   */
  getUploadedChunks(sessionId: string): Map<number, ArrayBuffer> | undefined {
    return this.uploadedChunks.get(sessionId);
  }

  /**
   * Get stored books
   */
  getStoredBooks(): StoredBook[] {
    return Array.from(this.books.values());
  }

  /**
   * Get book count
   */
  getBookCount(): number {
    return this.books.size;
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.books.clear();
    this.uploadSessions.clear();
    this.uploadedChunks.clear();
    this.recordedRequests = [];
    this.requestId = 0;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Simulate network latency
   */
  private async simulateLatency(): Promise<void> {
    const latency =
      this.config.latencyMin +
      Math.random() * (this.config.latencyMax - this.config.latencyMin);
    await new Promise((resolve) => setTimeout(resolve, latency));
  }

  /**
   * Check if should fail
   */
  private shouldFail(): boolean {
    return Math.random() < this.config.failureRate;
  }

  /**
   * Record a request
   */
  private recordRequest(
    method: string,
    path: string,
    body?: unknown,
    response?: unknown
  ): void {
    if (!this.config.recordRequests) return;

    const request: RecordedRequest = {
      id: `req-${++this.requestId}`,
      timestamp: new Date(),
      method,
      path,
      headers: {},
      body,
      response,
      latency: this.config.latencyMax,
    };

    this.recordedRequests.push(request);

    // Trim if exceeds max
    if (this.recordedRequests.length > this.config.maxRecordedRequests) {
      this.recordedRequests = this.recordedRequests.slice(-this.config.maxRecordedRequests);
    }
  }
}

/**
 * Mock upload session
 */
interface MockUploadSession {
  id: string;
  fileName: string;
  fileSize: number;
  fileHash: string;
  chunkHashes: string[];
  mimeType: string;
  receivedChunks: number[];
  startedAt: number;
}
