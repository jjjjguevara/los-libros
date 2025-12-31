/**
 * Migration Module
 *
 * Exports migration engine, backup system, and link updater.
 */

// Backup system
export {
  BackupService,
  type BackupMetadata,
  type BackedUpFile,
  type BackupOptions,
} from './backup';

// Link updater
export {
  LinkUpdater,
  type LinkUpdateResult,
  type MoveMapping,
} from './link-updater';

// Migration engine
export {
  Migrator,
  type Migration,
  type MigrationContext,
  type MigrationStepResult,
  type MigrationResult,
  type MigrationState,
} from './migrator';
