/**
 * Conflict Resolver
 *
 * Handles conflict resolution between Amnesia highlights and Doc Doctor stubs
 * using configurable strategies.
 *
 * @module integrations/conflict-resolver
 */

import type { Highlight } from '../library/types';
import type { DocDoctorStub } from './doc-doctor-bridge';

/**
 * Conflict resolution strategies
 */
export type ConflictStrategy =
  | 'amnesia-wins'  // Always prefer Amnesia's version
  | 'dd-wins'       // Always prefer Doc Doctor's version
  | 'newest-wins'   // Prefer whichever was updated most recently
  | 'manual';       // Flag for manual resolution (don't auto-resolve)

/**
 * Conflict winner
 */
export type ConflictWinner = 'amnesia' | 'doc-doctor' | 'manual';

/**
 * Resolved conflict result
 */
export interface ResolvedConflict {
  /** Which side won the conflict */
  winner: ConflictWinner;
  /** Strategy used to resolve */
  strategy: ConflictStrategy;
  /** Timestamp of resolution */
  resolvedAt: Date;
  /** Description of what was conflicting */
  description: string;
  /** The winning data (either highlight or stub) */
  data: Highlight | DocDoctorStub;
}

/**
 * Conflict details for manual resolution
 */
export interface ConflictDetails {
  highlightId: string;
  stubId: string;
  highlightVersion: {
    text: string;
    annotation?: string;
    category?: string;
    updatedAt: Date;
  };
  stubVersion: {
    description: string;
    resolution?: string;
    type: string;
    updatedAt: Date;
  };
  conflictType: 'resolution' | 'update' | 'category';
}

/**
 * Conflict Resolver
 *
 * Resolves conflicts between Amnesia highlights and Doc Doctor stubs
 * based on configurable strategies.
 */
export class ConflictResolver {
  /**
   * Resolve a conflict when stub resolution is applied to a modified highlight
   */
  resolveResolutionConflict(
    highlight: Highlight,
    stub: DocDoctorStub,
    strategy: ConflictStrategy
  ): ResolvedConflict {
    const winner = this.determineWinner(
      highlight.updatedAt,
      stub.updatedAt,
      strategy
    );

    return {
      winner,
      strategy,
      resolvedAt: new Date(),
      description: `Resolution conflict: highlight "${highlight.text.slice(0, 50)}..." was modified after last sync`,
      data: winner === 'amnesia' ? highlight : stub,
    };
  }

  /**
   * Resolve a conflict when stub update conflicts with highlight update
   */
  resolveUpdateConflict(
    highlight: Highlight,
    stub: DocDoctorStub,
    strategy: ConflictStrategy
  ): ResolvedConflict {
    const winner = this.determineWinner(
      highlight.updatedAt,
      stub.updatedAt,
      strategy
    );

    return {
      winner,
      strategy,
      resolvedAt: new Date(),
      description: `Update conflict: both highlight and stub were modified`,
      data: winner === 'amnesia' ? highlight : stub,
    };
  }

  /**
   * Resolve a category/type mismatch conflict
   */
  resolveCategoryConflict(
    highlight: Highlight,
    stub: DocDoctorStub,
    strategy: ConflictStrategy
  ): ResolvedConflict {
    const winner = this.determineWinner(
      highlight.updatedAt,
      stub.updatedAt,
      strategy
    );

    return {
      winner,
      strategy,
      resolvedAt: new Date(),
      description: `Category conflict: highlight is "${highlight.category}" but stub is "${stub.type}"`,
      data: winner === 'amnesia' ? highlight : stub,
    };
  }

  /**
   * Determine the winner based on strategy and timestamps
   */
  private determineWinner(
    amnesiaTime: Date,
    ddTime: Date,
    strategy: ConflictStrategy
  ): ConflictWinner {
    switch (strategy) {
      case 'amnesia-wins':
        return 'amnesia';

      case 'dd-wins':
        return 'doc-doctor';

      case 'newest-wins':
        const amnesiaMs = amnesiaTime.getTime();
        const ddMs = ddTime.getTime();
        return amnesiaMs >= ddMs ? 'amnesia' : 'doc-doctor';

      case 'manual':
        return 'manual';

      default:
        // Default to newest-wins
        return amnesiaTime.getTime() >= ddTime.getTime() ? 'amnesia' : 'doc-doctor';
    }
  }

  /**
   * Get conflict details for manual resolution UI
   */
  getConflictDetails(
    highlight: Highlight,
    stub: DocDoctorStub,
    conflictType: 'resolution' | 'update' | 'category'
  ): ConflictDetails {
    return {
      highlightId: highlight.id,
      stubId: stub.id,
      highlightVersion: {
        text: highlight.text,
        annotation: highlight.annotation,
        category: highlight.category,
        updatedAt: highlight.updatedAt,
      },
      stubVersion: {
        description: stub.description,
        resolution: stub.resolution,
        type: stub.type,
        updatedAt: stub.updatedAt,
      },
      conflictType,
    };
  }

  /**
   * Check if two items are in conflict based on timestamps
   */
  hasTimestampConflict(
    amnesiaTime: Date,
    ddTime: Date,
    lastSyncTime?: number
  ): boolean {
    if (!lastSyncTime) return false;

    const amnesiaMs = amnesiaTime.getTime();
    const ddMs = ddTime.getTime();

    // Both were modified after last sync
    return amnesiaMs > lastSyncTime && ddMs > lastSyncTime;
  }

  /**
   * Merge highlight and stub data (for future bi-directional merge strategy)
   *
   * This creates a merged version taking the best from both sides:
   * - Text from highlight (canonical source)
   * - Resolution from stub
   * - Most recent timestamp
   * - Combined tags
   */
  mergeConflict(
    highlight: Highlight,
    stub: DocDoctorStub
  ): Partial<Highlight> {
    const existingAnnotation = highlight.annotation?.trim() || '';
    const stubResolution = stub.resolution
      ? `\n\n[Resolved in Doc Doctor] ${stub.resolution}`
      : '';

    // Merge tags
    const tags = new Set(highlight.tags ?? []);
    if (stub.resolution) {
      tags.add('resolved');
    }

    return {
      annotation: existingAnnotation
        ? `${existingAnnotation}${stubResolution}`
        : stubResolution.trim() || undefined,
      tags: Array.from(tags),
      lastSyncedAt: Date.now(),
    };
  }
}
