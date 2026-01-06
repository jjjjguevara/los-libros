# Amnesia

An ebook reader plugin for Obsidian with OPDS support, highlights, and PDF rendering.

## Features

- **EPUB & PDF Support**: Read EPUBs and PDFs directly in Obsidian
- **OPDS Integration**: Connect to OPDS catalogs (Calibre, etc.)
- **Highlights & Annotations**: Create and sync highlights across your library
- **Multiple Reading Modes**: Paginated, vertical scroll, horizontal scroll, auto-grid, and canvas modes
- **Calibre Sync**: Bidirectional sync with Calibre libraries
- **Liquid Templates**: Customizable note generation from highlights

## Installation

1. Download the latest release
2. Extract to your vault's `.obsidian/plugins/amnesia/` directory
3. Enable the plugin in Obsidian settings

## PDF Rendering

The plugin includes a server-based PDF renderer with:
- Smooth pan and zoom (pinch-to-zoom and Cmd+scroll)
- Multiple display modes (paginated, scroll, canvas)
- Text selection and highlighting
- Region selection for scanned PDFs

## Version History

### 0.3.1 (2026-01-05)
- Fixed PDF scroll behavior in vertical/horizontal scroll modes (wheel events were incorrectly triggering page navigation)
- Re-enabled pinch-to-zoom and Cmd+scroll zoom gestures

### 0.3.0 (2026-01-04)
- Calibre bidirectional sync (read/write API)
- Advanced query API
- Library statistics
- Single-note sync command

### 0.2.2 (2026-01-03)
- Restructured settings UI: 5 tabs (Library, Reading, Sync, Notes, Advanced)
- Integrated Liquid templates for note generation
- Added metadata mapping settings

## Development

```bash
# Install dependencies
pnpm install

# Development build (watches for changes)
pnpm run dev

# Production build
pnpm run build

# Run tests
pnpm test
```

## License

MIT
