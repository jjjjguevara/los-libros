/**
 * Amnesia plugin settings
 */
import { DEFAULT_BOOK_NOTE_TEMPLATE, DEFAULT_HIGHLIGHT_NOTE_TEMPLATE, DEFAULT_TEMPLATE_SETTINGS } from '../templates/default-templates';
import type { SyncDirection, ConflictResolution, SyncableField } from '../calibre/calibre-types';
import type { TemplateSettings } from '../templates/template-types';
import type { BookSettingsRecord } from '../reader/book-settings-store';

// ==========================================================================
// File System Architecture Settings Types
// ==========================================================================

/**
 * Advanced cache configuration for tiered caching (L1 memory + L2 IndexedDB)
 */
export interface AdvancedCacheSettings {
  /** L1 (memory) cache max size in bytes. Default: 50MB */
  l1MaxSizeBytes: number;
  /** L1 max entries. Default: 500 */
  l1MaxEntries: number;
  /** Enable L2 (IndexedDB) persistent cache. Default: true */
  l2Enabled: boolean;
  /** L2 cache max size in bytes. Default: 500MB */
  l2MaxSizeBytes: number;
  /** L2 max entries. Default: 5000 */
  l2MaxEntries: number;
  /** Promote L2 entries to L1 on access. Default: true */
  promoteOnAccess: boolean;
  /** Write through to L2 on L1 writes. Default: true */
  writeThrough: boolean;
}

/**
 * Offline mode settings for downloading books for offline reading
 */
export interface OfflineSettings {
  /** Enable offline mode. Default: false */
  enabled: boolean;
  /** Max concurrent downloads. Default: 3 */
  concurrentDownloads: number;
  /** Number of retry attempts for failed downloads. Default: 3 */
  retryCount: number;
  /** Delay between retries in ms. Default: 1000 */
  retryDelay: number;
  /** Storage quota warning threshold (0-1). Default: 0.9 */
  quotaWarningThreshold: number;
}

/**
 * Network monitoring settings
 */
export interface NetworkSettings {
  /** Enable network monitoring. Default: true */
  enabled: boolean;
  /** Health check interval in ms. Default: 30000 */
  checkInterval: number;
  /** Health check timeout in ms. Default: 5000 */
  checkTimeout: number;
  /** Failed checks before marking offline. Default: 3 */
  failureThreshold: number;
}

/**
 * Deduplication settings for content-based storage optimization
 */
export interface DeduplicationSettings {
  /** Enable content deduplication. Default: false */
  enabled: boolean;
  /** Hash algorithm for content fingerprinting. Default: 'SHA-256' */
  algorithm: 'SHA-256' | 'SHA-384' | 'SHA-512';
  /** Minimum file size for deduplication in bytes. Default: 1024 */
  minSize: number;
}

/**
 * Custom OPDS feed configuration
 */
export interface OPDSFeedConfig {
  /** Unique feed ID */
  id: string;
  /** Display name */
  name: string;
  /** Root feed URL */
  url: string;
  /** Is feed enabled */
  enabled: boolean;
  /** Requires authentication */
  requiresAuth: boolean;
  /** Username for auth (if required) */
  username?: string;
  /** Password for auth (if required) */
  password?: string;
}

/**
 * OPDS integration settings
 */
export interface OPDSSettings {
  /** Custom OPDS feed sources */
  customFeeds: OPDSFeedConfig[];
  /** Enable feed caching. Default: true */
  cacheFeeds: boolean;
  /** Feed cache duration in ms. Default: 3600000 (1 hour) */
  cacheDuration: number;
  /** Request timeout in ms. Default: 10000 */
  timeout: number;
}

/**
 * Asset extraction and export settings
 */
export interface AssetSettings {
  /** Generate thumbnails for images. Default: true */
  generateThumbnails: boolean;
  /** Max thumbnail dimension in pixels. Default: 200 */
  thumbnailMaxSize: number;
  /** Vault folder for exported assets. Default: 'Assets/Books' */
  exportFolder: string;
}

// ==========================================================================
// Unified Sync Architecture Settings Types
// ==========================================================================

/**
 * Conflict resolution strategy for unified sync
 */
export type UnifiedConflictStrategy =
  | 'last-write-wins'
  | 'prefer-local'
  | 'prefer-remote'
  | 'merge'
  | 'ask-user';

/**
 * Default sync mode
 */
export type UnifiedSyncMode = 'incremental' | 'full' | 'custom';

/**
 * Unified sync architecture settings
 */
export interface UnifiedSyncSettings {
  /** Enable unified sync engine. Default: false */
  enabled: boolean;

  /** Default sync mode. Default: 'incremental' */
  defaultMode: UnifiedSyncMode;

  /** Default conflict resolution strategy. Default: 'last-write-wins' */
  defaultConflictStrategy: UnifiedConflictStrategy;

  /** Maximum concurrent operations. Default: 5 */
  concurrency: number;

  /** Checkpoint interval (items processed before saving). Default: 100 */
  checkpointInterval: number;

  /** Enable cross-session resume. Default: true */
  enableResume: boolean;

  /** Rate limit: max requests per second. Default: 10 */
  rateLimit: number;

  /** Show resume notification on startup. Default: true */
  showResumeNotification: boolean;

  /** Enabled adapters. Default: all */
  enabledAdapters: {
    calibre: boolean;
    server: boolean;
    file: boolean;
  };

  /** Parallel cover downloads. Default: true */
  parallelCoverDownloads: boolean;

  /** Cover download concurrency. Default: 5 */
  coverDownloadConcurrency: number;

  /** Batch note generation. Default: true */
  batchNoteGeneration: boolean;

  /** Note generation batch size. Default: 50 */
  noteGenerationBatchSize: number;
}

export interface LibrosSettings {
  // Server connection
  serverUrl: string;
  serverEnabled: boolean;

  // Local library
  localBooksFolder: string;

  // Reading preferences
  defaultFontSize: number;
  defaultTheme: 'system' | 'light' | 'dark' | 'sepia';
  paginated: boolean;

  // Sync settings
  syncProgress: boolean;
  syncHighlights: boolean;
  syncInterval: number; // in minutes, 0 = manual only

  // Highlight settings
  highlightFolder: string;
  highlightTemplate: string;
  atomicHighlights: boolean; // Each highlight as separate file

  // Book note settings
  bookNoteFolder: string;
  bookNoteTemplate: string;
  autoCreateBookNotes: boolean;

  // Cache settings
  maxCachedBooks: number;
  maxCacheSize: number; // in MB

  // ==========================================================================
  // Calibre Integration
  // ==========================================================================

  // Connection
  calibreEnabled: boolean;
  calibreLibraryPath: string;              // e.g., /Users/.../Libros
  calibreContentServerUrl: string;         // e.g., http://localhost:8080
  calibreContentServerEnabled: boolean;
  calibreContentServerUsername: string;    // Optional authentication
  calibreContentServerPassword: string;

  // Sync
  calibreSyncDirection: SyncDirection;
  calibreConflictResolution: ConflictResolution;
  calibreSyncableFields: SyncableField[];

  // Folders (vault paths for generated notes)
  calibreBookNotesFolder: string;          // Florilegios
  calibreAuthorIndexFolder: string;        // Autores
  calibreSeriesIndexFolder: string;        // Series
  calibreShelfIndexFolder: string;         // Estanterias
  calibreHighlightsFolder: string;         // Subrayados
  calibreBaseFilesFolder: string;          // Indices
  calibreCoversFolder: string;             // Attachments/covers

  // ==========================================================================
  // Template Settings
  // ==========================================================================
  templates: TemplateSettings;
  templatesFolder: string;                 // Vault folder for custom templates

  // ==========================================================================
  // Note Generation Settings
  // ==========================================================================
  notesFolder: string;                     // Where book notes are created
  noteUpdateMode: 'never' | 'frontmatter' | 'full';  // How to update existing notes

  // Frontmatter Mapping (for metadata sync)
  frontmatterMapping: {
    author?: string;
    series?: string;
    bookshelves?: string;
    rating?: string;
    progress?: string;
  };

  // Wikilink formatting
  wikilinkAuthors: boolean;
  wikilinkSeries: boolean;
  wikilinkBookshelves: boolean;

  // ==========================================================================
  // Per-Book Settings Storage
  // ==========================================================================
  perBookSettings: Record<string, BookSettingsRecord>;

  // ==========================================================================
  // File System Architecture Settings
  // ==========================================================================

  /** Advanced tiered cache configuration */
  advancedCache: AdvancedCacheSettings;

  /** Offline mode and download settings */
  offline: OfflineSettings;

  /** Network monitoring configuration */
  network: NetworkSettings;

  /** Content deduplication settings */
  deduplication: DeduplicationSettings;

  /** OPDS feed integration settings */
  opds: OPDSSettings;

  /** Asset extraction and export settings */
  assets: AssetSettings;

  // ==========================================================================
  // Unified Sync Architecture Settings
  // ==========================================================================

  /** Unified sync engine configuration */
  unifiedSync: UnifiedSyncSettings;
}

export const DEFAULT_SETTINGS: LibrosSettings = {
  // Server connection
  serverUrl: '',
  serverEnabled: false,

  // Local library
  localBooksFolder: 'Books',

  // Reading preferences
  defaultFontSize: 16,
  defaultTheme: 'system',
  paginated: true,

  // Sync settings
  syncProgress: true,
  syncHighlights: true,
  syncInterval: 0,

  // Highlight settings
  highlightFolder: 'Highlights',
  highlightTemplate: DEFAULT_HIGHLIGHT_NOTE_TEMPLATE,
  atomicHighlights: true,

  // Book note settings
  bookNoteFolder: 'Books',
  bookNoteTemplate: DEFAULT_BOOK_NOTE_TEMPLATE,
  autoCreateBookNotes: true,

  // Cache settings
  maxCachedBooks: 10,
  maxCacheSize: 200,

  // Calibre Integration
  calibreEnabled: false,
  calibreLibraryPath: '',
  calibreContentServerUrl: 'http://localhost:8080',
  calibreContentServerEnabled: false,
  calibreContentServerUsername: '',
  calibreContentServerPassword: '',

  // Sync
  calibreSyncDirection: 'bidirectional',
  calibreConflictResolution: 'last-write',
  calibreSyncableFields: ['status', 'rating', 'tags', 'progress'],

  // Folders (vault paths matching BookFusion pattern)
  calibreBookNotesFolder: 'Florilegios',
  calibreAuthorIndexFolder: 'Autores',
  calibreSeriesIndexFolder: 'Series',
  calibreShelfIndexFolder: 'Estanterias',
  calibreHighlightsFolder: 'Subrayados',
  calibreBaseFilesFolder: 'Indices',
  calibreCoversFolder: 'Attachments/covers',

  // Template Settings
  templates: DEFAULT_TEMPLATE_SETTINGS,
  templatesFolder: 'Templates/Amnesia',

  // Note Generation Settings
  notesFolder: 'Books',
  noteUpdateMode: 'frontmatter',
  frontmatterMapping: {
    author: 'author',
    series: 'series',
    bookshelves: 'bookshelves',
    rating: 'rating',
    progress: 'progress',
  },
  wikilinkAuthors: true,
  wikilinkSeries: true,
  wikilinkBookshelves: true,

  // Per-Book Settings Storage
  perBookSettings: {},

  // ==========================================================================
  // File System Architecture Settings Defaults
  // ==========================================================================

  // Advanced Cache
  advancedCache: {
    l1MaxSizeBytes: 50 * 1024 * 1024,    // 50MB
    l1MaxEntries: 500,
    l2Enabled: true,
    l2MaxSizeBytes: 500 * 1024 * 1024,   // 500MB
    l2MaxEntries: 5000,
    promoteOnAccess: true,
    writeThrough: true,
  },

  // Offline Mode
  offline: {
    enabled: false,
    concurrentDownloads: 3,
    retryCount: 3,
    retryDelay: 1000,
    quotaWarningThreshold: 0.9,
  },

  // Network Monitoring
  network: {
    enabled: true,
    checkInterval: 30000,    // 30 seconds
    checkTimeout: 5000,      // 5 seconds
    failureThreshold: 3,
  },

  // Deduplication
  deduplication: {
    enabled: false,
    algorithm: 'SHA-256',
    minSize: 1024,           // 1KB minimum
  },

  // OPDS Feeds
  opds: {
    customFeeds: [],
    cacheFeeds: true,
    cacheDuration: 3600000,  // 1 hour
    timeout: 10000,          // 10 seconds
  },

  // Asset Settings
  assets: {
    generateThumbnails: true,
    thumbnailMaxSize: 200,
    exportFolder: 'Assets/Books',
  },

  // ==========================================================================
  // Unified Sync Architecture Settings Defaults
  // ==========================================================================

  unifiedSync: {
    enabled: false,
    defaultMode: 'incremental',
    defaultConflictStrategy: 'last-write-wins',
    concurrency: 5,
    checkpointInterval: 100,
    enableResume: true,
    rateLimit: 10,
    showResumeNotification: true,
    enabledAdapters: {
      calibre: true,
      server: true,
      file: true,
    },
    parallelCoverDownloads: true,
    coverDownloadConcurrency: 5,
    batchNoteGeneration: true,
    noteGenerationBatchSize: 50,
  },
};
