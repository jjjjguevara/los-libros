/**
 * Library API Facade
 * @module api/facades/library
 */

import type { Readable } from 'svelte/store';
import type {
  LibraryState,
  LibraryCommands,
  Book,
  ReadingStatus,
  ScanResult,
  Capability
} from '../types';
import type { LibraryService } from '../../library/library-service';
import type { Store } from '../../helpers/store';
import { createReactiveStore } from '../reactive-selector';
import { requireCapability } from '../security/capabilities';
import { TypedEventEmitter } from '../events/emitter';

/**
 * Library API implementation
 */
export class LibraryAPI implements LibraryCommands {
  private stateStore: Readable<LibraryState>;

  constructor(
    private service: LibraryService,
    private store: Store<any, any>,
    private capabilities: Set<Capability>,
    private events: TypedEventEmitter
  ) {
    this.stateStore = createReactiveStore(store);
  }

  /**
   * Get reactive state store
   */
  getState(): Readable<LibraryState> {
    return this.stateStore;
  }

  /**
   * Get a book by ID
   */
  getBook(bookId: string): Book | null {
    const book = this.service.getBook(bookId);
    return book ? this.toPublicBook(book) : null;
  }

  /**
   * Search books by query
   */
  search(query: string): Book[] {
    return this.service.search(query).map(b => this.toPublicBook(b));
  }

  /**
   * Filter books by status
   */
  filterByStatus(status: ReadingStatus): Book[] {
    // Convert 'unread' to 'to-read' for internal compatibility
    const internalStatus = status === 'unread' ? 'to-read' : status;
    return this.service.filterByStatus(internalStatus as any).map(b => this.toPublicBook(b));
  }

  /**
   * Update reading progress
   */
  async updateProgress(bookId: string, progress: number, cfi?: string): Promise<void> {
    requireCapability(this.capabilities, 'write-library', 'update progress');

    await this.service.updateProgress(bookId, progress, cfi);

    // Emit event
    this.events.emit('progress-updated', { bookId, progress, cfi });
  }

  /**
   * Scan library folder
   */
  async scan(folder?: string): Promise<ScanResult> {
    requireCapability(this.capabilities, 'write-library', 'scan library');

    const result = await this.service.scan(folder || '') as any;

    // The internal ScanResult has { books: Book[], errors: ScanError[] }
    // We convert to the public API format
    const publicResult: ScanResult = {
      added: result.books?.length ?? 0,
      updated: 0, // Not tracked by internal scanner
      removed: 0, // Not tracked by internal scanner
      errors: (result.errors ?? []).map((e: any) => `${e.path}: ${e.error}`)
    };

    // Emit event
    this.events.emit('library-scanned', { result: publicResult });

    return publicResult;
  }

  /**
   * Get recent books
   */
  getRecentBooks(limit: number = 10): Book[] {
    return this.service.getRecentBooks(limit).map(b => this.toPublicBook(b));
  }

  /**
   * Get all books
   */
  getAllBooks(): Book[] {
    return this.store.getValue().books.map((b: any) => this.toPublicBook(b));
  }

  /**
   * Convert internal Book to public API Book
   */
  private toPublicBook(book: any): Book {
    return {
      id: book.id,
      title: book.title,
      author: book.author || '',
      localPath: book.localPath || '',
      coverPath: book.coverPath,
      progress: book.progress || 0,
      status: book.status || 'unread',
      lastRead: book.lastRead?.toISOString?.() || book.lastRead,
      dateAdded: book.dateAdded?.toISOString?.() || book.dateAdded || new Date().toISOString(),
      metadata: book.metadata
    };
  }
}

/**
 * Create library API
 */
export function createLibraryAPI(
  service: LibraryService,
  store: Store<any, any>,
  capabilities: Set<Capability>,
  events: TypedEventEmitter
): { state: Readable<LibraryState>; commands: LibraryCommands } {
  const api = new LibraryAPI(service, store, capabilities, events);
  return {
    state: api.getState(),
    commands: api
  };
}
