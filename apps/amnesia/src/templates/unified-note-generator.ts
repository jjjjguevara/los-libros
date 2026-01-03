/**
 * Unified Note Generator
 *
 * Generates all types of notes using the new TemplateSettings system.
 * Supports:
 * - Book notes
 * - Hub highlights (aggregated)
 * - Hub notes (aggregated)
 * - Atomic highlights (individual)
 * - Atomic notes (individual)
 * - Author indexes
 * - Series indexes
 * - Shelf indexes
 */

import { App, TFile, normalizePath } from 'obsidian';
import { LiquidEngine } from './liquid-engine';
import type { TemplateSettings, TemplateConfig } from './template-types';
import type { UnifiedBook, Author, Series } from '../types/unified-book';

/**
 * Highlight data for template rendering
 */
export interface HighlightData {
  id: string;
  text: string;
  annotation?: string;
  chapter?: string;
  cfi?: string;
  color: string;
  createdAt: Date;
  updatedAt?: Date;
}

/**
 * Note data for template rendering
 */
export interface NoteData {
  id: string;
  content: string;
  chapter?: string;
  cfi?: string;
  createdAt: Date;
  updatedAt?: Date;
}

/**
 * Author with books for index generation
 */
export interface AuthorWithBooks extends Author {
  books: UnifiedBook[];
  bookCount: number;
}

/**
 * Series with books for index generation
 */
export interface SeriesWithBooks extends Series {
  books: UnifiedBook[];
  bookCount: number;
}

/**
 * Shelf/tag with books for index generation
 */
export interface ShelfWithBooks {
  name: string;
  books: UnifiedBook[];
  bookCount: number;
}

/**
 * Generation result
 */
export interface GenerationResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

/**
 * Unified Note Generator
 */
export class UnifiedNoteGenerator {
  private engine: LiquidEngine;
  private app: App;
  private templates: TemplateSettings;

  constructor(app: App, templates: TemplateSettings) {
    this.app = app;
    this.templates = templates;
    this.engine = new LiquidEngine();
  }

  /**
   * Update template settings
   */
  setTemplates(templates: TemplateSettings): void {
    this.templates = templates;
  }

  // ==========================================================================
  // Book Notes
  // ==========================================================================

  /**
   * Generate a book note
   */
  async generateBookNote(
    book: UnifiedBook,
    highlights: HighlightData[] = []
  ): Promise<GenerationResult> {
    const config = this.templates.bookNote;
    if (!config.enabled) {
      return { success: false, error: 'Book note template is disabled' };
    }

    try {
      const context = this.buildBookContext(book, highlights);
      const content = await this.engine.render(config.template, context);

      const fileName = this.sanitizeFileName(book.title);
      const filePath = normalizePath(`${config.folder}/${fileName}.md`);

      await this.ensureFolder(config.folder);
      await this.writeFile(filePath, content);

      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: `Failed to generate book note: ${error}` };
    }
  }

  /**
   * Build context for book templates
   */
  private buildBookContext(book: UnifiedBook, highlights: HighlightData[] = []) {
    const primaryAuthor = book.authors[0];

    return {
      book: {
        id: book.id,
        title: book.title,
        titleSort: book.titleSort || book.title,
        author: primaryAuthor?.name || 'Unknown',
        authorSort: primaryAuthor?.sortName || primaryAuthor?.name || 'Unknown',
        authorLink: primaryAuthor?.link || `[[Autores/${primaryAuthor?.name || 'Unknown'}]]`,
        authors: book.authors,
        series: book.series?.name,
        seriesIndex: book.series?.index,
        seriesLink: book.series?.link || (book.series ? `[[Series/${book.series.name}]]` : ''),
        description: book.description,
        publisher: book.publisher,
        publishedDate: book.publishedDate?.toISOString().split('T')[0],
        language: book.language,
        isbn: book.isbn,
        tags: book.tags,
        rating: book.rating,
        status: book.status,
        progress: book.progress,
        currentCfi: book.currentCfi,
        currentChapter: book.currentChapter,
        lastReadAt: book.lastReadAt?.toISOString(),
        coverPath: book.coverPath,
        coverUrl: book.coverUrl,
        notePath: book.notePath,
        florilegioPath: book.florilegioPath,
        calibreId: book.sources.find(s => s.type === 'calibre-local')?.calibreId,
        calibreUuid: book.calibreUuid,
        epubPath: book.sources.find(s => s.type === 'calibre-local')?.epubPath
          || book.sources.find(s => s.type === 'vault-copy')?.vaultPath,
        calibrePath: book.sources.find(s => s.type === 'calibre-local')?.libraryPath,
        sources: book.sources,
      },
      highlights,
      date: {
        now: new Date().toISOString(),
        today: new Date().toISOString().split('T')[0],
      },
    };
  }

  // ==========================================================================
  // Hub Highlights
  // ==========================================================================

  /**
   * Generate hub highlights note
   */
  async generateHubHighlights(
    book: UnifiedBook,
    highlights: HighlightData[]
  ): Promise<GenerationResult> {
    const config = this.templates.hubHighlights;
    if (!config.enabled) {
      return { success: false, error: 'Hub highlights template is disabled' };
    }

    try {
      const context = {
        book: {
          id: book.id,
          title: book.title,
          author: book.authors[0]?.name || 'Unknown',
          notePath: book.notePath || `Biblioteca/Libros/${book.title}`,
        },
        highlights: highlights.map(h => ({
          ...h,
          createdAt: h.createdAt.toISOString(),
        })),
        date: {
          now: new Date().toISOString(),
          today: new Date().toISOString().split('T')[0],
        },
      };

      const content = await this.engine.render(config.template, context);
      const fileName = this.sanitizeFileName(`${book.title} - Highlights`);
      const filePath = normalizePath(`${config.folder}/${book.title}/${fileName}.md`);

      await this.ensureFolder(`${config.folder}/${book.title}`);
      await this.writeFile(filePath, content);

      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: `Failed to generate hub highlights: ${error}` };
    }
  }

  // ==========================================================================
  // Hub Notes
  // ==========================================================================

  /**
   * Generate hub notes
   */
  async generateHubNotes(
    book: UnifiedBook,
    notes: NoteData[]
  ): Promise<GenerationResult> {
    const config = this.templates.hubNotes;
    if (!config.enabled) {
      return { success: false, error: 'Hub notes template is disabled' };
    }

    try {
      const context = {
        book: {
          id: book.id,
          title: book.title,
          author: book.authors[0]?.name || 'Unknown',
          notePath: book.notePath || `Biblioteca/Libros/${book.title}`,
        },
        notes: notes.map(n => ({
          ...n,
          createdAt: n.createdAt.toISOString(),
        })),
        date: {
          now: new Date().toISOString(),
          today: new Date().toISOString().split('T')[0],
        },
      };

      const content = await this.engine.render(config.template, context);
      const fileName = this.sanitizeFileName(`${book.title} - Notes`);
      const filePath = normalizePath(`${config.folder}/${book.title}/${fileName}.md`);

      await this.ensureFolder(`${config.folder}/${book.title}`);
      await this.writeFile(filePath, content);

      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: `Failed to generate hub notes: ${error}` };
    }
  }

  // ==========================================================================
  // Atomic Highlights
  // ==========================================================================

  /**
   * Generate atomic highlight note
   */
  async generateAtomicHighlight(
    book: UnifiedBook,
    highlight: HighlightData
  ): Promise<GenerationResult> {
    const config = this.templates.atomicHighlight;
    if (!config.enabled) {
      return { success: false, error: 'Atomic highlight template is disabled' };
    }

    try {
      const context = {
        book: {
          id: book.id,
          title: book.title,
          author: book.authors[0]?.name || 'Unknown',
          notePath: book.notePath || `Biblioteca/Libros/${book.title}`,
        },
        highlight: {
          ...highlight,
          createdAt: highlight.createdAt.toISOString(),
        },
        date: {
          now: new Date().toISOString(),
          today: new Date().toISOString().split('T')[0],
        },
      };

      const content = await this.engine.render(config.template, context);
      const shortText = highlight.text.slice(0, 30).replace(/[^\w\s]/g, '').trim();
      const fileName = this.sanitizeFileName(`${shortText} - ${highlight.id.slice(0, 8)}`);
      const filePath = normalizePath(`${config.folder}/${book.title}/atomic/${fileName}.md`);

      await this.ensureFolder(`${config.folder}/${book.title}/atomic`);
      await this.writeFile(filePath, content);

      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: `Failed to generate atomic highlight: ${error}` };
    }
  }

  // ==========================================================================
  // Atomic Notes
  // ==========================================================================

  /**
   * Generate atomic note
   */
  async generateAtomicNote(
    book: UnifiedBook,
    note: NoteData
  ): Promise<GenerationResult> {
    const config = this.templates.atomicNote;
    if (!config.enabled) {
      return { success: false, error: 'Atomic note template is disabled' };
    }

    try {
      const context = {
        book: {
          id: book.id,
          title: book.title,
          author: book.authors[0]?.name || 'Unknown',
          notePath: book.notePath || `Biblioteca/Libros/${book.title}`,
        },
        note: {
          ...note,
          createdAt: note.createdAt.toISOString(),
        },
        date: {
          now: new Date().toISOString(),
          today: new Date().toISOString().split('T')[0],
        },
      };

      const content = await this.engine.render(config.template, context);
      const shortContent = note.content.slice(0, 30).replace(/[^\w\s]/g, '').trim();
      const fileName = this.sanitizeFileName(`${shortContent} - ${note.id.slice(0, 8)}`);
      const filePath = normalizePath(`${config.folder}/${book.title}/atomic/${fileName}.md`);

      await this.ensureFolder(`${config.folder}/${book.title}/atomic`);
      await this.writeFile(filePath, content);

      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: `Failed to generate atomic note: ${error}` };
    }
  }

  // ==========================================================================
  // Author Index
  // ==========================================================================

  /**
   * Generate author index note
   */
  async generateAuthorIndex(author: AuthorWithBooks): Promise<GenerationResult> {
    const config = this.templates.authorIndex;
    if (!config.enabled) {
      return { success: false, error: 'Author index template is disabled' };
    }

    try {
      const context = {
        author: {
          name: author.name,
          sortName: author.sortName || author.name,
          books: author.books.map(b => ({
            title: b.title,
            notePath: b.notePath || `Biblioteca/Libros/${b.title}`,
            status: b.status,
            progress: b.progress,
          })),
          bookCount: author.bookCount,
        },
        date: {
          now: new Date().toISOString(),
          today: new Date().toISOString().split('T')[0],
        },
      };

      const content = await this.engine.render(config.template, context);
      const fileName = this.sanitizeFileName(author.name);
      const filePath = normalizePath(`${config.folder}/${fileName}.md`);

      await this.ensureFolder(config.folder);
      await this.writeFile(filePath, content);

      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: `Failed to generate author index: ${error}` };
    }
  }

  // ==========================================================================
  // Series Index
  // ==========================================================================

  /**
   * Generate series index note
   */
  async generateSeriesIndex(series: SeriesWithBooks): Promise<GenerationResult> {
    const config = this.templates.seriesIndex;
    if (!config.enabled) {
      return { success: false, error: 'Series index template is disabled' };
    }

    try {
      const context = {
        series: {
          name: series.name,
          books: series.books
            .sort((a, b) => (a.series?.index || 0) - (b.series?.index || 0))
            .map(b => ({
              title: b.title,
              seriesIndex: b.series?.index,
              notePath: b.notePath || `Biblioteca/Libros/${b.title}`,
              status: b.status,
              progress: b.progress,
            })),
          bookCount: series.bookCount,
        },
        date: {
          now: new Date().toISOString(),
          today: new Date().toISOString().split('T')[0],
        },
      };

      const content = await this.engine.render(config.template, context);
      const fileName = this.sanitizeFileName(series.name);
      const filePath = normalizePath(`${config.folder}/${fileName}.md`);

      await this.ensureFolder(config.folder);
      await this.writeFile(filePath, content);

      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: `Failed to generate series index: ${error}` };
    }
  }

  // ==========================================================================
  // Shelf Index
  // ==========================================================================

  /**
   * Generate shelf/tag index note
   */
  async generateShelfIndex(shelf: ShelfWithBooks): Promise<GenerationResult> {
    const config = this.templates.shelfIndex;
    if (!config.enabled) {
      return { success: false, error: 'Shelf index template is disabled' };
    }

    try {
      const context = {
        shelf: {
          name: shelf.name,
          books: shelf.books.map(b => ({
            title: b.title,
            author: b.authors[0]?.name || 'Unknown',
            notePath: b.notePath || `Biblioteca/Libros/${b.title}`,
            status: b.status,
            progress: b.progress,
          })),
          bookCount: shelf.bookCount,
        },
        date: {
          now: new Date().toISOString(),
          today: new Date().toISOString().split('T')[0],
        },
      };

      const content = await this.engine.render(config.template, context);
      const fileName = this.sanitizeFileName(shelf.name);
      const filePath = normalizePath(`${config.folder}/${fileName}.md`);

      await this.ensureFolder(config.folder);
      await this.writeFile(filePath, content);

      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: `Failed to generate shelf index: ${error}` };
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Ensure a folder exists
   */
  private async ensureFolder(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    const folder = this.app.vault.getAbstractFileByPath(normalized);
    if (!folder) {
      await this.app.vault.createFolder(normalized);
    }
  }

  /**
   * Write or update a file
   */
  private async writeFile(filePath: string, content: string): Promise<void> {
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
    if (existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, content);
    } else {
      await this.app.vault.create(filePath, content);
    }
  }

  /**
   * Sanitize a filename
   */
  private sanitizeFileName(name: string): string {
    return name
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  /**
   * Load template from vault file if it exists (override)
   */
  async loadVaultTemplate(
    templateKey: keyof TemplateSettings,
    templatesFolder: string
  ): Promise<string | null> {
    const filename = `${templateKey}.liquid`;
    const filePath = normalizePath(`${templatesFolder}/${filename}`);

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      return await this.app.vault.read(file);
    }

    return null;
  }

  /**
   * Check if a vault template override exists
   */
  hasVaultTemplate(templateKey: keyof TemplateSettings, templatesFolder: string): boolean {
    const filename = `${templateKey}.liquid`;
    const filePath = normalizePath(`${templatesFolder}/${filename}`);
    return this.app.vault.getAbstractFileByPath(filePath) instanceof TFile;
  }
}
