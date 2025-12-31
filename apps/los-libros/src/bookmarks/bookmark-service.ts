/**
 * Bookmark Service
 *
 * Manages bookmarks and reading notes for books.
 */

import { App } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import { Store } from '../helpers/store';
import {
  type Bookmark,
  type ReadingNote,
  type BookmarkState,
  type BookmarkAction,
  type BookmarkIndex,
  type NoteIndex,
  type CreateBookmarkInput,
  type CreateNoteInput,
  type UpdateBookmarkInput,
  type UpdateNoteInput,
  initialBookmarkState,
  bookmarkReducer,
} from './bookmark-types';

const BOOKMARK_DATA_KEY = 'los-libros-bookmarks';
const NOTES_DATA_KEY = 'los-libros-reading-notes';

export class BookmarkService {
  private app: App;
  private store: Store<BookmarkState, BookmarkAction>;
  private loadData: () => Promise<any>;
  private saveData: (data: any) => Promise<void>;

  constructor(
    app: App,
    loadData: () => Promise<any>,
    saveData: (data: any) => Promise<void>
  ) {
    this.app = app;
    this.loadData = loadData;
    this.saveData = saveData;
    this.store = new Store<BookmarkState, BookmarkAction>(
      initialBookmarkState,
      bookmarkReducer
    );
  }

  /**
   * Get the store for subscribing to state changes
   */
  getStore(): Store<BookmarkState, BookmarkAction> {
    return this.store;
  }

  /**
   * Initialize the service and load persisted data
   */
  async initialize(): Promise<void> {
    this.store.dispatch({ type: 'SET_LOADING', payload: true });

    try {
      const data = await this.loadData();

      // Load bookmarks
      const bookmarkIndex: BookmarkIndex = data?.[BOOKMARK_DATA_KEY] || {
        version: 1,
        bookmarks: {},
      };

      for (const [bookId, bookmarks] of Object.entries(bookmarkIndex.bookmarks)) {
        this.store.dispatch({
          type: 'SET_BOOKMARKS',
          payload: {
            bookId,
            bookmarks: (bookmarks as any[]).map(b => ({
              ...b,
              createdAt: new Date(b.createdAt),
              syncedAt: b.syncedAt ? new Date(b.syncedAt) : undefined,
            })),
          },
        });
      }

      // Load notes
      const noteIndex: NoteIndex = data?.[NOTES_DATA_KEY] || {
        version: 1,
        notes: {},
      };

      for (const [bookId, notes] of Object.entries(noteIndex.notes)) {
        this.store.dispatch({
          type: 'SET_NOTES',
          payload: {
            bookId,
            notes: (notes as any[]).map(n => ({
              ...n,
              createdAt: new Date(n.createdAt),
              updatedAt: new Date(n.updatedAt),
            })),
          },
        });
      }

      this.store.dispatch({ type: 'SET_ERROR', payload: null });
    } catch (error) {
      console.error('Failed to initialize bookmark service:', error);
      this.store.dispatch({
        type: 'SET_ERROR',
        payload: `Failed to load bookmarks: ${error}`,
      });
    } finally {
      this.store.dispatch({ type: 'SET_LOADING', payload: false });
    }
  }

  /**
   * Persist current state to storage
   */
  private async persist(): Promise<void> {
    try {
      const data = await this.loadData() || {};
      const state = this.store.getValue();

      // Save bookmarks
      const bookmarkIndex: BookmarkIndex = {
        version: 1,
        bookmarks: state.bookmarks,
      };
      data[BOOKMARK_DATA_KEY] = bookmarkIndex;

      // Save notes
      const noteIndex: NoteIndex = {
        version: 1,
        notes: state.notes,
      };
      data[NOTES_DATA_KEY] = noteIndex;

      await this.saveData(data);
    } catch (error) {
      console.error('Failed to persist bookmarks:', error);
      throw error;
    }
  }

  // =========================================================================
  // Bookmark Methods
  // =========================================================================

  /**
   * Create a new bookmark
   */
  async createBookmark(input: CreateBookmarkInput): Promise<Bookmark> {
    const bookmark: Bookmark = {
      id: uuidv4(),
      bookId: input.bookId,
      cfi: input.cfi,
      name: input.name,
      chapter: input.chapter,
      pagePercent: input.pagePercent,
      createdAt: new Date(),
      synced: false,
    };

    this.store.dispatch({ type: 'ADD_BOOKMARK', payload: bookmark });
    await this.persist();

    return bookmark;
  }

  /**
   * Get all bookmarks for a book
   */
  getBookmarks(bookId: string): Bookmark[] {
    return this.store.getValue().bookmarks[bookId] || [];
  }

  /**
   * Get a specific bookmark by ID
   */
  getBookmark(bookId: string, id: string): Bookmark | undefined {
    return this.getBookmarks(bookId).find(b => b.id === id);
  }

  /**
   * Check if a CFI has a bookmark
   */
  hasBookmarkAtCfi(bookId: string, cfi: string): boolean {
    return this.getBookmarks(bookId).some(b => b.cfi === cfi);
  }

  /**
   * Update a bookmark
   */
  async updateBookmark(input: UpdateBookmarkInput): Promise<void> {
    this.store.dispatch({
      type: 'UPDATE_BOOKMARK',
      payload: { id: input.id, updates: { name: input.name } },
    });
    await this.persist();
  }

  /**
   * Delete a bookmark
   */
  async deleteBookmark(bookId: string, id: string): Promise<void> {
    this.store.dispatch({
      type: 'REMOVE_BOOKMARK',
      payload: { bookId, id },
    });
    await this.persist();
  }

  /**
   * Toggle bookmark at current location
   */
  async toggleBookmark(input: CreateBookmarkInput): Promise<{ created: boolean; bookmark?: Bookmark }> {
    const existing = this.getBookmarks(input.bookId).find(b => b.cfi === input.cfi);

    if (existing) {
      await this.deleteBookmark(input.bookId, existing.id);
      return { created: false };
    } else {
      const bookmark = await this.createBookmark(input);
      return { created: true, bookmark };
    }
  }

  // =========================================================================
  // Reading Note Methods
  // =========================================================================

  /**
   * Create a new reading note
   */
  async createNote(input: CreateNoteInput): Promise<ReadingNote> {
    const now = new Date();
    const note: ReadingNote = {
      id: uuidv4(),
      bookId: input.bookId,
      cfi: input.cfi,
      content: input.content,
      chapter: input.chapter,
      pagePercent: input.pagePercent,
      tags: input.tags || [],
      createdAt: now,
      updatedAt: now,
      synced: false,
      highlightId: input.highlightId,
    };

    this.store.dispatch({ type: 'ADD_NOTE', payload: note });
    await this.persist();

    return note;
  }

  /**
   * Get all notes for a book
   */
  getNotes(bookId: string): ReadingNote[] {
    return this.store.getValue().notes[bookId] || [];
  }

  /**
   * Get a specific note by ID
   */
  getNote(bookId: string, id: string): ReadingNote | undefined {
    return this.getNotes(bookId).find(n => n.id === id);
  }

  /**
   * Get note linked to a highlight
   */
  getNoteForHighlight(bookId: string, highlightId: string): ReadingNote | undefined {
    return this.getNotes(bookId).find(n => n.highlightId === highlightId);
  }

  /**
   * Update a note
   */
  async updateNote(input: UpdateNoteInput): Promise<void> {
    const updates: Partial<ReadingNote> = {};
    if (input.content !== undefined) updates.content = input.content;
    if (input.tags !== undefined) updates.tags = input.tags;

    this.store.dispatch({
      type: 'UPDATE_NOTE',
      payload: { id: input.id, updates },
    });
    await this.persist();
  }

  /**
   * Delete a note
   */
  async deleteNote(bookId: string, id: string): Promise<void> {
    this.store.dispatch({
      type: 'REMOVE_NOTE',
      payload: { bookId, id },
    });
    await this.persist();
  }

  // =========================================================================
  // Bulk Operations
  // =========================================================================

  /**
   * Get all artifacts for a book
   */
  getBookArtifacts(bookId: string): { bookmarks: Bookmark[]; notes: ReadingNote[] } {
    return {
      bookmarks: this.getBookmarks(bookId),
      notes: this.getNotes(bookId),
    };
  }

  /**
   * Clear all artifacts for a book
   */
  async clearBookArtifacts(bookId: string): Promise<void> {
    this.store.dispatch({ type: 'CLEAR_BOOK', payload: bookId });
    await this.persist();
  }

  /**
   * Get bookmark count for a book
   */
  getBookmarkCount(bookId: string): number {
    return this.getBookmarks(bookId).length;
  }

  /**
   * Get note count for a book
   */
  getNoteCount(bookId: string): number {
    return this.getNotes(bookId).length;
  }

  /**
   * Mark bookmark as synced
   */
  async markBookmarkSynced(id: string): Promise<void> {
    this.store.dispatch({
      type: 'UPDATE_BOOKMARK',
      payload: { id, updates: { synced: true, syncedAt: new Date() } },
    });
    await this.persist();
  }

  /**
   * Mark note as synced
   */
  async markNoteSynced(id: string): Promise<void> {
    this.store.dispatch({
      type: 'UPDATE_NOTE',
      payload: { id, updates: { synced: true } },
    });
    await this.persist();
  }

  /**
   * Get all unsynced bookmarks
   */
  getUnsyncedBookmarks(): Bookmark[] {
    const state = this.store.getValue();
    const unsynced: Bookmark[] = [];
    for (const bookmarks of Object.values(state.bookmarks)) {
      unsynced.push(...bookmarks.filter(b => !b.synced));
    }
    return unsynced;
  }

  /**
   * Get all unsynced notes
   */
  getUnsyncedNotes(): ReadingNote[] {
    const state = this.store.getValue();
    const unsynced: ReadingNote[] = [];
    for (const notes of Object.values(state.notes)) {
      unsynced.push(...notes.filter(n => !n.synced));
    }
    return unsynced;
  }
}
