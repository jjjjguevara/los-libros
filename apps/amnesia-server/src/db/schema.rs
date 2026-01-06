//! Database schema initialization

use sqlx::SqlitePool;

use crate::error::Result;

/// Initialize the database schema
pub async fn initialize_schema(pool: &SqlitePool) -> Result<()> {
    sqlx::query(SCHEMA_SQL)
        .execute(pool)
        .await?;

    Ok(())
}

const SCHEMA_SQL: &str = r#"
-- Books table (for deduplication and metadata)
CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    authors TEXT,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_hash TEXT,
    mime_type TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    cover_key TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_books_file_hash ON books(file_hash);
CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);

-- Upload sessions table (for resumable uploads)
CREATE TABLE IF NOT EXISTS upload_sessions (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_hash TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    chunk_hashes TEXT NOT NULL,
    chunk_size INTEGER NOT NULL,
    received_chunks TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    user_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_file_hash ON upload_sessions(file_hash);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires ON upload_sessions(expires_at);

-- Reading progress table
CREATE TABLE IF NOT EXISTS reading_progress (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    user_id TEXT,
    percent REAL NOT NULL DEFAULT 0,
    cfi TEXT NOT NULL DEFAULT '',
    page INTEGER,
    total_pages INTEGER,
    device_id TEXT,
    last_read TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(book_id, user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_book_id ON reading_progress(book_id);
CREATE INDEX IF NOT EXISTS idx_progress_user_id ON reading_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_last_read ON reading_progress(last_read);

-- Highlights table (supports both EPUB and PDF)
CREATE TABLE IF NOT EXISTS highlights (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    user_id TEXT,
    -- Format: 'epub' or 'pdf'
    document_format TEXT NOT NULL DEFAULT 'epub',
    -- EPUB location (CFI string)
    cfi TEXT NOT NULL DEFAULT '',
    -- PDF location (page number, 1-indexed)
    page INTEGER,
    -- Highlighted text
    text TEXT NOT NULL,
    chapter TEXT,
    page_percent REAL,
    color TEXT NOT NULL DEFAULT 'yellow',
    annotation TEXT,
    -- Text quote context for re-anchoring
    text_prefix TEXT,
    text_suffix TEXT,
    -- PDF region (normalized 0-1 coordinates)
    region_x REAL,
    region_y REAL,
    region_width REAL,
    region_height REAL,
    -- Multiple rects for multi-line selections (JSON array)
    rects_json TEXT,
    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_highlights_book_id ON highlights(book_id);
CREATE INDEX IF NOT EXISTS idx_highlights_user_id ON highlights(user_id);
CREATE INDEX IF NOT EXISTS idx_highlights_cfi ON highlights(cfi);
CREATE INDEX IF NOT EXISTS idx_highlights_format ON highlights(document_format);
CREATE INDEX IF NOT EXISTS idx_highlights_page ON highlights(page);

-- Reading sessions table
CREATE TABLE IF NOT EXISTS reading_sessions (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    user_id TEXT,
    device_id TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    start_cfi TEXT NOT NULL,
    end_cfi TEXT,
    start_percent REAL NOT NULL DEFAULT 0,
    end_percent REAL,
    pages_read INTEGER,
    duration_seconds INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_book_id ON reading_sessions(book_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON reading_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON reading_sessions(started_at);

-- Sync queue for offline operations
CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    operation_type TEXT NOT NULL,
    book_id TEXT NOT NULL,
    data TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_timestamp ON sync_queue(timestamp);

-- Sync operations table (for multi-device sync)
CREATE TABLE IF NOT EXISTS sync_operations (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload TEXT,
    base_version INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    applied INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sync_book ON sync_operations(book_id);
CREATE INDEX IF NOT EXISTS idx_sync_timestamp ON sync_operations(timestamp);
CREATE INDEX IF NOT EXISTS idx_sync_entity ON sync_operations(entity_type, entity_id);

-- Sync versions table (version tracking per book)
CREATE TABLE IF NOT EXISTS sync_versions (
    book_id TEXT PRIMARY KEY,
    current_version INTEGER NOT NULL DEFAULT 0,
    last_sync TEXT,
    device_id TEXT
);
"#;
