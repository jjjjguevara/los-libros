/**
 * SeriesIndexGenerator
 *
 * Generates series index notes that list all books in a series in order.
 */

import { App, TFile, normalizePath } from 'obsidian';
import { Liquid } from 'liquidjs';
import type { CalibreSeries, CalibreBookFull, SeriesNoteFrontmatter } from '../calibre-types';
import type { LibrosSettings } from '../../settings/settings';

/**
 * Default template for series index notes
 */
export const DEFAULT_SERIES_INDEX_TEMPLATE = `---
type: series
name: "{{ series.name | escape }}"
bookCount: {{ series.bookCount }}
authors:
{% for author in series.authors %}  - "{{ author }}"
{% endfor %}
lastSync: {{ series.lastSync }}
---

# {{ series.name }}

**Books in Series:** {{ series.bookCount }}
**Author(s):** {% for author in series.authorLinks %}{{ author }}{% unless forloop.last %}, {% endunless %}{% endfor %}

## Reading Order

{% for book in books %}
{{ book.seriesIndex }}. [[{{ book.path }}|{{ book.title }}]]{% if book.status == "completed" %} ✓{% elsif book.status == "reading" %} 📖{% endif %}

{% endfor %}

## Series Progress

{% assign completed = 0 %}{% assign reading = 0 %}{% for book in books %}{% if book.status == "completed" %}{% assign completed = completed | plus: 1 %}{% elsif book.status == "reading" %}{% assign reading = reading | plus: 1 %}{% endif %}{% endfor %}
- **Completed:** {{ completed }} / {{ series.bookCount }}
- **Currently Reading:** {{ reading }}

## Notes

`;

export class SeriesIndexGenerator {
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
   * Generate a series index note
   */
  async generateSeriesNote(
    series: CalibreSeries,
    allBooks: CalibreBookFull[],
    bookStatuses?: Map<number, { status: string; progress: number }>
  ): Promise<TFile> {
    const settings = this.getSettings();

    // Filter and sort books in this series
    const seriesBooks = allBooks
      .filter((b) => b.series?.id === series.id)
      .sort((a, b) => (a.seriesIndex ?? 0) - (b.seriesIndex ?? 0));

    if (seriesBooks.length === 0) {
      throw new Error(`No books found for series: ${series.name}`);
    }

    // Build template context
    const context = this.buildTemplateContext(series, seriesBooks, bookStatuses);

    // Render template
    const content = await this.liquid.parseAndRender(
      DEFAULT_SERIES_INDEX_TEMPLATE,
      context
    );

    // Clean up
    const cleanedContent = content.replace(/\n{3,}/g, '\n\n').trim();

    // Create or update file
    const filePath = normalizePath(
      `${settings.calibreSeriesIndexFolder}/${this.sanitizeFilename(series.name)}.md`
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
   * Generate all series index notes
   */
  async generateAllSeriesNotes(
    allSeries: CalibreSeries[],
    allBooks: CalibreBookFull[],
    bookStatuses?: Map<number, { status: string; progress: number }>
  ): Promise<TFile[]> {
    const files: TFile[] = [];

    for (const series of allSeries) {
      const seriesBooks = allBooks.filter((b) => b.series?.id === series.id);

      if (seriesBooks.length > 0) {
        try {
          const file = await this.generateSeriesNote(series, allBooks, bookStatuses);
          files.push(file);
        } catch (error) {
          console.warn(`Failed to generate series note for ${series.name}:`, error);
        }
      }
    }

    return files;
  }

  /**
   * Build template context for a series
   */
  private buildTemplateContext(
    series: CalibreSeries,
    seriesBooks: CalibreBookFull[],
    bookStatuses?: Map<number, { status: string; progress: number }>
  ): Record<string, unknown> {
    const settings = this.getSettings();

    // Collect unique authors
    const authorSet = new Set<string>();
    for (const book of seriesBooks) {
      for (const author of book.authors) {
        authorSet.add(author.name);
      }
    }
    const authors = Array.from(authorSet);

    // Build author links
    const authorLinks = authors.map(
      (name) => `[[${settings.calibreAuthorIndexFolder}/${this.sanitizeFilename(name)}|${name}]]`
    );

    // Build book list with status
    const books = seriesBooks.map((book) => {
      const status = bookStatuses?.get(book.id);
      return {
        title: book.title,
        path: `${settings.calibreBookNotesFolder}/${this.sanitizeFilename(book.title)}`,
        seriesIndex: book.seriesIndex ?? 1,
        status: status?.status ?? 'to-read',
        progress: status?.progress ?? 0,
      };
    });

    return {
      series: {
        name: series.name,
        bookCount: seriesBooks.length,
        authors,
        authorLinks,
        lastSync: new Date().toISOString(),
      },
      books,
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
