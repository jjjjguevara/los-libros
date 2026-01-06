/**
 * Unified Note Generator
 *
 * Generates all types of notes using the Nunjucks template engine.
 * Supports:
 * - Book notes
 * - Hub highlights (aggregated)
 * - Hub notes (aggregated)
 * - Atomic highlights (individual)
 * - Atomic notes (individual)
 * - Author indexes
 * - Series indexes
 * - Shelf indexes
 *
 * Features:
 * - {% persist %} blocks for user content preservation
 * - Smart Skip with sync hash (only updates when content changed)
 * - ID-based deduplication for highlights/notes
 *
 * @see docs/plans/unified-sync-architecture-prd.md
 * @see docs/research/Obsidian Sync Architecture Research.md
 */

import { App, TFile, normalizePath } from 'obsidian';
import { NunjucksTemplateService } from './nunjucks-engine';
import type { TemplateSettings, TemplateConfig } from './template-types';
import type { UnifiedBook, Author, Series } from '../types/unified-book';
import type { LibrosSettings, InlineModeSettings } from '../settings/settings';
import {
  updateSection,
  appendToSection,
  getTrackedIds,
  syncItemsToSection,
} from '../sync/metadata/section-manager';

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
  /** Path to atomic note (for link-only mode) */
  notePath?: string;
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
  /** Path to atomic note (for link-only mode) */
  notePath?: string;
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
  /** Whether the file was skipped (no changes detected) */
  skipped?: boolean;
}

/**
 * Folder settings extracted from LibrosSettings for template context
 */
export interface FolderSettings {
  booksFolder: string;
  authorsFolder: string;
  seriesFolder: string;
  shelvesFolder: string;
  highlightsFolder: string;
  highlightHubsFolder: string;
  noteHubsFolder: string;
  notesFolder: string;
}

/**
 * Unified Note Generator
 */
export class UnifiedNoteGenerator {
  private engine: NunjucksTemplateService;
  private app: App;
  private templates: TemplateSettings;
  private folders: FolderSettings;
  private inlineMode: InlineModeSettings;

  constructor(app: App, templates: TemplateSettings, settings?: LibrosSettings) {
    this.app = app;
    this.templates = templates;
    this.engine = new NunjucksTemplateService();

    // Extract inline mode settings
    this.inlineMode = settings?.inlineMode ?? {
      inlineHighlights: false,
      inlineNotes: false,
      highlightsSectionId: 'HIGHLIGHTS',
      notesSectionId: 'NOTES',
    };

    // Extract folder settings from LibrosSettings or use template defaults
    this.folders = {
      booksFolder: settings?.calibreBookNotesFolder || templates.bookNote.folder,
      authorsFolder: settings?.calibreAuthorIndexFolder || templates.authorIndex.folder,
      seriesFolder: settings?.calibreSeriesIndexFolder || templates.seriesIndex.folder,
      shelvesFolder: settings?.calibreShelfIndexFolder || templates.shelfIndex.folder,
      highlightsFolder: settings?.calibreHighlightsFolder || templates.atomicHighlight.folder,
      highlightHubsFolder: templates.hubHighlights.folder,
      noteHubsFolder: templates.hubNotes.folder,
      notesFolder: templates.atomicNote.folder,
    };
  }

  /**
   * Update template settings
   */
  setTemplates(templates: TemplateSettings): void {
    this.templates = templates;
  }

  /**
   * Update folder settings
   */
  setFolderSettings(settings: LibrosSettings): void {
    this.folders = {
      booksFolder: settings.calibreBookNotesFolder,
      authorsFolder: settings.calibreAuthorIndexFolder,
      seriesFolder: settings.calibreSeriesIndexFolder,
      shelvesFolder: settings.calibreShelfIndexFolder,
      highlightsFolder: settings.calibreHighlightsFolder,
      highlightHubsFolder: this.templates.hubHighlights.folder,
      noteHubsFolder: this.templates.hubNotes.folder,
      notesFolder: this.templates.atomicNote.folder,
    };
  }

  /**
   * Update inline mode settings
   */
  setInlineMode(settings: InlineModeSettings): void {
    this.inlineMode = settings;
  }

  /**
   * Check if inline mode is enabled for highlights
   */
  isInlineHighlightsEnabled(): boolean {
    return this.inlineMode.inlineHighlights;
  }

  /**
   * Check if inline mode is enabled for notes
   */
  isInlineNotesEnabled(): boolean {
    return this.inlineMode.inlineNotes;
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
      const fileName = this.sanitizeFileName(book.title);
      const filePath = normalizePath(`${config.folder}/${fileName}.md`);

      // Get existing content for persist block preservation
      const existingContent = await this.readExistingFile(filePath);

      // Calculate sync hash for Smart Skip
      const syncHash = this.calculateSyncHash(book, highlights);

      // Check if we can skip (existing file with same hash)
      if (existingContent) {
        const existingHash = this.extractSyncHash(existingContent);
        if (existingHash === syncHash) {
          return { success: true, filePath, skipped: true };
        }
      }

      const context = this.buildBookContext(book, highlights, syncHash);
      const content = this.engine.renderWithPersist(
        config.template,
        context,
        existingContent || undefined
      );

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
  private buildBookContext(
    book: UnifiedBook,
    highlights: HighlightData[] = [],
    syncHash?: string
  ) {
    const primaryAuthor = book.authors[0];
    const now = new Date();

    // Build author link using configurable folder
    const authorName = primaryAuthor?.name || 'Unknown';
    const authorLink = primaryAuthor?.link || `[[${this.folders.authorsFolder}/${authorName}|${authorName}]]`;

    // Build series link using configurable folder
    const seriesLink = book.series?.link ||
      (book.series ? `[[${this.folders.seriesFolder}/${book.series.name}|${book.series.name}]]` : '');

    return {
      book: {
        id: book.id,
        title: book.title,
        titleSort: book.titleSort || book.title,
        author: authorName,
        authorSort: primaryAuthor?.sortName || authorName,
        authorLink,
        authors: book.authors,
        series: book.series?.name,
        seriesIndex: book.series?.index,
        seriesLink,
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
        notePath: book.notePath || `${this.folders.booksFolder}/${book.title}`,
        florilegioPath: book.florilegioPath,
        calibreId: book.sources.find(s => s.type === 'calibre-local')?.calibreId,
        calibreUuid: book.calibreUuid,
        epubPath: book.sources.find(s => s.type === 'calibre-local')?.epubPath
          || book.sources.find(s => s.type === 'vault-copy')?.vaultPath,
        calibrePath: book.sources.find(s => s.type === 'calibre-local')?.libraryPath,
        sources: book.sources,
      },
      highlights: highlights.map(h => ({
        ...h,
        createdAt: h.createdAt,
      })),
      // Folder settings for template use
      settings: {
        authorsFolder: this.folders.authorsFolder,
        seriesFolder: this.folders.seriesFolder,
        bookshelvesFolder: this.folders.shelvesFolder,
        booksFolder: this.folders.booksFolder,
        highlightsFolder: this.folders.highlightsFolder,
        notesFolder: this.folders.notesFolder,
      },
      syncDate: now.toISOString(),
      syncHash: syncHash || this.calculateSyncHash(book, highlights),
      date: {
        now: now.toISOString(),
        today: now.toISOString().split('T')[0],
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
      const fileName = this.sanitizeFileName(`${book.title} - Highlights`);
      const filePath = normalizePath(`${config.folder}/${book.title}/${fileName}.md`);

      // Get existing content for persist block preservation
      const existingContent = await this.readExistingFile(filePath);

      // Add notePath for each highlight (for link-only mode)
      const highlightsWithPaths = highlights.map(h => ({
        ...h,
        createdAt: h.createdAt,
        notePath: h.notePath || this.getAtomicHighlightPath(book, h),
      }));

      const context = {
        book: {
          id: book.id,
          title: book.title,
          author: book.authors[0]?.name || 'Unknown',
          notePath: book.notePath || `${this.folders.booksFolder}/${book.title}`,
        },
        highlights: highlightsWithPaths,
        settings: {
          authorsFolder: this.folders.authorsFolder,
          seriesFolder: this.folders.seriesFolder,
          bookshelvesFolder: this.folders.shelvesFolder,
          booksFolder: this.folders.booksFolder,
          highlightsFolder: this.folders.highlightsFolder,
          notesFolder: this.folders.notesFolder,
        },
        syncDate: new Date().toISOString(),
        date: {
          now: new Date().toISOString(),
          today: new Date().toISOString().split('T')[0],
        },
      };

      const content = this.engine.renderWithPersist(
        config.template,
        context,
        existingContent || undefined
      );

      await this.ensureFolder(`${config.folder}/${book.title}`);
      await this.writeFile(filePath, content);

      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: `Failed to generate hub highlights: ${error}` };
    }
  }

  /**
   * Get the path where an atomic highlight would be stored
   */
  private getAtomicHighlightPath(book: UnifiedBook, highlight: HighlightData): string {
    const config = this.templates.atomicHighlight;
    const shortText = highlight.text.slice(0, 30).replace(/[^\w\s]/g, '').trim();
    const fileName = this.sanitizeFileName(`${shortText} - ${highlight.id.slice(0, 8)}`);
    return `${config.folder}/${book.title}/atomic/${fileName}`;
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
      const fileName = this.sanitizeFileName(`${book.title} - Notes`);
      const filePath = normalizePath(`${config.folder}/${book.title}/${fileName}.md`);

      // Get existing content for persist block preservation
      const existingContent = await this.readExistingFile(filePath);

      // Add notePath for each note (for link-only mode)
      const notesWithPaths = notes.map(n => ({
        ...n,
        createdAt: n.createdAt,
        notePath: n.notePath || this.getAtomicNotePath(book, n),
      }));

      const context = {
        book: {
          id: book.id,
          title: book.title,
          author: book.authors[0]?.name || 'Unknown',
          notePath: book.notePath || `${this.folders.booksFolder}/${book.title}`,
        },
        notes: notesWithPaths,
        settings: {
          authorsFolder: this.folders.authorsFolder,
          seriesFolder: this.folders.seriesFolder,
          bookshelvesFolder: this.folders.shelvesFolder,
          booksFolder: this.folders.booksFolder,
          highlightsFolder: this.folders.highlightsFolder,
          notesFolder: this.folders.notesFolder,
        },
        syncDate: new Date().toISOString(),
        date: {
          now: new Date().toISOString(),
          today: new Date().toISOString().split('T')[0],
        },
      };

      const content = this.engine.renderWithPersist(
        config.template,
        context,
        existingContent || undefined
      );

      await this.ensureFolder(`${config.folder}/${book.title}`);
      await this.writeFile(filePath, content);

      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: `Failed to generate hub notes: ${error}` };
    }
  }

  /**
   * Get the path where an atomic note would be stored
   */
  private getAtomicNotePath(book: UnifiedBook, note: NoteData): string {
    const config = this.templates.atomicNote;
    const shortContent = note.content.slice(0, 30).replace(/[^\w\s]/g, '').trim();
    const fileName = this.sanitizeFileName(`${shortContent} - ${note.id.slice(0, 8)}`);
    return `${config.folder}/${book.title}/atomic/${fileName}`;
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
      const shortText = highlight.text.slice(0, 30).replace(/[^\w\s]/g, '').trim();
      const fileName = this.sanitizeFileName(`${shortText} - ${highlight.id.slice(0, 8)}`);
      const filePath = normalizePath(`${config.folder}/${book.title}/atomic/${fileName}.md`);

      // Get existing content for persist block preservation
      const existingContent = await this.readExistingFile(filePath);

      const context = {
        book: {
          id: book.id,
          title: book.title,
          author: book.authors[0]?.name || 'Unknown',
          notePath: book.notePath || `${this.folders.booksFolder}/${book.title}`,
        },
        highlight: {
          ...highlight,
          createdAt: highlight.createdAt,
        },
        settings: {
          authorsFolder: this.folders.authorsFolder,
          seriesFolder: this.folders.seriesFolder,
          bookshelvesFolder: this.folders.shelvesFolder,
          booksFolder: this.folders.booksFolder,
          highlightsFolder: this.folders.highlightsFolder,
          notesFolder: this.folders.notesFolder,
        },
        date: {
          now: new Date().toISOString(),
          today: new Date().toISOString().split('T')[0],
        },
      };

      const content = this.engine.renderWithPersist(
        config.template,
        context,
        existingContent || undefined
      );

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
      const shortContent = note.content.slice(0, 30).replace(/[^\w\s]/g, '').trim();
      const fileName = this.sanitizeFileName(`${shortContent} - ${note.id.slice(0, 8)}`);
      const filePath = normalizePath(`${config.folder}/${book.title}/atomic/${fileName}.md`);

      // Get existing content for persist block preservation
      const existingContent = await this.readExistingFile(filePath);

      const context = {
        book: {
          id: book.id,
          title: book.title,
          author: book.authors[0]?.name || 'Unknown',
          notePath: book.notePath || `${this.folders.booksFolder}/${book.title}`,
        },
        note: {
          ...note,
          createdAt: note.createdAt,
        },
        settings: {
          authorsFolder: this.folders.authorsFolder,
          seriesFolder: this.folders.seriesFolder,
          bookshelvesFolder: this.folders.shelvesFolder,
          booksFolder: this.folders.booksFolder,
          highlightsFolder: this.folders.highlightsFolder,
          notesFolder: this.folders.notesFolder,
        },
        date: {
          now: new Date().toISOString(),
          today: new Date().toISOString().split('T')[0],
        },
      };

      const content = this.engine.renderWithPersist(
        config.template,
        context,
        existingContent || undefined
      );

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
      const fileName = this.sanitizeFileName(author.name);
      const filePath = normalizePath(`${config.folder}/${fileName}.md`);

      // Get existing content for persist block preservation
      const existingContent = await this.readExistingFile(filePath);

      const context = {
        author: {
          name: author.name,
          sortName: author.sortName || author.name,
          books: author.books.map(b => ({
            title: b.title,
            notePath: b.notePath || `${this.folders.booksFolder}/${b.title}`,
            status: b.status,
            progress: b.progress,
          })),
          bookCount: author.bookCount,
        },
        settings: {
          authorsFolder: this.folders.authorsFolder,
          seriesFolder: this.folders.seriesFolder,
          bookshelvesFolder: this.folders.shelvesFolder,
          booksFolder: this.folders.booksFolder,
          highlightsFolder: this.folders.highlightsFolder,
          notesFolder: this.folders.notesFolder,
        },
        date: {
          now: new Date().toISOString(),
          today: new Date().toISOString().split('T')[0],
        },
      };

      const content = this.engine.renderWithPersist(
        config.template,
        context,
        existingContent || undefined
      );

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
      const fileName = this.sanitizeFileName(series.name);
      const filePath = normalizePath(`${config.folder}/${fileName}.md`);

      // Get existing content for persist block preservation
      const existingContent = await this.readExistingFile(filePath);

      const context = {
        series: {
          name: series.name,
          books: series.books
            .sort((a, b) => (a.series?.index || 0) - (b.series?.index || 0))
            .map(b => ({
              title: b.title,
              seriesIndex: b.series?.index,
              notePath: b.notePath || `${this.folders.booksFolder}/${b.title}`,
              status: b.status,
              progress: b.progress,
            })),
          bookCount: series.bookCount,
        },
        settings: {
          authorsFolder: this.folders.authorsFolder,
          seriesFolder: this.folders.seriesFolder,
          bookshelvesFolder: this.folders.shelvesFolder,
          booksFolder: this.folders.booksFolder,
          highlightsFolder: this.folders.highlightsFolder,
          notesFolder: this.folders.notesFolder,
        },
        date: {
          now: new Date().toISOString(),
          today: new Date().toISOString().split('T')[0],
        },
      };

      const content = this.engine.renderWithPersist(
        config.template,
        context,
        existingContent || undefined
      );

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
      const fileName = this.sanitizeFileName(shelf.name);
      const filePath = normalizePath(`${config.folder}/${fileName}.md`);

      // Get existing content for persist block preservation
      const existingContent = await this.readExistingFile(filePath);

      const context = {
        shelf: {
          name: shelf.name,
          books: shelf.books.map(b => ({
            title: b.title,
            author: b.authors[0]?.name || 'Unknown',
            notePath: b.notePath || `${this.folders.booksFolder}/${b.title}`,
            status: b.status,
            progress: b.progress,
          })),
          bookCount: shelf.bookCount,
        },
        settings: {
          authorsFolder: this.folders.authorsFolder,
          seriesFolder: this.folders.seriesFolder,
          bookshelvesFolder: this.folders.shelvesFolder,
          booksFolder: this.folders.booksFolder,
          highlightsFolder: this.folders.highlightsFolder,
          notesFolder: this.folders.notesFolder,
        },
        date: {
          now: new Date().toISOString(),
          today: new Date().toISOString().split('T')[0],
        },
      };

      const content = this.engine.renderWithPersist(
        config.template,
        context,
        existingContent || undefined
      );

      await this.ensureFolder(config.folder);
      await this.writeFile(filePath, content);

      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: `Failed to generate shelf index: ${error}` };
    }
  }

  // ==========================================================================
  // Smart Skip (Hash Optimization)
  // ==========================================================================

  /**
   * Calculate a sync hash for Smart Skip optimization
   */
  private calculateSyncHash(book: UnifiedBook, highlights: HighlightData[] = []): string {
    const data = {
      id: book.id,
      title: book.title,
      rating: book.rating,
      tags: book.tags,
      progress: book.progress,
      status: book.status,
      highlightCount: highlights.length,
      highlightIds: highlights.map(h => h.id).sort(),
    };

    // Simple hash using JSON string
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Extract sync hash from existing file content
   */
  private extractSyncHash(content: string): string | null {
    const match = content.match(/amnesia_sync_hash:\s*["']?([a-z0-9]+)["']?/);
    return match ? match[1] : null;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Read existing file content (returns null if doesn't exist)
   */
  private async readExistingFile(filePath: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      return await this.app.vault.read(file);
    }
    return null;
  }

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
    const filename = `${templateKey}.njk`; // Changed from .liquid to .njk
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
    const filename = `${templateKey}.njk`; // Changed from .liquid to .njk
    const filePath = normalizePath(`${templatesFolder}/${filename}`);
    return this.app.vault.getAbstractFileByPath(filePath) instanceof TFile;
  }

  /**
   * Validate a template for syntax errors
   */
  validateTemplate(template: string): { valid: boolean; errors: string[] } {
    return this.engine.validateTemplate(template);
  }

  /**
   * Get available template fields for documentation
   */
  getAvailableFields() {
    return this.engine.getAvailableFields();
  }

  /**
   * Get available filters for documentation
   */
  getAvailableFilters() {
    return this.engine.getAvailableFilters();
  }

  // ==========================================================================
  // Inline Mode Methods (Append to Book Note)
  // ==========================================================================

  /**
   * Append a highlight to the book note's managed section (inline mode)
   *
   * Uses ID-based deduplication to prevent duplicates.
   */
  async appendHighlightInline(
    book: UnifiedBook,
    highlight: HighlightData
  ): Promise<GenerationResult> {
    if (!this.inlineMode.inlineHighlights) {
      return { success: false, error: 'Inline highlights mode is disabled' };
    }

    try {
      const filePath = this.getBookNotePath(book);
      const existingContent = await this.readExistingFile(filePath);

      if (!existingContent) {
        return { success: false, error: 'Book note does not exist. Create book note first.' };
      }

      // Check if already exists
      const existingIds = getTrackedIds(existingContent);
      if (existingIds.has(highlight.id)) {
        return { success: true, filePath, skipped: true };
      }

      // Render highlight content
      const highlightMarkdown = this.renderHighlightMarkdown(highlight);

      // Append to managed section
      const updatedContent = appendToSection(
        existingContent,
        this.inlineMode.highlightsSectionId,
        highlightMarkdown
      );

      await this.writeFile(filePath, updatedContent);
      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: `Failed to append inline highlight: ${error}` };
    }
  }

  /**
   * Append a note to the book note's managed section (inline mode)
   *
   * Uses ID-based deduplication to prevent duplicates.
   */
  async appendNoteInline(
    book: UnifiedBook,
    note: NoteData
  ): Promise<GenerationResult> {
    if (!this.inlineMode.inlineNotes) {
      return { success: false, error: 'Inline notes mode is disabled' };
    }

    try {
      const filePath = this.getBookNotePath(book);
      const existingContent = await this.readExistingFile(filePath);

      if (!existingContent) {
        return { success: false, error: 'Book note does not exist. Create book note first.' };
      }

      // Check if already exists
      const existingIds = getTrackedIds(existingContent);
      if (existingIds.has(note.id)) {
        return { success: true, filePath, skipped: true };
      }

      // Render note content
      const noteMarkdown = this.renderNoteMarkdown(note);

      // Append to managed section
      const updatedContent = appendToSection(
        existingContent,
        this.inlineMode.notesSectionId,
        noteMarkdown
      );

      await this.writeFile(filePath, updatedContent);
      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: `Failed to append inline note: ${error}` };
    }
  }

  /**
   * Sync all highlights to the book note's managed section (inline mode)
   *
   * Uses ID-based deduplication:
   * - Adds new highlights
   * - Marks deleted highlights as tombstones
   * - Never overwrites user content outside managed section
   */
  async syncHighlightsInline(
    book: UnifiedBook,
    highlights: HighlightData[]
  ): Promise<GenerationResult> {
    if (!this.inlineMode.inlineHighlights) {
      return { success: false, error: 'Inline highlights mode is disabled' };
    }

    try {
      const filePath = this.getBookNotePath(book);
      const existingContent = await this.readExistingFile(filePath);

      if (!existingContent) {
        return { success: false, error: 'Book note does not exist. Create book note first.' };
      }

      // Convert highlights to Map<id, content>
      const items = new Map<string, string>();
      for (const h of highlights) {
        items.set(h.id, this.renderHighlightMarkdown(h));
      }

      // Sync items to section
      const { content: updatedContent, added, tombstoned } = syncItemsToSection(
        existingContent,
        this.inlineMode.highlightsSectionId,
        items
      );

      if (added.length > 0 || tombstoned.length > 0) {
        await this.writeFile(filePath, updatedContent);
        return { success: true, filePath };
      }

      return { success: true, filePath, skipped: true };
    } catch (error) {
      return { success: false, error: `Failed to sync inline highlights: ${error}` };
    }
  }

  /**
   * Sync all notes to the book note's managed section (inline mode)
   *
   * Uses ID-based deduplication:
   * - Adds new notes
   * - Marks deleted notes as tombstones
   * - Never overwrites user content outside managed section
   */
  async syncNotesInline(
    book: UnifiedBook,
    notes: NoteData[]
  ): Promise<GenerationResult> {
    if (!this.inlineMode.inlineNotes) {
      return { success: false, error: 'Inline notes mode is disabled' };
    }

    try {
      const filePath = this.getBookNotePath(book);
      const existingContent = await this.readExistingFile(filePath);

      if (!existingContent) {
        return { success: false, error: 'Book note does not exist. Create book note first.' };
      }

      // Convert notes to Map<id, content>
      const items = new Map<string, string>();
      for (const n of notes) {
        items.set(n.id, this.renderNoteMarkdown(n));
      }

      // Sync items to section
      const { content: updatedContent, added, tombstoned } = syncItemsToSection(
        existingContent,
        this.inlineMode.notesSectionId,
        items
      );

      if (added.length > 0 || tombstoned.length > 0) {
        await this.writeFile(filePath, updatedContent);
        return { success: true, filePath };
      }

      return { success: true, filePath, skipped: true };
    } catch (error) {
      return { success: false, error: `Failed to sync inline notes: ${error}` };
    }
  }

  /**
   * Get the book note path
   */
  private getBookNotePath(book: UnifiedBook): string {
    const config = this.templates.bookNote;
    const fileName = this.sanitizeFileName(book.title);
    return normalizePath(`${config.folder}/${fileName}.md`);
  }

  /**
   * Render a highlight to markdown with ID marker
   */
  private renderHighlightMarkdown(highlight: HighlightData): string {
    const idMarker = `%% amnesia:${highlight.id} %%`;
    const annotation = highlight.annotation ? `\n\n*${highlight.annotation}*` : '';
    const chapter = highlight.chapter ? ` (${highlight.chapter})` : '';

    return `> ${highlight.text}${chapter}${annotation} ${idMarker}`;
  }

  /**
   * Render a note to markdown with ID marker
   */
  private renderNoteMarkdown(note: NoteData): string {
    const idMarker = `%% amnesia:${note.id} %%`;
    const chapter = note.chapter ? `**${note.chapter}**\n\n` : '';

    return `${chapter}${note.content} ${idMarker}`;
  }
}
