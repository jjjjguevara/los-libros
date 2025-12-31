/**
 * SQL Queries for Calibre metadata.db
 *
 * Calibre uses SQLite with the following key tables:
 * - books: Core book metadata
 * - authors, books_authors_link: Author relationships
 * - series, books_series_link: Series relationships
 * - tags, books_tags_link: Tag relationships
 * - publishers, books_publishers_link: Publisher relationships
 * - languages, books_languages_link: Language relationships
 * - data: File formats (EPUB, PDF, etc.)
 * - identifiers: ISBN, UUID, etc.
 * - ratings, books_ratings_link: Star ratings
 * - comments: Book descriptions (HTML)
 * - custom_columns: Custom column definitions
 */

// =============================================================================
// Book Queries
// =============================================================================

/**
 * Get all books with basic metadata
 */
export const GET_ALL_BOOKS = `
  SELECT
    id,
    title,
    sort,
    timestamp,
    pubdate,
    series_index,
    author_sort,
    isbn,
    lccn,
    path,
    flags,
    uuid,
    has_cover,
    last_modified
  FROM books
  ORDER BY sort
`;

/**
 * Get a single book by ID
 */
export const GET_BOOK_BY_ID = `
  SELECT
    id,
    title,
    sort,
    timestamp,
    pubdate,
    series_index,
    author_sort,
    isbn,
    lccn,
    path,
    flags,
    uuid,
    has_cover,
    last_modified
  FROM books
  WHERE id = ?
`;

/**
 * Get a book by UUID
 */
export const GET_BOOK_BY_UUID = `
  SELECT
    id,
    title,
    sort,
    timestamp,
    pubdate,
    series_index,
    author_sort,
    isbn,
    lccn,
    path,
    flags,
    uuid,
    has_cover,
    last_modified
  FROM books
  WHERE uuid = ?
`;

/**
 * Search books by title (case-insensitive)
 */
export const SEARCH_BOOKS_BY_TITLE = `
  SELECT
    id,
    title,
    sort,
    timestamp,
    pubdate,
    series_index,
    author_sort,
    isbn,
    path,
    uuid,
    has_cover,
    last_modified
  FROM books
  WHERE title LIKE ? OR sort LIKE ?
  ORDER BY sort
`;

// =============================================================================
// Author Queries
// =============================================================================

/**
 * Get all authors for a book
 */
export const GET_AUTHORS_FOR_BOOK = `
  SELECT a.id, a.name, a.sort, a.link
  FROM authors a
  JOIN books_authors_link bal ON a.id = bal.author
  WHERE bal.book = ?
  ORDER BY a.sort
`;

/**
 * Get all authors
 */
export const GET_ALL_AUTHORS = `
  SELECT id, name, sort, link
  FROM authors
  ORDER BY sort
`;

/**
 * Get book count for an author
 */
export const GET_AUTHOR_BOOK_COUNT = `
  SELECT COUNT(*) as count
  FROM books_authors_link
  WHERE author = ?
`;

// =============================================================================
// Series Queries
// =============================================================================

/**
 * Get series for a book
 */
export const GET_SERIES_FOR_BOOK = `
  SELECT s.id, s.name, s.sort
  FROM series s
  JOIN books_series_link bsl ON s.id = bsl.series
  WHERE bsl.book = ?
`;

/**
 * Get all series
 */
export const GET_ALL_SERIES = `
  SELECT id, name, sort
  FROM series
  ORDER BY sort
`;

/**
 * Get books in a series
 */
export const GET_BOOKS_IN_SERIES = `
  SELECT b.id, b.title, b.series_index
  FROM books b
  JOIN books_series_link bsl ON b.id = bsl.book
  WHERE bsl.series = ?
  ORDER BY b.series_index
`;

// =============================================================================
// Tag Queries
// =============================================================================

/**
 * Get all tags for a book
 */
export const GET_TAGS_FOR_BOOK = `
  SELECT t.id, t.name
  FROM tags t
  JOIN books_tags_link btl ON t.id = btl.tag
  WHERE btl.book = ?
  ORDER BY t.name
`;

/**
 * Get all tags
 */
export const GET_ALL_TAGS = `
  SELECT id, name
  FROM tags
  ORDER BY name
`;

// =============================================================================
// Publisher Queries
// =============================================================================

/**
 * Get publisher for a book
 */
export const GET_PUBLISHER_FOR_BOOK = `
  SELECT p.id, p.name, p.sort
  FROM publishers p
  JOIN books_publishers_link bpl ON p.id = bpl.publisher
  WHERE bpl.book = ?
`;

// =============================================================================
// Language Queries
// =============================================================================

/**
 * Get languages for a book
 */
export const GET_LANGUAGES_FOR_BOOK = `
  SELECT l.id, l.lang_code
  FROM languages l
  JOIN books_languages_link bll ON l.id = bll.lang_code
  WHERE bll.book = ?
`;

// =============================================================================
// Format/Data Queries
// =============================================================================

/**
 * Get all formats for a book
 */
export const GET_FORMATS_FOR_BOOK = `
  SELECT id, book, format, uncompressed_size, name
  FROM data
  WHERE book = ?
`;

/**
 * Get EPUB format for a book
 */
export const GET_EPUB_FOR_BOOK = `
  SELECT id, book, format, uncompressed_size, name
  FROM data
  WHERE book = ? AND format = 'EPUB'
`;

// =============================================================================
// Identifier Queries
// =============================================================================

/**
 * Get all identifiers for a book
 */
export const GET_IDENTIFIERS_FOR_BOOK = `
  SELECT id, book, type, val
  FROM identifiers
  WHERE book = ?
`;

// =============================================================================
// Rating Queries
// =============================================================================

/**
 * Get rating for a book (Calibre stores 0-10, we return 0-5)
 */
export const GET_RATING_FOR_BOOK = `
  SELECT r.id, r.rating / 2 as rating
  FROM ratings r
  JOIN books_ratings_link brl ON r.id = brl.rating
  WHERE brl.book = ?
`;

// =============================================================================
// Comment/Description Queries
// =============================================================================

/**
 * Get description for a book
 */
export const GET_COMMENT_FOR_BOOK = `
  SELECT id, book, text
  FROM comments
  WHERE book = ?
`;

// =============================================================================
// Custom Column Queries
// =============================================================================

/**
 * Get all custom column definitions
 */
export const GET_CUSTOM_COLUMNS = `
  SELECT id, label, name, datatype, display, is_multiple, normalized, editable
  FROM custom_columns
  ORDER BY id
`;

/**
 * Get custom column value for a book
 * Note: Custom column tables are dynamically named custom_column_N
 * This is a template - replace {N} with the column ID
 */
export const GET_CUSTOM_COLUMN_VALUE = `
  SELECT value
  FROM custom_column_{N}
  WHERE book = ?
`;

// =============================================================================
// Write Queries (for bidirectional sync)
// =============================================================================

/**
 * Update book rating
 * First get or create the rating, then link it
 */
export const UPSERT_RATING = `
  INSERT OR REPLACE INTO ratings (rating) VALUES (?)
`;

export const LINK_BOOK_RATING = `
  INSERT OR REPLACE INTO books_ratings_link (book, rating)
  VALUES (?, (SELECT id FROM ratings WHERE rating = ?))
`;

/**
 * Add a tag to a book
 */
export const ADD_TAG_TO_BOOK = `
  INSERT OR IGNORE INTO books_tags_link (book, tag)
  VALUES (?, (SELECT id FROM tags WHERE name = ?))
`;

/**
 * Create a new tag if it doesn't exist
 */
export const CREATE_TAG = `
  INSERT OR IGNORE INTO tags (name) VALUES (?)
`;

/**
 * Remove a tag from a book
 */
export const REMOVE_TAG_FROM_BOOK = `
  DELETE FROM books_tags_link
  WHERE book = ? AND tag = (SELECT id FROM tags WHERE name = ?)
`;

/**
 * Update book last_modified timestamp
 */
export const UPDATE_BOOK_MODIFIED = `
  UPDATE books SET last_modified = ? WHERE id = ?
`;
