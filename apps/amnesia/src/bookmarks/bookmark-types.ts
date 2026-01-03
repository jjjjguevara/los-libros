/**
 * Bookmark Types
 *
 * Type definitions for bookmarks and reading notes.
 */

/**
 * Bookmark - a saved location in a book
 */
export interface Bookmark {
  id: string;
  bookId: string;
  /** EPUB CFI for exact position */
  cfi: string;
  /** User-defined name (optional) */
  name?: string;
  /** Chapter name at bookmark location */
  chapter?: string;
  /** Reading progress percentage (0-100) */
  pagePercent?: number;
  /** When the bookmark was created */
  createdAt: Date;
  /** Whether synced to server */
  synced: boolean;
  /** Sync timestamp if synced */
  syncedAt?: Date;
}

/**
 * Reading Note - a standalone note at a location in a book
 * Different from highlight annotations - these are independent notes
 */
export interface ReadingNote {
  id: string;
  bookId: string;
  /** EPUB CFI for location */
  cfi: string;
  /** Markdown content of the note */
  content: string;
  /** Chapter name at note location */
  chapter?: string;
  /** Reading progress percentage (0-100) */
  pagePercent?: number;
  /** Tags for categorization */
  tags?: string[];
  /** When the note was created */
  createdAt: Date;
  /** When the note was last updated */
  updatedAt: Date;
  /** Whether synced to server */
  synced: boolean;
  /** Path to atomic note in vault (if generated) */
  atomicNotePath?: string;
  /** ID of the linked highlight (notes are always attached to highlights) */
  highlightId?: string;
}

/**
 * Bookmark index - storage structure
 */
export interface BookmarkIndex {
  version: number;
  /** Map of bookId -> bookmarks */
  bookmarks: Record<string, Bookmark[]>;
}

/**
 * Note index - storage structure
 */
export interface NoteIndex {
  version: number;
  /** Map of bookId -> notes */
  notes: Record<string, ReadingNote[]>;
}

/**
 * Combined reading artifacts for a book
 */
export interface BookReadingArtifacts {
  bookId: string;
  bookmarks: Bookmark[];
  notes: ReadingNote[];
}

/**
 * Bookmark creation input
 */
export interface CreateBookmarkInput {
  bookId: string;
  cfi: string;
  name?: string;
  chapter?: string;
  pagePercent?: number;
}

/**
 * Note creation input
 */
export interface CreateNoteInput {
  bookId: string;
  cfi: string;
  content: string;
  chapter?: string;
  pagePercent?: number;
  tags?: string[];
  /** Link note to a highlight */
  highlightId?: string;
}

/**
 * Bookmark update input
 */
export interface UpdateBookmarkInput {
  id: string;
  name?: string;
}

/**
 * Note update input
 */
export interface UpdateNoteInput {
  id: string;
  content?: string;
  tags?: string[];
}

/**
 * Bookmark store state
 */
export interface BookmarkState {
  bookmarks: Record<string, Bookmark[]>;
  notes: Record<string, ReadingNote[]>;
  loading: boolean;
  error: string | null;
}

/**
 * Bookmark store actions
 */
export type BookmarkAction =
  | { type: 'SET_BOOKMARKS'; payload: { bookId: string; bookmarks: Bookmark[] } }
  | { type: 'ADD_BOOKMARK'; payload: Bookmark }
  | { type: 'UPDATE_BOOKMARK'; payload: { id: string; updates: Partial<Bookmark> } }
  | { type: 'REMOVE_BOOKMARK'; payload: { bookId: string; id: string } }
  | { type: 'SET_NOTES'; payload: { bookId: string; notes: ReadingNote[] } }
  | { type: 'ADD_NOTE'; payload: ReadingNote }
  | { type: 'UPDATE_NOTE'; payload: { id: string; updates: Partial<ReadingNote> } }
  | { type: 'REMOVE_NOTE'; payload: { bookId: string; id: string } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'CLEAR_BOOK'; payload: string };

/**
 * Initial bookmark state
 */
export const initialBookmarkState: BookmarkState = {
  bookmarks: {},
  notes: {},
  loading: false,
  error: null,
};

/**
 * Bookmark reducer
 */
export function bookmarkReducer(
  state: BookmarkState,
  action: BookmarkAction
): BookmarkState {
  switch (action.type) {
    case 'SET_BOOKMARKS':
      return {
        ...state,
        bookmarks: {
          ...state.bookmarks,
          [action.payload.bookId]: action.payload.bookmarks,
        },
      };

    case 'ADD_BOOKMARK': {
      const { bookId } = action.payload;
      const existing = state.bookmarks[bookId] || [];
      return {
        ...state,
        bookmarks: {
          ...state.bookmarks,
          [bookId]: [...existing, action.payload],
        },
      };
    }

    case 'UPDATE_BOOKMARK': {
      const { id, updates } = action.payload;
      const newBookmarks: Record<string, Bookmark[]> = {};
      for (const [bookId, bookmarks] of Object.entries(state.bookmarks)) {
        newBookmarks[bookId] = bookmarks.map(b =>
          b.id === id ? { ...b, ...updates } : b
        );
      }
      return { ...state, bookmarks: newBookmarks };
    }

    case 'REMOVE_BOOKMARK': {
      const { bookId, id } = action.payload;
      return {
        ...state,
        bookmarks: {
          ...state.bookmarks,
          [bookId]: (state.bookmarks[bookId] || []).filter(b => b.id !== id),
        },
      };
    }

    case 'SET_NOTES':
      return {
        ...state,
        notes: {
          ...state.notes,
          [action.payload.bookId]: action.payload.notes,
        },
      };

    case 'ADD_NOTE': {
      const { bookId } = action.payload;
      const existing = state.notes[bookId] || [];
      return {
        ...state,
        notes: {
          ...state.notes,
          [bookId]: [...existing, action.payload],
        },
      };
    }

    case 'UPDATE_NOTE': {
      const { id, updates } = action.payload;
      const newNotes: Record<string, ReadingNote[]> = {};
      for (const [bookId, notes] of Object.entries(state.notes)) {
        newNotes[bookId] = notes.map(n =>
          n.id === id ? { ...n, ...updates, updatedAt: new Date() } : n
        );
      }
      return { ...state, notes: newNotes };
    }

    case 'REMOVE_NOTE': {
      const { bookId, id } = action.payload;
      return {
        ...state,
        notes: {
          ...state.notes,
          [bookId]: (state.notes[bookId] || []).filter(n => n.id !== id),
        },
      };
    }

    case 'SET_LOADING':
      return { ...state, loading: action.payload };

    case 'SET_ERROR':
      return { ...state, error: action.payload };

    case 'CLEAR_BOOK': {
      const { [action.payload]: _removedBookmarks, ...restBookmarks } = state.bookmarks;
      const { [action.payload]: _removedNotes, ...restNotes } = state.notes;
      return {
        ...state,
        bookmarks: restBookmarks,
        notes: restNotes,
      };
    }

    default:
      return state;
  }
}
