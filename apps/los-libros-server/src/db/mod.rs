//! Database module for SQLite persistence
//!
//! Handles reading progress, highlights, and library metadata storage.

mod highlights;
mod progress;
mod schema;

pub use highlights::*;
pub use progress::*;
pub use schema::*;

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

    Ok(pool)
}
