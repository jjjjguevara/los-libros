/**
 * AuthorIndexGenerator
 *
 * Generates author index notes that aggregate all books by an author.
 * Creates linkable notes for the author field in book notes.
 */

import { App, TFile, normalizePath } from 'obsidian';
import { Liquid } from 'liquidjs';
import type { CalibreAuthor, CalibreBookFull, AuthorNoteFrontmatter } from '../calibre-types';
import type { LibrosSettings } from '../../settings/settings';

/**
 * Default template for author index notes
 */
export const DEFAULT_AUTHOR_INDEX_TEMPLATE = `---
type: author
name: "{{ author.name | escape }}"
sortName: "{{ author.sortName | escape }}"
bookCount: {{ author.bookCount }}
lastSync: {{ author.lastSync }}
---

# {{ author.name }}

**Books in Library:** {{ author.bookCount }}

## Books

{% for book in books %}
- [[{{ book.path }}|{{ book.title }}]]{% if book.series %} ({{ book.series }} #{{ book.seriesIndex }}){% endif %}
{% endfor %}

## Series

{% if series.size > 0 %}
{% for s in series %}
### [[{{ s.path }}|{{ s.name }}]]
{% for book in s.books %}
{{ book.seriesIndex }}. [[{{ book.path }}|{{ book.title }}]]
{% endfor %}

{% endfor %}
{% else %}
*No series found for this author.*
{% endif %}

## Notes

`;

export class AuthorIndexGenerator {
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
   * Generate an author index note
   */
  async generateAuthorNote(
    author: CalibreAuthor,
    books: CalibreBookFull[]
  ): Promise<TFile> {
    const settings = this.getSettings();

    // Filter books by this author
    const authorBooks = books.filter((b) =>
      b.authors.some((a) => a.id === author.id)
    );

    if (authorBooks.length === 0) {
      throw new Error(`No books found for author: ${author.name}`);
    }

    // Build template context
    const context = this.buildTemplateContext(author, authorBooks);

    // Render template
    const content = await this.liquid.parseAndRender(
      DEFAULT_AUTHOR_INDEX_TEMPLATE,
      context
    );

    // Clean up
    const cleanedContent = content.replace(/\n{3,}/g, '\n\n').trim();

    // Create or update file
    const filePath = normalizePath(
      `${settings.calibreAuthorIndexFolder}/${this.sanitizeFilename(author.name)}.md`
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
   * Generate all author index notes
   */
  async generateAllAuthorNotes(
    authors: CalibreAuthor[],
    books: CalibreBookFull[]
  ): Promise<TFile[]> {
    const files: TFile[] = [];

    for (const author of authors) {
      const authorBooks = books.filter((b) =>
        b.authors.some((a) => a.id === author.id)
      );

      if (authorBooks.length > 0) {
        try {
          const file = await this.generateAuthorNote(author, books);
          files.push(file);
        } catch (error) {
          console.warn(`Failed to generate author note for ${author.name}:`, error);
        }
      }
    }

    return files;
  }

  /**
   * Build template context for an author
   */
  private buildTemplateContext(
    author: CalibreAuthor,
    authorBooks: CalibreBookFull[]
  ): Record<string, unknown> {
    const settings = this.getSettings();

    // Group books by series
    const seriesMap = new Map<string, {
      name: string;
      path: string;
      books: Array<{ title: string; path: string; seriesIndex: number }>;
    }>();

    const standaloneBooks: Array<{ title: string; path: string; series?: string; seriesIndex?: number }> = [];

    for (const book of authorBooks) {
      const bookPath = `${settings.calibreBookNotesFolder}/${this.sanitizeFilename(book.title)}`;

      if (book.series) {
        const existing = seriesMap.get(book.series.name);
        if (existing) {
          existing.books.push({
            title: book.title,
            path: bookPath,
            seriesIndex: book.seriesIndex ?? 1,
          });
        } else {
          seriesMap.set(book.series.name, {
            name: book.series.name,
            path: `${settings.calibreSeriesIndexFolder}/${this.sanitizeFilename(book.series.name)}`,
            books: [{
              title: book.title,
              path: bookPath,
              seriesIndex: book.seriesIndex ?? 1,
            }],
          });
        }
      }

      standaloneBooks.push({
        title: book.title,
        path: bookPath,
        series: book.series?.name,
        seriesIndex: book.seriesIndex ?? undefined,
      });
    }

    // Sort books within each series
    const series = Array.from(seriesMap.values()).map((s) => ({
      ...s,
      books: s.books.sort((a, b) => a.seriesIndex - b.seriesIndex),
    }));

    // Sort standalone books alphabetically
    standaloneBooks.sort((a, b) => a.title.localeCompare(b.title));

    return {
      author: {
        name: author.name,
        sortName: author.sort,
        bookCount: authorBooks.length,
        lastSync: new Date().toISOString(),
      },
      books: standaloneBooks,
      series,
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
