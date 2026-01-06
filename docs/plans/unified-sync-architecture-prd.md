# Amnesia Unified Sync Architecture PRD

**Version:** 1.0.0
**Date:** 2026-01-02
**Status:** Approved

---

## Executive Summary

Unify three separate sync systems (Calibre, Amnesia Server, Chunked Uploader) into a cohesive, high-performance architecture with:
- **Server-side up2k protocol** implementation
- **Incremental/delta sync** (only sync changes)
- **Parallel processing** (configurable concurrency)
- **Cross-session resume** (persist to IndexedDB)
- **Calibre-style conflict resolution modal**
- **Comprehensive test harness** with mock server and live Calibre tests

---

## Current State Analysis

### Three Sync Systems (Unconnected)

| System | Location | Current State |
|--------|----------|---------------|
| **Calibre Integration** | `/apps/amnesia/src/calibre/` | Full sync only, sequential, 8 min for 5000 books |
| **Amnesia Server** | `/apps/amnesia/src/server/` | Basic REST, no batching, no resume |
| **Chunked Uploader** | `/apps/amnesia/src/upload/` | Client complete, **server NOT implemented** |
| **Offline Manager** | `/apps/amnesia/src/offline/` | Scaffolding only, unused |

### Performance Bottlenecks

| Issue | Impact | Root Cause |
|-------|--------|------------|
| Sequential processing | 8 min for 5000 books | No parallelization |
| No incremental sync | Always processes entire library | No change detection |
| No resume on crash | Restart from 0% | No checkpointing |
| Server up2k missing | Sophisticated client unused | Endpoints not implemented |
| Memory inefficient | 300MB+ for large libraries | Loads all books into RAM |

---

## Requirements

### Core Features

1. **Server-side up2k protocol** - Rust/Axum endpoints:
   - `POST /api/v1/upload/handshake` - Deduplication check
   - `POST /api/v1/upload/{sessionId}/chunks/{index}` - Chunk upload
   - `POST /api/v1/upload/{sessionId}/finalize` - Reassemble file
   - `DELETE /api/v1/upload/{sessionId}` - Cancel upload

2. **Incremental/Delta Sync**:
   - Track `last_modified` timestamps
   - SHA-256 content hashing for change detection
   - Manifest diffing for efficient comparison
   - Skip unchanged items

3. **Parallel Processing**:
   - Configurable concurrency (default: 5)
   - Parallel cover downloads
   - Batched note generation
   - Rate limiting to prevent server overload

4. **Cross-Session Resume**:
   - Checkpoint to IndexedDB every 100 items
   - Auto-resume notification on plugin load
   - Session state persistence

### UI Features

5. **Sync Mode Selection Modal**:
   - "Catch-Up Sync" (incremental, recommended)
   - "Full Re-Sync" (rebuild entire library)
   - "Custom Sync" (select adapters)

6. **Conflict Resolution Modal** (Calibre-style):
   - Side-by-side comparison (local vs server)
   - Batch resolution for similar conflicts
   - Strategies: Keep Local, Keep Server, Merge, Defer
   - Field-specific defaults (rating: ask, tags: merge, etc.)

### Testing Infrastructure

7. **Mock Server Harness**:
   - In-memory mock for all server endpoints
   - Configurable latency/failure injection
   - Request/response recording for debugging

8. **Obsidian DevTools MCP Integration**:
   - Live sync state inspection
   - Progress monitoring via console
   - Screenshot capture for visual regression

9. **Benchmark Utilities**:
   - Performance metrics collection
   - Automated benchmarks (100, 1000, 5000 books)
   - Memory usage tracking

10. **Live Calibre Server Tests**:
    - Integration tests against real Calibre library
    - End-to-end sync verification
    - Data integrity checks

---

## Metadata Sync Architecture

### Overview

A dedicated **MetadataSyncService** handles all book metadata synchronization with:
- Schema-based field mapping (Calibre <-> Obsidian <-> Server)
- Liquid templates support for custom rendering
- Per-field conflict resolution
- Sanity checks and validation
- Full data recovery on book re-addition

### Metadata Categories

| Category | Fields | Sync Direction | Conflict Strategy |
|----------|--------|----------------|-------------------|
| **Identity** | uuid, calibreId, title, author | Calibre -> Obsidian | Calibre wins |
| **Progress** | currentCfi, progress%, lastReadAt | Bidirectional | Last-write-wins |
| **Highlights** | cfiRange, color, note, createdAt | Bidirectional | Merge (union) |
| **Notes** | bookNotes, chapterNotes | Bidirectional | Merge with timestamp |
| **User Metadata** | rating, status, tags, bookshelves | Bidirectional | Configurable |
| **Calibre Custom** | customColumns, identifiers | Calibre -> Obsidian | Calibre wins |

### MetadataSyncService

**Location:** `/apps/amnesia/src/sync/metadata/`

```typescript
interface MetadataSyncService {
  // Core sync operations
  syncBookMetadata(bookId: string): Promise<MetadataSyncResult>;
  syncAllMetadata(options: SyncOptions): Promise<BatchSyncResult>;

  // Conflict resolution
  detectConflicts(bookId: string): Promise<MetadataConflict[]>;
  resolveConflict(conflict: MetadataConflict, strategy: ResolutionStrategy): Promise<void>;

  // Data recovery (for book re-addition)
  getStoredMetadata(bookId: string): Promise<StoredMetadata | null>;
  restoreMetadata(bookId: string, metadata: StoredMetadata): Promise<void>;

  // Schema management
  getFieldMapping(): FieldMapping;
  updateFieldMapping(mapping: FieldMapping): void;
  validateMetadata(metadata: BookMetadata): ValidationResult;
}
```

### Schema-Based Field Mapping

```typescript
interface FieldMapping {
  // Calibre -> Obsidian mappings
  calibreToObsidian: {
    'rating': 'frontmatter.rating',          // Direct map
    'tags': 'frontmatter.bookshelves',       // Rename
    'custom:#read_date': 'frontmatter.completedAt',  // Custom column
    'identifiers.isbn': 'frontmatter.isbn',  // Nested field
  };

  // Obsidian -> Calibre mappings (reverse)
  obsidianToCalibre: {
    'frontmatter.rating': 'rating',
    'frontmatter.bookshelves': 'tags',
    'frontmatter.completedAt': 'custom:#read_date',
  };

  // Fields that sync to Amnesia Server
  serverFields: ['progress', 'highlights', 'notes', 'lastReadAt'];

  // Field-specific sync settings
  fieldSettings: {
    'rating': {
      direction: 'bidirectional',
      conflictStrategy: 'ask-user',
      validator: (v) => v >= 0 && v <= 5,
    },
    'tags': {
      direction: 'bidirectional',
      conflictStrategy: 'merge-union',
      transformer: (v) => v.map(t => t.toLowerCase()),
    },
    'progress': {
      direction: 'bidirectional',
      conflictStrategy: 'last-write-wins',
      validator: (v) => v >= 0 && v <= 100,
    },
  };
}
```

### Liquid Templates Integration

Support custom rendering of metadata in book notes:

```typescript
interface LiquidTemplateService {
  // Template registration
  registerTemplate(name: string, template: string): void;
  getTemplate(name: string): string | null;

  // Rendering
  renderBookNote(book: BookMetadata, template?: string): string;
  renderField(field: string, value: unknown, template?: string): string;

  // Schema access for templates
  getAvailableFields(): FieldDefinition[];
  getFieldType(field: string): 'string' | 'number' | 'array' | 'date' | 'object';
}

// Example template usage
const template = `
---
title: {{ book.title }}
author: {{ book.authors | join: ", " }}
rating: {{ book.rating | times: 2 }}/10
{% if book.series %}
series: "[[Series/{{ book.series.name }}|{{ book.series.name }}]]"
seriesIndex: {{ book.series.index }}
{% endif %}
bookshelves:
{% for tag in book.tags %}
  - "[[Estanterias/{{ tag }}|{{ tag }}]]"
{% endfor %}
progress: {{ book.progress | default: 0 }}%
lastRead: {{ book.lastReadAt | date: "%Y-%m-%d" }}
---

# {{ book.title }}

{% if book.highlights.size > 0 %}
## Highlights

{% for h in book.highlights %}
> {{ h.text }}
> -- *{{ h.note }}* ({{ h.createdAt | date: "%b %d" }})

{% endfor %}
{% endif %}
`;
```

### Data Recovery System

When a book is removed and re-added, all metadata should be preserved:

```typescript
interface MetadataRecoveryService {
  // Storage (IndexedDB)
  storeMetadata(bookId: string, metadata: FullMetadata): Promise<void>;
  retrieveMetadata(bookId: string): Promise<FullMetadata | null>;

  // Recovery workflow
  onBookRemoved(bookId: string): Promise<void>;  // Archive metadata
  onBookAdded(bookId: string): Promise<RecoveryResult>;  // Restore metadata

  // Merge strategies
  mergeWithExisting(stored: FullMetadata, current: FullMetadata): FullMetadata;
}

interface FullMetadata {
  // Core identity
  bookId: string;
  calibreId: number;
  title: string;

  // Reading state
  progress: number;
  currentCfi: string;
  lastReadAt: Date;

  // Annotations
  highlights: Highlight[];
  notes: Note[];
  bookmarks: Bookmark[];

  // User metadata
  rating: number;
  status: ReadingStatus;
  tags: string[];

  // Timestamps for conflict resolution
  timestamps: {
    progress: Date;
    highlights: Date;
    notes: Date;
    rating: Date;
    tags: Date;
  };
}
```

### Sanity Checks & Validation

```typescript
interface MetadataValidator {
  // Field-level validation
  validateField(field: string, value: unknown): ValidationResult;

  // Cross-field validation
  validateConsistency(metadata: BookMetadata): ConsistencyResult;

  // Sanity checks
  checkProgressConsistency(progress: number, cfi: string): boolean;
  checkHighlightRanges(highlights: Highlight[]): boolean;
  checkTimestampOrder(timestamps: Record<string, Date>): boolean;

  // Auto-fix options
  autoFixIssues(metadata: BookMetadata, issues: ValidationIssue[]): BookMetadata;
}

// Validation rules
const VALIDATION_RULES = {
  progress: {
    type: 'number',
    min: 0,
    max: 100,
    required: false,
    default: 0,
  },
  rating: {
    type: 'number',
    min: 0,
    max: 5,
    required: false,
    default: null,
  },
  currentCfi: {
    type: 'string',
    pattern: /^epubcfi\(.+\)$/,
    required: false,
  },
  highlights: {
    type: 'array',
    itemValidator: (h) => h.cfiRange && h.text,
    maxItems: 10000,
  },
};
```

### Calibre-Obsidian Bidirectional Sync

Dedicated service for Calibre <-> Obsidian field synchronization:

```typescript
interface CalibreBidirectionalSyncService {
  // Configuration
  readonly schemaMapping: CalibreSchemaMapping;

  // Sync operations
  syncToObsidian(calibreId: number): Promise<SyncResult>;
  syncToCalibre(bookId: string): Promise<SyncResult>;
  fullBidirectionalSync(): Promise<BatchSyncResult>;

  // Change detection
  detectCalibreChanges(since: Date): Promise<CalibreChange[]>;
  detectObsidianChanges(since: Date): Promise<ObsidianChange[]>;

  // Conflict handling
  compareVersions(calibre: CalibreBook, obsidian: BookNote): Comparison;
  resolveConflicts(conflicts: FieldConflict[]): Promise<void>;
}

interface CalibreSchemaMapping {
  // Standard Calibre fields
  standardFields: {
    title: { obsidianPath: 'frontmatter.title', direction: 'calibre-wins' },
    authors: { obsidianPath: 'frontmatter.author', transformer: 'wikilink' },
    rating: { obsidianPath: 'frontmatter.rating', direction: 'bidirectional' },
    tags: { obsidianPath: 'frontmatter.bookshelves', direction: 'bidirectional' },
    series: { obsidianPath: 'frontmatter.series', transformer: 'wikilink' },
    publisher: { obsidianPath: 'frontmatter.publisher', direction: 'calibre-wins' },
    pubdate: { obsidianPath: 'frontmatter.publishedDate', direction: 'calibre-wins' },
    comments: { obsidianPath: 'body.description', direction: 'calibre-wins' },
  };

  // Custom columns (user-configurable)
  customColumns: {
    '#read_date': { obsidianPath: 'frontmatter.completedAt', type: 'date' },
    '#read_count': { obsidianPath: 'frontmatter.timesRead', type: 'number' },
    '#my_notes': { obsidianPath: 'body.calibreNotes', type: 'text' },
  };

  // Obsidian-only fields (not in Calibre)
  obsidianOnlyFields: ['progress', 'currentCfi', 'highlights', 'notes'];

  // Transformers for complex mappings
  transformers: {
    wikilink: (value, meta) => `[[${meta.folder}/${value}|${value}]]`,
    date: (value) => new Date(value).toISOString().split('T')[0],
    rating: (value, direction) => direction === 'toCalibre' ? value * 2 : value / 2,
  };
}
```

### Files to Create (Metadata System)

- `/apps/amnesia/src/sync/metadata/metadata-sync-service.ts` (~400 lines)
- `/apps/amnesia/src/sync/metadata/field-mapping.ts` (~200 lines)
- `/apps/amnesia/src/sync/metadata/metadata-validator.ts` (~250 lines)
- `/apps/amnesia/src/sync/metadata/recovery-service.ts` (~200 lines)
- `/apps/amnesia/src/sync/metadata/calibre-bidirectional.ts` (~350 lines)
- `/apps/amnesia/src/sync/metadata/liquid-template-service.ts` (~300 lines)
- `/apps/amnesia/src/sync/metadata/types.ts` (~150 lines)

---

## Architecture Overview

```
+---------------------------------------------------------------------+
|                      UnifiedSyncEngine                              |
|         (Orchestrates all sync, manages state, events)              |
+------------+--------------------------------------------------------+
             |
             +-> SyncAdapter Interface
             |   +-> CalibreSyncAdapter (wraps CalibreService)
             |   +-> ServerSyncAdapter (wraps AmnesiaClient)
             |   +-> FileSyncAdapter (wraps ChunkedUploader)
             |
             +-> DeltaTracker (change detection, hashing)
             +-> ConflictResolutionManager (auto + manual)
             +-> ParallelExecutor (worker pool, rate limiting)
             +-> CheckpointManager (IndexedDB persistence)
             +-> TestHarness (mocks, fixtures, benchmarks)
```

---

## Data Flows

### Incremental Sync Flow

```
User clicks "Catch-Up Sync"
    |
Load lastSync timestamp from settings
    |
For each adapter:
    +-> detectChanges(lastSync)
    |   +-> Calibre: SELECT * FROM books WHERE last_modified > ?
    |   +-> Server: GET /api/v1/sync/changes?since={timestamp}
    |   +-> Files: Compare SHA-256 hashes in manifest
    |
ParallelExecutor.process(changes)
    +-> Process N items concurrently (N = 5 default)
    +-> Checkpoint every 100 items to IndexedDB
    +-> Emit progress events
    |
ConflictResolutionManager.detectConflicts()
    +-> Auto-resolve (last-write-wins, prefer-local, etc.)
    +-> Queue manual conflicts for modal
    |
Show ConflictModal if any remain
    |
Complete: Update lastSync, clear checkpoints
```

### File Upload with Deduplication

```
User uploads EPUB
    |
ChunkedUploader.upload(file)
    +-> Phase 1: Split into 2MB chunks
    +-> Phase 2: SHA-256 hash each chunk + composite file hash
    +-> Phase 3: Handshake with server
    |   +-> Response: { isDuplicate, neededChunks, existingChunks }
    +-> Phase 4: Upload only neededChunks (3 parallel)
    +-> Phase 5: Finalize (server reassembles)
    |
If isDuplicate: Return existing book ID (instant!)
```

---

## Server Endpoints (Rust/Axum)

### Chunked Upload Protocol

```rust
// POST /api/v1/upload/handshake
Request: { fileName, fileSize, fileHash, chunkHashes[], mimeType }
Response: { sessionId, isDuplicate, existingBookId?, neededChunks[], existingChunks[] }

// POST /api/v1/upload/{sessionId}/chunks/{index}
Request: Binary chunk data
Headers: X-Chunk-Hash
Response: 200 OK | 409 Conflict (hash mismatch)

// POST /api/v1/upload/{sessionId}/finalize
Response: { bookId, title, size }

// DELETE /api/v1/upload/{sessionId}
Response: 204 No Content
```

### Incremental Sync Protocol

```rust
// GET /api/v1/sync/changes?since={timestamp}&types=book,progress,highlights
Response: { changes: [{ id, type, operation, timestamp, hash, data }], serverTime }

// POST /api/v1/sync/push
Request: { lastKnownVersion, changes[] }
Response: { applied[], conflicts[], newVersion }

// POST /api/v1/books/batch
Request: { operations: [{ op, id, data? }] }
Response: { results: [{ id, success, data?, error? }] }
```

---

## Testing Infrastructure

### 1. Mock Server Harness

**Location:** `/apps/amnesia/src/test/harness/`

```typescript
// MockServerHarness - Simulates all server endpoints
class MockServerHarness implements UploadEndpoint, SyncEndpoint {
  // Configuration
  setLatency(min: number, max: number): void;
  setFailureRate(rate: number): void;  // 0-1
  setChunkFailures(indices: number[]): void;  // Fail specific chunks

  // State inspection
  getRecordedRequests(): Request[];
  getUploadedChunks(sessionId: string): ChunkInfo[];
  getStoredBooks(): Book[];

  // Fixtures
  loadFixture(name: 'empty' | 'small-library' | 'large-library'): void;
  seedBooks(count: number): Book[];
  createConflicts(scenarios: ConflictScenario[]): void;
}
```

**Files to Create:**
- `/apps/amnesia/src/test/harness/mock-server-harness.ts` (~400 lines)
- `/apps/amnesia/src/test/harness/mock-upload-endpoint.ts` (~200 lines)
- `/apps/amnesia/src/test/harness/mock-sync-endpoint.ts` (~200 lines)
- `/apps/amnesia/src/test/harness/mock-metadata-store.ts` (~200 lines)
- `/apps/amnesia/src/test/harness/request-recorder.ts` (~100 lines)

### 2. Fixtures

**Location:** `/apps/amnesia/src/test/fixtures/`

```typescript
// Library fixtures for testing
const FIXTURES = {
  'empty-library': { books: [], authors: [], series: [] },
  'small-library': { books: 10, withCovers: true, withProgress: true },
  'medium-library': { books: 100, withConflicts: 5 },
  'large-library': { books: 1000, withConflicts: 20 },
  'stress-test': { books: 5000, withConflicts: 100 },
};

// Conflict scenarios
const CONFLICT_SCENARIOS = [
  { field: 'rating', localValue: 5, serverValue: 4, serverNewer: true },
  { field: 'tags', localValue: ['fiction'], serverValue: ['fiction', 'classic'] },
  { field: 'progress', localValue: 50, serverValue: 75 },
];
```

**Files to Create:**
- `/apps/amnesia/src/test/fixtures/library-fixtures.ts` (~200 lines)
- `/apps/amnesia/src/test/fixtures/conflict-fixtures.ts` (~100 lines)
- `/apps/amnesia/src/test/fixtures/book-factory.ts` (~150 lines)
- `/apps/amnesia/src/test/fixtures/index.ts` (~50 lines)

### 3. Obsidian DevTools MCP Integration

**Usage Pattern:**

```javascript
// Connect to Obsidian
mcp__obsidian-devtools__obsidian_connect()

// Inspect sync state
(function() {
  const plugin = app.plugins.plugins['amnesia'];
  const syncEngine = plugin.syncEngine;

  return {
    status: syncEngine.status,
    progress: syncEngine.progress,
    pendingQueue: syncEngine.pendingQueue.length,
    conflicts: syncEngine.conflicts.length,
    checkpoints: syncEngine.checkpoints.length,
  };
})();

// Monitor progress in real-time
(function() {
  const plugin = app.plugins.plugins['amnesia'];
  plugin.syncEngine.on('progress', (p) => console.log(p));
  return 'Monitoring started';
})();

// Trigger sync and capture screenshot
mcp__obsidian-devtools__obsidian_eval({ code: `
  app.plugins.plugins['amnesia'].commands.executeCommand('sync-library');
` });
// Wait for progress modal
await new Promise(r => setTimeout(r, 2000));
mcp__obsidian-devtools__obsidian_capture_screenshot({ format: 'png' });

// Check console for errors
mcp__obsidian-devtools__obsidian_get_console_logs({ level: 'error', limit: 50 });
```

**Files to Create:**
- `/apps/amnesia/src/test/mcp/devtools-helpers.ts` (~150 lines)
- `/apps/amnesia/src/test/mcp/sync-inspector.ts` (~100 lines)
- `/docs/testing/devtools-mcp-guide.md` (~300 lines)

### 4. Benchmark Utilities

**Location:** `/apps/amnesia/src/test/benchmarks/`

```typescript
interface BenchmarkResult {
  name: string;
  iterations: number;
  metrics: {
    totalTime: number;      // ms
    avgTime: number;        // ms per item
    throughput: number;     // items/sec
    peakMemory: number;     // MB
    networkBytes: number;   // Total transferred
  };
}

class SyncBenchmark {
  // Benchmark configurations
  async runFullSync(bookCount: number): Promise<BenchmarkResult>;
  async runIncrementalSync(changeCount: number): Promise<BenchmarkResult>;
  async runCoverDownload(count: number, concurrency: number): Promise<BenchmarkResult>;
  async runChunkedUpload(fileSizeMB: number): Promise<BenchmarkResult>;

  // Comparison
  compareResults(baseline: BenchmarkResult, current: BenchmarkResult): Comparison;

  // Reporting
  generateReport(results: BenchmarkResult[]): string;  // Markdown table
}
```

**Benchmark Targets:**

| Scenario | Target | Baseline |
|----------|--------|----------|
| Full sync 100 books | <10s | ~60s |
| Full sync 1000 books | <60s | ~5min |
| Full sync 5000 books | <3min | ~8min |
| Incremental sync 50 items | <30s | N/A |
| Cover download 100 (5 parallel) | <30s | ~5min |
| 50MB EPUB upload | <60s | N/A |

**Files to Create:**
- `/apps/amnesia/src/test/benchmarks/sync-benchmark.ts` (~300 lines)
- `/apps/amnesia/src/test/benchmarks/upload-benchmark.ts` (~200 lines)
- `/apps/amnesia/src/test/benchmarks/memory-tracker.ts` (~100 lines)
- `/apps/amnesia/src/test/benchmarks/report-generator.ts` (~150 lines)

### 5. Metadata Sync Tests

**Location:** `/apps/amnesia/src/test/metadata/`

Critical test scenarios for the metadata system:

```typescript
describe('Metadata Sync Tests', () => {

  describe('Book Removal and Re-addition', () => {
    it('should preserve all metadata when book is removed and re-added', async () => {
      // Setup: Create book with full metadata
      const bookId = 'test-book-123';
      await createBookWithMetadata(bookId, {
        progress: 75,
        currentCfi: 'epubcfi(/6/4!/4/2/1:0)',
        highlights: [
          { cfiRange: 'epubcfi(...)', text: 'Important quote', color: 'yellow', note: 'Review later' },
          { cfiRange: 'epubcfi(...)', text: 'Key concept', color: 'green' },
        ],
        notes: [
          { chapter: 'Chapter 1', content: 'This chapter introduces...' },
        ],
        rating: 5,
        status: 'reading',
        tags: ['fiction', 'favorite'],
        lastReadAt: new Date(),
      });

      // Act: Remove book from vault
      await vault.delete(getBookNotePath(bookId));

      // Verify: Metadata is archived
      const archived = await metadataRecovery.retrieveMetadata(bookId);
      expect(archived).not.toBeNull();
      expect(archived.highlights).toHaveLength(2);
      expect(archived.progress).toBe(75);

      // Act: Re-add book (e.g., via sync or manual import)
      await syncEngine.syncBook(bookId);

      // Verify: All metadata restored seamlessly
      const restoredNote = await readBookNote(bookId);
      expect(restoredNote.frontmatter.progress).toBe(75);
      expect(restoredNote.frontmatter.rating).toBe(5);
      expect(restoredNote.highlights).toHaveLength(2);
      expect(restoredNote.highlights[0].text).toBe('Important quote');
    });

    it('should handle partial metadata on re-addition', async () => {
      // Scenario: Book removed, user manually adds it back without frontmatter
      await metadataRecovery.onBookRemoved(bookId);

      // User manually creates minimal book note
      await vault.create(getBookNotePath(bookId), '# Book Title\n\nManual content');

      // Sync should detect and offer to restore
      const recovery = await metadataRecovery.onBookAdded(bookId);
      expect(recovery.hasStoredMetadata).toBe(true);
      expect(recovery.conflicts).toHaveLength(0); // No conflicts, just restore
    });

    it('should handle conflicts between stored and new metadata', async () => {
      // Scenario: Book removed, re-added from Calibre with different rating
      await metadataRecovery.onBookRemoved(bookId);

      // Re-sync from Calibre with different rating
      await calibreClient.updateRating(calibreId, 3); // Was 5
      await syncEngine.syncBook(bookId);

      const conflicts = await metadataRecovery.detectConflicts(bookId);
      expect(conflicts).toContainEqual(expect.objectContaining({
        field: 'rating',
        storedValue: 5,
        newValue: 3,
      }));
    });
  });

  describe('Calibre-Obsidian Bidirectional Sync', () => {
    it('should sync rating changes from Obsidian to Calibre', async () => {
      // Modify rating in Obsidian
      await updateBookNote(bookId, { rating: 4 });

      // Run bidirectional sync
      await calibreBidirectional.syncToCalibre(bookId);

      // Verify Calibre updated
      const calibreBook = await calibreClient.getBook(calibreId);
      expect(calibreBook.rating).toBe(4);  // Calibre uses 0-10, so 4*2=8 internally
    });

    it('should sync tag changes from Calibre to Obsidian', async () => {
      // Add tag in Calibre
      await calibreClient.addTag(calibreId, 'new-tag');

      // Run bidirectional sync
      await calibreBidirectional.syncToObsidian(calibreId);

      // Verify Obsidian updated
      const note = await readBookNote(bookId);
      expect(note.frontmatter.bookshelves).toContain('new-tag');
    });

    it('should resolve conflicts using configured strategy', async () => {
      // Create conflict: modify rating on both sides
      await updateBookNote(bookId, { rating: 5 });
      await calibreClient.updateRating(calibreId, 3);

      // Sync with 'last-write-wins' strategy
      const result = await calibreBidirectional.fullBidirectionalSync({
        conflictStrategy: 'last-write-wins',
      });

      expect(result.conflicts.resolved).toBe(1);
      // Verify winner based on timestamp
    });

    it('should apply Liquid template transformations', async () => {
      const book = await calibreClient.getBook(calibreId);

      const rendered = await liquidTemplates.renderBookNote(book, customTemplate);

      // Verify wikilinks generated correctly
      expect(rendered).toContain(`[[Autores/${book.authors[0].name}|${book.authors[0].name}]]`);
      expect(rendered).toContain(`[[Series/${book.series.name}|${book.series.name}]]`);
    });

    it('should sync custom columns correctly', async () => {
      // Set custom column in Calibre
      await calibreClient.setCustomColumn(calibreId, '#read_date', '2026-01-01');

      // Sync to Obsidian
      await calibreBidirectional.syncToObsidian(calibreId);

      // Verify mapped to correct frontmatter field
      const note = await readBookNote(bookId);
      expect(note.frontmatter.completedAt).toBe('2026-01-01');
    });

    it('should handle schema remapping correctly', async () => {
      // Test all field mappings
      const mappings = calibreBidirectional.schemaMapping;

      for (const [calibreField, config] of Object.entries(mappings.standardFields)) {
        const calibreValue = await calibreClient.getField(calibreId, calibreField);
        await calibreBidirectional.syncToObsidian(calibreId);
        const obsidianValue = await getFieldValue(bookId, config.obsidianPath);

        // Apply transformer if exists
        const expected = config.transformer
          ? mappings.transformers[config.transformer](calibreValue, {})
          : calibreValue;

        expect(obsidianValue).toEqual(expected);
      }
    });
  });

  describe('Validation and Sanity Checks', () => {
    it('should reject invalid progress values', async () => {
      const result = await metadataValidator.validateField('progress', 150);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('max');
    });

    it('should reject invalid CFI format', async () => {
      const result = await metadataValidator.validateField('currentCfi', 'invalid-cfi');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('pattern');
    });

    it('should detect inconsistent progress and CFI', async () => {
      // Progress 100% but CFI points to middle of book
      const result = await metadataValidator.checkProgressConsistency(100, 'epubcfi(/6/4!/4/2)');
      expect(result).toBe(false);
    });

    it('should auto-fix common issues', async () => {
      const metadata = {
        progress: 105,  // Invalid: > 100
        rating: -1,     // Invalid: < 0
        highlights: [{ text: 'Valid' }, { text: '' }],  // One invalid
      };

      const fixed = await metadataValidator.autoFixIssues(metadata, [
        { field: 'progress', issue: 'out-of-range' },
        { field: 'rating', issue: 'out-of-range' },
        { field: 'highlights[1]', issue: 'empty-text' },
      ]);

      expect(fixed.progress).toBe(100);  // Clamped
      expect(fixed.rating).toBeNull();   // Reset to null
      expect(fixed.highlights).toHaveLength(1);  // Removed invalid
    });
  });

  describe('Data Integrity', () => {
    it('should preserve highlight positions after EPUB update', async () => {
      // Scenario: EPUB re-synced with updated content
      const originalHighlights = await getHighlights(bookId);

      // Re-sync book (new EPUB version)
      await syncEngine.syncBook(bookId, { force: true });

      // Highlights should still exist and be valid
      const newHighlights = await getHighlights(bookId);
      expect(newHighlights.length).toBe(originalHighlights.length);

      // CFI ranges should still resolve (or be marked as orphaned)
      for (const h of newHighlights) {
        const resolved = await reader.resolveCfi(h.cfiRange);
        expect(resolved.valid || resolved.orphaned).toBe(true);
      }
    });

    it('should merge highlights correctly on sync conflict', async () => {
      // Local has highlight A, server has highlight B
      const localHighlights = [{ id: 'a', text: 'Local highlight' }];
      const serverHighlights = [{ id: 'b', text: 'Server highlight' }];

      const merged = await metadataSync.mergeHighlights(localHighlights, serverHighlights);

      expect(merged).toHaveLength(2);  // Union, not overwrite
      expect(merged.map(h => h.id)).toContain('a');
      expect(merged.map(h => h.id)).toContain('b');
    });
  });
});
```

**Files to Create:**
- `/apps/amnesia/src/test/metadata/book-removal.test.ts` (~300 lines)
- `/apps/amnesia/src/test/metadata/calibre-bidirectional.test.ts` (~400 lines)
- `/apps/amnesia/src/test/metadata/validation.test.ts` (~200 lines)
- `/apps/amnesia/src/test/metadata/data-integrity.test.ts` (~250 lines)
- `/apps/amnesia/src/test/metadata/fixtures/metadata-fixtures.ts` (~150 lines)

---

### 6. Live Calibre Server Tests

**Strategy:** Dual testing approach
- **Test Subset Library** - For CI/automated tests (controlled data, fast)
- **Full Library** - For manual validation (real-world data, comprehensive)

**Location:** `/apps/amnesia/src/test/integration/`

#### Test Subset Library Setup

```bash
# Create a dedicated test library with controlled data
calibredb --with-library=/path/to/test-library add ./fixtures/books/*.epub
calibredb --with-library=/path/to/test-library set_metadata 1 --field rating:5
calibredb --with-library=/path/to/test-library set_metadata 2 --field tags:"fiction,classic"
```

**Test Library Contents:**
- 50 books (varied sizes: 1MB to 50MB)
- 10 authors (including Unicode names)
- 5 series (with varying book counts)
- Pre-configured conflicts (rating, tags, progress)
- Known edge cases (missing covers, empty metadata)

#### Full Library Validation

For manual validation against your real library:
1. Connect to Calibre Content Server (localhost:8080)
2. Run benchmark suite with full library
3. Verify data integrity after sync
4. Test conflict resolution with real books

**Files to Create:**
- `/apps/amnesia/src/test/integration/calibre-live.test.ts` (~500 lines)
- `/apps/amnesia/src/test/integration/server-live.test.ts` (~300 lines)
- `/apps/amnesia/src/test/integration/e2e-sync.test.ts` (~400 lines)
- `/apps/amnesia/src/test/integration/setup.ts` (~100 lines)

### 7. Test Commands

Add Obsidian commands for manual testing:

```typescript
// Commands for testing (development only)
this.addCommand({
  id: 'run-sync-benchmark',
  name: 'DEV: Run sync benchmark',
  callback: async () => {
    const benchmark = new SyncBenchmark(this.syncEngine);
    const results = await benchmark.runAllScenarios();
    new BenchmarkResultsModal(this.app, results).open();
  },
});

this.addCommand({
  id: 'inspect-sync-state',
  name: 'DEV: Inspect sync state',
  callback: () => {
    console.log('Sync Engine State:', {
      status: this.syncEngine.status,
      progress: this.syncEngine.progress,
      pendingQueue: this.syncEngine.pendingQueue,
      conflicts: this.syncEngine.conflicts,
      checkpoints: Array.from(this.syncEngine.checkpoints.keys()),
    });
  },
});

this.addCommand({
  id: 'simulate-crash-resume',
  name: 'DEV: Simulate crash and resume',
  callback: async () => {
    // Start sync
    this.syncEngine.fullSync().catch(() => {});

    // Wait for 50% progress
    await new Promise(r => {
      this.syncEngine.on('progress', (p) => {
        if (p.percentage >= 50) r(null);
      });
    });

    // Force crash (clear session without cleanup)
    this.syncEngine.forceAbort();

    // Resume
    const resumed = await this.syncEngine.resumeIfIncomplete();
    console.log('Resume result:', resumed);
  },
});
```

---

## Implementation Milestones

### Milestone 1: Foundation + Test Harness
**Goal:** Core architecture with testing infrastructure (test-first approach)
**Deliverable:** Unified engine wrapping existing systems, mock server, fixtures

**Files to Create:**
- `/apps/amnesia/src/sync/unified-sync-engine.ts` (~300 lines)
- `/apps/amnesia/src/sync/sync-adapter.ts` (~150 lines)
- `/apps/amnesia/src/sync/adapters/calibre-adapter.ts` (~200 lines)
- `/apps/amnesia/src/sync/adapters/server-adapter.ts` (~200 lines)
- `/apps/amnesia/src/sync/adapters/file-adapter.ts` (~200 lines)
- `/apps/amnesia/src/sync/checkpoint-manager.ts` (~250 lines)
- `/apps/amnesia/src/test/harness/mock-server-harness.ts` (~400 lines)
- `/apps/amnesia/src/test/harness/mock-upload-endpoint.ts` (~200 lines)
- `/apps/amnesia/src/test/fixtures/library-fixtures.ts` (~200 lines)
- `/apps/amnesia/src/test/fixtures/book-factory.ts` (~150 lines)
- `/apps/amnesia/src/test/benchmarks/sync-benchmark.ts` (~300 lines)
- `/apps/amnesia/src/test/mcp/devtools-helpers.ts` (~150 lines)

**Files to Modify:**
- `/apps/amnesia/src/main.ts` - Initialize UnifiedSyncEngine
- `/apps/amnesia/src/settings/settings.ts` - Add sync config

**Done When:**
- [ ] Existing sync flows work through adapters (no regression)
- [ ] Mock server passes all endpoint tests
- [ ] Benchmark baseline captured for comparison
- [ ] DevTools MCP can inspect sync state

---

### Milestone 2: Incremental Sync + Parallel Processing
**Goal:** Delta sync and concurrent operations
**Deliverable:** Catch-up sync mode, 5x faster cover downloads

**Files to Create:**
- `/apps/amnesia/src/sync/delta-tracker.ts` (~300 lines)
- `/apps/amnesia/src/sync/manifest-differ.ts` (~200 lines)
- `/apps/amnesia/src/sync/storage/indexeddb-store.ts` (~300 lines)
- `/apps/amnesia/src/sync/parallel-executor.ts` (~400 lines)
- `/apps/amnesia/src/sync/rate-limiter.ts` (~150 lines)
- `/apps/amnesia-server/src/routes/sync_changes.rs` (~150 lines)
- `/apps/amnesia-server/src/routes/books_batch.rs` (~200 lines)

**Done When:**
- [ ] Incremental sync processes only changed items
- [ ] Benchmark shows <30s for 50-item incremental sync
- [ ] Cover downloads 5x faster (5 parallel)
- [ ] Rate limiting prevents server overload

---

### Milestone 3: Server-Side Up2k Protocol
**Goal:** Chunked upload with deduplication on Rust server
**Deliverable:** Reliable large file uploads, instant duplicate detection

**Files to Create:**
- `/apps/amnesia-server/src/upload/mod.rs` (~100 lines)
- `/apps/amnesia-server/src/upload/session.rs` (~300 lines)
- `/apps/amnesia-server/src/upload/chunk_store.rs` (~250 lines)
- `/apps/amnesia-server/src/upload/deduplication.rs` (~200 lines)
- `/apps/amnesia-server/src/routes/upload.rs` (~400 lines)

**Done When:**
- [ ] 100MB EPUB uploads reliably
- [ ] Duplicate files detected instantly (0 transfer)
- [ ] Interrupted uploads resume from last chunk
- [ ] Session cleanup removes abandoned uploads

---

### Milestone 4: Metadata Sync System
**Goal:** Sophisticated per-field metadata sync with schema remapping
**Deliverable:** Full metadata preservation, Liquid templates, bidirectional Calibre sync

**Files to Create:**
- `/apps/amnesia/src/sync/metadata/metadata-sync-service.ts` (~400 lines)
- `/apps/amnesia/src/sync/metadata/field-mapping.ts` (~200 lines)
- `/apps/amnesia/src/sync/metadata/metadata-validator.ts` (~250 lines)
- `/apps/amnesia/src/sync/metadata/recovery-service.ts` (~200 lines)
- `/apps/amnesia/src/sync/metadata/calibre-bidirectional.ts` (~350 lines)
- `/apps/amnesia/src/sync/metadata/liquid-template-service.ts` (~300 lines)
- `/apps/amnesia/src/sync/metadata/types.ts` (~150 lines)
- `/apps/amnesia/src/test/metadata/book-removal.test.ts` (~300 lines)
- `/apps/amnesia/src/test/metadata/calibre-bidirectional.test.ts` (~400 lines)
- `/apps/amnesia/src/test/metadata/validation.test.ts` (~200 lines)

**Done When:**
- [ ] Book removal and re-addition preserves all metadata (progress, highlights, notes, tags)
- [ ] Calibre <-> Obsidian bidirectional sync works for all mapped fields
- [ ] Custom column mapping configurable via schema
- [ ] Liquid templates render correctly with all field types
- [ ] Validation rejects invalid metadata with helpful errors
- [ ] All metadata tests pass

---

### Milestone 5: Conflict Resolution + Resume UI
**Goal:** User-friendly conflict handling and cross-session resume
**Deliverable:** Calibre-style modal, auto-resume notification

**Files to Create:**
- `/apps/amnesia/src/sync/conflict-resolution-manager.ts` (~350 lines)
- `/apps/amnesia/src/ui/modals/ConflictModal.svelte` (~400 lines)
- `/apps/amnesia/src/ui/modals/SyncModeModal.svelte` (~300 lines)
- `/apps/amnesia/src/ui/modals/SyncProgressModal.svelte` (~400 lines)
- `/apps/amnesia/src/ui/components/ResumeToast.svelte` (~150 lines)

**Done When:**
- [ ] Conflict modal shows side-by-side comparison
- [ ] Batch resolution applies to similar conflicts
- [ ] Auto-resume notification appears after crash
- [ ] Resume success rate >95%

---

### Milestone 6: Live Integration Tests + Polish
**Goal:** End-to-end validation with real Calibre library
**Deliverable:** CI-ready test suite, comprehensive documentation

**Files to Create:**
- `/apps/amnesia/src/test/integration/calibre-live.test.ts` (~500 lines)
- `/apps/amnesia/src/test/integration/e2e-sync.test.ts` (~400 lines)
- `/apps/amnesia/src/test/fixtures/calibre-test-library/` (test subset)
- `/docs/architecture/unified-sync.md` (~2000 lines)
- `/docs/testing/live-testing-guide.md` (~500 lines)
- `/docs/testing/devtools-mcp-guide.md` (~300 lines)

**Done When:**
- [ ] CI runs tests against test subset library
- [ ] Manual validation passes against full library
- [ ] 5000-book sync completes in <3 minutes
- [ ] Documentation complete and reviewed

---

## Performance Targets

| Metric | Current | Target | Improvement |
|--------|---------|--------|-------------|
| 5000-book full sync | 8 min | <3 min | **2.7x faster** |
| Incremental sync (50 changes) | N/A | <30 sec | **New feature** |
| Cover download (500 items) | 10 min | <2 min | **5x faster** |
| 100MB EPUB upload | Fails | <2 min | **Reliable** |
| Resume after crash | No | Yes | **New feature** |
| Memory usage | 300MB | <200MB | **33% reduction** |

---

## File Summary

### New Files (~70 total)

| Category | Files | Lines | Description |
|----------|-------|-------|-------------|
| Core Engine | 14 | ~3,200 | Sync orchestration, adapters |
| **Metadata System** | 7 | ~1,850 | Field mapping, validation, recovery, Liquid |
| Storage | 3 | ~700 | IndexedDB, checkpoints |
| Conflict Resolution | 4 | ~900 | Auto/manual/batch resolvers |
| UI Components | 6 | ~2,050 | Modals, progress, toasts |
| Server (Rust) | 8 | ~1,650 | Up2k protocol, batch API |
| **Test Harness** | 9 | ~1,800 | Mocks, fixtures, metadata store |
| **Metadata Tests** | 5 | ~1,300 | Book removal, bidirectional, validation |
| **Benchmarks** | 4 | ~750 | Performance testing |
| **Live Tests** | 4 | ~1,300 | Calibre integration tests |
| **MCP Helpers** | 3 | ~550 | DevTools integration |
| Documentation | 5 | ~4,100 | Architecture, guides |
| **TOTAL** | **~70** | **~20,150** | Complete implementation |

---

## Best Practices Applied

Based on industry research:

1. **Delta Sync**: Use SHA-256 content hashing + timestamps for change detection
2. **Conflict Resolution**: CRDT-inspired merge strategies with user override
3. **Chunked Upload**: 2MB chunks, 3 concurrent, SHA-256 integrity
4. **Resume**: IndexedDB checkpointing every 100 items
5. **Testing**: Mock harness + live integration tests + benchmarks

---

## Success Criteria

### Quantitative
- Full sync 5000 books: <3 minutes
- Incremental sync 50 changes: <30 seconds
- Memory usage: <200MB peak
- Test coverage: >80%
- Resume success rate: >95%

### Qualitative
- Conflict modal is "easy to understand"
- Resume feature "saved me time"
- Zero data loss incidents

---

## Next Steps

1. Begin implementation with Milestone 1: Foundation + Test Harness
2. Set up test environment with Calibre Content Server
3. Create project tracking issues for each milestone

---

*Document prepared by Claude Code*
*For: Amnesia Plugin Development*
*Date: 2026-01-02*
