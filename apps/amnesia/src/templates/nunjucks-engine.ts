/**
 * Nunjucks Template Engine
 *
 * Provides Nunjucks template support for custom rendering of book metadata
 * in Obsidian notes. Supports template registration, field definitions,
 * custom filters, and the {% persist %} tag for user content preservation.
 *
 * @see docs/plans/unified-sync-architecture-prd.md
 * @see docs/research/Obsidian Sync Architecture Research.md
 */

import nunjucks from 'nunjucks';
import type {
  BookMetadata,
  TemplateContext,
  FieldDefinition,
  FieldType,
  Highlight,
  BookNote,
} from '../sync/metadata/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Persist block content extracted from a rendered template
 */
export interface PersistBlock {
  key: string;
  content: string;
}

/**
 * Result of rendering with persist blocks
 */
export interface RenderResult {
  content: string;
  persistBlocks: Map<string, string>;
}

// ============================================================================
// Custom Tags
// ============================================================================

/**
 * Custom {% persist "key" %} tag implementation
 *
 * This tag allows users to write content that will be preserved across syncs.
 * When re-rendering a template, the engine will:
 * 1. Extract existing persist block content from the current file
 * 2. Re-inject that content into the newly rendered template
 *
 * Usage:
 * {% persist "myNotes" %}
 * (User can write anything here - it survives re-renders)
 * {% endpersist %}
 */
class PersistExtension implements nunjucks.Extension {
  tags: string[] = ['persist'];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parse(parser: any, nodes: any, _lexer: any): any {
    // Get the tag token
    const tok = parser.nextToken();

    // Parse the key argument
    const args = parser.parseSignature(null, true);
    parser.advanceAfterBlockEnd(tok.value);

    // Parse the body until {% endpersist %}
    const body = parser.parseUntilBlocks('endpersist');
    parser.advanceAfterBlockEnd();

    // Return a CallExtension node
    return new nodes.CallExtension(this, 'run', args, [body]);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(context: any, key: string, body: () => string): nunjucks.runtime.SafeString {
    // Check if we have preserved content for this key
    const preservedContent = context.lookup('__persistedContent') as
      | Map<string, string>
      | undefined;

    let content: string;
    if (preservedContent && preservedContent.has(key)) {
      // Use preserved content from previous render
      content = preservedContent.get(key)!;
    } else {
      // Use default content from template
      content = body();
    }

    // Wrap in persist markers for future extraction
    const output = `<!-- AMNESIA:PERSIST:${key}:START -->\n${content}\n<!-- AMNESIA:PERSIST:${key}:END -->`;

    return new nunjucks.runtime.SafeString(output);
  }
}

// ============================================================================
// Field Definitions
// ============================================================================

/**
 * Available fields for templates
 */
const FIELD_DEFINITIONS: FieldDefinition[] = [
  // Identity fields
  {
    name: 'book.title',
    label: 'Title',
    type: 'string',
    description: 'Book title',
    example: 'The Great Gatsby',
    isArray: false,
  },
  {
    name: 'book.authors',
    label: 'Authors',
    type: 'array',
    description: 'List of authors',
    example: ['F. Scott Fitzgerald'],
    isArray: true,
  },
  {
    name: 'book.bookId',
    label: 'Book ID',
    type: 'string',
    description: 'Unique book identifier',
    example: 'abc123',
    isArray: false,
  },
  {
    name: 'book.calibreId',
    label: 'Calibre ID',
    type: 'number',
    description: 'Calibre database ID',
    example: 42,
    isArray: false,
  },
  {
    name: 'book.uuid',
    label: 'UUID',
    type: 'string',
    description: 'Calibre UUID',
    example: 'abc-123-def',
    isArray: false,
  },

  // Reading state
  {
    name: 'book.progress',
    label: 'Progress',
    type: 'number',
    description: 'Reading progress (0-100)',
    example: 75,
    isArray: false,
  },
  {
    name: 'book.currentCfi',
    label: 'Current CFI',
    type: 'string',
    description: 'Current reading position',
    example: 'epubcfi(/6/4!/4)',
    isArray: false,
  },
  {
    name: 'book.status',
    label: 'Status',
    type: 'string',
    description: 'Reading status',
    example: 'reading',
    isArray: false,
  },
  {
    name: 'book.lastReadAt',
    label: 'Last Read',
    type: 'date',
    description: 'When last read',
    example: new Date(),
    isArray: false,
  },

  // User metadata
  {
    name: 'book.rating',
    label: 'Rating',
    type: 'number',
    description: 'User rating (0-5)',
    example: 4,
    isArray: false,
  },
  {
    name: 'book.tags',
    label: 'Tags',
    type: 'array',
    description: 'User tags',
    example: ['fiction', 'classic'],
    isArray: true,
  },
  {
    name: 'book.bookshelves',
    label: 'Bookshelves',
    type: 'array',
    description: 'Bookshelf assignments',
    example: ['favorites'],
    isArray: true,
  },

  // Calibre metadata
  {
    name: 'book.series',
    label: 'Series Name',
    type: 'string',
    description: 'Series name',
    example: 'The Expanse',
    isArray: false,
  },
  {
    name: 'book.seriesIndex',
    label: 'Series Index',
    type: 'number',
    description: 'Position in series',
    example: 3,
    isArray: false,
  },
  {
    name: 'book.publisher',
    label: 'Publisher',
    type: 'string',
    description: 'Publisher name',
    example: 'Penguin',
    isArray: false,
  },
  {
    name: 'book.publishedDate',
    label: 'Published Date',
    type: 'string',
    description: 'Publication date',
    example: '2020-01-15',
    isArray: false,
  },
  {
    name: 'book.description',
    label: 'Description',
    type: 'string',
    description: 'Book description/blurb',
    example: 'A story about...',
    isArray: false,
  },

  // Annotations
  {
    name: 'book.highlights',
    label: 'Highlights',
    type: 'array',
    description: 'List of highlights',
    example: [],
    isArray: true,
  },
  {
    name: 'book.notes',
    label: 'Notes',
    type: 'array',
    description: 'List of notes',
    example: [],
    isArray: true,
  },
  {
    name: 'book.bookmarks',
    label: 'Bookmarks',
    type: 'array',
    description: 'List of bookmarks',
    example: [],
    isArray: true,
  },

  // Highlight fields (for use in loops)
  {
    name: 'highlight.text',
    label: 'Highlight Text',
    type: 'string',
    description: 'Highlighted text',
    example: 'Important quote',
    isArray: false,
  },
  {
    name: 'highlight.annotation',
    label: 'Highlight Annotation',
    type: 'string',
    description: 'User annotation on highlight',
    example: 'Review this',
    isArray: false,
  },
  {
    name: 'highlight.color',
    label: 'Highlight Color',
    type: 'string',
    description: 'Highlight color',
    example: 'yellow',
    isArray: false,
  },
  {
    name: 'highlight.chapter',
    label: 'Highlight Chapter',
    type: 'string',
    description: 'Chapter name',
    example: 'Chapter 1',
    isArray: false,
  },
  {
    name: 'highlight.createdAt',
    label: 'Highlight Date',
    type: 'date',
    description: 'When created',
    example: new Date(),
    isArray: false,
  },
  {
    name: 'highlight.id',
    label: 'Highlight ID',
    type: 'string',
    description: 'Unique highlight identifier',
    example: 'hl-abc123',
    isArray: false,
  },
  {
    name: 'highlight.notePath',
    label: 'Atomic Note Path',
    type: 'string',
    description: 'Path to atomic highlight note',
    example: 'Subrayados/BookTitle/hl-abc123',
    isArray: false,
  },

  // Settings
  {
    name: 'settings.authorsFolder',
    label: 'Authors Folder',
    type: 'string',
    description: 'Folder for author notes',
    example: 'Autores',
    isArray: false,
  },
  {
    name: 'settings.seriesFolder',
    label: 'Series Folder',
    type: 'string',
    description: 'Folder for series notes',
    example: 'Series',
    isArray: false,
  },
  {
    name: 'settings.bookshelvesFolder',
    label: 'Bookshelves Folder',
    type: 'string',
    description: 'Folder for bookshelf notes',
    example: 'Estanterias',
    isArray: false,
  },

  // Calibre-specific
  {
    name: 'calibre.id',
    label: 'Calibre ID',
    type: 'number',
    description: 'Calibre database ID',
    example: 42,
    isArray: false,
  },
  {
    name: 'calibre.formats',
    label: 'Formats',
    type: 'array',
    description: 'Available file formats',
    example: ['EPUB', 'PDF'],
    isArray: true,
  },
  {
    name: 'calibre.coverPath',
    label: 'Cover Path',
    type: 'string',
    description: 'Path to cover image',
    example: 'covers/book.jpg',
    isArray: false,
  },
];

// ============================================================================
// Default Templates (Nunjucks Syntax)
// ============================================================================

/**
 * Default book note template (Nunjucks syntax)
 */
const DEFAULT_BOOK_TEMPLATE = `---
title: {{ book.title }}
author: {{ book.authors | join(", ") }}
{%- if book.rating %}
rating: {{ book.rating }}
{%- endif %}
{%- if book.series %}
series: "[[{{ settings.seriesFolder }}/{{ book.series }}|{{ book.series }}]]"
seriesIndex: {{ book.seriesIndex }}
{%- endif %}
{%- if book.tags and book.tags.length > 0 %}
bookshelves:
{%- for tag in book.tags %}
  - "[[{{ settings.bookshelvesFolder }}/{{ tag }}|{{ tag }}]]"
{%- endfor %}
{%- endif %}
progress: {{ book.progress | default(0) }}%
status: {{ book.status | default("unread") }}
{%- if book.lastReadAt %}
lastRead: {{ book.lastReadAt | date("%Y-%m-%d") }}
{%- endif %}
calibreId: {{ book.calibreId }}
---

# {{ book.title }}

{% if book.description -%}
## Description

{{ book.description }}
{% endif %}

{% if book.highlights and book.highlights.length > 0 -%}
## Highlights

{% for h in book.highlights -%}
> {{ h.text }} %% amnesia:{{ h.id }} %%
{%- if h.annotation %}
> — *{{ h.annotation }}*
{%- endif %} ({{ h.createdAt | date("%b %d, %Y") }})

{% endfor %}
{% endif %}

{% persist "userNotes" %}
## My Notes

(Write your personal notes here - they will be preserved during sync)
{% endpersist %}
`;

/**
 * Default hub highlights template (Nunjucks syntax)
 */
const DEFAULT_HUB_HIGHLIGHTS_TEMPLATE = `---
title: "Highlights: {{ book.title }}"
bookId: {{ book.bookId }}
type: highlight-hub
syncedHighlightIds:
{%- for h in highlights %}
  - "{{ h.id }}"
{%- endfor %}
---

# Highlights from {{ book.title }}

{% for h in highlights -%}
> {{ h.text }} %% amnesia:{{ h.id }} %%
{%- if h.annotation %}
> — *{{ h.annotation }}*
{%- endif %}
{%- if h.notePath %}
[[{{ h.notePath }}|View atomic note]]
{%- endif %}

{% endfor %}

{% persist "synthesis" %}
## Synthesis

(Add your synthesis and connections here)
{% endpersist %}
`;

/**
 * Default atomic highlight template (Nunjucks syntax)
 */
const DEFAULT_ATOMIC_HIGHLIGHT_TEMPLATE = `---
title: "{{ highlight.text | truncate(50) }}"
bookId: {{ book.bookId }}
highlightId: {{ highlight.id }}
type: atomic-highlight
color: {{ highlight.color }}
chapter: "{{ highlight.chapter }}"
createdAt: {{ highlight.createdAt | date("%Y-%m-%d") }}
---

# Highlight

> {{ highlight.text }}

{%- if highlight.annotation %}

## Annotation

{{ highlight.annotation }}
{% endif %}

## Source

From **[[{{ book.notePath }}|{{ book.title }}]]**
{%- if highlight.chapter %} - {{ highlight.chapter }}{% endif %}

{% persist "thoughts" %}
## My Thoughts

(Write your extended thoughts here)
{% endpersist %}
`;

// ============================================================================
// Nunjucks Template Service
// ============================================================================

/**
 * Service for rendering book metadata using Nunjucks templates
 */
export class NunjucksTemplateService {
  private env: nunjucks.Environment;
  private templates: Map<string, string>;

  constructor() {
    // Create Nunjucks environment (no file system access in browser)
    this.env = new nunjucks.Environment(null, {
      autoescape: false, // Markdown doesn't need HTML escaping
      trimBlocks: true,
      lstripBlocks: true,
    });

    this.templates = new Map();

    // Add custom extension for persist blocks
    this.env.addExtension('PersistExtension', new PersistExtension());

    // Register custom filters
    this.registerBuiltInFilters();

    // Register default templates
    this.registerTemplate('bookNote', DEFAULT_BOOK_TEMPLATE);
    this.registerTemplate('hubHighlights', DEFAULT_HUB_HIGHLIGHTS_TEMPLATE);
    this.registerTemplate('atomicHighlight', DEFAULT_ATOMIC_HIGHLIGHT_TEMPLATE);
  }

  // ==========================================================================
  // Filter Registration
  // ==========================================================================

  /**
   * Register built-in filters for Obsidian/Markdown
   */
  private registerBuiltInFilters(): void {
    // Wikilink filter: {{ value | wikilink("Folder") }} => [[Folder/value|value]]
    this.env.addFilter('wikilink', (value: unknown, folder?: string) => {
      const text = String(value);
      if (folder) {
        return `[[${folder}/${text}|${text}]]`;
      }
      return `[[${text}]]`;
    });

    // Slugify filter: {{ value | slugify }} => "hello-world"
    this.env.addFilter('slugify', (value: unknown) => {
      return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    });

    // Stars filter: {{ rating | stars }} => "★★★★☆"
    this.env.addFilter('stars', (value: unknown) => {
      const rating = Math.round(Number(value) || 0);
      return '★'.repeat(Math.min(rating, 5)) + '☆'.repeat(Math.max(5 - rating, 0));
    });

    // Date filter: {{ date | date("%Y-%m-%d") }}
    this.env.addFilter('date', (value: unknown, format?: string) => {
      const date = value instanceof Date ? value : new Date(String(value));
      if (isNaN(date.getTime())) return String(value);

      const fmt = format || '%Y-%m-%d';
      return fmt
        .replace(/%Y/g, String(date.getFullYear()))
        .replace(/%m/g, String(date.getMonth() + 1).padStart(2, '0'))
        .replace(/%d/g, String(date.getDate()).padStart(2, '0'))
        .replace(/%H/g, String(date.getHours()).padStart(2, '0'))
        .replace(/%M/g, String(date.getMinutes()).padStart(2, '0'))
        .replace(/%S/g, String(date.getSeconds()).padStart(2, '0'))
        .replace(/%b/g, date.toLocaleString('en', { month: 'short' }))
        .replace(/%B/g, date.toLocaleString('en', { month: 'long' }));
    });

    // Truncate with ellipsis
    this.env.addFilter('truncate', (value: unknown, length?: number) => {
      const str = String(value);
      const len = length || 50;
      if (str.length <= len) return str;
      return str.slice(0, len) + '...';
    });

    // Markdown escape (for use in YAML)
    this.env.addFilter('mdEscape', (value: unknown) => {
      return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n');
    });

    // Safe ID for use in comments
    this.env.addFilter('safeId', (value: unknown) => {
      return String(value).replace(/[^a-zA-Z0-9-_]/g, '');
    });
  }

  /**
   * Add a custom filter
   */
  addFilter(name: string, fn: (...args: unknown[]) => unknown): void {
    this.env.addFilter(name, fn);
  }

  // ==========================================================================
  // Template Management
  // ==========================================================================

  /**
   * Register a named template
   */
  registerTemplate(name: string, template: string): void {
    this.templates.set(name, template);
  }

  /**
   * Get a registered template
   */
  getTemplate(name: string): string | null {
    return this.templates.get(name) || null;
  }

  /**
   * Delete a registered template
   */
  deleteTemplate(name: string): boolean {
    return this.templates.delete(name);
  }

  /**
   * List all registered template names
   */
  listTemplates(): string[] {
    return Array.from(this.templates.keys());
  }

  // ==========================================================================
  // Persist Block Extraction
  // ==========================================================================

  /**
   * Extract persist blocks from existing content
   */
  extractPersistBlocks(content: string): Map<string, string> {
    const blocks = new Map<string, string>();
    const regex = /<!-- AMNESIA:PERSIST:(.+?):START -->\n([\s\S]*?)\n<!-- AMNESIA:PERSIST:\1:END -->/g;

    let match;
    while ((match = regex.exec(content)) !== null) {
      blocks.set(match[1], match[2]);
    }

    return blocks;
  }

  // ==========================================================================
  // Rendering
  // ==========================================================================

  /**
   * Render a template with context
   */
  render(template: string, context: Record<string, unknown>): string {
    return this.env.renderString(template, context);
  }

  /**
   * Render a template, preserving persist blocks from existing content
   */
  renderWithPersist(
    template: string,
    context: Record<string, unknown>,
    existingContent?: string
  ): string {
    // Extract persist blocks from existing content
    const persistedContent = existingContent
      ? this.extractPersistBlocks(existingContent)
      : new Map<string, string>();

    // Add persisted content to context
    const fullContext = {
      ...context,
      __persistedContent: persistedContent,
    };

    return this.env.renderString(template, fullContext);
  }

  /**
   * Render a book note using a named template
   */
  renderBookNote(book: BookMetadata, templateName?: string): string {
    const template = templateName
      ? this.templates.get(templateName) || DEFAULT_BOOK_TEMPLATE
      : DEFAULT_BOOK_TEMPLATE;

    const context = this.buildContext(book);
    return this.render(template, context as unknown as Record<string, unknown>);
  }

  /**
   * Render with custom template string
   */
  renderWithTemplate(book: BookMetadata, template: string): string {
    const context = this.buildContext(book);
    return this.render(template, context as unknown as Record<string, unknown>);
  }

  /**
   * Render a single field
   */
  renderField(field: string, value: unknown, template?: string): string {
    if (!template) {
      if (Array.isArray(value)) {
        return value.map(String).join(', ');
      }
      if (value instanceof Date) {
        return value.toISOString().split('T')[0];
      }
      return String(value ?? '');
    }

    return this.render(template, { value });
  }

  /**
   * Render highlights section
   */
  renderHighlights(highlights: Highlight[], template?: string): string {
    const defaultTemplate = `{% for h in highlights -%}
> {{ h.text }} %% amnesia:{{ h.id }} %%
{%- if h.annotation %}
> — *{{ h.annotation }}*
{%- endif %}

{% endfor %}`;

    return this.render(template || defaultTemplate, { highlights });
  }

  /**
   * Render notes section
   */
  renderNotes(notes: BookNote[], template?: string): string {
    const defaultTemplate = `{% for n in notes -%}
### {{ n.chapter | default("Note") }}

{{ n.content }}

{% endfor %}`;

    return this.render(template || defaultTemplate, { notes });
  }

  // ==========================================================================
  // Schema Access
  // ==========================================================================

  /**
   * Get available fields for template editor
   */
  getAvailableFields(): FieldDefinition[] {
    return [...FIELD_DEFINITIONS];
  }

  /**
   * Get field type by name
   */
  getFieldType(field: string): FieldType | null {
    const def = FIELD_DEFINITIONS.find((f) => f.name === field);
    return def?.type || null;
  }

  /**
   * Get field definition
   */
  getFieldDefinition(field: string): FieldDefinition | null {
    return FIELD_DEFINITIONS.find((f) => f.name === field) || null;
  }

  /**
   * Get available filters
   */
  getAvailableFilters(): string[] {
    return [
      // Built-in Nunjucks filters
      'abs',
      'capitalize',
      'default',
      'escape',
      'first',
      'join',
      'last',
      'length',
      'lower',
      'replace',
      'reverse',
      'round',
      'sort',
      'string',
      'title',
      'trim',
      'upper',
      // Custom filters
      'wikilink',
      'slugify',
      'stars',
      'date',
      'truncate',
      'mdEscape',
      'safeId',
    ];
  }

  // ==========================================================================
  // Context Building
  // ==========================================================================

  /**
   * Build template context from book metadata
   */
  private buildContext(book: BookMetadata): TemplateContext {
    return {
      book,
      highlights: book.highlights || [],
      notes: book.notes || [],
      calibre: book.calibreId
        ? {
            id: book.calibreId,
            formats: [],
            coverPath: undefined,
          }
        : undefined,
      settings: {
        authorsFolder: 'Autores',
        seriesFolder: 'Series',
        bookshelvesFolder: 'Estanterias',
      },
      helpers: {
        formatDate: (date: Date, format: string) => {
          return this.env.getFilter('date')(date, format);
        },
        wikilink: (text: string, folder?: string) => {
          if (folder) {
            return `[[${folder}/${text}|${text}]]`;
          }
          return `[[${text}]]`;
        },
        slugify: (text: string) => {
          return text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        },
      },
    };
  }

  // ==========================================================================
  // Template Validation
  // ==========================================================================

  /**
   * Validate a template for syntax errors
   */
  validateTemplate(template: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      // Check for balanced tags
      const ifCount = (template.match(/\{%\s*if\s/g) || []).length;
      const endifCount = (template.match(/\{%\s*endif\s*%\}/g) || []).length;
      if (ifCount !== endifCount) {
        errors.push(`Unbalanced if/endif: ${ifCount} if, ${endifCount} endif`);
      }

      const forCount = (template.match(/\{%\s*for\s/g) || []).length;
      const endforCount = (template.match(/\{%\s*endfor\s*%\}/g) || []).length;
      if (forCount !== endforCount) {
        errors.push(`Unbalanced for/endfor: ${forCount} for, ${endforCount} endfor`);
      }

      const persistCount = (template.match(/\{%\s*persist\s/g) || []).length;
      const endpersistCount = (template.match(/\{%\s*endpersist\s*%\}/g) || []).length;
      if (persistCount !== endpersistCount) {
        errors.push(`Unbalanced persist/endpersist: ${persistCount} persist, ${endpersistCount} endpersist`);
      }

      // Try to compile the template
      this.env.renderString(template, {});

      // Try a test render with mock data
      const mockBook: BookMetadata = {
        bookId: 'test',
        title: 'Test Book',
        authors: ['Test Author'],
        progress: 50,
        status: 'reading',
        highlights: [],
        notes: [],
        bookmarks: [],
        tags: ['test'],
        bookshelves: [],
        timestamps: {},
      };

      this.renderWithTemplate(mockBook, template);
    } catch (e) {
      errors.push(`Parse error: ${e instanceof Error ? e.message : String(e)}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new Nunjucks template service instance
 */
export function createNunjucksTemplateService(): NunjucksTemplateService {
  return new NunjucksTemplateService();
}

/**
 * Export default templates for reference
 */
export {
  DEFAULT_BOOK_TEMPLATE,
  DEFAULT_HUB_HIGHLIGHTS_TEMPLATE,
  DEFAULT_ATOMIC_HIGHLIGHT_TEMPLATE,
};
