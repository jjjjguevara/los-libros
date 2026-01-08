# MuPDF Migration Plan: PDFium → MuPDF (Hybrid Architecture)

## Executive Summary

Replace PDFium with MuPDF using a **hybrid architecture**:
- **Client**: MuPDF WASM for fast rendering (<50ms first paint)
- **Server**: Rust `mupdf` crate for OCR, annotations, OPDS, batch processing

**License**: AGPL-3.0 (acceptable for this open-source project)

---

## Current State Issues (Why Migrate)

| Issue | File Location | Impact |
|-------|--------------|--------|
| Unsafe lifetime transmute | `parser.rs:92,119` | Memory safety risk |
| Incorrect Send/Sync impl | `parser.rs:64-65` | Thread safety violations |
| Character positions approximated | `parser.rs:438-464` | Poor text selection |
| Font size hardcoded to 12.0 | `parser.rs:422` | Wrong text rendering |
| Search lacks bounding boxes | `parser.rs:534` | Can't highlight results |
| Concurrent rendering crashes | `pdf-renderer.ts:203` | Prefetching disabled |

---

## Migration Gains

| Category | Before (PDFium) | After (MuPDF) |
|----------|-----------------|---------------|
| **Text Accuracy** | Uniform char widths | Actual glyph positions via stext |
| **Font Metadata** | Hardcoded 12pt | Real font name, size, style |
| **Search** | No positions | Bounding boxes for highlighting |
| **Page Labels** | Sequential 1,2,3 | Actual PDF labels (i, ii, 1, 2) |
| **Thread Safety** | Unsafe transmutes | Proper Rust lifetimes |
| **Render Speed** | ~150ms | Target <50ms (WASM) |
| **Smart Dark Mode** | CSS invert (breaks images) | Display list manipulation |
| **Mobile Reflow** | None | HTML output via `mutool draw -F html` |
| **OCR** | External Tesseract | Native MuPDF OCR injection |
| **Format Support** | PDF only | PDF, EPUB, CBZ, XPS (polyglot) |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Obsidian Plugin (Electron)                       │
├─────────────────────────────────────────────────────────────────────┤
│  Main Thread                          │  Web Worker                 │
│  ├─ React/Svelte UI                   │  ├─ MuPDF WASM Runtime     │
│  ├─ Obsidian API Integration          │  ├─ Page Rendering          │
│  ├─ Shadow DOM Reader                 │  ├─ Text Extraction         │
│  └─ Canvas/SVG Display                │  ├─ Smart Dark Mode         │
│         ↑ SharedArrayBuffer           │  └─ Mobile Reflow (HTML)    │
│         │ transfer                    │                             │
└─────────│─────────────────────────────┴─────────────────────────────┘
          │ Fast render path (no HTTP)
          │
┌─────────▼─────────────────────────────────────────────────────────────┐
│                     Rust Server (Axum + mupdf crate)                   │
├────────────────────────────────────────────────────────────────────────┤
│  ├─ OPDS Catalog & Library Management                                  │
│  ├─ Annotation Persistence (Obsidian Sync integration)                 │
│  ├─ OCR Text Layer Injection (permanent embed in PDF)                  │
│  ├─ Full-Text Search Index (Tantivy/SQLite FTS)                       │
│  ├─ Thumbnail Batch Generation                                         │
│  ├─ Digital Signature Verification                                     │
│  ├─ PDF Form Data Persistence                                          │
│  └─ S3/Storage Backend                                                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Phased Implementation Plan

### Phase 0: Foundation Setup (1 day)

**Goal**: Set up MuPDF dependencies on both client and server.

**Server Changes**:
```toml
# apps/amnesia-server/Cargo.toml
[dependencies]
# Remove: pdfium-render = { version = "0.8", features = ["thread_safe"] }
mupdf = "0.5"  # Latest from crates.io (messense/mupdf-rs)
```

**Client Changes**:
```json
// apps/amnesia/package.json
{
  "dependencies": {
    "mupdf": "^4.0.0"  // Official Artifex npm package (verify latest on npm)
  }
}
```

**IMPORTANT**: Verify actual npm version before starting. The official package may have different versioning.

**Files to Modify**:
- `apps/amnesia-server/Cargo.toml` - Replace pdfium-render with mupdf
- `apps/amnesia/package.json` - Add mupdf npm package

**Verification**:
```bash
cd apps/amnesia-server && cargo build
cd apps/amnesia && npm install && npm run build
```

---

### Phase 5: Server-Side MuPDF Integration (3 days)

**Goal**: Replace pdfium-render with mupdf crate for server operations.

**New Files**:
| File | Purpose | Lines (est) |
|------|---------|-------------|
| `apps/amnesia-server/src/pdf/mupdf_parser.rs` | Core MuPDF wrapper | ~500 |
| `apps/amnesia-server/src/pdf/stext_extractor.rs` | Structured text extraction | ~300 |
| `apps/amnesia-server/src/pdf/search.rs` | Search with bounding boxes | ~200 |
| `apps/amnesia-server/src/pdf/ocr_injector.rs` | OCR text layer injection | ~400 |

**Key Implementation** (`mupdf_parser.rs`):

```rust
use mupdf::{Context, Document, Page, Matrix, Colorspace};
use std::sync::Arc;
use parking_lot::Mutex;

/// Thread-safe MuPDF parser using context pool
pub struct MuPdfParser {
    /// Pool of fz_context instances for concurrent access
    context_pool: Arc<ContextPool>,
    /// Document data (kept alive for document lifetime)
    data: Vec<u8>,
    /// Document ID
    id: String,
}

/// Connection pool of fz_context for thread safety
struct ContextPool {
    contexts: Mutex<Vec<Context>>,
    max_size: usize,
}

impl MuPdfParser {
    pub fn from_bytes(data: Vec<u8>, id: String) -> Result<Self, MuPdfError> {
        let context_pool = Arc::new(ContextPool::new(4));  // Pool size 4
        Ok(Self { context_pool, data, id })
    }

    pub fn render_page(&self, page_num: u32, scale: f32) -> Result<Vec<u8>, MuPdfError> {
        // Validate scale (prevent DoS)
        let scale = scale.clamp(0.1, 4.0);

        let ctx = self.context_pool.acquire();
        let doc = Document::from_bytes(&ctx, &self.data, "")?;
        let page = doc.load_page(page_num as i32)?;

        let matrix = Matrix::scale(scale, scale);
        let pixmap = page.to_pixmap(&matrix, &Colorspace::device_rgb(), 0.0, true)?;
        let png = pixmap.to_png()?;

        self.context_pool.release(ctx);
        Ok(png)
    }
}
```

**Files to Modify**:
- `apps/amnesia-server/src/pdf/cache.rs` - Use ContextPool, update types
- `apps/amnesia-server/src/pdf/types.rs` - Add font_name, BoundingBox for search
- `apps/amnesia-server/src/routes/pdf.rs` - Validate scale, add search endpoint

**Files to Remove**:
- `apps/amnesia-server/src/pdf/parser.rs` (replaced by mupdf_parser.rs)

---

### Phase 7: Search with Bounding Boxes (1 day)

**Goal**: Search returns coordinates for visual highlighting.

**Implementation**:

```rust
// search.rs
use mupdf::{Document, Page};
use crate::pdf::types::{SearchResult, BoundingBox};

pub fn search_document(
    doc: &Document,
    query: &str,
    max_results: usize,
) -> Result<Vec<SearchResult>, MuPdfError> {
    let mut results = Vec::new();

    for page_num in 0..doc.page_count()? {
        if results.len() >= max_results {
            break;
        }

        let page = doc.load_page(page_num as i32)?;
        let quads = page.search(query, 100)?;

        for quad in quads {
            results.push(SearchResult {
                text: query.to_string(),
                page: page_num as u32 + 1,
                bounds: vec![BoundingBox {
                    x: quad.ll.x,
                    y: quad.ll.y,
                    width: quad.lr.x - quad.ll.x,
                    height: quad.ul.y - quad.ll.y,
                }],
            });
        }
    }

    Ok(results)
}
```

---

### Phase 8: Annotations & Highlights (2 days)

**Goal**: Server-side persistence for PDF annotations.

**New Endpoints**:
```
POST /api/v1/pdf/:id/annotations
GET  /api/v1/pdf/:id/annotations
PUT  /api/v1/pdf/:id/annotations/:annotation_id
DELETE /api/v1/pdf/:id/annotations/:annotation_id
```

**Database Schema**:
```sql
CREATE TABLE pdf_annotations (
    id TEXT PRIMARY KEY,
    pdf_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    type TEXT NOT NULL,
    color TEXT,
    content TEXT,
    bounds_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pdf_id) REFERENCES pdfs(id)
);
```

---

### Phase 1: Client-Side WASM Renderer (3-4 days)

**Goal**: Implement fast client-side rendering with MuPDF WASM.

**New Files**:
| File | Purpose |
|------|---------|
| `apps/amnesia/src/reader/renderer/pdf/mupdf-worker.ts` | Web Worker MuPDF runtime |
| `apps/amnesia/src/reader/renderer/pdf/mupdf-bridge.ts` | Main thread ↔ Worker bridge |
| `apps/amnesia/src/reader/renderer/pdf/wasm-renderer.ts` | Page rendering coordinator |

---

### Phase 2: Structured Text & Smart Copy (2 days)

**Goal**: Extract text with semantic awareness for Markdown pasting.

---

### Phase 3: Smart Dark Mode (2 days)

**Goal**: Invert text/background while preserving images.

**Alternative Approach** (since display list manipulation is not exposed):
```typescript
async renderPageWithDarkMode(pageNum: number): Promise<ImageData> {
  const pixmap = await this.renderPage(pageNum);
  const imageData = pixmap.getPixels();
  const processed = invertWithImagePreservation(imageData);
  return processed;
}
```

---

### Phase 4: Mobile Reflow (HTML Output) (2 days)

**Goal**: Convert PDF to responsive HTML for mobile reading.

---

### Phase 6: OCR Text Layer Injection (2 days)

**Goal**: Permanently embed OCR text layers into PDF files.

**Alternative Approach** (using external tool):
```bash
# Install ocrmypdf (Python tool with MuPDF backend)
pip install ocrmypdf

# Inject OCR layer
ocrmypdf --skip-text input.pdf output.pdf
```

---

### Phase 9: Form Filling & Signatures (2 days)

**Goal**: Interactive PDF forms and signature verification.

---

## Timeline (Recommended Order)

| Priority | Phase | Duration | Notes |
|----------|-------|----------|-------|
| 1 | Phase 0: Foundation | 1 day | Validate APIs |
| 2 | Phase 5: Server MuPDF | 3 days | Core rendering |
| 3 | Phase 7: Search | 1 day | Search API exists |
| 4 | Phase 8: Annotations | 2 days | Annotations work |
| 5 | Phase 1: Client WASM | 3-4 days | With JSON parsing fix |
| 6 | Phase 2: Smart Copy | 2 days | Depends on Phase 1 |
| 7 | Phase 3: Smart Dark Mode | 2 days | Fallback approach |
| 8 | Phase 4: Mobile Reflow | 2 days | Manual HTML |
| 9 | Phase 6: OCR | 2 days | External tool |
| 10 | Phase 9: Forms | 2 days | FFI research |
| **Total** | | **~22-24 days** | |

---

## Risk Assessment & API Corrections

| Phase | Issue | Correction |
|-------|-------|------------|
| Phase 1 | `toStructuredText()` returns JSON, not objects | Parse JSON output |
| Phase 3 | Display list manipulation not exposed | Use pixmap post-processing |
| Phase 4 | `page.toHTML()` not available in WASM | Generate HTML from stext |
| Phase 6 | `page.insert_text()` doesn't exist | Use external `ocrmypdf` |
| Phase 9 | Form widget API incomplete | Needs FFI research |

---

## Success Metrics (from PRD)

| Metric | Current | Target |
|--------|---------|--------|
| Time to First Paint | ~150ms | <50ms |
| Search Speed (100pg) | ~2.0s | <0.5s |
| Character Position Error | ~20% | <1% |
| Font Size Accuracy | 0% (hardcoded) | 100% |

---

## Sources

- [mupdf-rs crate](https://crates.io/crates/mupdf)
- [MuPDF.js npm](https://www.npmjs.com/package/mupdf)
- [MuPDF WASM Documentation](https://mupdf.readthedocs.io/en/latest/mupdf-wasm.html)
- [ocrmypdf documentation](https://ocrmypdf.readthedocs.io/)
