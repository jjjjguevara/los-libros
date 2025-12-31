/**
 * Index Generator
 *
 * Generates index notes for authors, series, and shelves using the unified template system.
 */

import { App, TFile, normalizePath } from 'obsidian';
import type { UnifiedBook, Author, Series } from '../types/unified-book';
import type { TemplateSettings } from '../templates/template-types';
import {
  UnifiedNoteGenerator,
  type AuthorWithBooks,
  type SeriesWithBooks,
  type ShelfWithBooks,
} from '../templates/unified-note-generator';

export interface IndexGeneratorOptions {
  /** Update existing index files */
  updateExisting: boolean;
  /** Minimum book count to generate index */
  minBooks: number;
}

const DEFAULT_OPTIONS: IndexGeneratorOptions = {
  updateExisting: true,
  minBooks: 1,
};

export interface IndexGenerationResult {
  authorFiles: TFile[];
  seriesFiles: TFile[];
  shelfFiles: TFile[];
  errors: string[];
}

export class IndexGenerator {
  private app: App;
  private generator: UnifiedNoteGenerator;
  private getSettings: () => TemplateSettings;

  constructor(
    app: App,
    templates: TemplateSettings,
    getSettings?: () => TemplateSettings
  ) {
    this.app = app;
    this.generator = new UnifiedNoteGenerator(app, templates);
    this.getSettings = getSettings || (() => templates);
  }

  /**
   * Update template settings
   */
  setTemplates(templates: TemplateSettings): void {
    this.generator.setTemplates(templates);
  }

  /**
   * Generate all indexes from a collection of books
   */
  async generateAllIndexes(
    books: UnifiedBook[],
    options: Partial<IndexGeneratorOptions> = {}
  ): Promise<IndexGenerationResult> {
    const result: IndexGenerationResult = {
      authorFiles: [],
      seriesFiles: [],
      shelfFiles: [],
      errors: [],
    };

    // Generate author indexes
    const authorResult = await this.generateAuthorIndexes(books, options);
    result.authorFiles = authorResult.files;
    result.errors.push(...authorResult.errors);

    // Generate series indexes
    const seriesResult = await this.generateSeriesIndexes(books, options);
    result.seriesFiles = seriesResult.files;
    result.errors.push(...seriesResult.errors);

    // Generate shelf indexes
    const shelfResult = await this.generateShelfIndexes(books, options);
    result.shelfFiles = shelfResult.files;
    result.errors.push(...shelfResult.errors);

    return result;
  }

  /**
   * Generate author index notes
   */
  async generateAuthorIndexes(
    books: UnifiedBook[],
    options: Partial<IndexGeneratorOptions> = {}
  ): Promise<{ files: TFile[]; errors: string[] }> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const settings = this.getSettings();
    const files: TFile[] = [];
    const errors: string[] = [];

    if (!settings.authorIndex.enabled) {
      return { files, errors };
    }

    // Group books by author
    const authorMap = new Map<string, AuthorWithBooks>();

    for (const book of books) {
      for (const author of book.authors) {
        const key = author.name.toLowerCase();
        const existing = authorMap.get(key);

        if (existing) {
          existing.books.push(book);
          existing.bookCount = existing.books.length;
        } else {
          authorMap.set(key, {
            ...author,
            books: [book],
            bookCount: 1,
          });
        }
      }
    }

    // Generate index for each author
    for (const author of authorMap.values()) {
      if (author.bookCount < opts.minBooks) continue;

      try {
        const result = await this.generator.generateAuthorIndex(author);
        if (result.success && result.filePath) {
          const file = this.app.vault.getAbstractFileByPath(result.filePath) as TFile;
          if (file) files.push(file);
        } else if (result.error) {
          errors.push(result.error);
        }
      } catch (error) {
        errors.push(`Author index error (${author.name}): ${error}`);
      }
    }

    return { files, errors };
  }

  /**
   * Generate series index notes
   */
  async generateSeriesIndexes(
    books: UnifiedBook[],
    options: Partial<IndexGeneratorOptions> = {}
  ): Promise<{ files: TFile[]; errors: string[] }> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const settings = this.getSettings();
    const files: TFile[] = [];
    const errors: string[] = [];

    if (!settings.seriesIndex.enabled) {
      return { files, errors };
    }

    // Group books by series
    const seriesMap = new Map<string, SeriesWithBooks>();

    for (const book of books) {
      if (!book.series) continue;

      const key = book.series.name.toLowerCase();
      const existing = seriesMap.get(key);

      if (existing) {
        existing.books.push(book);
        existing.bookCount = existing.books.length;
      } else {
        seriesMap.set(key, {
          ...book.series,
          books: [book],
          bookCount: 1,
        });
      }
    }

    // Generate index for each series
    for (const series of seriesMap.values()) {
      if (series.bookCount < opts.minBooks) continue;

      try {
        const result = await this.generator.generateSeriesIndex(series);
        if (result.success && result.filePath) {
          const file = this.app.vault.getAbstractFileByPath(result.filePath) as TFile;
          if (file) files.push(file);
        } else if (result.error) {
          errors.push(result.error);
        }
      } catch (error) {
        errors.push(`Series index error (${series.name}): ${error}`);
      }
    }

    return { files, errors };
  }

  /**
   * Generate shelf/tag index notes
   */
  async generateShelfIndexes(
    books: UnifiedBook[],
    options: Partial<IndexGeneratorOptions> = {}
  ): Promise<{ files: TFile[]; errors: string[] }> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const settings = this.getSettings();
    const files: TFile[] = [];
    const errors: string[] = [];

    if (!settings.shelfIndex.enabled) {
      return { files, errors };
    }

    // Group books by tag/shelf
    const shelfMap = new Map<string, ShelfWithBooks>();

    for (const book of books) {
      for (const tag of book.tags) {
        const key = tag.toLowerCase();
        const existing = shelfMap.get(key);

        if (existing) {
          existing.books.push(book);
          existing.bookCount = existing.books.length;
        } else {
          shelfMap.set(key, {
            name: tag,
            books: [book],
            bookCount: 1,
          });
        }
      }
    }

    // Generate index for each shelf
    for (const shelf of shelfMap.values()) {
      if (shelf.bookCount < opts.minBooks) continue;

      try {
        const result = await this.generator.generateShelfIndex(shelf);
        if (result.success && result.filePath) {
          const file = this.app.vault.getAbstractFileByPath(result.filePath) as TFile;
          if (file) files.push(file);
        } else if (result.error) {
          errors.push(result.error);
        }
      } catch (error) {
        errors.push(`Shelf index error (${shelf.name}): ${error}`);
      }
    }

    return { files, errors };
  }

  /**
   * Generate a single author index
   */
  async generateAuthorIndex(
    author: Author,
    books: UnifiedBook[]
  ): Promise<TFile | null> {
    const settings = this.getSettings();
    if (!settings.authorIndex.enabled) return null;

    const authorBooks = books.filter(b =>
      b.authors.some(a => a.name.toLowerCase() === author.name.toLowerCase())
    );

    const authorWithBooks: AuthorWithBooks = {
      ...author,
      books: authorBooks,
      bookCount: authorBooks.length,
    };

    const result = await this.generator.generateAuthorIndex(authorWithBooks);
    if (result.success && result.filePath) {
      return this.app.vault.getAbstractFileByPath(result.filePath) as TFile;
    }

    return null;
  }

  /**
   * Generate a single series index
   */
  async generateSeriesIndex(
    series: Series,
    books: UnifiedBook[]
  ): Promise<TFile | null> {
    const settings = this.getSettings();
    if (!settings.seriesIndex.enabled) return null;

    const seriesBooks = books.filter(b =>
      b.series?.name.toLowerCase() === series.name.toLowerCase()
    );

    const seriesWithBooks: SeriesWithBooks = {
      ...series,
      books: seriesBooks,
      bookCount: seriesBooks.length,
    };

    const result = await this.generator.generateSeriesIndex(seriesWithBooks);
    if (result.success && result.filePath) {
      return this.app.vault.getAbstractFileByPath(result.filePath) as TFile;
    }

    return null;
  }

  /**
   * Generate a single shelf index
   */
  async generateShelfIndex(
    shelfName: string,
    books: UnifiedBook[]
  ): Promise<TFile | null> {
    const settings = this.getSettings();
    if (!settings.shelfIndex.enabled) return null;

    const shelfBooks = books.filter(b =>
      b.tags.some(t => t.toLowerCase() === shelfName.toLowerCase())
    );

    const shelf: ShelfWithBooks = {
      name: shelfName,
      books: shelfBooks,
      bookCount: shelfBooks.length,
    };

    const result = await this.generator.generateShelfIndex(shelf);
    if (result.success && result.filePath) {
      return this.app.vault.getAbstractFileByPath(result.filePath) as TFile;
    }

    return null;
  }

  /**
   * Get path for an author index
   */
  getAuthorIndexPath(authorName: string): string {
    const config = this.getSettings().authorIndex;
    return normalizePath(`${config.folder}/${this.sanitizeFileName(authorName)}.md`);
  }

  /**
   * Get path for a series index
   */
  getSeriesIndexPath(seriesName: string): string {
    const config = this.getSettings().seriesIndex;
    return normalizePath(`${config.folder}/${this.sanitizeFileName(seriesName)}.md`);
  }

  /**
   * Get path for a shelf index
   */
  getShelfIndexPath(shelfName: string): string {
    const config = this.getSettings().shelfIndex;
    return normalizePath(`${config.folder}/${this.sanitizeFileName(shelfName)}.md`);
  }

  /**
   * Check if an author index exists
   */
  authorIndexExists(authorName: string): boolean {
    return this.app.vault.getAbstractFileByPath(this.getAuthorIndexPath(authorName)) !== null;
  }

  /**
   * Check if a series index exists
   */
  seriesIndexExists(seriesName: string): boolean {
    return this.app.vault.getAbstractFileByPath(this.getSeriesIndexPath(seriesName)) !== null;
  }

  /**
   * Check if a shelf index exists
   */
  shelfIndexExists(shelfName: string): boolean {
    return this.app.vault.getAbstractFileByPath(this.getShelfIndexPath(shelfName)) !== null;
  }

  /**
   * Sanitize a string for use as a filename
   */
  private sanitizeFileName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }
}
