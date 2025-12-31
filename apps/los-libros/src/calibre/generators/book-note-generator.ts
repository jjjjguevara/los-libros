/**
 * BookNoteGenerator
 *
 * Generates Obsidian book notes from Calibre metadata using Liquid templates.
 * Follows the BookFusion pattern for consistent library management.
 */

import { App, TFile, normalizePath } from 'obsidian';
import { Liquid } from 'liquidjs';
import type { CalibreBookFull, BookNoteFrontmatter, BookReadingStatus } from '../calibre-types';
import type { LibrosSettings } from '../../settings/settings';
import { calibreBookToUnified } from '../calibre-converter';
import { UnifiedNoteGenerator } from '../../templates/unified-note-generator';

/**
 * Default template for book notes
 */
export const DEFAULT_CALIBRE_BOOK_TEMPLATE = `---
type: book
bookId: "{{ book.uuid }}"
calibreId: {{ book.calibreId }}
title: "{{ book.title | escape }}"
author: "{{ book.authorLink }}"
{% if book.seriesLink %}series: "{{ book.seriesLink }}"
seriesIndex: {{ book.seriesIndex }}{% endif %}
{% if book.bookshelves.size > 0 %}bookshelves:
{% for shelf in book.bookshelves %}  - "{{ shelf }}"
{% endfor %}{% endif %}
{% if book.tags.size > 0 %}tags: [{{ book.tags | join: ", " }}]{% endif %}
{% if book.rating %}rating: {{ book.rating }}{% endif %}
{% if book.coverUrl %}coverUrl: "{{ book.coverUrl }}"{% endif %}
progress: {{ book.progress | default: 0 }}
status: {{ book.status | default: "to-read" }}
{% if book.language %}language: {{ book.language }}{% endif %}
{% if book.publisher %}publisher: "{{ book.publisher | escape }}"{% endif %}
{% if book.publishedDate %}publishedDate: {{ book.publishedDate }}{% endif %}
{% if book.isbn %}isbn: "{{ book.isbn }}"{% endif %}
epubPath: "{{ book.epubPath }}"
calibrePath: "{{ book.calibrePath }}"
lastSync: {{ book.lastSync }}
---

# {{ book.title }}

{% if book.coverUrl %}![[{{ book.coverUrl }}|200]]{% endif %}

**Author:** {{ book.authorLink }}
{% if book.seriesLink %}**Series:** {{ book.seriesLink }} #{{ book.seriesIndex }}{% endif %}
{% if book.rating %}**Rating:** {{ book.stars }}{% endif %}
{% if book.publisher %}**Publisher:** {{ book.publisher }}{% endif %}
{% if book.publishedDate %}**Published:** {{ book.publishedDate }}{% endif %}

{% if book.description %}
## Description

{{ book.description }}
{% endif %}

## Notes



## Highlights

`;

export class BookNoteGenerator {
  private app: App;
  private liquid: Liquid;
  private getSettings: () => LibrosSettings;
  private unifiedGenerator: UnifiedNoteGenerator | null = null;

  constructor(app: App, getSettings: () => LibrosSettings) {
    this.app = app;
    this.getSettings = getSettings;
    this.liquid = new Liquid({
      strictFilters: false,
      strictVariables: false,
    });

    // Register custom filters
    this.registerFilters();

    // Initialize unified generator if template settings exist
    const settings = this.getSettings();
    if (settings.templates) {
      this.unifiedGenerator = new UnifiedNoteGenerator(app, settings.templates);
    }
  }

  /**
   * Update the unified generator when settings change
   */
  refreshTemplates(): void {
    const settings = this.getSettings();
    if (settings.templates) {
      if (this.unifiedGenerator) {
        this.unifiedGenerator.setTemplates(settings.templates);
      } else {
        this.unifiedGenerator = new UnifiedNoteGenerator(this.app, settings.templates);
      }
    }
  }

  /**
   * Register custom Liquid filters
   */
  private registerFilters(): void {
    // Escape filter for YAML strings
    this.liquid.registerFilter('escape', (str: string) => {
      if (typeof str !== 'string') return str;
      return str.replace(/"/g, '\\"').replace(/\n/g, ' ');
    });

    // Stars filter for rating display
    this.liquid.registerFilter('stars', (rating: number) => {
      const fullStars = Math.floor(rating || 0);
      const emptyStars = 5 - fullStars;
      return '★'.repeat(fullStars) + '☆'.repeat(emptyStars);
    });
  }

  /**
   * Generate a book note from Calibre metadata
   * Uses unified template system if available and enabled
   */
  async generateBookNote(
    book: CalibreBookFull,
    existingProgress?: number,
    existingStatus?: BookReadingStatus
  ): Promise<TFile> {
    const settings = this.getSettings();

    // Use unified generator if available and template is enabled
    if (this.unifiedGenerator && settings.templates?.bookNote?.enabled) {
      return this.generateWithUnifiedTemplate(book, existingProgress, existingStatus);
    }

    // Fallback to legacy template
    return this.generateWithLegacyTemplate(book, existingProgress, existingStatus);
  }

  /**
   * Generate using the unified template system
   */
  private async generateWithUnifiedTemplate(
    book: CalibreBookFull,
    existingProgress?: number,
    existingStatus?: BookReadingStatus
  ): Promise<TFile> {
    const settings = this.getSettings();

    // Convert to UnifiedBook
    const unifiedBook = calibreBookToUnified(book, settings, existingProgress, existingStatus);

    // Check for existing file to preserve user content
    const filePath = normalizePath(
      `${settings.templates.bookNote.folder}/${this.sanitizeFilename(book.title)}.md`
    );
    const existingFile = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;

    if (existingFile) {
      // Preserve existing content when updating
      const existingContent = await this.app.vault.read(existingFile);
      const result = await this.unifiedGenerator!.generateBookNote(unifiedBook);

      if (result.success && result.filePath) {
        const newFile = this.app.vault.getAbstractFileByPath(result.filePath) as TFile;
        const newContent = await this.app.vault.read(newFile);
        const mergedContent = this.mergeWithExisting(newContent, existingContent);
        await this.app.vault.modify(newFile, mergedContent);
        return newFile;
      }
    }

    // Generate new note
    const result = await this.unifiedGenerator!.generateBookNote(unifiedBook);
    if (result.success && result.filePath) {
      return this.app.vault.getAbstractFileByPath(result.filePath) as TFile;
    }

    throw new Error(result.error || 'Failed to generate book note');
  }

  /**
   * Generate using the legacy template (backwards compatibility)
   */
  private async generateWithLegacyTemplate(
    book: CalibreBookFull,
    existingProgress?: number,
    existingStatus?: BookReadingStatus
  ): Promise<TFile> {
    const settings = this.getSettings();

    // Build template context
    const context = this.buildTemplateContext(book, existingProgress, existingStatus);

    // Render template
    const content = await this.liquid.parseAndRender(
      DEFAULT_CALIBRE_BOOK_TEMPLATE,
      { book: context }
    );

    // Clean up template artifacts (empty lines from conditionals)
    const cleanedContent = this.cleanupContent(content);

    // Create or update file
    const filePath = normalizePath(
      `${settings.calibreBookNotesFolder}/${this.sanitizeFilename(book.title)}.md`
    );

    let file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
    if (file) {
      // Preserve existing content below frontmatter if updating
      const existingContent = await this.app.vault.read(file);
      const mergedContent = this.mergeWithExisting(cleanedContent, existingContent);
      await this.app.vault.modify(file, mergedContent);
    } else {
      file = await this.app.vault.create(filePath, cleanedContent);
    }

    return file;
  }

  /**
   * Build the template context from a Calibre book
   */
  private buildTemplateContext(
    book: CalibreBookFull,
    existingProgress?: number,
    existingStatus?: BookReadingStatus
  ): Record<string, unknown> {
    const settings = this.getSettings();

    // Build author link
    const authorName = book.authors.length > 0 ? book.authors[0].name : 'Unknown';
    const authorLink = `[[${settings.calibreAuthorIndexFolder}/${authorName}|${authorName}]]`;

    // Build series link
    const seriesLink = book.series
      ? `[[${settings.calibreSeriesIndexFolder}/${book.series.name}|${book.series.name}]]`
      : null;

    // Build bookshelves (tags as links)
    const bookshelves = book.tags.map(
      (tag) => `[[${settings.calibreShelfIndexFolder}/${tag.name}|${tag.name}]]`
    );

    // Build cover URL in vault
    const coverUrl = book.hasCover
      ? `${settings.calibreCoversFolder}/calibre-${book.id}.jpg`
      : null;

    // Generate star rating display
    const rating = book.rating ?? 0;
    const stars = '★'.repeat(Math.floor(rating)) + '☆'.repeat(5 - Math.floor(rating));

    return {
      // Identifiers
      uuid: book.uuid,
      calibreId: book.id,

      // Core metadata
      title: book.title,
      titleSort: book.titleSort,
      authorName,
      authorLink,
      authors: book.authors.map((a) => a.name),

      // Series
      seriesLink,
      seriesName: book.series?.name,
      seriesIndex: book.seriesIndex ?? 1,

      // Classification
      bookshelves,
      tags: book.tags.map((t) => t.name),

      // Rating
      rating: book.rating,
      stars,

      // Media
      coverUrl,
      coverPath: book.coverPath,

      // Reading status
      progress: existingProgress ?? 0,
      status: existingStatus ?? 'to-read',

      // Additional metadata
      language: book.languages[0]?.lang_code,
      publisher: book.publisher?.name,
      publishedDate: book.pubdate?.toISOString().split('T')[0],
      description: book.description,
      isbn: book.identifiers['isbn'],

      // Paths
      epubPath: book.epubPath || '',
      calibrePath: book.calibrePath,

      // Timestamps
      lastSync: new Date().toISOString(),
      addedAt: book.addedAt.toISOString(),
      lastModified: book.lastModified.toISOString(),
    };
  }

  /**
   * Clean up template output (remove extra blank lines)
   */
  private cleanupContent(content: string): string {
    return content
      .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
      .replace(/---\n\n+/g, '---\n')  // Clean after frontmatter start
      .replace(/\n+---/g, '\n---')  // Clean before frontmatter end
      .trim();
  }

  /**
   * Merge new frontmatter with existing content
   */
  private mergeWithExisting(newContent: string, existingContent: string): string {
    // Extract the body from existing content (after frontmatter)
    const existingMatch = existingContent.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    if (!existingMatch) {
      return newContent;
    }

    const existingBody = existingMatch[1];

    // Check if existing body has user content (not just template placeholders)
    const hasUserContent = existingBody.includes('## Notes\n\n') === false ||
      existingBody.split('## Notes')[1]?.trim().length > 20;

    if (hasUserContent) {
      // Extract new frontmatter
      const newMatch = newContent.match(/^(---\n[\s\S]*?\n---)\n/);
      if (newMatch) {
        // Keep new frontmatter, preserve existing body
        return newMatch[1] + '\n' + existingBody;
      }
    }

    return newContent;
  }

  /**
   * Check if a book note already exists
   */
  bookNoteExists(book: CalibreBookFull): boolean {
    const settings = this.getSettings();
    const filePath = normalizePath(
      `${settings.calibreBookNotesFolder}/${this.sanitizeFilename(book.title)}.md`
    );
    return this.app.vault.getAbstractFileByPath(filePath) !== null;
  }

  /**
   * Get the path where a book note would be created
   */
  getBookNotePath(book: CalibreBookFull): string {
    const settings = this.getSettings();
    return normalizePath(
      `${settings.calibreBookNotesFolder}/${this.sanitizeFilename(book.title)}.md`
    );
  }

  /**
   * Update just the frontmatter of an existing book note
   */
  async updateFrontmatter(
    book: CalibreBookFull,
    updates: Partial<BookNoteFrontmatter>
  ): Promise<void> {
    const settings = this.getSettings();
    const filePath = normalizePath(
      `${settings.calibreBookNotesFolder}/${this.sanitizeFilename(book.title)}.md`
    );

    const file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
    if (!file) return;

    const content = await this.app.vault.read(file);

    // Parse existing frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return;

    const [, frontmatterStr, body] = match;

    // Update specific fields in frontmatter
    let updatedFrontmatter = frontmatterStr;
    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}:.*$`, 'm');
      const newLine = `${key}: ${typeof value === 'string' ? `"${value}"` : value}`;

      if (regex.test(updatedFrontmatter)) {
        updatedFrontmatter = updatedFrontmatter.replace(regex, newLine);
      } else {
        // Add new field before the closing ---
        updatedFrontmatter += `\n${newLine}`;
      }
    }

    // Update lastSync
    const syncRegex = /^lastSync:.*$/m;
    const syncLine = `lastSync: ${new Date().toISOString()}`;
    if (syncRegex.test(updatedFrontmatter)) {
      updatedFrontmatter = updatedFrontmatter.replace(syncRegex, syncLine);
    } else {
      updatedFrontmatter += `\n${syncLine}`;
    }

    const newContent = `---\n${updatedFrontmatter}\n---\n${body}`;
    await this.app.vault.modify(file, newContent);
  }

  /**
   * Sanitize a string for use as a filename
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }
}
