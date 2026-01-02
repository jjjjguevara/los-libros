/**
 * Templater Helper Functions
 * Accessible via tp.user.losLibros or window.LosLibros.helpers
 * @module api/helpers/templater
 */

import type { Book, Highlight, Locator, PendingSelection } from '../types';

/**
 * Citation style formats
 */
export type CitationStyle = 'apa' | 'mla' | 'chicago' | 'bibtex';

/**
 * Templater-friendly helper functions
 * These are designed to work well with Templater's template syntax
 */
export interface TemplaterHelpers {
  /**
   * Get current book (if reader is open)
   */
  getCurrentBook(): Book | null;

  /**
   * Get current reading location
   */
  getCurrentLocation(): Locator | null;

  /**
   * Get current text selection
   */
  getCurrentSelection(): PendingSelection | null;

  /**
   * Format a citation for the current book
   */
  formatCitation(style?: CitationStyle): string;

  /**
   * Get book by ID or title
   */
  getBook(idOrTitle: string): Book | null;

  /**
   * Get all highlights for current/specified book
   */
  getHighlights(bookId?: string): Highlight[];

  /**
   * Get a random highlight
   */
  getRandomHighlight(bookId?: string): Highlight | null;

  /**
   * Format book metadata using a format string
   */
  formatMetadata(format: string): string;

  /**
   * Prompt user to select a book (requires UI interaction)
   */
  promptBook(): Promise<Book | null>;

  /**
   * Prompt user to select a highlight (requires UI interaction)
   */
  promptHighlight(bookId?: string): Promise<Highlight | null>;
}

/**
 * Create Templater helpers
 * These are stub implementations - they will be connected to the real API
 */
export function createTemplaterHelpers(getApi: () => any): TemplaterHelpers {
  return {
    getCurrentBook(): Book | null {
      const api = getApi();
      if (!api) return null;

      const bookId = api.commands?.reader?.getCurrentBookId?.();
      if (!bookId) return null;

      return api.commands?.library?.getBook?.(bookId) ?? null;
    },

    getCurrentLocation(): Locator | null {
      const api = getApi();
      if (!api) return null;

      return api.commands?.reader?.getCurrentLocation?.() ?? null;
    },

    getCurrentSelection(): PendingSelection | null {
      // This would need to be connected to the reader's selection state
      return null;
    },

    formatCitation(style: CitationStyle = 'apa'): string {
      const book = this.getCurrentBook();
      if (!book) return '';

      const year = book.metadata?.publishDate
        ? new Date(book.metadata.publishDate).getFullYear()
        : 'n.d.';

      switch (style) {
        case 'apa':
          return `${book.author} (${year}). *${book.title}*.`;

        case 'mla':
          return `${book.author}. *${book.title}*. ${year}.`;

        case 'chicago':
          return `${book.author}. *${book.title}*. ${year}.`;

        case 'bibtex':
          const id = book.id.replace(/[^a-zA-Z0-9]/g, '');
          return `@book{${id},
  author = {${book.author}},
  title = {${book.title}},
  year = {${year}}
}`;

        default:
          return `${book.author}. ${book.title}. ${year}.`;
      }
    },

    getBook(idOrTitle: string): Book | null {
      const api = getApi();
      if (!api) return null;

      // Try by ID first
      const byId = api.commands?.library?.getBook?.(idOrTitle);
      if (byId) return byId;

      // Search by title
      const results = api.commands?.library?.search?.(idOrTitle) ?? [];
      return results[0] ?? null;
    },

    getHighlights(bookId?: string): Highlight[] {
      const api = getApi();
      if (!api) return [];

      const targetBookId = bookId ?? api.commands?.reader?.getCurrentBookId?.();
      if (!targetBookId) return [];

      return api.commands?.highlights?.getHighlights?.(targetBookId) ?? [];
    },

    getRandomHighlight(bookId?: string): Highlight | null {
      const highlights = this.getHighlights(bookId);
      if (highlights.length === 0) return null;

      const randomIndex = Math.floor(Math.random() * highlights.length);
      return highlights[randomIndex];
    },

    formatMetadata(format: string): string {
      const book = this.getCurrentBook();
      if (!book) return '';

      return format
        .replace(/\{\{title\}\}/g, book.title)
        .replace(/\{\{author\}\}/g, book.author)
        .replace(/\{\{progress\}\}/g, String(book.progress))
        .replace(/\{\{status\}\}/g, book.status)
        .replace(/\{\{id\}\}/g, book.id);
    },

    async promptBook(): Promise<Book | null> {
      // This would need to show a modal - stub for now
      console.warn('promptBook() requires UI integration - not yet implemented');
      return null;
    },

    async promptHighlight(bookId?: string): Promise<Highlight | null> {
      // This would need to show a modal - stub for now
      console.warn('promptHighlight() requires UI integration - not yet implemented');
      return null;
    }
  };
}
