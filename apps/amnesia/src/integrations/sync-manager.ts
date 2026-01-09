/**
 * Annotation Sync Manager
 *
 * Handles bidirectional synchronization between Amnesia highlights and
 * Doc Doctor stubs. Provides batch sync, conflict resolution, and
 * deduplication logic.
 *
 * @module integrations/sync-manager
 */

import type { App } from 'obsidian';
import type AmnesiaPlugin from '../main';
import type { Highlight } from '../library/types';
import type { DocDoctorBridge, DocDoctorStub, BookHealth } from './doc-doctor-bridge';
import { type AnnotationType, ANNOTATION_TYPES, isValidAnnotationType } from '@shared/annotations';
import { ConflictResolver, type ConflictStrategy, type ResolvedConflict } from './conflict-resolver';
import { DeduplicationManager, type DuplicateMatch } from './deduplication';
import {
  KnowledgeGapFilter,
  KNOWLEDGE_GAP_TYPES,
  INSIGHT_TYPES,
} from './knowledge-gap-filter';

/**
 * Sync result for a single highlight
 */
export interface SyncResult {
  status: 'synced' | 'already-synced' | 'skipped' | 'error' | 'conflict';
  highlightId: string;
  stubId?: string;
  error?: string;
  conflict?: ResolvedConflict;
}

/**
 * Batch sync result
 */
export interface BatchSyncResult {
  total: number;
  synced: number;
  alreadySynced: number;
  skipped: number;
  errors: number;
  conflicts: number;
  results: SyncResult[];
  duration: number;
}

/**
 * Sync statistics
 */
export interface SyncStats {
  lastSyncAt?: Date;
  totalSynced: number;
  totalErrors: number;
  totalConflicts: number;
  pendingSync: number;
}

/**
 * Sync event map
 */
export interface SyncEventMap {
  'sync-started': { highlightId: string };
  'sync-completed': { result: SyncResult };
  'batch-started': { total: number };
  'batch-progress': { current: number; total: number };
  'batch-completed': { result: BatchSyncResult };
  'conflict-detected': { highlightId: string; stubId: string };
  'conflict-resolved': { highlightId: string; resolution: ResolvedConflict };
}

/**
 * Annotation Sync Manager
 *
 * Coordinates bidirectional sync between Amnesia highlights and Doc Doctor stubs.
 */
export class AnnotationSyncManager {
  private conflictResolver: ConflictResolver;
  private deduplicationManager: DeduplicationManager;
  private knowledgeGapFilter: KnowledgeGapFilter;
  private listeners = new Map<keyof SyncEventMap, Set<(data: any) => void>>();
  private syncInProgress = false;
  /**
   * Flag to prevent sync loops when updating highlights from within sync operations.
   * When true, highlight updates should not trigger auto-sync.
   */
  private _isInternalUpdate = false;
  private stats: SyncStats = {
    totalSynced: 0,
    totalErrors: 0,
    totalConflicts: 0,
    pendingSync: 0,
  };

  /**
   * Check if current update is from internal sync operation.
   * External code (e.g., auto-sync listener) should check this to prevent sync loops.
   */
  isInternalUpdate(): boolean {
    return this._isInternalUpdate;
  }

  /**
   * Get the knowledge gap filter for external use.
   */
  getKnowledgeGapFilter(): KnowledgeGapFilter {
    return this.knowledgeGapFilter;
  }

  /**
   * Check if a highlight is eligible for sync (knowledge gap only).
   */
  getSyncEligibility(highlight: Highlight): { eligible: boolean; reason?: string } {
    return this.knowledgeGapFilter.getSyncEligibility(highlight);
  }

  constructor(
    private plugin: AmnesiaPlugin,
    private bridge: DocDoctorBridge,
    private app: App
  ) {
    this.conflictResolver = new ConflictResolver();
    this.deduplicationManager = new DeduplicationManager();
    this.knowledgeGapFilter = new KnowledgeGapFilter();
  }

  /**
   * Check if sync is currently in progress
   */
  isSyncing(): boolean {
    return this.syncInProgress;
  }

  /**
   * Get sync statistics
   */
  getStats(): SyncStats {
    return { ...this.stats };
  }

  /**
   * Get the conflict resolution strategy from settings
   */
  private getConflictStrategy(): ConflictStrategy {
    return this.plugin.settings.docDoctorSync?.conflictStrategy ?? 'newest-wins';
  }

  // ==========================================================================
  // Amnesia → Doc Doctor Sync
  // ==========================================================================

  /**
   * Sync a single highlight to Doc Doctor as a stub.
   *
   * CRITICAL: Only knowledge-gap highlights (verify, expand, clarify, question)
   * should create stubs. Insight types (important, citation) are NOT gaps and
   * stay in Amnesia only.
   *
   * PRD Principle: "Stubs (knowledge gaps) !== Annotations (captured insights)"
   */
  async syncHighlightToStub(highlight: Highlight): Promise<SyncResult> {
    // CRITICAL: Check if this is a knowledge gap type FIRST
    // Only knowledge gaps should create stubs in Doc Doctor
    if (!this.knowledgeGapFilter.isKnowledgeGap(highlight)) {
      const skipReason = this.knowledgeGapFilter.getSkipReason(highlight);
      return {
        status: 'skipped',
        highlightId: highlight.id,
        error: skipReason ?? 'Not a knowledge gap type - no stub needed',
      };
    }

    if (!this.bridge.isConnected()) {
      return {
        status: 'error',
        highlightId: highlight.id,
        error: 'Doc Doctor not connected',
      };
    }

    // Check if already synced
    if (highlight.syncedToDocDoctor && highlight.docDoctorStubId) {
      return {
        status: 'already-synced',
        highlightId: highlight.id,
        stubId: highlight.docDoctorStubId,
      };
    }

    this.emit('sync-started', { highlightId: highlight.id });

    try {
      // Get book note path for anchoring
      const bookNotePath = await this.getBookNotePath(highlight.bookId);
      if (!bookNotePath) {
        return {
          status: 'skipped',
          highlightId: highlight.id,
          error: 'No book note found for highlight',
        };
      }

      // Check for existing stub (deduplication)
      const existingStubs = await this.bridge.listStubs(bookNotePath);
      const duplicate = this.deduplicationManager.findDuplicateStub(
        highlight,
        existingStubs
      );

      if (duplicate) {
        // Link to existing stub instead of creating new one
        await this.updateHighlightSyncState(highlight, duplicate.stub.id);

        const result: SyncResult = {
          status: 'already-synced',
          highlightId: highlight.id,
          stubId: duplicate.stub.id,
        };
        this.emit('sync-completed', { result });
        return result;
      }

      // Validate and get annotation type (with fallback)
      const stubType: AnnotationType = (
        highlight.category && isValidAnnotationType(highlight.category)
      ) ? highlight.category : 'verify';

      // Create new stub
      const stub = await this.bridge.createStub({
        type: stubType,
        description: highlight.text,
        filePath: bookNotePath,
        anchor: `^hl-${highlight.id}`,
        source: {
          plugin: 'amnesia',
          highlightId: highlight.id,
        },
      });

      if (!stub) {
        return {
          status: 'error',
          highlightId: highlight.id,
          error: 'Failed to create stub in Doc Doctor',
        };
      }

      // Update highlight with sync state
      await this.updateHighlightSyncState(highlight, stub.id);

      this.stats.totalSynced++;
      this.stats.lastSyncAt = new Date();

      const result: SyncResult = {
        status: 'synced',
        highlightId: highlight.id,
        stubId: stub.id,
      };

      this.emit('sync-completed', { result });
      return result;
    } catch (error) {
      this.stats.totalErrors++;
      const result: SyncResult = {
        status: 'error',
        highlightId: highlight.id,
        error: error instanceof Error ? error.message : String(error),
      };
      this.emit('sync-completed', { result });
      return result;
    }
  }

  /**
   * Batch sync multiple highlights to Doc Doctor
   */
  async batchSyncHighlights(highlights: Highlight[]): Promise<BatchSyncResult> {
    if (this.syncInProgress) {
      return {
        total: highlights.length,
        synced: 0,
        alreadySynced: 0,
        skipped: 0,
        errors: highlights.length,
        conflicts: 0,
        results: highlights.map(h => ({
          status: 'error' as const,
          highlightId: h.id,
          error: 'Sync already in progress',
        })),
        duration: 0,
      };
    }

    this.syncInProgress = true;
    const startTime = performance.now();
    this.emit('batch-started', { total: highlights.length });

    const results: SyncResult[] = [];
    let synced = 0;
    let alreadySynced = 0;
    let skipped = 0;
    let errors = 0;
    let conflicts = 0;

    try {
      for (let i = 0; i < highlights.length; i++) {
        const highlight = highlights[i];
        this.emit('batch-progress', { current: i + 1, total: highlights.length });

        const result = await this.syncHighlightToStub(highlight);
        results.push(result);

        switch (result.status) {
          case 'synced':
            synced++;
            break;
          case 'already-synced':
            alreadySynced++;
            break;
          case 'skipped':
            skipped++;
            break;
          case 'error':
            errors++;
            break;
          case 'conflict':
            conflicts++;
            break;
        }

        // Small delay to prevent overwhelming Doc Doctor
        if (i < highlights.length - 1) {
          await this.delay(50);
        }
      }
    } finally {
      this.syncInProgress = false;
    }

    const duration = performance.now() - startTime;

    const batchResult: BatchSyncResult = {
      total: highlights.length,
      synced,
      alreadySynced,
      skipped,
      errors,
      conflicts,
      results,
      duration,
    };

    this.emit('batch-completed', { result: batchResult });
    return batchResult;
  }

  /**
   * Sync all unsynced knowledge-gap highlights for a book.
   *
   * Only syncs knowledge-gap types (verify, expand, clarify, question).
   * Insights (important, citation) are NOT synced.
   */
  async syncBookHighlights(bookId: string): Promise<BatchSyncResult> {
    const unsyncedHighlights = this.plugin.highlightService.getUnsyncedHighlights(bookId);
    // Pre-filter to only knowledge gaps (performance optimization)
    const knowledgeGaps = this.knowledgeGapFilter.filterSyncableHighlights(unsyncedHighlights);
    return this.batchSyncHighlights(knowledgeGaps);
  }

  /**
   * Sync all unsynced knowledge-gap highlights across all books.
   *
   * Only syncs knowledge-gap types (verify, expand, clarify, question).
   * Insights (important, citation) are NOT synced.
   */
  async syncAllHighlights(): Promise<BatchSyncResult> {
    const unsyncedHighlights = this.plugin.highlightService.getUnsyncedHighlights();
    // Pre-filter to only knowledge gaps (performance optimization)
    const knowledgeGaps = this.knowledgeGapFilter.filterSyncableHighlights(unsyncedHighlights);
    return this.batchSyncHighlights(knowledgeGaps);
  }

  /**
   * Get unsynced knowledge-gap highlights.
   * Useful for UI to show what will be synced.
   */
  getUnsyncedKnowledgeGaps(bookId?: string): Highlight[] {
    const unsyncedHighlights = bookId
      ? this.plugin.highlightService.getUnsyncedHighlights(bookId)
      : this.plugin.highlightService.getUnsyncedHighlights();
    return this.knowledgeGapFilter.filterSyncableHighlights(unsyncedHighlights);
  }

  /**
   * Get unsynced insight highlights (Amnesia-only).
   * These will NOT be synced - they are complete annotations.
   */
  getUnsyncedInsights(bookId?: string): Highlight[] {
    const unsyncedHighlights = bookId
      ? this.plugin.highlightService.getUnsyncedHighlights(bookId)
      : this.plugin.highlightService.getUnsyncedHighlights();
    return this.knowledgeGapFilter.filterInsightHighlights(unsyncedHighlights);
  }

  // ==========================================================================
  // Doc Doctor → Amnesia Sync
  // ==========================================================================

  /**
   * Handle stub resolution from Doc Doctor
   *
   * When a stub is resolved in Doc Doctor, propagate the resolution
   * to the linked Amnesia highlight.
   */
  async syncStubResolution(stub: DocDoctorStub): Promise<SyncResult> {
    // Find linked highlight
    const highlight = await this.findHighlightByStubId(stub.id);

    if (!highlight) {
      return {
        status: 'skipped',
        highlightId: '',
        error: 'No linked highlight found for stub',
      };
    }

    try {
      // Check for conflicts
      const hasConflict = this.detectResolutionConflict(highlight, stub);

      if (hasConflict) {
        this.emit('conflict-detected', {
          highlightId: highlight.id,
          stubId: stub.id,
        });

        const resolution = this.conflictResolver.resolveResolutionConflict(
          highlight,
          stub,
          this.getConflictStrategy()
        );

        this.emit('conflict-resolved', {
          highlightId: highlight.id,
          resolution,
        });

        if (resolution.winner === 'amnesia') {
          // Keep Amnesia's version, don't apply stub resolution
          return {
            status: 'conflict',
            highlightId: highlight.id,
            stubId: stub.id,
            conflict: resolution,
          };
        }
      }

      // Apply stub resolution to highlight
      const existingAnnotation = highlight.annotation?.trim() || '';
      const resolutionText = stub.resolution
        ? `\n\n[Resolved] ${stub.resolution}`
        : '';
      const newAnnotation = existingAnnotation
        ? `${existingAnnotation}${resolutionText}`
        : resolutionText.trim();

      // Add 'resolved' tag if not present
      const tags = highlight.tags ?? [];
      if (!tags.includes('resolved')) {
        tags.push('resolved');
      }

      // Use internal update flag to prevent sync loops
      this._isInternalUpdate = true;
      try {
        await this.plugin.highlightService.updateHighlight(
          highlight.bookId,
          highlight.id,
          {
            annotation: newAnnotation || highlight.annotation,
            tags,
            lastSyncedAt: Date.now(),
          }
        );
      } finally {
        this._isInternalUpdate = false;
      }

      return {
        status: 'synced',
        highlightId: highlight.id,
        stubId: stub.id,
      };
    } catch (error) {
      return {
        status: 'error',
        highlightId: highlight.id,
        stubId: stub.id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Sync stub updates from Doc Doctor to Amnesia
   */
  async syncStubUpdate(stub: DocDoctorStub): Promise<SyncResult> {
    const highlight = await this.findHighlightByStubId(stub.id);

    if (!highlight) {
      return {
        status: 'skipped',
        highlightId: '',
        error: 'No linked highlight found for stub',
      };
    }

    try {
      // Check for conflicts based on timestamps
      if (highlight.lastSyncedAt && stub.updatedAt) {
        const stubUpdateTime = new Date(stub.updatedAt).getTime();
        if (highlight.updatedAt.getTime() > stubUpdateTime) {
          // Highlight was updated more recently, potential conflict
          const resolution = this.conflictResolver.resolveUpdateConflict(
            highlight,
            stub,
            this.getConflictStrategy()
          );

          if (resolution.winner === 'amnesia') {
            return {
              status: 'conflict',
              highlightId: highlight.id,
              stubId: stub.id,
              conflict: resolution,
            };
          }
        }
      }

      // Apply stub type change if different and stub type is valid
      if (stub.type !== highlight.category && isValidAnnotationType(stub.type)) {
        this._isInternalUpdate = true;
        try {
          await this.plugin.highlightService.updateHighlight(
            highlight.bookId,
            highlight.id,
            {
              category: stub.type,
              lastSyncedAt: Date.now(),
            }
          );
        } finally {
          this._isInternalUpdate = false;
        }
      }

      return {
        status: 'synced',
        highlightId: highlight.id,
        stubId: stub.id,
      };
    } catch (error) {
      return {
        status: 'error',
        highlightId: highlight.id,
        stubId: stub.id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Conflict Detection & Resolution
  // ==========================================================================

  /**
   * Detect if there's a conflict when applying stub resolution.
   * A conflict occurs when BOTH the highlight AND the stub have been
   * modified since the last sync. This prevents false positives where
   * only one side changed.
   */
  private detectResolutionConflict(
    highlight: Highlight,
    stub: DocDoctorStub
  ): boolean {
    if (!highlight.lastSyncedAt) return false;

    const lastSyncTime = highlight.lastSyncedAt;
    const highlightUpdateTime = highlight.updatedAt.getTime();
    const stubUpdateTime = stub.updatedAt.getTime();

    // True conflict: BOTH sides modified since last sync
    const highlightModified = highlightUpdateTime > lastSyncTime;
    const stubModified = stubUpdateTime > lastSyncTime;

    return highlightModified && stubModified;
  }

  /**
   * Get book health from Doc Doctor
   */
  async getBookHealth(bookId: string): Promise<BookHealth | null> {
    const bookNotePath = await this.getBookNotePath(bookId);
    if (!bookNotePath) return null;
    return this.bridge.getBookHealth(bookNotePath);
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Update highlight sync state.
   * Sets _isInternalUpdate flag to prevent sync loops.
   */
  private async updateHighlightSyncState(
    highlight: Highlight,
    stubId: string
  ): Promise<void> {
    this._isInternalUpdate = true;
    try {
      await this.plugin.highlightService.updateHighlight(
        highlight.bookId,
        highlight.id,
        {
          syncedToDocDoctor: true,
          docDoctorStubId: stubId,
          lastSyncedAt: Date.now(),
        }
      );
    } finally {
      this._isInternalUpdate = false;
    }
  }

  /**
   * Find highlight by Doc Doctor stub ID
   */
  private async findHighlightByStubId(stubId: string): Promise<Highlight | null> {
    const allHighlights = this.plugin.highlightService.queryHighlights({});
    return allHighlights.find(h => h.docDoctorStubId === stubId) ?? null;
  }

  /**
   * Get book note path for a book ID
   */
  private async getBookNotePath(bookId: string): Promise<string | null> {
    const book = this.plugin.libraryService.getBook(bookId);
    if (!book) return null;

    const minimalBook = {
      id: book.id,
      title: book.title,
      authors: book.author ? [{ name: book.author }] : [],
      sources: [],
      formats: [],
      tags: [],
      status: 'to-read' as const,
      progress: 0,
      addedAt: new Date(),
    };

    const notePath = this.plugin.bookNoteGenerator.getNotePath(minimalBook);
    const file = this.app.vault.getAbstractFileByPath(notePath);
    return file ? notePath : null;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==========================================================================
  // Event System
  // ==========================================================================

  /**
   * Subscribe to sync events
   */
  on<K extends keyof SyncEventMap>(
    event: K,
    handler: (data: SyncEventMap[K]) => void
  ): { dispose: () => void } {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    return {
      dispose: () => {
        this.listeners.get(event)?.delete(handler);
      },
    };
  }

  /**
   * Emit sync event
   */
  private emit<K extends keyof SyncEventMap>(
    event: K,
    data: SyncEventMap[K]
  ): void {
    this.listeners.get(event)?.forEach(handler => handler(data));
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.listeners.clear();
  }
}

/**
 * Create sync manager instance
 */
export function createSyncManager(
  plugin: AmnesiaPlugin,
  bridge: DocDoctorBridge
): AnnotationSyncManager {
  return new AnnotationSyncManager(plugin, bridge, plugin.app);
}
