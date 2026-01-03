//! Highlights database operations

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::Result;

/// Highlight record
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Highlight {
    pub id: String,
    pub book_id: String,
    pub user_id: Option<String>,
    pub cfi: String,
    pub text: String,
    pub chapter: Option<String>,
    pub page_percent: Option<f64>,
    pub color: String,
    pub annotation: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Create highlight request
#[derive(Debug, Clone, Deserialize)]
pub struct CreateHighlight {
    pub cfi: String,
    pub text: String,
    pub chapter: Option<String>,
    pub page_percent: Option<f64>,
    pub color: Option<String>,
    pub annotation: Option<String>,
}

/// Update highlight request
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateHighlight {
    pub color: Option<String>,
    pub annotation: Option<String>,
}

/// Highlight repository
pub struct HighlightRepository<'a> {
    pool: &'a SqlitePool,
}

impl<'a> HighlightRepository<'a> {
    pub fn new(pool: &'a SqlitePool) -> Self {
        Self { pool }
    }

    /// Get a specific highlight
    pub async fn get(&self, id: &str) -> Result<Option<Highlight>> {
        let highlight = sqlx::query_as::<_, Highlight>(
            r#"
            SELECT id, book_id, user_id, cfi, text, chapter, page_percent,
                   color, annotation, created_at, updated_at
            FROM highlights
            WHERE id = ?
            "#,
        )
        .bind(id)
        .fetch_optional(self.pool)
        .await?;

        Ok(highlight)
    }

    /// List highlights for a book
    pub async fn list_for_book(
        &self,
        book_id: &str,
        user_id: Option<&str>,
    ) -> Result<Vec<Highlight>> {
        let highlights = sqlx::query_as::<_, Highlight>(
            r#"
            SELECT id, book_id, user_id, cfi, text, chapter, page_percent,
                   color, annotation, created_at, updated_at
            FROM highlights
            WHERE book_id = ? AND (user_id = ? OR user_id IS NULL)
            ORDER BY page_percent ASC, created_at ASC
            "#,
        )
        .bind(book_id)
        .bind(user_id)
        .fetch_all(self.pool)
        .await?;

        Ok(highlights)
    }

    /// List all highlights for a user
    pub async fn list(&self, user_id: Option<&str>) -> Result<Vec<Highlight>> {
        let highlights = sqlx::query_as::<_, Highlight>(
            r#"
            SELECT id, book_id, user_id, cfi, text, chapter, page_percent,
                   color, annotation, created_at, updated_at
            FROM highlights
            WHERE user_id = ? OR user_id IS NULL
            ORDER BY created_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(self.pool)
        .await?;

        Ok(highlights)
    }

    /// Create a new highlight
    pub async fn create(
        &self,
        book_id: &str,
        user_id: Option<&str>,
        data: &CreateHighlight,
    ) -> Result<Highlight> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let color = data.color.as_deref().unwrap_or("yellow");

        sqlx::query(
            r#"
            INSERT INTO highlights (id, book_id, user_id, cfi, text, chapter, page_percent, color, annotation, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(book_id)
        .bind(user_id)
        .bind(&data.cfi)
        .bind(&data.text)
        .bind(&data.chapter)
        .bind(data.page_percent)
        .bind(color)
        .bind(&data.annotation)
        .bind(&now)
        .bind(&now)
        .execute(self.pool)
        .await?;

        self.get(&id)
            .await?
            .ok_or_else(|| crate::error::AppError::Internal("Failed to fetch created highlight".to_string()))
    }

    /// Update a highlight
    pub async fn update(&self, id: &str, data: &UpdateHighlight) -> Result<Option<Highlight>> {
        let now = Utc::now().to_rfc3339();

        // Build dynamic update query
        let mut set_clauses = vec!["updated_at = ?".to_string()];
        let mut binds: Vec<String> = vec![now.clone()];

        if let Some(ref color) = data.color {
            set_clauses.push("color = ?".to_string());
            binds.push(color.clone());
        }

        if let Some(ref annotation) = data.annotation {
            set_clauses.push("annotation = ?".to_string());
            binds.push(annotation.clone());
        }

        let query = format!(
            "UPDATE highlights SET {} WHERE id = ?",
            set_clauses.join(", ")
        );

        // Execute update
        let mut sql_query = sqlx::query(&query);
        for bind in binds {
            sql_query = sql_query.bind(bind);
        }
        sql_query = sql_query.bind(id);

        sql_query.execute(self.pool).await?;

        self.get(id).await
    }

    /// Delete a highlight
    pub async fn delete(&self, id: &str) -> Result<bool> {
        let result = sqlx::query("DELETE FROM highlights WHERE id = ?")
            .bind(id)
            .execute(self.pool)
            .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Count highlights for a book
    pub async fn count_for_book(&self, book_id: &str, user_id: Option<&str>) -> Result<i32> {
        let result: (i32,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM highlights
            WHERE book_id = ? AND (user_id = ? OR user_id IS NULL)
            "#,
        )
        .bind(book_id)
        .bind(user_id)
        .fetch_one(self.pool)
        .await?;

        Ok(result.0)
    }

    /// Search highlights by text
    pub async fn search(
        &self,
        user_id: Option<&str>,
        query: &str,
    ) -> Result<Vec<Highlight>> {
        let search_pattern = format!("%{}%", query);

        let highlights = sqlx::query_as::<_, Highlight>(
            r#"
            SELECT id, book_id, user_id, cfi, text, chapter, page_percent,
                   color, annotation, created_at, updated_at
            FROM highlights
            WHERE (user_id = ? OR user_id IS NULL)
              AND (text LIKE ? OR annotation LIKE ?)
            ORDER BY created_at DESC
            "#,
        )
        .bind(user_id)
        .bind(&search_pattern)
        .bind(&search_pattern)
        .fetch_all(self.pool)
        .await?;

        Ok(highlights)
    }
}
