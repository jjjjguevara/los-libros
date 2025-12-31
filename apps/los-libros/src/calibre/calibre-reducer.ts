/**
 * Calibre State Reducer
 * Redux-like state management for Calibre integration
 */

import type {
  CalibreState,
  CalibreAction,
  CalibreBookFull,
  SyncChange,
  SyncProgress,
} from './calibre-types';

/**
 * Initial sync progress state
 */
export const initialSyncProgress: SyncProgress = {
  phase: 'idle',
  currentItem: 0,
  totalItems: 0,
  currentItemName: '',
  percentage: 0,
};

/**
 * Initial state for Calibre integration
 */
export const initialCalibreState: CalibreState = {
  connected: false,
  libraryPath: null,
  lastScanned: null,
  books: [],
  loading: false,
  error: null,
  syncInProgress: false,
  lastSyncedAt: null,
  pendingSync: [],
  syncProgress: initialSyncProgress,
};

/**
 * Calibre state reducer
 */
export function calibreReducer(
  state: CalibreState,
  action: CalibreAction
): CalibreState {
  switch (action.type) {
    case 'SET_LIBRARY_PATH':
      return {
        ...state,
        libraryPath: action.path,
        connected: false,  // Reset connection when path changes
        books: [],
        error: null,
      };

    case 'SET_CONNECTED':
      return {
        ...state,
        connected: action.connected,
        error: action.connected ? null : state.error,
      };

    case 'SET_BOOKS':
      return {
        ...state,
        books: action.books,
        lastScanned: new Date(),
        loading: false,
        error: null,
      };

    case 'ADD_BOOK':
      return {
        ...state,
        books: [...state.books, action.book],
      };

    case 'UPDATE_BOOK':
      return {
        ...state,
        books: state.books.map((book) =>
          book.id === action.id
            ? { ...book, ...action.updates }
            : book
        ),
      };

    case 'REMOVE_BOOK':
      return {
        ...state,
        books: state.books.filter((book) => book.id !== action.id),
      };

    case 'SET_LOADING':
      return {
        ...state,
        loading: action.loading,
      };

    case 'SET_ERROR':
      return {
        ...state,
        error: action.error,
        loading: false,
      };

    case 'START_SYNC':
      return {
        ...state,
        syncInProgress: true,
        error: null,
        syncProgress: {
          ...initialSyncProgress,
          phase: 'scanning',
        },
      };

    case 'UPDATE_SYNC_PROGRESS':
      return {
        ...state,
        syncProgress: {
          ...state.syncProgress,
          ...action.progress,
        },
      };

    case 'COMPLETE_SYNC':
      return {
        ...state,
        syncInProgress: false,
        lastSyncedAt: action.timestamp,
        pendingSync: [],
        syncProgress: {
          ...initialSyncProgress,
          phase: 'complete',
          percentage: 100,
        },
      };

    case 'ADD_PENDING_CHANGE':
      return {
        ...state,
        pendingSync: [...state.pendingSync, action.change],
      };

    case 'CLEAR_PENDING_CHANGES':
      return {
        ...state,
        pendingSync: [],
      };

    default:
      return state;
  }
}

// =============================================================================
// Selector Helpers
// =============================================================================

/**
 * Get a book by its Calibre ID
 */
export function selectBookById(
  state: CalibreState,
  calibreId: number
): CalibreBookFull | undefined {
  return state.books.find((book) => book.id === calibreId);
}

/**
 * Get a book by its UUID
 */
export function selectBookByUuid(
  state: CalibreState,
  uuid: string
): CalibreBookFull | undefined {
  return state.books.find((book) => book.uuid === uuid);
}

/**
 * Get all books by author name
 */
export function selectBooksByAuthor(
  state: CalibreState,
  authorName: string
): CalibreBookFull[] {
  return state.books.filter((book) =>
    book.authors.some((a) => a.name === authorName)
  );
}

/**
 * Get all books in a series
 */
export function selectBooksBySeries(
  state: CalibreState,
  seriesName: string
): CalibreBookFull[] {
  return state.books
    .filter((book) => book.series?.name === seriesName)
    .sort((a, b) => (a.seriesIndex ?? 0) - (b.seriesIndex ?? 0));
}

/**
 * Get all books with a specific tag
 */
export function selectBooksByTag(
  state: CalibreState,
  tagName: string
): CalibreBookFull[] {
  return state.books.filter((book) =>
    book.tags.some((t) => t.name === tagName)
  );
}

/**
 * Get unique authors from library
 */
export function selectUniqueAuthors(state: CalibreState): string[] {
  const authors = new Set<string>();
  for (const book of state.books) {
    for (const author of book.authors) {
      authors.add(author.name);
    }
  }
  return Array.from(authors).sort();
}

/**
 * Get unique series from library
 */
export function selectUniqueSeries(state: CalibreState): string[] {
  const series = new Set<string>();
  for (const book of state.books) {
    if (book.series) {
      series.add(book.series.name);
    }
  }
  return Array.from(series).sort();
}

/**
 * Get unique tags from library
 */
export function selectUniqueTags(state: CalibreState): string[] {
  const tags = new Set<string>();
  for (const book of state.books) {
    for (const tag of book.tags) {
      tags.add(tag.name);
    }
  }
  return Array.from(tags).sort();
}

/**
 * Get pending changes for a specific book
 */
export function selectPendingChangesForBook(
  state: CalibreState,
  calibreId: number
): SyncChange[] {
  return state.pendingSync.filter((change) => change.calibreId === calibreId);
}

/**
 * Check if there are any unsynchronized changes
 */
export function hasUnsyncedChanges(state: CalibreState): boolean {
  return state.pendingSync.length > 0;
}
