# Los Libros — Product Requirements Document

**Project Name:** Los Libros (LL)
**Target Platform:** Obsidian (Desktop & Mobile/iPad)
**Ecosystem:** Part of the Shapeshifter (SS) + Doc Doctor (DD) + Los Libros (LL) suite

---

## 1. Executive Summary

Los Libros transforms Obsidian into a high-performance ebook reader that rivals commercial solutions (BookFusion, Apple Books) while maintaining complete data ownership. The system consists of two components:

1. **Los Libros Server** — A Rust-based backend with native S3 support, OPDS catalog generation, and multi-device progress sync
2. **Los Libros Plugin** — An Obsidian plugin for reading EPUBs, capturing highlights, and integrating with Doc Doctor

**Core Differentiators:**
- File-first architecture (S3-compatible storage as source of truth)
- Calibre-compatible folder structure (no migration needed)
- Local-first with optional sync (works 100% offline)
- Shared highlights system with Doc Doctor
- BookFusion-style Liquid templating for customization

---

## 2. System Architecture

### 2.1 Three-Layer Model

```
┌─────────────────────────────────────────────────────────────┐
│                    LAYER 3: SYNC ADAPTERS                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐   │
│  │ Kavita  │ │ KOReader│ │ Calibre │ │ Audiobookshelf  │   │
│  │ Sync    │ │ Protocol│ │ Web     │ │ (future)        │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                    LAYER 2: OPDS CLIENT                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • Browse remote catalogs (any OPDS 1.2/2.0 server) │   │
│  │  • Download books to vault                          │   │
│  │  • Metadata enrichment                              │   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                 LAYER 1: LOCAL VAULT READER                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • Read EPUBs/PDFs directly from vault              │   │
│  │  • Highlights → Shared Highlights System            │   │
│  │  • Progress stored in frontmatter                   │   │
│  │  • Works 100% offline, zero server needed           │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Full System Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         USER DEVICES                                      │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────────┐  │
│  │ Obsidian       │  │ Mobile App     │  │ E-Ink Reader               │  │
│  │ (Los Libros)   │  │ (Future)       │  │ (KOReader Protocol)        │  │
│  └───────┬────────┘  └───────┬────────┘  └────────────┬───────────────┘  │
│          │                   │                        │                   │
│          └───────────────────┴────────────────────────┘                   │
│                              │ OPDS 1.2/2.0 + REST API                    │
├──────────────────────────────┼────────────────────────────────────────────┤
│                    LOS LIBROS SERVER (Rust/Axum)                          │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  • OPDS Catalog Generation                                          │ │
│  │  • Progress Sync (multi-device)                                     │ │
│  │  • Highlight/Annotation Storage                                     │ │
│  │  • Metadata Extraction (EPUB/PDF)                                   │ │
│  │  • Calibre-Compatible Folder Scanner                                │ │
│  │  • S3 Native (no rclone hack needed)                               │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                              │                                            │
├──────────────────────────────┼────────────────────────────────────────────┤
│                    STORAGE LAYER                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐   │
│  │ MinIO           │  │ Cloudflare R2   │  │ Backblaze B2 / AWS S3   │   │
│  │ (Self-hosted)   │  │ (Edge CDN)      │  │ (Cloud)                 │   │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘   │
│                              │                                            │
│                    Calibre Folder Structure:                              │
│                    /Author Name/Book Title/book.epub                     │
│                    /Author Name/Book Title/metadata.opf                  │
│                    /Author Name/Book Title/cover.jpg                     │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Why Build a Custom Server?

| Existing Option | Problem |
|-----------------|---------|
| **Kavita** | Manga-optimized, confusing ebook UX, requires rclone for S3 |
| **Stump** | WIP, breaking changes incoming |
| **Calibre-Web** | No progress sync, database-centric not file-first |
| **Audiobookshelf** | Experimental ebook support |

**Los Libros Server Advantages:**
- Read directly from S3 API (no rclone mounting)
- Generate OPDS on-the-fly from folder structure
- Store progress/highlights in SQLite (portable)
- Serve as ecosystem backend for Doc Doctor features
- Potential WASM embedding in Obsidian

---

## 3. Technical Stack

### 3.1 Server (apps/los-libros-server)

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Framework** | Axum (Rust) | Async, performant, type-safe |
| **Storage** | S3 API (native) | MinIO, R2, B2, AWS all compatible |
| **Database** | SQLite (embedded) | Simple, portable, no external deps |
| **OPDS** | quick-xml | Parse/generate OPDS 1.2/2.0 |
| **Metadata** | Custom parser | Calibre metadata.opf support |
| **Container** | Docker | Single-command deployment |

**Cargo.toml Dependencies:**
```toml
[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
aws-sdk-s3 = "1.0"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sqlx = { version = "0.7", features = ["sqlite", "runtime-tokio"] }
quick-xml = "0.31"
tracing = "0.1"
tower-http = { version = "0.5", features = ["cors"] }
```

### 3.2 Plugin (apps/los-libros)

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Framework** | Svelte 4.2.1 | Doc Doctor alignment, low memory |
| **EPUB Rendering** | Epub.js | BSD license, CFI-based, lightweight |
| **State** | Store + Reducer | Proven Doc Doctor pattern |
| **Templates** | LiquidJS | BookFusion compatibility |
| **Virtual Scroll** | TanStack Virtual | Headless, Svelte support |
| **Build** | esbuild | Fast, Svelte plugin available |

**Package.json Dependencies:**
```json
{
  "dependencies": {
    "epubjs": "^0.3.93",
    "liquidjs": "^10.10.0",
    "@tanstack/svelte-virtual": "^3.0.0"
  },
  "devDependencies": {
    "svelte": "4.2.1",
    "svelte-preprocess": "5.0.4",
    "esbuild": "0.17.3",
    "esbuild-svelte": "0.8.0",
    "typescript": "4.7.4",
    "vitest": "0.34.5",
    "obsidian": "latest",
    "lucide-svelte": "0.292.0"
  }
}
```

### 3.3 Storage Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                    STORAGE ABSTRACTION                       │
│                                                             │
│  ┌───────────────────┐          ┌───────────────────────┐  │
│  │  MinIO (Local)    │◀────────▶│  Cloudflare R2        │  │
│  │  Primary Storage  │   Sync   │  Cloud Fallback       │  │
│  │  $0 (your HW)     │          │  $0.015/GB + Free CDN │  │
│  └───────────────────┘          └───────────────────────┘  │
│                                                             │
│  Same S3 API = Same code for both backends                 │
└─────────────────────────────────────────────────────────────┘
```

| Provider | Storage/GB/mo | Egress | Best For |
|----------|---------------|--------|----------|
| MinIO (self) | $0 (your HW) | N/A | Local primary |
| **R2** | $0.015 | **Free** | Cloud fallback |
| B2 | $0.006 | Free via CF | Cold archive |

---

## 4. Doc Doctor Integration

### 4.1 Shared Highlights System

Los Libros and Doc Doctor share a highlights infrastructure:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SHARED HIGHLIGHTS CORE                           │
│                    (packages/highlights/)                           │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Highlight Types:                                           │   │
│  │  • InlineHighlight (Doc Doctor's ==text== system)           │   │
│  │  • SourceHighlight (from books, with CFI/page references)   │   │
│  │  • LinkedHighlight (connects inline to source)              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Shared Services:                                           │   │
│  │  • HighlightStore (reactive state management)               │   │
│  │  • HighlightParser (extend parseAnnotations)                │   │
│  │  • HighlightRenderer (decorations)                          │   │
│  │  • HighlightExporter (Liquid templates)                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Highlight Types

```typescript
// packages/highlights/src/types.ts

interface BaseHighlight {
  id: string;
  text: string;
  label?: string;
  color?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Doc Doctor inline highlights
interface InlineHighlight extends BaseHighlight {
  type: 'inline';
  documentPath: string;
  range: EditorRange;
  position: { from: number; to: number; };
}

// Los Libros reading source highlights
interface SourceHighlight extends BaseHighlight {
  type: 'source';
  source: {
    type: 'book' | 'article' | 'webpage';
    title: string;
    author?: string;
    bookPath?: string;
    cfi?: string;           // EPUB CFI
    page?: number;          // PDF page
    chapter?: string;
    percentProgress?: number;
  };
  annotation?: string;
  atomicNotePath?: string;
}

// Linked highlights (connects inline to source)
interface LinkedHighlight extends InlineHighlight {
  linkedTo: string;         // ID of SourceHighlight
}

type Highlight = InlineHighlight | SourceHighlight | LinkedHighlight;
```

### 4.3 Ecosystem Synergies

| Doc Doctor Feature | Los Libros Integration |
|--------------------|------------------------|
| **Smart Connections** | Surface related vault notes when highlighting text |
| **LLM Service** | "Explain this passage", "Summarize chapter", "Generate quiz" |
| **MCP Server** | Expose reading data for Claude Code workflows |
| **Provenance** | Track when/how reading sources entered documents |
| **Projects** | Scope reading lists to projects |

---

## 5. Data Models

### 5.1 Book Note Schema (Liquid-templated)

```yaml
---
type: book
title: "{{ book.title }}"
author: "{{ book.author }}"
isbn: "{{ book.isbn }}"
cover_url: "{{ book.cover_url }}"
local_path: "{{ book.local_path }}"
server_id: "{{ book.server_id }}"
status: reading  # to-read | reading | completed | archived
progress: 45
current_cfi: "epubcfi(/6/4[chap1]!/4/2/1:0)"
formats: [epub, pdf]
started: 2025-12-20
completed: null
reading_sessions: 12
highlights_count: 23
tags: [design, ux, psychology]
---

# {{ book.title }}

## Notes

## Key Highlights
{{ highlights | map: 'blockquote' | join: '\n\n' }}
```

### 5.2 Atomic Highlight Schema

```yaml
---
type: highlight
source: "[[{{ book.title }}]]"
book_id: "{{ book.id }}"
cfi: "{{ highlight.cfi }}"
chapter: "{{ highlight.chapter }}"
page_percent: {{ highlight.percent }}
color: "{{ highlight.color }}"
created: {{ highlight.created }}
tags: []
---

> "{{ highlight.text }}"

## My Thoughts

{{ highlight.annotation }}
```

### 5.3 Server Progress Schema (REST API)

```json
{
  "user_id": "uuid",
  "book_id": "uuid",
  "progress": {
    "percent": 45,
    "cfi": "epubcfi(/6/4[chap1]!/4/2/1:0)",
    "page": 127,
    "total_pages": 284,
    "last_read": "2025-12-26T10:00:00Z"
  },
  "highlights": [
    {
      "id": "uuid",
      "cfi": "epubcfi(...)",
      "text": "Good design is...",
      "annotation": "User note",
      "color": "yellow",
      "created_at": "2025-12-26T10:00:00Z"
    }
  ],
  "synced_at": "2025-12-26T10:00:00Z"
}
```

### 5.4 JSON Backbone (data.json)

```json
{
  "version": 1,
  "library": {
    "book-uuid-1": {
      "title": "Design of Everyday Things",
      "author": "Don Norman",
      "local_path": "Books/Don Norman/Design of Everyday Things.epub",
      "server_id": "server-uuid",
      "last_read": "2025-12-26",
      "progress": 45,
      "highlights": ["hl-uuid-1", "hl-uuid-2"]
    }
  },
  "sync_queue": [],
  "settings": {
    "server_url": "https://libros.example.com",
    "offline_mode": false
  }
}
```

---

## 6. iPad/Mobile Performance Strategy

### 6.1 iOS Technical Constraints

| Constraint | Impact | Solution |
|------------|--------|----------|
| **Sandboxed file system** | Vault must be in Obsidian folder or iCloud | Store EPUBs in `{vault}/Books/` |
| **No `fs` module** | Can't use Node.js file system | Use `app.vault.adapter.readBinary()` |
| **No `path` module** | Need custom path handling | Implement our own path utils |
| **Binary blobs** | Must use `arraybuffer` not `nodebuffer` | Handle in epub download logic |
| **Memory limits** | Large files cause crashes | Smart caching, lazy loading |

### 6.2 Epub.js iOS Optimizations

| Issue | Fix |
|-------|-----|
| Auto-expanding iframe breaks | Set explicit width/height on init |
| Rendering shifts by pixels | Ensure width is always even |
| Safari resize event spam | Capture dimensions once at init |
| Continuous mode slow | Use default (single section) mode on mobile |

### 6.3 Mobile Implementation

```typescript
const isMobile = Platform.isMobile || Platform.isIOS;

const renditionOptions = {
  manager: isMobile ? "default" : "continuous",
  flow: isMobile ? "paginated" : "scrolled-doc",
  width: isMobile ? getEvenWidth() : "100%",
  height: isMobile ? window.innerHeight : "100%",
};

async function downloadBook(bookId: string): Promise<ArrayBuffer> {
  const response = await fetch(`${serverUrl}/api/books/${bookId}/download`);
  const buffer = await response.arrayBuffer();

  await app.vault.adapter.writeBinary(
    `Books/${bookId}.epub`,
    buffer
  );

  return buffer;
}
```

### 6.4 Smart Caching Strategy

```typescript
interface BookCache {
  maxCachedBooks: number;      // 5 on mobile, 20 on desktop
  maxCacheSize: number;        // 100MB on mobile, 500MB on desktop
  downloadedBooks: Map<string, { path: string; lastRead: Date; size: number }>;
}

// Evict least-recently-read books when cache full
async function ensureCacheSpace(neededBytes: number) {
  if (Platform.isMobile && currentCacheSize + neededBytes > maxCacheSize) {
    const sorted = [...downloadedBooks.entries()]
      .sort((a, b) => a[1].lastRead - b[1].lastRead);

    while (currentCacheSize + neededBytes > maxCacheSize && sorted.length > 0) {
      const [bookId, info] = sorted.shift()!;
      await app.vault.adapter.remove(info.path);
      currentCacheSize -= info.size;
    }
  }
}
```

### 6.5 Reading Workflow with Cloud Storage

```
┌──────────────────────────────────────────────────────────────────────┐
│                    YOUR READING WORKFLOW                              │
│                                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐  │
│  │  Calibre    │───▶│  R2 Cloud   │───▶│  iPad Obsidian          │  │
│  │  Library    │    │  (Backup)   │    │  (Local Downloaded)     │  │
│  │  (1000+     │    │             │    │                         │  │
│  │   books)    │    │  Full lib   │    │  Currently reading:     │  │
│  └─────────────┘    │  synced     │    │  - Book A (downloaded)  │  │
│                     └─────────────┘    │  - Book B (downloaded)  │  │
│                           │            │                         │  │
│                           │            │  Read offline ✅        │  │
│                           ▼            │  Progress syncs when    │  │
│                     ┌─────────────┐    │  back online ✅         │  │
│                     │  On-Demand  │───▶│                         │  │
│                     │  Download   │    └─────────────────────────┘  │
│                     └─────────────┘                                  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 7. Monorepo Structure

```
los-libros/                         # Root monorepo
├── README.md
├── pnpm-workspace.yaml
├── docker-compose.yml
│
├── apps/
│   ├── los-libros-server/          # Rust server binary
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── config.rs
│   │   │   └── routes/
│   │   │       ├── opds.rs
│   │   │       ├── progress.rs
│   │   │       ├── library.rs
│   │   │       └── health.rs
│   │   ├── Dockerfile
│   │   └── .env.example
│   │
│   └── los-libros/                 # Obsidian plugin
│       ├── package.json
│       ├── manifest.json
│       ├── esbuild.config.mjs
│       ├── src/
│       │   ├── main.ts
│       │   ├── styles.css
│       │   ├── opds/
│       │   ├── library/
│       │   ├── reader/
│       │   ├── highlights/
│       │   ├── sync/
│       │   └── settings/
│       └── test/
│
├── packages/
│   ├── shared-types/               # Shared TypeScript types
│   │   ├── package.json
│   │   └── src/
│   │       ├── book.ts
│   │       ├── highlight.ts
│   │       ├── opds.ts
│   │       └── progress.ts
│   │
│   └── libros-core/                # Shared Rust crates (future)
│       ├── Cargo.toml
│       └── crates/
│           ├── libros-s3/
│           ├── libros-opds/
│           ├── libros-metadata/
│           └── libros-wasm/
│
└── docs/
    └── requirements/
        └── reader-PRD.md
```

---

## 8. Feature Roadmap

### Phase 0: Server Infrastructure

| Milestone | Deliverable |
|-----------|-------------|
| **M0.1** | Axum server skeleton with health check, Docker setup |
| **M0.2** | S3 integration (MinIO/R2), list buckets/objects |
| **M0.3** | Calibre scanner (Author/Title structure, metadata.opf) |
| **M0.4** | OPDS 1.2 catalog generation |
| **M0.5** | Progress API (CRUD endpoints) |

**Exit Criteria:** Server running in Docker, browsable via OPDS client (Panels, KyBook)

### Phase 1: Plugin MVP

| Milestone | Deliverable |
|-----------|-------------|
| **M1.1** | Plugin skeleton, settings tab, server connection |
| **M1.2** | OPDS client (parse, browse remote catalog) |
| **M1.3** | Local library (read EPUBs from vault folder) |
| **M1.4** | EPUB reader (Epub.js integration, ItemView) |
| **M1.5** | Progress sync (frontmatter ↔ server) |
| **M1.6** | Liquid templates (customizable note generation) |

**Exit Criteria:** Read books from server or vault, progress syncs

### Phase 2: Highlights & Integration

| Milestone | Deliverable |
|-----------|-------------|
| **M2.1** | Highlighting (text selection → highlight creation) |
| **M2.2** | Shared highlights system with Doc Doctor |
| **M2.3** | Highlights sidebar with jump-to-context |
| **M2.4** | Sync adapters (Kavita, KOReader) |

**Exit Criteria:** Highlights work with shared system

### Phase 3: Intelligence Layer

| Milestone | Deliverable |
|-----------|-------------|
| **M3.1** | Smart Connections integration |
| **M3.2** | LLM integration (explain, summarize, quiz) |
| **M3.3** | Reading analytics (Dataview-compatible) |

**Exit Criteria:** AI features functional, analytics visible

---

## 9. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| **iPad Memory** | DOM managed via virtual scrolling for >50 highlights |
| **Startup Time** | Library indexing async, doesn't block main thread |
| **Offline First** | 100% read-only functionality when server unreachable |
| **Battery Drain** | Stop background sync when Reader Leaf inactive |
| **Bundle Size** | Plugin <500KB, server <50MB Docker image |

---

## 10. BookFusion-Inspired Features

| Feature | Implementation |
|---------|----------------|
| **Liquid Templating** | `liquidjs` for note/highlight templates |
| **Atomic Highlights** | Each highlight = separate MD file |
| **Smart Sync Policies** | Magic (intelligent merge), Append, Replace |
| **Multi-Vault** | Server stores vault-specific configs |
| **Update Intervals** | Manual, 30min, 1hr, 4hr, 12hr, 24hr |

---

## 11. Calibre Compatibility

The server scans S3 buckets following Calibre's folder structure:

```
library/
├── metadata.db              # SQLite index (optional, can regenerate)
├── Don Norman/
│   └── The Design of Everyday Things/
│       ├── The Design of Everyday Things.epub
│       ├── metadata.opf     # Dublin Core XML
│       └── cover.jpg
└── Douglas Adams/
    └── The Hitchhikers Guide to the Galaxy/
        ├── The Hitchhikers Guide to the Galaxy.epub
        ├── metadata.opf
        └── cover.jpg
```

**Benefits:**
- Use existing Calibre library without migration
- Portable (just files, no database lock-in)
- Easy manual organization
- Works with Calibre2OPDS for static catalog generation

---

## 12. Potential Future Integrations

### 12.1 Spaced Repetition ("Ghost of Reading Past")

- **Integration:** Obsidian Spaced Repetition Plugin
- **Mechanism:** Auto-inject `#flashcard` tags or `sr-due:` frontmatter into highlights
- **Value:** Turns passive reading into active retention

### 12.2 AI Synthesis Sidecar

- **Integration:** Smart Connections (Vector Embeddings) or Local LLM (Ollama)
- **Mechanism:** When highlighting, query vector store for related vault notes
- **Value:** Instant serendipity and linking of new knowledge to old thoughts

### 12.3 Active Recall Generator

- **Integration:** OpenAI API or Local LLM
- **Mechanism:** Generate quiz questions from chapter highlights
- **Value:** Verifies comprehension before moving forward

### 12.4 Reading Analytics & Heatmaps

- **Integration:** Dataview
- **Mechanism:** Visualization of `reading_sessions` logged in the Book Note
- **Value:** Gamification and insight into reading habits

### 12.5 Omnisearch Integration

- **Integration:** Omnisearch
- **Mechanism:** Expose the `data.json` index to Omnisearch
- **Value:** "Search inside books" without bloating the vault

---

## Appendix A: Research Sources

### Epub.js & Readers
- [Epub.js GitHub](https://github.com/futurepress/epub.js)
- [ePUB.js vs Readium.js Comparison](https://kitaboo.com/epub-js-vs-readium-js-comparison-of-epub-readers/)
- [Obsidian Annotator Plugin](https://github.com/elias-sundqvist/obsidian-annotator)

### Self-Hosted Ebook Servers
- [Kavita Official](https://www.kavitareader.com/)
- [Stump GitHub](https://github.com/stumpapp/stump)
- [Calibre Folder Structure](https://manual.calibre-ebook.com/faq.html)
- [Kavita with S3 Storage](https://www.tanyongsheng.com/blog/how-to-self-host-your-e-book-library-on-s3-storage-with-kavita-reader/)

### BookFusion Reference
- [BookFusion Plugin GitHub](https://github.com/BookFusion/obsidian-plugin)
- [Liquid Templating Docs](https://shopify.github.io/liquid/)
- [BookFusion Blog - Obsidian Integration](https://www.blog.bookfusion.com/introducing-the-bookfusion-obsidian-plugin-sync-epub-pdf-cbz-cbr-mobi-highlights-annotations-to-your-vault/)

### OPDS Protocol
- [OPDS Wiki](https://wiki.mobileread.com/wiki/OPDS)
- [OPDS 1.2 Specification](https://specs.opds.io/opds-1.2)
- [Awesome OPDS](https://github.com/opds-community/awesome-opds)

### Virtual Scrolling
- [TanStack Virtual](https://tanstack.com/virtual/latest)
- [TanStack Svelte Examples](https://tanstack.com/virtual/latest/docs/framework/svelte/examples/smooth-scroll)

### Obsidian Development
- [Obsidian Svelte Guide](https://docs.obsidian.md/Plugins/Getting+started/Use+Svelte+in+your+plugin)
- [Obsidian-Svelte-Starter](https://github.com/Quorafind/Obsidian-Svelte-Starter)

### S3 Self-Hosting
- [MinIO Self-Hosted Guide](https://selfhostschool.com/minio-self-hosted-s3-storage-guide/)
- [Cloudflare R2 Docs](https://developers.cloudflare.com/r2/)
- [Garage - MinIO Alternative](https://garagehq.deuxfleurs.fr/)
