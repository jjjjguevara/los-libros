# EPUB Renderer PRD — Rust-Native Implementation

**Version:** 1.0.0
**Status:** Draft
**Author:** Los Libros Team
**Date:** 2025-12-28

---

## 1. Executive Summary

This document specifies the requirements for a custom Rust-based EPUB rendering system to replace epub.js. The new implementation will provide:

1. **Server-side EPUB processing** — Rust server using `rbook` for parsing
2. **Custom CFI implementation** — Ported from JavaScript with parity tests
3. **STAM-based annotations** — Robust offset management for highlights
4. **Client-side renderer** — Lightweight TypeScript/Svelte with streaming HTML

### Why Replace epub.js?

| Issue | Impact | Root Cause |
|-------|--------|------------|
| Scroll mode stuck | Critical | CSS multi-column + continuous manager conflict |
| Unmaintained | High | Last meaningful update 2022 |
| Complex internals | High | iframe management, opaque events |
| CFI-only positioning | Medium | Fragile when document structure changes |
| No Markdown export | Medium | Requires separate parsing |

### Goals

1. **Reliability** — Eliminate scroll mode issues completely
2. **Maintainability** — Self-contained codebase with clear ownership
3. **Testability** — JS ↔ Rust parity tests for all ported components
4. **Performance** — Rust server with optional WASM for client
5. **Markdown-first** — Native export to Obsidian notes

---

## 2. Architecture

### 2.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LOS LIBROS SERVER (Rust/Axum)                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────┐ │
│  │    rbook     │  │     STAM     │  │     htmd     │  │lol_html │ │
│  │              │  │              │  │              │  │         │ │
│  │ EPUB Parsing │  │ Annotations  │  │ HTML → MD    │  │ Inject  │ │
│  │ Metadata     │  │ Offset Mgmt  │  │ Note Export  │  │ Spans   │ │
│  │ TOC/Spine    │  │ STAM JSON    │  │              │  │         │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────────┘ │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  Custom CFI  │  │   scraper    │  │       SQLite             │  │
│  │              │  │  (html5ever) │  │                          │  │
│  │ Parse/Gen    │  │              │  │ Progress, Annotations    │  │
│  │ Resolve      │  │ DOM Queries  │  │ User Preferences         │  │
│  │ Parity Tests │  │ CSS Select   │  │                          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                         REST/WebSocket API                           │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    OBSIDIAN PLUGIN (TypeScript/Svelte)              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────┐ │
│  │   Renderer   │  │  Highlight   │  │  Note Gen    │  │  Sync   │ │
│  │              │  │   Overlay    │  │              │  │ Engine  │ │
│  │ iframe +     │  │              │  │ Obsidian     │  │         │ │
│  │ Streamed     │  │ SVG Layer    │  │ API          │  │ Server  │ │
│  │ HTML         │  │ Click/Touch  │  │ Templates    │  │ ↔ Local │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────────┘ │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Optional: WASM Module                      │  │
│  │   htmd (WASM) │ CFI Resolver (WASM) │ Offline Processing     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  EPUB   │────▶│  Parse  │────▶│ Process │────▶│  Serve  │
│  File   │     │ (rbook) │     │ (htmd,  │     │ (Axum)  │
│         │     │         │     │  STAM)  │     │         │
└─────────┘     └─────────┘     └─────────┘     └─────────┘
                                                     │
                    ┌────────────────────────────────┘
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           CLIENT                                     │
│                                                                      │
│  Request:  GET /api/books/{id}/chapters/{idx}                       │
│  Response: Processed HTML with highlight injection points            │
│                                                                      │
│  Request:  POST /api/books/{id}/highlights                          │
│  Body:     { selectors: [...], color: "yellow", note: "..." }       │
│  Response: Stored annotation with STAM offsets                       │
│                                                                      │
│  Request:  GET /api/books/{id}/export/markdown                      │
│  Response: Full book or chapter as Markdown                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Specifications

### 3.1 EPUB Parser (rbook wrapper)

**Crate:** `los-libros-epub`

**Responsibilities:**
- Parse EPUB 2/3 files
- Extract metadata (title, author, publisher, ISBN, etc.)
- Parse TOC (NCX for EPUB2, NAV for EPUB3)
- Provide spine navigation
- Extract resources (images, CSS, fonts)

**API:**

```rust
pub struct ParsedBook {
    pub id: String,
    pub metadata: BookMetadata,
    pub toc: Vec<TocEntry>,
    pub spine: Vec<SpineItem>,
    pub resources: HashMap<String, ResourceInfo>,
}

pub struct BookMetadata {
    pub title: String,
    pub title_sort: Option<String>,
    pub creators: Vec<Creator>,
    pub publisher: Option<String>,
    pub language: String,
    pub identifier: Option<String>,
    pub description: Option<String>,
    pub cover_href: Option<String>,
}

pub struct TocEntry {
    pub id: String,
    pub label: String,
    pub href: String,
    pub children: Vec<TocEntry>,
}

pub struct SpineItem {
    pub id: String,
    pub href: String,
    pub media_type: String,
    pub linear: bool,
}

impl EpubParser {
    pub fn parse(data: &[u8]) -> Result<ParsedBook>;
    pub fn get_chapter_content(&self, href: &str) -> Result<String>;
    pub fn get_resource(&self, href: &str) -> Result<Vec<u8>>;
}
```

---

### 3.2 CFI Module (Custom Implementation)

**Crate:** `los-libros-cfi`

**Reference:** [EPUB CFI 1.1 Specification](https://w3c.github.io/epub-specs/epub33/epubcfi/)

**Responsibilities:**
- Parse CFI strings into structured representation
- Generate CFI from DOM positions
- Resolve CFI to text offsets
- Support range CFIs for selections
- Compare/sort CFIs

**Data Structures:**

```rust
/// Canonical Fragment Identifier
#[derive(Debug, Clone, PartialEq)]
pub struct Cfi {
    /// Path steps: /6/4!/4/2/6
    pub path: Vec<CfiStep>,
    /// Optional character offset: :15
    pub char_offset: Option<u32>,
    /// Optional temporal offset: ~23.5
    pub temporal_offset: Option<f64>,
    /// Optional spatial offset: @100:50
    pub spatial_offset: Option<SpatialOffset>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CfiStep {
    /// Step value (even = element, odd = text node)
    pub value: u32,
    /// Assertion: [type=chapter]
    pub assertion: Option<CfiAssertion>,
    /// Indirection: ! (redirect to another document)
    pub indirection: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CfiRange {
    pub start: Cfi,
    pub end: Cfi,
}

/// Assertion types
#[derive(Debug, Clone, PartialEq)]
pub enum CfiAssertion {
    Id(String),           // [id=chapter1]
    ElementType(String),  // [type=chapter]
    TextBefore(String),   // [;s=hello]
    TextAfter(String),    // [,s=world]
}

impl Cfi {
    pub fn parse(input: &str) -> Result<Self>;
    pub fn to_string(&self) -> String;
    pub fn compare(&self, other: &Self) -> Ordering;
}

/// CFI resolver - requires DOM context
pub trait CfiResolver {
    fn resolve_to_offset(&self, cfi: &Cfi) -> Result<TextOffset>;
    fn generate_from_offset(&self, offset: TextOffset) -> Result<Cfi>;
    fn generate_from_range(&self, start: TextOffset, end: TextOffset) -> Result<CfiRange>;
}

pub struct TextOffset {
    pub spine_index: usize,
    pub char_offset: usize,
    /// Fallback selectors for resilience
    pub text_before: String,
    pub text_after: String,
}
```

**Parity Test Strategy:**

```rust
#[cfg(test)]
mod cfi_parity_tests {
    use super::*;

    /// Test vectors from epub-cfi-resolver JavaScript library
    const PARITY_TEST_VECTORS: &[(&str, &str)] = &[
        // (input_cfi, expected_normalized)
        ("epubcfi(/6/4!/4/2/6:15)", "epubcfi(/6/4!/4/2/6:15)"),
        ("epubcfi(/6/14!/4/2,/2/1:0,/3:5)", "epubcfi(/6/14!/4/2,/2/1:0,/3:5)"),
        // ... more test vectors
    ];

    #[test]
    fn test_cfi_parsing_parity() {
        for (input, expected) in PARITY_TEST_VECTORS {
            let cfi = Cfi::parse(input).expect("should parse");
            assert_eq!(cfi.to_string(), *expected);
        }
    }

    #[test]
    fn test_cfi_comparison_parity() {
        // Compare results with JavaScript implementation
        // Use wasm-pack test for in-browser verification
    }
}
```

---

### 3.3 Annotation System (STAM-based)

**Crate:** `los-libros-annotations`

**Reference:** [STAM](https://github.com/annotation/stam) + [Readium Annotations](https://github.com/readium/annotations)

**Responsibilities:**
- Store highlights with multiple selector types
- Manage text offsets with STAM precision
- Serialize to Readium-compatible JSON
- Export to Markdown

**Data Structures:**

```rust
/// Annotation following W3C Web Annotation + Readium profile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Annotation {
    pub id: String,
    pub book_id: String,
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,

    /// Target with multiple selectors for resilience
    pub target: AnnotationTarget,

    /// Optional body (note content)
    pub body: Option<AnnotationBody>,

    /// Visual style
    pub highlight: HighlightStyle,
    pub color: HighlightColor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotationTarget {
    /// Source document (spine item href)
    pub source: String,

    /// Multiple selectors for fallback
    pub selectors: Vec<Selector>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Selector {
    /// EPUB CFI - primary, most precise
    #[serde(rename = "FragmentSelector")]
    Fragment {
        value: String, // CFI string
    },

    /// Text with context - most resilient
    #[serde(rename = "TextQuoteSelector")]
    TextQuote {
        exact: String,
        prefix: Option<String>,
        suffix: Option<String>,
    },

    /// Character offsets - fast lookup
    #[serde(rename = "TextPositionSelector")]
    TextPosition {
        start: usize,
        end: usize,
    },

    /// CSS selector for DOM element
    #[serde(rename = "CssSelector")]
    Css {
        value: String,
    },

    /// Percentage through resource
    #[serde(rename = "ProgressionSelector")]
    Progression {
        value: f64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotationBody {
    /// Note content (Markdown)
    pub value: String,
    pub format: String, // "text/markdown"
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HighlightStyle {
    Solid,
    Underline,
    Strikethrough,
    Outline,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HighlightColor {
    Yellow,
    Green,
    Blue,
    Pink,
    Purple,
    Orange,
}

impl Annotation {
    /// Export to Markdown for Obsidian note
    pub fn to_markdown(&self, book_title: &str) -> String;

    /// Serialize to Readium-compatible JSON
    pub fn to_readium_json(&self) -> serde_json::Value;
}
```

---

### 3.4 HTML Processor (lol_html + htmd)

**Crate:** `los-libros-html`

**Responsibilities:**
- Inject highlight spans into EPUB XHTML (streaming)
- Convert HTML to Markdown for note export
- Extract plain text for search indexing
- Sanitize content for security

**API:**

```rust
/// Inject highlights into HTML content
pub fn inject_highlights(
    html: &str,
    annotations: &[Annotation],
    config: &HighlightConfig,
) -> Result<String>;

/// Configuration for highlight injection
pub struct HighlightConfig {
    /// CSS class prefix for highlight spans
    pub class_prefix: String,
    /// Include data attributes for interactivity
    pub include_data_attrs: bool,
    /// Custom styles to inject
    pub custom_css: Option<String>,
}

/// Convert HTML to Markdown
pub fn html_to_markdown(html: &str, options: &MarkdownOptions) -> Result<String>;

pub struct MarkdownOptions {
    /// Skip these HTML tags
    pub skip_tags: Vec<String>,
    /// Heading style: ATX (#) or Setext (underline)
    pub heading_style: HeadingStyle,
    /// Include frontmatter with metadata
    pub include_frontmatter: bool,
}

/// Extract plain text for search
pub fn extract_text(html: &str) -> String;
```

---

### 3.5 Client Renderer (TypeScript/Svelte)

**Module:** `src/reader/renderer/`

**Responsibilities:**
- Render HTML content in sandboxed iframe
- Handle pagination OR continuous scroll (user choice)
- Manage text selection and highlight creation
- Coordinate with server for content streaming

**Architecture:**

```typescript
// src/reader/renderer/types.ts
export interface RendererConfig {
  mode: 'paginated' | 'scrolled';
  theme: ThemeConfig;
  typography: TypographyConfig;
}

export interface ChapterContent {
  html: string;
  highlights: HighlightOverlay[];
  nextChapter?: string;
  prevChapter?: string;
}

// src/reader/renderer/renderer.ts
export class EpubRenderer {
  private container: HTMLElement;
  private iframe: HTMLIFrameElement;
  private overlayManager: OverlayManager;

  constructor(container: HTMLElement, config: RendererConfig);

  // Content loading
  async loadChapter(chapterHref: string): Promise<void>;
  async preloadChapter(chapterHref: string): Promise<void>;

  // Navigation
  nextPage(): Promise<boolean>;
  prevPage(): Promise<boolean>;
  goToProgress(percent: number): Promise<void>;
  goToCfi(cfi: string): Promise<void>;

  // Selection handling
  onSelection(callback: (selection: TextSelection) => void): void;
  clearSelection(): void;

  // Highlight management
  addHighlightOverlay(annotation: Annotation): void;
  removeHighlightOverlay(annotationId: string): void;
  updateHighlightOverlay(annotation: Annotation): void;

  // State
  getCurrentProgress(): Progress;
  getCurrentCfi(): string;

  // Cleanup
  destroy(): void;
}

// src/reader/renderer/paginator.ts
export class Paginator {
  // CSS multi-column based pagination
  // Handles scroll mode switching
}

// src/reader/renderer/overlay.ts
export class OverlayManager {
  // SVG overlay for highlights
  // Click/touch event handling
  // Coordinate transformation
}
```

---

## 4. Testing Strategy

### 4.1 Parity Testing Framework

**Goal:** Ensure Rust implementations produce identical results to reference JavaScript libraries.

**Test Levels:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PARITY TESTING                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Level 1: Unit Tests (Rust)                                         │
│  ─────────────────────────                                          │
│  • CFI parsing/generation                                            │
│  • Annotation serialization                                          │
│  • HTML-to-Markdown conversion                                       │
│  • Test vectors from JS libraries                                    │
│                                                                      │
│  Level 2: Integration Tests (Rust + JS)                             │
│  ─────────────────────────────────────                              │
│  • Side-by-side output comparison                                    │
│  • Same input → same output                                          │
│  • Run JS in Node, Rust native, compare                             │
│                                                                      │
│  Level 3: WASM Tests (Browser)                                      │
│  ────────────────────────────                                        │
│  • Rust WASM vs JS in same browser                                  │
│  • Verify DOM-dependent behavior                                     │
│  • Use wasm-pack test with headless browser                         │
│                                                                      │
│  Level 4: End-to-End Tests                                          │
│  ────────────────────────────                                        │
│  • Real EPUB files                                                   │
│  • Full rendering pipeline                                           │
│  • Highlight creation → export flow                                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 CFI Parity Tests

**Reference Implementation:** [epub-cfi-resolver](https://github.com/fread-ink/epub-cfi-resolver)

```javascript
// tests/js/cfi-reference.js
// Run with Node.js to generate test vectors

const { parse, generate, resolve } = require('epub-cfi-resolver');

const testVectors = [
  'epubcfi(/6/4!/4/2/6:15)',
  'epubcfi(/6/14!/4/2,/2/1:0,/3:5)',
  // ... comprehensive set
];

const results = testVectors.map(cfi => ({
  input: cfi,
  parsed: parse(cfi),
  regenerated: generate(parse(cfi)),
}));

// Export as JSON for Rust tests
console.log(JSON.stringify(results, null, 2));
```

```rust
// tests/cfi_parity.rs
use los_libros_cfi::Cfi;
use serde::Deserialize;

#[derive(Deserialize)]
struct TestVector {
    input: String,
    parsed: serde_json::Value,
    regenerated: String,
}

#[test]
fn test_cfi_parity_with_js() {
    let vectors: Vec<TestVector> =
        serde_json::from_str(include_str!("fixtures/cfi-vectors.json"))
            .expect("load test vectors");

    for vector in vectors {
        let rust_cfi = Cfi::parse(&vector.input).expect("parse CFI");
        assert_eq!(rust_cfi.to_string(), vector.regenerated);

        // Compare parsed structure
        let rust_json = serde_json::to_value(&rust_cfi).unwrap();
        assert_eq!(rust_json, vector.parsed);
    }
}
```

### 4.3 HTML-to-Markdown Parity Tests

**Reference Implementation:** [turndown.js](https://github.com/mixmark-io/turndown)

```javascript
// tests/js/markdown-reference.js
const TurndownService = require('turndown');

const turndown = new TurndownService();

const testCases = [
  '<p>Simple paragraph</p>',
  '<h1>Heading</h1><p>Content</p>',
  '<ul><li>Item 1</li><li>Item 2</li></ul>',
  // ... comprehensive set from EPUB content
];

const results = testCases.map(html => ({
  input: html,
  output: turndown.turndown(html),
}));

console.log(JSON.stringify(results, null, 2));
```

```rust
// tests/markdown_parity.rs
use los_libros_html::html_to_markdown;

#[derive(Deserialize)]
struct TestVector {
    input: String,
    output: String,
}

#[test]
fn test_markdown_parity_with_turndown() {
    let vectors: Vec<TestVector> =
        serde_json::from_str(include_str!("fixtures/markdown-vectors.json"))
            .expect("load test vectors");

    for vector in vectors {
        let rust_output = html_to_markdown(&vector.input, &Default::default())
            .expect("convert to markdown");
        assert_eq!(rust_output.trim(), vector.output.trim());
    }
}
```

### 4.4 Real EPUB Test Suite

```
tests/
├── fixtures/
│   ├── epubs/
│   │   ├── moby-dick.epub          # Public domain, EPUB2
│   │   ├── childrens-literature.epub # EPUB3 with complex TOC
│   │   ├── accessible-epub.epub    # EPUB3 with accessibility
│   │   └── test-highlights.epub    # Contains pre-made highlights
│   ├── cfi-vectors.json
│   ├── markdown-vectors.json
│   └── annotation-vectors.json
├── js/
│   ├── cfi-reference.js
│   ├── markdown-reference.js
│   └── generate-vectors.sh
└── rust/
    ├── cfi_parity.rs
    ├── markdown_parity.rs
    ├── epub_parsing.rs
    └── full_pipeline.rs
```

### 4.5 Continuous Integration

```yaml
# .github/workflows/test.yml
name: Parity Tests

on: [push, pull_request]

jobs:
  generate-vectors:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: node tests/js/generate-vectors.js > tests/fixtures/vectors.json
      - uses: actions/upload-artifact@v4
        with:
          name: test-vectors
          path: tests/fixtures/

  rust-tests:
    needs: generate-vectors
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: test-vectors
          path: tests/fixtures/
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo test --all-features

  wasm-tests:
    needs: generate-vectors
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo install wasm-pack
      - run: wasm-pack test --headless --chrome
```

---

## 5. API Specification

### 5.1 Server REST API

```yaml
# OpenAPI 3.0 specification
openapi: 3.0.0
info:
  title: Los Libros Server API
  version: 1.0.0

paths:
  /api/books:
    get:
      summary: List all books
      responses:
        '200':
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/BookSummary'
    post:
      summary: Upload a new book
      requestBody:
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                file:
                  type: string
                  format: binary
      responses:
        '201':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ParsedBook'

  /api/books/{bookId}:
    get:
      summary: Get book metadata and structure
      parameters:
        - name: bookId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ParsedBook'

  /api/books/{bookId}/chapters/{chapterHref}:
    get:
      summary: Get chapter content with highlights injected
      parameters:
        - name: bookId
          in: path
          required: true
          schema:
            type: string
        - name: chapterHref
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          content:
            text/html:
              schema:
                type: string

  /api/books/{bookId}/annotations:
    get:
      summary: List annotations for a book
      responses:
        '200':
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Annotation'
    post:
      summary: Create a new annotation
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateAnnotation'
      responses:
        '201':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Annotation'

  /api/books/{bookId}/annotations/{annotationId}:
    put:
      summary: Update an annotation
    delete:
      summary: Delete an annotation

  /api/books/{bookId}/progress:
    get:
      summary: Get reading progress
    put:
      summary: Update reading progress

  /api/books/{bookId}/export/markdown:
    get:
      summary: Export book as Markdown
      parameters:
        - name: chapters
          in: query
          description: Specific chapters to export (all if omitted)
          schema:
            type: array
            items:
              type: string
        - name: includeHighlights
          in: query
          schema:
            type: boolean
            default: true
      responses:
        '200':
          content:
            text/markdown:
              schema:
                type: string

components:
  schemas:
    BookSummary:
      type: object
      properties:
        id:
          type: string
        title:
          type: string
        author:
          type: string
        coverUrl:
          type: string
        progress:
          type: number
          format: float

    ParsedBook:
      type: object
      properties:
        id:
          type: string
        metadata:
          $ref: '#/components/schemas/BookMetadata'
        toc:
          type: array
          items:
            $ref: '#/components/schemas/TocEntry'
        spine:
          type: array
          items:
            $ref: '#/components/schemas/SpineItem'

    Annotation:
      type: object
      properties:
        id:
          type: string
        bookId:
          type: string
        target:
          $ref: '#/components/schemas/AnnotationTarget'
        body:
          $ref: '#/components/schemas/AnnotationBody'
        highlight:
          type: string
          enum: [solid, underline, strikethrough, outline]
        color:
          type: string
          enum: [yellow, green, blue, pink, purple, orange]
        created:
          type: string
          format: date-time
        modified:
          type: string
          format: date-time
```

---

## 6. Migration Path

### 6.1 Phase 0: Foundation (Weeks 1-2)

- [ ] Create `apps/los-libros-server` Rust project
- [ ] Set up Axum server skeleton
- [ ] Integrate `rbook` for EPUB parsing
- [ ] Create basic REST endpoints
- [ ] Set up CI with test infrastructure

### 6.2 Phase 1: CFI Module (Weeks 3-4)

- [ ] Port epub-cfi-resolver to Rust
- [ ] Generate comprehensive test vectors
- [ ] Achieve 100% parity on parsing tests
- [ ] Implement CFI generation
- [ ] Add WASM compilation target

### 6.3 Phase 2: Annotation System (Weeks 5-6)

- [ ] Integrate STAM for offset management
- [ ] Implement Readium annotation format
- [ ] Add SQLite storage
- [ ] Create annotation CRUD endpoints
- [ ] Test with real highlight data

### 6.4 Phase 3: HTML Processing (Weeks 7-8)

- [ ] Integrate `htmd` for Markdown conversion
- [ ] Integrate `lol_html` for highlight injection
- [ ] Achieve markdown parity with turndown.js
- [ ] Implement streaming HTML responses
- [ ] Add Markdown export endpoint

### 6.5 Phase 4: Client Renderer (Weeks 9-11)

- [ ] Build lightweight TypeScript renderer
- [ ] Implement SVG highlight overlay
- [ ] Add pagination mode
- [ ] Add scroll mode
- [ ] Integrate with server API

### 6.6 Phase 5: Plugin Integration (Weeks 12-14)

- [ ] Replace epub.js in plugin
- [ ] Migrate existing highlights (CFI → multi-selector)
- [ ] Update settings UI
- [ ] Test on desktop and iPadOS
- [ ] Performance optimization

### 6.7 Phase 6: Polish & Documentation (Weeks 15-16)

- [ ] API documentation
- [ ] Migration guide for existing users
- [ ] Performance benchmarks
- [ ] Bug fixes from testing

---

## 7. Success Criteria

### 7.1 Functional Requirements

| Requirement | Metric | Target |
|-------------|--------|--------|
| EPUB 2/3 support | Format coverage | 100% |
| Scroll mode reliability | Bug reports | 0 critical |
| Highlight persistence | Data integrity | 100% |
| CFI parity | Test coverage | 100% |
| Markdown export | Format accuracy | 95%+ |

### 7.2 Performance Requirements

| Metric | Target |
|--------|--------|
| Book open time | < 500ms for typical EPUB |
| Page turn latency | < 50ms |
| Highlight render | < 16ms (60fps) |
| Markdown export | < 1s per chapter |
| Memory usage | < 100MB for 1000-page book |

### 7.3 Compatibility

| Platform | Support Level |
|----------|--------------|
| macOS (Obsidian) | Full |
| Windows (Obsidian) | Full |
| Linux (Obsidian) | Full |
| iPadOS (Obsidian) | Full |
| iOS (Obsidian) | Best effort |

---

## 8. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| CFI complexity | High | Medium | Start with parsing, add generation incrementally |
| WASM bundle size | Medium | Medium | Tree-shake, lazy load |
| epub.js migration | High | Low | Parallel operation period, rollback capability |
| Performance regression | Medium | Low | Benchmark suite, profiling |
| iPadOS scroll issues | High | Medium | Dedicated testing, CSS-only pagination fallback |

---

## 9. Design Decisions (Finalized)

### 9.1 WASM Strategy: Hybrid Offline-First

**Decision:** Full offline support via WASM, with optional server for sync.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OFFLINE-FIRST ARCHITECTURE                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    WASM Module (Always Available)            │   │
│  │                                                              │   │
│  │  • EPUB parsing (rbook compiled to WASM)                    │   │
│  │  • HTML rendering pipeline                                   │   │
│  │  • Highlight creation and storage                           │   │
│  │  • Markdown export                                          │   │
│  │  • CFI resolution                                           │   │
│  │                                                              │   │
│  │  Storage: IndexedDB + Obsidian vault files                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              │ When online                           │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Server (Optional Enhancement)             │   │
│  │                                                              │   │
│  │  • Multi-device sync                                        │   │
│  │  • OPDS catalog browsing                                    │   │
│  │  • Cloud library management                                 │   │
│  │  • Backup and restore                                       │   │
│  │                                                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Implications:**
- Plugin works immediately after install (no server setup)
- Full functionality on iPadOS
- Server enhances but never gates features
- ~2-3MB additional plugin size for WASM

---

### 9.2 Sync Strategy: Automatic Background Polling

**Decision:** Automatic polling with conflict resolution. No manual sync required.

**Sync Triggers:**
```
┌─────────────────────────────────────────────────────────────────────┐
│                         SYNC TRIGGER EVENTS                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  IMMEDIATE SYNC (debounced 2s):                                     │
│  • Highlight created                                                 │
│  • Highlight deleted                                                 │
│  • Highlight color/note changed                                      │
│  • Reading progress updated                                          │
│                                                                      │
│  PULL SYNC:                                                          │
│  • Obsidian window gains focus                                       │
│  • Book opened                                                       │
│  • Every 5 minutes while reading (configurable)                      │
│  • App startup                                                       │
│                                                                      │
│  PUSH SYNC:                                                          │
│  • Book closed                                                       │
│  • Obsidian loses focus                                              │
│  • Before app shutdown                                               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Conflict Resolution Strategy:**

```rust
/// Conflict resolution for annotations
pub enum ConflictResolution {
    /// Both versions kept, user resolves manually
    KeepBoth,
    /// Server version wins (default for deletions)
    ServerWins,
    /// Local version wins (default for content changes)
    LocalWins,
    /// Merge: combine selectors, keep latest content
    Merge,
}

/// Sync record with vector clock for ordering
pub struct SyncRecord {
    pub id: String,
    pub local_version: u64,
    pub server_version: u64,
    pub last_modified: DateTime<Utc>,
    pub device_id: String,
    pub checksum: String,
}

/// Conflict detection
impl SyncEngine {
    fn detect_conflict(&self, local: &Annotation, remote: &Annotation) -> Option<Conflict> {
        if local.checksum == remote.checksum {
            return None; // No conflict, same content
        }

        if local.server_version < remote.server_version
           && local.local_version > local.server_version {
            // Both modified since last sync
            Some(Conflict::BothModified { local, remote })
        } else {
            None
        }
    }

    fn resolve(&self, conflict: Conflict) -> Resolution {
        match conflict {
            // Highlights: merge selectors, keep richer content
            Conflict::BothModified { local, remote } => {
                Resolution::Merge {
                    selectors: merge_selectors(&local.selectors, &remote.selectors),
                    body: if local.body.len() > remote.body.len() {
                        local.body
                    } else {
                        remote.body
                    },
                    color: local.color, // Local preference wins for visual
                }
            }
        }
    }
}
```

**Offline Queue:**

```rust
/// Operations queued while offline
pub struct OfflineQueue {
    operations: Vec<QueuedOperation>,
}

pub enum QueuedOperation {
    CreateAnnotation(Annotation),
    UpdateAnnotation { id: String, changes: AnnotationPatch },
    DeleteAnnotation { id: String },
    UpdateProgress { book_id: String, progress: Progress },
}

impl OfflineQueue {
    /// Called when connection restored
    pub async fn flush(&mut self, server: &ServerClient) -> SyncResult {
        let mut results = Vec::new();

        for op in self.operations.drain(..) {
            match server.apply(op).await {
                Ok(result) => results.push(result),
                Err(Conflict(c)) => {
                    // Resolve and retry
                    let resolved = self.resolve(c);
                    server.apply(resolved).await?;
                }
            }
        }

        Ok(SyncResult { applied: results.len(), conflicts: 0 })
    }
}
```

**UI Indicators (Subtle):**

```
Reader status bar (bottom):
┌─────────────────────────────────────────────────────────────────────┐
│ Chapter 5 of 12                          ● Synced  |  45% complete  │
└─────────────────────────────────────────────────────────────────────┘

When syncing:
┌─────────────────────────────────────────────────────────────────────┐
│ Chapter 5 of 12                          ↻ Syncing |  45% complete  │
└─────────────────────────────────────────────────────────────────────┘

When offline with pending changes:
┌─────────────────────────────────────────────────────────────────────┐
│ Chapter 5 of 12                    ○ 3 pending sync |  45% complete │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 9.3 Multi-Selector System: Format-Agnostic & Extensible

**Decision:** Store multiple selectors per annotation. Designed for EPUB now, extensible to PDF later.

**Selector Architecture:**

```rust
/// Base selector trait - implemented by all formats
pub trait Selector: Send + Sync {
    /// Selector type identifier
    fn selector_type(&self) -> &'static str;

    /// Attempt to resolve to a text range in the document
    fn resolve(&self, document: &dyn Document) -> Result<TextRange, ResolveError>;

    /// Confidence score (0.0 - 1.0) for this selector
    fn confidence(&self) -> f32;

    /// Serialize to JSON
    fn to_json(&self) -> serde_json::Value;
}

/// Document abstraction - works for EPUB and PDF
pub trait Document {
    fn format(&self) -> DocumentFormat;
    fn get_text_content(&self) -> &str;
    fn get_element_by_selector(&self, css: &str) -> Option<Element>;
}

pub enum DocumentFormat {
    Epub,
    Pdf,
    // Future: Mobi, Djvu, etc.
}

/// Text range - universal across formats
pub struct TextRange {
    /// Document-specific location (spine item for EPUB, page for PDF)
    pub location: DocumentLocation,
    /// Character offset from start of location
    pub start_offset: usize,
    /// Character offset for end
    pub end_offset: usize,
    /// The actual text (for verification)
    pub text: String,
}

pub enum DocumentLocation {
    Epub { spine_index: usize, href: String },
    Pdf { page_number: usize },
}
```

**Selector Types (Prioritized):**

```rust
/// Priority 1: Format-specific precise selector
pub enum FormatSelector {
    /// EPUB: Canonical Fragment Identifier
    EpubCfi(String),

    /// PDF: Page + bounding box coordinates
    PdfPosition {
        page: usize,
        bbox: BoundingBox,  // x, y, width, height in points
    },
}

/// Priority 2: Text quote with context (works for ALL formats)
pub struct TextQuoteSelector {
    pub exact: String,
    pub prefix: Option<String>,  // ~30 chars before
    pub suffix: Option<String>,  // ~30 chars after
}

/// Priority 3: Character position (fast but fragile)
pub struct TextPositionSelector {
    pub start: usize,
    pub end: usize,
}

/// Priority 4: Progression (percentage through document)
pub struct ProgressionSelector {
    pub value: f64,  // 0.0 - 1.0
}

/// Full annotation target with multiple selectors
pub struct AnnotationTarget {
    /// Source document identifier
    pub source: String,

    /// Multiple selectors in priority order
    pub selectors: Vec<Box<dyn Selector>>,
}

impl AnnotationTarget {
    /// Resolve using first successful selector
    pub fn resolve(&self, document: &dyn Document) -> Result<TextRange, ResolveError> {
        let mut last_error = None;

        for selector in &self.selectors {
            match selector.resolve(document) {
                Ok(range) => {
                    // Verify text matches (for TextQuote)
                    if self.verify_text(&range) {
                        return Ok(range);
                    }
                }
                Err(e) => last_error = Some(e),
            }
        }

        Err(last_error.unwrap_or(ResolveError::NoSelectorsMatched))
    }

    /// Generate all applicable selectors for a selection
    pub fn from_selection(
        document: &dyn Document,
        range: &TextRange,
    ) -> Self {
        let mut selectors: Vec<Box<dyn Selector>> = Vec::new();

        // Add format-specific selector
        match document.format() {
            DocumentFormat::Epub => {
                if let Some(cfi) = generate_cfi(document, range) {
                    selectors.push(Box::new(EpubCfiSelector(cfi)));
                }
            }
            DocumentFormat::Pdf => {
                if let Some(bbox) = get_bounding_box(document, range) {
                    selectors.push(Box::new(PdfPositionSelector {
                        page: range.location.page(),
                        bbox,
                    }));
                }
            }
        }

        // Add universal selectors (work for all formats)
        selectors.push(Box::new(TextQuoteSelector::from_range(document, range)));
        selectors.push(Box::new(TextPositionSelector::from_range(range)));
        selectors.push(Box::new(ProgressionSelector::from_range(document, range)));

        Self {
            source: document.identifier().to_string(),
            selectors,
        }
    }
}
```

**JSON Serialization (Readium-compatible):**

```json
{
  "target": {
    "source": "chapter3.xhtml",
    "selector": [
      {
        "type": "FragmentSelector",
        "conformsTo": "http://www.idpf.org/epub/linking/cfi/epub-cfi.html",
        "value": "epubcfi(/6/14!/4/2/6:0,/6/14!/4/2/6:45)"
      },
      {
        "type": "TextQuoteSelector",
        "exact": "The quick brown fox jumps over the lazy dog",
        "prefix": "example sentence: ",
        "suffix": ". This demonstrates"
      },
      {
        "type": "TextPositionSelector",
        "start": 1234,
        "end": 1278
      },
      {
        "type": "ProgressionSelector",
        "value": 0.234
      }
    ]
  }
}
```

**PDF Extension (Future):**

```json
{
  "target": {
    "source": "document.pdf",
    "selector": [
      {
        "type": "PdfPageSelector",
        "page": 42,
        "boundingBox": {
          "x": 72,
          "y": 500,
          "width": 400,
          "height": 14
        }
      },
      {
        "type": "TextQuoteSelector",
        "exact": "The quick brown fox",
        "prefix": "...",
        "suffix": "..."
      }
    ]
  }
}
```

---

### 9.4 Legacy Migration: Clean Slate

**Decision:** No migration from epub.js highlights. Clean implementation.

**Rationale:**
- Plugin is experimental/WIP, not in production
- Clean slate avoids legacy format contamination
- Simpler implementation without migration code
- Users can re-create highlights as they re-read

**Data Handling:**
```rust
// Old epub.js highlights in plugin data are ignored
// New system uses completely separate storage

pub struct AnnotationStore {
    /// New multi-selector annotations
    annotations: HashMap<String, Annotation>,

    // No migration from old format
    // Old data preserved but not read
}
```

---

## Appendix A: Reference Implementations

| Component | Reference | License |
|-----------|-----------|---------|
| CFI | [epub-cfi-resolver](https://github.com/fread-ink/epub-cfi-resolver) | MIT |
| Markdown | [turndown.js](https://github.com/mixmark-io/turndown) | MIT |
| Annotations | [Readium annotations](https://github.com/readium/annotations) | BSD |
| Rendering | [foliate-js](https://github.com/johnfactotum/foliate-js) | GPL-3.0 |

---

## Appendix B: File Structure

```
los-libros/
├── apps/
│   ├── los-libros/              # Obsidian plugin (existing)
│   │   └── src/
│   │       └── reader/
│   │           └── renderer/    # New lightweight renderer
│   └── los-libros-server/       # New Rust server
│       ├── Cargo.toml
│       ├── src/
│       │   ├── main.rs
│       │   ├── routes/
│       │   ├── epub/            # rbook wrapper
│       │   ├── cfi/             # Custom CFI module
│       │   ├── annotations/     # STAM-based
│       │   └── html/            # lol_html + htmd
│       └── tests/
│           ├── fixtures/
│           └── parity/
├── packages/
│   ├── cfi-wasm/                # Optional WASM build
│   └── test-vectors/            # Shared test data
└── docs/
    └── requirements/
        ├── reader-PRD.md
        └── epub-renderer-PRD.md  # This document
```
