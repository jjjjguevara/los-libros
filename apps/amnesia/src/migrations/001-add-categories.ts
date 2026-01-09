/**
 * Migration: Add categories to existing highlights
 *
 * This migration adds the `category` field to existing highlights based on their color,
 * using the unified annotation vocabulary mapping. It also initializes Doc Doctor
 * sync fields for all highlights.
 *
 * @module migrations/001-add-categories
 */

import { getAnnotationTypeFromColor } from '@shared/annotations';
import type { AnnotationType } from '@shared/annotations';
import type { Highlight, HighlightColor } from '../library/types';

/**
 * Migration result
 */
export interface MigrationResult {
  /** Total highlights processed */
  total: number;
  /** Highlights that had category added */
  categorized: number;
  /** Highlights that had sync fields initialized */
  syncFieldsInitialized: number;
  /** Any errors encountered */
  errors: string[];
}

/**
 * Highlight index structure (matches highlight-service.ts)
 */
interface HighlightIndex {
  version: number;
  highlights: Record<string, Highlight[]>;
}

/**
 * Check if migration is needed
 *
 * Returns true if any highlights are missing category or sync fields
 */
export function isMigrationNeeded(index: HighlightIndex): boolean {
  for (const highlights of Object.values(index.highlights)) {
    for (const h of highlights) {
      if (!h.category || h.syncedToDocDoctor === undefined) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Migrate highlights to add categories and sync fields
 *
 * This function creates a new index with migrated data to avoid corrupting
 * the original on partial failure. The caller receives both the migrated
 * index and the result statistics.
 *
 * @param index The highlight index to migrate (not mutated)
 * @returns Migrated index and migration result
 */
export function migrateHighlightsToCategories(
  index: HighlightIndex
): { migratedIndex: HighlightIndex; result: MigrationResult } {
  const result: MigrationResult = {
    total: 0,
    categorized: 0,
    syncFieldsInitialized: 0,
    errors: [],
  };

  // Create a new index to avoid mutating the original
  const migratedIndex: HighlightIndex = {
    version: index.version,
    highlights: {},
  };

  for (const [bookId, highlights] of Object.entries(index.highlights)) {
    // Create migrated array for this book
    migratedIndex.highlights[bookId] = highlights.map((h) => {
      result.total++;

      try {
        // Create a copy of the highlight
        const migrated: Highlight = { ...h };

        // Add category if missing
        if (!migrated.category) {
          // Handle missing color field
          if (!migrated.color) {
            migrated.category = 'verify' as AnnotationType;
            result.categorized++;
            result.errors.push(
              `Highlight ${migrated.id} in book ${bookId} is missing color field, defaulting to 'verify'`
            );
          } else if (isValidHighlightColor(migrated.color)) {
            migrated.category = getAnnotationTypeFromColor(migrated.color);
            result.categorized++;
          } else {
            // Fallback to 'verify' if color is invalid
            migrated.category = 'verify' as AnnotationType;
            result.categorized++;
            result.errors.push(
              `Highlight ${migrated.id} in book ${bookId} has invalid color "${migrated.color}", defaulting to 'verify'`
            );
          }
        }

        // Initialize sync fields if missing
        if (migrated.syncedToDocDoctor === undefined) {
          migrated.syncedToDocDoctor = false;
          result.syncFieldsInitialized++;
        }

        // Ensure docDoctorStubId and lastSyncedAt are not set for unsynced highlights
        if (!migrated.syncedToDocDoctor) {
          delete migrated.docDoctorStubId;
          delete migrated.lastSyncedAt;
        }

        return migrated;
      } catch (error) {
        result.errors.push(
          `Failed to migrate highlight ${h.id} in book ${bookId}: ${error}`
        );
        // Return original highlight on error to preserve data
        return h;
      }
    });
  }

  return { migratedIndex, result };
}

/**
 * Type guard to check if a string is a valid HighlightColor
 */
function isValidHighlightColor(color: string): color is HighlightColor {
  return ['yellow', 'green', 'blue', 'pink', 'purple', 'orange'].includes(color);
}

/**
 * Run migration on plugin data
 *
 * This is the main entry point for the migration, typically called
 * during plugin initialization.
 *
 * @param loadData Function to load plugin data
 * @param saveData Function to save plugin data
 * @returns Migration result or null if migration was not needed
 */
export async function runMigration(
  loadData: () => Promise<unknown>,
  saveData: (data: unknown) => Promise<void>
): Promise<MigrationResult | null> {
  try {
    const data = (await loadData()) as { highlightIndex?: HighlightIndex } | null;

    if (!data?.highlightIndex) {
      // No highlight data to migrate
      return null;
    }

    const originalIndex = data.highlightIndex;

    // Check if migration is needed
    if (!isMigrationNeeded(originalIndex)) {
      console.log('[Amnesia] Migration 001: No migration needed, all highlights have categories');
      return null;
    }

    console.log('[Amnesia] Migration 001: Starting highlight category migration...');

    // Run migration (creates new index, doesn't mutate original)
    const { migratedIndex, result } = migrateHighlightsToCategories(originalIndex);

    // Save updated data - if this fails, original data is preserved
    await saveData({
      ...data,
      highlightIndex: migratedIndex,
    });

    console.log(
      `[Amnesia] Migration 001: Complete. ` +
      `Processed ${result.total} highlights, ` +
      `categorized ${result.categorized}, ` +
      `initialized sync fields for ${result.syncFieldsInitialized}`
    );

    if (result.errors.length > 0) {
      console.warn('[Amnesia] Migration 001: Encountered errors:', result.errors);
    }

    return result;
  } catch (error) {
    console.error('[Amnesia] Migration 001: Failed to run migration:', error);
    throw error;
  }
}
