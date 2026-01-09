# Doc Doctor Integration Architecture

This document describes the architecture of the Amnesia-Doc Doctor integration, enabling bidirectional synchronization between reading highlights and knowledge management stubs.

## Overview

The integration connects Amnesia's highlight system with Doc Doctor's stub management through:
- **DocDoctorBridge**: Plugin-to-plugin communication layer
- **AnnotationSyncManager**: Bidirectional sync orchestration
- **ConflictResolver**: Handles concurrent modifications
- **SyncTelemetry**: Performance monitoring and metrics

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AMNESIA PLUGIN                              │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────────┐    ┌──────────────────┐    │
│  │  Highlight  │───▶│  Sync Manager   │───▶│  Doc Doctor      │    │
│  │  Service    │    │                 │    │  Bridge          │    │
│  └─────────────┘    ├─────────────────┤    └────────┬─────────┘    │
│         │           │ - Batch Sync    │             │              │
│         │           │ - Deduplication │             │              │
│         │           │ - Conflict Res. │             ▼              │
│         │           └─────────────────┘    ┌──────────────────┐    │
│         │                                  │  Sync Telemetry  │    │
│         ▼                                  └──────────────────┘    │
│  ┌─────────────┐                                    │              │
│  │  HUD        │◀───────────────────────────────────┘              │
│  │  Provider   │  (Health updates, metrics)                        │
│  └─────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼ (Obsidian Plugin API)
┌─────────────────────────────────────────────────────────────────────┐
│                       DOC DOCTOR PLUGIN                             │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────────┐    ┌──────────────────┐    │
│  │  Stub       │◀──▶│  Health         │◀──▶│  MCP Server      │    │
│  │  Manager    │    │  Calculator     │    │  (dd-mcp)        │    │
│  └─────────────┘    └─────────────────┘    └──────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. DocDoctorBridge (`doc-doctor-bridge.ts`)

The bridge provides a typed API for communicating with Doc Doctor:

```typescript
interface DocDoctorBridge {
  // Connection status
  isConnected(): boolean;
  getStatus(): BridgeStatus;

  // Stub CRUD operations
  createStub(data: CreateStubData): Promise<DocDoctorStub | null>;
  getStub(id: string): Promise<DocDoctorStub | null>;
  updateStub(id: string, data: Partial<DocDoctorStub>): Promise<DocDoctorStub | null>;
  resolveStub(id: string, resolution: string): Promise<DocDoctorStub | null>;
  deleteStub(id: string): Promise<void>;
  listStubs(filePath: string): Promise<DocDoctorStub[]>;

  // Health metrics
  getBookHealth(filePath: string): Promise<BookHealth | null>;

  // Events
  on(event: 'health-updated', handler: (data) => void): Disposable;
}
```

### 2. AnnotationSyncManager (`sync-manager.ts`)

Orchestrates bidirectional synchronization:

#### Amnesia → Doc Doctor
- Syncs highlight annotations as stubs
- Handles deduplication to prevent duplicate stubs
- Only syncs "knowledge gap" types (verify, expand, clarify, question)
- Skips "insight" types (important, citation) which stay in Amnesia

#### Doc Doctor → Amnesia
- Propagates stub resolutions back to highlights
- Updates highlight annotations with resolution text
- Adds "resolved" tag to completed items

### 3. Knowledge Gap Filter (`knowledge-gap-filter.ts`)

Critical filtering logic that distinguishes:

| Type | Category | Syncs to Doc Doctor? | Purpose |
|------|----------|---------------------|---------|
| verify | Knowledge Gap | Yes | Claims needing verification |
| expand | Knowledge Gap | Yes | Topics to explore further |
| clarify | Knowledge Gap | Yes | Confusing passages |
| question | Knowledge Gap | Yes | Questions to answer |
| important | Insight | No | Key insights captured |
| citation | Insight | No | Citation references |

### 4. ConflictResolver (`conflict-resolver.ts`)

Handles concurrent modifications with configurable strategies:

- **newest-wins**: Most recent modification wins
- **amnesia-wins**: Amnesia's version always takes precedence
- **doc-doctor-wins**: Doc Doctor's version always wins

### 5. SyncTelemetry (`sync-telemetry.ts`)

Performance monitoring service:

```typescript
interface TelemetrySnapshot {
  totalAttempts: number;
  successCount: number;
  failureCount: number;
  conflictCount: number;
  successRate: number;      // 0-1
  avgLatencyMs: number;
  p95LatencyMs: number;
  peakQueueDepth: number;
}
```

## Data Flow

### Creating a Knowledge Gap Highlight

```
1. User selects text in reader
2. User clicks "Needs Verification" (or other gap type)
3. HighlightPopup dispatches:
   - 'highlight' event (creates highlight in Amnesia)
   - 'createKnowledgeGap' event (triggers sync)
4. ServerReaderContainer.handleCreateKnowledgeGap():
   - Gets book note path
   - Calls bridge.createStub()
5. Doc Doctor creates stub in book note
6. Highlight updated with docDoctorStubId
```

### Resolving a Stub

```
1. User resolves stub in Doc Doctor
2. Doc Doctor emits 'stub-resolved' event
3. Bridge.on('stub-resolved') triggers
4. SyncManager.syncStubResolution():
   - Finds linked highlight
   - Checks for conflicts
   - Updates highlight annotation with resolution
   - Adds 'resolved' tag
5. HUD updates with new health metrics
```

## HUD Integration

The HUD (Heads-Up Display) shows Doc Doctor health metrics:

```typescript
// AmnesiaHUDProvider listens for health updates
bridge.on('health-updated', (data) => {
  if (context.notePath === data.filePath) {
    this.currentBookHealth = data.health;
    this.notifySubscribers();
  }
});

// BookHealthBadge displays the health score
// - Green: > 70% (good coverage)
// - Yellow: 40-70% (moderate gaps)
// - Red: < 40% (many unresolved gaps)
```

## Testing

### E2E Tests (`__tests__/e2e/doc-doctor-integration.test.ts`)

- Full sync workflow (highlight → stub → resolution → highlight)
- Bulk sync 100+ highlights
- Conflict resolution strategies
- Offline queue and recovery
- State preservation across reload

### Performance Benchmarks (`__tests__/performance/sync-benchmarks.test.ts`)

| Metric | Target |
|--------|--------|
| Single sync latency | < 100ms |
| Batch 100 highlights | < 5s |
| HUD render | < 16ms (60fps) |
| Memory increase | < 50MB per 1000 ops |

### MCP Test Harness (`__tests__/mcp/integration-scenarios.ts`)

Run via Obsidian DevTools MCP:

```javascript
// Access test harness
window.amnesiaTests.runScenario('highlight-to-stub');
window.amnesiaTests.runAll();
window.amnesiaTests.getSummary();
```

## Configuration

Settings in `AmnesiaSettings.docDoctorSync`:

```typescript
interface DocDoctorSyncSettings {
  enabled: boolean;
  autoSync: boolean;
  conflictStrategy: 'newest-wins' | 'amnesia-wins' | 'doc-doctor-wins';
  syncIntervalMs: number;
  maxBatchSize: number;
}
```

## Error Handling

The integration handles common failure modes:

1. **Doc Doctor not installed**: Bridge returns `null`, operations skip
2. **API version mismatch**: Capability detection, graceful degradation
3. **Network/storage errors**: Queued for retry, telemetry recorded
4. **Conflicts**: Resolved per strategy, logged for debugging

## Future Considerations

- **Batch API**: Doc Doctor bulk operations for better throughput
- **Webhook Events**: Real-time sync instead of polling
- **Offline Queue**: Persistent queue for offline operation
- **Cross-vault**: Sync across multiple Obsidian vaults
