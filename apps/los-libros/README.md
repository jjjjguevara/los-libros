# Los Libros

A comprehensive EPUB reader plugin for [Obsidian](https://obsidian.md) with advanced highlighting, annotation, and library management features.

## Features

### Reader

- **Display Modes**: Paginated or continuous scroll reading
- **Column Layout**: Single or dual-column (spreads) with auto-detection
- **Typography**: Configurable font size (12-24px), font family, line height, text alignment
- **Navigation**: Chapter-based TOC, CFI location tracking, page indicators
- **Gestures**: Momentum-based page turning, swipe navigation, scroll snapping
- **Auto-Scroll**: 10-speed auto-scroll with pause/resume for speed reading

### Themes

7 built-in themes with Obsidian integration:
- System (follows Obsidian)
- Light
- Dark
- Sepia
- Night (OLED-friendly)
- Paper
- Forest

Custom theme support with configurable background and link colors.

### Highlights

- **6 Colors**: Yellow, green, blue, pink, purple, orange
- **Annotations**: Rich text notes attached to highlights
- **Robust Anchoring**: W3C Web Annotation selectors with fallback chain:
  1. CFI (EPUB Canonical Fragment Identifier)
  2. TextQuote with prefix/suffix context
  3. TextPosition by character offset
- **Persistence**: Highlights survive content changes and reflow
- **Export**: Atomic highlight notes (individual files) or hub aggregation (all per book)

### Bookmarks & Notes

- **Bookmarks**: Named bookmarks at any location with quick toggle
- **Reading Notes**: Page-level notes with tags and optional highlight linkage
- **Organization**: Chapter grouping, search, filter by color/tags

### Book Sidebar

- Real-time display of highlights, bookmarks, and notes for active book
- Click-to-navigate to any annotation
- Search and filter capabilities
- Expand/collapse chapter groups

### Library Management

- **Auto-Discovery**: Scan vault folders for EPUB files
- **Metadata Extraction**: Title, author, cover, description, series, ISBN
- **Reading Progress**: Track current location, percentage, and status
- **Filtering**: By status (reading, completed, abandoned), author, series, tags

### Calibre Integration

- **Connection Modes**: Local database (metadata.db) or Content Server
- **Bidirectional Sync**: Sync reading progress, ratings, tags, and highlights
- **Index Generation**: Auto-generate author, series, and shelf indexes
- **Cover Management**: Extract and copy covers to vault

### OPDS Catalog

- Browse OPDS catalogs for book discovery
- Search integration
- Direct download support

### Image Browser

- Extract and view images from EPUBs
- Grid/list display with thumbnails
- Save images to vault

### Offline Mode (WASM)

- **Rust-based EPUB Processor**: Full offline reading without server
- **Hybrid Mode**: Server preference with automatic WASM fallback
- **Features**: Book parsing, chapter extraction, search indexing, CFI operations

### Sync

- Background automatic sync with configurable interval
- Multi-device support with device ID tracking
- Conflict resolution strategies (local-wins, remote-wins, last-write-wins)
- Offline queue with retry logic

### File System Architecture

Advanced file handling with security-first design:

- **Security Hardening**: DOMPurify HTML sanitization, path traversal protection, CSP headers, zip bomb detection
- **Asset Extraction**: Unified API for images, audio, video, fonts with vault export and OCR integration
- **Tiered Caching**: 3-tier cache (Memory LRU → IndexedDB → Server) with automatic promotion
- **Offline Support**: Download books for offline reading, network monitoring, background sync
- **Enhanced File Serving**: Chunked uploads, OPDS catalog generation, cover extraction, content deduplication

### Templates

Liquid-based templating system for note generation:
- Book notes
- Highlight notes (atomic and hub)
- Author/series/shelf indexes
- Customizable per template type

### Per-Book Settings

Override global settings per book:
- Font size, theme, flow mode
- Column layout, text alignment
- Margins, line height, brightness

## Installation

### From Obsidian Community Plugins

1. Open Obsidian Settings
2. Go to Community Plugins
3. Search for "Los Libros"
4. Install and enable

### Manual Installation

1. Download the latest release from GitHub
2. Extract to your vault's `.obsidian/plugins/los-libros/` folder
3. Enable the plugin in Obsidian Settings > Community Plugins

## Usage

### Opening a Book

1. Place EPUB files in your vault
2. Click the book icon in the ribbon, or
3. Use command palette: "Los Libros: Open Library"
4. Select a book to start reading

### Creating Highlights

1. Select text while reading
2. Choose a highlight color from the popup
3. Optionally add an annotation

### Navigation

- **Paginated Mode**: Click edges or swipe to turn pages
- **Scroll Mode**: Scroll naturally, click sidebar items to jump
- **TOC**: Click the menu icon to open Table of Contents

### Calibre Sync

1. Enable Calibre integration in settings
2. Configure library path or Content Server URL
3. Use "Calibre: Full Library Sync" command

## Configuration

Access settings via Obsidian Settings > Los Libros:

| Setting | Description |
|---------|-------------|
| Server URL | Backend server for enhanced features |
| Highlights Folder | Where to store highlight notes |
| Book Notes Folder | Where to store book metadata notes |
| Cache Size | Maximum cached books and size in MB |
| Calibre Library | Path to Calibre library folder |

## Commands

| Command | Description |
|---------|-------------|
| Open Library | Browse your EPUB library |
| Open Book Notebook | View sidebar for current book |
| Sync Library | Sync books with backend |
| Browse OPDS Catalog | Browse OPDS feeds |
| Calibre: Full Library Sync | Sync with Calibre |
| Create Backup | Backup plugin data |

## Architecture

```
src/
├── reader/           # EPUB reader components
│   ├── components/   # Svelte UI components
│   └── renderer/     # Rendering engine, pagination, highlights
├── library/          # Library management
├── highlights/       # Highlight service and storage
├── bookmarks/        # Bookmark and notes services
├── sidebar/          # Book sidebar view
├── calibre/          # Calibre integration
├── sync/             # Sync services
├── templates/        # Note generation templates
├── settings/         # Plugin settings
├── security/         # Content sanitization, CSP, resource policies
├── assets/           # Asset extraction (images, media, covers, OCR)
├── cache/            # Tiered caching (LRU, IndexedDB, monitoring)
├── offline/          # Offline manager, network monitor, sync
├── upload/           # Chunked upload system
├── dedup/            # Content deduplication
└── api/              # Public API, OPDS catalog/client
```

## Development

### Prerequisites

- Node.js 18+
- npm or pnpm

### Setup

```bash
# Install dependencies
npm install

# Build for development
npm run dev

# Build for production
npm run build
```

### Testing

```bash
# Run tests
npm test
```

## Tech Stack

- **Framework**: Obsidian Plugin API
- **UI**: Svelte 4
- **EPUB Processing**: Custom renderer + Rust/WASM fallback
- **State Management**: Svelte stores with reducer pattern
- **Templates**: LiquidJS
- **Build**: esbuild

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Obsidian](https://obsidian.md) for the amazing platform
- [epub.js](https://github.com/futurepress/epub.js) for EPUB inspiration
- [LiquidJS](https://liquidjs.com/) for templating
