/**
 * EPUB Renderer Module
 *
 * Custom EPUB renderer that replaces epub.js with:
 * - Server-based content delivery (los-libros-server)
 * - CSS multi-column pagination
 * - Continuous scroll mode
 * - SVG highlight overlay
 * - Multi-selector annotations
 * - Automatic background sync
 *
 * @example
 * ```typescript
 * import {
 *   EpubRenderer,
 *   ApiClient,
 *   createApiClient,
 *   SyncManager
 * } from './renderer';
 *
 * // Initialize API client
 * const api = createApiClient({
 *   baseUrl: 'http://localhost:3000',
 *   deviceId: 'device-123'
 * });
 *
 * // Create renderer
 * const renderer = new EpubRenderer(containerElement, api, {
 *   mode: 'paginated',
 *   fontSize: 18,
 *   theme: 'sepia'
 * });
 *
 * // Load book
 * await renderer.load(bookId);
 *
 * // Set up sync
 * const sync = new SyncManager(api, {
 *   deviceId: 'device-123',
 *   onStatusChange: (status) => console.log('Sync:', status)
 * });
 * await sync.initialize(bookId);
 *
 * // Listen for events
 * renderer.on('relocated', (location) => {
 *   sync.update('progress', bookId, location);
 * });
 * ```
 */

// Core types
export type {
  // Book types
  BookMetadata,
  Creator,
  TocEntry,
  SpineItem,
  ParsedBook,
  ChapterContent,

  // Configuration
  DisplayMode,
  ColumnLayout,
  ThemePreset,
  RendererConfig,
  ThemeColors,

  // Location and navigation
  ReadingLocation,
  NavigationTarget,

  // Annotations
  HighlightColor,
  AnnotationType,
  TextSelector,
  Annotation,
  RenderedHighlight,

  // Sync
  SyncStatus,
  SyncOperation,
  SyncConflict,
  ReadingProgress,
  PushRequest,
  PushResponse,
  PullRequest,
  PullResponse,

  // Events
  RendererEvents,
  RendererEventListener,

  // API
  ApiResponse,
} from './types';

export { DEFAULT_RENDERER_CONFIG } from './types';

// API Client
export { ApiClient, ApiError, createApiClient, getApiClient } from './api-client';
export type { ApiClientConfig } from './api-client';

// Renderer
export { EpubRenderer } from './renderer';
export type { ContentProvider } from './renderer';

// Pagination
export { Paginator } from './paginator';
export type { PageInfo, PageChangeCallback } from './paginator';

// Scrolling
export { Scroller } from './scroller';
export type { ScrollCallback } from './scroller';

// Highlights
export { HighlightOverlay } from './overlay';
export type { HighlightClickCallback } from './overlay';

// Selection
export { SelectionHandler } from './selection';
export type { SelectionData, SelectionCallback } from './selection';

// Sync
export { SyncManager } from './sync-manager';
export type { SyncManagerConfig } from './sync-manager';

// Device ID
export { getDeviceId, resetDeviceId } from './device-id';

// Reader Adapter (epub.js compatibility layer)
export { ReaderAdapter, createReaderAdapter } from './reader-adapter';

// Book Providers
export type { BookProvider, SearchResult, ProviderStatus } from './book-provider';
export { WasmBookProvider } from './wasm-provider';
export { HybridBookProvider, createHybridProvider } from './hybrid-provider';
export type { HybridProviderConfig, ProviderMode } from './hybrid-provider';
export { ProviderAdapter, createProviderAdapter } from './provider-adapter';
