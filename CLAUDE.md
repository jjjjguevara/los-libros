# CLAUDE.md - Amnesia Development Guide

> This document captures learnings, patterns, and best practices from debugging sessions with Claude Code.

## Project Overview

Amnesia is an Obsidian plugin for reading EPUBs and PDFs. The plugin uses:
- **Svelte** for UI components
- **Shadow DOM** for isolated EPUB rendering
- **CSS Multi-Column Layout** for paginated reading
- **Transform-based navigation** for smooth page turns

## Key Files

| File | Purpose |
|------|---------|
| `apps/amnesia/src/reader/navigator/paginated-navigator.ts` | Core pagination logic, column calculation, navigation |
| `apps/amnesia/src/reader/shadow-dom-renderer.ts` | Shadow DOM content loading, mode switching |
| `apps/amnesia/src/reader/shadow-dom-view.ts` | Container management, CSS variables |
| `apps/amnesia/src/main.ts` | Plugin entry point, service initialization |
| `apps/amnesia/src/settings/settings.ts` | Plugin settings interface and defaults |
| `apps/amnesia/src/settings/settings-tab/` | Tabbed settings UI (Library, Reading, Sync, Notes, Advanced) |
| `apps/amnesia/src/settings/templates-settings-tab.ts` | Liquid template configuration for note generation |

## PDF Rendering Architecture

### Pipeline Overview

```
User Input → Camera Update → Debounce → Visibility Calc → Tile Queue → MuPDF Worker → Cache → Canvas
     │            │              │             │              │            │           │        │
     │            │              │             │              │            │           │        │
  Wheel/     Immediate      32ms scroll   Uses camera    Priority     WASM render  3-tier    Bitmap
  Pinch      transform      150ms zoom    snapshot       sorted       to Blob      L1/L2/L3  display
```

### Key Files (PDF)

| File | Purpose |
|------|---------|
| `pdf-infinite-canvas.ts` | Main canvas with pan/zoom, render orchestration |
| `render-coordinator.ts` | Request deduplication, concurrency limiting, mode dispatch |
| `scroll-strategy.ts` | Velocity-based prefetching, speed zones, adaptive lookahead |
| `tile-cache-manager.ts` | 3-tier cache (L1=hot, L2=warm, L3=cold), eviction policies |
| `mupdf-worker.ts` | Web Worker for MuPDF WASM rendering |

### Critical Optimization Patterns

**What Works:**
- **Camera Snapshot**: Capture camera position at schedule time, not render time. During fast scroll, camera moves 100s of pixels during debounce—using current position causes "0 visible tiles".
- **Velocity-Based Prefetch**: 4 speed zones (stationary/slow/medium/fast) with adaptive lookahead (1x-4x viewport). Reduces quality during fast scroll to maintain smoothness.
- **Priority Rendering**: Tiles closest to viewport get priority 0 (critical), further tiles get 1-3. Prevents distant tiles from blocking visible content.
- **32ms Scroll Debounce**: Fast enough to feel responsive, slow enough to batch renders. Zoom uses 150ms.

**Deadends (Don't Repeat):**
- ❌ **Using current camera in debounced render**: Causes coordinate desync—camera has moved past page layouts by render time.
- ❌ **Synthetic wheel events for testing**: Browser interprets them as zoom gestures, not scroll. Use actual trackpad or structured lifecycle tests.
- ❌ **Full-page rendering at high zoom**: At zoom >4x, full pages become massive (9600×12800px). Use tiling instead—only visible portions need rendering.
- ❌ **Scale caps below zoom×pixelRatio**: At zoom 8x on Retina (pixelRatio=2), need scale 16 minimum. Caps at 8x cause visible blur.

### Tiling Strategy

```
Zoom Level    Strategy         Rationale
──────────────────────────────────────────────────
< 1.5x        Full page        Few pixels, fast render
1.5x - 4x     Conditional      Depends on page size
> 4x          Always tile      Visible area is tiny fraction of page
```

Tile size: 256×256 CSS pixels (scaled by zoom×pixelRatio for crisp rendering).

### Speed Zones

| Zone | Velocity | Lookahead | Quality | Use Case |
|------|----------|-----------|---------|----------|
| stationary | <50 | 1.0x | 100% | Reading, stopped |
| slow | 50-200 | 1.5x | 90% | Browsing |
| medium | 200-500 | 2.5x | 75% | Scrolling |
| fast | >500 | 4.0x | 50% | Fast flick |

### Testing via MCP

```javascript
// Run lifecycle tests
await window.pdfLifecycleTests.runTest('scrollStress');
await window.pdfLifecycleTests.runTest('zoomTransitions');

// Check telemetry
window.pdfLifecycleTests.getTelemetry();

// Capture comparison screenshot
await window.pdfLifecycleTests.captureComparisonScreenshot(18, 16);
```

## Build & Deploy

```bash
# Build the plugin
npm run build

# The built file goes to:
# apps/amnesia/temp/vault/.obsidian/plugins/amnesia/main.js

# IMPORTANT: Copy to actual vault for testing
cp apps/amnesia/temp/vault/.obsidian/plugins/amnesia/main.js \
   "/path/to/your/vault/.obsidian/plugins/amnesia/main.js"
```

## Obsidian DevTools MCP Usage

The Obsidian DevTools MCP server is essential for live debugging:

### Connection

```javascript
// Always connect first
mcp__obsidian-devtools__obsidian_connect()

// Get vault info to find the correct plugin path
mcp__obsidian-devtools__obsidian_get_vault_info()
```

### Accessing the Reader

```javascript
// The reader is nested in Svelte component context
(function() {
  const leaves = app.workspace.getLeavesOfType('amnesia-reader');
  const view = leaves[0]?.view;
  const component = view.component;
  const ctx = component.$$.ctx;

  // Reader is typically at index 3 in Svelte context
  const reader = ctx[3];
  const navigator = reader?.navigator;

  return { navigator, reader };
})();
```

### Live CSS Manipulation

Test fixes on the DOM before modifying code:

```javascript
(function() {
  const leaves = app.workspace.getLeavesOfType('amnesia-reader');
  const view = leaves[0].view;
  const contentEl = view.contentEl;

  // Find Shadow DOM
  let shadowRoot = null;
  for (const el of contentEl.querySelectorAll('*')) {
    if (el.shadowRoot) {
      shadowRoot = el.shadowRoot;
      break;
    }
  }

  // Manipulate elements
  const chapters = shadowRoot.querySelectorAll('.epub-chapter');
  for (const ch of chapters) {
    ch.style.someProperty = 'newValue';
  }
})();
```

### Navigation Testing

```javascript
(async function() {
  const leaves = app.workspace.getLeavesOfType('amnesia-reader');
  const view = leaves[0].view;
  const ctx = view.component.$$.ctx;
  const nav = ctx[3].navigator;

  // Navigate to specific chapter
  await nav.goTo({ type: 'position', position: 50 });

  // Test next/prev
  await nav.next();
  await nav.prev();

  return {
    currentColumn: nav.currentColumn,
    currentSpineIndex: nav.currentSpineIndex
  };
})();
```

### Checking Console Logs

```javascript
mcp__obsidian-devtools__obsidian_get_console_logs({ level: 'error', limit: 20 })
mcp__obsidian-devtools__obsidian_get_console_logs({ level: 'all', limit: 50 })
```

### Reloading Plugin

```javascript
mcp__obsidian-devtools__obsidian_reload_plugin({ pluginId: 'amnesia' })
```

## CSS Multi-Column Layout Pitfalls

### The `scrollWidth` Trap

**Problem**: `scrollWidth` returns the container width, NOT the content extent.

```javascript
// WRONG: This returns container width, not content width
const columns = Math.ceil(element.scrollWidth / columnWidth);

// When you set width to 14000px with column-width: 586px,
// scrollWidth returns 14000px, NOT the actual content extent
```

**Solution**: Measure actual content positions:

```javascript
// CORRECT: Count unique column positions of content elements
function measureActualColumnCount(chapterEl, containerWidth) {
  const elements = chapterEl.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
  const chapterRect = chapterEl.getBoundingClientRect();
  const columnPositions = new Set();

  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) continue;
    const relativeLeft = rect.left - chapterRect.left;
    const columnIndex = Math.round(relativeLeft / containerWidth);
    columnPositions.add(columnIndex);
  }

  return Math.max(1, columnPositions.size);
}
```

### Column Width Formula

For N columns with gap between them:

```javascript
width = N * columnWidth + (N - 1) * gap
// Example: 5 columns, 586px width, 60px gap
// width = 5 * 586 + 4 * 60 = 2930 + 240 = 3170px
```

### Absolute Positioning and Padding

**Problem**: Absolutely positioned elements ignore container padding.

```css
/* Container has padding: 40px */
.container {
  padding: 40px 0px;
}

/* Child with top: 0 is at container's top edge, NOT after padding */
.chapter {
  position: absolute;
  top: 0; /* This ignores the 40px padding! */
}
```

**Solution**: Explicitly offset by the margin:

```javascript
chapterEl.style.top = `${effectiveMargin}px`;
```

### Two-Phase Column Measurement

The correct approach for measuring columns:

**Phase 1**: Use `column-width` to let browser flow content naturally:
```javascript
chapterEl.style.columnWidth = '586px';
chapterEl.style.width = '10000px'; // Large width as buffer
```

**Phase 2**: After DOM insertion, measure actual content and lock with `column-count`:
```javascript
requestAnimationFrame(() => {
  const actualColumns = measureActualColumnCount(chapterEl, containerWidth);
  chapterEl.style.columnWidth = ''; // Remove
  chapterEl.style.columnCount = String(actualColumns);
  chapterEl.style.width = calculateWidth(actualColumns);
});
```

## Debugging Patterns

### Symptom: Blank Pages When Navigating

**Cause**: Column count over-estimation creates gaps between chapters.

**Diagnosis**:
1. Check chapter widths - are they much larger than content needs?
2. Compare CSS `column-count` vs actual content columns
3. Look for gaps between chapter positions

```javascript
// Diagnostic: Check chapter column counts
const chapters = shadowRoot.querySelectorAll('.epub-chapter');
for (const ch of chapters) {
  const style = getComputedStyle(ch);
  const cssColumns = parseInt(style.columnCount);
  const actualColumns = measureActualColumnCount(ch, 646);
  console.log(`CSS: ${cssColumns}, Actual: ${actualColumns}, Ratio: ${cssColumns/actualColumns}`);
}
```

### Symptom: Content Missing Top/Bottom Margin

**Cause**: Absolute positioning ignores container padding.

**Diagnosis**:
1. Check chapter `top` value - is it 0?
2. Check container padding values
3. Check chapter height calculation

### Symptom: Transform Drift

**Cause**: Column offsets not matching actual layout.

**Diagnosis**:
```javascript
// Check transform vs expected position
const pageWidth = 646;
const expectedTransform = -(currentColumn * pageWidth);
const actualTransform = parseFloat(container.style.transform.match(/-?\d+/)[0]);
const drift = actualTransform - expectedTransform;
console.log(`Drift: ${drift}px`);
```

## Code Patterns

### Safe Chapter Element Access

```javascript
const chapterEl = this.chapterElements.get(index);
if (!chapterEl) return;
```

### Consistent Dimension Calculation

```javascript
// Always use integer dimensions to prevent sub-pixel drift
const { width, height } = this.getIntegerDimensions();

private getIntegerDimensions(): { width: number; height: number } {
  const rect = this.container.parentElement.getBoundingClientRect();
  return {
    width: Math.floor(rect.width),
    height: Math.floor(rect.height),
  };
}
```

### Animation Lock Pattern

```javascript
if (this.isAnimating) {
  // Queue update for later
  this.pendingUpdates.set(index, value);
  return;
}

// Apply update immediately
this.applyUpdate(index, value);
```

## Common Mistakes

### 1. Deploying to Wrong Location

Build output goes to `temp/vault/` but Obsidian loads from your actual vault's plugins folder. Always copy after build.

### 2. Using `column-width` Without Measurement

Setting `column-width` lets the browser decide column count, but you must measure the actual result before assuming a specific count.

### 3. Trusting `scrollWidth`

`scrollWidth` returns the element's box width, not how far content actually extends. For multi-column layouts, this is especially misleading.

### 4. Forgetting `requestAnimationFrame`

DOM measurements after modifications must wait for a frame:

```javascript
// WRONG: Measuring immediately
element.style.width = '1000px';
const width = element.scrollWidth; // May return old value

// CORRECT: Wait for frame
element.style.width = '1000px';
requestAnimationFrame(() => {
  const width = element.scrollWidth;
});
```

### 5. Not Checking Element Connection

```javascript
requestAnimationFrame(() => {
  if (!chapterEl.isConnected) return; // Element was removed
  // Safe to proceed
});
```

## Performance Considerations

### Chapter Virtualization

Only 5-7 chapters are loaded at any time:
- Current chapter
- ±2-3 chapters in each direction

Chapters outside this window become placeholders.

### Layout Batching

During animations, layout updates are queued and applied after animation completes to prevent jank.

### Column Measurement Caching

Once a chapter's column count is accurately measured, it's cached in `accurateColumnCounts` to avoid re-measurement.

## Testing Checklist

Before deploying pagination changes:

- [ ] Navigate forward 50+ pages - no blank pages
- [ ] Navigate backward 30+ pages - no drift
- [ ] Jump via ToC, then navigate - position accurate
- [ ] Switch reading mode (scrolled/paginated) - no errors
- [ ] Resize window - layout recalculates correctly
- [ ] Check margins in both modes match

## Collaboration Tips

### When Describing Bugs

Be specific about the visual symptom:
- "Text drifts right" vs "Transform value is wrong"
- "Blank pages at chapter end" vs "Column count mismatch"

### When Testing Fixes

1. First test with live CSS manipulation
2. Verify the fix works visually
3. Only then modify the TypeScript code
4. Build, copy to vault, reload plugin
5. Test again to confirm

### Using Screenshots

Obsidian DevTools can capture screenshots:
```javascript
mcp__obsidian-devtools__obsidian_capture_screenshot({ format: 'png' })
```

## Version History

| Version | Change |
|---------|--------|
| 0.5.0 (2026-01-08) | **Ecosystem Expansion**: Complete implementation of M0-M7 milestones. **M0**: Code cleanup, Nunjucks consolidation, -2,770 LOC. **M1**: Event system, `window.Amnesia` API, Doc Doctor bridge. **M2**: Unified Annotations (12 types), `@amnesia/shared-types` package. **M3**: Bidirectional highlight↔stub sync, conflict resolution. **M4**: HUD enhancements, book health integration, Source/Live mode foundation. **M5**: E2E test suite, performance benchmarks, MCP test harness, sync telemetry. **M6**: FTS5 index for Calibre (50x faster search), lazy-load sql.js, incremental sync. **M7**: Server-side FTS5 search, bibliography generation (BibTeX/APA/MLA/Chicago/IEEE), annotation extraction API (stub). |
| 0.4.1 (2026-01-08) | **PDF Scroll Performance Fix**: Fixed "0 visible tiles" during continuous scroll via camera snapshot; velocity-based adaptive prefetching with 4 speed zones; priority-based tile rendering (critical/high/medium/low); lifecycle test suite with 7 scenarios for MCP validation |
| 0.4.0 (2026-01-07) | **PDF Rendering Optimization & HUD Feature**: Dual-resolution rendering (never show blank pages), spatial prefetching for grid modes, seamless mode transitions with cache preservation, background thumbnail generation. New HUD (Heads-Up Display) with Doc Doctor integration: status bar metrics, 5 tabbed views (Reading, Library, Stats, Server, Series), context-aware display, reading streaks and activity sparklines |
| 0.3.1 (2026-01-06) | Fixed PDF scroll/zoom in vertical-scroll and horizontal-scroll modes: resolved parent wheel handler conflict that caused unintended page navigation during scroll gestures |
| 0.3.0 (2026-01-04) | Calibre bidirectional sync (read/write API), advanced query API, library statistics, single-note sync command |
| 0.2.2 (2026-01-03) | Restructured settings UI: 5 tabs (Library, Reading, Sync, Notes, Advanced), integrated Liquid templates for note generation, added metadata mapping settings |
| 0.2.1 (2026-01-02) | Fixed column count over-estimation (4x → accurate), fixed vertical margins |

---

## Deferred Work (Post v0.5.0)

The following features from the Ecosystem Expansion PRD are deferred to future releases:

### Document Enhancement (PRD Phase 1)
| Feature | Description | Complexity |
|---------|-------------|------------|
| Ghost ToC Generator | Generate missing ToC from PDF font/position analysis + AI refinement | High |
| Semantic Figure Extraction | Extract figures (vector/raster) with caption association | Very High |
| Table Structure Recognition | Reconstruct table grids into Markdown/CSV | High |
| Footnote Consolidation | Consolidate scattered footnotes | Medium |

### Reading Intelligence (PRD Phase 2)
| Feature | Description | Complexity |
|---------|-------------|------------|
| Virtual Gaze Tracking | Mouse-Scroll-Dwell (MSD) model for attention tracking | High |
| Cognitive Load Detection | Scroll oscillation patterns for confusion detection | High |
| Active Readometer | Semantic progress metric (read vs skimmed) | Medium |
| Full Velocity Heatmap | Scrollbar overlay with WPM-based coloring | Low |

### Cross-Document Intelligence (PRD Phase 4)
| Feature | Description | Complexity |
|---------|-------------|------------|
| Citation Graph Spider | Visualize citation lineage with Cytoscape.js | Very High |
| Semantic Diff | Embedding-based version comparison | High |
| Ghost Linker NER | Auto-link PDF text to vault notes via NER | High |
| Cross-Book Contradictions | Find contradicting claims across books | High |

### AI-Powered Features (PRD Phase 5)
| Feature | Description | Complexity |
|---------|-------------|------------|
| Adversarial Reading Agent | Fallacy detection with Chain of Verification | Medium |
| Local RAG Oracle | LanceDB + transformers.js for privacy-preserving RAG | Very High |
| Claim Verification | Identify unsupported empirical claims | Medium |
| Argument Mining | Extract claims, evidence, counterpoints | High |

### UI/UX Enhancements (PRD Phase 6)
| Feature | Description | Complexity |
|---------|-------------|------------|
| Liquid Canvas | LiquidText-style tear-out excerpts | High |
| Semantic Scrollbar | Multi-layer heatmap rail visualization | Medium |
| Full Source/Live Mode | Complete toggle implementation with all features | Medium |

### Obsidian Deep Integration (PRD Phase 7)
| Feature | Description | Complexity |
|---------|-------------|------------|
| Virtual File Proxy | Expose PDFs to Dataview as virtual .md files | Very High |
| Graph View Injection | Add Ghost Nodes to Obsidian Graph View | High |
| Full Dataview Integration | Query PDF contents via Dataview | High |

### Dictionary Manager (PRD Phase 8)
| Feature | Description | Complexity |
|---------|-------------|------------|
| Dictionary Service | 3-tier cache (Memory/IndexedDB/Filesystem) | Medium |
| Multi-Provider API | Free Dictionary, Wiktionary, Merriam-Webster | Medium |
| Tooltip UI | Inline word definition popup | Low |
| Smart Connections Linking | Auto-link definitions to semantic search | Medium |

### External Integrations (Deferred)
- Semantic Scholar API integration
- GROBID Docker sidecar for citation extraction
- Zotero/Readwise sync
- Docling for advanced table extraction

### M7 Incomplete Items
- **PDF Annotation Extraction**: Currently a stub. Full implementation requires MuPDF Rust binding updates to expose annotation enumeration APIs. The API contract is defined and endpoints exist.
