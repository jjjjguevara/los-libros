# PDF Support Implementation Plan for Los Libros

## Overview

Add PDF rendering support to Los Libros ebook reader with full feature parity to EPUB, plus PDF-specific features (region selection, OCR). Architecture uses pdfium-render on server, WASM for offline, PDF.js as last fallback.

## Architecture Summary

```
CLIENT (TypeScript/Svelte)                    SERVER (Rust/Axum)
┌─────────────────────────────┐              ┌─────────────────────────────┐
│  DocumentRenderer interface │              │  PdfParser (pdfium-render)  │
│  ├── EpubRenderer (existing)│◄────────────►│  ├── Metadata extraction    │
│  └── PdfRenderer (new)      │   REST API   │  ├── Page rendering         │
│      ├── Canvas layer       │              │  ├── Text layer extraction  │
│      ├── Text layer         │              │  └── Outline → TocEntry     │
│      ├── Annotation layer   │              │                             │
│      └── Region selection   │              │  OcrService                 │
│                             │              │  ├── TesseractProvider      │
│  WASM fallback (offline)    │              │  └── OllamaProvider         │
│  PDF.js fallback (last)     │              └─────────────────────────────┘
└─────────────────────────────┘
```

---

## Phase 1: Server-Side PDF Module

### Files to Create

**`/apps/los-libros-server/src/pdf/mod.rs`**
```rust
pub mod types;
pub mod parser;
pub mod cache;
pub mod renderer;
pub mod text_layer;
```

**`/apps/los-libros-server/src/pdf/types.rs`**
- `ParsedPdf` struct (id, metadata, toc, page_count, page_labels, has_text_layer, orientation)
- `PdfMetadata` struct (title, author, subject, keywords, creator, producer, dates)
- `PageOrientation` enum (Portrait, Landscape, Mixed)
- `PageRenderRequest` struct (page_number, scale, format, rotation)
- `ImageFormat` enum (Png, Webp, Jpeg)
- `TextLayer` struct (page_number, width, height, items)
- `TextItem` struct (text, x, y, width, height, font_size, char_positions)
- `PdfSelector` enum variants (Page, TextQuote, Region)
- `PdfRect` and `PdfPosition` structs

**`/apps/los-libros-server/src/pdf/parser.rs`**
- `PdfParser` struct using `pdfium-render`
- `from_bytes()` - load PDF from byte array
- `parse()` → `ParsedPdf` - extract metadata and structure
- `render_page()` - render page to image bytes
- `get_text_layer()` - extract positioned text items
- `extract_outline()` - convert bookmarks to `TocEntry[]`

**`/apps/los-libros-server/src/pdf/cache.rs`**
- Thread-safe LRU cache for rendered pages
- Cache key: `(book_id, page, scale, rotation, format)`
- Text layer caching

**`/apps/los-libros-server/src/routes/pdf.rs`**
- `GET /:id/pages/:page` - rendered page image
- `GET /:id/pages/:page/text` - text layer JSON
- `GET /:id/pages/:page/thumbnail` - low-res thumbnail
- `GET /:id/search` - full-text search
- `POST /:id/ocr/:page` - OCR region extraction

### Files to Modify

**`/apps/los-libros-server/Cargo.toml`**
```toml
pdfium-render = { version = "0.8", features = ["thread_safe"] }
tesseract = { version = "0.14", optional = true }
image = "0.24"

[features]
ocr-tesseract = ["tesseract"]
ocr-ollama = ["reqwest"]
```

**`/apps/los-libros-server/src/main.rs`**
- Add PDF routes to router
- Initialize PDF cache in AppState

**`/apps/los-libros-server/src/state.rs`**
- Add `pdf_cache: Arc<PdfCache>` to `AppStateInner`

---

## Phase 2: Unified Document Types

### Files to Create

**`/apps/los-libros-server/src/document/types.rs`**
```rust
/// Format-agnostic document wrapper
pub enum ParsedDocument {
    Epub(ParsedBook),
    Pdf(ParsedPdf),
}

/// Unified navigation target
pub enum DocumentLocation {
    Cfi { cfi: String },
    SpineIndex { index: usize },
    Page { page: usize, position: Option<PdfPosition> },
    Percentage { value: f32 },
}
```

### Files to Modify

**`/apps/los-libros-server/src/annotations/types.rs`**
- Add `PdfPageSelector`, `PdfTextQuoteSelector`, `PdfRegionSelector` to `Selector` enum

---

## Phase 3: Client-Side PDF Renderer

### Files to Create

**`/apps/los-libros/src/reader/renderer/document-renderer.ts`**
- `DocumentRenderer` interface (load, display, next, prev, getLocation, events)
- `DocumentRendererConfig` type (mode, theme, scale, rotation, pageLayout)
- `DocumentNavigationTarget` type (cfi, href, page, percentage)
- `DocumentLocation` type (unified location for both formats)
- `DocumentRendererEvents` type (relocated, rendered, selected, regionSelected, etc.)

**`/apps/los-libros/src/reader/renderer/pdf/pdf-renderer.ts`**
- Main `PdfRenderer` class implementing `DocumentRenderer`
- Orchestrates canvas, text, annotation layers
- Manages paginator/scroller based on display mode
- Handles WASM/server rendering selection

**`/apps/los-libros/src/reader/renderer/pdf/pdf-canvas-layer.ts`**
- Manages canvas element for page rendering
- Handles HiDPI scaling
- Rotation support

**`/apps/los-libros/src/reader/renderer/pdf/pdf-text-layer.ts`**
- Renders invisible text layer overlay
- Enables native text selection
- CSS positioning matching canvas

**`/apps/los-libros/src/reader/renderer/pdf/pdf-annotation-layer.ts`**
- SVG overlay for highlights
- Supports text and region highlights
- Click handlers for highlight interaction

**`/apps/los-libros/src/reader/renderer/pdf/pdf-selection.ts`**
- Text selection handler
- Generates `PdfSelector` from selection
- Coordinate transformation utilities

**`/apps/los-libros/src/reader/renderer/pdf/region-selection.ts`**
- Draw rectangle on canvas for region selection
- Touch and mouse support
- Emits `regionSelected` events for scanned PDFs

**`/apps/los-libros/src/reader/renderer/pdf/pdf-paginator.ts`**
- Single and dual page modes
- Page turn animations
- Horizontal scroll mode support

**`/apps/los-libros/src/reader/renderer/pdf/pdf-scroller.ts`**
- Continuous vertical scroll
- Intersection observer for lazy loading
- Virtual scrolling for performance

### Files to Modify

**`/apps/los-libros/src/reader/renderer/types.ts`**
- Add `PdfSelector`, `PdfRect` types
- Add `UnifiedSelector` union type
- Add `RegionSelection` event type

**`/apps/los-libros/src/reader/renderer/api-client.ts`**
- `getDocument(id)` - returns `ParsedDocument`
- `getPdfPage(id, page, options)` - returns page image blob
- `getPdfTextLayer(id, page)` - returns `TextLayer`
- `ocrRegion(id, page, rect)` - returns OCR result

---

## Phase 4: Display Modes

### Paginated Mode
- Single page (default)
- Dual page (book spread)
- Page turn with arrow keys/swipe
- Page number display

### Scroll Modes
- Continuous vertical scroll
- Horizontal scroll (swipe between pages)
- Lazy loading with intersection observer

### Orientation Controls
- Rotation: 0°, 90°, 180°, 270°
- Persist rotation per book
- Auto-detect landscape pages

---

## Phase 5: OCR Integration

### Files to Create

**`/apps/los-libros-server/src/ocr/mod.rs`**
```rust
pub mod types;
pub mod provider;
pub mod service;
```

**`/apps/los-libros-server/src/ocr/provider.rs`**
- `OcrProvider` trait (extract_text, name, supports_language)
- `TesseractProvider` - local OCR via tesseract crate
- `OllamaProvider` - local LLM vision (llava, bakllava models)

**`/apps/los-libros-server/src/ocr/service.rs`**
- `OcrService` orchestrator with provider registry
- Provider selection logic
- Result caching

### OCR Endpoints
- `POST /api/v1/pdf/:id/ocr/:page` - full page OCR
- `POST /api/v1/pdf/:id/ocr/:page/region` - region OCR (with rect body)

---

## Phase 6: WASM Fallback

### Files to Create

**`/packages/pdfium-wasm/Cargo.toml`**
```toml
[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"
pdfium-render = { version = "0.8", features = ["wasm"] }
```

**`/packages/pdfium-wasm/src/lib.rs`**
- `WasmPdfDocument` struct exported to JS
- `new(bytes)` - load PDF
- `page_count()` - get page count
- `render_page(index, scale)` - render to RGBA bytes
- `get_text(index)` - extract page text

**`/apps/los-libros/src/reader/renderer/pdf/wasm-fallback.ts`**
- `loadPdfiumWasm()` - dynamic WASM loader
- `WasmPdfRenderer` class
- Automatic fallback when server unavailable

**`/apps/los-libros/src/reader/renderer/pdf/pdfjs-fallback.ts`**
- PDF.js integration as last resort
- Loaded only if WASM fails

---

## Phase 7: UI Integration

### Files to Modify

**`/apps/los-libros/src/reader/components/ServerReaderContainer.svelte`**
- Detect document format (EPUB vs PDF)
- Instantiate appropriate renderer
- Add PDF-specific toolbar controls

**`/apps/los-libros/src/reader/components/SettingsPanel.svelte`**
- PDF display mode selector
- Rotation controls
- Scale/zoom controls

**`/apps/los-libros/src/reader/components/ProgressSlider.svelte`**
- Adapt for page-based navigation
- Show page numbers for PDF

---

## Critical Implementation Files

| Priority | File | Purpose |
|----------|------|---------|
| 1 | `/apps/los-libros-server/src/pdf/parser.rs` | Core PDF parsing with pdfium-render |
| 2 | `/apps/los-libros/src/reader/renderer/document-renderer.ts` | Unified renderer interface |
| 3 | `/apps/los-libros/src/reader/renderer/pdf/pdf-renderer.ts` | Main client PDF renderer |
| 4 | `/apps/los-libros-server/src/annotations/types.rs` | PDF selector extensions |
| 5 | `/apps/los-libros/src/reader/renderer/pdf/region-selection.ts` | Region highlights for scanned PDFs |
| 6 | `/apps/los-libros-server/src/ocr/provider.rs` | OCR provider abstraction |
| 7 | `/packages/pdfium-wasm/src/lib.rs` | WASM offline rendering |

---

## Dependencies to Add

### Server (Cargo.toml)
```toml
pdfium-render = { version = "0.8", features = ["thread_safe"] }
image = "0.24"
tesseract = { version = "0.14", optional = true }

[features]
default = []
ocr-tesseract = ["tesseract"]
ocr-ollama = ["reqwest"]
```

### Client (package.json)
```json
{
  "dependencies": {
    "pdfjs-dist": "^4.0.0"  // Fallback only
  }
}
```

### WASM Package
```toml
wasm-bindgen = "0.2"
wasm-pack = "0.12"  # Build tool
```

---

## Implementation Order

1. **Server PDF Module** - Parser, renderer, routes
2. **Document Abstraction** - Unified types, extend annotations
3. **Client PDF Renderer** - Canvas layer, basic navigation
4. **Text Layer** - Selection, search support
5. **Annotations** - Highlights, region selection
6. **Display Modes** - Paginator, scroller, horizontal
7. **OCR Service** - Provider pattern, endpoints
8. **WASM Fallback** - Offline rendering
9. **UI Integration** - Controls, settings
10. **Testing & Polish** - Performance, edge cases

---

## Coordinate System Notes

PDF uses two coordinate systems that must stay synced:

1. **PDF User Space**: Origin at bottom-left, 72 DPI base
2. **Page-Relative**: Normalized 0-1 coordinates, origin at top-left

Annotations store both for maximum compatibility:
```typescript
{
  userSpacePosition: { x: 100, y: 200 },  // PDF native
  relativePosition: { x: 0.15, y: 0.72 }  // Normalized
}
```

---

## Research Sources

### PDF.js (Mozilla)
- Dual-thread architecture (main + worker)
- Canvas layer + text layer + annotation layer
- TypeScript types included since v4.x
- Best practices: lazy loading, render queue, IntersectionObserver

### pdfium-render (Rust)
- Google PDFium bindings, thread-safe
- High-fidelity rendering, WASM support
- Pre-built binaries available

### Doc Doctor Patterns (Reference)
- LLM Service with multi-provider support
- Tool Orchestrator pattern for function calling
- Provider adapters for local models (Ollama)
- MCP server implementation
