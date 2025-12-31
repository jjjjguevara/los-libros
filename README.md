# Los Libros

**Los Libros** is a self-hosted ebook reader ecosystem for Obsidian, consisting of a Rust-based server and an Obsidian plugin. Part of the **DD** (Doc Doctor) + **LL** (Los Libros) suite.

## Features

- **File-first architecture** — S3-compatible storage (MinIO, Cloudflare R2) as source of truth
- **Calibre-compatible** — Uses Calibre's folder structure, no migration needed
- **Local-first with optional sync** — Works 100% offline
- **Shared highlights system** — Integration with Doc Doctor
- **BookFusion-style templates** — Liquid templating for customization
- **iPad optimized** — Performance-tuned for Obsidian mobile

## Project Structure

```
los-libros/
├── apps/
│   ├── los-libros-server/     # Rust server (Axum, S3, OPDS)
│   └── los-libros/            # Obsidian plugin (Svelte, Epub.js)
├── packages/
│   └── shared-types/          # Shared TypeScript types
├── docker-compose.yml         # Local development setup
└── pnpm-workspace.yaml
```

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm 8+
- Rust (for server development)
- Docker (for local S3/MinIO)

### Development Setup

1. **Clone and install dependencies:**
   ```bash
   cd los-libros
   pnpm install
   ```

2. **Start local infrastructure:**
   ```bash
   docker-compose up -d minio minio-setup
   ```

3. **Start the server (development):**
   ```bash
   cd apps/los-libros-server
   cargo run
   ```

4. **Start the plugin (development):**
   ```bash
   cd apps/los-libros
   pnpm dev
   ```

5. **Access services:**
   - MinIO Console: http://localhost:9001 (admin/password123)
   - Server API: http://localhost:3000/health
   - Plugin: Symlink or copy to your Obsidian vault's plugins folder

### Adding Books

1. Open MinIO Console at http://localhost:9001
2. Navigate to the `library` bucket
3. Upload books following Calibre structure:
   ```
   Author Name/
   └── Book Title/
       ├── Book Title.epub
       ├── metadata.opf (optional)
       └── cover.jpg (optional)
   ```

## Architecture

### Server (Rust/Axum)

- **OPDS Catalog** — Generate OPDS 1.2/2.0 feeds from S3
- **Progress Sync** — Multi-device reading progress
- **Calibre Scanner** — Parse metadata.opf files
- **S3 Native** — Direct S3 API support (MinIO, R2, B2, AWS)

### Plugin (Svelte/TypeScript)

- **OPDS Client** — Browse any OPDS catalog
- **Epub.js Reader** — Full-featured EPUB rendering
- **Liquid Templates** — Customizable note generation
- **Doc Doctor Integration** — Shared highlights system

## Configuration

### Server Environment Variables

```bash
SERVER_HOST=0.0.0.0
SERVER_PORT=3000
S3_PROVIDER=minio           # minio, r2, s3, b2
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=library
S3_ACCESS_KEY=admin
S3_SECRET_KEY=password
DATABASE_URL=sqlite:./libros.db
```

### Plugin Settings

Configure in Obsidian Settings → Los Libros:

- **Server URL** — Your Los Libros server instance
- **Books Folder** — Local vault folder for EPUBs
- **Sync Settings** — Progress and highlight sync options
- **Templates** — Liquid templates for book notes and highlights

## Roadmap

- [ ] **Phase 0:** Server infrastructure (S3, OPDS, Docker)
- [ ] **Phase 1:** Plugin MVP (reader, library, progress)
- [ ] **Phase 2:** Highlights & Doc Doctor integration
- [ ] **Phase 3:** Intelligence layer (Smart Connections, LLM)

## Related Projects

- **[Doc Doctor](https://github.com/...)** — AI-powered document analysis

## License

MIT
