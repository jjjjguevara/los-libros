//! Reading progress database operations

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::Result;

/// Reading progress record
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ReadingProgress {
    pub id: String,
    pub book_id: String,
    pub user_id: Option<String>,
    pub percent: f64,
    pub cfi: String,
    pub page: Option<i32>,
    pub total_pages: Option<i32>,
    pub device_id: Option<String>,
    pub last_read: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Progress update request
#[derive(Debug, Clone, Deserialize)]
pub struct ProgressUpdate {
    pub percent: f64,
    pub cfi: String,
    pub page: Option<i32>,
    pub total_pages: Option<i32>,
    pub device_id: Option<String>,
}

/// Progress repository
pub struct ProgressRepository<'a> {
    pool: &'a SqlitePool,
}

impl<'a> ProgressRepository<'a> {
    pub fn new(pool: &'a SqlitePool) -> Self {
        Self { pool }
    }

    /// Get progress for a specific book
    pub async fn get(&self, book_id: &str, user_id: Option<&str>) -> Result<Option<ReadingProgress>> {
        let progress = sqlx::query_as::<_, ReadingProgress>(
            r#"
            SELECT id, book_id, user_id, percent, cfi, page, total_pages,
                   device_id, last_read, created_at, updated_at
            FROM reading_progress
            WHERE book_id = ? AND (user_id = ? OR user_id IS NULL)
            ORDER BY last_read DESC
            LIMIT 1
            "#,
        )
        .bind(book_id)
        .bind(user_id)
        .fetch_optional(self.pool)
        .await?;

        Ok(progress)
    }

    /// Get all progress for a user
    pub async fn list(&self, user_id: Option<&str>) -> Result<Vec<ReadingProgress>> {
        let progress = sqlx::query_as::<_, ReadingProgress>(
            r#"
            SELECT id, book_id, user_id, percent, cfi, page, total_pages,
                   device_id, last_read, created_at, updated_at
            FROM reading_progress
            WHERE user_id = ? OR user_id IS NULL
            ORDER BY last_read DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(self.pool)
        .await?;

        Ok(progress)
    }

    /// Update or create progress for a book
    pub async fn upsert(
        &self,
        book_id: &str,
        user_id: Option<&str>,
        update: &ProgressUpdate,
    ) -> Result<ReadingProgress> {
        let now = Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO reading_progress (id, book_id, user_id, percent, cfi, page, total_pages, device_id, last_read, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(book_id, user_id, device_id) DO UPDATE SET
                percent = excluded.percent,
                cfi = excluded.cfi,
                page = excluded.page,
                total_pages = excluded.total_pages,
                last_read = excluded.last_read,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&id)
        .bind(book_id)
        .bind(user_id)
        .bind(update.percent)
        .bind(&update.cfi)
        .bind(update.page)
        .bind(update.total_pages)
        .bind(&update.device_id)
        .bind(&now)
        .bind(&now)
        .execute(self.pool)
        .await?;

        // Fetch the updated record
        self.get(book_id, user_id)
            .await?
            .ok_or_else(|| crate::error::AppError::Internal("Failed to fetch upserted progress".to_string()))
    }

    /// Delete progress for a book
    pub async fn delete(&self, book_id: &str, user_id: Option<&str>) -> Result<bool> {
        let result = sqlx::query(
            r#"
            DELETE FROM reading_progress
            WHERE book_id = ? AND (user_id = ? OR user_id IS NULL)
            "#,
        )
        .bind(book_id)
        .bind(user_id)
        .execute(self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Get the most recently read books
    pub async fn recent(&self, user_id: Option<&str>, limit: i32) -> Result<Vec<ReadingProgress>> {
        let progress = sqlx::query_as::<_, ReadingProgress>(
            r#"
            SELECT id, book_id, user_id, percent, cfi, page, total_pages,
                   device_id, last_read, created_at, updated_at
            FROM reading_progress
            WHERE (user_id = ? OR user_id IS NULL) AND percent > 0
            ORDER BY last_read DESC
            LIMIT ?
            "#,
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(self.pool)
        .await?;

        Ok(progress)
    }
}

/// Reading session record
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ReadingSession {
    pub id: String,
    pub book_id: String,
    pub user_id: Option<String>,
    pub device_id: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub start_cfi: String,
    pub end_cfi: Option<String>,
    pub start_percent: f64,
    pub end_percent: Option<f64>,
    pub pages_read: Option<i32>,
    pub duration_seconds: Option<i32>,
    pub created_at: String,
}

/// Session repository
pub struct SessionRepository<'a> {
    pool: &'a SqlitePool,
}

impl<'a> SessionRepository<'a> {
    pub fn new(pool: &'a SqlitePool) -> Self {
        Self { pool }
    }

    /// Start a new reading session
    pub async fn start(
        &self,
        book_id: &str,
        user_id: Option<&str>,
        device_id: Option<&str>,
        start_cfi: &str,
        start_percent: f64,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            INSERT INTO reading_sessions (id, book_id, user_id, device_id, started_at, start_cfi, start_percent)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(book_id)
        .bind(user_id)
        .bind(device_id)
        .bind(&now)
        .bind(start_cfi)
        .bind(start_percent)
        .execute(self.pool)
        .await?;

        Ok(id)
    }

    /// End a reading session
    pub async fn end(
        &self,
        session_id: &str,
        end_cfi: &str,
        end_percent: f64,
        pages_read: Option<i32>,
    ) -> Result<bool> {
        let now = Utc::now().to_rfc3339();

        // Calculate duration from started_at
        let result = sqlx::query(
            r#"
            UPDATE reading_sessions
            SET ended_at = ?,
                end_cfi = ?,
                end_percent = ?,
                pages_read = ?,
                duration_seconds = CAST((julianday(?) - julianday(started_at)) * 86400 AS INTEGER)
            WHERE id = ?
            "#,
        )
        .bind(&now)
        .bind(end_cfi)
        .bind(end_percent)
        .bind(pages_read)
        .bind(&now)
        .bind(session_id)
        .execute(self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Get sessions for a book
    pub async fn list_for_book(
        &self,
        book_id: &str,
        user_id: Option<&str>,
    ) -> Result<Vec<ReadingSession>> {
        let sessions = sqlx::query_as::<_, ReadingSession>(
            r#"
            SELECT id, book_id, user_id, device_id, started_at, ended_at,
                   start_cfi, end_cfi, start_percent, end_percent, pages_read,
                   duration_seconds, created_at
            FROM reading_sessions
            WHERE book_id = ? AND (user_id = ? OR user_id IS NULL)
            ORDER BY started_at DESC
            "#,
        )
        .bind(book_id)
        .bind(user_id)
        .fetch_all(self.pool)
        .await?;

        Ok(sessions)
    }

    /// Get total reading time for a book
    pub async fn total_time(&self, book_id: &str, user_id: Option<&str>) -> Result<i32> {
        let result: (i32,) = sqlx::query_as(
            r#"
            SELECT COALESCE(SUM(duration_seconds), 0)
            FROM reading_sessions
            WHERE book_id = ? AND (user_id = ? OR user_id IS NULL)
            "#,
        )
        .bind(book_id)
        .bind(user_id)
        .fetch_one(self.pool)
        .await?;

        Ok(result.0)
    }
}
