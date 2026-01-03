# File System Architecture Specification

## Los Libros - File Management and Asset Extraction Infrastructure

**Version:** 1.0
**Date:** 2026-01-01
**Status:** Design Specification

---

## Table of Contents

1. [Overview](#1-overview)
2. [Goals and Requirements](#2-goals-and-requirements)
3. [Architecture Design](#3-architecture-design)
4. [API Interfaces](#4-api-interfaces)
5. [Security Layer](#5-security-layer)
6. [Performance Benchmarks](#6-performance-benchmarks)
7. [Data Flow Diagrams](#7-data-flow-diagrams)
8. [Edge Cases and Error Handling](#8-edge-cases-and-error-handling)
9. [Configuration Options](#9-configuration-options)
10. [Implementation Phases](#10-implementation-phases)
11. [Testing Strategy](#11-testing-strategy)

---

## 1. Overview

### 1.1 Purpose

This specification defines the file management and asset extraction infrastructure for Los Libros, an Obsidian plugin for EPUB/PDF reading. The system provides:

- **Unified file access** across hybrid server/WASM providers
- **3-tier caching** (Memory → IndexedDB → Server/WASM)
- **Asset extraction** for images, fonts, media, and stylesheets
- **Security layer** for XSS prevention and path validation
- **OPDS catalog support** for remote libraries
- **OCR integration interface** for scanned documents
- **Vault export** to extract assets as Obsidian files

### 1.2 Design Principles

1. **Hybrid-First**: Works offline (WASM), benefits from server when available
2. **Security-First**: All content sanitized, paths validated, CSP enforced
3. **Performance-First**: Aggressive caching, lazy loading, streaming where possible
4. **Type-Safe**: Comprehensive TypeScript interfaces with runtime validation
5. **Extensible**: Plugin architecture for OCR providers, export formats, etc.

### 1.3 Existing Patterns

The system builds upon proven patterns in the Los Libros codebase:

**From `hybrid-provider.ts`:**
- Server/WASM fallback with provider mode ('server' | 'wasm' | 'auto')
- Book-to-provider mapping: `Map<string, 'server' | 'wasm'>`
- Dynamic provider selection based on availability

**From `api-client.ts`:**
- Chapter cache: `Map<string, ChapterContent>`
- Request deduplication: `Map<string, Promise<ChapterContent>>`
- Cache key pattern: `${bookId}:${href}`
- Preloading support for adjacent chapters

**From `wasm-provider.ts`:**
- Blob URL management with cleanup
- Resource URL caching: `Map<string, string>`
- MIME type detection from file extensions

**From Rust `epub/mod.rs`:**
- ZIP-based EPUB parsing
- In-memory resource storage: `HashMap<String, Vec<u8>>`
- Path resolution with OPF directory handling

---

## 2. Goals and Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Read EPUB files from server or WASM | Critical |
| FR-2 | Extract images, CSS, fonts, audio, video from EPUBs | Critical |
| FR-3 | 3-tier caching: Memory → IndexedDB → Source | Critical |
| FR-4 | Sanitize all HTML/CSS content for XSS prevention | Critical |
| FR-5 | Validate all file paths to prevent directory traversal | Critical |
| FR-6 | Stream large files (>10MB) without blocking | High |
| FR-7 | Generate OPDS catalogs from local/server libraries | High |
| FR-8 | OCR integration for scanned PDFs/images | Medium |
| FR-9 | Export assets to Obsidian vault files | Medium |
| FR-10 | Support encrypted EPUBs (DRM-free encryption) | Low |

### 2.2 Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Small EPUB load time (<10MB) | <500ms |
| NFR-2 | Large EPUB load time (>100MB) | <10s |
| NFR-3 | Asset extraction for 50-image EPUB | <2s |
| NFR-4 | Memory overhead for cached book | <50MB |
| NFR-5 | IndexedDB cache hit rate | >80% |
| NFR-6 | Concurrent book limit (memory) | 3 books |
| NFR-7 | XSS sanitization overhead | <100ms per chapter |

### 2.3 EPUB 3 Support Matrix

| Feature | Support Level | Notes |
|---------|---------------|-------|
| XHTML content | Full | Shadow DOM rendering |
| CSS stylesheets | Full | Scoped to shadow DOM |
| Images (JPEG, PNG, GIF, SVG, WebP) | Full | Blob URL conversion |
| Audio (MP3, M4A, OGG) | Full | Native HTML5 audio |
| Video (MP4, WebM) | Full | Native HTML5 video |
| Fonts (WOFF, WOFF2, TTF, OTF) | Full | CSS @font-face injection |
| JavaScript | Partial | Sandboxed execution only |
| MathML | Full | Native browser support |
| SVG | Full | Inline and external |
| Fixed layout | Partial | Basic support, no spreads |
| Scripted interactivity | Blocked | Security concern |

---

## 3. Architecture Design

### 3.1 Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Los Libros Plugin                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              FileManager (Main API)                        │  │
│  │  - loadBook()                                              │  │
│  │  - getChapter()                                            │  │
│  │  - getResource()                                           │  │
│  │  - extractAssets()                                         │  │
│  └───────────────┬───────────────────────────────────────────┘  │
│                  │                                               │
│  ┌───────────────┴───────────────────────────────────────────┐  │
│  │         VirtualFileSystem (3-Tier Cache)                   │  │
│  │                                                            │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐  │  │
│  │  │  L1: RAM   │→ │ L2: IndexDB│→ │  L3: Provider      │  │  │
│  │  │  (LRU Map) │  │ (IDB cache)│  │  (Server/WASM)     │  │  │
│  │  └────────────┘  └────────────┘  └────────────────────┘  │  │
│  └───────────────┬───────────────────────────────────────────┘  │
│                  │                                               │
│  ┌───────────────┴───────────────────────────────────────────┐  │
│  │           HybridProvider (Source Selection)                │  │
│  │                                                            │  │
│  │  ┌──────────────────┐       ┌──────────────────────────┐  │  │
│  │  │  ServerProvider  │       │     WasmProvider         │  │  │
│  │  │  (ApiClient)     │       │  (Rust WASM + bindings)  │  │  │
│  │  └──────────────────┘       └──────────────────────────┘  │  │
│  └───────────────┬───────────────────────────────────────────┘  │
│                  │                                               │
│  ┌───────────────┴───────────────────────────────────────────┐  │
│  │              SecurityValidator                             │  │
│  │  - sanitizeHtml()                                          │  │
│  │  - validatePath()                                          │  │
│  │  - enforceCSP()                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              AssetExtractor                                │  │
│  │  - extractImages()                                         │  │
│  │  - extractFonts()                                          │  │
│  │  - extractMedia()                                          │  │
│  │  - exportToVault()                                         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │         Optional: OPDSGenerator, OCRInterface              │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Design Decisions

#### Decision 1: 3-Tier Caching Architecture

**Rationale:**
- **L1 (RAM):** Instant access for current book, LRU eviction for memory control
- **L2 (IndexedDB):** Persistent cache survives page reloads, 50MB quota per book
- **L3 (Source):** Server (fast, always fresh) or WASM (offline, slower parse)

**Trade-offs:**
- **Complexity:** Higher (3 layers vs 1) but manageable with abstraction
- **Performance:** 10-100x faster cache hits vs source fetches
- **Storage:** ~150MB total (3 books × 50MB), acceptable for modern browsers

#### Decision 2: Blob URL Management

**Rationale:**
- Browser-native resource URLs work with `<img>`, `<audio>`, `<video>`, `@font-face`
- Automatic garbage collection when URLs revoked
- No base64 bloat in HTML (40% smaller than data URLs)

**Trade-offs:**
- **Lifecycle management:** Must track and revoke URLs on book unload
- **Memory:** Blob storage is separate from JS heap (better memory profile)

#### Decision 3: Hybrid Provider Pattern

**Rationale:**
- Server: Fast parsing, shared cache, always up-to-date
- WASM: Offline capability, privacy (local processing)
- Auto mode: Best of both worlds

**Trade-offs:**
- **Complexity:** Mode switching logic, provider state tracking
- **Reliability:** Graceful degradation when server unavailable

---

## 4. API Interfaces

### 4.1 FileManager (Main API)

```typescript
/**
 * FileManager - High-level API for file access and asset management
 */
export class FileManager {
  constructor(config: FileManagerConfig);

  /**
   * Load a book from bytes, URL, or book ID
   */
  async loadBook(
    source: ArrayBuffer | string,
    filename?: string
  ): Promise<ParsedBook>;

  /**
   * Get chapter content with optional preprocessing
   */
  async getChapter(
    bookId: string,
    href: string,
    options?: ChapterOptions
  ): Promise<ChapterContent>;

  /**
   * Get a resource (image, font, CSS, etc.)
   */
  async getResource<T extends ResourceFormat>(
    bookId: string,
    href: string,
    format: T
  ): Promise<ResourceOutput<T>>;

  /**
   * Extract all assets of a specific type
   */
  async extractAssets(
    bookId: string,
    type: AssetType,
    options?: ExtractionOptions
  ): Promise<ExtractedAsset[]>;

  /**
   * Get cover image for a book
   */
  async getCover(
    bookId: string,
    maxDimension?: number
  ): Promise<string>;

  /**
   * Preload resources for smoother navigation
   */
  async preloadResources(
    bookId: string,
    hrefs: string[]
  ): Promise<void>;

  /**
   * Clear cache for a book or all books
   */
  async clearCache(
    bookId?: string,
    level?: CacheLevel
  ): Promise<void>;

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats;

  /**
   * Unload a book and free resources
   */
  unloadBook(bookId: string): void;

  /**
   * Export book assets to Obsidian vault
   */
  async exportToVault(
    bookId: string,
    vaultPath: string,
    options?: VaultExportOptions
  ): Promise<VaultExportResult>;
}

export interface FileManagerConfig {
  providerMode: ProviderMode;
  serverUrl?: string;
  deviceId: string;
  wasmSource?: string | ArrayBuffer;
  cache: CacheConfig;
  security: SecurityConfig;
  extraction?: ExtractionDefaults;
}

export interface CacheConfig {
  memoryMB: number;
  indexedDBMB: number;
  evictionPolicy: 'lru' | 'lfu' | 'fifo';
  preloadAdjacent: boolean;
  preloadDistance: number;
}

export type AssetType = 'image' | 'font' | 'css' | 'audio' | 'video' | 'all';
export type ResourceFormat = 'blob' | 'url' | 'arraybuffer' | 'text';
export type CacheLevel = 'l1' | 'l2' | 'all';
```

### 4.2 VirtualFileSystem (3-Tier Cache)

```typescript
/**
 * VirtualFileSystem - 3-tier caching layer
 */
export class VirtualFileSystem {
  constructor(config: VFSConfig, provider: HybridProvider);

  async read(path: string, bypassCache?: boolean): Promise<Uint8Array>;
  async write(path: string, data: Uint8Array, metadata: FileMetadata): Promise<void>;
  async exists(path: string, level?: CacheLevel): Promise<boolean>;
  async list(pattern: string, level?: CacheLevel): Promise<string[]>;
  async delete(path: string, level?: CacheLevel): Promise<void>;
  async clear(bookId?: string, level?: CacheLevel): Promise<void>;
  async getMetadata(path: string): Promise<FileMetadata | null>;
  async readBatch(paths: string[]): Promise<Map<string, Uint8Array>>;
  async stream(path: string, chunkSize?: number): AsyncGenerator<Uint8Array>;
}

export interface VFSConfig {
  l1: L1CacheConfig;
  l2: L2CacheConfig;
  streamThresholdMB: number;
}

export interface L1CacheConfig {
  maxEntries: number;
  maxSizeMB: number;
  evictionPolicy: 'lru' | 'lfu';
  ttl: number;
}

export interface L2CacheConfig {
  dbName: string;
  storeName: string;
  maxSizeMB: number;
  compress: boolean;
}
```

### 4.3 AssetExtractor

```typescript
/**
 * AssetExtractor - Extract and export EPUB assets
 */
export class AssetExtractor {
  constructor(vfs: VirtualFileSystem);

  async extractByType(
    bookId: string,
    type: AssetType,
    filter?: (asset: AssetInfo) => boolean
  ): Promise<ExtractedAsset[]>;

  async extractFromChapters(
    bookId: string,
    hrefs: string[],
    types: AssetType[]
  ): Promise<ExtractedAsset[]>;

  async exportToVault(
    bookId: string,
    assets: ExtractedAsset[],
    vaultPath: string,
    options?: VaultExportOptions
  ): Promise<VaultExportResult>;

  async generateManifest(bookId: string): Promise<AssetManifest>;
  async extractCover(bookId: string, maxDimension?: number): Promise<ExtractedAsset | null>;

  async batchExport(
    bookId: string,
    types: AssetType[],
    vaultPath: string,
    onProgress?: (progress: ExportProgress) => void
  ): Promise<VaultExportResult>;
}

export interface ExtractedAsset {
  type: AssetType;
  href: string;
  mimeType: string;
  url: string;
  size: number;
  vaultPath?: string;
}

export interface VaultExportOptions {
  naming: 'original' | 'hash' | 'sequential';
  organize: boolean;
  subfolderPattern?: string;
  overwrite: boolean;
  createIndex: boolean;
  includeMetadata: boolean;
  resizeImages?: {
    maxWidth: number;
    maxHeight: number;
    quality: number;
  };
}

export interface VaultExportResult {
  exported: ExportedFile[];
  failed: FailedExport[];
  totalBytes: number;
  duration: number;
  indexPath?: string;
}
```

### 4.4 SecurityValidator

```typescript
/**
 * SecurityValidator - XSS prevention and path validation
 */
export class SecurityValidator {
  constructor(config: SecurityConfig);

  sanitizeHtml(html: string, options?: SanitizeOptions): string;
  sanitizeCss(css: string, options?: SanitizeOptions): string;
  validatePath(path: string, baseDir?: string): string;
  isSafeUrl(url: string, allowExternal?: boolean): boolean;
  generateCSP(options?: CSPOptions): string;
  validateMimeType(mimeType: string, allowedTypes?: string[]): boolean;
  scanForThreats(content: string | Uint8Array, type: 'html' | 'css' | 'js' | 'binary'): ThreatReport;
}

export interface SecurityConfig {
  sanitizeHtml: boolean;
  domPurifyConfig?: DOMPurifyConfig;
  sanitizeCss: boolean;
  allowedSchemes: string[];
  blockExternal: boolean;
  csp: CSPOptions;
  validatePaths: boolean;
}

export class SecurityError extends Error {
  constructor(
    message: string,
    public threatType: string,
    public details?: any
  ) {
    super(message);
    this.name = 'SecurityError';
  }
}
```

---

## 5. Security Layer

### 5.1 XSS Prevention Strategy

#### 5.1.1 HTML Sanitization Pipeline

```typescript
// DOMPurify configuration
const DOMPURIFY_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: [
    'p', 'span', 'div', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'strong', 'em', 'b', 'i', 'u', 's', 'mark', 'small',
    'sub', 'sup', 'code', 'pre', 'blockquote',
    'a', 'img', 'audio', 'video', 'source', 'track',
    'section', 'article', 'aside', 'nav', 'header', 'footer',
    'figure', 'figcaption', 'svg', 'math', 'mrow', 'mi', 'mo', 'mn',
  ],

  ALLOWED_ATTR: [
    'class', 'id', 'title', 'lang', 'dir',
    'href', 'target', 'src', 'alt', 'width', 'height',
    'controls', 'autoplay', 'loop', 'muted',
    'colspan', 'rowspan', 'style',
    'viewBox', 'xmlns', 'fill', 'stroke',
  ],

  ALLOWED_URI_REGEXP: /^(?:blob:|data:)/i,
  KEEP_CONTENT: true,
  RETURN_DOM: false,
};
```

#### 5.1.2 Path Validation

```typescript
function validatePath(path: string, baseDir: string = ''): string {
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\//, '');

  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw new SecurityError('Absolute paths not allowed', 'path-traversal', { path });
  }

  if (normalized.includes('../') || normalized.includes('..\\')) {
    throw new SecurityError('Parent directory traversal not allowed', 'path-traversal', { path });
  }

  if (normalized.includes('\0')) {
    throw new SecurityError('Null bytes in path', 'path-traversal', { path });
  }

  return normalized;
}
```

#### 5.1.3 Content Security Policy

```typescript
const CSP_HEADER = {
  'default-src': ["'self'", 'blob:'],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'", 'blob:'],
  'img-src': ["'self'", 'blob:', 'data:'],
  'font-src': ["'self'", 'blob:', 'data:'],
  'media-src': ["'self'", 'blob:'],
  'frame-src': ["'none'"],
  'connect-src': ["'self'"],
  'form-action': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
};
```

### 5.2 Security Testing Requirements

| Test ID | Test Case | Expected Result |
|---------|-----------|-----------------|
| SEC-001 | HTML with `<script>` tag | Tag removed |
| SEC-002 | HTML with `onclick` attribute | Attribute removed |
| SEC-003 | HTML with `javascript:` URL | URL blocked |
| SEC-004 | CSS with `@import` | Import removed |
| SEC-005 | CSS with `expression()` | Expression removed |
| SEC-006 | Path with `../` | Path rejected |
| SEC-007 | Absolute path `/etc/passwd` | Path rejected |
| SEC-008 | Path with null byte | Path rejected |
| SEC-009 | SVG with embedded script | Script removed |
| SEC-010 | Data URI in image | Allowed |

---

## 6. Performance Benchmarks

### 6.1 Target Performance Metrics

| Operation | Target | Measurement |
|-----------|--------|-------------|
| Small EPUB load (<10MB) | <500ms | Time to first chapter render |
| Large EPUB load (>100MB) | <10s | Time to full spine parse |
| Chapter fetch (cached) | <50ms | L1 cache hit |
| Chapter fetch (IDB) | <200ms | L2 cache hit |
| Chapter fetch (server) | <1s | Network + parse |
| Chapter fetch (WASM) | <2s | ZIP parse + extract |
| Asset extraction (50 images) | <2s | All images to blob URLs |
| HTML sanitization | <100ms | Per chapter |
| IndexedDB write | <100ms | Single chapter |
| Cache eviction | <50ms | LRU single item |

### 6.2 Memory Constraints

```typescript
interface MemoryBudget {
  maxBooks: 3;
  maxL1PerBook: 15; // MB
  maxBlobsPerBook: 200;
  totalBudget: 50; // MB
}
```

---

## 7. Data Flow Diagrams

### 7.1 Book Loading Flow

```
User Action: loadBook(arrayBuffer, 'book.epub')
│
├─→ HybridProvider.loadBook()
│   ├─→ Check provider mode
│   │   ├─→ 'server' → ApiClient.uploadBook()
│   │   ├─→ 'wasm' → WasmProvider.loadBook()
│   │   └─→ 'auto' → Try server, fallback to WASM
│   └─→ Return ParsedBook
│
├─→ VirtualFileSystem.initializeBook()
│   ├─→ Create cache namespaces
│   └─→ Return book ID
│
└─→ FileManager.postProcess()
    ├─→ Extract cover image
    └─→ Preload first chapter
```

### 7.2 Chapter Fetch Flow (3-Tier Cache)

```
getChapter(bookId, 'chapter1.xhtml')
│
├─→ L1 Cache (RAM) lookup
│   ├─→ HIT → Return immediately (<50ms)
│   └─→ MISS → Continue
│
├─→ L2 Cache (IndexedDB) lookup
│   ├─→ HIT → Store in L1, return (<200ms)
│   └─→ MISS → Continue
│
└─→ L3 Provider fetch
    ├─→ Server: GET /api/v1/books/:id/chapters/:href
    ├─→ WASM: getChapter(bookId, href)
    └─→ Write to L2, L1, return
```

---

## 8. Edge Cases and Error Handling

### 8.1 Network Failures

| Scenario | Behavior |
|----------|----------|
| Server unreachable (auto mode) | Fallback to WASM provider |
| Server timeout | Retry 3x with exponential backoff |
| Partial download | Resume from byte offset |

### 8.2 Corrupt EPUB Files

| Issue | Detection | Recovery |
|-------|-----------|----------|
| Invalid ZIP | ZIP parsing error | Reject file |
| Missing container.xml | File not found | Reject file |
| Invalid OPF | XML parsing error | Attempt repair |
| Missing spine items | Resource not found | Skip, show warning |

### 8.3 Memory Exhaustion

| Scenario | Detection | Mitigation |
|----------|-----------|------------|
| Too many books | Track usage | Evict LRU book |
| Large cache | Monitor size | Evict LRU entries |
| Too many blobs | Count URLs | Revoke old URLs |

---

## 9. Configuration Options

```typescript
const config: FileManagerConfig = {
  providerMode: 'auto',
  serverUrl: 'http://localhost:3000',
  deviceId: 'obsidian-desktop-12345',

  cache: {
    memoryMB: 50,
    indexedDBMB: 200,
    evictionPolicy: 'lru',
    preloadAdjacent: true,
    preloadDistance: 2,
  },

  security: {
    sanitizeHtml: true,
    sanitizeCss: true,
    allowedSchemes: ['blob', 'data'],
    blockExternal: true,
    validatePaths: true,
    csp: {
      defaultSrc: ["'self'", 'blob:'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'blob:'],
      imgSrc: ["'self'", 'blob:', 'data:'],
    },
  },

  extraction: {
    naming: 'hash',
    organize: true,
    subfolderPattern: '{{type}}/{{bookTitle}}',
    overwrite: false,
    createIndex: true,
    includeMetadata: true,
    resizeImages: {
      maxWidth: 2000,
      maxHeight: 2000,
      quality: 0.9,
    },
  },
};
```

---

## 10. Implementation Phases

### Phase 1: Security Hardening (Weeks 1-2)
- [x] Integrate DOMPurify
- [x] Implement path validation
- [x] Add CSP enforcement
- [x] Security test suite

### Phase 2: Asset Extraction Infrastructure (Weeks 3-5)
- [x] Create AssetExtractor class
- [x] Implement image/font/media extraction
- [x] Add vault export functionality
- [x] Create OCR interface

### Phase 3: Tiered Caching (Weeks 6-7)
- [x] Implement L1 LRU cache
- [x] Implement L2 IndexedDB cache
- [x] Add cache coherence
- [x] Performance benchmarking

### Phase 4: Hybrid Offline Support (Weeks 8-9)
- [x] Implement offline detection
- [x] Add "Download for offline" feature
- [x] Implement background sync

### Phase 5: Enhanced File Serving (Weeks 10-11)
- [x] Chunked upload protocol
- [x] OPDS catalog generation
- [x] Content deduplication

---

## 11. Testing Strategy

### 11.1 Unit Tests (85% coverage target)

```typescript
describe('FileManager', () => {
  it('should load EPUB from server in auto mode');
  it('should fallback to WASM when server unavailable');
  it('should reject invalid EPUB');
  it('should return chapter from L1 cache');
});

describe('SecurityValidator', () => {
  it('should remove script tags');
  it('should remove onclick attributes');
  it('should block javascript: URLs');
  it('should reject path traversal');
});

describe('VirtualFileSystem', () => {
  it('should cache file in L1 and L2');
  it('should evict LRU entry when cache full');
});
```

### 11.2 Performance Tests

```typescript
describe('Performance Benchmarks', () => {
  it('should load small EPUB in <500ms');
  it('should load large EPUB in <10s');
  it('should extract 50 images in <2s');
  it('should achieve 80% cache hit rate');
});
```

---

## Appendix

### A.1 MIME Type Reference

```typescript
const MIME_TYPES: Record<string, string> = {
  'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
  'png': 'image/png', 'gif': 'image/gif',
  'svg': 'image/svg+xml', 'webp': 'image/webp',
  'woff': 'font/woff', 'woff2': 'font/woff2',
  'ttf': 'font/ttf', 'otf': 'font/otf',
  'css': 'text/css',
  'html': 'text/html', 'xhtml': 'application/xhtml+xml',
  'mp3': 'audio/mpeg', 'mp4': 'video/mp4',
  'epub': 'application/epub+zip',
};
```

### A.2 Error Codes

```typescript
enum FileSystemErrorCode {
  FILE_NOT_FOUND = 'FS001',
  INVALID_PATH = 'FS002',
  INVALID_EPUB = 'FS101',
  CACHE_FULL = 'FS201',
  XSS_DETECTED = 'FS301',
  PATH_TRAVERSAL = 'FS302',
  SERVER_UNREACHABLE = 'FS401',
}
```

---

**Document Metadata:**
- **Version:** 1.0
- **Date:** 2026-01-01
- **Author:** Los Libros Development Team
- **Status:** Approved for Implementation
