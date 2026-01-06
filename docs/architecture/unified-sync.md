# Unified Sync Architecture

## Overview

The Amnesia Unified Sync Engine provides a cohesive sync system that coordinates multiple data sources (Calibre, Amnesia Server, local files) with:

- **Incremental/delta sync** - Only process changes since last sync
- **Parallel processing** - Configurable concurrency for downloads
- **Cross-session resume** - Checkpoint to IndexedDB, resume after crashes
- **Conflict resolution** - Auto and manual resolution strategies
- **Progress tracking** - Real-time updates with ETA

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      UnifiedSyncEngine                          │
│         (Orchestrates all sync, manages state, events)          │
└────────────┬────────────────────────────────────────────────────┘
             │
             ├─► SyncAdapter Interface
             │   ├─► CalibreSyncAdapter (wraps CalibreService)
             │   ├─► ServerSyncAdapter (wraps AmnesiaClient)
             │   └─► FileSyncAdapter (wraps ChunkedUploader)
             │
             ├─► DeltaTracker (change detection, SHA-256 hashing)
             ├─► ConflictResolutionManager (auto + manual)
             ├─► ParallelExecutor (worker pool, rate limiting)
             ├─► CheckpointManager (IndexedDB persistence)
             └─► MetadataSyncService (field mapping, validation)
```

## Core Components

### UnifiedSyncEngine

**Location:** `src/sync/unified-sync-engine.ts`

The main orchestrator that:
- Manages sync sessions and state
- Coordinates adapters for each data source
- Emits progress events
- Handles checkpointing for resume

```typescript
interface UnifiedSyncEngine {
  // Sync operations
  sync(options?: SyncOptions): Promise<SyncResult>;
  resume(): Promise<SyncResult>;
  cancel(): Promise<void>;
  pause(): Promise<void>;

  // State
  getStatus(): SyncEngineStatus;
  getCurrentSession(): SyncSession | null;
  hasResumableSync(): Promise<boolean>;

  // Events
  on<K extends keyof SyncEngineEvents>(event: K, listener): () => void;
  off<K extends keyof SyncEngineEvents>(event: K, listener): void;
}
```

### SyncAdapter Interface

**Location:** `src/sync/sync-adapter.ts`

Common interface for all data sources:

```typescript
interface SyncAdapter {
  readonly type: SyncAdapterType;  // 'calibre' | 'server' | 'file'
  readonly name: string;
  readonly capabilities: AdapterCapabilities;

  // Connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<boolean>;

  // Change detection
  detectChanges(since?: Date): Promise<SyncChange[]>;
  getManifest(): Promise<SyncManifest>;

  // Data operations
  getEntity(type, id): Promise<unknown>;
  applyChange(change: SyncChange): Promise<void>;
}
```

### Concrete Adapters

#### CalibreSyncAdapter
**Location:** `src/sync/adapters/calibre-adapter.ts`

Wraps CalibreClient to sync:
- Book metadata (title, authors, series, tags, rating)
- Cover images
- Custom columns

#### ServerSyncAdapter
**Location:** `src/sync/adapters/server-adapter.ts`

Wraps AmnesiaClient to sync:
- Reading progress (CFI position, percentage)
- Highlights and annotations
- Notes

#### FileSyncAdapter
**Location:** `src/sync/adapters/file-adapter.ts`

Wraps ChunkedUploader for:
- Large file uploads with chunking
- Deduplication via hash comparison
- Resume interrupted uploads

### DeltaTracker

**Location:** `src/sync/delta-tracker.ts`

Tracks changes between sync sessions:

```typescript
interface DeltaTracker {
  // Hash computation
  computeHash(content: unknown): Promise<string>;
  computeFileHash(data: ArrayBuffer): Promise<string>;

  // Change detection
  detectChanges(source, manifest): Promise<DeltaResult>;
  hasChanged(local: DeltaState, remote: ManifestEntry): Promise<boolean>;

  // State management
  updateState(source, entries): Promise<void>;
  getLastSyncTime(source): Promise<Date | null>;
}
```

### ConflictResolutionManager

**Location:** `src/sync/conflict-resolution-manager.ts`

Handles conflicts between local and remote data:

```typescript
interface ConflictResolutionManager {
  // Detection
  detectConflict(local, remote): SyncConflict | null;
  detectFieldConflicts(entityId, localData, remoteData): SyncConflict[];

  // Resolution
  tryAutoResolve(conflict): boolean;
  autoResolveAll(): SyncConflict[];
  resolveConflict(conflict, strategy): void;
  applyResolution(result: ResolutionResult): void;

  // Batch operations
  groupConflicts(): ConflictGroup[];
  resolveGroup(key, strategy): void;
}
```

**Resolution Strategies:**
- `last-write-wins` - Use newer timestamp
- `prefer-local` - Always keep local value
- `prefer-remote` - Always keep remote value
- `merge` - Combine values (for arrays/tags)
- `ask-user` - Show conflict modal

### ParallelExecutor

**Location:** `src/sync/parallel-executor.ts`

Manages concurrent task execution:

```typescript
interface ParallelExecutor<T> {
  add(id: string, task: () => Promise<T>): void;
  execute(onProgress?: (p: ExecutorProgress) => void): Promise<BatchResult<T>>;
  cancel(): void;
  pause(): void;
  resume(): void;
}
```

Features:
- Configurable concurrency (default: 5)
- Automatic retry with exponential backoff
- Rate limiting (token bucket)
- Priority queuing

### CheckpointManager

**Location:** `src/sync/checkpoint-manager.ts`

Enables cross-session resume:

```typescript
interface CheckpointManager {
  createCheckpoint(session: SyncSession): Promise<SyncCheckpoint>;
  updateCheckpoint(sessionId, progress): Promise<void>;
  getIncompleteSync(): Promise<{ session, checkpoint } | null>;
  hasResumableSync(): Promise<boolean>;
  clearCheckpoints(): Promise<void>;
}
```

Storage: IndexedDB (`amnesia-sync-checkpoints`)

## Data Flow

### Incremental Sync Flow

```
1. User clicks "Catch-Up Sync"
   ↓
2. Load lastSync timestamp from settings
   ↓
3. For each adapter:
   ├─► detectChanges(lastSync)
   │   ├─► Calibre: Compare timestamps/hashes
   │   ├─► Server: GET /api/sync/changes?since=...
   │   └─► Files: Compare manifest hashes
   ↓
4. Merge and deduplicate changes
   ↓
5. ParallelExecutor.process(changes)
   ├─► Process N items concurrently
   ├─► Checkpoint every 100 items
   └─► Emit progress events
   ↓
6. ConflictResolutionManager.detectConflicts()
   ├─► Auto-resolve where possible
   └─► Queue manual conflicts for modal
   ↓
7. Show ConflictModal if any remain
   ↓
8. Complete: Update lastSync, clear checkpoints
```

### Resume Flow

```
1. Plugin loads
   ↓
2. CheckpointManager.hasResumableSync()
   ↓
3. If true: Show ResumeToast
   ↓
4. User clicks "Resume"
   ↓
5. Load checkpoint from IndexedDB
   ↓
6. Restore session state
   ↓
7. Continue from pendingChanges
```

## UI Components

### ConflictModal
**Location:** `src/ui/modals/ConflictModal.svelte`

- Side-by-side comparison (local vs remote)
- Single item or batch resolution mode
- Keyboard shortcuts (1/2/3 for quick choices)
- "Apply to similar" option
- "Remember choice" option

### SyncModeModal
**Location:** `src/ui/modals/SyncModeModal.svelte`

- Catch-up Sync (incremental, recommended)
- Full Re-Sync (complete rebuild)
- Custom Sync (select adapters)

### SyncProgressModal
**Location:** `src/ui/modals/SyncProgressModal.svelte`

- Real-time progress bar
- Stats: processed, skipped, errors
- ETA and speed display
- Pause/Resume/Cancel buttons
- Error expansion panel

### ResumeToast
**Location:** `src/ui/components/ResumeToast.svelte`

- Appears when incomplete sync detected
- Resume/Later/Discard options
- Auto-dismiss with countdown
- Progress indicator

## Configuration

### SyncConfig

```typescript
interface SyncConfig {
  defaultMode: SyncMode;                    // 'incremental'
  defaultConflictStrategy: ConflictStrategy; // 'last-write-wins'
  concurrency: number;                       // 5
  checkpointInterval: number;                // 100 items
  enableResume: boolean;                     // true
  rateLimit: number;                         // 0 (unlimited)
  requestTimeout: number;                    // 30000ms
  retryCount: number;                        // 3
  retryDelay: number;                        // 1000ms
}
```

### Field-Specific Conflict Settings

```typescript
const fieldConfigs = {
  rating: { defaultStrategy: 'ask-user', autoResolve: false },
  tags: { defaultStrategy: 'merge', autoResolve: true },
  progress: { defaultStrategy: 'last-write-wins', autoResolve: true },
  highlights: { defaultStrategy: 'merge', autoResolve: true },
};
```

## Storage

### IndexedDB Stores

| Store | Purpose |
|-------|---------|
| `amnesia-sync-checkpoints` | Resume checkpoints |
| `amnesia-delta-state` | Entity hashes and timestamps |
| `amnesia-sync-metadata` | Last sync times, stats |

### File Storage

| Location | Content |
|----------|---------|
| `Florilegios/` | Book notes (markdown) |
| `Florilegios/covers/` | Cover images |
| `.obsidian/plugins/amnesia/data.json` | Plugin settings |

## Events

```typescript
interface SyncEngineEvents {
  'start': { session: SyncSession };
  'progress': SyncProgress;
  'change-detected': { change: SyncChange };
  'change-applied': { change: SyncChange };
  'conflict-detected': { conflict: SyncConflict };
  'conflict-resolved': { conflict: SyncConflict };
  'checkpoint': { checkpoint: SyncCheckpoint };
  'error': { error: SyncError };
  'complete': { session: SyncSession };
  'cancel': { sessionId: string };
  'pause': { sessionId: string };
  'resume': { sessionId: string };
}
```

## Performance Targets

| Metric | Target |
|--------|--------|
| 100 books full sync | < 10 seconds |
| 1000 books full sync | < 60 seconds |
| 5000 books full sync | < 3 minutes |
| Incremental (50 changes) | < 30 seconds |
| Memory usage | < 200MB peak |
| Resume success rate | > 95% |

## Error Handling

### Retry Strategy

- Automatic retry for transient failures
- Exponential backoff: 1s, 2s, 4s (default 3 retries)
- Skip after max retries, continue with next item

### Error Categories

| Type | Handling |
|------|----------|
| Network timeout | Retry with backoff |
| 404 Not Found | Skip item, log warning |
| 500 Server Error | Retry, then skip |
| Conflict | Queue for resolution |
| Validation Error | Skip, log error |

## Testing

See:
- `docs/testing/live-testing-guide.md` - Calibre integration tests
- `docs/testing/devtools-mcp-guide.md` - Using DevTools MCP
- `src/test/integration/` - Test implementations

## Future Enhancements

1. **Bidirectional Calibre sync** - Push changes back to Calibre
2. **Server-side up2k protocol** - Chunked uploads with deduplication
3. **Metadata schema mapping** - Custom field transformations
4. **Liquid templates** - Customizable book note generation
5. **Offline queue** - Queue changes when offline
