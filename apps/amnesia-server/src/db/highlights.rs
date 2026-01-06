//! Highlights database operations
//!
//! Supports both EPUB (CFI-based) and PDF (page-based) highlights.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::Result;

/// Document format for highlights
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentFormat {
    Epub,
    Pdf,
}

impl Default for DocumentFormat {
    fn default() -> Self {
        Self::Epub
    }
}

impl std::fmt::Display for DocumentFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Epub => write!(f, "epub"),
            Self::Pdf => write!(f, "pdf"),
        }
    }
}

impl std::str::FromStr for DocumentFormat {
    type Err = String;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "epub" => Ok(Self::Epub),
            "pdf" => Ok(Self::Pdf),
            _ => Err(format!("Unknown document format: {}", s)),
        }
    }
}

/// PDF region (normalized 0-1 coordinates)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfRegion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// PDF rectangle for multi-line selections
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Highlight record (supports both EPUB and PDF)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub id: String,
    pub book_id: String,
    pub user_id: Option<String>,
    /// Document format: 'epub' or 'pdf'
    pub document_format: String,
    /// EPUB CFI location (empty for PDF)
    pub cfi: String,
    /// PDF page number (1-indexed, None for EPUB)
    pub page: Option<i32>,
    /// Highlighted text
    pub text: String,
    /// Chapter name or "Page N"
    pub chapter: Option<String>,
    /// Progress percentage
    pub page_percent: Option<f64>,
    /// Highlight color
    pub color: String,
    /// User annotation
    pub annotation: Option<String>,
    /// Text before selection for re-anchoring
    pub text_prefix: Option<String>,
    /// Text after selection for re-anchoring
    pub text_suffix: Option<String>,
    /// PDF region x coordinate (normalized)
    pub region_x: Option<f64>,
    /// PDF region y coordinate (normalized)
    pub region_y: Option<f64>,
    /// PDF region width (normalized)
    pub region_width: Option<f64>,
    /// PDF region height (normalized)
    pub region_height: Option<f64>,
    /// JSON array of rects for multi-line selections
    pub rects_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Highlight {
    /// Check if this is a PDF highlight
    pub fn is_pdf(&self) -> bool {
        self.document_format == "pdf"
    }

    /// Get the PDF region if available
    pub fn get_region(&self) -> Option<PdfRegion> {
        match (self.region_x, self.region_y, self.region_width, self.region_height) {
            (Some(x), Some(y), Some(width), Some(height)) => {
                Some(PdfRegion { x, y, width, height })
            }
            _ => None,
        }
    }

    /// Get PDF rects if available
    pub fn get_rects(&self) -> Option<Vec<PdfRect>> {
        self.rects_json.as_ref().and_then(|json| {
            serde_json::from_str(json).ok()
        })
    }
}

/// Create highlight request (supports both EPUB and PDF)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHighlight {
    /// Document format (default: epub)
    #[serde(default)]
    pub document_format: Option<String>,
    /// EPUB CFI location
    pub cfi: Option<String>,
    /// PDF page number (1-indexed)
    pub page: Option<i32>,
    /// Highlighted text
    pub text: String,
    /// Chapter name
    pub chapter: Option<String>,
    /// Progress percentage
    pub page_percent: Option<f64>,
    /// Highlight color
    pub color: Option<String>,
    /// User annotation
    pub annotation: Option<String>,
    /// Text before selection
    pub text_prefix: Option<String>,
    /// Text after selection
    pub text_suffix: Option<String>,
    /// PDF region
    pub region: Option<PdfRegion>,
    /// PDF rects for multi-line selections
    pub rects: Option<Vec<PdfRect>>,
}

/// Update highlight request
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateHighlight {
    pub color: Option<String>,
    pub annotation: Option<String>,
}

/// Highlight repository
pub struct HighlightRepository<'a> {
    pool: &'a SqlitePool,
}

/// All columns to select for highlights
const HIGHLIGHT_COLUMNS: &str = r#"
    id, book_id, user_id, document_format, cfi, page, text, chapter,
    page_percent, color, annotation, text_prefix, text_suffix,
    region_x, region_y, region_width, region_height, rects_json,
    created_at, updated_at
"#;

impl<'a> HighlightRepository<'a> {
    pub fn new(pool: &'a SqlitePool) -> Self {
        Self { pool }
    }

    /// Get a specific highlight
    pub async fn get(&self, id: &str) -> Result<Option<Highlight>> {
        let query = format!(
            "SELECT {} FROM highlights WHERE id = ?",
            HIGHLIGHT_COLUMNS
        );
        let highlight = sqlx::query_as::<_, Highlight>(&query)
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
        let query = format!(
            r#"
            SELECT {}
            FROM highlights
            WHERE book_id = ? AND (user_id = ? OR user_id IS NULL)
            ORDER BY COALESCE(page, 0) ASC, page_percent ASC, created_at ASC
            "#,
            HIGHLIGHT_COLUMNS
        );
        let highlights = sqlx::query_as::<_, Highlight>(&query)
            .bind(book_id)
            .bind(user_id)
            .fetch_all(self.pool)
            .await?;

        Ok(highlights)
    }

    /// List PDF highlights for a specific page
    pub async fn list_for_pdf_page(
        &self,
        book_id: &str,
        page: i32,
        user_id: Option<&str>,
    ) -> Result<Vec<Highlight>> {
        let query = format!(
            r#"
            SELECT {}
            FROM highlights
            WHERE book_id = ? AND page = ? AND document_format = 'pdf'
              AND (user_id = ? OR user_id IS NULL)
            ORDER BY region_y ASC, region_x ASC, created_at ASC
            "#,
            HIGHLIGHT_COLUMNS
        );
        let highlights = sqlx::query_as::<_, Highlight>(&query)
            .bind(book_id)
            .bind(page)
            .bind(user_id)
            .fetch_all(self.pool)
            .await?;

        Ok(highlights)
    }

    /// List all highlights for a user
    pub async fn list(&self, user_id: Option<&str>) -> Result<Vec<Highlight>> {
        let query = format!(
            r#"
            SELECT {}
            FROM highlights
            WHERE user_id = ? OR user_id IS NULL
            ORDER BY created_at DESC
            "#,
            HIGHLIGHT_COLUMNS
        );
        let highlights = sqlx::query_as::<_, Highlight>(&query)
            .bind(user_id)
            .fetch_all(self.pool)
            .await?;

        Ok(highlights)
    }

    /// Create a new highlight (supports both EPUB and PDF)
    pub async fn create(
        &self,
        book_id: &str,
        user_id: Option<&str>,
        data: &CreateHighlight,
    ) -> Result<Highlight> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let color = data.color.as_deref().unwrap_or("yellow");
        let format = data.document_format.as_deref().unwrap_or("epub");
        let cfi = data.cfi.as_deref().unwrap_or("");

        // Serialize rects to JSON if provided
        let rects_json = data.rects.as_ref().map(|rects| {
            serde_json::to_string(rects).unwrap_or_else(|_| "[]".to_string())
        });

        // Extract region coordinates
        let (region_x, region_y, region_width, region_height) = match &data.region {
            Some(r) => (Some(r.x), Some(r.y), Some(r.width), Some(r.height)),
            None => (None, None, None, None),
        };

        sqlx::query(
            r#"
            INSERT INTO highlights (
                id, book_id, user_id, document_format, cfi, page, text, chapter,
                page_percent, color, annotation, text_prefix, text_suffix,
                region_x, region_y, region_width, region_height, rects_json,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(book_id)
        .bind(user_id)
        .bind(format)
        .bind(cfi)
        .bind(data.page)
        .bind(&data.text)
        .bind(&data.chapter)
        .bind(data.page_percent)
        .bind(color)
        .bind(&data.annotation)
        .bind(&data.text_prefix)
        .bind(&data.text_suffix)
        .bind(region_x)
        .bind(region_y)
        .bind(region_width)
        .bind(region_height)
        .bind(&rects_json)
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
