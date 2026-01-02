# Los Libros: File System Architecture UI Integration

## Status: Pending Implementation

This document outlines the work needed to fully integrate the file system architecture modules into the Los Libros Obsidian plugin frontend UI.

**Related Implementation:** The backend services are complete (see commit `feat: implement 5-phase file system architecture`).

---

## Executive Summary

The file system architecture provides 5 phases of infrastructure:
1. Security Hardening (content sanitization, CSP, resource policies)
2. Asset Extraction (images, media, covers, OCR, vault export)
3. Tiered Caching (LRU, IndexedDB, monitoring)
4. Offline Support (network monitor, download manager, sync)
5. Enhanced File Serving (chunked uploads, OPDS, deduplication)

This document identifies all UI work needed to expose these features to users.

---

## 1. Settings Integration

### 1.1 New Settings Required

Add to `src/settings/settings.ts`:

```typescript
interface LibrosSettings {
  // ... existing settings ...

  // Cache Configuration
  cache: {
    l1MaxSizeBytes: number;      // Default: 52428800 (50MB)
    l1MaxEntries: number;        // Default: 500
    l2Enabled: boolean;          // Default: true
    l2MaxSizeBytes: number;      // Default: 524288000 (500MB)
    l2MaxEntries: number;        // Default: 5000
    promoteOnAccess: boolean;    // Default: true
    writeThrough: boolean;       // Default: true
    defaultTTL: number;          // Default: 0 (no expiration)
  };

  // Offline Mode
  offline: {
    enabled: boolean;            // Default: false
    autoDownloadBookmarks: boolean;
    downloadOnWifi: boolean;     // Default: true
    concurrentDownloads: number; // Default: 3
    retryCount: number;          // Default: 3
    quotaWarningThreshold: number; // Default: 0.9
  };

  // Network Monitoring
  network: {
    enabled: boolean;            // Default: true
    checkInterval: number;       // Default: 30000
    checkTimeout: number;        // Default: 5000
    failureThreshold: number;    // Default: 3
  };

  // Deduplication
  deduplication: {
    enabled: boolean;            // Default: false
    algorithm: 'SHA-256' | 'SHA-384' | 'SHA-512';
    minSize: number;             // Default: 1024
  };

  // OPDS Feeds
  opdsFeeds: {
    customFeeds: Array<{
      id: string;
      name: string;
      url: string;
      enabled: boolean;
      requiresAuth: boolean;
      username?: string;
      password?: string;
    }>;
    cacheFeeds: boolean;         // Default: true
    cacheDuration: number;       // Default: 3600000
  };

  // Asset Extraction
  assets: {
    generateThumbnails: boolean; // Default: true
    thumbnailMaxSize: number;    // Default: 200
    exportFolder: string;        // Default: 'Assets/Books'
  };
}
```

### 1.2 Settings Tab UI Additions

**File to modify:** `src/settings/settings-tab.ts`

Add new sections:
- [ ] **Cache Settings** - After line 322 (existing cache section)
  - L2 cache toggle
  - Size sliders (L1, L2)
  - View cache stats button
  - Clear cache button

- [ ] **Offline Mode Settings** - New section
  - Enable offline mode toggle
  - Auto-download bookmarks toggle
  - Concurrent downloads slider
  - View offline books button

- [ ] **Network Settings** - New section
  - Enable network monitoring toggle
  - Check interval input
  - Timeout input

- [ ] **Deduplication Settings** - New section (advanced)
  - Enable dedup toggle
  - Algorithm dropdown
  - Min size input
  - View stats button

- [ ] **OPDS Feeds** - New section
  - Custom feeds list
  - Add/edit/remove feed forms
  - Test connection button
  - Auth fields (username/password)

- [ ] **Asset Settings** - New section
  - Thumbnail generation toggle
  - Export folder picker
  - Max thumbnail size

---

## 2. Commands to Add

### 2.1 Offline Management Commands

**File to modify:** `src/main.ts`

| Command ID | Name | Description | Context |
|------------|------|-------------|---------|
| `download-book-offline` | Download Book for Offline Reading | Downloads current book | Reader view active |
| `view-offline-books` | View Offline Books | Opens offline library view | Always |
| `remove-offline-book` | Remove Book from Offline Storage | Removes current book from offline | Book is offline |
| `toggle-offline-mode` | Toggle Offline Mode | Force offline/online mode | Always |

### 2.2 Cache Management Commands

| Command ID | Name | Description | Context |
|------------|------|-------------|---------|
| `clear-cache` | Clear Cache | Clears all cached data | Always |
| `view-cache-stats` | View Cache Statistics | Shows cache stats modal | Always |
| `clear-book-cache` | Clear Current Book Cache | Clears cache for current book | Reader view active |

### 2.3 OPDS Commands

| Command ID | Name | Description | Context |
|------------|------|-------------|---------|
| `add-opds-feed` | Add OPDS Feed | Shows add feed modal | Always |
| `browse-custom-opds` | Browse Custom OPDS Feeds | Opens custom feed browser | Always |
| `search-opds` | Search OPDS Catalogs | Global OPDS search | Always |

### 2.4 Asset Commands

| Command ID | Name | Description | Context |
|------------|------|-------------|---------|
| `extract-book-images` | Extract All Images from Book | Extracts all images | Reader view active |
| `export-book-assets` | Export Book Assets to Vault | Exports assets to vault folder | Reader view active |
| `view-book-assets` | View Book Assets | Opens asset gallery | Reader view active |

### 2.5 Deduplication Commands

| Command ID | Name | Description | Context |
|------------|------|-------------|---------|
| `view-dedup-stats` | View Deduplication Statistics | Shows dedup stats modal | Dedup enabled |
| `cleanup-dedup` | Cleanup Deduplication Storage | Removes orphaned entries | Dedup enabled |

---

## 3. New Svelte Components

### 3.1 Status Indicators

| Component | Location | Purpose |
|-----------|----------|---------|
| `OfflineIndicator.svelte` | `src/components/` | Status bar network/offline indicator |
| `StorageQuotaIndicator.svelte` | `src/components/` | Storage usage indicator |

### 3.2 Offline Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `DownloadProgressPanel.svelte` | `src/offline/components/` | Download progress modal |
| `OfflineBooksView.svelte` | `src/offline/components/` | List of offline books |

### 3.3 Cache Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `CacheStatsView.svelte` | `src/cache/components/` | Cache statistics display |

### 3.4 OPDS Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `OPDSFeedManager.svelte` | `src/opds/components/` | Manage custom OPDS feeds |
| `OPDSSearchModal.svelte` | `src/opds/components/` | Global OPDS search |

### 3.5 Asset Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `AssetGallery.svelte` | `src/assets/components/` | Grid/list asset gallery |
| `AssetsTab.svelte` | `src/assets/components/` | Sidebar assets tab |

---

## 4. View Modifications

### 4.1 Sidebar Modifications

**File:** `src/sidebar/components/Sidebar.svelte`

- [ ] Add "Assets" tab to tab bar
- [ ] Import and render AssetsTab component
- [ ] Pass asset extractor and vault exporter props

### 4.2 Reader View Modifications

**File:** `src/reader/reader-view.ts`

- [ ] Integrate TieredCache for resource loading
- [ ] Check offline status on book load
- [ ] Add download-for-offline context menu option

### 4.3 Settings Panel Modifications

**File:** `src/reader/components/SettingsPanel.svelte`

- [ ] Add "Cache" section with quick stats
- [ ] Add "Offline" section with download button
- [ ] Show offline status badge

### 4.4 Image Lightbox Enhancement

**File:** `src/reader/components/ImageLightbox.svelte`

- [ ] Add "Export to Vault" button
- [ ] Add "Copy to Clipboard" button
- [ ] Show image metadata
- [ ] Add OCR button (if enabled)

### 4.5 Status Bar Updates

**File:** `src/main.ts` (updateStatusBar method)

- [ ] Add network status icon (wifi/wifi-off)
- [ ] Add active downloads counter
- [ ] Add offline mode indicator

### 4.6 Library View Modifications

**File:** `src/library/components/BookCard.svelte`

- [ ] Add offline badge/icon to book cards
- [ ] Add "Download" context menu option

---

## 5. New Item Views

### 5.1 Offline Books View

**File to create:** `src/offline/offline-books-view.ts`

ItemView showing:
- List of downloaded books
- Download status per book
- Storage usage per book
- Actions: open, remove, re-download

### 5.2 Cache Stats View

**File to create:** `src/cache/cache-stats-view.ts`

ItemView showing:
- L1/L2 cache sizes
- Hit/miss ratios
- Entry counts
- Clear buttons

---

## 6. Service Integration in main.ts

### 6.1 New Properties

```typescript
class LosLibrosPlugin extends Plugin {
  // ... existing properties ...

  // Add these:
  tieredCache: TieredCache;
  offlineManager: OfflineManager;
  networkMonitor: NetworkMonitor;
  dedupManager: DeduplicationManager;
  assetExtractor: AssetExtractor;
  opdsFeedClient: OPDSFeedClient;
}
```

### 6.2 Initialization Order

In `onload()`, after existing service init:

1. NetworkMonitor (first, others depend on network status)
2. TieredCache (needs network monitor for remote provider)
3. OfflineManager (needs tiered cache)
4. DeduplicationManager (optional, if enabled)
5. AssetExtractor (needs cache)
6. OPDSFeedClient

### 6.3 Event Listeners

Subscribe to:
- `networkMonitor.on('online')` - Show notice
- `networkMonitor.on('offline')` - Show notice, switch mode
- `offlineManager.on('progress')` - Update status bar
- `offlineManager.on('complete')` - Show notice
- `offlineManager.on('error')` - Show error notice

### 6.4 Cleanup in onunload()

- `networkMonitor.stop()`
- `tieredCache.close()`
- `assetExtractor.destroy()`

---

## 7. Storage Adapters Needed

### 7.1 IndexedDB Dedup Storage

**File to create:** `src/dedup/indexed-db-dedup-storage.ts`

Implement `DedupStorage` interface using IndexedDB for persistence.

---

## 8. Implementation Priority

### Phase A: Foundation (Priority: High)

1. [ ] Update settings.ts with new interfaces
2. [ ] Initialize services in main.ts
3. [ ] Add OfflineIndicator to status bar
4. [ ] Basic cache commands (clear, view stats)

### Phase B: Offline Support (Priority: High)

1. [ ] Add offline management commands
2. [ ] Create DownloadProgressPanel
3. [ ] Create OfflineBooksView
4. [ ] Integrate with reader view

### Phase C: Cache UI (Priority: Medium)

1. [ ] Create CacheStatsView
2. [ ] Add cache settings section
3. [ ] Add cache stats modal

### Phase D: Asset Management (Priority: Medium)

1. [ ] Create AssetGallery component
2. [ ] Add Assets tab to sidebar
3. [ ] Enhance ImageLightbox
4. [ ] Add asset export commands

### Phase E: OPDS Enhancement (Priority: Low)

1. [ ] Create OPDSFeedManager
2. [ ] Add custom feed settings
3. [ ] Add OPDS search modal

### Phase F: Advanced Features (Priority: Low)

1. [ ] Deduplication UI
2. [ ] Storage quota indicators
3. [ ] Analytics/monitoring views

---

## 9. Testing Requirements

### 9.1 Offline Scenarios

- [ ] Download book for offline
- [ ] Read book while offline
- [ ] Remove offline book
- [ ] Re-download failed book
- [ ] Handle storage quota exceeded

### 9.2 Cache Scenarios

- [ ] Verify L1 → L2 promotion
- [ ] Test cache eviction
- [ ] Clear cache operations
- [ ] Cache stats accuracy

### 9.3 Asset Scenarios

- [ ] Extract images from various EPUBs
- [ ] Export to vault
- [ ] Thumbnail generation
- [ ] Large image handling

### 9.4 OPDS Scenarios

- [ ] Add custom feed
- [ ] Browse feed
- [ ] Search feed
- [ ] Handle auth feeds

---

## 10. Estimated Effort

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Foundation | 2-3 days | None |
| Offline Support | 3-4 days | Foundation |
| Cache UI | 2 days | Foundation |
| Asset Management | 3-4 days | Foundation |
| OPDS Enhancement | 2-3 days | Foundation |
| Advanced Features | 2-3 days | All above |

**Total Estimated: 14-19 days**

---

## 11. Open Questions

1. **Quota Management**: How should we handle storage quota limits on mobile/web?
2. **Sync Conflicts**: UI for conflict resolution when offline edits conflict?
3. **OCR Integration**: Which OCR provider(s) to support initially?
4. **Feed Discovery**: Should we add OPDS catalog discovery/search?
5. **Analytics**: Do we need a dashboard for cache/dedup statistics?

---

## Appendix: File Locations Summary

### Files to Create

```
src/
├── assets/components/
│   ├── AssetGallery.svelte
│   └── AssetsTab.svelte
├── cache/components/
│   └── CacheStatsView.svelte
├── cache/
│   └── cache-stats-view.ts
├── components/
│   ├── OfflineIndicator.svelte
│   └── StorageQuotaIndicator.svelte
├── dedup/
│   └── indexed-db-dedup-storage.ts
├── offline/components/
│   ├── DownloadProgressPanel.svelte
│   └── OfflineBooksView.svelte
├── offline/
│   └── offline-books-view.ts
└── opds/components/
    ├── OPDSFeedManager.svelte
    └── OPDSSearchModal.svelte
```

### Files to Modify

```
src/
├── main.ts
├── settings/
│   ├── settings.ts
│   └── settings-tab.ts
├── reader/
│   ├── reader-view.ts
│   └── components/
│       ├── SettingsPanel.svelte
│       └── ImageLightbox.svelte
├── sidebar/components/
│   └── Sidebar.svelte
├── library/components/
│   └── BookCard.svelte
└── opds/
    └── opds-view.ts
```
