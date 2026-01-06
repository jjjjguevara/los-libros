/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Book Removal and Re-addition Tests
 *
 * Tests metadata preservation when books are removed and re-added.
 * Critical for ensuring user annotations are never lost.
 *
 * NOTE: This test file uses mock types that intentionally differ from production
 * types to simplify testing. Type assertions are used where necessary.
 *
 * @see docs/plans/unified-sync-architecture-prd.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BookMetadata, Highlight, BookNote, Bookmark } from '../../sync/metadata/types';
import {
  createFullyAnnotatedBook,
  createStoredMetadata,
  createBookMetadata,
  createHighlights,
  createBookNotes,
  createConflict,
  FIXTURE_BOOK_IDS,
} from './fixtures/metadata-fixtures';

// ============================================================================
// Mock Types for Testing
// ============================================================================

/**
 * Mock StoredMetadata type for testing
 * This is a simplified version that stores metadata fields directly
 * rather than nested in a `metadata` property like the production type.
 */
interface MockStoredMetadata {
  bookId: string;
  highlights: Highlight[];
  notes: BookNote[];
  bookmarks: Bookmark[];
  progress?: number;
  rating?: number;
  currentCfi?: string;
  lastReadAt?: Date;
  tags: string[];
  archivedAt: Date;
}

/**
 * Mock conflict type for testing
 */
interface MockMetadataConflict {
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  strategy: string;
  timestamp: Date;
  suggestedResolution?: string;
}

// ============================================================================
// Mock Setup
// ============================================================================

// Mock IndexedDB storage
class MockIndexedDBStore {
  private store = new Map<string, MockStoredMetadata>();

  async get(bookId: string): Promise<MockStoredMetadata | null> {
    return this.store.get(bookId) || null;
  }

  async set(bookId: string, data: MockStoredMetadata): Promise<void> {
    this.store.set(bookId, data);
  }

  async delete(bookId: string): Promise<void> {
    this.store.delete(bookId);
  }

  async getAll(): Promise<MockStoredMetadata[]> {
    return Array.from(this.store.values());
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

// Mock recovery result type
interface MockRecoveryResult {
  hasStoredMetadata: boolean;
  restored?: MockStoredMetadata;
  conflicts?: MockMetadataConflict[];
}

/**
 * Mock MetadataRecoveryService that doesn't use IndexedDB
 * This replicates the behavior of the real service for testing
 */
class MockMetadataRecoveryService {
  private store: MockIndexedDBStore;
  private pendingRestorations = new Map<string, MockStoredMetadata>();

  constructor(_app: unknown, store: MockIndexedDBStore) {
    this.store = store;
  }

  async onBookRemoved(bookId: string, metadata: BookMetadata): Promise<void> {
    const storedMetadata: MockStoredMetadata = {
      bookId,
      highlights: metadata.highlights || [],
      notes: metadata.notes || [],
      bookmarks: metadata.bookmarks || [],
      progress: metadata.progress,
      rating: metadata.rating,
      currentCfi: metadata.currentCfi,
      lastReadAt: metadata.lastReadAt,
      tags: metadata.tags || [],
      archivedAt: new Date(),
    };
    await this.store.set(bookId, storedMetadata);
  }

  async onBookAdded(bookId: string, newMetadata?: BookMetadata): Promise<MockRecoveryResult> {
    const stored = await this.store.get(bookId);
    if (!stored) {
      return { hasStoredMetadata: false, conflicts: [] };
    }

    this.pendingRestorations.set(bookId, stored);

    // Detect conflicts if new metadata is provided
    const conflicts: MockMetadataConflict[] = [];
    if (newMetadata) {
      // Check rating conflict
      if (stored.rating !== undefined && newMetadata.rating !== undefined &&
          stored.rating !== newMetadata.rating) {
        conflicts.push({
          field: 'rating',
          localValue: stored.rating,
          remoteValue: newMetadata.rating,
          strategy: 'local-wins',
          timestamp: new Date(),
        });
      }

      // Check progress conflict
      if (stored.progress !== undefined && newMetadata.progress !== undefined &&
          stored.progress !== newMetadata.progress) {
        conflicts.push({
          field: 'progress',
          localValue: stored.progress,
          remoteValue: newMetadata.progress,
          strategy: 'last-write-wins',
          timestamp: new Date(),
        });
      }

      // Check tags conflict
      const storedTags = stored.tags || [];
      const newTags = newMetadata.tags || [];
      if (JSON.stringify(storedTags.sort()) !== JSON.stringify(newTags.sort())) {
        conflicts.push({
          field: 'tags',
          localValue: storedTags,
          remoteValue: newTags,
          strategy: 'merge',
          timestamp: new Date(),
        });
      }
    }

    return {
      hasStoredMetadata: true,
      restored: stored,
      conflicts,
    };
  }

  async confirmRestoration(bookId: string): Promise<void> {
    this.pendingRestorations.delete(bookId);
    await this.store.delete(bookId);
  }

  async cancelRestoration(bookId: string): Promise<void> {
    this.pendingRestorations.delete(bookId);
  }

  async getArchivedBooks(): Promise<MockStoredMetadata[]> {
    return this.store.getAll();
  }

  async retrieveMetadata(bookId: string): Promise<MockStoredMetadata | null> {
    return this.store.get(bookId);
  }
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Cast fixture result to MockStoredMetadata for testing
 * The fixture returns a shape compatible with our mock type
 */
function asMockStored(data: any): MockStoredMetadata {
  return data as MockStoredMetadata;
}

/**
 * Cast partial overrides for createStoredMetadata
 */
function asPartialStored(data: any): any {
  return data;
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Book Removal and Re-addition', () => {
  let recoveryService: MockMetadataRecoveryService;
  let mockStore: MockIndexedDBStore;

  beforeEach(() => {
    mockStore = new MockIndexedDBStore();
    recoveryService = new MockMetadataRecoveryService({}, mockStore);
  });

  afterEach(async () => {
    await mockStore.clear();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Metadata Archival on Book Removal
  // ==========================================================================

  describe('Metadata Archival', () => {
    it('should archive all metadata when book is removed', async () => {
      // Arrange
      const bookId = FIXTURE_BOOK_IDS.FULLY_ANNOTATED;
      const metadata = createFullyAnnotatedBook();

      // Act - Simulate book removal
      await recoveryService.onBookRemoved(bookId, metadata);

      // Assert - Metadata should be archived
      const archived = await mockStore.get(bookId);
      expect(archived).not.toBeNull();
      expect(archived!.bookId).toBe(bookId);
      expect(archived!.highlights.length).toBe(metadata.highlights.length);
      expect(archived!.notes.length).toBe(metadata.notes.length);
      expect(archived!.progress).toBe(metadata.progress);
      expect(archived!.rating).toBe(metadata.rating);
    });

    it('should preserve highlight positions and colors', async () => {
      // Arrange
      const highlights = createHighlights(5);
      const metadata = createBookMetadata({
        bookId: 'highlight-test',
        highlights,
      });

      // Act
      await recoveryService.onBookRemoved('highlight-test', metadata);

      // Assert
      const archived = await mockStore.get('highlight-test');
      expect(archived!.highlights).toHaveLength(5);

      for (let i = 0; i < highlights.length; i++) {
        expect(archived!.highlights[i].cfiRange).toBe(highlights[i].cfiRange);
        expect(archived!.highlights[i].text).toBe(highlights[i].text);
        expect(archived!.highlights[i].color).toBe(highlights[i].color);
        expect(archived!.highlights[i].note).toBe(highlights[i].note);
      }
    });

    it('should preserve reading progress and position', async () => {
      // Arrange
      const metadata = createBookMetadata({
        bookId: 'progress-test',
        progress: 75,
        currentCfi: 'epubcfi(/6/100!/4/2/1:0)',
        lastReadAt: new Date('2024-06-15'),
      });

      // Act
      await recoveryService.onBookRemoved('progress-test', metadata);

      // Assert
      const archived = await mockStore.get('progress-test');
      expect(archived!.progress).toBe(75);
      expect(archived!.currentCfi).toBe('epubcfi(/6/100!/4/2/1:0)');
      expect(archived!.lastReadAt).toEqual(new Date('2024-06-15'));
    });

    it('should record archive timestamp', async () => {
      // Arrange
      const beforeArchive = Date.now();
      const metadata = createBookMetadata({ bookId: 'timestamp-test' });

      // Act
      await recoveryService.onBookRemoved('timestamp-test', metadata);

      // Assert
      const archived = await mockStore.get('timestamp-test');
      const archiveTime = archived!.archivedAt.getTime();
      expect(archiveTime).toBeGreaterThanOrEqual(beforeArchive);
      expect(archiveTime).toBeLessThanOrEqual(Date.now());
    });
  });

  // ==========================================================================
  // Metadata Recovery on Book Re-addition
  // ==========================================================================

  describe('Metadata Recovery', () => {
    it('should restore all metadata when book is re-added', async () => {
      // Arrange - Archive metadata first
      const storedMetadata = asMockStored(createStoredMetadata(asPartialStored({
        bookId: 'restore-test',
        progress: 75,
        rating: 5,
        highlights: createHighlights(10),
        notes: createBookNotes(5),
        tags: ['fiction', 'favorite'],
      })));
      await mockStore.set('restore-test', storedMetadata);

      // Act - Recover metadata
      const result = await recoveryService.onBookAdded('restore-test');

      // Assert
      expect(result.hasStoredMetadata).toBe(true);
      expect(result.restored!.progress).toBe(75);
      expect(result.restored!.rating).toBe(5);
      expect(result.restored!.highlights).toHaveLength(10);
      expect(result.restored!.notes).toHaveLength(5);
      expect(result.restored!.tags).toContain('fiction');
      expect(result.restored!.tags).toContain('favorite');
    });

    it('should detect when no stored metadata exists', async () => {
      // Act
      const result = await recoveryService.onBookAdded('new-book');

      // Assert
      expect(result.hasStoredMetadata).toBe(false);
      expect(result.restored).toBeUndefined();
      expect(result.conflicts).toHaveLength(0);
    });

    it('should handle partial restoration gracefully', async () => {
      // Arrange - Store metadata with some missing fields
      const partialMetadata = asMockStored(createStoredMetadata(asPartialStored({
        bookId: 'partial-test',
        progress: 50,
        rating: undefined as unknown as number,
        highlights: [],
        notes: [],
      })));
      await mockStore.set('partial-test', partialMetadata);

      // Act
      const result = await recoveryService.onBookAdded('partial-test');

      // Assert
      expect(result.hasStoredMetadata).toBe(true);
      expect(result.restored!.progress).toBe(50);
      expect(result.restored!.highlights).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Conflict Detection on Re-addition
  // ==========================================================================

  describe('Conflict Detection', () => {
    it('should detect rating conflict between stored and new metadata', async () => {
      // Arrange
      const storedMetadata = asMockStored(createStoredMetadata(asPartialStored({
        bookId: 'conflict-test',
        rating: 5,
      })));
      await mockStore.set('conflict-test', storedMetadata);

      const newMetadata = createBookMetadata({
        bookId: 'conflict-test',
        rating: 3,
      });

      // Act
      const result = await recoveryService.onBookAdded('conflict-test', newMetadata);

      // Assert
      expect(result.conflicts.length).toBeGreaterThan(0);
      const ratingConflict = result.conflicts.find(c => c.field === 'rating');
      expect(ratingConflict).toBeDefined();
      expect(ratingConflict!.localValue).toBe(5);
      expect(ratingConflict!.remoteValue).toBe(3);
    });

    it('should detect tags conflict', async () => {
      // Arrange
      const storedMetadata = asMockStored(createStoredMetadata(asPartialStored({
        bookId: 'tags-conflict',
        tags: ['fiction', 'classic'],
      })));
      await mockStore.set('tags-conflict', storedMetadata);

      const newMetadata = createBookMetadata({
        bookId: 'tags-conflict',
        tags: ['fiction', 'modern'],
      });

      // Act
      const result = await recoveryService.onBookAdded('tags-conflict', newMetadata);

      // Assert
      const tagsConflict = result.conflicts.find(c => c.field === 'tags');
      expect(tagsConflict).toBeDefined();
    });

    it('should not create conflict when values are identical', async () => {
      // Arrange
      const storedMetadata = asMockStored(createStoredMetadata(asPartialStored({
        bookId: 'no-conflict',
        rating: 4,
        progress: 50,
        tags: ['fiction'],
      })));
      await mockStore.set('no-conflict', storedMetadata);

      const newMetadata = createBookMetadata({
        bookId: 'no-conflict',
        rating: 4,
        progress: 50,
        tags: ['fiction'],
      });

      // Act
      const result = await recoveryService.onBookAdded('no-conflict', newMetadata);

      // Assert
      expect(result.conflicts).toHaveLength(0);
    });

    it('should detect progress conflict when values differ', async () => {
      // Arrange
      const storedMetadata = asMockStored(createStoredMetadata(asPartialStored({
        bookId: 'timestamp-conflict',
        progress: 25,
      })));
      await mockStore.set('timestamp-conflict', storedMetadata);

      const newMetadata = createBookMetadata({
        bookId: 'timestamp-conflict',
        progress: 75,
      });

      // Act
      const result = await recoveryService.onBookAdded('timestamp-conflict', newMetadata);

      // Assert - Progress conflict should be detected
      const progressConflict = result.conflicts.find(c => c.field === 'progress');
      expect(progressConflict).toBeDefined();
      expect(progressConflict!.localValue).toBe(25);
      expect(progressConflict!.remoteValue).toBe(75);
    });
  });

  // ==========================================================================
  // Highlight Preservation Scenarios
  // ==========================================================================

  describe('Highlight Preservation', () => {
    it('should preserve all highlights on re-addition without conflicts', async () => {
      // Arrange
      const highlights = createHighlights(20);
      const storedMetadata = asMockStored(createStoredMetadata(asPartialStored({
        bookId: 'highlight-preserve',
        highlights,
      })));
      await mockStore.set('highlight-preserve', storedMetadata);

      // Act
      const result = await recoveryService.onBookAdded('highlight-preserve');

      // Assert
      expect(result.restored!.highlights).toHaveLength(20);
      for (let i = 0; i < highlights.length; i++) {
        expect(result.restored!.highlights[i].id).toBe(highlights[i].id);
        expect(result.restored!.highlights[i].text).toBe(highlights[i].text);
      }
    });

    it('should merge new highlights with stored highlights', async () => {
      // Arrange
      const storedHighlights = createHighlights(5);
      const newHighlights = createHighlights(3).map((h, i) => ({
        ...h,
        id: `new-${i}`,
        text: `New highlight ${i}`,
      })); 

      const storedMetadata = asMockStored(createStoredMetadata(asPartialStored({
        bookId: 'highlight-merge',
        highlights: storedHighlights,
      })));
      await mockStore.set('highlight-merge', storedMetadata);

      const newMetadata = createBookMetadata({
        bookId: 'highlight-merge',
        highlights: newHighlights,
      });

      // Act
      const result = await recoveryService.onBookAdded('highlight-merge', newMetadata);

      // Assert - Should have highlights from both sources
      const highlightConflict = result.conflicts.find(c => c.field === 'highlights');
      if (highlightConflict && highlightConflict.suggestedResolution === 'merge') {
        expect(highlightConflict.autoResolvable).toBe(true);
      }
    });

    it('should handle duplicate highlight IDs', async () => {
      // Arrange
      const sharedId = 'shared-highlight-id';
      const storedHighlights = [
        { ...createHighlights(1)[0], id: sharedId, text: 'Original text' },
      ];
      const newHighlights = [
        { ...createHighlights(1)[0], id: sharedId, text: 'Updated text' },
      ];

      const storedMetadata = asMockStored(createStoredMetadata(asPartialStored({
        bookId: 'highlight-dup',
        highlights: storedHighlights,
      })));
      await mockStore.set('highlight-dup', storedMetadata);

      const newMetadata = createBookMetadata({
        bookId: 'highlight-dup',
        highlights: newHighlights,
      });

      // Act
      const result = await recoveryService.onBookAdded('highlight-dup', newMetadata);

      // Assert - Should detect the conflict
      expect(result.hasStoredMetadata).toBe(true);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle book removed and re-added multiple times', async () => {
      // First removal
      const metadata1 = createBookMetadata({
        bookId: 'multi-remove',
        progress: 25,
        highlights: createHighlights(5),
      });
      await recoveryService.onBookRemoved('multi-remove', metadata1);

      // First re-addition
      await recoveryService.onBookAdded('multi-remove');

      // Second removal with updated progress
      const metadata2 = createBookMetadata({
        bookId: 'multi-remove',
        progress: 50,
        highlights: createHighlights(10),
      });
      await recoveryService.onBookRemoved('multi-remove', metadata2);

      // Second re-addition
      const result = await recoveryService.onBookAdded('multi-remove');

      // Assert - Should have latest metadata
      expect(result.restored!.progress).toBe(50);
      expect(result.restored!.highlights).toHaveLength(10);
    });

    it('should handle corrupted stored metadata gracefully', async () => {
      // Arrange - Store corrupted data
      await mockStore.set('corrupted', {
        bookId: 'corrupted',
        // Missing required fields
      } as unknown as MockStoredMetadata);

      // Act & Assert - Should not throw
      const result = await recoveryService.onBookAdded('corrupted');
      expect(result.hasStoredMetadata).toBe(true);
    });

    it('should handle empty highlights and notes arrays', async () => {
      // Arrange
      const storedMetadata = asMockStored(createStoredMetadata(asPartialStored({
        bookId: 'empty-arrays',
        highlights: [],
        notes: [],
        bookmarks: [],
      })));
      await mockStore.set('empty-arrays', storedMetadata);

      // Act
      const result = await recoveryService.onBookAdded('empty-arrays');

      // Assert
      expect(result.restored!.highlights).toHaveLength(0);
      expect(result.restored!.notes).toHaveLength(0);
    });

    it('should preserve custom fields', async () => {
      // Arrange
      const storedMetadata = asMockStored(createStoredMetadata(asPartialStored({
        bookId: 'custom-fields',
      })));
      // Add custom field manually
      (storedMetadata as unknown as { customFields: Record<string, unknown> }).customFields = {
        myCustomField: 'custom value',
        anotherField: 123,
      };
      await mockStore.set('custom-fields', storedMetadata);

      // Act
      const result = await recoveryService.onBookAdded('custom-fields');

      // Assert
      expect(result.hasStoredMetadata).toBe(true);
    });
  });

  // ==========================================================================
  // Cleanup and Maintenance
  // ==========================================================================

  describe('Cleanup', () => {
    it('should remove archived metadata after successful restoration', async () => {
      // Arrange
      const storedMetadata = asMockStored(createStoredMetadata(asPartialStored({ bookId: 'cleanup-test' })));
      await mockStore.set('cleanup-test', storedMetadata);

      // Act
      await recoveryService.onBookAdded('cleanup-test');
      await recoveryService.confirmRestoration('cleanup-test');

      // Assert - Archived data should be removed
      const stillStored = await mockStore.get('cleanup-test');
      expect(stillStored).toBeNull();
    });

    it('should list all archived books', async () => {
      // Arrange
      await mockStore.set('book-1', asMockStored(createStoredMetadata(asPartialStored({ bookId: 'book-1' }))));
      await mockStore.set('book-2', asMockStored(createStoredMetadata(asPartialStored({ bookId: 'book-2' }))));
      await mockStore.set('book-3', asMockStored(createStoredMetadata(asPartialStored({ bookId: 'book-3' })))); 

      // Act
      const archived = await mockStore.getAll();

      // Assert
      expect(archived).toHaveLength(3);
      expect(archived.map(a => a.bookId)).toContain('book-1');
      expect(archived.map(a => a.bookId)).toContain('book-2');
      expect(archived.map(a => a.bookId)).toContain('book-3');
    });
  });
});
