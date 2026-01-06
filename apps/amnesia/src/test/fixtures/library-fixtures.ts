/**
 * Library Fixtures
 *
 * Pre-defined library configurations for testing sync operations.
 *
 * @see docs/plans/unified-sync-architecture-prd.md
 */

import type { CalibreBookFull, CalibreAuthor, CalibreSeries, CalibreTag } from '../../calibre/calibre-types';
import { createBook, createAuthor, createSeries, createTag } from './book-factory';

// ============================================================================
// Types
// ============================================================================

/**
 * Library fixture configuration
 */
export interface LibraryFixture {
  name: string;
  description: string;
  books: CalibreBookFull[];
  authors: CalibreAuthor[];
  series: CalibreSeries[];
  tags: CalibreTag[];
}

/**
 * Fixture options
 */
export interface FixtureOptions {
  withCovers?: boolean;
  withProgress?: boolean;
  withHighlights?: boolean;
  withConflicts?: number;
}

// ============================================================================
// Pre-defined Fixtures
// ============================================================================

/**
 * Empty library for edge case testing
 */
export function createEmptyLibrary(): LibraryFixture {
  return {
    name: 'empty-library',
    description: 'Empty library with no books',
    books: [],
    authors: [],
    series: [],
    tags: [],
  };
}

/**
 * Small library for quick tests (10 books)
 */
export function createSmallLibrary(options: FixtureOptions = {}): LibraryFixture {
  const authors = [
    createAuthor(1, 'Jane Austen'),
    createAuthor(2, 'Charles Dickens'),
    createAuthor(3, 'Emily Brontë'),
  ];

  const series = [
    createSeries(1, 'Classics Collection'),
  ];

  const tags = [
    createTag(1, 'fiction'),
    createTag(2, 'classic'),
    createTag(3, 'romance'),
  ];

  const books: CalibreBookFull[] = [];

  // Jane Austen books
  books.push(
    createBook(1, 'Pride and Prejudice', {
      authors: [authors[0]],
      series: series[0],
      seriesIndex: 1,
      tags: [tags[0], tags[1], tags[2]],
      rating: 5,
      hasCover: options.withCovers ?? true,
    })
  );
  books.push(
    createBook(2, 'Sense and Sensibility', {
      authors: [authors[0]],
      series: series[0],
      seriesIndex: 2,
      tags: [tags[0], tags[1], tags[2]],
      rating: 4,
      hasCover: options.withCovers ?? true,
    })
  );

  // Dickens books
  books.push(
    createBook(3, 'A Tale of Two Cities', {
      authors: [authors[1]],
      tags: [tags[0], tags[1]],
      rating: 5,
      hasCover: options.withCovers ?? true,
    })
  );
  books.push(
    createBook(4, 'Great Expectations', {
      authors: [authors[1]],
      tags: [tags[0], tags[1]],
      rating: 4,
      hasCover: options.withCovers ?? true,
    })
  );
  books.push(
    createBook(5, 'Oliver Twist', {
      authors: [authors[1]],
      tags: [tags[0], tags[1]],
      rating: 4,
      hasCover: options.withCovers ?? true,
    })
  );

  // Emily Brontë
  books.push(
    createBook(6, 'Wuthering Heights', {
      authors: [authors[2]],
      tags: [tags[0], tags[1], tags[2]],
      rating: 5,
      hasCover: options.withCovers ?? true,
    })
  );

  // Add more books to reach 10
  for (let i = 7; i <= 10; i++) {
    books.push(
      createBook(i, `Test Book ${i}`, {
        authors: [authors[i % 3]],
        tags: [tags[0]],
        rating: Math.floor(Math.random() * 5) + 1,
        hasCover: options.withCovers ?? true,
      })
    );
  }

  return {
    name: 'small-library',
    description: 'Small library with 10 classic books',
    books,
    authors,
    series,
    tags,
  };
}

/**
 * Medium library for moderate testing (100 books)
 */
export function createMediumLibrary(options: FixtureOptions = {}): LibraryFixture {
  const numAuthors = 20;
  const numSeries = 10;
  const numTags = 15;
  const numBooks = 100;

  const authors = Array.from({ length: numAuthors }, (_, i) =>
    createAuthor(i + 1, `Author ${i + 1}`)
  );

  const series = Array.from({ length: numSeries }, (_, i) =>
    createSeries(i + 1, `Series ${i + 1}`)
  );

  const tags = Array.from({ length: numTags }, (_, i) =>
    createTag(i + 1, `tag-${i + 1}`)
  );

  const books = Array.from({ length: numBooks }, (_, i) => {
    const authorIndex = i % numAuthors;
    const seriesIndex = i % numSeries;
    const tagIndices = [i % numTags, (i + 1) % numTags];

    return createBook(i + 1, `Book ${i + 1}`, {
      authors: [authors[authorIndex]],
      series: i % 3 === 0 ? series[seriesIndex] : null,
      seriesIndex: i % 3 === 0 ? Math.floor(i / numSeries) + 1 : null,
      tags: tagIndices.map((ti) => tags[ti]),
      rating: (i % 5) + 1,
      hasCover: options.withCovers ?? true,
    });
  });

  return {
    name: 'medium-library',
    description: 'Medium library with 100 books, 20 authors, 10 series',
    books,
    authors,
    series,
    tags,
  };
}

/**
 * Large library for stress testing (1000 books)
 */
export function createLargeLibrary(options: FixtureOptions = {}): LibraryFixture {
  const numAuthors = 100;
  const numSeries = 50;
  const numTags = 30;
  const numBooks = 1000;

  const authors = Array.from({ length: numAuthors }, (_, i) =>
    createAuthor(i + 1, `Author ${i + 1}`)
  );

  const series = Array.from({ length: numSeries }, (_, i) =>
    createSeries(i + 1, `Series ${i + 1}`)
  );

  const tags = Array.from({ length: numTags }, (_, i) =>
    createTag(i + 1, `tag-${i + 1}`)
  );

  const books = Array.from({ length: numBooks }, (_, i) => {
    const authorIndex = i % numAuthors;
    const seriesIndex = i % numSeries;
    const tagIndices = [i % numTags, (i + 1) % numTags, (i + 2) % numTags];

    return createBook(i + 1, `Book ${i + 1}`, {
      authors: [authors[authorIndex]],
      series: i % 5 === 0 ? series[seriesIndex] : null,
      seriesIndex: i % 5 === 0 ? Math.floor(i / numSeries) + 1 : null,
      tags: tagIndices.map((ti) => tags[ti]),
      rating: (i % 5) + 1,
      hasCover: options.withCovers ?? true,
    });
  });

  return {
    name: 'large-library',
    description: 'Large library with 1000 books, 100 authors, 50 series',
    books,
    authors,
    series,
    tags,
  };
}

/**
 * Stress test library (5000 books)
 */
export function createStressTestLibrary(options: FixtureOptions = {}): LibraryFixture {
  const numAuthors = 500;
  const numSeries = 200;
  const numTags = 50;
  const numBooks = 5000;

  const authors = Array.from({ length: numAuthors }, (_, i) =>
    createAuthor(i + 1, `Author ${i + 1}`)
  );

  const series = Array.from({ length: numSeries }, (_, i) =>
    createSeries(i + 1, `Series ${i + 1}`)
  );

  const tags = Array.from({ length: numTags }, (_, i) =>
    createTag(i + 1, `tag-${i + 1}`)
  );

  const books = Array.from({ length: numBooks }, (_, i) => {
    const authorIndex = i % numAuthors;
    const seriesIndex = i % numSeries;
    const numBookTags = (i % 3) + 1;
    const tagIndices = Array.from({ length: numBookTags }, (_, j) => (i + j) % numTags);

    return createBook(i + 1, `Book ${i + 1}`, {
      authors: [authors[authorIndex]],
      series: i % 10 === 0 ? series[seriesIndex] : null,
      seriesIndex: i % 10 === 0 ? Math.floor(i / numSeries) + 1 : null,
      tags: tagIndices.map((ti) => tags[ti]),
      rating: (i % 5) + 1,
      hasCover: options.withCovers ?? false, // Default false for stress test
    });
  });

  return {
    name: 'stress-test',
    description: 'Stress test library with 5000 books, 500 authors, 200 series',
    books,
    authors,
    series,
    tags,
  };
}

// ============================================================================
// Fixture Utilities
// ============================================================================

/**
 * Get fixture by name
 */
export function getFixture(
  name: 'empty' | 'small' | 'medium' | 'large' | 'stress',
  options: FixtureOptions = {}
): LibraryFixture {
  switch (name) {
    case 'empty':
      return createEmptyLibrary();
    case 'small':
      return createSmallLibrary(options);
    case 'medium':
      return createMediumLibrary(options);
    case 'large':
      return createLargeLibrary(options);
    case 'stress':
      return createStressTestLibrary(options);
  }
}

/**
 * All fixture names
 */
export const FIXTURE_NAMES = ['empty', 'small', 'medium', 'large', 'stress'] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

/**
 * Fixture descriptions
 */
export const FIXTURE_DESCRIPTIONS: Record<FixtureName, string> = {
  empty: 'Empty library (0 books)',
  small: 'Small library (10 books)',
  medium: 'Medium library (100 books)',
  large: 'Large library (1000 books)',
  stress: 'Stress test (5000 books)',
};
