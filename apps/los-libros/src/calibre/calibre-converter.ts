/**
 * Calibre Converter
 *
 * Converts between Calibre types and UnifiedBook types.
 */

import type { CalibreBookFull, CalibreAuthor, CalibreSeries, BookReadingStatus } from './calibre-types';
import type { UnifiedBook, Author, Series } from '../types/unified-book';
import type { CalibreLocalSource } from '../types/book-source';
import type { LibrosSettings } from '../settings/settings';

/**
 * Convert a CalibreBookFull to UnifiedBook
 */
export function calibreBookToUnified(
  book: CalibreBookFull,
  settings: LibrosSettings,
  existingProgress?: number,
  existingStatus?: BookReadingStatus
): UnifiedBook {
  // Build authors
  const authors: Author[] = book.authors.map(a => ({
    name: a.name,
    sortName: a.sort,
    link: `[[${settings.calibreAuthorIndexFolder}/${a.name}|${a.name}]]`,
  }));

  // Build series
  const series: Series | undefined = book.series ? {
    name: book.series.name,
    index: book.seriesIndex ?? 1,
    link: `[[${settings.calibreSeriesIndexFolder}/${book.series.name}|${book.series.name}]]`,
  } : undefined;

  // Build source
  const source: CalibreLocalSource = {
    type: 'calibre-local',
    libraryPath: settings.calibreLibraryPath,
    calibreId: book.id,
    epubPath: book.epubPath || '',
    lastModified: book.lastModified,
    addedAt: book.addedAt,
    lastVerified: new Date(),
    priority: 1,
  };

  // Build cover path
  const coverPath = book.hasCover
    ? `${settings.calibreCoversFolder}/calibre-${book.id}.jpg`
    : undefined;

  return {
    id: book.uuid,
    calibreUuid: book.uuid,
    isbn: book.identifiers['isbn'],

    title: book.title,
    titleSort: book.titleSort,
    authors,
    series,
    description: book.description ?? undefined,

    sources: [source],
    primarySourceType: 'calibre-local',
    formats: book.epubPath ? [{ type: 'epub' as const, path: book.epubPath }] : [],

    status: existingStatus || 'to-read',
    progress: existingProgress || 0,
    currentCfi: undefined,
    lastReadAt: undefined,

    tags: book.tags.map(t => t.name),
    rating: book.rating ?? undefined,

    notePath: `${settings.calibreBookNotesFolder}/${sanitizeFileName(book.title)}`,
    florilegioPath: `${settings.calibreHighlightsFolder}/${book.title}`,

    publisher: book.publisher?.name,
    publishedDate: book.pubdate ?? undefined,
    language: book.languages[0]?.lang_code,
    coverPath,
    coverUrl: coverPath,

    addedAt: book.addedAt,
  };
}

/**
 * Convert a CalibreAuthor to Author
 */
export function calibreAuthorToAuthor(
  author: CalibreAuthor,
  settings: LibrosSettings
): Author {
  return {
    name: author.name,
    sortName: author.sort,
    link: `[[${settings.calibreAuthorIndexFolder}/${author.name}|${author.name}]]`,
  };
}

/**
 * Convert a CalibreSeries to Series
 */
export function calibreSeriesToSeries(
  series: CalibreSeries,
  index: number,
  settings: LibrosSettings
): Series {
  return {
    name: series.name,
    index,
    link: `[[${settings.calibreSeriesIndexFolder}/${series.name}|${series.name}]]`,
  };
}

/**
 * Convert multiple CalibreBookFull to UnifiedBook[]
 */
export function calibreBooksToUnified(
  books: CalibreBookFull[],
  settings: LibrosSettings,
  progressMap?: Map<string, { progress: number; status: BookReadingStatus }>
): UnifiedBook[] {
  return books.map(book => {
    const existing = progressMap?.get(book.uuid);
    return calibreBookToUnified(
      book,
      settings,
      existing?.progress,
      existing?.status
    );
  });
}

/**
 * Sanitize a string for use as a filename
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
