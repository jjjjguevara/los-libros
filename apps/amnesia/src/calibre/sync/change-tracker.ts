/**
 * ChangeTracker
 *
 * Monitors changes in both Obsidian notes and Calibre database
 * to detect what needs to be synced.
 */

import { App, TFile, Events, debounce } from 'obsidian';
import type {
  SyncChange,
  SyncableField,
  BookNoteFrontmatter,
  CalibreBookFull,
} from '../calibre-types';
import type { LibrosSettings } from '../../settings/settings';
import { v4 as uuidv4 } from 'uuid';

/**
 * Parsed frontmatter from a book note
 */
interface ParsedBookNote {
  calibreId: number;
  bookId: string;
  status: string;
  progress: number;
  rating?: number;
  tags: string[];
  lastSync: string;
}

export class ChangeTracker extends Events {
  private app: App;
  private getSettings: () => LibrosSettings;
  private pendingChanges: Map<string, SyncChange> = new Map();
  private lastKnownState: Map<number, ParsedBookNote> = new Map();
  private debouncedCheck: () => void;

  constructor(app: App, getSettings: () => LibrosSettings) {
    super();
    this.app = app;
    this.getSettings = getSettings;

    // Debounce change detection to avoid excessive processing
    this.debouncedCheck = debounce(
      () => this.checkForChanges(),
      2000,
      true
    );
  }

  /**
   * Start tracking changes
   */
  startTracking(): void {
    // Listen for file modifications
    this.app.vault.on('modify', (file) => {
      if (file instanceof TFile && this.isBookNote(file)) {
        this.debouncedCheck();
      }
    });

    // Listen for metadata changes
    this.app.metadataCache.on('changed', (file) => {
      if (this.isBookNote(file)) {
        this.debouncedCheck();
      }
    });
  }

  /**
   * Stop tracking changes
   */
  stopTracking(): void {
    this.app.vault.off('modify', this.debouncedCheck);
    this.app.metadataCache.off('changed', this.debouncedCheck);
  }

  /**
   * Check if a file is a book note
   */
  private isBookNote(file: TFile): boolean {
    const settings = this.getSettings();
    if (!file.path.startsWith(settings.calibreBookNotesFolder)) {
      return false;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    return cache?.frontmatter?.type === 'book';
  }

  /**
   * Check for changes in all book notes
   */
  async checkForChanges(): Promise<SyncChange[]> {
    const settings = this.getSettings();
    const changes: SyncChange[] = [];

    // Get all book notes
    const bookNotes = this.app.vault.getMarkdownFiles().filter((f) =>
      f.path.startsWith(settings.calibreBookNotesFolder)
    );

    for (const file of bookNotes) {
      const noteChanges = await this.detectNoteChanges(file);
      changes.push(...noteChanges);
    }

    // Store pending changes
    for (const change of changes) {
      this.pendingChanges.set(change.id, change);
    }

    if (changes.length > 0) {
      this.trigger('changes-detected', changes);
    }

    return changes;
  }

  /**
   * Detect changes in a single book note
   */
  private async detectNoteChanges(file: TFile): Promise<SyncChange[]> {
    const changes: SyncChange[] = [];
    const cache = this.app.metadataCache.getFileCache(file);

    if (!cache?.frontmatter || cache.frontmatter.type !== 'book') {
      return changes;
    }

    const fm = cache.frontmatter as Record<string, unknown>;
    const calibreId = fm.calibreId as number;
    const bookId = fm.bookId as string;

    if (!calibreId) return changes;

    const current: ParsedBookNote = {
      calibreId,
      bookId,
      status: (fm.status as string) || 'to-read',
      progress: (fm.progress as number) || 0,
      rating: fm.rating as number | undefined,
      tags: (fm.tags as string[]) || [],
      lastSync: (fm.lastSync as string) || '',
    };

    const previous = this.lastKnownState.get(calibreId);

    if (previous) {
      // Check each syncable field
      const settings = this.getSettings();
      const syncableFields = settings.calibreSyncableFields;

      if (syncableFields.includes('status') && current.status !== previous.status) {
        changes.push(this.createChange(bookId, calibreId, 'status', previous.status, current.status));
      }

      if (syncableFields.includes('progress') && current.progress !== previous.progress) {
        changes.push(this.createChange(bookId, calibreId, 'progress', previous.progress, current.progress));
      }

      if (syncableFields.includes('rating') && current.rating !== previous.rating) {
        changes.push(this.createChange(bookId, calibreId, 'rating', previous.rating, current.rating));
      }

      if (syncableFields.includes('tags')) {
        const addedTags = current.tags.filter((t) => !previous.tags.includes(t));
        const removedTags = previous.tags.filter((t) => !current.tags.includes(t));

        if (addedTags.length > 0 || removedTags.length > 0) {
          changes.push(this.createChange(bookId, calibreId, 'tags', previous.tags, current.tags));
        }
      }
    }

    // Update last known state
    this.lastKnownState.set(calibreId, current);

    return changes;
  }

  /**
   * Create a SyncChange record
   */
  private createChange(
    bookId: string,
    calibreId: number,
    field: SyncableField,
    oldValue: unknown,
    newValue: unknown
  ): SyncChange {
    return {
      id: uuidv4(),
      bookId,
      calibreId,
      field,
      oldValue,
      newValue,
      source: 'obsidian',
      timestamp: new Date(),
      synced: false,
    };
  }

  /**
   * Detect changes from Calibre database
   */
  detectCalibreChanges(
    calibreBooks: CalibreBookFull[],
    obsidianNotes: Map<number, ParsedBookNote>
  ): SyncChange[] {
    const changes: SyncChange[] = [];

    for (const book of calibreBooks) {
      const note = obsidianNotes.get(book.id);
      if (!note) continue;

      // Check rating
      if (book.rating !== undefined && book.rating !== note.rating) {
        changes.push({
          id: uuidv4(),
          bookId: book.uuid,
          calibreId: book.id,
          field: 'rating',
          oldValue: note.rating,
          newValue: book.rating,
          source: 'calibre',
          timestamp: new Date(),
          synced: false,
        });
      }

      // Check tags
      const calibreTags = book.tags.map((t) => t.name).sort();
      const noteTags = [...note.tags].sort();

      if (JSON.stringify(calibreTags) !== JSON.stringify(noteTags)) {
        changes.push({
          id: uuidv4(),
          bookId: book.uuid,
          calibreId: book.id,
          field: 'tags',
          oldValue: noteTags,
          newValue: calibreTags,
          source: 'calibre',
          timestamp: new Date(),
          synced: false,
        });
      }
    }

    return changes;
  }

  /**
   * Initialize state from current notes
   */
  async initializeState(): Promise<void> {
    const settings = this.getSettings();
    const bookNotes = this.app.vault.getMarkdownFiles().filter((f) =>
      f.path.startsWith(settings.calibreBookNotesFolder)
    );

    for (const file of bookNotes) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter || cache.frontmatter.type !== 'book') continue;

      const fm = cache.frontmatter as Record<string, unknown>;
      const calibreId = fm.calibreId as number;

      if (calibreId) {
        this.lastKnownState.set(calibreId, {
          calibreId,
          bookId: fm.bookId as string,
          status: (fm.status as string) || 'to-read',
          progress: (fm.progress as number) || 0,
          rating: fm.rating as number | undefined,
          tags: (fm.tags as string[]) || [],
          lastSync: (fm.lastSync as string) || '',
        });
      }
    }
  }

  /**
   * Get all pending changes
   */
  getPendingChanges(): SyncChange[] {
    return Array.from(this.pendingChanges.values());
  }

  /**
   * Mark a change as synced
   */
  markSynced(changeId: string): void {
    const change = this.pendingChanges.get(changeId);
    if (change) {
      change.synced = true;
      this.pendingChanges.delete(changeId);
    }
  }

  /**
   * Clear all pending changes
   */
  clearPending(): void {
    this.pendingChanges.clear();
  }
}
