/**
 * Los Libros Server Module
 *
 * Provides integration with the Los Libros Server for:
 * - OPDS catalog browsing
 * - Reading progress sync
 * - Highlights sync
 */

export { LosLibrosClient } from './los-libros-client';
export type {
  ReadingProgress,
  ServerHighlight,
  HealthResponse,
} from './los-libros-client';

export { ServerSyncService } from './server-sync';
export type {
  LocalBookProgress,
  LocalHighlight,
  SyncResult,
} from './server-sync';
