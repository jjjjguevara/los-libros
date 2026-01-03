/**
 * Unified Book Type
 *
 * Represents a book with data consolidated from multiple sources.
 * This is the canonical representation used throughout the plugin.
 */

import type { BookSource, BookSourceType, SerializedBookSource } from './book-source';
import { deserializeSource, serializeSource } from './book-source';

/**
 * Author representation
 */
export interface Author {
  name: string;
  sortName?: string;
  link?: string; // Link to author note
}

/**
 * Series representation
 */
export interface Series {
  name: string;
  index?: number;
  link?: string; // Link to series note
}

/**
 * Reading status
 */
export type ReadingStatus = 'to-read' | 'reading' | 'completed' | 'archived' | 'abandoned';

/**
 * Book format
 */
export interface BookFormat {
  type: 'epub' | 'pdf' | 'mobi' | 'azw3' | 'cbz' | 'cbr' | 'fb2';
  path: string;
  size?: number;
}

/**
 * Unified Book
 *
 * The central book model that aggregates data from all sources.
 */
export interface UnifiedBook {
  /** Plugin-generated UUID */
  id: string;

  /** ISBN (if available) */
  isbn?: string;

  /** Calibre UUID (if synced from Calibre) */
  calibreUuid?: string;

  // ==========================================================================
  // Metadata
  // ==========================================================================

  /** Book title */
  title: string;

  /** Title for sorting (e.g., "Lord of the Rings, The") */
  titleSort?: string;

  /** Authors (primary author first) */
  authors: Author[];

  /** Series information */
  series?: Series;

  /** Book description/summary */
  description?: string;

  /** Publisher */
  publisher?: string;

  /** Publication date */
  publishedDate?: Date;

  /** Language code (e.g., "en", "es") */
  language?: string;

  /** User-assigned tags */
  tags: string[];

  /** User rating (1-5) */
  rating?: number;

  // ==========================================================================
  // Sources
  // ==========================================================================

  /** All sources for this book (can have multiple) */
  sources: BookSource[];

  /** Primary source type for reading */
  primarySourceType?: BookSourceType;

  /** Available formats */
  formats: BookFormat[];

  // ==========================================================================
  // Reading State
  // ==========================================================================

  /** Current reading status */
  status: ReadingStatus;

  /** Reading progress (0-100) */
  progress: number;

  /** Current position (CFI for EPUB) */
  currentCfi?: string;

  /** Current chapter name */
  currentChapter?: string;

  /** Total pages (if known) */
  totalPages?: number;

  /** Current page (if paginated) */
  currentPage?: number;

  /** When the book was last read */
  lastReadAt?: Date;

  /** When reading was started */
  startedReadingAt?: Date;

  /** When reading was completed */
  completedAt?: Date;

  // ==========================================================================
  // Notes Integration
  // ==========================================================================

  /** Path to the book note in vault */
  notePath?: string;

  /** Path to the florilegio (highlights/notes hub) folder */
  florilegioPath?: string;

  /** Cover image path (vault-relative) */
  coverPath?: string;

  /** Cover URL (remote) */
  coverUrl?: string;

  // ==========================================================================
  // Sync State
  // ==========================================================================

  /** When the book was first added */
  addedAt: Date;

  /** When the book was last synced */
  lastSyncedAt?: Date;

  /** Whether changes need to be synced */
  needsSync?: boolean;
}

/**
 * Serialized unified book for frontmatter storage
 */
export interface SerializedUnifiedBook {
  id: string;
  isbn?: string;
  calibreUuid?: string;

  title: string;
  titleSort?: string;
  authors: Author[];
  series?: Series;
  description?: string;
  publisher?: string;
  publishedDate?: string;
  language?: string;
  tags: string[];
  rating?: number;

  sources: SerializedBookSource[];
  primarySourceType?: BookSourceType;
  formats: BookFormat[];

  status: ReadingStatus;
  progress: number;
  currentCfi?: string;
  currentChapter?: string;
  totalPages?: number;
  currentPage?: number;
  lastReadAt?: string;
  startedReadingAt?: string;
  completedAt?: string;

  notePath?: string;
  florilegioPath?: string;
  coverPath?: string;
  coverUrl?: string;

  addedAt: string;
  lastSyncedAt?: string;
  needsSync?: boolean;
}

/**
 * Serialize a UnifiedBook for frontmatter storage
 */
export function serializeBook(book: UnifiedBook): SerializedUnifiedBook {
  return {
    id: book.id,
    isbn: book.isbn,
    calibreUuid: book.calibreUuid,

    title: book.title,
    titleSort: book.titleSort,
    authors: book.authors,
    series: book.series,
    description: book.description,
    publisher: book.publisher,
    publishedDate: book.publishedDate?.toISOString(),
    language: book.language,
    tags: book.tags,
    rating: book.rating,

    sources: book.sources.map(serializeSource),
    primarySourceType: book.primarySourceType,
    formats: book.formats,

    status: book.status,
    progress: book.progress,
    currentCfi: book.currentCfi,
    currentChapter: book.currentChapter,
    totalPages: book.totalPages,
    currentPage: book.currentPage,
    lastReadAt: book.lastReadAt?.toISOString(),
    startedReadingAt: book.startedReadingAt?.toISOString(),
    completedAt: book.completedAt?.toISOString(),

    notePath: book.notePath,
    florilegioPath: book.florilegioPath,
    coverPath: book.coverPath,
    coverUrl: book.coverUrl,

    addedAt: book.addedAt.toISOString(),
    lastSyncedAt: book.lastSyncedAt?.toISOString(),
    needsSync: book.needsSync,
  };
}

/**
 * Deserialize a UnifiedBook from frontmatter
 */
export function deserializeBook(data: SerializedUnifiedBook): UnifiedBook {
  return {
    id: data.id,
    isbn: data.isbn,
    calibreUuid: data.calibreUuid,

    title: data.title,
    titleSort: data.titleSort,
    authors: data.authors || [],
    series: data.series,
    description: data.description,
    publisher: data.publisher,
    publishedDate: data.publishedDate ? new Date(data.publishedDate) : undefined,
    language: data.language,
    tags: data.tags || [],
    rating: data.rating,

    sources: (data.sources || []).map(deserializeSource),
    primarySourceType: data.primarySourceType,
    formats: data.formats || [],

    status: data.status || 'to-read',
    progress: data.progress || 0,
    currentCfi: data.currentCfi,
    currentChapter: data.currentChapter,
    totalPages: data.totalPages,
    currentPage: data.currentPage,
    lastReadAt: data.lastReadAt ? new Date(data.lastReadAt) : undefined,
    startedReadingAt: data.startedReadingAt ? new Date(data.startedReadingAt) : undefined,
    completedAt: data.completedAt ? new Date(data.completedAt) : undefined,

    notePath: data.notePath,
    florilegioPath: data.florilegioPath,
    coverPath: data.coverPath,
    coverUrl: data.coverUrl,

    addedAt: new Date(data.addedAt),
    lastSyncedAt: data.lastSyncedAt ? new Date(data.lastSyncedAt) : undefined,
    needsSync: data.needsSync,
  };
}

/**
 * Get the primary author name
 */
export function getPrimaryAuthor(book: UnifiedBook): string {
  return book.authors[0]?.name || 'Unknown Author';
}

/**
 * Get the primary author sort name
 */
export function getPrimaryAuthorSort(book: UnifiedBook): string {
  return book.authors[0]?.sortName || book.authors[0]?.name || 'Unknown Author';
}

/**
 * Get a display string for all authors
 */
export function getAuthorsDisplay(book: UnifiedBook): string {
  if (book.authors.length === 0) return 'Unknown Author';
  if (book.authors.length === 1) return book.authors[0].name;
  if (book.authors.length === 2) {
    return `${book.authors[0].name} and ${book.authors[1].name}`;
  }
  return `${book.authors[0].name} et al.`;
}

/**
 * Check if a book has a vault copy
 */
export function hasVaultCopy(book: UnifiedBook): boolean {
  return book.sources.some(s => s.type === 'vault-copy');
}

/**
 * Get the vault copy source if it exists
 */
export function getVaultCopySource(book: UnifiedBook) {
  return book.sources.find(s => s.type === 'vault-copy');
}

/**
 * Check if a book is available offline (has vault copy)
 */
export function isAvailableOffline(book: UnifiedBook): boolean {
  return hasVaultCopy(book);
}

/**
 * Get the best available source for reading
 */
export function getBestReadingSource(book: UnifiedBook): BookSource | undefined {
  // Sort by priority (lower = better)
  const sorted = [...book.sources].sort((a, b) => a.priority - b.priority);

  // Prefer vault copy for offline access
  const vaultCopy = sorted.find(s => s.type === 'vault-copy');
  if (vaultCopy) return vaultCopy;

  // Then local Calibre
  const calibreLocal = sorted.find(s => s.type === 'calibre-local');
  if (calibreLocal) return calibreLocal;

  // Then Calibre web
  const calibreWeb = sorted.find(s => s.type === 'calibre-web');
  if (calibreWeb) return calibreWeb;

  // Finally OPDS
  return sorted.find(s => s.type === 'opds');
}

/**
 * Create a new empty book
 */
export function createEmptyBook(title: string, author?: string): UnifiedBook {
  const id = crypto.randomUUID();
  const now = new Date();

  return {
    id,
    title,
    authors: author ? [{ name: author }] : [],
    tags: [],
    sources: [],
    formats: [],
    status: 'to-read',
    progress: 0,
    addedAt: now,
  };
}
