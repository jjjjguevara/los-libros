/**
 * Generators Module
 *
 * Exports all note and file generators for Calibre integration.
 */

export { BookNoteGenerator, DEFAULT_CALIBRE_BOOK_TEMPLATE } from './book-note-generator';
export { AuthorIndexGenerator, DEFAULT_AUTHOR_INDEX_TEMPLATE } from './author-index-generator';
export { SeriesIndexGenerator, DEFAULT_SERIES_INDEX_TEMPLATE } from './series-index-generator';
export { ShelfIndexGenerator, DEFAULT_SHELF_INDEX_TEMPLATE } from './shelf-index-generator';
export { BaseFileGenerator } from './base-file-generator';
export type { BaseFileConfig } from './base-file-generator';
