/**
 * File-based Test Vault
 *
 * Provides file system access for E2E tests that need to read/write
 * actual markdown files with frontmatter.
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed book note with frontmatter and content
 */
export interface BookNote {
  path: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

/**
 * Book note creation options
 */
export interface CreateNoteOptions {
  bookId: string;
  calibreId?: number;
  title: string;
  authors?: string[];
  rating?: number;
  tags?: string[];
  series?: string;
  seriesIndex?: number;
  progress?: number;
  customFields?: Record<string, unknown>;
  content?: string;
}

// ============================================================================
// File Test Vault Class
// ============================================================================

/**
 * File-based vault for E2E testing
 */
export class FileTestVault {
  private vaultPath: string;
  private booksPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.booksPath = path.join(vaultPath, 'Books');
  }

  /**
   * Initialize the test vault
   */
  async init(): Promise<void> {
    // Create vault directory if needed
    if (!fs.existsSync(this.vaultPath)) {
      fs.mkdirSync(this.vaultPath, { recursive: true });
    }

    // Create Books subdirectory
    if (!fs.existsSync(this.booksPath)) {
      fs.mkdirSync(this.booksPath, { recursive: true });
    }
  }

  /**
   * Clear all book notes
   */
  async clear(): Promise<void> {
    if (fs.existsSync(this.booksPath)) {
      const files = fs.readdirSync(this.booksPath);
      for (const file of files) {
        if (file.endsWith('.md')) {
          fs.unlinkSync(path.join(this.booksPath, file));
        }
      }
    }
  }

  /**
   * Create a book note with frontmatter
   */
  async createNote(options: CreateNoteOptions): Promise<string> {
    const filename = this.sanitizeFilename(options.title) + '.md';
    const filePath = path.join(this.booksPath, filename);

    // Build frontmatter
    const frontmatter: Record<string, unknown> = {
      bookId: options.bookId,
      title: options.title,
    };

    if (options.calibreId !== undefined) {
      frontmatter.calibreId = options.calibreId;
    }
    if (options.authors) {
      frontmatter.authors = options.authors;
    }
    if (options.rating !== undefined) {
      frontmatter.rating = options.rating;
    }
    if (options.tags) {
      frontmatter.tags = options.tags;
    }
    if (options.series) {
      frontmatter.series = options.series;
    }
    if (options.seriesIndex !== undefined) {
      frontmatter.seriesIndex = options.seriesIndex;
    }
    if (options.progress !== undefined) {
      frontmatter.progress = options.progress;
    }
    if (options.customFields) {
      Object.assign(frontmatter, options.customFields);
    }

    // Build file content
    const content = this.buildMarkdown(frontmatter, options.content || '');
    fs.writeFileSync(filePath, content, 'utf-8');

    return filePath;
  }

  /**
   * Read a book note by path
   */
  async readNote(notePath: string): Promise<BookNote | null> {
    if (!fs.existsSync(notePath)) {
      return null;
    }

    const content = fs.readFileSync(notePath, 'utf-8');
    return this.parseMarkdown(notePath, content);
  }

  /**
   * Read a book note by book ID
   */
  async findNoteByBookId(bookId: string): Promise<BookNote | null> {
    const notes = await this.getAllNotes();
    return notes.find((n) => n.frontmatter.bookId === bookId) || null;
  }

  /**
   * Read a book note by Calibre ID
   */
  async findNoteByCalibreId(calibreId: number): Promise<BookNote | null> {
    const notes = await this.getAllNotes();
    return notes.find((n) => n.frontmatter.calibreId === calibreId) || null;
  }

  /**
   * Get all book notes
   */
  async getAllNotes(): Promise<BookNote[]> {
    if (!fs.existsSync(this.booksPath)) {
      return [];
    }

    const files = fs.readdirSync(this.booksPath).filter((f) => f.endsWith('.md'));
    const notes: BookNote[] = [];

    for (const file of files) {
      const filePath = path.join(this.booksPath, file);
      const note = await this.readNote(filePath);
      if (note) {
        notes.push(note);
      }
    }

    return notes;
  }

  /**
   * Update frontmatter for a note
   */
  async updateFrontmatter(
    notePath: string,
    updates: Record<string, unknown>
  ): Promise<void> {
    const note = await this.readNote(notePath);
    if (!note) {
      throw new Error(`Note not found: ${notePath}`);
    }

    const newFrontmatter = { ...note.frontmatter, ...updates };
    const content = this.buildMarkdown(newFrontmatter, note.content);
    fs.writeFileSync(notePath, content, 'utf-8');
  }

  /**
   * Get vault path
   */
  getVaultPath(): string {
    return this.vaultPath;
  }

  /**
   * Get books path
   */
  getBooksPath(): string {
    return this.booksPath;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Build markdown with YAML frontmatter
   */
  private buildMarkdown(frontmatter: Record<string, unknown>, content: string): string {
    const yaml = this.objectToYaml(frontmatter);
    // Ensure yaml ends with newline, then add closing delimiter
    const yamlWithNewline = yaml.endsWith('\n') ? yaml : yaml + '\n';
    return `---\n${yamlWithNewline}---\n\n${content}`;
  }

  /**
   * Parse markdown with YAML frontmatter
   */
  private parseMarkdown(filePath: string, content: string): BookNote {
    // Match YAML frontmatter between --- delimiters
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

    if (!frontmatterMatch) {
      return {
        path: filePath,
        frontmatter: {},
        content: content,
      };
    }

    const yamlContent = frontmatterMatch[1];
    const bodyContent = content.slice(frontmatterMatch[0].length).trim();

    return {
      path: filePath,
      frontmatter: this.yamlToObject(yamlContent),
      content: bodyContent,
    };
  }

  /**
   * Convert object to YAML string (simple implementation)
   */
  private objectToYaml(obj: Record<string, unknown>, indent = 0): string {
    const lines: string[] = [];
    const prefix = '  '.repeat(indent);

    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue;

      if (Array.isArray(value)) {
        if (value.length === 0) {
          lines.push(`${prefix}${key}: []`);
        } else {
          lines.push(`${prefix}${key}:`);
          for (const item of value) {
            if (typeof item === 'object' && item !== null) {
              lines.push(`${prefix}  -`);
              lines.push(this.objectToYaml(item as Record<string, unknown>, indent + 2));
            } else {
              lines.push(`${prefix}  - ${this.formatValue(item)}`);
            }
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        lines.push(`${prefix}${key}:`);
        lines.push(this.objectToYaml(value as Record<string, unknown>, indent + 1));
      } else {
        lines.push(`${prefix}${key}: ${this.formatValue(value)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format a value for YAML
   */
  private formatValue(value: unknown): string {
    if (typeof value === 'string') {
      // Quote strings that contain special characters
      if (/[:#\[\]{}|>!&*?'"]/.test(value) || value.includes('\n')) {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      return value;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return String(value);
  }

  /**
   * Parse YAML string to object (simple implementation)
   */
  private yamlToObject(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = yaml.split('\n');

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const match = line.match(/^(\w+):\s*(.*)$/);

      if (match) {
        const key = match[1];
        const valueStr = match[2].trim();

        if (valueStr === '' && i + 1 < lines.length && lines[i + 1].startsWith('  - ')) {
          // Array
          const items: unknown[] = [];
          i++;
          while (i < lines.length && lines[i].startsWith('  - ')) {
            const itemValue = lines[i].replace(/^\s+-\s*/, '').trim();
            items.push(this.parseValue(itemValue));
            i++;
          }
          result[key] = items;
          continue;
        } else if (valueStr === '[]') {
          result[key] = [];
        } else {
          result[key] = this.parseValue(valueStr);
        }
      }
      i++;
    }

    return result;
  }

  /**
   * Parse a YAML value
   */
  private parseValue(str: string): unknown {
    // Remove quotes and unescape
    if ((str.startsWith('"') && str.endsWith('"')) ||
        (str.startsWith("'") && str.endsWith("'"))) {
      return str.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
    }

    // Numbers
    if (/^-?\d+$/.test(str)) {
      return parseInt(str, 10);
    }
    if (/^-?\d+\.\d+$/.test(str)) {
      return parseFloat(str);
    }

    // Booleans
    if (str === 'true') return true;
    if (str === 'false') return false;

    // Null
    if (str === 'null' || str === '') return null;

    return str;
  }

  /**
   * Sanitize filename
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a file test vault
 */
export function createFileTestVault(vaultPath: string): FileTestVault {
  return new FileTestVault(vaultPath);
}

/**
 * Get default test vault path
 */
export function getDefaultTestVaultPath(): string {
  return path.join(process.cwd(), 'temp', 'test-vault');
}
