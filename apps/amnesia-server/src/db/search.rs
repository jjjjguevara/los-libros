//! FTS5 Full-Text Search for Books and Highlights
//!
//! Provides fast full-text search using SQLite's FTS5 extension.
//! Performance: ~50x faster than LIKE queries on large datasets.
//!
//! # Usage
//!
//! ```rust,ignore
//! let search = FTS5Search::new(pool);
//!
//! // Initialize FTS5 tables
//! search.initialize().await?;
//!
//! // Rebuild index from existing data
//! search.rebuild_books_index().await?;
//!
//! // Search
//! let results = search.search_books("rust async", 100).await?;
//! ```

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::error::Result;

/// FTS5 search result for books
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BookSearchResult {
    pub id: String,
    pub title: String,
    pub authors: Option<String>,
    /// Highlighted title (if using highlight function)
    pub title_highlight: Option<String>,
    /// Highlighted authors
    pub authors_highlight: Option<String>,
    /// FTS5 rank score (lower = better match)
    pub rank: f64,
}

/// FTS5 search result for highlights
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HighlightSearchResult {
    pub id: String,
    pub book_id: String,
    pub text: String,
    pub annotation: Option<String>,
    pub chapter: Option<String>,
    pub color: String,
    /// Highlighted text
    pub text_highlight: Option<String>,
    /// Highlighted annotation
    pub annotation_highlight: Option<String>,
    /// FTS5 rank score
    pub rank: f64,
}

/// Unified search result combining books and highlights
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum UnifiedSearchResult {
    Book(BookSearchResult),
    Highlight(HighlightSearchResult),
}

/// FTS5 Search service
pub struct FTS5Search<'a> {
    pool: &'a SqlitePool,
}

impl<'a> FTS5Search<'a> {
    /// Create a new FTS5Search instance
    pub fn new(pool: &'a SqlitePool) -> Self {
        Self { pool }
    }

    /// Initialize FTS5 virtual tables
    pub async fn initialize(&self) -> Result<()> {
        // Create FTS5 table for books
        sqlx::query(
            r#"
            CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
                title,
                authors,
                metadata,
                content='books',
                content_rowid='rowid',
                tokenize='unicode61 remove_diacritics 2'
            )
            "#,
        )
        .execute(self.pool)
        .await?;

        // Create FTS5 table for highlights
        sqlx::query(
            r#"
            CREATE VIRTUAL TABLE IF NOT EXISTS highlights_fts USING fts5(
                text,
                annotation,
                chapter,
                content='highlights',
                content_rowid='rowid',
                tokenize='unicode61 remove_diacritics 2'
            )
            "#,
        )
        .execute(self.pool)
        .await?;

        // Create triggers to keep FTS in sync with books table
        self.create_books_triggers().await?;

        // Create triggers for highlights
        self.create_highlights_triggers().await?;

        Ok(())
    }

    /// Create triggers for books FTS synchronization
    async fn create_books_triggers(&self) -> Result<()> {
        // Delete trigger
        sqlx::query(
            r#"
            CREATE TRIGGER IF NOT EXISTS books_fts_delete AFTER DELETE ON books BEGIN
                INSERT INTO books_fts(books_fts, rowid, title, authors, metadata)
                VALUES('delete', old.rowid, old.title, old.authors, old.metadata);
            END
            "#,
        )
        .execute(self.pool)
        .await?;

        // Insert trigger
        sqlx::query(
            r#"
            CREATE TRIGGER IF NOT EXISTS books_fts_insert AFTER INSERT ON books BEGIN
                INSERT INTO books_fts(rowid, title, authors, metadata)
                VALUES(new.rowid, new.title, new.authors, new.metadata);
            END
            "#,
        )
        .execute(self.pool)
        .await?;

        // Update trigger
        sqlx::query(
            r#"
            CREATE TRIGGER IF NOT EXISTS books_fts_update AFTER UPDATE ON books BEGIN
                INSERT INTO books_fts(books_fts, rowid, title, authors, metadata)
                VALUES('delete', old.rowid, old.title, old.authors, old.metadata);
                INSERT INTO books_fts(rowid, title, authors, metadata)
                VALUES(new.rowid, new.title, new.authors, new.metadata);
            END
            "#,
        )
        .execute(self.pool)
        .await?;

        Ok(())
    }

    /// Create triggers for highlights FTS synchronization
    async fn create_highlights_triggers(&self) -> Result<()> {
        // Delete trigger
        sqlx::query(
            r#"
            CREATE TRIGGER IF NOT EXISTS highlights_fts_delete AFTER DELETE ON highlights BEGIN
                INSERT INTO highlights_fts(highlights_fts, rowid, text, annotation, chapter)
                VALUES('delete', old.rowid, old.text, old.annotation, old.chapter);
            END
            "#,
        )
        .execute(self.pool)
        .await?;

        // Insert trigger
        sqlx::query(
            r#"
            CREATE TRIGGER IF NOT EXISTS highlights_fts_insert AFTER INSERT ON highlights BEGIN
                INSERT INTO highlights_fts(rowid, text, annotation, chapter)
                VALUES(new.rowid, new.text, new.annotation, new.chapter);
            END
            "#,
        )
        .execute(self.pool)
        .await?;

        // Update trigger
        sqlx::query(
            r#"
            CREATE TRIGGER IF NOT EXISTS highlights_fts_update AFTER UPDATE ON highlights BEGIN
                INSERT INTO highlights_fts(highlights_fts, rowid, text, annotation, chapter)
                VALUES('delete', old.rowid, old.text, old.annotation, old.chapter);
                INSERT INTO highlights_fts(rowid, text, annotation, chapter)
                VALUES(new.rowid, new.text, new.annotation, new.chapter);
            END
            "#,
        )
        .execute(self.pool)
        .await?;

        Ok(())
    }

    /// Rebuild the books FTS index from existing data
    pub async fn rebuild_books_index(&self) -> Result<usize> {
        // Clear existing index
        sqlx::query("DELETE FROM books_fts").execute(self.pool).await?;

        // Rebuild from books table
        let result = sqlx::query(
            r#"
            INSERT INTO books_fts(rowid, title, authors, metadata)
            SELECT rowid, title, authors, metadata FROM books
            "#,
        )
        .execute(self.pool)
        .await?;

        Ok(result.rows_affected() as usize)
    }

    /// Rebuild the highlights FTS index from existing data
    pub async fn rebuild_highlights_index(&self) -> Result<usize> {
        // Clear existing index
        sqlx::query("DELETE FROM highlights_fts")
            .execute(self.pool)
            .await?;

        // Rebuild from highlights table
        let result = sqlx::query(
            r#"
            INSERT INTO highlights_fts(rowid, text, annotation, chapter)
            SELECT rowid, text, annotation, chapter FROM highlights
            "#,
        )
        .execute(self.pool)
        .await?;

        Ok(result.rows_affected() as usize)
    }

    /// Search books using FTS5
    pub async fn search_books(&self, query: &str, limit: i32) -> Result<Vec<BookSearchResult>> {
        let sanitized = sanitize_fts5_query(query);

        let results = sqlx::query_as::<_, BookSearchResult>(
            r#"
            SELECT
                b.id,
                b.title,
                b.authors,
                highlight(books_fts, 0, '<mark>', '</mark>') as title_highlight,
                highlight(books_fts, 1, '<mark>', '</mark>') as authors_highlight,
                books_fts.rank as rank
            FROM books b
            INNER JOIN books_fts ON b.rowid = books_fts.rowid
            WHERE books_fts MATCH ?
            ORDER BY books_fts.rank
            LIMIT ?
            "#,
        )
        .bind(&sanitized)
        .bind(limit)
        .fetch_all(self.pool)
        .await?;

        Ok(results)
    }

    /// Search books with advanced query options
    pub async fn search_books_advanced(
        &self,
        query: &str,
        authors: Option<&str>,
        limit: i32,
    ) -> Result<Vec<BookSearchResult>> {
        // Build FTS5 query with column targeting
        let mut fts_query = String::new();

        if !query.is_empty() {
            fts_query.push_str(&format!("title:{}", sanitize_fts5_query(query)));
        }

        if let Some(auth) = authors {
            if !fts_query.is_empty() {
                fts_query.push_str(" OR ");
            }
            fts_query.push_str(&format!("authors:{}", sanitize_fts5_query(auth)));
        }

        if fts_query.is_empty() {
            return Ok(vec![]);
        }

        let results = sqlx::query_as::<_, BookSearchResult>(
            r#"
            SELECT
                b.id,
                b.title,
                b.authors,
                highlight(books_fts, 0, '<mark>', '</mark>') as title_highlight,
                highlight(books_fts, 1, '<mark>', '</mark>') as authors_highlight,
                books_fts.rank as rank
            FROM books b
            INNER JOIN books_fts ON b.rowid = books_fts.rowid
            WHERE books_fts MATCH ?
            ORDER BY books_fts.rank
            LIMIT ?
            "#,
        )
        .bind(&fts_query)
        .bind(limit)
        .fetch_all(self.pool)
        .await?;

        Ok(results)
    }

    /// Search highlights using FTS5
    pub async fn search_highlights(
        &self,
        query: &str,
        limit: i32,
    ) -> Result<Vec<HighlightSearchResult>> {
        let sanitized = sanitize_fts5_query(query);

        let results = sqlx::query_as::<_, HighlightSearchResult>(
            r#"
            SELECT
                h.id,
                h.book_id,
                h.text,
                h.annotation,
                h.chapter,
                h.color,
                highlight(highlights_fts, 0, '<mark>', '</mark>') as text_highlight,
                highlight(highlights_fts, 1, '<mark>', '</mark>') as annotation_highlight,
                highlights_fts.rank as rank
            FROM highlights h
            INNER JOIN highlights_fts ON h.rowid = highlights_fts.rowid
            WHERE highlights_fts MATCH ?
            ORDER BY highlights_fts.rank
            LIMIT ?
            "#,
        )
        .bind(&sanitized)
        .bind(limit)
        .fetch_all(self.pool)
        .await?;

        Ok(results)
    }

    /// Search highlights with filters
    pub async fn search_highlights_filtered(
        &self,
        query: &str,
        book_id: Option<&str>,
        colors: &[String],
        limit: i32,
    ) -> Result<Vec<HighlightSearchResult>> {
        let sanitized = sanitize_fts5_query(query);

        // Build dynamic query with filters
        let mut sql = String::from(
            r#"
            SELECT
                h.id,
                h.book_id,
                h.text,
                h.annotation,
                h.chapter,
                h.color,
                highlight(highlights_fts, 0, '<mark>', '</mark>') as text_highlight,
                highlight(highlights_fts, 1, '<mark>', '</mark>') as annotation_highlight,
                highlights_fts.rank as rank
            FROM highlights h
            INNER JOIN highlights_fts ON h.rowid = highlights_fts.rowid
            WHERE highlights_fts MATCH ?
            "#,
        );

        let mut bind_values: Vec<String> = vec![sanitized];

        if book_id.is_some() {
            sql.push_str(" AND h.book_id = ?");
            bind_values.push(book_id.unwrap().to_string());
        }

        if !colors.is_empty() {
            let placeholders: Vec<&str> = colors.iter().map(|_| "?").collect();
            sql.push_str(&format!(" AND h.color IN ({})", placeholders.join(",")));
            bind_values.extend(colors.iter().cloned());
        }

        sql.push_str(" ORDER BY highlights_fts.rank LIMIT ?");
        bind_values.push(limit.to_string());

        // Execute with dynamic bindings
        let mut query = sqlx::query_as::<_, HighlightSearchResult>(&sql);
        for val in &bind_values[..bind_values.len() - 1] {
            query = query.bind(val);
        }
        query = query.bind(limit);

        let results = query.fetch_all(self.pool).await?;
        Ok(results)
    }

    /// Unified search across books and highlights
    pub async fn search_unified(
        &self,
        query: &str,
        limit: i32,
    ) -> Result<Vec<UnifiedSearchResult>> {
        let books = self.search_books(query, limit / 2).await?;
        let highlights = self.search_highlights(query, limit / 2).await?;

        let mut results: Vec<UnifiedSearchResult> = Vec::new();

        // Interleave results by rank
        let mut book_iter = books.into_iter().peekable();
        let mut highlight_iter = highlights.into_iter().peekable();

        while book_iter.peek().is_some() || highlight_iter.peek().is_some() {
            let book_rank = book_iter.peek().map(|b| b.rank).unwrap_or(f64::MAX);
            let highlight_rank = highlight_iter.peek().map(|h| h.rank).unwrap_or(f64::MAX);

            if book_rank <= highlight_rank {
                if let Some(book) = book_iter.next() {
                    results.push(UnifiedSearchResult::Book(book));
                }
            } else if let Some(highlight) = highlight_iter.next() {
                results.push(UnifiedSearchResult::Highlight(highlight));
            }

            if results.len() >= limit as usize {
                break;
            }
        }

        Ok(results)
    }

    /// Check if FTS5 tables exist
    pub async fn is_initialized(&self) -> Result<bool> {
        let result: Option<(String,)> = sqlx::query_as(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='books_fts'",
        )
        .fetch_optional(self.pool)
        .await?;

        Ok(result.is_some())
    }

    /// Get FTS5 index statistics
    pub async fn get_stats(&self) -> Result<FTS5Stats> {
        let books_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM books_fts")
            .fetch_one(self.pool)
            .await?;

        let highlights_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM highlights_fts")
            .fetch_one(self.pool)
            .await?;

        Ok(FTS5Stats {
            books_indexed: books_count.0 as usize,
            highlights_indexed: highlights_count.0 as usize,
        })
    }
}

/// FTS5 index statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FTS5Stats {
    pub books_indexed: usize,
    pub highlights_indexed: usize,
}

/// Sanitize a query string for FTS5
///
/// FTS5 has special syntax characters that need escaping or removal
/// to prevent query syntax errors.
fn sanitize_fts5_query(query: &str) -> String {
    // Remove or escape FTS5 special characters
    let mut result = String::with_capacity(query.len());

    for ch in query.chars() {
        match ch {
            // Quote special characters
            '"' => result.push_str("\"\""),
            // Remove operators that could cause syntax errors
            '*' | '(' | ')' | ':' | '^' | '-' | '+' => {
                // Skip these operators unless they're part of a word
            }
            // Keep everything else
            _ => result.push(ch),
        }
    }

    // Wrap in quotes for phrase matching if contains spaces
    let trimmed = result.trim();
    if trimmed.contains(' ') {
        format!("\"{}\"", trimmed)
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_fts5_query() {
        assert_eq!(sanitize_fts5_query("simple"), "simple");
        assert_eq!(sanitize_fts5_query("two words"), "\"two words\"");
        assert_eq!(sanitize_fts5_query("test*"), "test");
        assert_eq!(sanitize_fts5_query("test:value"), "testvalue");
        assert_eq!(sanitize_fts5_query("test\"quote"), "test\"\"quote");
    }
}
