/**
 * LiquidJS engine wrapper for Los Libros
 */
import { Liquid } from 'liquidjs';
import type { Book, Highlight } from '../library/types';

export interface BookNoteContext extends Record<string, unknown> {
  book: {
    title: string;
    author: string;
    status: string;
    progress: number;
    isbn?: string;
    publisher?: string;
    language?: string;
    description?: string;
    coverUrl?: string;
    started?: string;
    completed?: string;
    lastRead?: string;
    highlightCount: number;
  };
  highlights: Array<{
    text: string;
    annotation?: string;
    color: string;
    chapter?: string;
    pagePercent?: number;
    cfi: string;
    createdAt: string;
  }>;
}

export interface HighlightNoteContext extends Record<string, unknown> {
  book: {
    title: string;
    author: string;
  };
  highlight: {
    text: string;
    annotation?: string;
    color: string;
    chapter?: string;
    pagePercent?: number;
    cfi: string;
    createdAt: string;
  };
}

export class LiquidEngine {
  private engine: Liquid;

  constructor() {
    this.engine = new Liquid({
      strictFilters: false,
      strictVariables: false,
      trimTagLeft: false,
      trimTagRight: false,
      trimOutputLeft: false,
      trimOutputRight: false,
    });

    // Register custom filters
    this.registerCustomFilters();
  }

  private registerCustomFilters(): void {
    // Capitalize filter (if not already available)
    this.engine.registerFilter('capitalize', (str: string) => {
      if (typeof str !== 'string') return str;
      return str.charAt(0).toUpperCase() + str.slice(1);
    });

    // Date formatting
    this.engine.registerFilter('date_pretty', (date: string | Date) => {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    });

    // Truncate filter
    this.engine.registerFilter('truncate_words', (str: string, count: number = 50) => {
      if (typeof str !== 'string') return str;
      const words = str.split(/\s+/);
      if (words.length <= count) return str;
      return words.slice(0, count).join(' ') + '...';
    });

    // Slug filter for filenames
    this.engine.registerFilter('slugify', (str: string) => {
      if (typeof str !== 'string') return str;
      return str
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
    });

    // Wikilink filter
    this.engine.registerFilter('wikilink', (str: string) => {
      if (typeof str !== 'string') return str;
      return `[[${str}]]`;
    });
  }

  /**
   * Render a template with the given context
   */
  async render(template: string, context: Record<string, unknown>): Promise<string> {
    try {
      return await this.engine.parseAndRender(template, context);
    } catch (error) {
      console.error('Template render error:', error);
      throw new Error(`Failed to render template: ${error}`);
    }
  }

  /**
   * Convert a Book to BookNoteContext
   */
  static bookToContext(book: Book, highlights: Highlight[] = []): BookNoteContext {
    return {
      book: {
        title: book.title,
        author: book.author ?? 'Unknown',
        status: book.status,
        progress: book.progress,
        isbn: book.isbn,
        publisher: book.publisher,
        language: book.language,
        description: book.description,
        coverUrl: book.coverUrl,
        started: book.lastRead?.toISOString().split('T')[0],
        completed: book.completedAt?.toISOString().split('T')[0],
        lastRead: book.lastRead?.toISOString().split('T')[0],
        highlightCount: book.highlightCount,
      },
      highlights: highlights.map(h => ({
        text: h.text,
        annotation: h.annotation,
        color: h.color,
        chapter: h.chapter,
        pagePercent: h.pagePercent,
        cfi: h.cfi,
        createdAt: h.createdAt.toISOString().split('T')[0],
      })),
    };
  }

  /**
   * Convert a Highlight to HighlightNoteContext
   */
  static highlightToContext(book: Book, highlight: Highlight): HighlightNoteContext {
    return {
      book: {
        title: book.title,
        author: book.author ?? 'Unknown',
      },
      highlight: {
        text: highlight.text,
        annotation: highlight.annotation,
        color: highlight.color,
        chapter: highlight.chapter,
        pagePercent: highlight.pagePercent,
        cfi: highlight.cfi,
        createdAt: highlight.createdAt.toISOString().split('T')[0],
      },
    };
  }

  /**
   * Validate a template without rendering
   */
  async validate(template: string): Promise<{ valid: boolean; error?: string }> {
    try {
      this.engine.parse(template);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
