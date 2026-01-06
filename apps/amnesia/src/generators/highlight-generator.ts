/**
 * Highlight Generator
 *
 * Generates highlight notes using the unified template system.
 * Supports both hub (aggregated) and atomic (individual) highlights.
 */

import { App, TFile, normalizePath } from 'obsidian';
import type { UnifiedBook } from '../types/unified-book';
import type { TemplateSettings } from '../templates/template-types';
import {
  UnifiedNoteGenerator,
  type HighlightData,
  type NoteData,
  type GenerationResult,
} from '../templates/unified-note-generator';

export interface HighlightGeneratorOptions {
  /** Generate hub highlights (aggregated per book) */
  generateHub: boolean;
  /** Generate atomic highlights (one per highlight) */
  generateAtomic: boolean;
  /** Update existing files or skip */
  updateExisting: boolean;
}

const DEFAULT_OPTIONS: HighlightGeneratorOptions = {
  generateHub: true,
  generateAtomic: false,
  updateExisting: true,
};

export interface HighlightGenerationResult {
  hubFile?: TFile;
  atomicFiles: TFile[];
  /** Map of highlight ID to its generated atomic note path */
  atomicPathMap: Map<string, string>;
  errors: string[];
}

export class HighlightGenerator {
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
   * Generate highlight notes for a book
   */
  async generateHighlights(
    book: UnifiedBook,
    highlights: HighlightData[],
    options: Partial<HighlightGeneratorOptions> = {}
  ): Promise<HighlightGenerationResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const settings = this.getSettings();
    const result: HighlightGenerationResult = {
      atomicFiles: [],
      atomicPathMap: new Map(),
      errors: [],
    };

    if (highlights.length === 0) {
      return result;
    }

    // Generate hub highlights if enabled
    if (opts.generateHub && settings.hubHighlights.enabled) {
      try {
        const hubResult = await this.generator.generateHubHighlights(book, highlights);
        if (hubResult.success && hubResult.filePath) {
          result.hubFile = this.app.vault.getAbstractFileByPath(hubResult.filePath) as TFile;
        } else if (hubResult.error) {
          result.errors.push(hubResult.error);
        }
      } catch (error) {
        result.errors.push(`Hub highlights error: ${error}`);
      }
    }

    // Generate atomic highlights if enabled
    if (opts.generateAtomic && settings.atomicHighlight.enabled) {
      for (const highlight of highlights) {
        try {
          const atomicResult = await this.generator.generateAtomicHighlight(book, highlight);
          if (atomicResult.success && atomicResult.filePath) {
            const file = this.app.vault.getAbstractFileByPath(atomicResult.filePath) as TFile;
            if (file) {
              result.atomicFiles.push(file);
              // Track the mapping of highlight ID to its atomic note path
              result.atomicPathMap.set(highlight.id, atomicResult.filePath);
            }
          } else if (atomicResult.error) {
            result.errors.push(atomicResult.error);
          }
        } catch (error) {
          result.errors.push(`Atomic highlight error: ${error}`);
        }
      }
    }

    return result;
  }

  /**
   * Generate user notes for a book
   */
  async generateNotes(
    book: UnifiedBook,
    notes: NoteData[],
    options: Partial<HighlightGeneratorOptions> = {}
  ): Promise<HighlightGenerationResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const settings = this.getSettings();
    const result: HighlightGenerationResult = {
      atomicFiles: [],
      atomicPathMap: new Map(),
      errors: [],
    };

    if (notes.length === 0) {
      return result;
    }

    // Generate hub notes if enabled
    if (opts.generateHub && settings.hubNotes.enabled) {
      try {
        const hubResult = await this.generator.generateHubNotes(book, notes);
        if (hubResult.success && hubResult.filePath) {
          result.hubFile = this.app.vault.getAbstractFileByPath(hubResult.filePath) as TFile;
        } else if (hubResult.error) {
          result.errors.push(hubResult.error);
        }
      } catch (error) {
        result.errors.push(`Hub notes error: ${error}`);
      }
    }

    // Generate atomic notes if enabled
    if (opts.generateAtomic && settings.atomicNote.enabled) {
      for (const note of notes) {
        try {
          const atomicResult = await this.generator.generateAtomicNote(book, note);
          if (atomicResult.success && atomicResult.filePath) {
            const file = this.app.vault.getAbstractFileByPath(atomicResult.filePath) as TFile;
            if (file) {
              result.atomicFiles.push(file);
            }
          } else if (atomicResult.error) {
            result.errors.push(atomicResult.error);
          }
        } catch (error) {
          result.errors.push(`Atomic note error: ${error}`);
        }
      }
    }

    return result;
  }

  /**
   * Get the hub highlights path for a book
   */
  getHubHighlightsPath(book: UnifiedBook): string {
    const config = this.getSettings().hubHighlights;
    const fileName = `${this.sanitizeFileName(book.title)} - Highlights`;
    return normalizePath(`${config.folder}/${book.title}/${fileName}.md`);
  }

  /**
   * Get the hub notes path for a book
   */
  getHubNotesPath(book: UnifiedBook): string {
    const config = this.getSettings().hubNotes;
    const fileName = `${this.sanitizeFileName(book.title)} - Notes`;
    return normalizePath(`${config.folder}/${book.title}/${fileName}.md`);
  }

  /**
   * Check if hub highlights exist for a book
   */
  hubHighlightsExist(book: UnifiedBook): boolean {
    const filePath = this.getHubHighlightsPath(book);
    return this.app.vault.getAbstractFileByPath(filePath) !== null;
  }

  /**
   * Check if hub notes exist for a book
   */
  hubNotesExist(book: UnifiedBook): boolean {
    const filePath = this.getHubNotesPath(book);
    return this.app.vault.getAbstractFileByPath(filePath) !== null;
  }

  /**
   * Delete all highlight notes for a book
   */
  async deleteAllForBook(book: UnifiedBook): Promise<void> {
    const settings = this.getSettings();

    // Delete hub highlights
    const hubHighlightsPath = this.getHubHighlightsPath(book);
    const hubHighlightsFile = this.app.vault.getAbstractFileByPath(hubHighlightsPath);
    if (hubHighlightsFile instanceof TFile) {
      await this.app.vault.delete(hubHighlightsFile);
    }

    // Delete hub notes
    const hubNotesPath = this.getHubNotesPath(book);
    const hubNotesFile = this.app.vault.getAbstractFileByPath(hubNotesPath);
    if (hubNotesFile instanceof TFile) {
      await this.app.vault.delete(hubNotesFile);
    }

    // Delete atomic folder
    const atomicFolder = normalizePath(`${settings.atomicHighlight.folder}/${book.title}/atomic`);
    const folder = this.app.vault.getAbstractFileByPath(atomicFolder);
    if (folder) {
      await this.app.vault.delete(folder, true);
    }
  }

  /**
   * Sync highlights - updates hub and adds new atomics without duplicating
   */
  async syncHighlights(
    book: UnifiedBook,
    highlights: HighlightData[],
    options: Partial<HighlightGeneratorOptions> = {}
  ): Promise<HighlightGenerationResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const settings = this.getSettings();
    const result: HighlightGenerationResult = {
      atomicFiles: [],
      atomicPathMap: new Map(),
      errors: [],
    };

    // Always update hub (full replacement)
    if (opts.generateHub && settings.hubHighlights.enabled) {
      const hubResult = await this.generator.generateHubHighlights(book, highlights);
      if (hubResult.success && hubResult.filePath) {
        result.hubFile = this.app.vault.getAbstractFileByPath(hubResult.filePath) as TFile;
      }
    }

    // For atomics, only generate new ones (check by ID)
    if (opts.generateAtomic && settings.atomicHighlight.enabled) {
      const existingIds = await this.getExistingAtomicIds(book);

      for (const highlight of highlights) {
        if (!existingIds.has(highlight.id)) {
          const atomicResult = await this.generator.generateAtomicHighlight(book, highlight);
          if (atomicResult.success && atomicResult.filePath) {
            const file = this.app.vault.getAbstractFileByPath(atomicResult.filePath) as TFile;
            if (file) {
              result.atomicFiles.push(file);
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Get IDs of existing atomic highlights for a book
   */
  private async getExistingAtomicIds(book: UnifiedBook): Promise<Set<string>> {
    const settings = this.getSettings();
    const atomicFolder = normalizePath(`${settings.atomicHighlight.folder}/${book.title}/atomic`);
    const ids = new Set<string>();

    const folder = this.app.vault.getAbstractFileByPath(atomicFolder);
    if (!folder) return ids;

    // List files in atomic folder and extract IDs from frontmatter
    const files = this.app.vault.getMarkdownFiles().filter(
      f => f.path.startsWith(atomicFolder)
    );

    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const match = content.match(/highlightId:\s*["']?([^"'\n]+)["']?/);
        if (match) {
          ids.add(match[1]);
        }
      } catch {
        // Ignore read errors
      }
    }

    return ids;
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
