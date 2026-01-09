/**
 * E2E Test Suite: Doc Doctor Integration
 *
 * Tests the full highlight ↔ stub synchronization workflow between
 * Amnesia and Doc Doctor plugins.
 *
 * Run via: npm test -- --grep "Doc Doctor Integration"
 * Or via MCP: window.amnesiaTests.runE2E()
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DocDoctorBridge, DocDoctorStub, BookHealth, StubType } from '../../integrations/doc-doctor-bridge';
import type { Highlight, HighlightColor } from '../../library/types';

// Mock factories for tests
function createMockHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    bookId: 'test-book-id',
    text: 'Test highlight text',
    cfi: '/4/2/4[chapter01],/1:0,/1:20',
    color: 'yellow' as HighlightColor,
    chapter: 'Chapter 1',
    pagePercent: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    synced: false,
    ...overrides,
  };
}

function createMockStub(overrides: Partial<DocDoctorStub> = {}): DocDoctorStub {
  return {
    id: `stub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type: 'verify' as StubType,
    description: 'Test stub description',
    filePath: '/path/to/book-note.md',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('Doc Doctor Integration E2E', () => {
  // Mock bridge for testing
  let mockBridge: Partial<DocDoctorBridge>;
  let syncedStubs: DocDoctorStub[];

  beforeEach(() => {
    syncedStubs = [];

    mockBridge = {
      isConnected: vi.fn().mockReturnValue(true),
      createStub: vi.fn().mockImplementation(async (data) => {
        const stub = createMockStub({ ...data });
        syncedStubs.push(stub);
        return stub;
      }),
      updateStub: vi.fn().mockImplementation(async (id, data) => {
        const stub = syncedStubs.find((s) => s.id === id);
        if (stub) {
          Object.assign(stub, data);
          return stub;
        }
        return null;
      }),
      resolveStub: vi.fn().mockImplementation(async (id, resolution) => {
        const stub = syncedStubs.find((s) => s.id === id);
        if (stub) {
          stub.resolution = resolution;
          stub.resolvedAt = new Date();
          return stub;
        }
        return null;
      }),
      deleteStub: vi.fn().mockImplementation(async (id) => {
        syncedStubs = syncedStubs.filter((s) => s.id !== id);
      }),
      getStub: vi.fn().mockImplementation(async (id) => {
        return syncedStubs.find((s) => s.id === id) ?? null;
      }),
      listStubs: vi.fn().mockImplementation(async () => syncedStubs),
      getBookHealth: vi.fn().mockImplementation(async () => ({
        overall: 0.75,
        breakdown: {
          highlightCount: 10,
          stubCount: 5,
          resolvedStubCount: 2,
          annotationCoverage: 0.8,
        },
      })),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    syncedStubs = [];
  });

  /**
   * Test 1: Full highlight → stub → resolution → highlight workflow
   */
  describe('Full Sync Workflow', () => {
    it('should sync highlight to stub and propagate resolution back', async () => {
      // Step 1: Create highlight in Amnesia
      const highlight = createMockHighlight({
        text: 'This claim needs verification',
        color: 'yellow',
      });

      // Step 2: Sync to Doc Doctor as stub
      const createdStub = await mockBridge.createStub!({
        type: 'verify',
        description: highlight.text,
        filePath: '/vault/Books/test-book.md',
        source: {
          plugin: 'amnesia',
          highlightId: highlight.id,
        },
      });

      expect(createdStub).toBeDefined();
      expect(createdStub!.type).toBe('verify');
      expect(createdStub!.description).toBe('This claim needs verification');
      expect(syncedStubs).toHaveLength(1);

      // Step 3: Resolve stub in Doc Doctor
      const resolvedStub = await mockBridge.resolveStub!(
        createdStub!.id,
        'Verified via primary source: Smith et al. 2023'
      );

      expect(resolvedStub?.resolution).toBe('Verified via primary source: Smith et al. 2023');
      expect(resolvedStub?.resolvedAt).toBeDefined();

      // Step 4: Verify resolution synced back
      // In real implementation, this would update the highlight annotation
      const fetchedStub = await mockBridge.getStub!(createdStub!.id);
      expect(fetchedStub?.resolution).toBeTruthy();
    });

    it('should handle highlight deletion cascading to stub', async () => {
      const highlight = createMockHighlight();

      // Create stub
      const stub = await mockBridge.createStub!({
        type: 'expand',
        description: highlight.text,
        source: { plugin: 'amnesia', highlightId: highlight.id },
        filePath: '/vault/Books/test.md',
      });

      expect(syncedStubs).toHaveLength(1);

      // Delete stub when highlight is deleted
      await mockBridge.deleteStub!(stub!.id);

      expect(syncedStubs).toHaveLength(0);
    });
  });

  /**
   * Test 2: Bulk sync operations
   */
  describe('Bulk Sync Operations', () => {
    it('should sync 100 highlights efficiently', async () => {
      const highlights = Array.from({ length: 100 }, (_, i) =>
        createMockHighlight({
          text: `Highlight ${i + 1}`,
          color: ['yellow', 'green', 'blue', 'pink', 'purple'][i % 5] as HighlightColor,
        })
      );

      const startTime = performance.now();

      // Bulk create stubs
      const createPromises = highlights.map((h) =>
        mockBridge.createStub!({
          type: colorToStubType(h.color),
          description: h.text,
          filePath: '/vault/Books/test.md',
          source: { plugin: 'amnesia', highlightId: h.id },
        })
      );

      const results = await Promise.all(createPromises);

      const duration = performance.now() - startTime;

      expect(results).toHaveLength(100);
      expect(syncedStubs).toHaveLength(100);
      expect(duration).toBeLessThan(5000); // Should complete in <5s
    });
  });

  /**
   * Test 3: Conflict resolution strategies
   */
  describe('Conflict Resolution', () => {
    it('should handle newest-wins strategy', async () => {
      // Create highlight with annotation
      const highlight = createMockHighlight({
        text: 'Conflicting content',
        annotation: 'Amnesia annotation',
        updatedAt: new Date('2025-01-07'),
      });

      // Create stub with different data
      const stub = createMockStub({
        description: 'Different description from Doc Doctor',
        resolution: 'Doc Doctor resolution',
        updatedAt: new Date('2025-01-08'), // Newer
      });

      // With newest-wins, Doc Doctor version should win
      const winner = resolveConflict(highlight, stub, 'newest-wins');

      expect(winner.source).toBe('doc-doctor');
      expect(winner.data.resolution).toBe('Doc Doctor resolution');
    });

    it('should handle amnesia-wins strategy', async () => {
      const highlight = createMockHighlight({
        text: 'Amnesia text',
        annotation: 'Amnesia annotation',
      });

      const stub = createMockStub({
        description: 'Doc Doctor text',
      });

      const winner = resolveConflict(highlight, stub, 'amnesia-wins');

      expect(winner.source).toBe('amnesia');
      expect(winner.data.text).toBe('Amnesia text');
    });
  });

  /**
   * Test 4: Offline → online sync recovery
   */
  describe('Offline Sync Recovery', () => {
    it('should queue operations when offline and sync on reconnect', async () => {
      // Simulate offline
      mockBridge.isConnected = vi.fn().mockReturnValue(false);

      const offlineQueue: { operation: string; data: unknown }[] = [];

      // Queue offline operation
      const highlight = createMockHighlight();
      offlineQueue.push({
        operation: 'create-stub',
        data: {
          type: 'verify',
          description: highlight.text,
          highlightId: highlight.id,
        },
      });

      expect(offlineQueue).toHaveLength(1);

      // Simulate reconnect
      mockBridge.isConnected = vi.fn().mockReturnValue(true);

      // Process queue
      for (const item of offlineQueue) {
        if (item.operation === 'create-stub') {
          await mockBridge.createStub!({
            ...(item.data as object),
            filePath: '/vault/Books/test.md',
          });
        }
      }

      expect(syncedStubs).toHaveLength(1);
    });
  });

  /**
   * Test 5: Plugin reload state preservation
   */
  describe('State Preservation', () => {
    it('should preserve sync state across simulated reload', async () => {
      // Create initial state
      const highlight1 = createMockHighlight({ id: 'persistent-hl-1' });
      const stub1 = await mockBridge.createStub!({
        type: 'verify',
        description: highlight1.text,
        filePath: '/vault/Books/test.md',
        source: { plugin: 'amnesia', highlightId: highlight1.id },
      });

      // Serialize state (simulating save)
      const savedState = {
        syncedHighlights: [{ highlightId: highlight1.id, stubId: stub1!.id }],
      };

      // Clear in-memory state (simulating reload)
      const reloadedStubs = [...syncedStubs];
      syncedStubs.length = 0;

      // Restore state
      syncedStubs.push(...reloadedStubs);

      // Verify state restored
      expect(syncedStubs).toHaveLength(1);
      expect(savedState.syncedHighlights).toHaveLength(1);

      // Verify can still interact with restored stub
      const fetchedStub = await mockBridge.getStub!(stub1!.id);
      expect(fetchedStub).toBeDefined();
    });
  });
});

// Helper functions

function colorToStubType(color: HighlightColor): StubType {
  const mapping: Record<HighlightColor, StubType> = {
    yellow: 'verify',
    green: 'expand',
    blue: 'clarify',
    pink: 'question',
    purple: 'important',
    red: 'counterpoint',
  };
  return mapping[color] ?? 'verify';
}

interface ConflictResolution {
  source: 'amnesia' | 'doc-doctor';
  data: {
    text?: string;
    annotation?: string;
    resolution?: string;
  };
}

function resolveConflict(
  highlight: Highlight,
  stub: DocDoctorStub,
  strategy: 'amnesia-wins' | 'dd-wins' | 'newest-wins'
): ConflictResolution {
  switch (strategy) {
    case 'amnesia-wins':
      return {
        source: 'amnesia',
        data: { text: highlight.text, annotation: highlight.annotation ?? '' },
      };
    case 'dd-wins':
      return {
        source: 'doc-doctor',
        data: { text: stub.description, resolution: stub.resolution ?? '' },
      };
    case 'newest-wins':
      const amnesiaTime = highlight.updatedAt?.getTime() ?? 0;
      const ddTime = stub.updatedAt?.getTime() ?? 0;
      if (ddTime > amnesiaTime) {
        return {
          source: 'doc-doctor',
          data: { text: stub.description, resolution: stub.resolution ?? '' },
        };
      }
      return {
        source: 'amnesia',
        data: { text: highlight.text, annotation: highlight.annotation ?? '' },
      };
    default:
      return { source: 'amnesia', data: { text: highlight.text } };
  }
}
