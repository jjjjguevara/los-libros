/**
 * Unified Document Module
 *
 * Exports the unified document handling infrastructure for PDF and EPUB.
 *
 * Components:
 * - DocumentBridge: Main thread bridge to WASM worker
 * - HybridDocumentProvider: Unified provider with server/WASM fallback
 * - Types: Shared type definitions
 */

// Re-export from document worker types
export type {
  DocumentFormat,
  DocumentMetadata,
  TocEntry,
  ParsedDocument,
  CharPosition,
  TextItem,
  StructuredText,
  SearchResult,
  DocumentWorkerRequest,
  DocumentWorkerResponse,
} from '../document-worker';

// Re-export from document bridge
export {
  DocumentBridge,
  getSharedDocumentBridge,
  destroySharedDocumentBridge,
  setDocumentPluginPath,
} from '../document-bridge';

// Re-export from hybrid document provider
export {
  HybridDocumentProvider,
  createHybridDocumentProvider,
  destroySharedResources,
  type ProviderMode,
  type HybridDocumentProviderConfig,
  type ProviderStatus,
  type RenderOptions,
  type TileRenderOptions,
} from '../hybrid-document-provider';
