/**
 * Calibre Integration Types for Amnesia
 * Full bidirectional sync with Calibre library
 */

// =============================================================================
// Calibre Database Types (from metadata.db schema)
// =============================================================================

/**
 * Calibre book record from the 'books' table
 */
export interface CalibreBook {
  id: number;
  title: string;
  sort: string;                     // Title sort
  timestamp: string;                // Added to Calibre
  pubdate: string | null;           // Publication date
  series_index: number;             // Position in series
  author_sort: string;
  isbn: string | null;
  lccn: string | null;
  path: string;                     // Relative path: Author/Title (ID)
  flags: number;
  uuid: string;
  has_cover: boolean;
  last_modified: string;
}

/**
 * Calibre author record
 */
export interface CalibreAuthor {
  id: number;
  name: string;
  sort: string;
  link: string;
}

/**
 * Calibre series record
 */
export interface CalibreSeries {
  id: number;
  name: string;
  sort: string;
}

/**
 * Calibre tag record
 */
export interface CalibreTag {
  id: number;
  name: string;
}

/**
 * Calibre publisher record
 */
export interface CalibrePublisher {
  id: number;
  name: string;
  sort: string;
}

/**
 * Calibre language record
 */
export interface CalibreLanguage {
  id: number;
  lang_code: string;
}

/**
 * Calibre format/data record
 */
export interface CalibreFormat {
  id: number;
  book: number;
  format: string;                   // EPUB, PDF, MOBI, etc.
  uncompressed_size: number;
  name: string;                     // Filename without extension
}

/**
 * Calibre identifier record (ISBN, UUID, etc.)
 */
export interface CalibreIdentifier {
  id: number;
  book: number;
  type: string;                     // isbn, uuid, amazon, goodreads, etc.
  val: string;
}

/**
 * Calibre rating record (0-10 scale, displayed as 0-5 stars)
 */
export interface CalibreRating {
  id: number;
  rating: number;                   // 0, 2, 4, 6, 8, 10 (2 per star)
}

/**
 * Calibre comment/description record
 */
export interface CalibreComment {
  id: number;
  book: number;
  text: string;                     // HTML content
}

/**
 * Custom column definition
 */
export interface CalibreCustomColumn {
  id: number;
  label: string;                    // Internal name
  name: string;                     // Display name
  datatype: CalibreCustomColumnType;
  display: string;                  // JSON display options
  is_multiple: boolean;
  normalized: boolean;
  editable: boolean;
}

export type CalibreCustomColumnType =
  | 'text'
  | 'comments'
  | 'int'
  | 'float'
  | 'datetime'
  | 'bool'
  | 'series'
  | 'enumeration'
  | 'rating';

// =============================================================================
// Hydrated Book Types (joined from multiple tables)
// =============================================================================

/**
 * Complete book with all metadata from Calibre
 */
export interface CalibreBookFull {
  // From books table
  id: number;
  uuid: string;
  title: string;
  titleSort: string;
  path: string;                     // Relative to library root
  hasCover: boolean;
  addedAt: Date;
  lastModified: Date;

  // From joined tables
  authors: CalibreAuthor[];
  series: CalibreSeries | null;
  seriesIndex: number | null;
  tags: CalibreTag[];
  publisher: CalibrePublisher | null;
  languages: CalibreLanguage[];
  formats: CalibreFormat[];
  identifiers: Record<string, string>;  // type -> val
  rating: number | null;                 // 0-5 normalized
  description: string | null;            // HTML from comments
  pubdate: Date | null;

  // Computed paths
  coverPath: string | null;         // Full path to cover.jpg
  epubPath: string | null;          // Full path to .epub file
  calibrePath: string;              // Full path to book folder
}

// =============================================================================
// OPF Metadata Types (from metadata.opf XML)
// =============================================================================

/**
 * Dublin Core metadata from metadata.opf
 */
export interface OPFMetadata {
  title: string;
  titleSort?: string;
  creators: OPFCreator[];
  description?: string;
  publisher?: string;
  date?: string;                    // Publication date
  language?: string;
  subjects: string[];               // Tags/subjects
  identifiers: OPFIdentifier[];
  series?: {
    name: string;
    index: number;
  };

  // Calibre-specific metadata (meta tags)
  calibreTimestamp?: string;
  calibreRating?: number;
  calibreAuthorLinkMap?: Record<string, string>;
  customColumns?: Record<string, unknown>;
}

export interface OPFCreator {
  name: string;
  role?: string;                    // aut, edt, etc.
  fileAs?: string;                  // Sort name
}

export interface OPFIdentifier {
  scheme: string;                   // isbn, uuid, calibre, amazon, etc.
  value: string;
}

// =============================================================================
// Sync Types
// =============================================================================

/**
 * Fields that can be synced bidirectionally
 */
export type SyncableField =
  | 'status'
  | 'rating'
  | 'tags'
  | 'progress'
  | 'highlights';

/**
 * Sync direction options
 */
export type SyncDirection =
  | 'to-obsidian'
  | 'to-calibre'
  | 'bidirectional';

/**
 * Conflict resolution strategies
 */
export type ConflictResolution =
  | 'last-write'
  | 'prefer-calibre'
  | 'prefer-obsidian';

/**
 * Change record for sync tracking
 */
export interface SyncChange {
  id: string;
  bookId: string;
  calibreId: number;
  field: SyncableField;
  oldValue: unknown;
  newValue: unknown;
  source: 'obsidian' | 'calibre';
  timestamp: Date;
  synced: boolean;
}

/**
 * Sync status for a book
 */
export interface SyncStatus {
  bookId: string;
  calibreId: number;
  lastSyncedAt: Date | null;
  lastModifiedObsidian: Date | null;
  lastModifiedCalibre: Date | null;
  pendingChanges: SyncChange[];
  hasConflicts: boolean;
}

// =============================================================================
// Content Server Types
// =============================================================================

/**
 * Calibre Content Server book entry
 */
export interface ContentServerBook {
  id: number;
  uuid: string;
  title: string;
  authors: string[];
  series: string | null;
  seriesIndex: number | null;
  tags: string[];
  rating: number | null;
  formats: string[];
  coverUrl: string;
  epubUrl: string | null;
}

/**
 * Content Server search result
 */
export interface ContentServerSearchResult {
  books: ContentServerBook[];
  total: number;
  offset: number;
  limit: number;
}

// =============================================================================
// Note Generation Types
// =============================================================================

/**
 * Book note frontmatter schema for Obsidian
 */
export interface BookNoteFrontmatter {
  type: 'book';
  bookId: string;                   // Internal UUID
  calibreId: number;                // Calibre database ID
  title: string;
  author: string;                   // Wikilink to author note
  series?: string;                  // Wikilink to series note
  seriesIndex?: number;
  bookshelves: string[];            // Wikilinks to shelf notes
  tags: string[];                   // Hashtag-style tags
  rating?: number;                  // 0-5
  coverUrl: string;                 // Vault path to cover
  progress: number;                 // 0-100
  status: BookReadingStatus;
  language?: string;
  publisher?: string;
  publishedDate?: string;           // ISO date
  isbn?: string;
  epubPath: string;                 // Absolute path to EPUB
  calibrePath: string;              // Absolute path to Calibre folder
  lastSync: string;                 // ISO timestamp
}

export type BookReadingStatus =
  | 'to-read'
  | 'reading'
  | 'completed'
  | 'archived';

/**
 * Author index note frontmatter
 */
export interface AuthorNoteFrontmatter {
  type: 'author';
  name: string;
  sortName: string;
  bookCount: number;
  lastSync: string;
}

/**
 * Series index note frontmatter
 */
export interface SeriesNoteFrontmatter {
  type: 'series';
  name: string;
  bookCount: number;
  lastSync: string;
}

/**
 * Bookshelf/tag index note frontmatter
 */
export interface ShelfNoteFrontmatter {
  type: 'shelf';
  name: string;
  bookCount: number;
  lastSync: string;
}

// =============================================================================
// Base File Types (Obsidian Bases API)
// =============================================================================

/**
 * Obsidian .base file structure
 */
export interface BaseFile {
  filters: string[];
  properties: Record<string, BaseProperty>;
  views: BaseView[];
}

export interface BaseProperty {
  displayName: string;
  hidden?: boolean;
}

export interface BaseView {
  type: 'table' | 'card' | 'list';
  name: string;
  imageProperty?: string;           // For card view
  filters?: string[];
  order?: string[];
}

// =============================================================================
// Calibre Service State
// =============================================================================

/**
 * Sync progress tracking
 */
export interface SyncProgress {
  phase: 'idle' | 'scanning' | 'generating-notes' | 'copying-covers' | 'generating-indexes' | 'complete';
  currentItem: number;
  totalItems: number;
  currentItemName: string;
  percentage: number;
}

/**
 * State for the Calibre service reducer
 */
export interface CalibreState {
  // Connection status
  connected: boolean;
  libraryPath: string | null;
  lastScanned: Date | null;

  // Books
  books: CalibreBookFull[];
  loading: boolean;
  error: string | null;

  // Sync status
  syncInProgress: boolean;
  lastSyncedAt: Date | null;
  pendingSync: SyncChange[];

  // Sync progress
  syncProgress: SyncProgress;
}

/**
 * Actions for Calibre reducer
 */
export type CalibreAction =
  | { type: 'SET_LIBRARY_PATH'; path: string }
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'SET_BOOKS'; books: CalibreBookFull[] }
  | { type: 'ADD_BOOK'; book: CalibreBookFull }
  | { type: 'UPDATE_BOOK'; id: number; updates: Partial<CalibreBookFull> }
  | { type: 'REMOVE_BOOK'; id: number }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'START_SYNC' }
  | { type: 'UPDATE_SYNC_PROGRESS'; progress: Partial<SyncProgress> }
  | { type: 'COMPLETE_SYNC'; timestamp: Date }
  | { type: 'ADD_PENDING_CHANGE'; change: SyncChange }
  | { type: 'CLEAR_PENDING_CHANGES' };
