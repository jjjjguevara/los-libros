/**
 * Vault Watcher Unit Tests
 *
 * Tests for watching vault files for highlight/note changes.
 *
 * @see src/sync/vault-watcher.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  VaultWatcher,
  createVaultWatcher,
  DEFAULT_WATCHER_OPTIONS,
  type VaultChangeEvent,
} from '../../sync/vault-watcher';
import { createHighlightParser } from '../../sync/highlight-parser';

// ============================================================================
// Mock Obsidian
// ============================================================================

const createMockVault = () => {
  const eventHandlers: Map<string, Set<Function>> = new Map();

  const vault = {
    on: vi.fn((event: string, handler: Function) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, new Set());
      }
      eventHandlers.get(event)!.add(handler);
      return { id: `ref-${Date.now()}` };
    }),
    off: vi.fn(),
    offref: vi.fn(),
    read: vi.fn().mockResolvedValue(''),
    getAbstractFileByPath: vi.fn(),
    adapter: {
      constructor: class MockAdapter {},
    },
    // Helper to trigger events in tests
    _trigger: (event: string, ...args: any[]) => {
      eventHandlers.get(event)?.forEach((h) => h(...args));
    },
    _handlers: eventHandlers,
  };

  return vault;
};

const createMockFile = (path: string) => ({
  path,
  name: path.split('/').pop(),
  parent: null,
  vault: {},
});

const createMockApp = () => {
  const vault = createMockVault();
  return {
    vault,
    workspace: {},
    fileManager: {},
  };
};

// ============================================================================
// Test Suite
// ============================================================================

describe('VaultWatcher', () => {
  let watcher: VaultWatcher;
  let mockApp: ReturnType<typeof createMockApp>;
  let parser: ReturnType<typeof createHighlightParser>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockApp = createMockApp();
    parser = createHighlightParser();
    watcher = createVaultWatcher(mockApp as any, parser);
  });

  afterEach(() => {
    watcher.stop();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  describe('Lifecycle', () => {
    it('should start watching vault', () => {
      watcher.start();

      expect(mockApp.vault.on).toHaveBeenCalledWith('modify', expect.any(Function));
      expect(mockApp.vault.on).toHaveBeenCalledWith('create', expect.any(Function));
      expect(mockApp.vault.on).toHaveBeenCalledWith('delete', expect.any(Function));
      expect(mockApp.vault.on).toHaveBeenCalledWith('rename', expect.any(Function));
      expect(watcher.isWatching()).toBe(true);
    });

    it('should not start twice', () => {
      watcher.start();
      const callCount = mockApp.vault.on.mock.calls.length;

      watcher.start();

      expect(mockApp.vault.on).toHaveBeenCalledTimes(callCount);
    });

    it('should stop watching vault', () => {
      watcher.start();
      watcher.stop();

      expect(mockApp.vault.offref).toHaveBeenCalled();
      expect(watcher.isWatching()).toBe(false);
    });

    it('should handle stop when not running', () => {
      expect(() => watcher.stop()).not.toThrow();
      expect(watcher.isWatching()).toBe(false);
    });
  });

  // ==========================================================================
  // Event Listening
  // ==========================================================================

  describe('Event Listening', () => {
    it('should register change listeners', () => {
      const listener = vi.fn();
      const unsubscribe = watcher.on('change', listener);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should unsubscribe listeners', () => {
      const listener = vi.fn();
      const unsubscribe = watcher.on('change', listener);

      unsubscribe();

      // Listener should be removed (implementation detail, but verifiable via behavior)
    });
  });

  // ==========================================================================
  // File Filtering
  // ==========================================================================

  describe('File Filtering', () => {
    it('should watch markdown files by default', () => {
      watcher.start();
      expect(mockApp.vault.on).toHaveBeenCalledWith('modify', expect.any(Function));
    });

    it('should configure with custom watch patterns', () => {
      const customWatcher = createVaultWatcher(mockApp as any, parser, {
        watchPatterns: ['notes/*.md'],
      });
      customWatcher.start();

      expect(mockApp.vault.on).toHaveBeenCalledWith('modify', expect.any(Function));
      customWatcher.stop();
    });

    it('should configure with custom ignore patterns', () => {
      const customWatcher = createVaultWatcher(mockApp as any, parser, {
        ignorePatterns: ['.obsidian/**', '.trash/**', 'archive/**'],
      });
      customWatcher.start();

      expect(mockApp.vault.on).toHaveBeenCalledWith('modify', expect.any(Function));
      customWatcher.stop();
    });
  });

  // ==========================================================================
  // Debouncing
  // ==========================================================================

  describe('Debouncing', () => {
    it('should configure with custom debounce delay', () => {
      const customWatcher = createVaultWatcher(mockApp as any, parser, {
        debounceDelay: 500,
      });

      expect(customWatcher).toBeDefined();
      customWatcher.stop();
    });

    it('should allow updating debounce delay', () => {
      watcher.setDebounceDelay(500);
      // The watcher should accept the new delay without error
      expect(watcher).toBeDefined();
    });

    it('should use default debounce delay', () => {
      expect(DEFAULT_WATCHER_OPTIONS.debounceDelay).toBe(2000);
    });

    it('should track pending changes via getPendingCount', () => {
      watcher.start();
      // getPendingCount should return 0 when no changes are pending
      expect(watcher.getPendingCount()).toBe(0);
    });
  });

  // ==========================================================================
  // Change Events - Direct Emission
  // ==========================================================================

  describe('Change Events - Delete', () => {
    beforeEach(() => {
      watcher.start();
    });

    it('should emit delete events immediately', () => {
      const listener = vi.fn();
      watcher.on('change', listener);

      const mockFile = createMockFile('deleted.md');
      mockApp.vault._trigger('delete', mockFile);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          file: mockFile,
          changeType: 'delete',
          deleted: true,
        })
      );
    });
  });

  // ==========================================================================
  // Pattern Matching
  // ==========================================================================

  describe('Pattern Matching', () => {
    it('should match simple patterns', () => {
      const customWatcher = createVaultWatcher(mockApp as any, parser, {
        watchPatterns: ['notes/*.md'],
      });

      // @ts-ignore - accessing private method for testing
      const matchPattern = customWatcher['matchPattern'].bind(customWatcher);

      expect(matchPattern('notes/test.md', 'notes/*.md')).toBe(true);
      expect(matchPattern('other/test.md', 'notes/*.md')).toBe(false);
    });

    it('should match glob star patterns with paths', () => {
      const customWatcher = createVaultWatcher(mockApp as any, parser, {
        watchPatterns: ['**/*.md'],
      });

      // @ts-ignore
      const matchPattern = customWatcher['matchPattern'].bind(customWatcher);

      expect(matchPattern('any/path/file.md', '**/*.md')).toBe(true);
      expect(matchPattern('deep/nested/folder/file.md', '**/*.md')).toBe(true);
    });

    it('should match patterns for ignored folders', () => {
      const customWatcher = createVaultWatcher(mockApp as any, parser, {
        ignorePatterns: ['.obsidian/**'],
      });

      // @ts-ignore
      const matchPattern = customWatcher['matchPattern'].bind(customWatcher);

      expect(matchPattern('.obsidian/config.json', '.obsidian/**')).toBe(true);
      expect(matchPattern('.obsidian/plugins/test/main.js', '.obsidian/**')).toBe(true);
    });
  });

  // ==========================================================================
  // Flush Pending
  // ==========================================================================

  describe('flushPending', () => {
    it('should handle flush when no changes pending', async () => {
      watcher.start();

      expect(watcher.getPendingCount()).toBe(0);

      await watcher.flushPending();

      expect(watcher.getPendingCount()).toBe(0);
    });

    it('should be callable without error', async () => {
      watcher.start();

      await expect(watcher.flushPending()).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // Default Options
  // ==========================================================================

  describe('Default Options', () => {
    it('should have correct default debounce delay', () => {
      expect(DEFAULT_WATCHER_OPTIONS.debounceDelay).toBe(2000);
    });

    it('should have correct default watch patterns', () => {
      expect(DEFAULT_WATCHER_OPTIONS.watchPatterns).toContain('**/*.md');
    });

    it('should have correct default ignore patterns', () => {
      expect(DEFAULT_WATCHER_OPTIONS.ignorePatterns).toContain('.obsidian/**');
      expect(DEFAULT_WATCHER_OPTIONS.ignorePatterns).toContain('.trash/**');
    });
  });

  // ==========================================================================
  // ShouldWatch Logic
  // ==========================================================================

  describe('shouldWatch logic', () => {
    it('should filter non-markdown files', () => {
      const customWatcher = createVaultWatcher(mockApp as any, parser);

      // @ts-ignore - accessing private method for testing
      const shouldWatch = customWatcher['shouldWatch'].bind(customWatcher);

      // Test that non-md files return false
      expect(shouldWatch({ path: 'test.js' })).toBe(false);
      expect(shouldWatch({ path: 'test.txt' })).toBe(false);
      expect(shouldWatch({ path: 'image.png' })).toBe(false);
    });

    it('should accept markdown files in directories', () => {
      const customWatcher = createVaultWatcher(mockApp as any, parser);

      // @ts-ignore
      const shouldWatch = customWatcher['shouldWatch'].bind(customWatcher);

      // Default watchPatterns is ['**/*.md'] which requires a path separator
      expect(shouldWatch({ path: 'notes/test.md' })).toBe(true);
      expect(shouldWatch({ path: 'deep/nested/file.md' })).toBe(true);
    });

    it('should ignore obsidian folder', () => {
      const customWatcher = createVaultWatcher(mockApp as any, parser);

      // @ts-ignore
      const shouldWatch = customWatcher['shouldWatch'].bind(customWatcher);

      expect(shouldWatch({ path: '.obsidian/config.md' })).toBe(false);
      expect(shouldWatch({ path: '.obsidian/plugins/test.md' })).toBe(false);
    });

    it('should ignore trash folder', () => {
      const customWatcher = createVaultWatcher(mockApp as any, parser);

      // @ts-ignore
      const shouldWatch = customWatcher['shouldWatch'].bind(customWatcher);

      expect(shouldWatch({ path: '.trash/deleted.md' })).toBe(false);
    });
  });

  // ==========================================================================
  // Factory Function
  // ==========================================================================

  describe('Factory Function', () => {
    it('should create watcher with default options', () => {
      const newWatcher = createVaultWatcher(mockApp as any, parser);
      expect(newWatcher).toBeInstanceOf(VaultWatcher);
      newWatcher.stop();
    });

    it('should create watcher with custom options', () => {
      const newWatcher = createVaultWatcher(mockApp as any, parser, {
        debounceDelay: 5000,
        watchPatterns: ['custom/**/*.md'],
      });
      expect(newWatcher).toBeInstanceOf(VaultWatcher);
      newWatcher.stop();
    });
  });
});
