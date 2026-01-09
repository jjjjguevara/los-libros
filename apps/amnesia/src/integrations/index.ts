/**
 * Integrations Module
 *
 * Cross-plugin integrations and bridges.
 *
 * @module integrations
 */

export {
  DocDoctorBridge,
  createDocDoctorBridge,
  type DocDoctorAPI,
  type ScopedDocDoctorAPI,
  type DocDoctorStub,
  type StubType,
  type DocDoctorCapability,
  type BookHealth,
  type BridgeStatus,
  type BridgeEventMap,
} from './doc-doctor-bridge';

export {
  AnnotationSyncManager,
  createSyncManager,
  type SyncResult,
  type BatchSyncResult,
  type SyncStats,
  type SyncEventMap,
} from './sync-manager';

export {
  ConflictResolver,
  type ConflictStrategy,
  type ConflictWinner,
  type ResolvedConflict,
  type ConflictDetails,
} from './conflict-resolver';

export {
  DeduplicationManager,
  type DuplicateMatch,
  type DedupStats,
} from './deduplication';

export {
  SyncTelemetry,
  createSyncTelemetry,
  connectTelemetryToSyncManager,
  type TelemetrySnapshot,
  type RealtimeMetrics,
  type TelemetryEvent,
} from './sync-telemetry';
