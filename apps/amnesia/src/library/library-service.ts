/**
 * Library service for managing books
 */
import { App, TFile } from 'obsidian';
import { LibraryScanner, ScanResult } from './scanner';
import { Book, BookStatus, LibraryIndex, BookIndexEntry } from './types';
import { Store } from '../helpers/store';
import { LibraryState, LibraryAction } from './library-reducer';

const LIBRARY_INDEX_VERSION = 1;

export class LibraryService {
  scanner: LibraryScanner;  // Made public for server config access
  private index: LibraryIndex;
  private watcher: (() => void) | null = null;

  constructor(
    private app: App,
    private store: Store<LibraryState, LibraryAction>,
    private loadData: () => Promise<unknown>,
    private saveData: (data: unknown) => Promise<void>
  ) {
    this.scanner = new LibraryScanner(app);
    this.index = {
      version: LIBRARY_INDEX_VERSION,
      library: {},
      syncQueue: [],
    };
  }

  /**
   * Configure the scanner with server settings
   */
  setServerConfig(serverUrl: string, deviceId: string): void {
    this.scanner.setServerConfig(serverUrl, deviceId);
  }

  /**
   * Initialize the library
   */
  async initialize(booksFolder: string): Promise<void> {
    // Load persisted index
    await this.loadIndex();

    // Start watching for changes
    this.startWatching(booksFolder);

    // Initial scan
    await this.scan(booksFolder);
  }

  /**
   * Load the library index from plugin data
   */
  private async loadIndex(): Promise<void> {
    try {
      const data = await this.loadData() as { libraryIndex?: LibraryIndex };
      if (data?.libraryIndex) {
        this.index = data.libraryIndex;
      }
    } catch (e) {
      console.warn('Failed to load library index:', e);
    }
  }

  /**
   * Save the library index to plugin data
   */
  private async saveIndex(): Promise<void> {
    try {
      const data = await this.loadData() as Record<string, unknown> | null;
      await this.saveData({
        ...data,
        libraryIndex: this.index,
      });
    } catch (e) {
      console.error('Failed to save library index:', e);
    }
  }

  /**
   * Scan a folder for books
   */
  async scan(folderPath: string): Promise<ScanResult> {
    this.store.dispatch({ type: 'SET_LOADING', payload: true });

    try {
      const result = await this.scanner.scanFolder(folderPath);

      // Merge with existing index
      for (const book of result.books) {
        const existing = this.findBookByPath(book.localPath!);
        if (existing) {
          // Preserve reading state from existing book
          book.id = existing.id;
          book.status = existing.status;
          book.progress = existing.progress;
          book.currentCfi = existing.currentCfi;
          book.lastRead = existing.lastRead;
          book.highlightCount = existing.highlightCount;
        }

        // Update index
        this.index.library[book.id] = this.bookToIndexEntry(book);
      }

      // Remove books that no longer exist
      const existingPaths = new Set(result.books.map(b => b.localPath));
      for (const [id, entry] of Object.entries(this.index.library)) {
        if (entry.localPath && !existingPaths.has(entry.localPath)) {
          delete this.index.library[id];
        }
      }

      // Save updated index
      await this.saveIndex();

      // Update store
      this.store.dispatch({ type: 'SET_BOOKS', payload: result.books });
      this.store.dispatch({ type: 'SET_LOADING', payload: false });

      if (result.errors.length > 0) {
        const errorMsg = result.errors.map(e => `${e.path}: ${e.error}`).join('\n');
        this.store.dispatch({ type: 'SET_ERROR', payload: errorMsg });
      }

      return result;
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Scan failed';
      this.store.dispatch({ type: 'SET_ERROR', payload: error });
      this.store.dispatch({ type: 'SET_LOADING', payload: false });
      throw e;
    }
  }

  /**
   * Start watching for file changes
   */
  private startWatching(folderPath: string): void {
    if (this.watcher) {
      this.watcher();
    }

    this.watcher = this.scanner.watchFolder(folderPath, async (event, path) => {
      console.log(`Library file ${event}: ${path}`);

      if (event === 'added') {
        // Add new book
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          try {
            const book = await this.scanner.extractMetadata(file);
            this.index.library[book.id] = this.bookToIndexEntry(book);
            await this.saveIndex();
            this.store.dispatch({ type: 'ADD_BOOK', payload: book });
          } catch (e) {
            console.error('Failed to add book:', e);
          }
        }
      } else if (event === 'removed') {
        // Remove book
        const book = this.findBookByPath(path);
        if (book) {
          delete this.index.library[book.id];
          await this.saveIndex();
          this.store.dispatch({ type: 'REMOVE_BOOK', payload: book.id });
        }
      }
    });
  }

  /**
   * Stop watching for changes
   */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher();
      this.watcher = null;
    }
  }

  /**
   * Find a book by its local path
   */
  private findBookByPath(path: string): Book | undefined {
    const books = this.store.getValue().books;
    return books.find(b => b.localPath === path);
  }

  /**
   * Get a book by ID
   */
  getBook(id: string): Book | undefined {
    return this.store.getValue().books.find(b => b.id === id);
  }

  /**
   * Update reading progress for a book
   */
  async updateProgress(bookId: string, progress: number, cfi?: string): Promise<void> {
    const book = this.getBook(bookId);
    if (!book) return;

    const updatedBook: Book = {
      ...book,
      progress,
      currentCfi: cfi,
      lastRead: new Date(),
      status: progress >= 100 ? 'completed' : progress > 0 ? 'reading' : book.status,
    };

    // Update index
    this.index.library[bookId] = this.bookToIndexEntry(updatedBook);
    await this.saveIndex();

    // Update store
    this.store.dispatch({ type: 'UPDATE_BOOK', payload: updatedBook });

    // Queue for sync
    this.index.syncQueue.push({
      type: 'progress',
      bookId,
      data: { progress, cfi },
      timestamp: new Date(),
    });
  }

  /**
   * Update book status
   */
  async updateStatus(bookId: string, status: BookStatus): Promise<void> {
    const book = this.getBook(bookId);
    if (!book) return;

    const updatedBook: Book = {
      ...book,
      status,
      completedAt: status === 'completed' ? new Date() : book.completedAt,
    };

    this.index.library[bookId] = this.bookToIndexEntry(updatedBook);
    await this.saveIndex();

    this.store.dispatch({ type: 'UPDATE_BOOK', payload: updatedBook });
  }

  /**
   * Search books by query
   */
  search(query: string): Book[] {
    const books = this.store.getValue().books;
    const q = query.toLowerCase();

    return books.filter(book =>
      book.title.toLowerCase().includes(q) ||
      book.author?.toLowerCase().includes(q)
    );
  }

  /**
   * Filter books by status
   */
  filterByStatus(status: BookStatus): Book[] {
    return this.store.getValue().books.filter(b => b.status === status);
  }

  /**
   * Get recent books
   */
  getRecentBooks(limit: number = 10): Book[] {
    const books = this.store.getValue().books;
    return [...books]
      .filter(b => b.lastRead)
      .sort((a, b) => (b.lastRead?.getTime() || 0) - (a.lastRead?.getTime() || 0))
      .slice(0, limit);
  }

  /**
   * Convert a Book to an IndexEntry
   */
  private bookToIndexEntry(book: Book): BookIndexEntry {
    return {
      title: book.title,
      author: book.author,
      localPath: book.localPath,
      serverId: book.serverId,
      lastRead: book.lastRead?.toISOString(),
      progress: book.progress,
      highlights: [],
    };
  }
}
