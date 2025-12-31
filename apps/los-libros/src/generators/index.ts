/**
 * Generators Module
 *
 * Exports all note generators for the unified template system.
 */

// Book note generator
export {
  BookNoteGenerator,
  type BookNoteGeneratorOptions,
} from './book-note-generator';

// Highlight generator (hub + atomic)
export {
  HighlightGenerator,
  type HighlightGeneratorOptions,
  type HighlightGenerationResult,
} from './highlight-generator';

// Index generators (author/series/shelf)
export {
  IndexGenerator,
  type IndexGeneratorOptions,
  type IndexGenerationResult,
} from './index-generator';
