/**
 * Template Types
 *
 * Defines the template settings structure for all note types.
 * Follows the Doc Doctor plugin pattern for template management.
 */

/**
 * Template configuration for a single note type
 */
export interface TemplateConfig {
  /** Whether this template type is enabled */
  enabled: boolean;

  /** The Liquid template content */
  template: string;

  /** Target folder for generated notes */
  folder: string;

  /** Optional: path to vault file that overrides settings template */
  vaultTemplatePath?: string;
}

/**
 * All template configurations
 */
export interface TemplateSettings {
  /** Book metadata note */
  bookNote: TemplateConfig;

  /** Hub note aggregating highlights for a book */
  hubHighlights: TemplateConfig;

  /** Hub note aggregating user notes for a book */
  hubNotes: TemplateConfig;

  /** Individual highlight note */
  atomicHighlight: TemplateConfig;

  /** Individual user note */
  atomicNote: TemplateConfig;

  /** Author index note */
  authorIndex: TemplateConfig;

  /** Series index note */
  seriesIndex: TemplateConfig;

  /** Shelf/tag index note */
  shelfIndex: TemplateConfig;
}

/**
 * Template variable definition
 */
export interface TemplateVariable {
  /** Variable name (without braces) */
  name: string;

  /** Description of the variable */
  description: string;

  /** Example value */
  example?: string;
}

/**
 * Template variable groups by template type
 */
export const TEMPLATE_VARIABLES: Record<keyof TemplateSettings, TemplateVariable[]> = {
  bookNote: [
    { name: 'book.id', description: 'Unique book ID', example: 'uuid-123' },
    { name: 'book.title', description: 'Book title', example: 'The Great Gatsby' },
    { name: 'book.titleSort', description: 'Sortable title', example: 'Great Gatsby, The' },
    { name: 'book.author', description: 'Primary author name', example: 'F. Scott Fitzgerald' },
    { name: 'book.authorSort', description: 'Sortable author name', example: 'Fitzgerald, F. Scott' },
    { name: 'book.authorLink', description: 'Wikilink to author note', example: '[[Autores/F. Scott Fitzgerald]]' },
    { name: 'book.authors', description: 'All authors (array)', example: '[{name, sortName, link}]' },
    { name: 'book.series', description: 'Series name', example: 'The Expanse' },
    { name: 'book.seriesIndex', description: 'Position in series', example: '3' },
    { name: 'book.seriesLink', description: 'Wikilink to series note', example: '[[Series/The Expanse]]' },
    { name: 'book.description', description: 'Book description/summary' },
    { name: 'book.publisher', description: 'Publisher name' },
    { name: 'book.publishedDate', description: 'Publication date' },
    { name: 'book.language', description: 'Language code', example: 'en' },
    { name: 'book.isbn', description: 'ISBN identifier' },
    { name: 'book.tags', description: 'Tags array', example: '[fiction, classic]' },
    { name: 'book.rating', description: 'User rating (1-5)' },
    { name: 'book.status', description: 'Reading status', example: 'reading' },
    { name: 'book.progress', description: 'Reading progress (0-100)', example: '45' },
    { name: 'book.coverPath', description: 'Path to cover image' },
    { name: 'book.coverUrl', description: 'URL to cover image' },
    { name: 'book.florilegioPath', description: 'Path to florilegio folder' },
    { name: 'book.calibreId', description: 'Calibre book ID' },
    { name: 'book.calibreUuid', description: 'Calibre UUID' },
    { name: 'book.epubPath', description: 'Path to EPUB file' },
    { name: 'book.sources', description: 'Array of book sources' },
    { name: 'date.now', description: 'Current date/time' },
    { name: 'date.today', description: 'Today\'s date', example: '2024-12-27' },
  ],

  hubHighlights: [
    { name: 'book.title', description: 'Book title' },
    { name: 'book.author', description: 'Primary author' },
    { name: 'book.notePath', description: 'Path to book note' },
    { name: 'highlights', description: 'Array of all highlights' },
    { name: 'highlights.length', description: 'Number of highlights' },
    { name: 'highlight.text', description: 'Highlighted text (in loop)' },
    { name: 'highlight.annotation', description: 'User annotation (in loop)' },
    { name: 'highlight.chapter', description: 'Chapter name (in loop)' },
    { name: 'highlight.color', description: 'Highlight color (in loop)' },
    { name: 'highlight.cfi', description: 'CFI location (in loop)' },
    { name: 'highlight.createdAt', description: 'Creation date (in loop)' },
  ],

  hubNotes: [
    { name: 'book.title', description: 'Book title' },
    { name: 'book.author', description: 'Primary author' },
    { name: 'book.notePath', description: 'Path to book note' },
    { name: 'notes', description: 'Array of all notes' },
    { name: 'notes.length', description: 'Number of notes' },
    { name: 'note.content', description: 'Note content (in loop)' },
    { name: 'note.chapter', description: 'Chapter name (in loop)' },
    { name: 'note.cfi', description: 'CFI location (in loop)' },
    { name: 'note.createdAt', description: 'Creation date (in loop)' },
  ],

  atomicHighlight: [
    { name: 'highlight.text', description: 'Highlighted text' },
    { name: 'highlight.annotation', description: 'User annotation' },
    { name: 'highlight.chapter', description: 'Chapter name' },
    { name: 'highlight.color', description: 'Highlight color' },
    { name: 'highlight.cfi', description: 'CFI location' },
    { name: 'highlight.createdAt', description: 'Creation date' },
    { name: 'book.title', description: 'Book title' },
    { name: 'book.author', description: 'Primary author' },
    { name: 'book.notePath', description: 'Path to book note' },
  ],

  atomicNote: [
    { name: 'note.content', description: 'Note content' },
    { name: 'note.chapter', description: 'Chapter name' },
    { name: 'note.cfi', description: 'CFI location' },
    { name: 'note.createdAt', description: 'Creation date' },
    { name: 'book.title', description: 'Book title' },
    { name: 'book.author', description: 'Primary author' },
    { name: 'book.notePath', description: 'Path to book note' },
  ],

  authorIndex: [
    { name: 'author.name', description: 'Author name' },
    { name: 'author.sortName', description: 'Sortable name' },
    { name: 'author.books', description: 'Array of books by author' },
    { name: 'author.bookCount', description: 'Number of books' },
    { name: 'book.title', description: 'Book title (in loop)' },
    { name: 'book.notePath', description: 'Path to book note (in loop)' },
    { name: 'book.status', description: 'Reading status (in loop)' },
  ],

  seriesIndex: [
    { name: 'series.name', description: 'Series name' },
    { name: 'series.books', description: 'Array of books in series' },
    { name: 'series.bookCount', description: 'Number of books' },
    { name: 'book.title', description: 'Book title (in loop)' },
    { name: 'book.seriesIndex', description: 'Position in series (in loop)' },
    { name: 'book.notePath', description: 'Path to book note (in loop)' },
    { name: 'book.status', description: 'Reading status (in loop)' },
  ],

  shelfIndex: [
    { name: 'shelf.name', description: 'Shelf/tag name' },
    { name: 'shelf.books', description: 'Array of books on shelf' },
    { name: 'shelf.bookCount', description: 'Number of books' },
    { name: 'book.title', description: 'Book title (in loop)' },
    { name: 'book.author', description: 'Author (in loop)' },
    { name: 'book.notePath', description: 'Path to book note (in loop)' },
    { name: 'book.status', description: 'Reading status (in loop)' },
  ],
};

/**
 * Format variables for display in settings description
 */
export function formatVariablesDescription(templateType: keyof TemplateSettings): string {
  const variables = TEMPLATE_VARIABLES[templateType];
  const topVariables = variables.slice(0, 6);
  return topVariables.map(v => `{{${v.name}}}`).join(', ') + (variables.length > 6 ? ', ...' : '');
}

/**
 * Get all variable names for a template type
 */
export function getVariableNames(templateType: keyof TemplateSettings): string[] {
  return TEMPLATE_VARIABLES[templateType].map(v => v.name);
}
