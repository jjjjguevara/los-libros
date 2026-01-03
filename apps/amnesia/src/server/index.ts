/**
 * Amnesia Server Module
 *
 * Provides integration with the Amnesia Server for:
 * - OPDS catalog browsing
 * - Reading progress sync
 * - Highlights sync
 */

export { AmnesiaClient } from './amnesia-client';
export type {
  ReadingProgress,
  ServerHighlight,
  HealthResponse,
} from './amnesia-client';

export { ServerSyncService } from './server-sync';
export type {
  LocalBookProgress,
  LocalHighlight,
  SyncResult,
} from './server-sync';
