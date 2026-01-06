/**
 * Chunked Uploader
 *
 * Inspired by copyparty's up2k protocol, provides resumable chunked
 * uploads for large EPUB files with hash-based deduplication.
 *
 * Features:
 * - Chunked uploads with configurable size
 * - Client-side hashing for deduplication
 * - Resume interrupted uploads
 * - Progress tracking
 * - Parallel chunk uploads
 *
 * @see docs/specifications/file-system-architecture.md
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Upload chunk info
 */
export interface ChunkInfo {
  /** Chunk index */
  index: number;
  /** Start byte offset */
  start: number;
  /** End byte offset */
  end: number;
  /** Chunk size */
  size: number;
  /** Chunk hash (SHA-256) */
  hash: string;
  /** Upload status */
  status: ChunkStatus;
}

/**
 * Chunk status
 */
export type ChunkStatus = 'pending' | 'uploading' | 'uploaded' | 'failed' | 'skipped';

/**
 * Upload session
 */
export interface UploadSession {
  /** Session ID (wark in up2k terminology) */
  sessionId: string;
  /** File name */
  fileName: string;
  /** Total file size */
  fileSize: number;
  /** File hash (full file) */
  fileHash: string;
  /** MIME type */
  mimeType: string;
  /** Chunk information */
  chunks: ChunkInfo[];
  /** Upload status */
  status: UploadStatus;
  /** Started timestamp */
  startedAt: number;
  /** Completed timestamp */
  completedAt?: number;
  /** Book ID (after successful upload) */
  bookId?: string;
  /** Error message */
  error?: string;
}

/**
 * Upload status
 */
export type UploadStatus =
  | 'initializing'
  | 'hashing'
  | 'handshake'
  | 'uploading'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'duplicate';

/**
 * Upload progress
 */
export interface UploadProgress {
  /** Session ID */
  sessionId: string;
  /** Current phase */
  phase: UploadStatus;
  /** Bytes uploaded */
  bytesUploaded: number;
  /** Total bytes */
  totalBytes: number;
  /** Percentage (0-100) */
  percentage: number;
  /** Current chunk index */
  currentChunk: number;
  /** Total chunks */
  totalChunks: number;
  /** Upload speed (bytes/sec) */
  speed: number;
  /** Estimated time remaining (seconds) */
  eta: number;
}

/**
 * Handshake response from server
 */
export interface HandshakeResponse {
  /** Session ID assigned by server */
  sessionId: string;
  /** Whether file is a duplicate */
  isDuplicate: boolean;
  /** Existing book ID if duplicate */
  existingBookId?: string;
  /** Chunks that need to be uploaded */
  neededChunks: number[];
  /** Chunks already on server */
  existingChunks: number[];
}

/**
 * Upload events
 */
export interface UploadEvents {
  'start': { session: UploadSession };
  'progress': UploadProgress;
  'chunk-complete': { sessionId: string; chunkIndex: number };
  'complete': { session: UploadSession; bookId: string };
  'duplicate': { session: UploadSession; existingBookId: string };
  'error': { sessionId: string; error: string };
  'cancel': { sessionId: string };
}

/**
 * Event listener type
 */
export type UploadEventListener<K extends keyof UploadEvents> = (
  data: UploadEvents[K]
) => void;

/**
 * Upload endpoint interface
 */
export interface UploadEndpoint {
  /** Initiate upload handshake */
  handshake(
    fileName: string,
    fileSize: number,
    fileHash: string,
    chunkHashes: string[],
    mimeType: string
  ): Promise<HandshakeResponse>;

  /** Upload a single chunk */
  uploadChunk(
    sessionId: string,
    chunkIndex: number,
    data: ArrayBuffer,
    hash: string
  ): Promise<void>;

  /** Finalize upload */
  finalize(sessionId: string): Promise<{ bookId: string }>;

  /** Cancel upload */
  cancel(sessionId: string): Promise<void>;
}

/**
 * Uploader configuration
 */
export interface ChunkedUploaderConfig {
  /** Chunk size in bytes (default: 2MB) */
  chunkSize: number;
  /** Concurrent chunk uploads */
  concurrency: number;
  /** Retry count for failed chunks */
  retryCount: number;
  /** Retry delay in ms */
  retryDelay: number;
  /** Hash algorithm */
  hashAlgorithm: 'SHA-256' | 'SHA-1';
}

/**
 * Default configuration
 */
export const DEFAULT_UPLOADER_CONFIG: ChunkedUploaderConfig = {
  chunkSize: 2 * 1024 * 1024, // 2MB
  concurrency: 3,
  retryCount: 3,
  retryDelay: 1000,
  hashAlgorithm: 'SHA-256',
};

// ============================================================================
// Chunked Uploader
// ============================================================================

export class ChunkedUploader {
  private config: ChunkedUploaderConfig;
  private endpoint: UploadEndpoint;
  private sessions: Map<string, UploadSession> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private listeners: Map<keyof UploadEvents, Set<UploadEventListener<any>>> = new Map();

  constructor(endpoint: UploadEndpoint, config: Partial<ChunkedUploaderConfig> = {}) {
    this.config = { ...DEFAULT_UPLOADER_CONFIG, ...config };
    this.endpoint = endpoint;
  }

  // ==========================================================================
  // Upload Operations
  // ==========================================================================

  /**
   * Upload a file
   */
  async upload(file: File): Promise<UploadSession> {
    const session = await this.initializeSession(file);

    try {
      // Hash the file
      session.status = 'hashing';
      await this.hashFile(file, session);

      // Handshake with server
      session.status = 'handshake';
      const handshake = await this.performHandshake(session);

      // Check for duplicate
      if (handshake.isDuplicate && handshake.existingBookId) {
        session.status = 'duplicate';
        session.bookId = handshake.existingBookId;
        session.completedAt = Date.now();

        this.emit('duplicate', {
          session,
          existingBookId: handshake.existingBookId,
        });

        return session;
      }

      // Mark chunks that don't need uploading
      for (const index of handshake.existingChunks) {
        if (session.chunks[index]) {
          session.chunks[index].status = 'skipped';
        }
      }

      // Upload needed chunks
      session.status = 'uploading';
      await this.uploadChunks(file, session, handshake.neededChunks);

      // Finalize
      session.status = 'finalizing';
      const result = await this.endpoint.finalize(session.sessionId);

      session.status = 'completed';
      session.bookId = result.bookId;
      session.completedAt = Date.now();

      this.emit('complete', { session, bookId: result.bookId });

      return session;
    } catch (error) {
      if (session.status !== 'cancelled') {
        session.status = 'failed';
        session.error = error instanceof Error ? error.message : String(error);
        this.emit('error', { sessionId: session.sessionId, error: session.error });
      }
      throw error;
    } finally {
      this.abortControllers.delete(session.sessionId);
    }
  }

  /**
   * Cancel an upload
   */
  async cancel(sessionId: string): Promise<void> {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'cancelled';
    }

    try {
      await this.endpoint.cancel(sessionId);
    } catch {
      // Ignore cancel errors
    }

    this.emit('cancel', { sessionId });
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): UploadSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Get all sessions
   */
  getSessions(): UploadSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Resume an interrupted upload session
   *
   * Note: For now, this is a placeholder. Full resume requires persisting
   * session state to IndexedDB and re-uploading missing chunks.
   */
  async resume(sessionId: string): Promise<UploadSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    // For now, we can only resume if we still have the session in memory
    // and it wasn't completed or failed
    if (session.status === 'completed' || session.status === 'duplicate') {
      return session;
    }

    // TODO: Implement full resume with persisted state
    // This would require:
    // 1. Persisting session state to IndexedDB
    // 2. Re-reading the file
    // 3. Re-uploading only the missing chunks
    console.warn('[ChunkedUploader] Full resume not yet implemented');
    return null;
  }

  /**
   * Check if a file would be a duplicate before uploading
   *
   * This performs the hash computation and handshake without uploading.
   */
  async checkDuplicate(
    file: File,
    onProgress?: (progress: { phase: string; percentage: number }) => void
  ): Promise<HandshakeResponse | null> {
    // Initialize temporary session for hashing
    const tempSession: UploadSession = {
      sessionId: `check-${Date.now()}`,
      fileName: file.name,
      fileSize: file.size,
      fileHash: '',
      mimeType: file.type || 'application/epub+zip',
      chunks: [],
      status: 'initializing',
      startedAt: Date.now(),
    };

    // Calculate chunk info
    const chunkCount = Math.ceil(file.size / this.config.chunkSize);
    for (let i = 0; i < chunkCount; i++) {
      const start = i * this.config.chunkSize;
      const end = Math.min(start + this.config.chunkSize, file.size);

      tempSession.chunks.push({
        index: i,
        start,
        end,
        size: end - start,
        hash: '',
        status: 'pending',
      });
    }

    try {
      // Hash the file
      onProgress?.({ phase: 'hashing', percentage: 0 });
      let bytesHashed = 0;

      for (const chunk of tempSession.chunks) {
        const blob = file.slice(chunk.start, chunk.end);
        const buffer = await blob.arrayBuffer();
        chunk.hash = await this.hashBuffer(buffer);

        bytesHashed += chunk.size;
        onProgress?.({
          phase: 'hashing',
          percentage: (bytesHashed / file.size) * 100,
        });
      }

      // Calculate full file hash
      const combinedHashes = tempSession.chunks.map((c) => c.hash).join('');
      tempSession.fileHash = await this.hashString(combinedHashes);

      // Perform handshake to check for duplicate
      onProgress?.({ phase: 'checking', percentage: 100 });
      const chunkHashes = tempSession.chunks.map((c) => c.hash);

      const response = await this.endpoint.handshake(
        tempSession.fileName,
        tempSession.fileSize,
        tempSession.fileHash,
        chunkHashes,
        tempSession.mimeType
      );

      return response;
    } catch (error) {
      console.error('[ChunkedUploader] Duplicate check failed:', error);
      return null;
    }
  }

  // ==========================================================================
  // Internal: Session Management
  // ==========================================================================

  /**
   * Initialize upload session
   */
  private async initializeSession(file: File): Promise<UploadSession> {
    const sessionId = this.generateSessionId();

    const session: UploadSession = {
      sessionId,
      fileName: file.name,
      fileSize: file.size,
      fileHash: '',
      mimeType: file.type || 'application/epub+zip',
      chunks: [],
      status: 'initializing',
      startedAt: Date.now(),
    };

    // Calculate chunk info
    const chunkCount = Math.ceil(file.size / this.config.chunkSize);
    for (let i = 0; i < chunkCount; i++) {
      const start = i * this.config.chunkSize;
      const end = Math.min(start + this.config.chunkSize, file.size);

      session.chunks.push({
        index: i,
        start,
        end,
        size: end - start,
        hash: '',
        status: 'pending',
      });
    }

    this.sessions.set(sessionId, session);
    this.abortControllers.set(sessionId, new AbortController());

    this.emit('start', { session });

    return session;
  }

  // ==========================================================================
  // Internal: Hashing
  // ==========================================================================

  /**
   * Hash the file and all chunks
   */
  private async hashFile(file: File, session: UploadSession): Promise<void> {
    const startTime = Date.now();
    let bytesHashed = 0;

    // Hash each chunk
    for (const chunk of session.chunks) {
      const blob = file.slice(chunk.start, chunk.end);
      const buffer = await blob.arrayBuffer();
      chunk.hash = await this.hashBuffer(buffer);

      bytesHashed += chunk.size;

      // Emit progress
      this.emitProgress(session, bytesHashed, startTime, 'hashing');
    }

    // Calculate full file hash (hash of chunk hashes)
    const combinedHashes = session.chunks.map((c) => c.hash).join('');
    session.fileHash = await this.hashString(combinedHashes);
  }

  /**
   * Hash an ArrayBuffer
   */
  private async hashBuffer(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest(
      this.config.hashAlgorithm,
      buffer
    );
    return this.bufferToHex(hashBuffer);
  }

  /**
   * Hash a string
   */
  private async hashString(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    return this.hashBuffer(data.buffer as ArrayBuffer);
  }

  /**
   * Convert ArrayBuffer to hex string
   */
  private bufferToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // ==========================================================================
  // Internal: Handshake
  // ==========================================================================

  /**
   * Perform handshake with server
   */
  private async performHandshake(
    session: UploadSession
  ): Promise<HandshakeResponse> {
    const chunkHashes = session.chunks.map((c) => c.hash);

    const response = await this.endpoint.handshake(
      session.fileName,
      session.fileSize,
      session.fileHash,
      chunkHashes,
      session.mimeType
    );

    // Update session ID from server
    session.sessionId = response.sessionId;
    this.sessions.set(response.sessionId, session);

    return response;
  }

  // ==========================================================================
  // Internal: Chunk Upload
  // ==========================================================================

  /**
   * Upload chunks with concurrency control
   */
  private async uploadChunks(
    file: File,
    session: UploadSession,
    neededChunks: number[]
  ): Promise<void> {
    const controller = this.abortControllers.get(session.sessionId);
    if (!controller) {
      throw new Error('Upload cancelled');
    }

    const startTime = Date.now();
    let bytesUploaded = 0;

    // Calculate already uploaded bytes (skipped chunks)
    for (const chunk of session.chunks) {
      if (chunk.status === 'skipped') {
        bytesUploaded += chunk.size;
      }
    }

    // Upload queue
    const queue = [...neededChunks];
    const inProgress = new Set<Promise<void>>();

    while (queue.length > 0 || inProgress.size > 0) {
      // Check for cancellation
      if (controller.signal.aborted) {
        throw new Error('Upload cancelled');
      }

      // Fill up to concurrency limit
      while (queue.length > 0 && inProgress.size < this.config.concurrency) {
        const chunkIndex = queue.shift()!;
        const chunk = session.chunks[chunkIndex];

        const uploadPromise = this.uploadChunk(file, session, chunk, controller.signal)
          .then(() => {
            bytesUploaded += chunk.size;
            this.emitProgress(session, bytesUploaded, startTime, 'uploading');
            this.emit('chunk-complete', {
              sessionId: session.sessionId,
              chunkIndex,
            });
          })
          .finally(() => {
            inProgress.delete(uploadPromise);
          });

        inProgress.add(uploadPromise);
      }

      // Wait for at least one to complete
      if (inProgress.size > 0) {
        await Promise.race(inProgress);
      }
    }
  }

  /**
   * Upload a single chunk with retry
   */
  private async uploadChunk(
    file: File,
    session: UploadSession,
    chunk: ChunkInfo,
    signal: AbortSignal
  ): Promise<void> {
    chunk.status = 'uploading';

    for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
      if (signal.aborted) {
        throw new Error('Upload cancelled');
      }

      try {
        const blob = file.slice(chunk.start, chunk.end);
        const buffer = await blob.arrayBuffer();

        await this.endpoint.uploadChunk(
          session.sessionId,
          chunk.index,
          buffer,
          chunk.hash
        );

        chunk.status = 'uploaded';
        return;
      } catch (error) {
        if (attempt === this.config.retryCount) {
          chunk.status = 'failed';
          throw error;
        }

        // Wait before retry
        await this.delay(this.config.retryDelay * (attempt + 1));
      }
    }
  }

  // ==========================================================================
  // Internal: Progress
  // ==========================================================================

  /**
   * Emit progress event
   */
  private emitProgress(
    session: UploadSession,
    bytesProcessed: number,
    startTime: number,
    phase: UploadStatus
  ): void {
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = elapsed > 0 ? bytesProcessed / elapsed : 0;
    const remaining = session.fileSize - bytesProcessed;
    const eta = speed > 0 ? remaining / speed : 0;

    const uploadedChunks = session.chunks.filter(
      (c) => c.status === 'uploaded' || c.status === 'skipped'
    ).length;

    const progress: UploadProgress = {
      sessionId: session.sessionId,
      phase,
      bytesUploaded: bytesProcessed,
      totalBytes: session.fileSize,
      percentage: (bytesProcessed / session.fileSize) * 100,
      currentChunk: uploadedChunks,
      totalChunks: session.chunks.length,
      speed,
      eta,
    };

    this.emit('progress', progress);
  }

  // ==========================================================================
  // Event System
  // ==========================================================================

  /**
   * Add event listener
   */
  on<K extends keyof UploadEvents>(
    event: K,
    listener: UploadEventListener<K>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    return () => this.off(event, listener);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof UploadEvents>(
    event: K,
    listener: UploadEventListener<K>
  ): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Emit event
   */
  private emit<K extends keyof UploadEvents>(
    event: K,
    data: UploadEvents[K]
  ): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          console.error(`[ChunkedUploader] Error in ${event} handler:`, error);
        }
      }
    }
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return `upload-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Mock Endpoint (for testing)
// ============================================================================

/**
 * Mock upload endpoint for testing
 */
export class MockUploadEndpoint implements UploadEndpoint {
  private uploads: Map<string, { chunks: Set<number>; finalized: boolean }> = new Map();

  async handshake(
    fileName: string,
    fileSize: number,
    fileHash: string,
    chunkHashes: string[],
    mimeType: string
  ): Promise<HandshakeResponse> {
    const sessionId = `mock-${Date.now()}`;

    this.uploads.set(sessionId, {
      chunks: new Set(),
      finalized: false,
    });

    return {
      sessionId,
      isDuplicate: false,
      neededChunks: chunkHashes.map((_, i) => i),
      existingChunks: [],
    };
  }

  async uploadChunk(
    sessionId: string,
    chunkIndex: number,
    data: ArrayBuffer,
    hash: string
  ): Promise<void> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 100));

    const upload = this.uploads.get(sessionId);
    if (!upload) {
      throw new Error('Session not found');
    }

    upload.chunks.add(chunkIndex);
  }

  async finalize(sessionId: string): Promise<{ bookId: string }> {
    const upload = this.uploads.get(sessionId);
    if (!upload) {
      throw new Error('Session not found');
    }

    upload.finalized = true;

    return {
      bookId: `book-${Date.now()}`,
    };
  }

  async cancel(sessionId: string): Promise<void> {
    this.uploads.delete(sessionId);
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a chunked uploader
 */
export function createChunkedUploader(
  endpoint: UploadEndpoint,
  config?: Partial<ChunkedUploaderConfig>
): ChunkedUploader {
  return new ChunkedUploader(endpoint, config);
}
