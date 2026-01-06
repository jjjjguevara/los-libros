/**
 * Metadata Test Fixtures
 *
 * Factory functions for creating test metadata objects.
 * Supports highlights, notes, progress, and conflict scenarios.
 */

import type {
  BookMetadata,
  Highlight,
  BookNote,
  Bookmark,
  StoredMetadata,
  MetadataConflict,
  MetadataTimestamps,
  ReadingStatus,
  HighlightColor,
} from '../../../sync/metadata/types';

// ============================================================================
// Highlight Fixtures
// ============================================================================

/**
 * Create a test highlight
 */
export function createHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: crypto.randomUUID(),
    cfiRange: 'epubcfi(/6/4!/4/2/1:0,/6/4!/4/2/1:50)',
    text: 'This is a highlighted text passage from the book.',
    color: 'yellow',
    note: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Create multiple highlights with varied properties
 */
export function createHighlights(count: number): Highlight[] {
  const colors: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple'];
  return Array.from({ length: count }, (_, i) => createHighlight({
    id: `highlight-${i}`,
    cfiRange: `epubcfi(/6/${i * 2}!/4/2/1:0,/6/${i * 2}!/4/2/1:${50 + i})`,
    text: `Highlighted text ${i}: "${getRandomQuote(i)}"`,
    color: colors[i % colors.length],
    note: i % 3 === 0 ? `Note for highlight ${i}` : undefined,
    createdAt: new Date(Date.now() - i * 3600000),
  }));
}

/**
 * Get a random quote for test highlights
 */
function getRandomQuote(seed: number): string {
  const quotes = [
    'The only way to do great work is to love what you do.',
    'In the middle of difficulty lies opportunity.',
    'The journey of a thousand miles begins with a single step.',
    'Not all those who wander are lost.',
    'To be yourself in a world that is constantly trying to make you something else is the greatest accomplishment.',
    'The best time to plant a tree was twenty years ago. The second best time is now.',
    'It is not the strongest of the species that survives, nor the most intelligent, but the one most responsive to change.',
    'The only thing we have to fear is fear itself.',
    'In three words I can sum up everything I have learned about life: it goes on.',
    'Two things are infinite: the universe and human stupidity.',
  ];
  return quotes[seed % quotes.length];
}

// ============================================================================
// Book Note Fixtures
// ============================================================================

/**
 * Create a test book note
 */
export function createBookNote(overrides: Partial<BookNote> = {}): BookNote {
  return {
    chapter: 'Chapter 1',
    chapterIndex: 0,
    content: 'These are my notes for this chapter. Key themes include...',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Create multiple book notes
 */
export function createBookNotes(count: number): BookNote[] {
  return Array.from({ length: count }, (_, i) => createBookNote({
    chapter: `Chapter ${i + 1}`,
    chapterIndex: i,
    content: `Notes for chapter ${i + 1}. This chapter discusses...`,
  }));
}

// ============================================================================
// Bookmark Fixtures
// ============================================================================

/**
 * Create a test bookmark
 */
export function createBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: crypto.randomUUID(),
    cfi: 'epubcfi(/6/4!/4/2/1:0)',
    title: 'My Bookmark',
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Book Metadata Fixtures
// ============================================================================

/**
 * Create comprehensive book metadata
 */
export function createBookMetadata(overrides: Partial<BookMetadata> = {}): BookMetadata {
  const now = new Date();
  return {
    bookId: crypto.randomUUID(),
    calibreId: Math.floor(Math.random() * 10000),
    title: 'Test Book Title',
    authors: ['Test Author'],
    series: undefined,
    seriesIndex: undefined,
    publisher: 'Test Publisher',
    publishedDate: '2024-01-01',
    description: 'A test book for the metadata sync system.',
    isbn: '978-0-123456-78-9',
    language: 'en',
    tags: ['fiction', 'test'],
    rating: 4,
    status: 'reading',
    progress: 50,
    currentCfi: 'epubcfi(/6/4!/4/2/1:0)',
    lastReadAt: now,
    highlights: [],
    notes: [],
    bookmarks: [],
    customFields: {},
    ...overrides,
  };
}

/**
 * Create book metadata with full annotations
 */
export function createFullyAnnotatedBook(highlightCount = 10, noteCount = 5): BookMetadata {
  return createBookMetadata({
    bookId: 'annotated-book-001',
    title: 'Fully Annotated Book',
    progress: 75,
    status: 'reading',
    rating: 5,
    highlights: createHighlights(highlightCount),
    notes: createBookNotes(noteCount),
    bookmarks: [
      createBookmark({ title: 'Start of Chapter 1' }),
      createBookmark({ title: 'Important passage' }),
    ],
    tags: ['fiction', 'favorite', 'annotated'],
  });
}

/**
 * Create book metadata with minimal data (edge case)
 */
export function createSparseBook(): BookMetadata {
  return createBookMetadata({
    bookId: 'sparse-book-001',
    title: 'Sparse Metadata Book',
    authors: ['Unknown Author'],
    series: undefined,
    publisher: undefined,
    isbn: undefined,
    description: undefined,
    tags: [],
    rating: undefined,
    status: undefined,
    progress: 0,
    currentCfi: undefined,
    highlights: [],
    notes: [],
  });
}

// ============================================================================
// Timestamp Fixtures
// ============================================================================

/**
 * Create metadata timestamps
 */
export function createTimestamps(overrides: Partial<MetadataTimestamps> = {}): MetadataTimestamps {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 3600000);
  const dayAgo = new Date(now.getTime() - 86400000);

  return {
    progress: hourAgo,
    highlights: hourAgo,
    notes: dayAgo,
    rating: dayAgo,
    tags: dayAgo,
    status: hourAgo,
    lastSync: now,
    ...overrides,
  };
}

// ============================================================================
// Stored Metadata Fixtures (for recovery tests)
// ============================================================================

/**
 * Create stored metadata for recovery tests
 */
export function createStoredMetadata(overrides: Partial<StoredMetadata> = {}): StoredMetadata {
  const metadata = createFullyAnnotatedBook();
  return {
    bookId: metadata.bookId,
    calibreId: metadata.calibreId!,
    title: metadata.title,
    progress: metadata.progress!,
    currentCfi: metadata.currentCfi!,
    lastReadAt: metadata.lastReadAt!,
    highlights: metadata.highlights,
    notes: metadata.notes,
    bookmarks: metadata.bookmarks!,
    rating: metadata.rating!,
    status: metadata.status!,
    tags: metadata.tags,
    timestamps: createTimestamps(),
    archivedAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Conflict Fixtures
// ============================================================================

/**
 * Create a metadata conflict for testing resolution
 */
export function createConflict(
  field: string,
  localValue: unknown,
  remoteValue: unknown,
  overrides: Partial<MetadataConflict> = {}
): MetadataConflict {
  return {
    bookId: 'conflict-book-001',
    field,
    localValue,
    remoteValue,
    localTimestamp: new Date(Date.now() - 3600000), // 1 hour ago
    remoteTimestamp: new Date(), // now
    source: 'calibre',
    autoResolvable: false,
    suggestedResolution: undefined,
    ...overrides,
  };
}

/**
 * Create a set of common conflict scenarios
 */
export function createConflictScenarios(): MetadataConflict[] {
  return [
    // Rating conflict - remote is newer
    createConflict('rating', 5, 4, {
      bookId: 'book-1',
      autoResolvable: true,
      suggestedResolution: 'prefer-remote',
      remoteTimestamp: new Date(),
      localTimestamp: new Date(Date.now() - 86400000),
    }),

    // Tags conflict - can be merged
    createConflict('tags', ['fiction', 'sci-fi'], ['fiction', 'classic'], {
      bookId: 'book-2',
      autoResolvable: true,
      suggestedResolution: 'merge',
    }),

    // Progress conflict - local is newer
    createConflict('progress', 75, 50, {
      bookId: 'book-3',
      autoResolvable: true,
      suggestedResolution: 'prefer-local',
      localTimestamp: new Date(),
      remoteTimestamp: new Date(Date.now() - 86400000),
    }),

    // Status conflict - needs user decision
    createConflict('status', 'completed', 'reading', {
      bookId: 'book-4',
      autoResolvable: false,
      suggestedResolution: undefined,
    }),

    // Highlight conflict - can be merged
    createConflict('highlights',
      [createHighlight({ id: 'h1', text: 'Local highlight' })],
      [createHighlight({ id: 'h2', text: 'Remote highlight' })],
      {
        bookId: 'book-5',
        autoResolvable: true,
        suggestedResolution: 'merge',
      }),
  ];
}

// ============================================================================
// Calibre Book Fixtures (for bidirectional sync tests)
// ============================================================================

/**
 * Create a mock Calibre book
 */
export function createCalibreBook(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: Math.floor(Math.random() * 10000),
    uuid: crypto.randomUUID(),
    title: 'Calibre Test Book',
    authors: ['Calibre Author'],
    rating: 8, // Calibre uses 0-10 scale
    tags: ['calibre-tag', 'fiction'],
    series: 'Test Series',
    series_index: 1.0,
    publisher: 'Calibre Publisher',
    pubdate: '2024-01-01T00:00:00+00:00',
    comments: '<p>This is a test book from Calibre.</p>',
    cover: '/covers/1.jpg',
    formats: ['EPUB'],
    identifiers: {
      isbn: '978-0-123456-78-9',
      goodreads: '12345',
    },
    custom_columns: {
      '#read_date': '2024-06-15',
      '#read_count': 2,
      '#my_notes': 'Custom notes from Calibre',
    },
    last_modified: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// Invalid Metadata Fixtures (for validation tests)
// ============================================================================

/**
 * Create metadata with invalid values for validation testing
 */
export function createInvalidMetadata(): Record<string, Partial<BookMetadata>> {
  return {
    invalidProgress: createBookMetadata({ progress: 150 }), // > 100
    negativeProgress: createBookMetadata({ progress: -10 }), // < 0
    invalidRating: createBookMetadata({ rating: 10 }), // > 5
    negativeRating: createBookMetadata({ rating: -1 }), // < 0
    invalidCfi: createBookMetadata({ currentCfi: 'not-a-valid-cfi' }),
    emptyTitle: createBookMetadata({ title: '' }),
    invalidHighlight: createBookMetadata({
      highlights: [{ ...createHighlight(), cfiRange: '', text: '' }],
    }),
  };
}

// ============================================================================
// Exports
// ============================================================================

export const FIXTURE_BOOK_IDS = {
  FULLY_ANNOTATED: 'annotated-book-001',
  SPARSE: 'sparse-book-001',
  CONFLICT: 'conflict-book-001',
} as const;

export const FIXTURE_COUNTS = {
  SMALL: { highlights: 5, notes: 2 },
  MEDIUM: { highlights: 50, notes: 10 },
  LARGE: { highlights: 500, notes: 50 },
} as const;
