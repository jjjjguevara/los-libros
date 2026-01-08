

## 1. Executive Summary

This initiative proposes replacing all engines with **MuPDF**. By wrapping MuPDF in Rust (server) and compiling it to WebAssembly (client), Amnesia will achieve "render parity," pixel-perfect vector accuracy, and advanced features like Semantic Text Extraction and Mobile Reflow, utilizing the project's existing open-source status to leverage the AGPL license.

---

## 2. Strategic Features Specification

### 2.1 Feature: Unified "Polyglot" Renderer

**Requirement:** A single rendering pathway for PDF, EPUB, CBZ, and XPS.

* **Current State:** `epub-rs` (EPUB) + `pdfium` (PDF) + No support for Comics.
* **MuPDF Implementation:**
* Use `mutool`/`libmupdf` to parse all supported mime-types.
* **Benefit:** Zero-cost support for CBZ/CBR (Manga) and XPS.
* **Technical Metric:** Reduce backend dependency count by 2 (remove `pdfium-render` and `epub-rs` eventually).



### 2.2 Feature: Structured Text Extraction (Smart Copy)

**Requirement:** Extract text with semantic awareness (Headers, Paragraphs, Columns) for Obsidian pasting.

* **Current State:** Linear text dumping (loses formatting).
* **MuPDF Implementation:**
* Utilize the `stext` (Structured Text) device.
* **Logic:** Iterate `Page` -> `Block` -> `Line` -> `Span`.
* **Heuristic:**
* If `span.font.name` contains "Bold", apply Markdown `**`.
* If `span.font.size` > `body_text_avg * 1.2`, apply Markdown `##`.


* **Output:** Returns valid Markdown string instead of plain text.



### 2.3 Feature: Display List "Smart" Dark Mode

**Requirement:** Invert text and background colors without inverting images or diagrams.

* **Current State:** CSS `filter: invert(1)` (inverts images, causing "x-ray" effect on photos).
* **MuPDF Implementation:**
* Intercept the **Display List** (vector instructions) before rasterization.
* **Algorithm:**
* Set background rects to `#1e1e1e` (Obsidian Dark).
* Set text/stroke colors to `#dcddde` (Obsidian Light).
* **CRITICAL:** Leave `IMAGE` and `SHADE` objects untouched.




* **Benefit:** Medical/Scientific papers remain readable; charts preserve color coding.

### 2.4 Feature: Mobile Reflow (HTML Output)

**Requirement:** Convert static PDF layouts into responsive HTML for iPhone/iPad Mini reading.

* **Current State:** Pinch-and-zoom only.
* **MuPDF Implementation:**
* Expose `mutool draw -F html` functionality via WASM.
* **User Flow:** User clicks "Reader View" icon -> WASM generates temporary HTML blob -> Render in Shadow DOM (reusing existing EPUB styling).



### 2.5 Feature: Permanent OCR Injection

**Requirement:** Embed OCR text layers back into the source file.

* **Current State:** OCR data stored in SQLite; source file remains an image.
* **MuPDF Implementation:**
* Accept hOCR/JSON output from Tesseract/Ollama.
* Use MuPDF PDF device to overlay invisible text glyphs over the image.
* **Save:** Perform an "Incremental Save" to S3 (efficient append).



---

## 3. Technical Architecture

### 3.1 Server-Side (Rust/Axum)

* **Library:** Replace `pdfium-render` with `mupdf` (Rust bindings via FFI).
* **Threading:** MuPDF `fz_context` is not thread-safe by default.
* *Strategy:* Use a connection pool of `fz_context` instances (similar to a DB pool) to handle concurrent HTTP requests in Axum.



### 3.2 Client-Side (Obsidian Plugin)

* **Compilation:** Custom build of `libmupdf` to `wasm32-unknown-emscripten`.
* **Worker Strategy:** Run MuPDF WASM inside a **Web Worker** to prevent blocking the Obsidian UI thread (Main Thread).
* **Rendering Loop:**
1. Main thread requests Page 5.
2. Worker renders Page 5 to an `OffscreenCanvas` or `SharedArrayBuffer`.
3. Worker transfers buffer to Main thread.
4. Main thread paints to `<canvas>`.


## Metrics

| Metric | Current (PDFium/PDF.js) | Target (MuPDF) | Success Criteria |
| --- | --- | --- | --- |
| **Time to First Paint (1080p)** | ~150ms | **<50ms** | Instant feel on page turn. |
| **Mobile Zoom Clarity** | Blurry during render | **Sharp** | Sub-pixel anti-aliasing on iPad Retina. |
| **Cold Start (Plugin Load)** | ~200ms | **~500ms** | Acceptable regression due to WASM load. |
| **Search Speed (100pg)** | ~2.0s | **<0.5s** | Native C-speed string search. |








