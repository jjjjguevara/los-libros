/**
 * Offline Module
 *
 * Provides hybrid offline support for the EPUB reader:
 * - Network status monitoring
 * - Download for offline reading
 * - Background sync for annotations
 *
 * @module offline
 * @see docs/specifications/file-system-architecture.md
 */

// ============================================================================
// Network Monitor
// ============================================================================

export type {
  NetworkStatus,
  ConnectionQuality,
  ServerStatus,
  NetworkState,
  NetworkEvents,
  NetworkEventListener,
  NetworkMonitorConfig,
} from './network-monitor';

export {
  NetworkMonitor,
  getNetworkMonitor,
  createNetworkMonitor,
  DEFAULT_NETWORK_CONFIG,
} from './network-monitor';

// ============================================================================
// Offline Manager
// ============================================================================

export type {
  OfflineBook,
  DownloadStatus,
  DownloadProgress,
  DownloadEvents,
  DownloadEventListener,
  BookManifest,
  ResourceInfo,
  OfflineManagerConfig,
} from './offline-manager';

export {
  OfflineManager,
  createOfflineManager,
  DEFAULT_OFFLINE_CONFIG,
} from './offline-manager';

// ============================================================================
// Sync Manager
// ============================================================================

export type {
  SyncItemType,
  SyncOperation,
  SyncItemStatus,
  SyncItem,
  SyncResult,
  SyncEvents,
  SyncEventListener,
  ConflictStrategy,
  SyncProvider,
  SyncPushResult,
  SyncManagerConfig,
} from './sync-manager';

export {
  SyncManager,
  getSyncManager,
  createSyncManager,
  DEFAULT_SYNC_CONFIG,
} from './sync-manager';

// ============================================================================
// Offline Books View
// ============================================================================

export { OfflineBooksView, OFFLINE_BOOKS_VIEW_TYPE } from './offline-books-view';
