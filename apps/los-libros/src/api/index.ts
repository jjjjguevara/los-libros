/**
 * Los Libros Public API
 * @module api
 *
 * This module provides the public API for Los Libros, allowing external plugins
 * to interact with the reader, library, highlights, and other features.
 *
 * @example
 * ```typescript
 * // Access via window (for Templater/QuickAdd)
 * const api = window.LosLibros;
 *
 * // Or via plugin (recommended for Obsidian plugins)
 * const api = this.app.plugins.plugins['los-libros']?.api;
 *
 * // Connect with capabilities
 * const scopedApi = await api.connect('my-plugin', ['read-state', 'write-annotations']);
 *
 * // Subscribe to events
 * const disposable = scopedApi.events.on('highlight-created', ({ highlight }) => {
 *   console.log('New highlight:', highlight.text);
 * });
 *
 * // Create a highlight
 * const highlight = await scopedApi.commands.highlights.create(
 *   bookId,
 *   'Selected text',
 *   'epubcfi(/6/4!/4/2/1:0)',
 *   'yellow'
 * );
 *
 * // Cleanup
 * disposable.dispose();
 * ```
 */

// Re-export types
export * from './types';

// Re-export API creation
export { createAPI, API_VERSION, type APIServices, LosLibrosAPIImpl } from './api';

// Re-export utilities
export { createDisposable, combineDisposables, DisposableStore } from './disposable';
export { createReactiveSelector, createReactiveStore, createMemoizedSelector, createArraySelector, combineSelectors } from './reactive-selector';

// Re-export event system
export { TypedEventEmitter, createThrottledEmitter, createDebouncedEmitter, createRAFEmitter } from './events/emitter';
export { HookRegistry, createHookedFunction, createSyncHookedFunction } from './events/hooks';

// Re-export UI registries
export { ComponentRegistry, SortedComponentRegistry } from './ui/registry';
export { ToolbarRegistry } from './ui/toolbar';
export { SidebarRegistry } from './ui/sidebar';
export { ContextMenuRegistry, createSelectionContext } from './ui/context-menu';

// Re-export security
export {
  expandCapabilities,
  hasCapability,
  requireCapability,
  createCapabilityChecker,
  withCapability,
  withCapabilityAsync,
  ConnectionRegistry
} from './security/capabilities';
export {
  validate,
  withValidation,
  withValidationAsync,
  validatePartial,
  CreateHighlightSchema,
  UpdateHighlightSchema,
  CreateBookmarkSchema,
  UpdateBookmarkSchema,
  NavigationTargetSchema,
  NavigatorConfigSchema,
  UpdateProgressSchema
} from './security/validation';

// Re-export facades
export { createLibraryAPI, LibraryAPI } from './facades/library';
export { createHighlightsAPI, HighlightsAPI } from './facades/highlights';
export { createBookmarksAPI, BookmarksAPI } from './facades/bookmarks';
export { createReaderAPI, ReaderAPI, getReaderStateStore, readerBridge } from './facades/reader';

// Re-export OPDS support
export type {
  OPDSFeedType,
  OPDSBook,
  OPDSAuthor,
  OPDSLink,
  OPDSNavEntry,
  OPDSCatalogConfig,
} from './opds-generator';
export {
  OPDSGenerator,
  createOPDSGenerator,
  DEFAULT_OPDS_CONFIG,
} from './opds-generator';
export type {
  OPDSEntry,
  OPDSFeed,
  OPDSSource,
  AcquisitionLink,
  OPDSClientConfig,
} from './opds-feed-client';
export {
  OPDSFeedClient,
  createOPDSFeedClient,
  DEFAULT_CLIENT_CONFIG,
} from './opds-feed-client';
