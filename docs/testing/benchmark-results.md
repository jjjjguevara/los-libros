# Amnesia Sync Performance Benchmarks

> Last updated: 2026-01-03
> Test Environment: macOS Darwin 25.3.0, Node.js v20.19.0

## Summary

| Metric | Value | Notes |
|--------|-------|-------|
| Total Tests | 182 | 1 skipped (HTML sanitization TODO) |
| Test Suites | 9 | All passing |
| Library Size | 2,433 books | User's Calibre library |
| Unicode Support | 408 books | With non-ASCII characters |

---

## Calibre Library Sync Benchmarks

### Full Library Scan

Test against a real Calibre Content Server with 2,433 books.

| Run | Duration | Throughput | Memory Delta |
|-----|----------|------------|--------------|
| 1 | 4,374ms | 556 books/s | +3.10 MB |
| 2 | 6,846ms | 355 books/s | +5.08 MB |
| 3 | 3,901ms | 624 books/s | +5.17 MB |
| **Average** | **5,040ms** | **512 books/s** | **+4.45 MB** |

**Performance Notes:**
- Throughput varies based on network conditions and server load
- Memory usage stays under 6MB for full library scan
- Peak observed: 2,106 books/s (warmed cache)

### Parallel Operations

| Metric | Value |
|--------|-------|
| Parallel fetch (5 books) | 6-34ms |
| Average per book | 1.2-6.8ms |
| Concurrency benefit | ~5x faster than sequential |

---

## Conflict Resolution Benchmarks

Performance of the `ConflictResolutionManager` for detecting and resolving sync conflicts.

### Conflict Detection

| Items | Duration | Throughput |
|-------|----------|------------|
| 10 | <1ms | ~132,000 items/s |
| 100 | 3ms | ~33,500 items/s |
| 1,000 | 18ms | ~57,000 items/s |

### Auto-Resolution

| Items | Duration | Throughput |
|-------|----------|------------|
| 10 | <1ms | ~91,000 items/s |
| 100 | 1ms | ~70,000 items/s |
| 1,000 | 48ms | ~20,700 items/s |

**Key Findings:**
- Conflict detection scales well (sub-linear with O(n) complexity)
- Auto-resolution throughput decreases at scale due to merge logic
- Both operations complete in under 50ms for 1,000 items

---

## Upload Benchmarks

Mock upload endpoint tests for chunked file upload protocol (up2k-style).

### Test Configuration

| Parameter | Value |
|-----------|-------|
| Latency Range | 5-20ms simulated |
| Retry Attempts | 3 per chunk |
| Chunk Sizes | 256KB, 1MB, 4MB |
| File Sizes | 1MB, 10MB, 50MB |

### Results

| Test | Status | Notes |
|------|--------|-------|
| 1MB upload (256KB chunks) | Pass | 4 chunks |
| 10MB upload (1MB chunks) | Pass | 10 chunks |
| Retry handling | Pass | Recovers from injected failures |
| Parallel uploads (3x) | Pass | Aggregate throughput maintained |
| Deduplication | Pass | Instant for duplicate files |

---

## Data Integrity Metrics

### Metadata Coverage

| Field | Books with Data | Coverage |
|-------|-----------------|----------|
| Title | 2,433 | 100% |
| Authors | 2,433 | 100% |
| Rating | 43 | 1.8% |
| Series | 66 | 2.7% |
| Tags | 470 | 19.3% |
| Unicode titles | 408 | 16.8% |

### Incremental Sync

| Metric | Value |
|--------|-------|
| Change detection | 1 book in last week |
| Unchanged books | 2,432 |
| Incremental ratio | 0.04% |

---

## Test Categories

### Unit Tests (Fast)

| Category | Tests | Time |
|----------|-------|------|
| Liquid Templates | 7 | <10ms |
| Schema Mapping | 5 | <10ms |
| Metadata Validation | 35 | <50ms |
| Conflict Resolution | 8 | <10ms |

### Integration Tests (Require Calibre Server)

| Category | Tests | Time |
|----------|-------|------|
| Calibre Connection | 3 | ~100ms |
| Full Sync | 4 | ~3-5s |
| Incremental Sync | 3 | ~500ms |
| Data Integrity | 5 | ~2s |
| Performance | 3 | ~5s |
| Error Handling | 4 | ~100ms |

### E2E Tests (File System + Calibre)

| Category | Tests | Time |
|----------|-------|------|
| Rating Sync | 3 | <100ms |
| Tags Sync | 3 | <100ms |
| Custom Columns | 4 | <100ms |
| Schema Remapping | 3 | <100ms |
| Conflict Resolution | 3 | <100ms |
| Full Workflow | 2 | <100ms |

---

## Running Benchmarks

### Prerequisites

```bash
# Start Calibre Content Server
/Applications/calibre.app/Contents/MacOS/calibre-server \
  --port 8080 \
  --enable-local-write \
  ~/path/to/library
```

### Run All Tests

```bash
CALIBRE_SERVER_URL=http://localhost:8080 pnpm test
```

### Run Specific Benchmarks

```bash
# Calibre live tests
CALIBRE_SERVER_URL=http://localhost:8080 pnpm test -- --run src/test/integration/calibre-live.test.ts

# E2E sync tests
CALIBRE_SERVER_URL=http://localhost:8080 pnpm test -- --run src/test/integration/calibre-bidirectional-e2e.test.ts

# Upload benchmarks
pnpm test -- --run src/test/benchmarks/upload-benchmark.test.ts

# Conflict resolution benchmarks
pnpm test -- --run src/test/integration/e2e-sync.test.ts
```

---

## Performance Targets

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Full sync (2000+ books) | <10s | 3-7s | Pass |
| Throughput | >100 books/s | 350-2100 books/s | Pass |
| Memory growth | <50MB | <6MB | Pass |
| Conflict resolution (1000) | <100ms | 48ms | Pass |
| Parallel fetch speedup | 3x | 5x | Pass |

---

## Known Limitations

1. **Network variability**: Throughput varies significantly with network conditions
2. **Server warmup**: First run may be slower due to Calibre caching
3. **Large libraries**: Memory usage may increase for 10,000+ books (not tested)
4. **HTML sanitization**: Not yet implemented (1 skipped test)

---

## Version History

| Date | Changes |
|------|---------|
| 2026-01-03 | Initial benchmark documentation |
| 2026-01-03 | Added E2E bidirectional sync tests |
| 2026-01-03 | Fixed upload retry handling |
