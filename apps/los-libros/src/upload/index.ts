/**
 * Upload Module
 *
 * Chunked upload support for large EPUBs:
 * - Up2k-inspired protocol
 * - Resumable uploads
 * - Web Worker hashing
 * - Progress tracking
 *
 * @module upload
 * @see docs/specifications/file-system-architecture.md
 */

export type {
  UploadSession,
  ChunkInfo,
  ChunkStatus,
  UploadStatus,
  UploadProgress,
  HandshakeResponse,
  UploadEvents,
  UploadEventListener,
  ChunkedUploaderConfig,
} from './chunked-uploader';

export {
  ChunkedUploader,
  createChunkedUploader,
  DEFAULT_UPLOADER_CONFIG,
} from './chunked-uploader';
