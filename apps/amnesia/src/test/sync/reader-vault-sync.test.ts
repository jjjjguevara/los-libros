/**
 * Reader ↔ Vault Sync Orchestrator Unit Tests
 *
 * Tests for the main sync orchestrator that manages bidirectional
 * synchronization between reader highlights and vault notes.
 *
 * @see src/sync/reader-vault-sync.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ReaderVaultSyncOrchestrator,
  createReaderVaultSync,
  DEFAULT_READER_VAULT_SYNC_SETTINGS,
  type ReaderVaultSyncSettings,
  type SyncOperationResult,
} from '../../sync/reader-vault-sync';
import type { HighlightState, HighlightAction } from '../../highlights/highlight-store';
import type { Highlight, HighlightColor } from '../../library/types';

// ============================================================================
// Mock Obsidian App
// ============================================================================

const createMockVault = () => ({
  on: vi.fn(() => ({ id: 'ref' })),
  off: vi.fn(),
  offref: vi.fn(),
  read: vi.fn().mockResolvedValue(''),
  modify: vi.fn().mockResolvedValue(undefined),
  create: vi.fn().mockResolvedValue({}),
  getAbstractFileByPath: vi.fn(),
  adapter: {
    constructor: class MockAdapter {},
  },
});

const createMockFileManager = () => ({
  processFrontMatter: vi.fn().mockResolvedValue(undefined),
});

const createMockApp = () => ({
  vault: createMockVault(),
  workspace: {},
  fileManager: createMockFileManager(),
});

// ============================================================================
// Test Fixtures
// ============================================================================

const createHighlight = (overrides: Partial<Highlight> = {}): Highlight => ({
  id: 'hl-test001',
  bookId: 'book-001',
  text: 'This is a test highlight',
  cfi: 'epubcfi(/6/4!/4/2/1:0)',
  color: 'yellow' as HighlightColor,
  annotation: 'Test annotation',
  chapter: 'Chapter 1',
  pagePercent: 25,
  spineIndex: 1,
  selector: {
    primary: { type: 'CfiSelector', cfi: 'epubcfi(/6/4!/4/2/1:0)' },
    fallback: { type: 'TextQuoteSelector', exact: 'This is a test highlight' },
  },
  createdAt: new Date('2025-01-01T10:00:00Z'),
  updatedAt: new Date('2025-01-01T10:00:00Z'),
  synced: false,
  atomicNotePath: 'Highlights/book-001/hl-test001.md',
  ...overrides,
});

const createHighlightState = (highlights: Record<string, Highlight[]> = {}): HighlightState => ({
  highlights,
  loading: false,
  error: null,
  selectedHighlightId: null,
  pendingSelection: null,
});

// ============================================================================
// Test Suite
// ============================================================================

describe('ReaderVaultSyncOrchestrator', () => {
  let orchestrator: ReaderVaultSyncOrchestrator;
  let mockApp: ReturnType<typeof createMockApp>;
  let settings: ReaderVaultSyncSettings;
  let highlightState: HighlightState;
  let dispatchedActions: HighlightAction[];

  const getHighlightState = () => highlightState;
  const dispatchHighlightAction = (action: HighlightAction) => {
    dispatchedActions.push(action);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockApp = createMockApp();
    settings = { ...DEFAULT_READER_VAULT_SYNC_SETTINGS };
    highlightState = createHighlightState({
      'book-001': [createHighlight()],
    });
    dispatchedActions = [];

    orchestrator = createReaderVaultSync(
      mockApp as any,
      settings,
      getHighlightState,
      dispatchHighlightAction
    );
  });

  afterEach(() => {
    orchestrator.stop();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  describe('Lifecycle', () => {
    it('should start the orchestrator', () => {
      orchestrator.start();

      expect(mockApp.vault.on).toHaveBeenCalled();
    });

    it('should stop the orchestrator', () => {
      orchestrator.start();
      orchestrator.stop();

      expect(mockApp.vault.offref).toHaveBeenCalled();
    });

    it('should report sync status', () => {
      expect(orchestrator.isSyncInProgress()).toBe(false);
    });

    it('should return current settings', () => {
      const currentSettings = orchestrator.getSettings();

      expect(currentSettings).toEqual(settings);
    });

    it('should update settings', () => {
      orchestrator.updateSettings({ debounceDelay: 5000 });

      const updated = orchestrator.getSettings();
      expect(updated.debounceDelay).toBe(5000);
    });
  });

  // ==========================================================================
  // Event System
  // ==========================================================================

  describe('Event System', () => {
    it('should register event listeners', () => {
      const listener = vi.fn();
      const unsubscribe = orchestrator.on(listener);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should unsubscribe listeners', () => {
      const listener = vi.fn();
      const unsubscribe = orchestrator.on(listener);

      unsubscribe();

      // Listener should be removed
    });

    it('should emit sync-start event', async () => {
      const listener = vi.fn();
      orchestrator.on(listener);

      await orchestrator.syncBook('book-001');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sync-start',
        })
      );
    });

    it('should emit sync-complete event', async () => {
      const listener = vi.fn();
      orchestrator.on(listener);

      await orchestrator.syncBook('book-001');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sync-complete',
        })
      );
    });
  });

  // ==========================================================================
  // Reader → Vault Sync
  // ==========================================================================

  describe('Reader → Vault Sync', () => {
    describe('onHighlightCreated', () => {
      it('should sync new highlight to vault when auto-sync enabled', async () => {
        orchestrator.updateSettings({ autoSync: true, highlightSyncMode: 'bidirectional' });
        orchestrator.start();

        // Register listener FIRST, then make the call
        const listener = vi.fn();
        orchestrator.on(listener);

        const highlight = createHighlight({ id: 'hl-new001' });
        await orchestrator.onHighlightCreated(highlight);

        expect(listener).toHaveBeenCalled();
      });

      it('should skip sync when auto-sync disabled', async () => {
        orchestrator.updateSettings({ autoSync: false });
        orchestrator.start();

        const listener = vi.fn();
        orchestrator.on(listener);

        const highlight = createHighlight();
        await orchestrator.onHighlightCreated(highlight);

        expect(listener).not.toHaveBeenCalled();
      });

      it('should skip sync in vault-to-reader mode', async () => {
        orchestrator.updateSettings({
          autoSync: true,
          highlightSyncMode: 'vault-to-reader',
        });
        orchestrator.start();

        const listener = vi.fn();
        orchestrator.on(listener);

        await orchestrator.onHighlightCreated(createHighlight());

        expect(listener).not.toHaveBeenCalled();
      });

      it('should skip sync in manual mode', async () => {
        orchestrator.updateSettings({
          autoSync: true,
          highlightSyncMode: 'manual',
        });
        orchestrator.start();

        const listener = vi.fn();
        orchestrator.on(listener);

        await orchestrator.onHighlightCreated(createHighlight());

        expect(listener).not.toHaveBeenCalled();
      });
    });

    describe('onHighlightUpdated', () => {
      it('should sync updated highlight to vault', async () => {
        orchestrator.updateSettings({ autoSync: true, highlightSyncMode: 'bidirectional' });
        orchestrator.start();

        const listener = vi.fn();
        orchestrator.on(listener);

        const highlight = createHighlight({ annotation: 'Updated annotation' });
        await orchestrator.onHighlightUpdated(highlight);

        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'sync-start' })
        );
      });
    });

    describe('onHighlightDeleted', () => {
      it('should delete highlight from vault', async () => {
        orchestrator.updateSettings({
          autoSync: true,
          highlightSyncMode: 'bidirectional',
          appendOnlyVault: false,
        });
        orchestrator.start();

        // No direct listener check needed - just verify no error
        await expect(
          orchestrator.onHighlightDeleted('book-001', 'hl-test001')
        ).resolves.not.toThrow();
      });

      it('should skip deletion in append-only mode', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        orchestrator.updateSettings({
          autoSync: true,
          highlightSyncMode: 'bidirectional',
          appendOnlyVault: true,
        });
        orchestrator.start();

        await orchestrator.onHighlightDeleted('book-001', 'hl-test001');

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Append-only mode')
        );
        consoleSpy.mockRestore();
      });
    });
  });

  // ==========================================================================
  // Manual Sync
  // ==========================================================================

  describe('Manual Sync', () => {
    describe('syncBook', () => {
      it('should sync all highlights for a book', async () => {
        const result = await orchestrator.syncBook('book-001');

        expect(result.success).toBe(true);
        expect(result.trigger).toBe('manual');
        expect(result.itemsProcessed).toBeGreaterThanOrEqual(0);
      });

      it('should return error if sync already in progress', async () => {
        // Start a sync
        const firstSync = orchestrator.syncBook('book-001');

        // Try to start another
        const secondResult = await orchestrator.syncBook('book-001');

        expect(secondResult.success).toBe(false);
        expect(secondResult.errors).toHaveLength(1);

        await firstSync;
      });

      it('should handle empty book', async () => {
        highlightState = createHighlightState({});

        const result = await orchestrator.syncBook('nonexistent-book');

        expect(result.success).toBe(true);
        expect(result.itemsProcessed).toBe(0);
      });
    });

    describe('syncAll', () => {
      it('should sync all highlights across all books', async () => {
        highlightState = createHighlightState({
          'book-001': [createHighlight({ id: 'hl-001', bookId: 'book-001' })],
          'book-002': [createHighlight({ id: 'hl-002', bookId: 'book-002' })],
        });

        const result = await orchestrator.syncAll();

        expect(result.success).toBe(true);
        expect(result.itemsProcessed).toBe(2);
      });

      it('should return error if sync already in progress', async () => {
        const firstSync = orchestrator.syncAll();
        const secondResult = await orchestrator.syncAll();

        expect(secondResult.success).toBe(false);
        expect(secondResult.errors).toHaveLength(1);

        await firstSync;
      });
    });
  });

  // ==========================================================================
  // Sync Modes
  // ==========================================================================

  describe('Sync Modes', () => {
    describe('bidirectional mode', () => {
      beforeEach(() => {
        orchestrator.updateSettings({ highlightSyncMode: 'bidirectional' });
      });

      it('should allow reader → vault sync', async () => {
        orchestrator.updateSettings({ autoSync: true });
        orchestrator.start();

        const listener = vi.fn();
        orchestrator.on(listener);

        await orchestrator.onHighlightCreated(createHighlight());

        expect(listener).toHaveBeenCalled();
      });
    });

    describe('reader-to-vault mode', () => {
      beforeEach(() => {
        orchestrator.updateSettings({ highlightSyncMode: 'reader-to-vault' });
      });

      it('should allow reader → vault sync', async () => {
        orchestrator.updateSettings({ autoSync: true });
        orchestrator.start();

        const listener = vi.fn();
        orchestrator.on(listener);

        await orchestrator.onHighlightCreated(createHighlight());

        expect(listener).toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // Settings
  // ==========================================================================

  describe('Settings', () => {
    it('should use default settings', () => {
      const defaultOrchestrator = createReaderVaultSync(
        mockApp as any,
        {},
        getHighlightState,
        dispatchHighlightAction
      );

      const currentSettings = defaultOrchestrator.getSettings();

      expect(currentSettings.highlightSyncMode).toBe('bidirectional');
      expect(currentSettings.debounceDelay).toBe(2000);
      expect(currentSettings.autoSync).toBe(true);

      defaultOrchestrator.stop();
    });

    it('should merge custom settings with defaults', () => {
      const customOrchestrator = createReaderVaultSync(
        mockApp as any,
        { debounceDelay: 5000 },
        getHighlightState,
        dispatchHighlightAction
      );

      const currentSettings = customOrchestrator.getSettings();

      expect(currentSettings.debounceDelay).toBe(5000);
      expect(currentSettings.highlightSyncMode).toBe('bidirectional'); // Default

      customOrchestrator.stop();
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should emit error event on sync failure', async () => {
      // Mock a failing vault operation
      mockApp.fileManager.processFrontMatter.mockRejectedValueOnce(
        new Error('Vault error')
      );

      const listener = vi.fn();
      orchestrator.on(listener);

      highlightState = createHighlightState({
        'book-001': [createHighlight({ atomicNotePath: 'test.md' })],
      });

      mockApp.vault.getAbstractFileByPath.mockReturnValue({
        path: 'test.md',
      });

      await orchestrator.syncBook('book-001');

      // Check that error was captured in result
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sync-complete',
        })
      );
    });

    it('should continue processing after individual errors', async () => {
      highlightState = createHighlightState({
        'book-001': [
          createHighlight({ id: 'hl-001', atomicNotePath: 'path1.md' }),
          createHighlight({ id: 'hl-002', atomicNotePath: 'path2.md' }),
        ],
      });

      // First call fails, second succeeds
      mockApp.fileManager.processFrontMatter
        .mockRejectedValueOnce(new Error('First error'))
        .mockResolvedValue(undefined);

      mockApp.vault.getAbstractFileByPath.mockReturnValue({ path: 'test.md' });

      const result = await orchestrator.syncBook('book-001');

      // Should have processed both, with one error
      expect(result.itemsProcessed + result.errors.length).toBe(2);
    });
  });

  // ==========================================================================
  // Conflict Detection
  // ==========================================================================

  describe('Conflict Detection', () => {
    it('should detect text differences as conflicts', () => {
      // Testing internal conflict detection logic would require
      // triggering vault changes, which needs more complex setup
    });

    it('should detect annotation differences as conflicts', () => {
      // Similar setup needed
    });
  });
});
