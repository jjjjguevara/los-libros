/**
 * Bookmarks API Facade
 * @module api/facades/bookmarks
 */

import type { Readable } from 'svelte/store';
import type {
  BookmarkState,
  BookmarkCommands,
  Bookmark,
  Capability
} from '../types';
import type { BookmarkService } from '../../bookmarks/bookmark-service';
import type { Store } from '../../helpers/store';
import { createReactiveStore } from '../reactive-selector';
import { requireCapability } from '../security/capabilities';
import { validate, validateCreateBookmark, validateUpdateBookmark } from '../security/validation';
import { TypedEventEmitter } from '../events/emitter';

/**
 * Bookmarks API implementation
 */
export class BookmarksAPI implements BookmarkCommands {
  private stateStore: Readable<BookmarkState>;

  constructor(
    private service: BookmarkService,
    private store: Store<any, any>, // BookmarkState, BookmarkAction
    private capabilities: Set<Capability>,
    private events: TypedEventEmitter
  ) {
    this.stateStore = createReactiveStore(store);
  }

  /**
   * Get reactive state store
   */
  getState(): Readable<BookmarkState> {
    return this.stateStore;
  }

  /**
   * Create a new bookmark
   */
  async create(
    bookId: string,
    cfi: string,
    title?: string,
    note?: string
  ): Promise<Bookmark> {
    requireCapability(this.capabilities, 'write-bookmarks', 'create bookmark');

    // Validate input
    validate(validateCreateBookmark, { bookId, cfi, title, note });

    const bookmark = await this.service.createBookmark({
      bookId,
      cfi,
      name: title
    });

    return this.toPublicBookmark(bookmark);
  }

  /**
   * Update a bookmark
   */
  async update(bookmarkId: string, updates: Partial<Bookmark>): Promise<Bookmark> {
    requireCapability(this.capabilities, 'write-bookmarks', 'update bookmark');

    // Validate input
    validate(validateUpdateBookmark, updates);

    await this.service.updateBookmark({
      id: bookmarkId,
      name: updates.title
    });

    // Find and return updated bookmark
    const state = this.store.getValue();
    for (const bookmarks of Object.values(state.bookmarks) as any[]) {
      const bookmark = bookmarks.find((b: any) => b.id === bookmarkId);
      if (bookmark) {
        return this.toPublicBookmark(bookmark);
      }
    }

    throw new Error(`Bookmark ${bookmarkId} not found after update`);
  }

  /**
   * Delete a bookmark
   */
  async delete(bookId: string, bookmarkId: string): Promise<void> {
    requireCapability(this.capabilities, 'write-bookmarks', 'delete bookmark');

    await this.service.deleteBookmark(bookId, bookmarkId);
  }

  /**
   * Get bookmarks for a book
   */
  getBookmarks(bookId: string): Bookmark[] {
    return this.service.getBookmarks(bookId).map(b => this.toPublicBookmark(b));
  }

  /**
   * Check if a CFI has a bookmark
   */
  hasBookmarkAt(bookId: string, cfi: string): boolean {
    return this.service.hasBookmarkAtCfi(bookId, cfi);
  }

  /**
   * Toggle bookmark at a location
   */
  async toggleBookmark(
    bookId: string,
    cfi: string,
    title?: string
  ): Promise<{ created: boolean; bookmark?: Bookmark }> {
    requireCapability(this.capabilities, 'write-bookmarks', 'toggle bookmark');

    const result = await this.service.toggleBookmark({
      bookId,
      cfi,
      name: title
    });

    return {
      created: result.created,
      bookmark: result.bookmark ? this.toPublicBookmark(result.bookmark) : undefined
    };
  }

  /**
   * Get bookmark count for a book
   */
  getBookmarkCount(bookId: string): number {
    return this.service.getBookmarkCount(bookId);
  }

  /**
   * Convert internal Bookmark to public API Bookmark
   */
  private toPublicBookmark(bookmark: any): Bookmark {
    return {
      id: bookmark.id,
      bookId: bookmark.bookId,
      cfi: bookmark.cfi,
      title: bookmark.name,
      note: bookmark.note,
      chapter: bookmark.chapter,
      createdAt: bookmark.createdAt?.toISOString?.() || bookmark.createdAt
    };
  }
}

/**
 * Create bookmarks API
 */
export function createBookmarksAPI(
  service: BookmarkService,
  store: Store<any, any>,
  capabilities: Set<Capability>,
  events: TypedEventEmitter
): { state: Readable<BookmarkState>; commands: BookmarkCommands } {
  const api = new BookmarksAPI(service, store, capabilities, events);
  return {
    state: api.getState(),
    commands: api
  };
}
