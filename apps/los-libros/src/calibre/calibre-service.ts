/**
 * CalibreService - Main coordinator for Calibre integration
 *
 * Responsibilities:
 * - Connect to Calibre library (database or content server)
 * - Scan and index books
 * - Generate Obsidian notes from Calibre metadata
 * - Handle bidirectional sync
 * - Manage cover images
 */

import { App, TFile, TFolder, TAbstractFile, normalizePath, Notice } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';

import { CalibreDatabase } from './database/calibre-db';
import { ContentServerClient } from './server/content-server-client';
import { parseOPF } from './parser/opf-parser';
import { Store } from '../helpers/store';
import { calibreReducer, initialCalibreState } from './calibre-reducer';
import type {
  CalibreState,
  CalibreAction,
  CalibreBookFull,
  BookNoteFrontmatter,
  AuthorNoteFrontmatter,
  SeriesNoteFrontmatter,
  ShelfNoteFrontmatter,
} from './calibre-types';
import type { LibrosSettings } from '../settings/settings';

/**
 * Connection mode for Calibre library
 */
export type ConnectionMode = 'local' | 'server' | 'none';

export class CalibreService {
  private app: App;
  private db: CalibreDatabase | null = null;
  private contentServer: ContentServerClient | null = null;
  private connectionMode: ConnectionMode = 'none';
  private store: Store<CalibreState, CalibreAction>;
  private getSettings: () => LibrosSettings;

  constructor(
    app: App,
    getSettings: () => LibrosSettings
  ) {
    this.app = app;
    this.getSettings = getSettings;
    this.store = new Store<CalibreState, CalibreAction>(
      initialCalibreState,
      calibreReducer
    );
  }

  /**
   * Get the current connection mode
   */
  getConnectionMode(): ConnectionMode {
    return this.connectionMode;
  }

  /**
   * Get the content server client (for direct access)
   */
  getContentServer(): ContentServerClient | null {
    return this.contentServer;
  }

  /**
   * Get the state store (for Svelte reactivity)
   */
  getStore(): Store<CalibreState, CalibreAction> {
    return this.store;
  }

  /**
   * Initialize connection to Calibre library
   * Tries local database first, falls back to content server if available
   */
  async connect(): Promise<void> {
    const settings = this.getSettings();

    if (!settings.calibreEnabled) {
      throw new Error('Calibre integration is not enabled');
    }

    // Try local database first
    const localSuccess = await this.tryConnectLocal();
    if (localSuccess) {
      return;
    }

    // Fallback to content server if enabled
    if (settings.calibreContentServerEnabled && settings.calibreContentServerUrl) {
      const serverSuccess = await this.tryConnectServer();
      if (serverSuccess) {
        return;
      }
    }

    // Neither connection worked
    throw new Error(
      'Could not connect to Calibre library. ' +
        'Check that the library path exists or content server is running.'
    );
  }

  /**
   * Try to connect to local Calibre database
   */
  private async tryConnectLocal(): Promise<boolean> {
    const settings = this.getSettings();

    if (!settings.calibreLibraryPath) {
      console.log('No Calibre library path configured');
      return false;
    }

    const dbPath = path.join(settings.calibreLibraryPath, 'metadata.db');
    if (!fs.existsSync(dbPath)) {
      console.log('Calibre database not found at:', dbPath);
      return false;
    }

    try {
      this.db = new CalibreDatabase(settings.calibreLibraryPath, true);
      await this.db.open();

      this.connectionMode = 'local';
      this.store.dispatch({
        type: 'SET_LIBRARY_PATH',
        path: settings.calibreLibraryPath,
      });
      this.store.dispatch({ type: 'SET_CONNECTED', connected: true });

      console.log('Connected to local Calibre library:', settings.calibreLibraryPath);
      return true;
    } catch (error) {
      console.warn('Failed to connect to local database:', error);
      this.db = null;
      return false;
    }
  }

  /**
   * Try to connect to Calibre Content Server
   */
  private async tryConnectServer(): Promise<boolean> {
    const settings = this.getSettings();

    if (!settings.calibreContentServerUrl) {
      console.log('No Content Server URL configured');
      return false;
    }

    try {
      this.contentServer = new ContentServerClient(
        settings.calibreContentServerUrl,
        {
          username: settings.calibreContentServerUsername,
          password: settings.calibreContentServerPassword,
        }
      );

      await this.contentServer.connect();

      this.connectionMode = 'server';
      this.store.dispatch({
        type: 'SET_LIBRARY_PATH',
        path: settings.calibreContentServerUrl,
      });
      this.store.dispatch({ type: 'SET_CONNECTED', connected: true });

      console.log('Connected to Calibre Content Server:', settings.calibreContentServerUrl);
      new Notice('Connected to Calibre Content Server');
      return true;
    } catch (error) {
      console.warn('Failed to connect to content server:', error);
      this.contentServer = null;
      return false;
    }
  }

  /**
   * Disconnect from Calibre library
   */
  disconnect(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    if (this.contentServer) {
      this.contentServer.disconnect();
      this.contentServer = null;
    }
    this.connectionMode = 'none';
    this.store.dispatch({ type: 'SET_CONNECTED', connected: false });
  }

  /**
   * Scan the Calibre library and load all books
   */
  async scan(): Promise<CalibreBookFull[]> {
    // Ensure we're connected
    if (this.connectionMode === 'none') {
      await this.connect();
    }

    this.store.dispatch({ type: 'SET_LOADING', loading: true });

    try {
      let books: CalibreBookFull[];

      if (this.connectionMode === 'local' && this.db) {
        // Scan from local database
        books = this.db.getAllBooksFull();
      } else if (this.connectionMode === 'server' && this.contentServer) {
        // Scan from content server
        books = await this.contentServer.getAllBooks();
      } else {
        throw new Error('No connection available');
      }

      this.store.dispatch({ type: 'SET_BOOKS', books });

      console.log(
        `Scanned ${books.length} books from Calibre (${this.connectionMode} mode)`
      );
      return books;
    } catch (error) {
      this.store.dispatch({
        type: 'SET_ERROR',
        error: `Scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
      throw error;
    }
  }

  /**
   * Download a book file (for content server mode)
   */
  async downloadBook(bookId: number): Promise<ArrayBuffer> {
    if (this.connectionMode === 'server' && this.contentServer) {
      return this.contentServer.downloadBook(bookId);
    }
    throw new Error('Download only available in content server mode');
  }

  /**
   * Download a book cover (for content server mode)
   */
  async downloadCover(bookId: number): Promise<ArrayBuffer> {
    if (this.connectionMode === 'server' && this.contentServer) {
      return this.contentServer.downloadCover(bookId);
    }
    throw new Error('Download only available in content server mode');
  }

  /**
   * Full sync: Import all books from Calibre to Obsidian
   */
  async fullSync(): Promise<void> {
    const settings = this.getSettings();
    this.store.dispatch({ type: 'START_SYNC' });

    try {
      // Scan library
      this.store.dispatch({
        type: 'UPDATE_SYNC_PROGRESS',
        progress: { phase: 'scanning', currentItemName: 'Scanning Calibre library...' },
      });
      const books = await this.scan();
      const totalBooks = books.length;

      // Ensure folders exist
      await this.ensureFolders();

      // Generate notes for each book
      this.store.dispatch({
        type: 'UPDATE_SYNC_PROGRESS',
        progress: { phase: 'generating-notes', totalItems: totalBooks, currentItem: 0 },
      });

      for (let i = 0; i < books.length; i++) {
        const book = books[i];
        this.store.dispatch({
          type: 'UPDATE_SYNC_PROGRESS',
          progress: {
            currentItem: i + 1,
            currentItemName: book.title,
            percentage: Math.round(((i + 1) / totalBooks) * 50), // Notes = 0-50%
          },
        });
        await this.generateBookNote(book);
      }

      // Copy covers
      this.store.dispatch({
        type: 'UPDATE_SYNC_PROGRESS',
        progress: { phase: 'copying-covers', currentItem: 0 },
      });

      for (let i = 0; i < books.length; i++) {
        const book = books[i];
        this.store.dispatch({
          type: 'UPDATE_SYNC_PROGRESS',
          progress: {
            currentItem: i + 1,
            currentItemName: `Cover: ${book.title}`,
            percentage: Math.round(50 + ((i + 1) / totalBooks) * 30), // Covers = 50-80%
          },
        });
        await this.copyCover(book);
      }

      // Generate indexes with progress tracking
      this.store.dispatch({
        type: 'UPDATE_SYNC_PROGRESS',
        progress: { phase: 'generating-indexes', currentItemName: 'Preparing author indexes...', percentage: 80 },
      });
      await this.generateAuthorIndexes((current, total, name) => {
        this.store.dispatch({
          type: 'UPDATE_SYNC_PROGRESS',
          progress: {
            currentItem: current,
            totalItems: total,
            currentItemName: `Author: ${name}`,
            percentage: Math.round(80 + (current / total) * 5), // 80-85%
          },
        });
      });

      this.store.dispatch({
        type: 'UPDATE_SYNC_PROGRESS',
        progress: { currentItemName: 'Preparing series indexes...', percentage: 85 },
      });
      await this.generateSeriesIndexes((current, total, name) => {
        this.store.dispatch({
          type: 'UPDATE_SYNC_PROGRESS',
          progress: {
            currentItem: current,
            totalItems: total,
            currentItemName: `Series: ${name}`,
            percentage: Math.round(85 + (current / total) * 5), // 85-90%
          },
        });
      });

      this.store.dispatch({
        type: 'UPDATE_SYNC_PROGRESS',
        progress: { currentItemName: 'Preparing shelf indexes...', percentage: 90 },
      });
      await this.generateShelfIndexes((current, total, name) => {
        this.store.dispatch({
          type: 'UPDATE_SYNC_PROGRESS',
          progress: {
            currentItem: current,
            totalItems: total,
            currentItemName: `Shelf: ${name}`,
            percentage: Math.round(90 + (current / total) * 5), // 90-95%
          },
        });
      });

      this.store.dispatch({
        type: 'UPDATE_SYNC_PROGRESS',
        progress: { currentItemName: 'Generating base files...', percentage: 98 },
      });
      await this.generateBaseFiles();

      this.store.dispatch({ type: 'COMPLETE_SYNC', timestamp: new Date() });
      new Notice(`Calibre sync complete: ${totalBooks} books indexed`);
      console.log('Full Calibre sync completed');
    } catch (error) {
      this.store.dispatch({
        type: 'SET_ERROR',
        error: `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
      this.store.dispatch({
        type: 'UPDATE_SYNC_PROGRESS',
        progress: { phase: 'idle', percentage: 0 },
      });
      throw error;
    }
  }

  /**
   * Ensure all configured folders exist (handles nested paths)
   */
  private async ensureFolders(): Promise<void> {
    const settings = this.getSettings();
    const folders = [
      settings.calibreBookNotesFolder,
      settings.calibreAuthorIndexFolder,
      settings.calibreSeriesIndexFolder,
      settings.calibreShelfIndexFolder,
      settings.calibreHighlightsFolder,
      settings.calibreBaseFilesFolder,
      settings.calibreCoversFolder,
    ];

    for (const folder of folders) {
      await this.ensureFolderExists(folder);
    }
  }

  /**
   * Ensure a folder exists, creating parent folders as needed
   */
  private async ensureFolderExists(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    const parts = normalized.split('/');
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(currentPath);
      if (!existing) {
        try {
          console.log(`[Calibre] Creating folder: ${currentPath}`);
          await this.app.vault.createFolder(currentPath);
        } catch (e) {
          console.log(`[Calibre] Folder creation error for ${currentPath}:`, e);
          // Folder might have been created by another operation, ignore
          if (!(e instanceof Error && e.message.includes('already exists'))) {
            throw e;
          }
        }
      }
    }
  }

  /**
   * Generate a book note from Calibre metadata
   */
  async generateBookNote(book: CalibreBookFull): Promise<TFile> {
    const settings = this.getSettings();

    // Build frontmatter
    const authorName = book.authors.length > 0 ? book.authors[0].name : 'Unknown';
    // Sanitize author name for wikilinks (remove pipe characters that break syntax)
    const sanitizedAuthorName = this.sanitizeFilename(authorName).replace(/\|/g, '-');
    const authorLink = `[[${settings.calibreAuthorIndexFolder}/${sanitizedAuthorName}|${authorName}]]`;

    const seriesLink = book.series
      ? `[[${settings.calibreSeriesIndexFolder}/${this.sanitizeFilename(book.series.name)}|${book.series.name}]]`
      : undefined;

    const bookshelves = book.tags.map(
      (tag) => `[[${settings.calibreShelfIndexFolder}/${this.sanitizeFilename(tag.name)}|${tag.name}]]`
    );

    // Cover URL in wikilink format for Obsidian Bases card view
    const coverVaultPath = book.hasCover
      ? `[[${settings.calibreCoversFolder}/calibre-${book.id}.jpg]]`
      : '';

    const frontmatter: BookNoteFrontmatter = {
      type: 'book',
      bookId: book.uuid,
      calibreId: book.id,
      title: book.title,
      author: authorLink,
      series: seriesLink,
      seriesIndex: book.seriesIndex ?? undefined,
      bookshelves,
      tags: book.tags.map((t) => t.name),
      rating: book.rating ?? undefined,
      coverUrl: coverVaultPath,
      progress: 0,
      status: 'to-read',
      language: book.languages[0]?.lang_code,
      publisher: book.publisher?.name,
      publishedDate: book.pubdate?.toISOString().split('T')[0],
      isbn: book.identifiers['isbn'],
      epubPath: book.epubPath || '',
      calibrePath: book.calibrePath,
      lastSync: new Date().toISOString(),
    };

    // Build note content
    const content = this.buildBookNoteContent(frontmatter, book);

    // Create or update file
    const filePath = `${settings.calibreBookNotesFolder}/${this.sanitizeFilename(book.title)}.md`;
    return await this.createOrUpdateFile(filePath, content);
  }

  /**
   * Build the content of a book note
   */
  private buildBookNoteContent(
    frontmatter: BookNoteFrontmatter,
    book: CalibreBookFull
  ): string {
    // Build YAML frontmatter
    const yaml = [
      '---',
      `type: ${frontmatter.type}`,
      `bookId: "${frontmatter.bookId}"`,
      `calibreId: ${frontmatter.calibreId}`,
      `title: "${this.escapeYaml(frontmatter.title)}"`,
      `author: "${frontmatter.author}"`,
    ];

    if (frontmatter.series) {
      yaml.push(`series: "${frontmatter.series}"`);
      if (frontmatter.seriesIndex) {
        yaml.push(`seriesIndex: ${frontmatter.seriesIndex}`);
      }
    }

    if (frontmatter.bookshelves.length > 0) {
      yaml.push('bookshelves:');
      for (const shelf of frontmatter.bookshelves) {
        yaml.push(`  - "${shelf}"`);
      }
    }

    if (frontmatter.tags.length > 0) {
      yaml.push(`tags: [${frontmatter.tags.join(', ')}]`);
    }

    if (frontmatter.rating !== undefined) {
      yaml.push(`rating: ${frontmatter.rating}`);
    }

    if (frontmatter.coverUrl) {
      yaml.push(`coverUrl: "${frontmatter.coverUrl}"`);
    }

    yaml.push(`progress: ${frontmatter.progress}`);
    yaml.push(`status: ${frontmatter.status}`);

    if (frontmatter.language) {
      yaml.push(`language: ${frontmatter.language}`);
    }
    if (frontmatter.publisher) {
      yaml.push(`publisher: "${this.escapeYaml(frontmatter.publisher)}"`);
    }
    if (frontmatter.publishedDate) {
      yaml.push(`publishedDate: ${frontmatter.publishedDate}`);
    }
    if (frontmatter.isbn) {
      yaml.push(`isbn: "${frontmatter.isbn}"`);
    }

    yaml.push(`epubPath: "${frontmatter.epubPath}"`);
    yaml.push(`calibrePath: "${frontmatter.calibrePath}"`);
    yaml.push(`lastSync: ${frontmatter.lastSync}`);
    yaml.push('---');

    // Build body
    const body = [
      '',
      `# ${book.title}`,
      '',
      `**Author:** ${frontmatter.author}`,
    ];

    if (frontmatter.series) {
      body.push(`**Series:** ${frontmatter.series} #${frontmatter.seriesIndex || 1}`);
    }

    if (frontmatter.rating !== undefined) {
      const stars = '★'.repeat(frontmatter.rating) + '☆'.repeat(5 - frontmatter.rating);
      body.push(`**Rating:** ${stars}`);
    }

    if (book.description) {
      body.push('', '## Description', '', book.description);
    }

    body.push('', '## Notes', '', '');
    body.push('', '## Highlights', '', '');

    return [...yaml, ...body].join('\n');
  }

  /**
   * Copy book cover to vault
   */
  async copyCover(book: CalibreBookFull): Promise<void> {
    if (!book.hasCover) return;

    const settings = this.getSettings();
    const vaultPath = normalizePath(
      `${settings.calibreCoversFolder}/calibre-${book.id}.jpg`
    );

    try {
      let coverData: ArrayBuffer;

      if (this.connectionMode === 'local') {
        // Local mode: read from filesystem
        if (!book.coverPath || !fs.existsSync(book.coverPath)) {
          return;
        }
        const buffer = fs.readFileSync(book.coverPath);
        // Convert Buffer to ArrayBuffer
        coverData = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        ) as ArrayBuffer;
      } else if (this.connectionMode === 'server' && this.contentServer) {
        // Server mode: download from content server
        coverData = await this.contentServer.downloadCover(book.id);
      } else {
        return;
      }

      await this.createOrUpdateBinaryFile(vaultPath, coverData);
    } catch (error) {
      console.warn(`Failed to copy cover for ${book.title}:`, error);
    }
  }

  /**
   * Generate author index notes
   */
  async generateAuthorIndexes(
    onProgress?: (current: number, total: number, name: string) => void
  ): Promise<void> {
    const settings = this.getSettings();
    const books = this.store.getValue().books;

    // Extract unique authors from books
    const authorMap = new Map<string, { id: number; name: string; sort: string }>();
    for (const book of books) {
      for (const author of book.authors) {
        if (!authorMap.has(author.name)) {
          authorMap.set(author.name, author);
        }
      }
    }
    const authors = Array.from(authorMap.values());
    const totalAuthors = authors.length;

    for (let i = 0; i < authors.length; i++) {
      const author = authors[i];
      onProgress?.(i + 1, totalAuthors, author.name);

      const authorBooks = books.filter((b) =>
        b.authors.some((a) => a.id === author.id)
      );

      if (authorBooks.length === 0) continue;

      const frontmatter: AuthorNoteFrontmatter = {
        type: 'author',
        name: author.name,
        sortName: author.sort,
        bookCount: authorBooks.length,
        lastSync: new Date().toISOString(),
      };

      const content = this.buildAuthorNoteContent(frontmatter, authorBooks);
      const filePath = `${settings.calibreAuthorIndexFolder}/${this.sanitizeFilename(author.name)}.md`;
      await this.createOrUpdateFile(filePath, content);
    }
  }

  /**
   * Build author note content
   */
  private buildAuthorNoteContent(
    frontmatter: AuthorNoteFrontmatter,
    books: CalibreBookFull[]
  ): string {
    const settings = this.getSettings();

    const yaml = [
      '---',
      `type: ${frontmatter.type}`,
      `name: "${this.escapeYaml(frontmatter.name)}"`,
      `sortName: "${this.escapeYaml(frontmatter.sortName)}"`,
      `bookCount: ${frontmatter.bookCount}`,
      `lastSync: ${frontmatter.lastSync}`,
      '---',
    ];

    const body = [
      '',
      `# ${frontmatter.name}`,
      '',
      `**Books:** ${frontmatter.bookCount}`,
      '',
      '## Books',
      '',
    ];

    for (const book of books) {
      const bookLink = `[[${settings.calibreBookNotesFolder}/${this.sanitizeFilename(book.title)}|${book.title}]]`;
      body.push(`- ${bookLink}`);
    }

    return [...yaml, ...body].join('\n');
  }

  /**
   * Generate series index notes
   */
  async generateSeriesIndexes(
    onProgress?: (current: number, total: number, name: string) => void
  ): Promise<void> {
    const settings = this.getSettings();
    const books = this.store.getValue().books;

    // Extract unique series from books
    const seriesMap = new Map<string, { id: number; name: string }>();
    for (const book of books) {
      if (book.series && !seriesMap.has(book.series.name)) {
        seriesMap.set(book.series.name, book.series);
      }
    }
    const allSeries = Array.from(seriesMap.values());
    const totalSeries = allSeries.length;

    for (let i = 0; i < allSeries.length; i++) {
      const series = allSeries[i];
      onProgress?.(i + 1, totalSeries, series.name);

      const seriesBooks = books
        .filter((b) => b.series?.id === series.id)
        .sort((a, b) => (a.seriesIndex ?? 0) - (b.seriesIndex ?? 0));

      if (seriesBooks.length === 0) continue;

      const frontmatter: SeriesNoteFrontmatter = {
        type: 'series',
        name: series.name,
        bookCount: seriesBooks.length,
        lastSync: new Date().toISOString(),
      };

      const content = this.buildSeriesNoteContent(frontmatter, seriesBooks);
      const filePath = `${settings.calibreSeriesIndexFolder}/${this.sanitizeFilename(series.name)}.md`;
      await this.createOrUpdateFile(filePath, content);
    }
  }

  /**
   * Build series note content
   */
  private buildSeriesNoteContent(
    frontmatter: SeriesNoteFrontmatter,
    books: CalibreBookFull[]
  ): string {
    const settings = this.getSettings();

    const yaml = [
      '---',
      `type: ${frontmatter.type}`,
      `name: "${this.escapeYaml(frontmatter.name)}"`,
      `bookCount: ${frontmatter.bookCount}`,
      `lastSync: ${frontmatter.lastSync}`,
      '---',
    ];

    const body = [
      '',
      `# ${frontmatter.name}`,
      '',
      `**Books:** ${frontmatter.bookCount}`,
      '',
      '## Books in Series',
      '',
    ];

    for (const book of books) {
      const bookLink = `[[${settings.calibreBookNotesFolder}/${this.sanitizeFilename(book.title)}|${book.title}]]`;
      body.push(`${book.seriesIndex || '?'}. ${bookLink}`);
    }

    return [...yaml, ...body].join('\n');
  }

  /**
   * Generate shelf/tag index notes
   */
  async generateShelfIndexes(
    onProgress?: (current: number, total: number, name: string) => void
  ): Promise<void> {
    const settings = this.getSettings();
    const books = this.store.getValue().books;

    // Extract unique tags from books
    const tagMap = new Map<string, { id: number; name: string }>();
    for (const book of books) {
      for (const tag of book.tags) {
        if (!tagMap.has(tag.name)) {
          tagMap.set(tag.name, tag);
        }
      }
    }
    const tags = Array.from(tagMap.values());
    const totalTags = tags.length;

    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i];
      onProgress?.(i + 1, totalTags, tag.name);

      const tagBooks = books.filter((b) =>
        b.tags.some((t) => t.id === tag.id)
      );

      if (tagBooks.length === 0) continue;

      const frontmatter: ShelfNoteFrontmatter = {
        type: 'shelf',
        name: tag.name,
        bookCount: tagBooks.length,
        lastSync: new Date().toISOString(),
      };

      const content = this.buildShelfNoteContent(frontmatter, tagBooks);
      const filePath = `${settings.calibreShelfIndexFolder}/${this.sanitizeFilename(tag.name)}.md`;
      await this.createOrUpdateFile(filePath, content);
    }
  }

  /**
   * Build shelf note content
   */
  private buildShelfNoteContent(
    frontmatter: ShelfNoteFrontmatter,
    books: CalibreBookFull[]
  ): string {
    const settings = this.getSettings();

    const yaml = [
      '---',
      `type: ${frontmatter.type}`,
      `name: "${this.escapeYaml(frontmatter.name)}"`,
      `bookCount: ${frontmatter.bookCount}`,
      `lastSync: ${frontmatter.lastSync}`,
      '---',
    ];

    const body = [
      '',
      `# ${frontmatter.name}`,
      '',
      `**Books:** ${frontmatter.bookCount}`,
      '',
      '## Books',
      '',
    ];

    for (const book of books) {
      const bookLink = `[[${settings.calibreBookNotesFolder}/${this.sanitizeFilename(book.title)}|${book.title}]]`;
      body.push(`- ${bookLink}`);
    }

    return [...yaml, ...body].join('\n');
  }

  /**
   * Generate .base files for Obsidian Bases Card View
   */
  async generateBaseFiles(): Promise<void> {
    const settings = this.getSettings();

    // Main library Card View
    const libraryBase = this.buildLibraryBaseFile();
    await this.writeBaseFile(
      `${settings.calibreBaseFilesFolder}/Biblioteca.base`,
      libraryBase
    );

    // By Author view
    const authorBase = this.buildAuthorBaseFile();
    await this.writeBaseFile(
      `${settings.calibreBaseFilesFolder}/Por Autor.base`,
      authorBase
    );

    // In Progress view
    const progressBase = this.buildProgressBaseFile();
    await this.writeBaseFile(
      `${settings.calibreBaseFilesFolder}/En Progreso.base`,
      progressBase
    );
  }

  /**
   * Build main library .base file
   */
  private buildLibraryBaseFile(): string {
    const settings = this.getSettings();

    return `filters:
  file.path.startsWith("${settings.calibreBookNotesFolder}")

properties:
  title:
    displayName: Title
  author:
    displayName: Author
  rating:
    displayName: Rating
  status:
    displayName: Status
  progress:
    displayName: Progress
  coverUrl:
    displayName: Cover

views:
  - type: cards
    name: Library
`;
  }

  /**
   * Build author grouping .base file
   */
  private buildAuthorBaseFile(): string {
    const settings = this.getSettings();

    return `filters:
  and:
    - file.path.startsWith("${settings.calibreBookNotesFolder}")
    - type = "book"

properties:
  title:
    displayName: Title
  author:
    displayName: Author
  series:
    displayName: Series

views:
  - type: table
    name: By Author
    groupBy:
      property: author
      direction: ASC
`;
  }

  /**
   * Build in-progress .base file
   */
  private buildProgressBaseFile(): string {
    const settings = this.getSettings();

    return `filters:
  and:
    - file.path.startsWith("${settings.calibreBookNotesFolder}")
    - type = "book"
    - status = "reading"

properties:
  title:
    displayName: Title
  author:
    displayName: Author
  progress:
    displayName: Progress
  coverUrl:
    displayName: Cover

views:
  - type: cards
    name: Currently Reading
`;
  }

  /**
   * Find a file by path, with case-insensitive fallback for case-insensitive filesystems
   */
  private findFileByPath(filePath: string): TFile | null {
    const normalized = normalizePath(filePath);

    // First try exact match
    let file = this.app.vault.getAbstractFileByPath(normalized) as TFile | null;
    if (file) return file;

    // Case-insensitive fallback: check parent folder for similar filename
    const parts = normalized.split('/');
    const fileName = parts.pop()!;
    const folderPath = parts.join('/');
    const fileNameLower = fileName.toLowerCase();

    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (folder && folder instanceof TFolder) {
      for (const child of folder.children) {
        if (child instanceof TFile && child.name.toLowerCase() === fileNameLower) {
          return child;
        }
      }
    }

    return null;
  }

  /**
   * Create or update a text file, handling race conditions and case-insensitive filesystems
   */
  private async createOrUpdateFile(filePath: string, content: string): Promise<TFile> {
    const normalized = normalizePath(filePath);
    let file = this.findFileByPath(normalized);

    if (file) {
      await this.app.vault.modify(file, content);
      return file;
    }

    try {
      return await this.app.vault.create(normalized, content);
    } catch (e) {
      if (e instanceof Error && e.message.includes('already exists')) {
        // File exists with different case, find and modify it
        file = this.findFileByPath(normalized);
        if (file) {
          await this.app.vault.modify(file, content);
          return file;
        }
      }
      throw e;
    }
  }

  /**
   * Create or update a binary file, handling race conditions and case-insensitive filesystems
   */
  private async createOrUpdateBinaryFile(filePath: string, data: ArrayBuffer): Promise<TFile> {
    const normalized = normalizePath(filePath);
    let file = this.findFileByPath(normalized);

    if (file) {
      await this.app.vault.modifyBinary(file, data);
      return file;
    }

    try {
      return await this.app.vault.createBinary(normalized, data);
    } catch (e) {
      if (e instanceof Error && e.message.includes('already exists')) {
        file = this.findFileByPath(normalized);
        if (file) {
          await this.app.vault.modifyBinary(file, data);
          return file;
        }
      }
      throw e;
    }
  }

  /**
   * Write a .base file
   */
  private async writeBaseFile(filePath: string, content: string): Promise<void> {
    await this.createOrUpdateFile(filePath, content);
  }

  /**
   * Sanitize a string for use as a filename
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
      .replace(/\s+/g, ' ')          // Normalize spaces
      .trim()
      .slice(0, 200);                // Limit length
  }

  /**
   * Escape a string for YAML
   */
  private escapeYaml(str: string): string {
    return str.replace(/"/g, '\\"').replace(/\n/g, ' ');
  }
}
