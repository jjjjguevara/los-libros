/**
 * Book Note Generator
 *
 * Generates book notes using the unified template system.
 * Works with UnifiedBook from any source (Calibre, OPDS, vault).
 */

import { App, TFile, normalizePath } from 'obsidian';
import type { UnifiedBook } from '../types/unified-book';
import type { TemplateSettings } from '../templates/template-types';
import { UnifiedNoteGenerator, type HighlightData } from '../templates/unified-note-generator';

export interface BookNoteGeneratorOptions {
  /** Whether to preserve existing user content when updating */
  preserveUserContent: boolean;
  /** Whether to auto-create if note doesn't exist */
  autoCreate: boolean;
}

const DEFAULT_OPTIONS: BookNoteGeneratorOptions = {
  preserveUserContent: true,
  autoCreate: true,
};

export class BookNoteGenerator {
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
   * Generate a book note
   */
  async generate(
    book: UnifiedBook,
    highlights: HighlightData[] = [],
    options: Partial<BookNoteGeneratorOptions> = {}
  ): Promise<TFile | null> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const config = this.getSettings().bookNote;

    if (!config.enabled) {
      console.log('Book note generation is disabled');
      return null;
    }

    const filePath = this.getNotePath(book);
    const existingFile = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;

    // If preserving user content and file exists, merge
    if (opts.preserveUserContent && existingFile) {
      return await this.updateWithPreservedContent(book, highlights, existingFile);
    }

    // Generate fresh note
    const result = await this.generator.generateBookNote(book, highlights);
    if (result.success && result.filePath) {
      return this.app.vault.getAbstractFileByPath(result.filePath) as TFile;
    }

    console.error('Failed to generate book note:', result.error);
    return null;
  }

  /**
   * Update an existing note while preserving user content
   */
  private async updateWithPreservedContent(
    book: UnifiedBook,
    highlights: HighlightData[],
    existingFile: TFile
  ): Promise<TFile> {
    const existingContent = await this.app.vault.read(existingFile);

    // Generate new content
    const result = await this.generator.generateBookNote(book, highlights);
    if (!result.success) {
      console.warn('Failed to generate updated content, keeping existing');
      return existingFile;
    }

    // Read the newly generated content
    const newFile = this.app.vault.getAbstractFileByPath(result.filePath!) as TFile;
    const newContent = await this.app.vault.read(newFile);

    // Merge: new frontmatter + existing body
    const mergedContent = this.mergeContent(newContent, existingContent);
    await this.app.vault.modify(existingFile, mergedContent);

    return existingFile;
  }

  /**
   * Merge new frontmatter with existing body content
   */
  private mergeContent(newContent: string, existingContent: string): string {
    // Extract frontmatter from new content
    const newMatch = newContent.match(/^(---\n[\s\S]*?\n---)\n([\s\S]*)$/);
    if (!newMatch) return newContent;

    const [, newFrontmatter] = newMatch;

    // Extract body from existing content (after frontmatter)
    const existingMatch = existingContent.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    if (!existingMatch) return newContent;

    const existingBody = existingMatch[1];

    // Check if existing body has user content (more than just placeholders)
    const hasUserContent = this.hasUserContent(existingBody);

    if (hasUserContent) {
      return `${newFrontmatter}\n${existingBody}`;
    }

    return newContent;
  }

  /**
   * Check if body has user-added content
   */
  private hasUserContent(body: string): boolean {
    // Check for common signs of user content
    const lines = body.split('\n');
    let inNotesSection = false;
    let inHighlightsSection = false;

    for (const line of lines) {
      if (line.startsWith('## Notes')) {
        inNotesSection = true;
        inHighlightsSection = false;
        continue;
      }
      if (line.startsWith('## Highlights')) {
        inHighlightsSection = true;
        inNotesSection = false;
        continue;
      }
      if (line.startsWith('## ')) {
        inNotesSection = false;
        inHighlightsSection = false;
        continue;
      }

      // Check for non-empty content in notes section
      if (inNotesSection && line.trim().length > 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a book note exists
   */
  exists(book: UnifiedBook): boolean {
    const filePath = this.getNotePath(book);
    return this.app.vault.getAbstractFileByPath(filePath) !== null;
  }

  /**
   * Get the path where a book note would be created
   */
  getNotePath(book: UnifiedBook): string {
    const config = this.getSettings().bookNote;
    return normalizePath(`${config.folder}/${this.sanitizeFileName(book.title)}.md`);
  }

  /**
   * Delete a book note
   */
  async delete(book: UnifiedBook): Promise<void> {
    const filePath = this.getNotePath(book);
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.app.vault.delete(file);
    }
  }

  /**
   * Update just the frontmatter of an existing book note
   */
  async updateFrontmatter(
    book: UnifiedBook,
    updates: Record<string, unknown>
  ): Promise<void> {
    const filePath = this.getNotePath(book);
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
      const formattedValue = typeof value === 'string' ? `"${value}"` : value;
      const newLine = `${key}: ${formattedValue}`;

      if (regex.test(updatedFrontmatter)) {
        updatedFrontmatter = updatedFrontmatter.replace(regex, newLine);
      } else {
        updatedFrontmatter += `\n${newLine}`;
      }
    }

    // Add lastSync timestamp
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
  private sanitizeFileName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }
}
