/**
 * OPDS Sync Service
 *
 * Handles bidirectional sync of reading progress and highlights with OPDS servers.
 * Detects server capabilities and uses appropriate sync methods.
 */

import { App, requestUrl } from 'obsidian';
import type { OPDSServerCapabilities, OPDSServerConfig, OPDSFeed } from './opds-types';
import { OPDSClient } from './opds-client';
import { AmnesiaClient, type ReadingProgress, type ServerHighlight } from '../server/amnesia-client';
import type { UnifiedBook } from '../types/unified-book';
import type { HighlightData } from '../templates/unified-note-generator';

/**
 * Sync result for a single book
 */
export interface BookSyncResult {
  bookId: string;
  progressSynced: boolean;
  highlightsSynced: boolean;
  errors: string[];
}

/**
 * Full sync result
 */
export interface SyncResult {
  success: boolean;
  booksProcessed: number;
  bookResults: BookSyncResult[];
  errors: string[];
}

/**
 * OPDS Sync Service
 */
export class OPDSSyncService {
  private app: App;
  private serverConfigs: Map<string, OPDSServerConfig>;
  private clients: Map<string, OPDSClient | AmnesiaClient>;

  constructor(app: App) {
    this.app = app;
    this.serverConfigs = new Map();
    this.clients = new Map();
  }

  /**
   * Register a server configuration
   */
  registerServer(config: OPDSServerConfig): void {
    this.serverConfigs.set(config.id, config);

    // Create appropriate client
    if (config.type === 'amnesia') {
      this.clients.set(config.id, new AmnesiaClient(this.app, config.catalogUrl));
    } else {
      this.clients.set(config.id, new OPDSClient(this.app));
    }
  }

  /**
   * Remove a server configuration
   */
  removeServer(serverId: string): void {
    this.serverConfigs.delete(serverId);
    this.clients.delete(serverId);
  }

  /**
   * Detect server capabilities by probing endpoints
   */
  async detectCapabilities(catalogUrl: string): Promise<OPDSServerCapabilities> {
    const baseUrl = catalogUrl.replace(/\/opds\/?$/, '');

    // Default capabilities (generic OPDS)
    const capabilities: OPDSServerCapabilities = {
      supportsProgressSync: false,
      supportsHighlightsSync: false,
      supportsAuth: false,
      serverType: 'opds-generic',
    };

    // Try Amnesia Server health endpoint
    try {
      const response = await requestUrl({
        url: `${baseUrl}/health`,
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (response.status === 200) {
        const data = response.json;
        if (data.status === 'ok' || data.server === 'amnesia') {
          capabilities.serverType = 'amnesia';
          capabilities.supportsProgressSync = true;
          capabilities.supportsHighlightsSync = true;
          capabilities.apiBaseUrl = baseUrl;
          capabilities.apiVersion = data.version;
          return capabilities;
        }
      }
    } catch {
      // Not a Amnesia server
    }

    // Try Kavita API
    try {
      const response = await requestUrl({
        url: `${baseUrl}/api/server/info`,
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (response.status === 200) {
        capabilities.serverType = 'kavita';
        capabilities.supportsProgressSync = true;
        capabilities.supportsHighlightsSync = false;
        capabilities.supportsAuth = true;
        capabilities.apiBaseUrl = baseUrl;
        return capabilities;
      }
    } catch {
      // Not Kavita
    }

    // Try Calibre Content Server
    try {
      const response = await requestUrl({
        url: `${baseUrl}/ajax/library-info`,
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (response.status === 200) {
        capabilities.serverType = 'calibre';
        capabilities.supportsProgressSync = false;
        capabilities.supportsHighlightsSync = false;
        capabilities.apiBaseUrl = baseUrl;
        return capabilities;
      }
    } catch {
      // Not Calibre
    }

    return capabilities;
  }

  /**
   * Sync a book's reading progress with a server
   */
  async syncProgress(
    serverId: string,
    book: UnifiedBook,
    localProgress: ReadingProgress
  ): Promise<{ pushed: boolean; pulled: boolean; conflict?: 'local' | 'remote' }> {
    const config = this.serverConfigs.get(serverId);
    if (!config || !config.capabilities.supportsProgressSync) {
      return { pushed: false, pulled: false };
    }

    const client = this.clients.get(serverId);
    if (!client || !(client instanceof AmnesiaClient)) {
      return { pushed: false, pulled: false };
    }

    try {
      // Get remote progress
      const remoteProgress = await client.getProgress(book.id);

      if (!remoteProgress) {
        // No remote progress, push local
        await client.updateProgress(book.id, {
          progress: localProgress.progress,
          currentCfi: localProgress.currentCfi,
          currentChapter: localProgress.currentChapter,
          lastReadAt: localProgress.lastReadAt,
        });
        return { pushed: true, pulled: false };
      }

      // Compare timestamps
      const localTime = localProgress.updatedAt?.getTime() || 0;
      const remoteTime = remoteProgress.updatedAt?.getTime() || 0;

      if (localTime > remoteTime) {
        // Local is newer, push
        await client.updateProgress(book.id, {
          progress: localProgress.progress,
          currentCfi: localProgress.currentCfi,
          currentChapter: localProgress.currentChapter,
          lastReadAt: localProgress.lastReadAt,
        });
        return { pushed: true, pulled: false };
      } else if (remoteTime > localTime) {
        // Remote is newer, pull (caller should update local)
        return { pushed: false, pulled: true, conflict: 'remote' };
      }

      // Same timestamp, no action needed
      return { pushed: false, pulled: false };
    } catch (error) {
      console.error('Progress sync failed:', error);
      return { pushed: false, pulled: false };
    }
  }

  /**
   * Sync highlights with a server
   */
  async syncHighlights(
    serverId: string,
    book: UnifiedBook,
    localHighlights: HighlightData[]
  ): Promise<{ pushed: number; pulled: number; conflicts: number }> {
    const config = this.serverConfigs.get(serverId);
    if (!config || !config.capabilities.supportsHighlightsSync) {
      return { pushed: 0, pulled: 0, conflicts: 0 };
    }

    const client = this.clients.get(serverId);
    if (!client || !(client instanceof AmnesiaClient)) {
      return { pushed: 0, pulled: 0, conflicts: 0 };
    }

    try {
      // Get remote highlights
      const remoteHighlights = await client.getHighlights(book.id);
      const remoteById = new Map(remoteHighlights.map(h => [h.id, h]));
      const localById = new Map(localHighlights.map(h => [h.id, h]));

      let pushed = 0;
      let pulled = 0;
      let conflicts = 0;

      // Push local highlights that don't exist remotely
      for (const local of localHighlights) {
        if (!remoteById.has(local.id)) {
          await client.createHighlight({
            bookId: book.id,
            cfiRange: local.cfi || '',
            text: local.text,
            annotation: local.annotation,
            color: local.color,
            chapter: local.chapter,
          });
          pushed++;
        }
      }

      // Track remote highlights that don't exist locally (to pull)
      for (const remote of remoteHighlights) {
        if (!localById.has(remote.id)) {
          pulled++;
        }
      }

      return { pushed, pulled, conflicts };
    } catch (error) {
      console.error('Highlights sync failed:', error);
      return { pushed: 0, pulled: 0, conflicts: 0 };
    }
  }

  /**
   * Full sync for a single book
   */
  async syncBook(
    serverId: string,
    book: UnifiedBook,
    localProgress: ReadingProgress,
    localHighlights: HighlightData[]
  ): Promise<BookSyncResult> {
    const result: BookSyncResult = {
      bookId: book.id,
      progressSynced: false,
      highlightsSynced: false,
      errors: [],
    };

    const config = this.serverConfigs.get(serverId);
    if (!config) {
      result.errors.push(`Server ${serverId} not found`);
      return result;
    }

    // Sync progress
    try {
      const progressResult = await this.syncProgress(serverId, book, localProgress);
      result.progressSynced = progressResult.pushed || progressResult.pulled;
    } catch (error) {
      result.errors.push(`Progress sync error: ${error}`);
    }

    // Sync highlights
    try {
      const highlightsResult = await this.syncHighlights(serverId, book, localHighlights);
      result.highlightsSynced = highlightsResult.pushed > 0 || highlightsResult.pulled > 0;
    } catch (error) {
      result.errors.push(`Highlights sync error: ${error}`);
    }

    return result;
  }

  /**
   * Get server by ID
   */
  getServer(serverId: string): OPDSServerConfig | undefined {
    return this.serverConfigs.get(serverId);
  }

  /**
   * Get all servers
   */
  getAllServers(): OPDSServerConfig[] {
    return Array.from(this.serverConfigs.values());
  }

  /**
   * Get enabled servers
   */
  getEnabledServers(): OPDSServerConfig[] {
    return this.getAllServers().filter(s => s.enabled);
  }

  /**
   * Get servers that support progress sync
   */
  getProgressSyncServers(): OPDSServerConfig[] {
    return this.getAllServers().filter(s => s.enabled && s.capabilities.supportsProgressSync);
  }

  /**
   * Get servers that support highlights sync
   */
  getHighlightsSyncServers(): OPDSServerConfig[] {
    return this.getAllServers().filter(s => s.enabled && s.capabilities.supportsHighlightsSync);
  }

  /**
   * Test connection to a server
   */
  async testConnection(serverId: string): Promise<boolean> {
    const config = this.serverConfigs.get(serverId);
    const client = this.clients.get(serverId);

    if (!config || !client) {
      return false;
    }

    try {
      if (client instanceof AmnesiaClient) {
        return await client.testConnection();
      } else {
        return await client.testConnection(config.catalogUrl);
      }
    } catch {
      return false;
    }
  }

  /**
   * Refresh capabilities for a server
   */
  async refreshCapabilities(serverId: string): Promise<OPDSServerCapabilities | null> {
    const config = this.serverConfigs.get(serverId);
    if (!config) {
      return null;
    }

    const capabilities = await this.detectCapabilities(config.catalogUrl);
    config.capabilities = capabilities;
    return capabilities;
  }
}
