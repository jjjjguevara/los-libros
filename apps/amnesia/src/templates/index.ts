/**
 * Templates module exports
 */

// Core types
export type {
  TemplateConfig,
  TemplateSettings,
  TemplateVariable,
} from './template-types';

export { TEMPLATE_VARIABLES, formatVariablesDescription } from './template-types';

// Default templates
export {
  DEFAULT_TEMPLATE_SETTINGS,
  DEFAULT_BOOK_NOTE_TEMPLATE,
  DEFAULT_HUB_HIGHLIGHTS_TEMPLATE,
  DEFAULT_HUB_NOTES_TEMPLATE,
  DEFAULT_ATOMIC_HIGHLIGHT_TEMPLATE,
  DEFAULT_ATOMIC_NOTE_TEMPLATE,
  DEFAULT_AUTHOR_INDEX_TEMPLATE,
  DEFAULT_SERIES_INDEX_TEMPLATE,
  DEFAULT_SHELF_INDEX_TEMPLATE,
  DEFAULT_HIGHLIGHT_NOTE_TEMPLATE,
  DEFAULT_READING_SESSION_TEMPLATE,
} from './default-templates';

// Engines
export { LiquidEngine } from './liquid-engine';

// Generators
export { NoteGenerator } from './note-generator';
export {
  UnifiedNoteGenerator,
  type HighlightData,
  type NoteData,
  type AuthorWithBooks,
  type SeriesWithBooks,
  type ShelfWithBooks,
  type GenerationResult,
} from './unified-note-generator';
