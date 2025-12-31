/**
 * Note generator for creating book and highlight notes
 */
import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { LiquidEngine } from './liquid-engine';
import { DEFAULT_BOOK_NOTE_TEMPLATE, DEFAULT_HIGHLIGHT_NOTE_TEMPLATE } from './default-templates';
import type { Book, Highlight } from '../library/types';

export interface NoteGeneratorOptions {
  bookNotesFolder: string;
  highlightsFolder: string;
  bookNoteTemplate?: string;
  highlightNoteTemplate?: string;
}

export class NoteGenerator {
  private engine: LiquidEngine;

  constructor(
    private app: App,
    private options: NoteGeneratorOptions
  ) {
    this.engine = new LiquidEngine();
  }

  /**
   * Generate or update a book note
   */
  async generateBookNote(book: Book, highlights: Highlight[] = []): Promise<TFile> {
    const template = this.options.bookNoteTemplate || DEFAULT_BOOK_NOTE_TEMPLATE;
    const context = LiquidEngine.bookToContext(book, highlights);

    const content = await this.engine.render(template, context);
    const fileName = this.sanitizeFileName(book.title);
    const folderPath = normalizePath(this.options.bookNotesFolder);
    const filePath = normalizePath(`${folderPath}/${fileName}.md`);

    // Ensure folder exists
    await this.ensureFolder(folderPath);

    // Check if file exists
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);

    if (existingFile instanceof TFile) {
      // Update existing file, preserving user content
      await this.updateBookNote(existingFile, content, book);
      return existingFile;
    } else {
      // Create new file
      return await this.app.vault.create(filePath, content);
    }
  }

  /**
   * Update an existing book note, preserving user content
   */
  private async updateBookNote(file: TFile, newContent: string, book: Book): Promise<void> {
    const existingContent = await this.app.vault.read(file);

    // Parse existing frontmatter
    const frontmatterMatch = existingContent.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      // No frontmatter, just update the whole file
      await this.app.vault.modify(file, newContent);
      return;
    }

    // Update only the frontmatter fields we manage
    const newFrontmatterMatch = newContent.match(/^---\n([\s\S]*?)\n---/);
    if (!newFrontmatterMatch) {
      return;
    }

    // Parse and merge frontmatter
    const updatedFrontmatter = this.mergeFrontmatter(
      frontmatterMatch[1],
      newFrontmatterMatch[1],
      ['status', 'progress', 'last_read', 'completed', 'highlight_count']
    );

    // Replace frontmatter in existing content
    const updatedContent = existingContent.replace(
      /^---\n[\s\S]*?\n---/,
      `---\n${updatedFrontmatter}\n---`
    );

    await this.app.vault.modify(file, updatedContent);
  }

  /**
   * Merge frontmatter, only updating specified fields
   */
  private mergeFrontmatter(
    existing: string,
    updated: string,
    fieldsToUpdate: string[]
  ): string {
    const existingLines = existing.split('\n');
    const updatedLines = updated.split('\n');

    // Parse updated values
    const updatedValues: Record<string, string> = {};
    for (const line of updatedLines) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match && fieldsToUpdate.includes(match[1])) {
        updatedValues[match[1]] = match[2];
      }
    }

    // Update existing lines
    const result: string[] = [];
    const updatedFields = new Set<string>();

    for (const line of existingLines) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match && fieldsToUpdate.includes(match[1]) && updatedValues[match[1]] !== undefined) {
        result.push(`${match[1]}: ${updatedValues[match[1]]}`);
        updatedFields.add(match[1]);
      } else {
        result.push(line);
      }
    }

    // Add any new fields that weren't in existing
    for (const [field, value] of Object.entries(updatedValues)) {
      if (!updatedFields.has(field)) {
        result.push(`${field}: ${value}`);
      }
    }

    return result.join('\n');
  }

  /**
   * Generate a highlight note
   */
  async generateHighlightNote(book: Book, highlight: Highlight): Promise<TFile> {
    const template = this.options.highlightNoteTemplate || DEFAULT_HIGHLIGHT_NOTE_TEMPLATE;
    const context = LiquidEngine.highlightToContext(book, highlight);

    const content = await this.engine.render(template, context);

    // Create folder structure: Highlights/Book Title/
    const bookFolder = this.sanitizeFileName(book.title);
    const folderPath = normalizePath(`${this.options.highlightsFolder}/${bookFolder}`);
    await this.ensureFolder(folderPath);

    // Create filename from highlight text (first few words + id)
    const shortText = highlight.text.slice(0, 30).replace(/[^\w\s]/g, '').trim();
    const fileName = this.sanitizeFileName(`${shortText} - ${highlight.id.slice(0, 8)}`);
    const filePath = normalizePath(`${folderPath}/${fileName}.md`);

    // Check if file exists
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);

    if (existingFile instanceof TFile) {
      // Update existing file
      await this.app.vault.modify(existingFile, content);
      return existingFile;
    } else {
      return await this.app.vault.create(filePath, content);
    }
  }

  /**
   * Get the path to a book's note file
   */
  getBookNotePath(book: Book): string {
    const fileName = this.sanitizeFileName(book.title);
    return normalizePath(`${this.options.bookNotesFolder}/${fileName}.md`);
  }

  /**
   * Check if a book note exists
   */
  bookNoteExists(book: Book): boolean {
    const path = this.getBookNotePath(book);
    return this.app.vault.getAbstractFileByPath(path) instanceof TFile;
  }

  /**
   * Ensure a folder exists, creating it if necessary
   */
  private async ensureFolder(folderPath: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await this.app.vault.createFolder(folderPath);
    }
  }

  /**
   * Sanitize a string for use as a filename
   */
  private sanitizeFileName(name: string): string {
    return name
      .replace(/[\\/:*?"<>|]/g, '')  // Remove invalid chars
      .replace(/\s+/g, ' ')          // Normalize whitespace
      .trim()
      .slice(0, 100);                // Limit length
  }

  /**
   * Update template options
   */
  updateOptions(options: Partial<NoteGeneratorOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Validate a template
   */
  async validateTemplate(template: string): Promise<{ valid: boolean; error?: string }> {
    return this.engine.validate(template);
  }
}
