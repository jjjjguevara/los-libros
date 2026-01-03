/**
 * ShelfIndexGenerator
 *
 * Generates bookshelf/tag index notes that aggregate books by Calibre tag.
 */

import { App, TFile, normalizePath } from 'obsidian';
import { Liquid } from 'liquidjs';
import type { CalibreTag, CalibreBookFull, ShelfNoteFrontmatter } from '../calibre-types';
import type { LibrosSettings } from '../../settings/settings';

/**
 * Default template for shelf/tag index notes
 */
export const DEFAULT_SHELF_INDEX_TEMPLATE = `---
type: shelf
name: "{{ shelf.name | escape }}"
bookCount: {{ shelf.bookCount }}
lastSync: {{ shelf.lastSync }}
---

# {{ shelf.name }}

**Books:** {{ shelf.bookCount }}

## Books

{% for book in books %}
- [[{{ book.path }}|{{ book.title }}]] — *{{ book.author }}*
{% endfor %}

## By Author

{% for group in byAuthor %}
### {{ group.author }}
{% for book in group.books %}
- [[{{ book.path }}|{{ book.title }}]]
{% endfor %}

{% endfor %}

## Notes

`;

export class ShelfIndexGenerator {
  private app: App;
  private liquid: Liquid;
  private getSettings: () => LibrosSettings;

  constructor(app: App, getSettings: () => LibrosSettings) {
    this.app = app;
    this.getSettings = getSettings;
    this.liquid = new Liquid({
      strictFilters: false,
      strictVariables: false,
    });

    this.liquid.registerFilter('escape', (str: string) => {
      if (typeof str !== 'string') return str;
      return str.replace(/"/g, '\\"').replace(/\n/g, ' ');
    });
  }

  /**
   * Generate a shelf/tag index note
   */
  async generateShelfNote(
    tag: CalibreTag,
    allBooks: CalibreBookFull[]
  ): Promise<TFile> {
    const settings = this.getSettings();

    // Filter books with this tag
    const tagBooks = allBooks.filter((b) =>
      b.tags.some((t) => t.id === tag.id)
    );

    if (tagBooks.length === 0) {
      throw new Error(`No books found for tag: ${tag.name}`);
    }

    // Build template context
    const context = this.buildTemplateContext(tag, tagBooks);

    // Render template
    const content = await this.liquid.parseAndRender(
      DEFAULT_SHELF_INDEX_TEMPLATE,
      context
    );

    // Clean up
    const cleanedContent = content.replace(/\n{3,}/g, '\n\n').trim();

    // Create or update file
    const filePath = normalizePath(
      `${settings.calibreShelfIndexFolder}/${this.sanitizeFilename(tag.name)}.md`
    );

    let file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
    if (file) {
      await this.app.vault.modify(file, cleanedContent);
    } else {
      file = await this.app.vault.create(filePath, cleanedContent);
    }

    return file;
  }

  /**
   * Generate all shelf/tag index notes
   */
  async generateAllShelfNotes(
    allTags: CalibreTag[],
    allBooks: CalibreBookFull[]
  ): Promise<TFile[]> {
    const files: TFile[] = [];

    for (const tag of allTags) {
      const tagBooks = allBooks.filter((b) =>
        b.tags.some((t) => t.id === tag.id)
      );

      if (tagBooks.length > 0) {
        try {
          const file = await this.generateShelfNote(tag, allBooks);
          files.push(file);
        } catch (error) {
          console.warn(`Failed to generate shelf note for ${tag.name}:`, error);
        }
      }
    }

    return files;
  }

  /**
   * Build template context for a shelf/tag
   */
  private buildTemplateContext(
    tag: CalibreTag,
    tagBooks: CalibreBookFull[]
  ): Record<string, unknown> {
    const settings = this.getSettings();

    // Build book list
    const books = tagBooks.map((book) => ({
      title: book.title,
      path: `${settings.calibreBookNotesFolder}/${this.sanitizeFilename(book.title)}`,
      author: book.authors.length > 0 ? book.authors[0].name : 'Unknown',
      authorPath: book.authors.length > 0
        ? `${settings.calibreAuthorIndexFolder}/${this.sanitizeFilename(book.authors[0].name)}`
        : null,
    }));

    // Sort alphabetically
    books.sort((a, b) => a.title.localeCompare(b.title));

    // Group by author
    const authorMap = new Map<string, Array<{ title: string; path: string }>>();
    for (const book of books) {
      const existing = authorMap.get(book.author);
      if (existing) {
        existing.push({ title: book.title, path: book.path });
      } else {
        authorMap.set(book.author, [{ title: book.title, path: book.path }]);
      }
    }

    const byAuthor = Array.from(authorMap.entries())
      .map(([author, authorBooks]) => ({
        author,
        authorPath: `${settings.calibreAuthorIndexFolder}/${this.sanitizeFilename(author)}`,
        books: authorBooks.sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => a.author.localeCompare(b.author));

    return {
      shelf: {
        name: tag.name,
        bookCount: tagBooks.length,
        lastSync: new Date().toISOString(),
      },
      books,
      byAuthor,
    };
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
