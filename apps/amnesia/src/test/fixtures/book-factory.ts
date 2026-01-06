/**
 * Book Factory
 *
 * Factory functions for creating test book data.
 *
 * @see docs/plans/unified-sync-architecture-prd.md
 */

import type {
  CalibreBookFull,
  CalibreAuthor,
  CalibreSeries,
  CalibreTag,
  CalibrePublisher,
  CalibreLanguage,
  CalibreFormat,
} from '../../calibre/calibre-types';

// ============================================================================
// Author Factory
// ============================================================================

/**
 * Create a test author
 */
export function createAuthor(
  id: number,
  name: string,
  options: Partial<CalibreAuthor> = {}
): CalibreAuthor {
  return {
    id,
    name,
    sort: options.sort || name.split(' ').reverse().join(', '),
    link: options.link || '',
    ...options,
  };
}

// ============================================================================
// Series Factory
// ============================================================================

/**
 * Create a test series
 */
export function createSeries(
  id: number,
  name: string,
  options: Partial<CalibreSeries> = {}
): CalibreSeries {
  return {
    id,
    name,
    sort: options.sort || name,
    ...options,
  };
}

// ============================================================================
// Tag Factory
// ============================================================================

/**
 * Create a test tag
 */
export function createTag(id: number, name: string): CalibreTag {
  return { id, name };
}

// ============================================================================
// Publisher Factory
// ============================================================================

/**
 * Create a test publisher
 */
export function createPublisher(
  id: number,
  name: string,
  options: Partial<CalibrePublisher> = {}
): CalibrePublisher {
  return {
    id,
    name,
    sort: options.sort || name,
    ...options,
  };
}

// ============================================================================
// Language Factory
// ============================================================================

/**
 * Create a test language
 */
export function createLanguage(id: number, langCode: string): CalibreLanguage {
  return { id, lang_code: langCode };
}

// ============================================================================
// Format Factory
// ============================================================================

/**
 * Create a test format
 */
export function createFormat(
  id: number,
  bookId: number,
  format: string,
  options: Partial<CalibreFormat> = {}
): CalibreFormat {
  return {
    id,
    book: bookId,
    format,
    uncompressed_size: options.uncompressed_size || 1024 * 1024, // 1MB default
    name: options.name || 'book',
    ...options,
  };
}

// ============================================================================
// Book Factory
// ============================================================================

/**
 * Book creation options
 */
export interface BookOptions {
  authors?: CalibreAuthor[];
  series?: CalibreSeries | null;
  seriesIndex?: number | null;
  tags?: CalibreTag[];
  publisher?: CalibrePublisher | null;
  languages?: CalibreLanguage[];
  formats?: CalibreFormat[];
  identifiers?: Record<string, string>;
  rating?: number | null;
  description?: string | null;
  pubdate?: Date | null;
  hasCover?: boolean;
  coverPath?: string | null;
  epubPath?: string | null;
  calibrePath?: string;
  addedAt?: Date;
  lastModified?: Date;
}

/**
 * Create a test book
 */
export function createBook(
  id: number,
  title: string,
  options: BookOptions = {}
): CalibreBookFull {
  const uuid = options.identifiers?.uuid || crypto.randomUUID();
  const now = new Date();

  const authors = options.authors || [createAuthor(1, 'Unknown Author')];
  const authorPath = authors[0].name.replace(/[^a-zA-Z0-9]/g, '_');
  const titlePath = title.replace(/[^a-zA-Z0-9]/g, '_');
  const basePath = `/library/${authorPath}/${titlePath} (${id})`;

  return {
    id,
    uuid,
    title,
    titleSort: title,
    path: `${authorPath}/${titlePath} (${id})`,
    hasCover: options.hasCover ?? true,
    addedAt: options.addedAt || now,
    lastModified: options.lastModified || now,
    authors,
    series: options.series ?? null,
    seriesIndex: options.seriesIndex ?? null,
    tags: options.tags || [],
    publisher: options.publisher ?? null,
    languages: options.languages || [createLanguage(1, 'eng')],
    formats: options.formats || [createFormat(1, id, 'EPUB')],
    identifiers: options.identifiers || { uuid },
    rating: options.rating ?? null,
    description: options.description ?? null,
    pubdate: options.pubdate ?? null,
    coverPath: options.coverPath ?? (options.hasCover !== false ? `${basePath}/cover.jpg` : null),
    epubPath: options.epubPath ?? `${basePath}/${titlePath}.epub`,
    calibrePath: options.calibrePath || basePath,
  };
}

// ============================================================================
// Batch Creation
// ============================================================================

/**
 * Create multiple books
 */
export function createBooks(
  count: number,
  baseOptions: BookOptions = {}
): CalibreBookFull[] {
  return Array.from({ length: count }, (_, i) =>
    createBook(i + 1, `Book ${i + 1}`, {
      ...baseOptions,
      lastModified: new Date(Date.now() - i * 1000), // Stagger timestamps
    })
  );
}

/**
 * Create books with varying properties for testing
 */
export function createVariedBooks(count: number): CalibreBookFull[] {
  const authors = [
    createAuthor(1, 'Author One'),
    createAuthor(2, 'Author Two'),
    createAuthor(3, 'Author Three'),
  ];

  const series = [
    createSeries(1, 'Series A'),
    createSeries(2, 'Series B'),
  ];

  const tags = [
    createTag(1, 'fiction'),
    createTag(2, 'nonfiction'),
    createTag(3, 'classic'),
  ];

  return Array.from({ length: count }, (_, i) => {
    const hasSeries = i % 3 === 0;
    const tagCount = (i % 3) + 1;

    return createBook(i + 1, `Varied Book ${i + 1}`, {
      authors: [authors[i % authors.length]],
      series: hasSeries ? series[i % series.length] : null,
      seriesIndex: hasSeries ? Math.floor(i / 3) + 1 : null,
      tags: tags.slice(0, tagCount),
      rating: (i % 5) + 1,
      hasCover: i % 2 === 0,
      description: i % 4 === 0 ? `Description for book ${i + 1}` : null,
      lastModified: new Date(Date.now() - i * 60000), // 1 minute apart
    });
  });
}

// ============================================================================
// Edge Cases
// ============================================================================

/**
 * Create book with Unicode characters
 */
export function createUnicodeBook(id: number): CalibreBookFull {
  return createBook(id, 'Los Miserables: «Une révolution»', {
    authors: [createAuthor(id, 'Víctor Hugo')],
    tags: [createTag(1, '文学'), createTag(2, 'littérature')],
    description: 'A novel featuring émigré characters and 日本語 text.',
  });
}

/**
 * Create book with missing metadata
 */
export function createSparseBook(id: number): CalibreBookFull {
  return createBook(id, 'Minimal Book', {
    authors: [],
    series: null,
    tags: [],
    publisher: null,
    rating: null,
    description: null,
    hasCover: false,
  });
}

/**
 * Create book with large metadata
 */
export function createLargeMetadataBook(id: number): CalibreBookFull {
  const manyTags = Array.from({ length: 50 }, (_, i) => createTag(i + 1, `tag-${i + 1}`));
  const manyFormats = ['EPUB', 'PDF', 'MOBI', 'AZW3', 'FB2'].map((f, i) =>
    createFormat(i + 1, id, f, { uncompressed_size: (i + 1) * 10 * 1024 * 1024 })
  );
  const longDescription = 'A'.repeat(10000);

  return createBook(id, 'Book with Lots of Metadata', {
    tags: manyTags,
    formats: manyFormats,
    description: longDescription,
    identifiers: {
      uuid: crypto.randomUUID(),
      isbn: '978-3-16-148410-0',
      amazon: 'B00ABC123',
      goodreads: '12345678',
    },
  });
}
