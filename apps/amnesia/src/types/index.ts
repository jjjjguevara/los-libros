/**
 * Core Types Module
 *
 * Exports the core type definitions for the Amnesia plugin.
 */

// Book Source Types
export type {
  BookSourceType,
  BookSourceBase,
  CalibreLocalSource,
  CalibreWebSource,
  OPDSSource,
  VaultCopySource,
  BookSource,
  SerializedBookSource,
} from './book-source';

export {
  serializeSource,
  deserializeSource,
  getSourceTypeName,
  getSourceTypeIcon,
} from './book-source';

// Unified Book Type
export type {
  Author,
  Series,
  ReadingStatus,
  BookFormat,
  UnifiedBook,
  SerializedUnifiedBook,
} from './unified-book';

export {
  serializeBook,
  deserializeBook,
  getPrimaryAuthor,
  getPrimaryAuthorSort,
  getAuthorsDisplay,
  hasVaultCopy,
  getVaultCopySource,
  isAvailableOffline,
  getBestReadingSource,
  createEmptyBook,
} from './unified-book';
