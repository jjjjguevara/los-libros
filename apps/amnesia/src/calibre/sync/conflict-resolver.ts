/**
 * ConflictResolver
 *
 * Resolves conflicts when both Obsidian and Calibre have changes
 * to the same field of the same book.
 */

import type {
  SyncChange,
  ConflictResolution,
  SyncableField,
} from '../calibre-types';

/**
 * A conflict between Obsidian and Calibre changes
 */
export interface Conflict {
  field: SyncableField;
  calibreId: number;
  bookId: string;
  obsidianChange: SyncChange;
  calibreChange: SyncChange;
  resolution?: ResolvedConflict;
}

/**
 * Resolution of a conflict
 */
export interface ResolvedConflict {
  winner: 'obsidian' | 'calibre';
  finalValue: unknown;
  reason: string;
}

export class ConflictResolver {
  private strategy: ConflictResolution;

  constructor(strategy: ConflictResolution = 'last-write') {
    this.strategy = strategy;
  }

  /**
   * Set the resolution strategy
   */
  setStrategy(strategy: ConflictResolution): void {
    this.strategy = strategy;
  }

  /**
   * Detect conflicts between Obsidian and Calibre changes
   */
  detectConflicts(
    obsidianChanges: SyncChange[],
    calibreChanges: SyncChange[]
  ): Conflict[] {
    const conflicts: Conflict[] = [];

    // Group Obsidian changes by book and field
    const obsidianMap = new Map<string, SyncChange>();
    for (const change of obsidianChanges) {
      const key = `${change.calibreId}:${change.field}`;
      obsidianMap.set(key, change);
    }

    // Find overlapping Calibre changes
    for (const calibreChange of calibreChanges) {
      const key = `${calibreChange.calibreId}:${calibreChange.field}`;
      const obsidianChange = obsidianMap.get(key);

      if (obsidianChange) {
        // Both sides changed the same field
        conflicts.push({
          field: calibreChange.field,
          calibreId: calibreChange.calibreId,
          bookId: calibreChange.bookId,
          obsidianChange,
          calibreChange,
        });
      }
    }

    return conflicts;
  }

  /**
   * Resolve a single conflict
   */
  resolveConflict(conflict: Conflict): ResolvedConflict {
    switch (this.strategy) {
      case 'prefer-calibre':
        return {
          winner: 'calibre',
          finalValue: conflict.calibreChange.newValue,
          reason: 'Configured to prefer Calibre values',
        };

      case 'prefer-obsidian':
        return {
          winner: 'obsidian',
          finalValue: conflict.obsidianChange.newValue,
          reason: 'Configured to prefer Obsidian values',
        };

      case 'last-write':
      default:
        // Compare timestamps
        const obsidianTime = conflict.obsidianChange.timestamp.getTime();
        const calibreTime = conflict.calibreChange.timestamp.getTime();

        if (obsidianTime > calibreTime) {
          return {
            winner: 'obsidian',
            finalValue: conflict.obsidianChange.newValue,
            reason: 'Obsidian change is more recent',
          };
        } else {
          return {
            winner: 'calibre',
            finalValue: conflict.calibreChange.newValue,
            reason: 'Calibre change is more recent',
          };
        }
    }
  }

  /**
   * Resolve all conflicts
   */
  resolveAll(conflicts: Conflict[]): Conflict[] {
    for (const conflict of conflicts) {
      conflict.resolution = this.resolveConflict(conflict);
    }
    return conflicts;
  }

  /**
   * Merge changes, resolving conflicts
   */
  mergeChanges(
    obsidianChanges: SyncChange[],
    calibreChanges: SyncChange[]
  ): {
    toObsidian: SyncChange[];
    toCalibre: SyncChange[];
    conflicts: Conflict[];
  } {
    const conflicts = this.detectConflicts(obsidianChanges, calibreChanges);
    this.resolveAll(conflicts);

    // Get IDs of conflicting changes
    const conflictingObsidian = new Set(conflicts.map((c) => c.obsidianChange.id));
    const conflictingCalibre = new Set(conflicts.map((c) => c.calibreChange.id));

    // Non-conflicting changes pass through
    const toObsidian = calibreChanges.filter((c) => !conflictingCalibre.has(c.id));
    const toCalibre = obsidianChanges.filter((c) => !conflictingObsidian.has(c.id));

    // Add resolved conflicts to appropriate list
    for (const conflict of conflicts) {
      if (conflict.resolution) {
        if (conflict.resolution.winner === 'calibre') {
          // Calibre wins - push to Obsidian
          toObsidian.push({
            ...conflict.calibreChange,
            newValue: conflict.resolution.finalValue,
          });
        } else {
          // Obsidian wins - push to Calibre
          toCalibre.push({
            ...conflict.obsidianChange,
            newValue: conflict.resolution.finalValue,
          });
        }
      }
    }

    return { toObsidian, toCalibre, conflicts };
  }

  /**
   * Create a conflict report for logging/debugging
   */
  generateConflictReport(conflicts: Conflict[]): string {
    if (conflicts.length === 0) {
      return 'No conflicts detected.';
    }

    const lines = [
      `## Sync Conflict Report`,
      ``,
      `**Strategy:** ${this.strategy}`,
      `**Conflicts Found:** ${conflicts.length}`,
      ``,
    ];

    for (const conflict of conflicts) {
      lines.push(`### Book ${conflict.calibreId} - ${conflict.field}`);
      lines.push(`- **Obsidian value:** ${JSON.stringify(conflict.obsidianChange.newValue)}`);
      lines.push(`- **Calibre value:** ${JSON.stringify(conflict.calibreChange.newValue)}`);

      if (conflict.resolution) {
        lines.push(`- **Winner:** ${conflict.resolution.winner}`);
        lines.push(`- **Reason:** ${conflict.resolution.reason}`);
        lines.push(`- **Final value:** ${JSON.stringify(conflict.resolution.finalValue)}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
