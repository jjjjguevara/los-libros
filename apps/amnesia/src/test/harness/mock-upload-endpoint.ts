/**
 * Mock Upload Endpoint
 *
 * Comprehensive mock implementation of the up2k-style upload protocol
 * with configurable error injection, latency simulation, and deduplication.
 *
 * @see docs/plans/unified-sync-architecture-prd.md
 */

import type {
  UploadEndpoint,
  HandshakeResponse,
} from '../../upload/chunked-uploader';

// ============================================================================
// Types
// ============================================================================

/**
 * Upload endpoint configuration
 */
export interface MockUploadConfig {
  /** Simulate network latency (min ms) */
  latencyMin: number;
  /** Simulate network latency (max ms) */
  latencyMax: number;
  /** Random failure rate (0-1) */
  failureRate: number;
  /** Specific chunk indices that should fail */
  chunkFailures: number[];
  /** Maximum allowed file size */
  maxFileSize: number;
  /** Whether to simulate deduplication */
  enableDeduplication: boolean;
  /** File hashes that are considered duplicates */
  duplicateHashes: Map<string, string>;
}

/**
 * Default configuration
 */
export const DEFAULT_UPLOAD_CONFIG: MockUploadConfig = {
  latencyMin: 10,
  latencyMax: 50,
  failureRate: 0,
  chunkFailures: [],
  maxFileSize: 500 * 1024 * 1024, // 500MB
  enableDeduplication: true,
  duplicateHashes: new Map(),
};

/**
 * Upload session state
 */
interface UploadSessionState {
  sessionId: string;
  fileName: string;
  fileSize: number;
  fileHash: string;
  chunkHashes: string[];
  mimeType: string;
  receivedChunks: Set<number>;
  startedAt: number;
  finalized: boolean;
  bookId?: string;
  /** Tracks chunks that have already failed once (for retry testing) */
  failedChunks: Set<number>;
}

/**
 * Recorded upload operation
 */
export interface RecordedUploadOp {
  timestamp: Date;
  operation: 'handshake' | 'uploadChunk' | 'finalize' | 'cancel';
  sessionId?: string;
  chunkIndex?: number;
  success: boolean;
  error?: string;
  data?: unknown;
}

// ============================================================================
// Mock Upload Endpoint
// ============================================================================

/**
 * Mock upload endpoint with full protocol support
 */
export class MockUploadEndpoint implements UploadEndpoint {
  private config: MockUploadConfig;
  private sessions = new Map<string, UploadSessionState>();
  private recordedOps: RecordedUploadOp[] = [];
  private uploadedChunks = new Map<string, Map<number, ArrayBuffer>>();

  constructor(config: Partial<MockUploadConfig> = {}) {
    this.config = { ...DEFAULT_UPLOAD_CONFIG, ...config };
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Update configuration
   */
  setConfig(config: Partial<MockUploadConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set specific chunks to fail
   */
  setChunkFailures(indices: number[]): void {
    this.config.chunkFailures = indices;
  }

  /**
   * Set failure rate
   */
  setFailureRate(rate: number): void {
    this.config.failureRate = Math.max(0, Math.min(1, rate));
  }

  /**
   * Add a duplicate hash mapping
   */
  addDuplicate(fileHash: string, existingBookId: string): void {
    this.config.duplicateHashes.set(fileHash, existingBookId);
  }

  /**
   * Reset to defaults
   */
  reset(): void {
    this.config = { ...DEFAULT_UPLOAD_CONFIG, duplicateHashes: new Map() };
    this.sessions.clear();
    this.recordedOps = [];
    this.uploadedChunks.clear();
  }

  // ==========================================================================
  // UploadEndpoint Implementation
  // ==========================================================================

  /**
   * Handshake - initiate upload session
   */
  async handshake(
    fileName: string,
    fileSize: number,
    fileHash: string,
    chunkHashes: string[],
    mimeType: string
  ): Promise<HandshakeResponse> {
    await this.simulateLatency();

    // Record operation
    const recordEntry: RecordedUploadOp = {
      timestamp: new Date(),
      operation: 'handshake',
      success: false,
      data: { fileName, fileSize, fileHash },
    };

    try {
      // Check for random failure
      if (this.shouldFail()) {
        throw new Error('Simulated handshake failure');
      }

      // Check file size
      if (fileSize > this.config.maxFileSize) {
        throw new Error(`File too large: ${fileSize} > ${this.config.maxFileSize}`);
      }

      // Check for duplicate
      if (this.config.enableDeduplication) {
        const existingBookId = this.config.duplicateHashes.get(fileHash);
        if (existingBookId) {
          const response: HandshakeResponse = {
            sessionId: this.generateSessionId(),
            isDuplicate: true,
            existingBookId,
            neededChunks: [],
            existingChunks: chunkHashes.map((_, i) => i),
          };

          recordEntry.success = true;
          recordEntry.data = { ...(recordEntry.data as object || {}), response };
          this.recordedOps.push(recordEntry);

          return response;
        }
      }

      // Create new session
      const sessionId = this.generateSessionId();
      const session: UploadSessionState = {
        sessionId,
        fileName,
        fileSize,
        fileHash,
        chunkHashes,
        mimeType,
        receivedChunks: new Set(),
        startedAt: Date.now(),
        finalized: false,
        failedChunks: new Set(),
      };

      this.sessions.set(sessionId, session);
      this.uploadedChunks.set(sessionId, new Map());

      const response: HandshakeResponse = {
        sessionId,
        isDuplicate: false,
        neededChunks: chunkHashes.map((_, i) => i),
        existingChunks: [],
      };

      recordEntry.success = true;
      recordEntry.sessionId = sessionId;
      recordEntry.data = { ...(recordEntry.data as object || {}), response };
      this.recordedOps.push(recordEntry);

      return response;
    } catch (error) {
      recordEntry.error = error instanceof Error ? error.message : String(error);
      this.recordedOps.push(recordEntry);
      throw error;
    }
  }

  /**
   * Upload a chunk
   */
  async uploadChunk(
    sessionId: string,
    chunkIndex: number,
    data: ArrayBuffer,
    hash: string
  ): Promise<void> {
    await this.simulateLatency();

    const recordEntry: RecordedUploadOp = {
      timestamp: new Date(),
      operation: 'uploadChunk',
      sessionId,
      chunkIndex,
      success: false,
    };

    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      if (session.finalized) {
        throw new Error('Session already finalized');
      }

      // Check for specific chunk failure (only fail once, then succeed on retry)
      if (this.config.chunkFailures.includes(chunkIndex) && !session.failedChunks.has(chunkIndex)) {
        session.failedChunks.add(chunkIndex);
        throw new Error(`Injected chunk ${chunkIndex} failure`);
      }

      // Check for random failure
      if (this.shouldFail()) {
        throw new Error('Simulated chunk upload failure');
      }

      // Verify hash
      if (session.chunkHashes[chunkIndex] !== hash) {
        throw new Error(`Hash mismatch for chunk ${chunkIndex}`);
      }

      // Verify chunk index
      if (chunkIndex < 0 || chunkIndex >= session.chunkHashes.length) {
        throw new Error(`Invalid chunk index: ${chunkIndex}`);
      }

      // Store chunk
      const chunks = this.uploadedChunks.get(sessionId)!;
      chunks.set(chunkIndex, data);
      session.receivedChunks.add(chunkIndex);

      recordEntry.success = true;
      this.recordedOps.push(recordEntry);
    } catch (error) {
      recordEntry.error = error instanceof Error ? error.message : String(error);
      this.recordedOps.push(recordEntry);
      throw error;
    }
  }

  /**
   * Finalize upload
   */
  async finalize(sessionId: string): Promise<{ bookId: string }> {
    await this.simulateLatency();

    const recordEntry: RecordedUploadOp = {
      timestamp: new Date(),
      operation: 'finalize',
      sessionId,
      success: false,
    };

    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      if (session.finalized) {
        throw new Error('Session already finalized');
      }

      // Check for random failure
      if (this.shouldFail()) {
        throw new Error('Simulated finalize failure');
      }

      // Verify all chunks received
      const missingChunks: number[] = [];
      for (let i = 0; i < session.chunkHashes.length; i++) {
        if (!session.receivedChunks.has(i)) {
          missingChunks.push(i);
        }
      }

      if (missingChunks.length > 0) {
        throw new Error(`Missing chunks: ${missingChunks.join(', ')}`);
      }

      // Generate book ID
      const bookId = `book-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      session.bookId = bookId;
      session.finalized = true;

      // Register as duplicate for future uploads
      if (this.config.enableDeduplication) {
        this.config.duplicateHashes.set(session.fileHash, bookId);
      }

      recordEntry.success = true;
      recordEntry.data = { bookId };
      this.recordedOps.push(recordEntry);

      return { bookId };
    } catch (error) {
      recordEntry.error = error instanceof Error ? error.message : String(error);
      this.recordedOps.push(recordEntry);
      throw error;
    }
  }

  /**
   * Cancel upload
   */
  async cancel(sessionId: string): Promise<void> {
    await this.simulateLatency();

    const recordEntry: RecordedUploadOp = {
      timestamp: new Date(),
      operation: 'cancel',
      sessionId,
      success: true,
    };

    this.sessions.delete(sessionId);
    this.uploadedChunks.delete(sessionId);
    this.recordedOps.push(recordEntry);
  }

  // ==========================================================================
  // State Inspection (for testing)
  // ==========================================================================

  /**
   * Get all recorded operations
   */
  getRecordedOps(): RecordedUploadOp[] {
    return [...this.recordedOps];
  }

  /**
   * Get session state
   */
  getSession(sessionId: string): UploadSessionState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions
   */
  getSessions(): UploadSessionState[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get uploaded chunks for a session
   */
  getUploadedChunks(sessionId: string): Map<number, ArrayBuffer> | undefined {
    return this.uploadedChunks.get(sessionId);
  }

  /**
   * Get finalized book IDs
   */
  getFinalizedBookIds(): string[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.finalized && s.bookId)
      .map((s) => s.bookId!);
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.sessions.clear();
    this.uploadedChunks.clear();
    this.recordedOps = [];
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private generateSessionId(): string {
    return `upload-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private async simulateLatency(): Promise<void> {
    const latency =
      this.config.latencyMin +
      Math.random() * (this.config.latencyMax - this.config.latencyMin);
    await new Promise((resolve) => setTimeout(resolve, latency));
  }

  private shouldFail(): boolean {
    return Math.random() < this.config.failureRate;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a mock upload endpoint
 */
export function createMockUploadEndpoint(
  config?: Partial<MockUploadConfig>
): MockUploadEndpoint {
  return new MockUploadEndpoint(config);
}
