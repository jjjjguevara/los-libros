/**
 * WASM Module Exports
 *
 * Provides WASM-based EPUB processing for offline support.
 */

export {
  initializeWasm,
  getProcessor,
  isWasmSupported,
  isWasmInitialized,
  cleanupWasm,
  type WasmEpubProcessor,
  type ParsedBook,
  type BookMetadata,
  type Creator,
  type SpineItem,
  type TocEntry,
  type ChapterContent,
  type CfiLocation,
  type SearchResult,
} from './wasm-adapter';
