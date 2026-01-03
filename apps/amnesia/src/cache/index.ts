/**
 * Cache Module
 *
 * Tiered caching system for EPUB resources with:
 * - L1: In-memory LRU cache (fast, limited)
 * - L2: IndexedDB persistent storage (slower, larger)
 * - L3: Remote provider (server/WASM)
 *
 * @module cache
 * @see docs/specifications/file-system-architecture.md
 */

// ============================================================================
// LRU Cache (L1)
// ============================================================================

export type {
  CacheEntry,
  LRUCacheConfig,
  CacheStats,
  BinaryCacheEntry,
} from './lru-cache';

export {
  LRUCache,
  BinaryCache,
  createLRUCache,
  createBinaryCache,
  DEFAULT_LRU_CONFIG,
} from './lru-cache';

// ============================================================================
// IndexedDB Store (L2)
// ============================================================================

export type {
  StoredEntry,
  IndexedDBStoreConfig,
  StoreStats,
} from './indexed-db-store';

export {
  IndexedDBStore,
  getIndexedDBStore,
  createIndexedDBStore,
  DEFAULT_IDB_CONFIG,
} from './indexed-db-store';

// ============================================================================
// Tiered Cache
// ============================================================================

export type {
  CachedResource,
  RemoteProvider,
  TieredCacheConfig,
  TieredCacheStats,
} from './tiered-cache';

export {
  TieredCache,
  getTieredCache,
  createTieredCache,
  DEFAULT_TIERED_CONFIG,
} from './tiered-cache';

// ============================================================================
// Cache Monitor
// ============================================================================

export type {
  MetricSample,
  CacheAlert,
  CacheMonitorConfig,
  DiagnosticSnapshot,
} from './cache-monitor';

export {
  CacheMonitor,
  createCacheMonitor,
  DEFAULT_MONITOR_CONFIG,
} from './cache-monitor';

// ============================================================================
// Cache Stats View
// ============================================================================

export { CacheStatsView, CACHE_STATS_VIEW_TYPE } from './cache-stats-view';
