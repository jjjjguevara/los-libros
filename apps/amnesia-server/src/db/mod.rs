//! Database module for SQLite persistence
//!
//! Handles reading progress, highlights, library metadata storage,
//! and full-text search via FTS5.

mod highlights;
mod progress;
mod schema;
pub mod search;

pub use highlights::*;
pub use progress::*;
pub use schema::*;
pub use search::{
    BookSearchResult, FTS5Search, FTS5Stats, HighlightSearchResult, UnifiedSearchResult,
};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::str::FromStr;

use crate::error::Result;

/// Create a new database connection pool
pub async fn create_pool(database_url: &str) -> Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .synchronous(sqlx::sqlite::SqliteSynchronous::Normal);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    // Run migrations
    initialize_schema(&pool).await?;

    // Initialize FTS5 search tables
    let fts = FTS5Search::new(&pool);
    if let Err(e) = fts.initialize().await {
        tracing::warn!("Failed to initialize FTS5: {}. Search may be unavailable.", e);
    }

    Ok(pool)
}
