/**
 * Deduplication Module
 *
 * Content-based deduplication for efficient storage:
 * - SHA-256 content hashing
 * - Reference counting
 * - Automatic cleanup
 *
 * @module dedup
 * @see docs/specifications/file-system-architecture.md
 */

export type {
  HashAlgorithm,
  DedupEntry,
  DedupReference,
  DedupResult,
  DedupStats,
  DedupStorage,
  DedupManagerConfig,
} from './deduplication-manager';

export {
  DeduplicationManager,
  InMemoryDedupStorage,
  getDeduplicationManager,
  createDeduplicationManager,
  DEFAULT_DEDUP_CONFIG,
} from './deduplication-manager';
