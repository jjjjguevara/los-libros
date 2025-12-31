/**
 * SyncEngine
 *
 * Orchestrates bidirectional sync between Obsidian and Calibre.
 * Coordinates change detection, conflict resolution, and data persistence.
 */

import { App, TFile, normalizePath, Notice } from 'obsidian';
import { CalibreDatabase } from '../database/calibre-db';
import { ChangeTracker } from './change-tracker';
import { ConflictResolver } from './conflict-resolver';
import type { Conflict } from './conflict-resolver';
import type {
  SyncChange,
  SyncDirection,
  SyncStatus,
  CalibreBookFull,
  BookReadingStatus,
} from '../calibre-types';
import type { LibrosSettings } from '../../settings/settings';

/**
 * Sync result summary
 */
export interface SyncResult {
  success: boolean;
  timestamp: Date;
  toObsidian: number;
  toCalibre: number;
  conflicts: number;
  errors: string[];
}

export class SyncEngine {
  private app: App;
  private getSettings: () => LibrosSettings;
  private db: CalibreDatabase | null = null;
  private changeTracker: ChangeTracker;
  private conflictResolver: ConflictResolver;
  private syncInProgress = false;
  private syncQueue: SyncChange[] = [];

  constructor(app: App, getSettings: () => LibrosSettings) {
    this.app = app;
    this.getSettings = getSettings;
    this.changeTracker = new ChangeTracker(app, getSettings);
    this.conflictResolver = new ConflictResolver();
  }

  /**
   * Initialize the sync engine
   */
  async initialize(db: CalibreDatabase): Promise<void> {
    this.db = db;

    // Set conflict resolution strategy from settings
    const settings = this.getSettings();
    this.conflictResolver.setStrategy(settings.calibreConflictResolution);

    // Initialize change tracker state
    await this.changeTracker.initializeState();

    // Start tracking if bidirectional sync is enabled
    if (settings.calibreSyncDirection !== 'to-obsidian') {
      this.changeTracker.startTracking();
    }

    // Listen for detected changes
    this.changeTracker.on('changes-detected', ((changes: SyncChange[]) => {
      this.queueChanges(changes);
    }) as (...data: unknown[]) => unknown);
  }

  /**
   * Stop the sync engine
   */
  stop(): void {
    this.changeTracker.stopTracking();
    this.changeTracker.off('changes-detected', () => {});
  }

  /**
   * Queue changes for sync
   */
  private queueChanges(changes: SyncChange[]): void {
    this.syncQueue.push(...changes);
  }

  /**
   * Perform a full sync
   */
  async fullSync(): Promise<SyncResult> {
    if (this.syncInProgress) {
      return {
        success: false,
        timestamp: new Date(),
        toObsidian: 0,
        toCalibre: 0,
        conflicts: 0,
        errors: ['Sync already in progress'],
      };
    }

    this.syncInProgress = true;
    const result: SyncResult = {
      success: true,
      timestamp: new Date(),
      toObsidian: 0,
      toCalibre: 0,
      conflicts: 0,
      errors: [],
    };

    try {
      const settings = this.getSettings();

      // Detect changes from Obsidian
      const obsidianChanges = await this.changeTracker.checkForChanges();

      // Detect changes from Calibre (if we have database access)
      let calibreChanges: SyncChange[] = [];
      if (this.db && settings.calibreSyncDirection !== 'to-calibre') {
        calibreChanges = await this.detectCalibreChanges();
      }

      // Resolve conflicts and merge
      const { toObsidian, toCalibre, conflicts } = this.conflictResolver.mergeChanges(
        obsidianChanges,
        calibreChanges
      );

      result.conflicts = conflicts.length;

      // Apply changes based on sync direction
      if (settings.calibreSyncDirection !== 'to-calibre') {
        // Apply Calibre changes to Obsidian
        for (const change of toObsidian) {
          try {
            await this.applyToObsidian(change);
            result.toObsidian++;
          } catch (error) {
            result.errors.push(`Failed to apply to Obsidian: ${error}`);
          }
        }
      }

      if (settings.calibreSyncDirection !== 'to-obsidian') {
        // Apply Obsidian changes to Calibre
        for (const change of toCalibre) {
          try {
            await this.applyToCalibre(change);
            result.toCalibre++;
          } catch (error) {
            result.errors.push(`Failed to apply to Calibre: ${error}`);
          }
        }

        // Save Calibre database if we made changes
        if (result.toCalibre > 0 && this.db) {
          try {
            this.db.save();
          } catch (error) {
            result.errors.push(`Failed to save Calibre database: ${error}`);
          }
        }
      }

      // Clear synced changes
      this.changeTracker.clearPending();
      this.syncQueue = [];

      // Show notification
      if (result.toObsidian > 0 || result.toCalibre > 0) {
        new Notice(
          `Sync complete: ${result.toObsidian} to Obsidian, ${result.toCalibre} to Calibre`
        );
      }

      result.success = result.errors.length === 0;
    } catch (error) {
      result.success = false;
      result.errors.push(`Sync failed: ${error}`);
    } finally {
      this.syncInProgress = false;
    }

    return result;
  }

  /**
   * Sync a single book
   */
  async syncBook(calibreId: number): Promise<SyncResult> {
    // This would be a targeted sync for one book
    // For now, delegate to full sync with filtering
    return this.fullSync();
  }

  /**
   * Detect changes from Calibre database
   */
  private async detectCalibreChanges(): Promise<SyncChange[]> {
    if (!this.db) return [];

    const settings = this.getSettings();
    const changes: SyncChange[] = [];

    // Get all books from Calibre
    const calibreBooks = this.db.getAllBooksFull();

    // Get current state from Obsidian notes
    const obsidianState = await this.getObsidianBookState();

    // Compare each book
    for (const book of calibreBooks) {
      const noteState = obsidianState.get(book.id);
      if (!noteState) continue;

      // Check rating
      if (
        settings.calibreSyncableFields.includes('rating') &&
        book.rating !== undefined &&
        book.rating !== noteState.rating
      ) {
        changes.push({
          id: `calibre-${book.id}-rating-${Date.now()}`,
          bookId: book.uuid,
          calibreId: book.id,
          field: 'rating',
          oldValue: noteState.rating,
          newValue: book.rating,
          source: 'calibre',
          timestamp: book.lastModified,
          synced: false,
        });
      }

      // Check tags
      if (settings.calibreSyncableFields.includes('tags')) {
        const calibreTags = book.tags.map((t) => t.name).sort();
        const noteTags = [...noteState.tags].sort();

        if (JSON.stringify(calibreTags) !== JSON.stringify(noteTags)) {
          changes.push({
            id: `calibre-${book.id}-tags-${Date.now()}`,
            bookId: book.uuid,
            calibreId: book.id,
            field: 'tags',
            oldValue: noteTags,
            newValue: calibreTags,
            source: 'calibre',
            timestamp: book.lastModified,
            synced: false,
          });
        }
      }
    }

    return changes;
  }

  /**
   * Get current book state from Obsidian notes
   */
  private async getObsidianBookState(): Promise<
    Map<number, { rating?: number; tags: string[]; status: string; progress: number }>
  > {
    const settings = this.getSettings();
    const state = new Map<
      number,
      { rating?: number; tags: string[]; status: string; progress: number }
    >();

    const bookNotes = this.app.vault.getMarkdownFiles().filter((f) =>
      f.path.startsWith(settings.calibreBookNotesFolder)
    );

    for (const file of bookNotes) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter || cache.frontmatter.type !== 'book') continue;

      const fm = cache.frontmatter as Record<string, unknown>;
      const calibreId = fm.calibreId as number;

      if (calibreId) {
        state.set(calibreId, {
          rating: fm.rating as number | undefined,
          tags: (fm.tags as string[]) || [],
          status: (fm.status as string) || 'to-read',
          progress: (fm.progress as number) || 0,
        });
      }
    }

    return state;
  }

  /**
   * Apply a change to Obsidian (update note frontmatter)
   */
  private async applyToObsidian(change: SyncChange): Promise<void> {
    const settings = this.getSettings();

    // Find the book note
    const bookNotes = this.app.vault.getMarkdownFiles().filter((f) =>
      f.path.startsWith(settings.calibreBookNotesFolder)
    );

    for (const file of bookNotes) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter || cache.frontmatter.calibreId !== change.calibreId) {
        continue;
      }

      // Update the frontmatter
      const content = await this.app.vault.read(file);
      const updatedContent = this.updateFrontmatter(content, change.field, change.newValue);
      await this.app.vault.modify(file, updatedContent);

      console.log(`Applied ${change.field} change to ${file.path}`);
      return;
    }
  }

  /**
   * Apply a change to Calibre (update database)
   */
  private async applyToCalibre(change: SyncChange): Promise<void> {
    if (!this.db) {
      throw new Error('Database not connected');
    }

    switch (change.field) {
      case 'rating':
        this.db.setRating(change.calibreId, change.newValue as number);
        break;

      case 'tags':
        const oldTags = (change.oldValue as string[]) || [];
        const newTags = (change.newValue as string[]) || [];

        // Remove old tags
        for (const tag of oldTags) {
          if (!newTags.includes(tag)) {
            this.db.removeTag(change.calibreId, tag);
          }
        }

        // Add new tags
        for (const tag of newTags) {
          if (!oldTags.includes(tag)) {
            this.db.addTag(change.calibreId, tag);
          }
        }
        break;

      case 'status':
      case 'progress':
        // These are Obsidian-only fields, not synced to Calibre
        // Could be extended to use custom columns if desired
        console.log(`Field ${change.field} is not synced to Calibre`);
        break;

      default:
        console.warn(`Unknown sync field: ${change.field}`);
    }
  }

  /**
   * Update a specific field in frontmatter
   */
  private updateFrontmatter(content: string, field: string, value: unknown): string {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return content;

    let [, frontmatter, body] = match;

    // Format the new value
    let valueStr: string;
    if (Array.isArray(value)) {
      valueStr = `[${value.join(', ')}]`;
    } else if (typeof value === 'string') {
      valueStr = `"${value}"`;
    } else {
      valueStr = String(value);
    }

    // Update or add the field
    const fieldRegex = new RegExp(`^${field}:.*$`, 'm');
    const newLine = `${field}: ${valueStr}`;

    if (fieldRegex.test(frontmatter)) {
      frontmatter = frontmatter.replace(fieldRegex, newLine);
    } else {
      frontmatter += `\n${newLine}`;
    }

    // Update lastSync
    const syncRegex = /^lastSync:.*$/m;
    const syncLine = `lastSync: ${new Date().toISOString()}`;
    if (syncRegex.test(frontmatter)) {
      frontmatter = frontmatter.replace(syncRegex, syncLine);
    } else {
      frontmatter += `\n${syncLine}`;
    }

    return `---\n${frontmatter}\n---\n${body}`;
  }

  /**
   * Get sync status for all books
   */
  async getSyncStatus(): Promise<Map<number, SyncStatus>> {
    const statusMap = new Map<number, SyncStatus>();
    const pendingChanges = this.changeTracker.getPendingChanges();

    // Group pending changes by calibreId
    for (const change of pendingChanges) {
      const existing = statusMap.get(change.calibreId);
      if (existing) {
        existing.pendingChanges.push(change);
      } else {
        statusMap.set(change.calibreId, {
          bookId: change.bookId,
          calibreId: change.calibreId,
          lastSyncedAt: null,
          lastModifiedObsidian: change.timestamp,
          lastModifiedCalibre: null,
          pendingChanges: [change],
          hasConflicts: false,
        });
      }
    }

    return statusMap;
  }

  /**
   * Check if there are pending changes
   */
  hasPendingChanges(): boolean {
    return this.syncQueue.length > 0 || this.changeTracker.getPendingChanges().length > 0;
  }
}
