/**
 * Server Sync Service
 *
 * Handles bidirectional sync of reading progress and highlights
 * between the Obsidian vault and Los Libros Server.
 */
import { App, TFile } from 'obsidian';
import { LosLibrosClient, ReadingProgress, ServerHighlight } from './los-libros-client';

/**
 * Local book progress from frontmatter
 */
export interface LocalBookProgress {
  bookId: string;
  progress: number;
  currentCfi?: string;
  lastReadAt?: Date;
  notePath: string;
}

/**
 * Local highlight from vault
 */
export interface LocalHighlight {
  id: string;
  bookId: string;
  cfiRange: string;
  text: string;
  annotation?: string;
  color: string;
  chapter?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Sync result
 */
export interface SyncResult {
  progressUpdated: number;
  highlightsCreated: number;
  highlightsUpdated: number;
  errors: string[];
}

/**
 * Server sync service
 */
export class ServerSyncService {
  private client: LosLibrosClient;
  private app: App;
  private enabled: boolean = false;

  constructor(app: App, serverUrl: string) {
    this.app = app;
    this.client = new LosLibrosClient(app, serverUrl);
  }

  /**
   * Set the server URL and enable/disable sync
   */
  configure(serverUrl: string, enabled: boolean): void {
    this.client.setServerUrl(serverUrl);
    this.enabled = enabled;
  }

  /**
   * Check if sync is enabled and server is reachable
   */
  async isAvailable(): Promise<boolean> {
    if (!this.enabled) return false;
    return this.client.testConnection();
  }

  /**
   * Get the Los Libros client for direct OPDS access
   */
  getClient(): LosLibrosClient {
    return this.client;
  }

  // ==========================================================================
  // Progress Sync
  // ==========================================================================

  /**
   * Sync progress for a single book
   * Returns the merged progress (server wins if more recent)
   */
  async syncBookProgress(localProgress: LocalBookProgress): Promise<LocalBookProgress> {
    if (!this.enabled) return localProgress;

    try {
      const serverProgress = await this.client.getProgress(localProgress.bookId);

      if (!serverProgress) {
        // No server progress, push local
        await this.client.updateProgress(localProgress.bookId, {
          progress: localProgress.progress,
          currentCfi: localProgress.currentCfi,
        });
        return localProgress;
      }

      // Compare timestamps - server wins if more recent
      const localTime = localProgress.lastReadAt?.getTime() || 0;
      const serverTime = serverProgress.lastReadAt.getTime();

      if (serverTime > localTime) {
        // Server is more recent, update local
        return {
          ...localProgress,
          progress: serverProgress.progress,
          currentCfi: serverProgress.currentCfi,
          lastReadAt: serverProgress.lastReadAt,
        };
      } else {
        // Local is more recent, push to server
        await this.client.updateProgress(localProgress.bookId, {
          progress: localProgress.progress,
          currentCfi: localProgress.currentCfi,
        });
        return localProgress;
      }
    } catch (error) {
      console.error('Failed to sync book progress:', error);
      return localProgress;
    }
  }

  /**
   * Push local progress to server
   */
  async pushProgress(bookId: string, progress: number, cfi?: string): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      const result = await this.client.updateProgress(bookId, {
        progress,
        currentCfi: cfi,
      });
      return result !== null;
    } catch (error) {
      console.error('Failed to push progress:', error);
      return false;
    }
  }

  /**
   * Pull progress from server
   */
  async pullProgress(bookId: string): Promise<ReadingProgress | null> {
    if (!this.enabled) return null;
    return this.client.getProgress(bookId);
  }

  // ==========================================================================
  // Highlights Sync
  // ==========================================================================

  /**
   * Sync highlights for a book
   */
  async syncBookHighlights(
    bookId: string,
    localHighlights: LocalHighlight[]
  ): Promise<{ merged: LocalHighlight[]; created: number; updated: number }> {
    if (!this.enabled) {
      return { merged: localHighlights, created: 0, updated: 0 };
    }

    try {
      const serverHighlights = await this.client.getHighlights(bookId);

      // Create lookup maps
      const serverMap = new Map(serverHighlights.map(h => [h.cfiRange, h]));
      const localMap = new Map(localHighlights.map(h => [h.cfiRange, h]));

      const merged: LocalHighlight[] = [];
      let created = 0;
      let updated = 0;

      // Process local highlights
      for (const local of localHighlights) {
        const server = serverMap.get(local.cfiRange);
        if (server) {
          // Exists on both - use more recent
          if (server.updatedAt > local.updatedAt) {
            merged.push({
              ...local,
              text: server.text,
              annotation: server.annotation,
              color: server.color,
              updatedAt: server.updatedAt,
            });
            updated++;
          } else {
            merged.push(local);
            // Update server if local is newer
            if (local.updatedAt > server.updatedAt) {
              await this.client.createHighlight({
                bookId: local.bookId,
                cfiRange: local.cfiRange,
                text: local.text,
                annotation: local.annotation,
                color: local.color,
                chapter: local.chapter,
              });
            }
          }
          serverMap.delete(local.cfiRange);
        } else {
          // Only exists locally - push to server
          await this.client.createHighlight({
            bookId: local.bookId,
            cfiRange: local.cfiRange,
            text: local.text,
            annotation: local.annotation,
            color: local.color,
            chapter: local.chapter,
          });
          merged.push(local);
        }
      }

      // Add server-only highlights to local
      for (const [, server] of serverMap) {
        merged.push({
          id: server.id,
          bookId: server.bookId,
          cfiRange: server.cfiRange,
          text: server.text,
          annotation: server.annotation,
          color: server.color,
          chapter: server.chapter,
          createdAt: server.createdAt,
          updatedAt: server.updatedAt,
        });
        created++;
      }

      return { merged, created, updated };
    } catch (error) {
      console.error('Failed to sync highlights:', error);
      return { merged: localHighlights, created: 0, updated: 0 };
    }
  }

  /**
   * Push a single highlight to server
   */
  async pushHighlight(highlight: LocalHighlight): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      const result = await this.client.createHighlight({
        bookId: highlight.bookId,
        cfiRange: highlight.cfiRange,
        text: highlight.text,
        annotation: highlight.annotation,
        color: highlight.color,
        chapter: highlight.chapter,
      });
      return result !== null;
    } catch (error) {
      console.error('Failed to push highlight:', error);
      return false;
    }
  }

  /**
   * Delete a highlight from server
   */
  async deleteHighlight(highlightId: string): Promise<boolean> {
    if (!this.enabled) return false;
    return this.client.deleteHighlight(highlightId);
  }

  // ==========================================================================
  // Full Sync
  // ==========================================================================

  /**
   * Perform a full sync of all books
   */
  async fullSync(
    getLocalBooks: () => Promise<LocalBookProgress[]>,
    getLocalHighlights: (bookId: string) => Promise<LocalHighlight[]>,
    updateLocalProgress: (book: LocalBookProgress) => Promise<void>,
    updateLocalHighlights: (bookId: string, highlights: LocalHighlight[]) => Promise<void>
  ): Promise<SyncResult> {
    const result: SyncResult = {
      progressUpdated: 0,
      highlightsCreated: 0,
      highlightsUpdated: 0,
      errors: [],
    };

    if (!this.enabled) {
      result.errors.push('Server sync is not enabled');
      return result;
    }

    const available = await this.isAvailable();
    if (!available) {
      result.errors.push('Server is not reachable');
      return result;
    }

    try {
      const books = await getLocalBooks();

      for (const book of books) {
        try {
          // Sync progress
          const mergedProgress = await this.syncBookProgress(book);
          if (
            mergedProgress.progress !== book.progress ||
            mergedProgress.currentCfi !== book.currentCfi
          ) {
            await updateLocalProgress(mergedProgress);
            result.progressUpdated++;
          }

          // Sync highlights
          const localHighlights = await getLocalHighlights(book.bookId);
          const { merged, created, updated } = await this.syncBookHighlights(
            book.bookId,
            localHighlights
          );

          if (created > 0 || updated > 0) {
            await updateLocalHighlights(book.bookId, merged);
            result.highlightsCreated += created;
            result.highlightsUpdated += updated;
          }
        } catch (error) {
          result.errors.push(`Failed to sync ${book.bookId}: ${error}`);
        }
      }
    } catch (error) {
      result.errors.push(`Full sync failed: ${error}`);
    }

    return result;
  }
}
