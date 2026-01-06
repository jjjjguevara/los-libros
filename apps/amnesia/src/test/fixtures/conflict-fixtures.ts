/**
 * Conflict Fixtures
 *
 * Test fixtures for sync conflict resolution scenarios.
 * Covers all 5 resolution strategies and common conflict types.
 *
 * @see docs/plans/unified-sync-architecture-prd.md
 */

import type {
  SyncChange,
  SyncConflict,
  ConflictStrategy,
} from '../../sync/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Conflict scenario for testing
 */
export interface ConflictScenario {
  /** Scenario name */
  name: string;
  /** Description */
  description: string;
  /** Entity type */
  entityType: SyncChange['entityType'];
  /** Field in conflict (for metadata) */
  field?: string;
  /** Local value */
  localValue: unknown;
  /** Remote value */
  remoteValue: unknown;
  /** Local timestamp */
  localTimestamp: Date;
  /** Remote timestamp */
  remoteTimestamp: Date;
  /** Expected winner for each strategy */
  expectedWinner: Record<ConflictStrategy, 'local' | 'remote' | 'merge' | 'ask'>;
  /** Merged value (if applicable) */
  mergedValue?: unknown;
}

/**
 * Create a conflict from scenario
 */
export function createConflictFromScenario(scenario: ConflictScenario): SyncConflict {
  const localChange: SyncChange = {
    id: `local-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    source: 'file',
    entityType: scenario.entityType,
    entityId: `entity-${scenario.name}`,
    operation: 'update',
    timestamp: scenario.localTimestamp,
    data: scenario.field ? { [scenario.field]: scenario.localValue } : scenario.localValue,
  };

  const remoteChange: SyncChange = {
    id: `remote-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    source: 'server',
    entityType: scenario.entityType,
    entityId: `entity-${scenario.name}`,
    operation: 'update',
    timestamp: scenario.remoteTimestamp,
    data: scenario.field ? { [scenario.field]: scenario.remoteValue } : scenario.remoteValue,
  };

  return {
    id: `conflict-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    entityType: scenario.entityType,
    entityId: `entity-${scenario.name}`,
    localChange,
    remoteChange,
    field: scenario.field,
    localValue: scenario.localValue,
    remoteValue: scenario.remoteValue,
    resolved: false,
  };
}

// ============================================================================
// Rating Conflict Scenarios
// ============================================================================

/**
 * Rating conflict: local newer
 */
export const RATING_LOCAL_NEWER: ConflictScenario = {
  name: 'rating-local-newer',
  description: 'User rated book locally after remote rating',
  entityType: 'metadata',
  field: 'rating',
  localValue: 5,
  remoteValue: 3,
  localTimestamp: new Date('2024-06-15T12:00:00Z'),
  remoteTimestamp: new Date('2024-06-15T10:00:00Z'),
  expectedWinner: {
    'last-write-wins': 'local',
    'prefer-local': 'local',
    'prefer-remote': 'remote',
    'merge': 'local', // For numeric, prefer newer
    'ask-user': 'ask',
  },
};

/**
 * Rating conflict: remote newer
 */
export const RATING_REMOTE_NEWER: ConflictScenario = {
  name: 'rating-remote-newer',
  description: 'Remote rating updated after local rating',
  entityType: 'metadata',
  field: 'rating',
  localValue: 4,
  remoteValue: 5,
  localTimestamp: new Date('2024-06-15T10:00:00Z'),
  remoteTimestamp: new Date('2024-06-15T12:00:00Z'),
  expectedWinner: {
    'last-write-wins': 'remote',
    'prefer-local': 'local',
    'prefer-remote': 'remote',
    'merge': 'remote', // For numeric, prefer newer
    'ask-user': 'ask',
  },
};

/**
 * Rating conflict: null vs value
 */
export const RATING_NULL_VS_VALUE: ConflictScenario = {
  name: 'rating-null-vs-value',
  description: 'Local has no rating, remote has rating',
  entityType: 'metadata',
  field: 'rating',
  localValue: null,
  remoteValue: 4,
  localTimestamp: new Date('2024-06-15T12:00:00Z'),
  remoteTimestamp: new Date('2024-06-15T10:00:00Z'),
  expectedWinner: {
    'last-write-wins': 'local',
    'prefer-local': 'local',
    'prefer-remote': 'remote',
    'merge': 'remote', // Prefer value over null
    'ask-user': 'ask',
  },
  mergedValue: 4,
};

// ============================================================================
// Progress Conflict Scenarios
// ============================================================================

/**
 * Progress conflict: local ahead
 */
export const PROGRESS_LOCAL_AHEAD: ConflictScenario = {
  name: 'progress-local-ahead',
  description: 'User read further locally',
  entityType: 'progress',
  field: 'progress',
  localValue: 75,
  remoteValue: 50,
  localTimestamp: new Date('2024-06-15T12:00:00Z'),
  remoteTimestamp: new Date('2024-06-15T10:00:00Z'),
  expectedWinner: {
    'last-write-wins': 'local',
    'prefer-local': 'local',
    'prefer-remote': 'remote',
    'merge': 'local', // Take higher progress
    'ask-user': 'ask',
  },
  mergedValue: 75, // Max of both
};

/**
 * Progress conflict: remote ahead
 */
export const PROGRESS_REMOTE_AHEAD: ConflictScenario = {
  name: 'progress-remote-ahead',
  description: 'User read further on another device',
  entityType: 'progress',
  field: 'progress',
  localValue: 25,
  remoteValue: 60,
  localTimestamp: new Date('2024-06-15T12:00:00Z'),
  remoteTimestamp: new Date('2024-06-15T10:00:00Z'),
  expectedWinner: {
    'last-write-wins': 'local',
    'prefer-local': 'local',
    'prefer-remote': 'remote',
    'merge': 'remote', // Take higher progress
    'ask-user': 'ask',
  },
  mergedValue: 60, // Max of both
};

/**
 * Progress conflict: local reset (re-reading)
 */
export const PROGRESS_LOCAL_RESET: ConflictScenario = {
  name: 'progress-local-reset',
  description: 'User reset progress to re-read book',
  entityType: 'progress',
  field: 'progress',
  localValue: 0,
  remoteValue: 100,
  localTimestamp: new Date('2024-06-15T12:00:00Z'),
  remoteTimestamp: new Date('2024-06-15T10:00:00Z'),
  expectedWinner: {
    'last-write-wins': 'local',
    'prefer-local': 'local',
    'prefer-remote': 'remote',
    'merge': 'ask', // Ambiguous - need to ask
    'ask-user': 'ask',
  },
};

// ============================================================================
// Tags Conflict Scenarios
// ============================================================================

/**
 * Tags conflict: different tags
 */
export const TAGS_DIFFERENT: ConflictScenario = {
  name: 'tags-different',
  description: 'Different tags added locally and remotely',
  entityType: 'metadata',
  field: 'tags',
  localValue: ['fiction', 'favorite'],
  remoteValue: ['fiction', 'classic'],
  localTimestamp: new Date('2024-06-15T12:00:00Z'),
  remoteTimestamp: new Date('2024-06-15T10:00:00Z'),
  expectedWinner: {
    'last-write-wins': 'local',
    'prefer-local': 'local',
    'prefer-remote': 'remote',
    'merge': 'merge',
    'ask-user': 'ask',
  },
  mergedValue: ['fiction', 'favorite', 'classic'], // Union of both
};

/**
 * Tags conflict: tag removed locally
 */
export const TAGS_LOCAL_REMOVED: ConflictScenario = {
  name: 'tags-local-removed',
  description: 'Tag removed locally but still on remote',
  entityType: 'metadata',
  field: 'tags',
  localValue: ['fiction'],
  remoteValue: ['fiction', 'to-read'],
  localTimestamp: new Date('2024-06-15T12:00:00Z'),
  remoteTimestamp: new Date('2024-06-15T10:00:00Z'),
  expectedWinner: {
    'last-write-wins': 'local',
    'prefer-local': 'local',
    'prefer-remote': 'remote',
    'merge': 'local', // Respect intentional removal
    'ask-user': 'ask',
  },
};

/**
 * Tags conflict: case sensitivity
 */
export const TAGS_CASE_CONFLICT: ConflictScenario = {
  name: 'tags-case-conflict',
  description: 'Same tag with different casing',
  entityType: 'metadata',
  field: 'tags',
  localValue: ['Fiction', 'SciFi'],
  remoteValue: ['fiction', 'scifi'],
  localTimestamp: new Date('2024-06-15T12:00:00Z'),
  remoteTimestamp: new Date('2024-06-15T10:00:00Z'),
  expectedWinner: {
    'last-write-wins': 'local',
    'prefer-local': 'local',
    'prefer-remote': 'remote',
    'merge': 'merge', // Normalize casing
    'ask-user': 'ask',
  },
  mergedValue: ['fiction', 'scifi'], // Normalized lowercase
};

// ============================================================================
// Highlight Conflict Scenarios
// ============================================================================

/**
 * Highlights: same selection, different notes
 */
export const HIGHLIGHT_NOTE_CONFLICT: ConflictScenario = {
  name: 'highlight-note-conflict',
  description: 'Same highlight with different annotations',
  entityType: 'highlight',
  field: 'note',
  localValue: 'This is my local note',
  remoteValue: 'This is my remote note',
  localTimestamp: new Date('2024-06-15T12:00:00Z'),
  remoteTimestamp: new Date('2024-06-15T10:00:00Z'),
  expectedWinner: {
    'last-write-wins': 'local',
    'prefer-local': 'local',
    'prefer-remote': 'remote',
    'merge': 'ask', // Notes can't be easily merged
    'ask-user': 'ask',
  },
};

/**
 * Highlights: same selection, different colors
 */
export const HIGHLIGHT_COLOR_CONFLICT: ConflictScenario = {
  name: 'highlight-color-conflict',
  description: 'Same highlight with different colors',
  entityType: 'highlight',
  field: 'color',
  localValue: '#ffff00', // Yellow
  remoteValue: '#00ff00', // Green
  localTimestamp: new Date('2024-06-15T12:00:00Z'),
  remoteTimestamp: new Date('2024-06-15T10:00:00Z'),
  expectedWinner: {
    'last-write-wins': 'local',
    'prefer-local': 'local',
    'prefer-remote': 'remote',
    'merge': 'local', // Prefer newer
    'ask-user': 'ask',
  },
};

/**
 * Highlights: overlapping selections
 */
export const HIGHLIGHT_OVERLAP: ConflictScenario = {
  name: 'highlight-overlap',
  description: 'Overlapping highlight selections',
  entityType: 'highlight',
  localValue: {
    cfiRange: 'epubcfi(/6/4!/4/2/1:0,/6/4!/4/2/1:50)',
    text: 'This is the local selection',
  },
  remoteValue: {
    cfiRange: 'epubcfi(/6/4!/4/2/1:25,/6/4!/4/2/1:75)',
    text: 'This is the remote selection',
  },
  localTimestamp: new Date('2024-06-15T12:00:00Z'),
  remoteTimestamp: new Date('2024-06-15T10:00:00Z'),
  expectedWinner: {
    'last-write-wins': 'local',
    'prefer-local': 'local',
    'prefer-remote': 'remote',
    'merge': 'ask', // Overlaps need manual resolution
    'ask-user': 'ask',
  },
};

// ============================================================================
// Book File Conflict Scenarios
// ============================================================================

/**
 * Book file: different versions
 */
export const BOOK_FILE_DIFFERENT: ConflictScenario = {
  name: 'book-file-different',
  description: 'Different book file versions',
  entityType: 'file',
  localValue: { hash: 'abc123', size: 1024000 },
  remoteValue: { hash: 'def456', size: 1025000 },
  localTimestamp: new Date('2024-06-15T12:00:00Z'),
  remoteTimestamp: new Date('2024-06-15T10:00:00Z'),
  expectedWinner: {
    'last-write-wins': 'local',
    'prefer-local': 'local',
    'prefer-remote': 'remote',
    'merge': 'ask', // Can't merge files
    'ask-user': 'ask',
  },
};

// ============================================================================
// Conflict Scenario Collections
// ============================================================================

/**
 * All rating conflicts
 */
export const RATING_CONFLICTS: ConflictScenario[] = [
  RATING_LOCAL_NEWER,
  RATING_REMOTE_NEWER,
  RATING_NULL_VS_VALUE,
];

/**
 * All progress conflicts
 */
export const PROGRESS_CONFLICTS: ConflictScenario[] = [
  PROGRESS_LOCAL_AHEAD,
  PROGRESS_REMOTE_AHEAD,
  PROGRESS_LOCAL_RESET,
];

/**
 * All tag conflicts
 */
export const TAG_CONFLICTS: ConflictScenario[] = [
  TAGS_DIFFERENT,
  TAGS_LOCAL_REMOVED,
  TAGS_CASE_CONFLICT,
];

/**
 * All highlight conflicts
 */
export const HIGHLIGHT_CONFLICTS: ConflictScenario[] = [
  HIGHLIGHT_NOTE_CONFLICT,
  HIGHLIGHT_COLOR_CONFLICT,
  HIGHLIGHT_OVERLAP,
];

/**
 * All conflict scenarios
 */
export const ALL_CONFLICT_SCENARIOS: ConflictScenario[] = [
  ...RATING_CONFLICTS,
  ...PROGRESS_CONFLICTS,
  ...TAG_CONFLICTS,
  ...HIGHLIGHT_CONFLICTS,
  BOOK_FILE_DIFFERENT,
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get scenarios for a specific strategy
 */
export function getScenariosForStrategy(
  strategy: ConflictStrategy
): ConflictScenario[] {
  return ALL_CONFLICT_SCENARIOS.filter(
    (s) => s.expectedWinner[strategy] !== 'ask'
  );
}

/**
 * Get scenarios that require user interaction
 */
export function getScenariosRequiringUserInput(): ConflictScenario[] {
  return ALL_CONFLICT_SCENARIOS.filter((s) => {
    const winners = Object.values(s.expectedWinner);
    return winners.some((w) => w === 'ask');
  });
}

/**
 * Get scenarios where merge produces a different result
 */
export function getMergeableScenarios(): ConflictScenario[] {
  return ALL_CONFLICT_SCENARIOS.filter(
    (s) => s.expectedWinner.merge === 'merge' && s.mergedValue !== undefined
  );
}

/**
 * Create multiple conflicts from scenarios
 */
export function createConflictsFromScenarios(
  scenarios: ConflictScenario[]
): SyncConflict[] {
  return scenarios.map(createConflictFromScenario);
}
