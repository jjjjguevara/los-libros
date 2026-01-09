/**
 * Amnesia Migrations
 *
 * This module exports all migrations for the Amnesia plugin.
 * Migrations are run during plugin initialization to update
 * data structures when needed.
 *
 * @module migrations
 */

export {
  runMigration as runCategoryMigration,
  migrateHighlightsToCategories,
  isMigrationNeeded,
  type MigrationResult,
} from './001-add-categories';
