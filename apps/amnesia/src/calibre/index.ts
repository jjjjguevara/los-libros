/**
 * Calibre Integration Module
 *
 * Provides bidirectional sync between Calibre and Obsidian.
 */

// Types
export * from './calibre-types';

// State management
export { calibreReducer, initialCalibreState } from './calibre-reducer';
export * from './calibre-reducer';

// Database
export { CalibreDatabase } from './database/calibre-db';

// Parser
export { parseOPF, parseOPFString, writeOPF, buildOPFString } from './parser/opf-parser';

// Server (Content Server client)
export { ContentServerClient } from './server/content-server-client';

// Sync
export { SyncEngine, type SyncResult } from './sync/sync-engine';
export { ChangeTracker } from './sync/change-tracker';
export { ConflictResolver, type Conflict, type ResolvedConflict } from './sync/conflict-resolver';

// Incremental Sync
export {
  IncrementalSyncManager,
  createIncrementalSyncManager,
  type BookHash,
  type IncrementalSyncState,
  type ChangeSet,
  type IncrementalSyncResult,
} from './incremental-sync';

// Service
export { CalibreService, type ConnectionMode } from './calibre-service';
