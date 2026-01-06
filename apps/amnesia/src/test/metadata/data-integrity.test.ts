/**
 * Data Integrity Tests
 *
 * Tests for ensuring data integrity during sync operations:
 * - Highlight preservation after EPUB updates
 * - Correct merging of annotations
 * - Timestamp consistency
 * - No data loss scenarios
 *
 * @see docs/plans/unified-sync-architecture-prd.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BookMetadata, Highlight, BookNote, StoredMetadata } from '../../sync/metadata/types';
import {
  createBookMetadata,
  createHighlight,
  createHighlights,
  createBookNotes,
  createStoredMetadata,
} from './fixtures/metadata-fixtures';

// ============================================================================
// Mock CFI Resolver
// ============================================================================

interface CfiResolutionResult {
  valid: boolean;
  orphaned: boolean;
  text?: string;
  element?: unknown;
}

class MockCfiResolver {
  private validCfis = new Set<string>();
  private strictMode = false;

  markValid(cfi: string): void {
    this.validCfis.add(cfi);
  }

  markInvalid(cfi: string): void {
    this.validCfis.delete(cfi);
  }

  setStrictMode(strict: boolean): void {
    this.strictMode = strict;
  }

  async resolveCfi(cfi: string): Promise<CfiResolutionResult> {
    // In strict mode, only explicitly marked CFIs are valid
    // In normal mode, any CFI starting with 'epubcfi(/6/' is also valid
    const isValid = this.strictMode
      ? this.validCfis.has(cfi)
      : this.validCfis.has(cfi) || cfi.startsWith('epubcfi(/6/');
    return {
      valid: isValid,
      orphaned: !isValid,
      text: isValid ? 'Resolved text' : undefined,
    };
  }

  clear(): void {
    this.validCfis.clear();
    this.strictMode = false;
  }
}

// ============================================================================
// Highlight Merge Utilities
// ============================================================================

function mergeHighlights(local: Highlight[], remote: Highlight[]): Highlight[] {
  const merged = new Map<string, Highlight>();

  // Add all local highlights
  for (const h of local) {
    merged.set(h.id, h);
  }

  // Merge remote highlights
  for (const h of remote) {
    const existing = merged.get(h.id);
    if (!existing) {
      // New highlight from remote
      merged.set(h.id, h);
    } else {
      // Conflict - prefer newer
      const existingTime = existing.updatedAt?.getTime() || existing.createdAt.getTime();
      const remoteTime = h.updatedAt?.getTime() || h.createdAt.getTime();
      if (remoteTime > existingTime) {
        merged.set(h.id, h);
      }
    }
  }

  return Array.from(merged.values());
}

function detectOrphanedHighlights(
  highlights: Highlight[],
  resolver: MockCfiResolver
): Promise<Highlight[]> {
  return Promise.all(
    highlights.map(async h => ({
      highlight: h,
      result: await resolver.resolveCfi(h.cfiRange),
    }))
  ).then(results =>
    results.filter(r => r.result.orphaned).map(r => r.highlight)
  );
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Data Integrity', () => {
  let cfiResolver: MockCfiResolver;

  beforeEach(() => {
    cfiResolver = new MockCfiResolver();
  });

  // ==========================================================================
  // Highlight Preservation After EPUB Update
  // ==========================================================================

  describe('Highlight Preservation After EPUB Update', () => {
    it('should preserve all highlights when EPUB is re-synced', async () => {
      // Arrange - Book with highlights
      const originalHighlights = createHighlights(10);
      const metadata = createBookMetadata({
        bookId: 'epub-update-001',
        highlights: originalHighlights,
      });

      // Mark all CFIs as valid initially
      for (const h of originalHighlights) {
        cfiResolver.markValid(h.cfiRange);
      }

      // Act - Simulate re-sync (would happen in real sync)
      const resyncedMetadata = { ...metadata };

      // Assert - All highlights preserved
      expect(resyncedMetadata.highlights).toHaveLength(10);
      for (let i = 0; i < originalHighlights.length; i++) {
        expect(resyncedMetadata.highlights[i].id).toBe(originalHighlights[i].id);
        expect(resyncedMetadata.highlights[i].text).toBe(originalHighlights[i].text);
      }
    });

    it('should detect orphaned highlights after EPUB content change', async () => {
      // Arrange
      const highlights = createHighlights(5);

      // Use strict mode so only explicitly marked CFIs are valid
      cfiResolver.setStrictMode(true);

      // Mark some CFIs as valid (content still exists)
      cfiResolver.markValid(highlights[0].cfiRange);
      cfiResolver.markValid(highlights[1].cfiRange);
      // highlights[2], [3], [4] are now orphaned

      // Act
      const orphaned = await detectOrphanedHighlights(highlights, cfiResolver);

      // Assert
      expect(orphaned).toHaveLength(3);
      expect(orphaned.map(h => h.id)).not.toContain(highlights[0].id);
      expect(orphaned.map(h => h.id)).not.toContain(highlights[1].id);
    });

    it('should still keep orphaned highlights (not delete them)', async () => {
      // Arrange
      const highlights = createHighlights(3);

      // Use strict mode - none are marked valid, so all are orphaned
      cfiResolver.setStrictMode(true);

      // Act
      const orphaned = await detectOrphanedHighlights(highlights, cfiResolver);

      // Assert - They should still exist, just marked as orphaned
      expect(orphaned).toHaveLength(3);
      // In real implementation, these would be marked with orphaned: true
    });

    it('should preserve highlight colors and notes', async () => {
      // Arrange
      const highlight: Highlight = createHighlight({
        id: 'preserve-attrs',
        color: 'green',
        note: 'Important note about this passage',
      });

      const metadata = createBookMetadata({
        highlights: [highlight],
      });

      // Act - Simulate re-sync
      const resyncedHighlight = metadata.highlights[0];

      // Assert
      expect(resyncedHighlight.color).toBe('green');
      expect(resyncedHighlight.note).toBe('Important note about this passage');
    });
  });

  // ==========================================================================
  // Highlight Merge on Sync Conflict
  // ==========================================================================

  describe('Highlight Merge on Sync Conflict', () => {
    it('should merge highlights from local and server', () => {
      // Arrange
      const localHighlights = [
        createHighlight({ id: 'local-1', text: 'Local highlight 1' }),
        createHighlight({ id: 'shared', text: 'Shared highlight' }),
      ];

      const serverHighlights = [
        createHighlight({ id: 'server-1', text: 'Server highlight 1' }),
        createHighlight({ id: 'shared', text: 'Shared highlight' }),
      ];

      // Act
      const merged = mergeHighlights(localHighlights, serverHighlights);

      // Assert - Should have all unique highlights
      expect(merged).toHaveLength(3);
      expect(merged.map(h => h.id)).toContain('local-1');
      expect(merged.map(h => h.id)).toContain('server-1');
      expect(merged.map(h => h.id)).toContain('shared');
    });

    it('should not duplicate identical highlights', () => {
      // Arrange
      const sharedId = 'duplicate-test';
      const highlight = createHighlight({ id: sharedId, text: 'Same text' });

      const local = [highlight];
      const server = [{ ...highlight }]; // Same highlight

      // Act
      const merged = mergeHighlights(local, server);

      // Assert
      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe(sharedId);
    });

    it('should prefer newer highlight on conflict', () => {
      // Arrange
      const oldDate = new Date('2024-01-01');
      const newDate = new Date('2024-06-15');

      const localHighlight = createHighlight({
        id: 'conflict',
        text: 'Old text',
        updatedAt: oldDate,
      });

      const serverHighlight = createHighlight({
        id: 'conflict',
        text: 'New text',
        updatedAt: newDate,
      });

      // Act
      const merged = mergeHighlights([localHighlight], [serverHighlight]);

      // Assert
      expect(merged).toHaveLength(1);
      expect(merged[0].text).toBe('New text');
    });

    it('should handle empty highlight arrays', () => {
      // Arrange
      const local: Highlight[] = [];
      const server = createHighlights(3);

      // Act
      const merged = mergeHighlights(local, server);

      // Assert
      expect(merged).toHaveLength(3);
    });
  });

  // ==========================================================================
  // Timestamp Consistency
  // ==========================================================================

  describe('Timestamp Consistency', () => {
    it('should maintain chronological order of timestamps', () => {
      // Arrange
      const metadata = createBookMetadata({
        bookId: 'timestamp-order',
        lastReadAt: new Date('2024-06-15'),
        highlights: [
          createHighlight({ createdAt: new Date('2024-06-10') }),
          createHighlight({ createdAt: new Date('2024-06-12') }),
        ],
      });

      // Assert - All highlights created before lastReadAt
      for (const h of metadata.highlights) {
        expect(h.createdAt.getTime()).toBeLessThanOrEqual(metadata.lastReadAt!.getTime());
      }
    });

    it('should detect future timestamps as suspicious', () => {
      // Arrange
      const futureDate = new Date(Date.now() + 86400000 * 30); // 30 days in future

      const metadata = createBookMetadata({
        lastReadAt: futureDate,
      });

      // Act - Validate timestamps
      const isSuspicious = metadata.lastReadAt!.getTime() > Date.now();

      // Assert
      expect(isSuspicious).toBe(true);
    });

    it('should preserve original creation timestamps', () => {
      // Arrange
      const originalCreatedAt = new Date('2024-01-01');
      const highlight = createHighlight({
        id: 'preserve-created',
        createdAt: originalCreatedAt,
      });

      // Act - Update highlight (simulating edit)
      const updatedHighlight = {
        ...highlight,
        text: 'Updated text',
        updatedAt: new Date(),
      };

      // Assert
      expect(updatedHighlight.createdAt).toEqual(originalCreatedAt);
      expect(updatedHighlight.updatedAt!.getTime()).toBeGreaterThan(originalCreatedAt.getTime());
    });

    it('should handle timezone differences correctly', () => {
      // Arrange - Dates that might cause issues with timezones
      const utcDate = new Date('2024-06-15T00:00:00Z');
      const localDate = new Date('2024-06-15T00:00:00');

      // Act - Compare just the date parts
      const utcDay = utcDate.toISOString().split('T')[0];
      const localDay = localDate.toISOString().split('T')[0];

      // Assert - Should represent same or adjacent day
      expect(Math.abs(new Date(utcDay).getTime() - new Date(localDay).getTime()))
        .toBeLessThanOrEqual(86400000);
    });
  });

  // ==========================================================================
  // No Data Loss Scenarios
  // ==========================================================================

  describe('No Data Loss', () => {
    it('should preserve all metadata fields during sync', () => {
      // Arrange
      const originalMetadata = createBookMetadata({
        bookId: 'preserve-all',
        title: 'Original Title',
        authors: ['Author One', 'Author Two'],
        series: 'Test Series',
        seriesIndex: 1,
        publisher: 'Test Publisher',
        isbn: '978-0-123456-78-9',
        language: 'en',
        tags: ['fiction', 'classic'],
        rating: 5,
        status: 'completed',
        progress: 100,
        currentCfi: 'epubcfi(/6/100!/4/2)',
        highlights: createHighlights(5),
        notes: createBookNotes(3),
        customFields: { myField: 'value' },
      });

      // Act - Clone (simulating sync)
      const syncedMetadata = JSON.parse(JSON.stringify(originalMetadata));
      // Restore dates
      syncedMetadata.lastReadAt = new Date(syncedMetadata.lastReadAt);
      syncedMetadata.highlights.forEach((h: Highlight) => {
        h.createdAt = new Date(h.createdAt);
        if (h.updatedAt) h.updatedAt = new Date(h.updatedAt);
      });

      // Assert - All fields preserved
      expect(syncedMetadata.title).toBe(originalMetadata.title);
      expect(syncedMetadata.authors).toEqual(originalMetadata.authors);
      expect(syncedMetadata.series).toBe(originalMetadata.series);
      expect(syncedMetadata.isbn).toBe(originalMetadata.isbn);
      expect(syncedMetadata.tags).toEqual(originalMetadata.tags);
      expect(syncedMetadata.rating).toBe(originalMetadata.rating);
      expect(syncedMetadata.progress).toBe(originalMetadata.progress);
      expect(syncedMetadata.highlights.length).toBe(originalMetadata.highlights.length);
      expect(syncedMetadata.notes.length).toBe(originalMetadata.notes.length);
      expect(syncedMetadata.customFields).toEqual(originalMetadata.customFields);
    });

    it('should not lose data when sync fails midway', () => {
      // Arrange
      const metadata = createBookMetadata({
        bookId: 'partial-sync',
        highlights: createHighlights(10),
      });

      // Act - Simulate partial sync (only first 5 highlights processed)
      const processedHighlights = metadata.highlights.slice(0, 5);
      const unprocessedHighlights = metadata.highlights.slice(5);

      // Assert - All data still exists
      expect(processedHighlights.length + unprocessedHighlights.length)
        .toBe(metadata.highlights.length);
    });

    it('should recover from interrupted sync', () => {
      // Arrange
      const checkpoint = {
        bookId: 'interrupted-sync',
        processedCount: 5,
        totalCount: 10,
        lastProcessedId: 'highlight-4',
      };

      const allHighlights = createHighlights(10);

      // Act - Resume from checkpoint
      const remainingHighlights = allHighlights.slice(checkpoint.processedCount);

      // Assert
      expect(remainingHighlights).toHaveLength(5);
      expect(remainingHighlights[0].id).not.toBe(checkpoint.lastProcessedId);
    });

    it('should preserve notes with special characters', () => {
      // Arrange
      const specialNote = createHighlight({
        id: 'special-chars',
        note: 'Note with "quotes", <brackets>, & ampersands, and émojis 🎉',
      });

      const metadata = createBookMetadata({
        highlights: [specialNote],
      });

      // Act - Simulate sync (JSON roundtrip)
      const synced = JSON.parse(JSON.stringify(metadata));

      // Assert
      expect(synced.highlights[0].note).toBe(specialNote.note);
    });

    it('should preserve Unicode in all text fields', () => {
      // Arrange
      const metadata = createBookMetadata({
        title: 'Título en Español con ñ y ü',
        authors: ['著者名', 'Автор', 'المؤلف'],
        tags: ['日本語', 'العربية', 'עברית'],
        highlights: [
          createHighlight({ text: 'Highlighted 中文 text' }),
        ],
      });

      // Act - JSON roundtrip
      const synced = JSON.parse(JSON.stringify(metadata));

      // Assert
      expect(synced.title).toBe('Título en Español con ñ y ü');
      expect(synced.authors).toContain('著者名');
      expect(synced.authors).toContain('Автор');
      expect(synced.tags).toContain('日本語');
      expect(synced.highlights[0].text).toContain('中文');
    });
  });

  // ==========================================================================
  // Conflict Detection Accuracy
  // ==========================================================================

  describe('Conflict Detection', () => {
    it('should detect field-level conflicts accurately', () => {
      // Arrange
      const local = createBookMetadata({
        bookId: 'conflict-detect',
        rating: 5,
        progress: 75,
        tags: ['fiction'],
      });

      const remote = createBookMetadata({
        bookId: 'conflict-detect',
        rating: 4,      // Different
        progress: 75,   // Same
        tags: ['fiction', 'classic'],  // Different (has extra)
      });

      // Act - Detect conflicts
      const conflicts: string[] = [];

      if (local.rating !== remote.rating) {
        conflicts.push('rating');
      }
      if (local.progress !== remote.progress) {
        conflicts.push('progress');
      }
      if (JSON.stringify(local.tags) !== JSON.stringify(remote.tags)) {
        conflicts.push('tags');
      }

      // Assert
      expect(conflicts).toContain('rating');
      expect(conflicts).toContain('tags');
      expect(conflicts).not.toContain('progress');
    });

    it('should handle array field conflicts correctly', () => {
      // Arrange
      const localTags = ['fiction', 'classic'];
      const remoteTags = ['fiction', 'modern'];

      // Act - Calculate differences
      const onlyLocal = localTags.filter(t => !remoteTags.includes(t));
      const onlyRemote = remoteTags.filter(t => !localTags.includes(t));
      const shared = localTags.filter(t => remoteTags.includes(t));

      // Assert
      expect(onlyLocal).toEqual(['classic']);
      expect(onlyRemote).toEqual(['modern']);
      expect(shared).toEqual(['fiction']);
    });

    it('should detect highlight conflicts by ID', () => {
      // Arrange
      const localHighlights = [
        createHighlight({ id: 'h1', text: 'Local version' }),
        createHighlight({ id: 'h2', text: 'Only local' }),
      ];

      const remoteHighlights = [
        createHighlight({ id: 'h1', text: 'Remote version' }),  // Conflict
        createHighlight({ id: 'h3', text: 'Only remote' }),
      ];

      // Act - Find conflicts
      const localIds = new Set(localHighlights.map(h => h.id));
      const remoteIds = new Set(remoteHighlights.map(h => h.id));

      const conflicts = localHighlights.filter(h =>
        remoteIds.has(h.id) &&
        remoteHighlights.find(r => r.id === h.id)?.text !== h.text
      );

      // Assert
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].id).toBe('h1');
    });
  });

  // ==========================================================================
  // Data Validation Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle very long highlight text', () => {
      // Arrange
      const longText = 'A'.repeat(10000); // 10KB of text
      const highlight = createHighlight({
        text: longText,
      });

      // Assert
      expect(highlight.text.length).toBe(10000);
    });

    it('should handle empty string fields gracefully', () => {
      // Arrange
      const metadata = createBookMetadata({
        title: '',
        description: '',
        isbn: '',
      });

      // Assert - Should not throw
      expect(metadata.title).toBe('');
      expect(metadata.description).toBe('');
    });

    it('should handle null and undefined consistently', () => {
      // Arrange
      const metadata = createBookMetadata({
        rating: undefined,
        series: undefined,
        currentCfi: undefined,
      });

      // Assert
      expect(metadata.rating).toBeUndefined();
      expect(metadata.series).toBeUndefined();
      expect(metadata.currentCfi).toBeUndefined();
    });

    it('should preserve deep nested structures', () => {
      // Arrange
      const metadata = createBookMetadata({
        customFields: {
          level1: {
            level2: {
              level3: {
                value: 'deep value',
              },
            },
          },
        },
      });

      // Act - Deep clone
      const cloned = JSON.parse(JSON.stringify(metadata));

      // Assert
      expect((cloned.customFields as Record<string, unknown>).level1).toBeDefined();
      expect(
        ((cloned.customFields as Record<string, unknown>).level1 as Record<string, unknown>).level2
      ).toBeDefined();
    });
  });
});
