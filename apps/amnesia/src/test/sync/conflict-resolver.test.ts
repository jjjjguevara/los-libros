/**
 * Conflict Resolver Unit Tests
 *
 * Tests for conflict detection and resolution between Reader and Vault versions.
 *
 * @see src/sync/conflict-resolver.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ConflictResolver,
  createConflictResolver,
  type SyncConflict,
  type ConflictResolution,
  type ConflictType,
} from '../../sync/conflict-resolver';

// ============================================================================
// Mock Obsidian App
// ============================================================================

const createMockApp = () => ({
  vault: {
    on: vi.fn(),
    off: vi.fn(),
    offref: vi.fn(),
  },
  workspace: {},
  fileManager: {},
});

// ============================================================================
// Test Fixtures
// ============================================================================

const createConflict = (overrides: Partial<SyncConflict> = {}): SyncConflict => ({
  id: 'conflict-001',
  highlightId: 'hl-test001',
  type: 'annotation' as ConflictType,
  readerValue: 'Reader annotation',
  vaultValue: 'Vault annotation',
  readerTimestamp: new Date('2025-01-01T10:00:00Z'),
  vaultTimestamp: new Date('2025-01-01T11:00:00Z'),
  bookTitle: 'Test Book',
  ...overrides,
});

// ============================================================================
// Test Suite
// ============================================================================

describe('ConflictResolver', () => {
  let resolver: ConflictResolver;
  let mockApp: ReturnType<typeof createMockApp>;

  beforeEach(() => {
    mockApp = createMockApp();
    resolver = createConflictResolver(mockApp as any);
  });

  // ==========================================================================
  // Resolution Strategies
  // ==========================================================================

  describe('Resolution Strategies', () => {
    describe('reader-wins strategy', () => {
      beforeEach(() => {
        resolver.setOptions({ defaultStrategy: 'reader-wins' });
      });

      it('should automatically choose reader version', async () => {
        const conflict = createConflict();
        const resolution = await resolver.resolve(conflict);

        expect(resolution.choice).toBe('keep-reader');
        expect(resolution.strategy).toBe('reader-wins');
        expect(resolution.automatic).toBe(true);
      });
    });

    describe('vault-wins strategy', () => {
      beforeEach(() => {
        resolver.setOptions({ defaultStrategy: 'vault-wins' });
      });

      it('should automatically choose vault version', async () => {
        const conflict = createConflict();
        const resolution = await resolver.resolve(conflict);

        expect(resolution.choice).toBe('keep-vault');
        expect(resolution.strategy).toBe('vault-wins');
        expect(resolution.automatic).toBe(true);
      });
    });

    describe('last-write-wins strategy', () => {
      beforeEach(() => {
        resolver.setOptions({ defaultStrategy: 'last-write-wins' });
      });

      it('should choose vault when vault is newer', async () => {
        const conflict = createConflict({
          readerTimestamp: new Date('2025-01-01T10:00:00Z'),
          vaultTimestamp: new Date('2025-01-01T11:00:00Z'),
        });
        const resolution = await resolver.resolve(conflict);

        expect(resolution.choice).toBe('keep-vault');
        expect(resolution.strategy).toBe('last-write-wins');
        expect(resolution.automatic).toBe(true);
      });

      it('should choose reader when reader is newer', async () => {
        const conflict = createConflict({
          readerTimestamp: new Date('2025-01-01T12:00:00Z'),
          vaultTimestamp: new Date('2025-01-01T11:00:00Z'),
        });
        const resolution = await resolver.resolve(conflict);

        expect(resolution.choice).toBe('keep-reader');
        expect(resolution.strategy).toBe('last-write-wins');
        expect(resolution.automatic).toBe(true);
      });

      it('should choose reader when timestamps are equal', async () => {
        const sameTime = new Date('2025-01-01T12:00:00Z');
        const conflict = createConflict({
          readerTimestamp: sameTime,
          vaultTimestamp: sameTime,
        });
        const resolution = await resolver.resolve(conflict);

        expect(resolution.choice).toBe('keep-reader');
      });
    });
  });

  // ==========================================================================
  // Batch Resolution
  // ==========================================================================

  describe('resolveAll', () => {
    it('should resolve multiple conflicts', async () => {
      resolver.setOptions({ defaultStrategy: 'reader-wins' });

      const conflicts = [
        createConflict({ id: 'conflict-001', highlightId: 'hl-001' }),
        createConflict({ id: 'conflict-002', highlightId: 'hl-002' }),
        createConflict({ id: 'conflict-003', highlightId: 'hl-003' }),
      ];

      const resolutions = await resolver.resolveAll(conflicts);

      expect(resolutions).toHaveLength(3);
      resolutions.forEach(r => {
        expect(r.choice).toBe('keep-reader');
      });
    });

    it('should respect batch strategy override', async () => {
      resolver.setOptions({ defaultStrategy: 'ask-user' });

      const conflicts = [
        createConflict({ id: 'conflict-001' }),
        createConflict({ id: 'conflict-002' }),
      ];

      const resolutions = await resolver.resolveAll(conflicts, {
        batchStrategy: 'vault-wins',
      });

      expect(resolutions).toHaveLength(2);
      resolutions.forEach(r => {
        expect(r.choice).toBe('keep-vault');
      });
    });

    it('should handle empty conflict list', async () => {
      const resolutions = await resolver.resolveAll([]);

      expect(resolutions).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Static Utilities
  // ==========================================================================

  describe('valuesConflict', () => {
    it('should detect different strings', () => {
      expect(ConflictResolver.valuesConflict('foo', 'bar')).toBe(true);
    });

    it('should detect same strings as no conflict', () => {
      expect(ConflictResolver.valuesConflict('foo', 'foo')).toBe(false);
    });

    it('should handle whitespace differences', () => {
      expect(ConflictResolver.valuesConflict('  foo  ', 'foo')).toBe(false);
    });

    it('should detect null/undefined vs value', () => {
      expect(ConflictResolver.valuesConflict(null, 'value')).toBe(true);
      expect(ConflictResolver.valuesConflict(undefined, 'value')).toBe(true);
      expect(ConflictResolver.valuesConflict('value', null)).toBe(true);
    });

    it('should detect different numbers', () => {
      expect(ConflictResolver.valuesConflict(5, 10)).toBe(true);
      expect(ConflictResolver.valuesConflict(5, 5)).toBe(false);
    });

    it('should compare objects by JSON', () => {
      expect(ConflictResolver.valuesConflict({ a: 1 }, { a: 1 })).toBe(false);
      expect(ConflictResolver.valuesConflict({ a: 1 }, { a: 2 })).toBe(true);
    });

    it('should detect type differences', () => {
      expect(ConflictResolver.valuesConflict('5', 5)).toBe(true);
    });
  });

  describe('describeConflict', () => {
    it('should describe text conflict', () => {
      const conflict = createConflict({ type: 'text' });
      const description = ConflictResolver.describeConflict(conflict);

      expect(description).toContain('text');
    });

    it('should describe annotation conflict', () => {
      const conflict = createConflict({ type: 'annotation' });
      const description = ConflictResolver.describeConflict(conflict);

      expect(description).toContain('Annotation');
    });

    it('should describe color conflict', () => {
      const conflict = createConflict({ type: 'color' });
      const description = ConflictResolver.describeConflict(conflict);

      expect(description).toContain('color');
    });

    it('should describe deletion conflict', () => {
      const conflict = createConflict({ type: 'deletion' });
      const description = ConflictResolver.describeConflict(conflict);

      expect(description).toContain('deleted');
    });
  });

  // ==========================================================================
  // Configuration
  // ==========================================================================

  describe('Configuration', () => {
    it('should allow updating options', () => {
      resolver.setOptions({ defaultStrategy: 'vault-wins' });
      resolver.setOptions({ notifyOnAutoResolve: true });

      // Options should be merged
      // (We can't directly check internal state, but we can verify behavior)
    });

    it('should respect notifyOnAutoResolve option', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      resolver.setOptions({
        defaultStrategy: 'reader-wins',
        notifyOnAutoResolve: true,
      });

      await resolver.resolve(createConflict());

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ==========================================================================
  // Conflict Types
  // ==========================================================================

  describe('Conflict Types', () => {
    const types: ConflictType[] = ['text', 'annotation', 'color', 'deletion'];

    types.forEach(type => {
      it(`should handle ${type} conflict type`, async () => {
        resolver.setOptions({ defaultStrategy: 'reader-wins' });
        const conflict = createConflict({ type });
        const resolution = await resolver.resolve(conflict);

        expect(resolution.conflict.type).toBe(type);
        expect(resolution.choice).toBe('keep-reader');
      });
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle conflict with undefined timestamps', async () => {
      resolver.setOptions({ defaultStrategy: 'last-write-wins' });

      const conflict = createConflict({
        readerTimestamp: new Date('2025-01-01T10:00:00Z'),
        // @ts-ignore - testing undefined
        vaultTimestamp: undefined,
      });

      // Should not throw, should default to reader
      const resolution = await resolver.resolve(conflict);
      expect(resolution.choice).toBeDefined();
    });

    it('should preserve conflict in resolution result', async () => {
      // Use reader-wins to avoid Modal creation
      resolver.setOptions({ defaultStrategy: 'reader-wins' });

      const conflict = createConflict({ highlightId: 'hl-preserve001' });
      const resolution = await resolver.resolve(conflict);

      expect(resolution.conflict).toBe(conflict);
      expect(resolution.conflict.highlightId).toBe('hl-preserve001');
    });

    it('should handle very long values', async () => {
      resolver.setOptions({ defaultStrategy: 'reader-wins' });

      const longValue = 'x'.repeat(10000);
      const conflict = createConflict({
        readerValue: longValue,
        vaultValue: longValue + 'y',
      });

      const resolution = await resolver.resolve(conflict);
      expect(resolution.choice).toBe('keep-reader');
    });
  });
});
