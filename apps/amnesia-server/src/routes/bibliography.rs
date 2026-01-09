//! Bibliography API routes
//!
//! Endpoints for generating citations in various academic formats.

use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::bibliography::{
    generate_bibtex, generate_citation, generate_citation_list, BookMetadata, CitationFormat,
};
use crate::error::{AppError, Result};
use crate::state::AppState;

/// Create the bibliography router
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/books/:book_id/citation", get(get_book_citation))
        .route("/generate", post(batch_generate_citations))
        .route("/formats", get(list_formats))
}

/// Query parameters for citation request
#[derive(Debug, Deserialize)]
pub struct CitationQuery {
    /// Citation format (bibtex, apa, mla, chicago, ieee)
    #[serde(default = "default_format")]
    pub format: String,
}

fn default_format() -> String {
    "bibtex".to_string()
}

/// Get a citation for a specific book
///
/// GET /api/v1/bibliography/books/{book_id}/citation?format=bibtex
async fn get_book_citation(
    State(state): State<AppState>,
    Path(book_id): Path<String>,
    Query(query): Query<CitationQuery>,
) -> Result<Response> {
    // Parse format
    let format: CitationFormat = query
        .format
        .parse()
        .map_err(|_| AppError::BadRequest(format!("Invalid format: {}", query.format)))?;

    // Get book metadata from database
    let metadata = get_book_metadata(&state, &book_id).await?;

    // Generate citation
    let citation = generate_citation(&metadata, format)
        .map_err(|e| AppError::Internal(format!("Citation generation failed: {}", e)))?;

    // Return with appropriate content type
    let content_type = match format {
        CitationFormat::BibTeX => "application/x-bibtex",
        _ => "text/plain",
    };

    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, content_type)],
        citation,
    )
        .into_response())
}

/// Batch generation request
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchGenerateRequest {
    /// Book IDs to generate citations for
    pub book_ids: Vec<String>,
    /// Citation format
    #[serde(default = "default_format")]
    pub format: String,
    /// Optional: provide metadata directly instead of fetching from DB
    pub metadata: Option<Vec<BookMetadata>>,
}

/// Batch generation response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchGenerateResponse {
    pub format: String,
    pub count: usize,
    pub citations: String,
    pub errors: Vec<BatchError>,
}

/// Error for individual book in batch
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchError {
    pub book_id: String,
    pub error: String,
}

/// Batch generate citations
///
/// POST /api/v1/bibliography/generate
async fn batch_generate_citations(
    State(state): State<AppState>,
    Json(request): Json<BatchGenerateRequest>,
) -> Result<Json<BatchGenerateResponse>> {
    let format: CitationFormat = request
        .format
        .parse()
        .map_err(|_| AppError::BadRequest(format!("Invalid format: {}", request.format)))?;

    let mut metadata_list = Vec::new();
    let mut errors = Vec::new();

    // Use provided metadata or fetch from database
    if let Some(provided_metadata) = request.metadata {
        metadata_list = provided_metadata;
    } else {
        for book_id in &request.book_ids {
            match get_book_metadata(&state, book_id).await {
                Ok(metadata) => metadata_list.push(metadata),
                Err(e) => {
                    errors.push(BatchError {
                        book_id: book_id.clone(),
                        error: e.to_string(),
                    });
                }
            }
        }
    }

    // Generate citations
    let citations = generate_citation_list(&metadata_list, format)
        .map_err(|e| AppError::Internal(format!("Citation generation failed: {}", e)))?;

    Ok(Json(BatchGenerateResponse {
        format: request.format,
        count: metadata_list.len(),
        citations,
        errors,
    }))
}

/// Available formats response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatsResponse {
    pub formats: Vec<FormatInfo>,
}

/// Information about a citation format
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub use_case: String,
}

/// List available citation formats
///
/// GET /api/v1/bibliography/formats
async fn list_formats() -> Json<FormatsResponse> {
    Json(FormatsResponse {
        formats: vec![
            FormatInfo {
                id: "bibtex".to_string(),
                name: "BibTeX".to_string(),
                description: "LaTeX bibliography format".to_string(),
                use_case: "LaTeX documents, reference managers".to_string(),
            },
            FormatInfo {
                id: "apa".to_string(),
                name: "APA 7th Edition".to_string(),
                description: "American Psychological Association, 7th edition".to_string(),
                use_case: "Psychology, social sciences, education".to_string(),
            },
            FormatInfo {
                id: "mla".to_string(),
                name: "MLA 9th Edition".to_string(),
                description: "Modern Language Association, 9th edition".to_string(),
                use_case: "Literature, humanities, arts".to_string(),
            },
            FormatInfo {
                id: "chicago".to_string(),
                name: "Chicago 17th Edition".to_string(),
                description: "Chicago Manual of Style, 17th edition".to_string(),
                use_case: "History, publishing".to_string(),
            },
            FormatInfo {
                id: "ieee".to_string(),
                name: "IEEE".to_string(),
                description: "Institute of Electrical and Electronics Engineers".to_string(),
                use_case: "Engineering, computer science".to_string(),
            },
        ],
    })
}

/// Fetch book metadata from database
async fn get_book_metadata(state: &AppState, book_id: &str) -> Result<BookMetadata> {
    // Query book from database
    let book: Option<BookRow> = sqlx::query_as(
        r#"
        SELECT id, title, authors, metadata, created_at
        FROM books
        WHERE id = ?
        "#,
    )
    .bind(book_id)
    .fetch_optional(state.db())
    .await?;

    let book = book.ok_or_else(|| AppError::NotFound(format!("Book not found: {}", book_id)))?;

    // Parse additional metadata from JSON if available
    let extra_metadata: Option<ExtraMetadata> = book
        .metadata
        .as_ref()
        .and_then(|m| serde_json::from_str(m).ok());

    // Build BookMetadata
    let authors: Vec<String> = book
        .authors
        .as_ref()
        .map(|a| a.split(',').map(|s| s.trim().to_string()).collect())
        .unwrap_or_default();

    Ok(BookMetadata {
        id: book.id,
        title: book.title,
        authors,
        year: extra_metadata.as_ref().and_then(|m| m.year),
        publisher: extra_metadata.as_ref().and_then(|m| m.publisher.clone()),
        isbn: extra_metadata.as_ref().and_then(|m| m.isbn.clone()),
        doi: extra_metadata.as_ref().and_then(|m| m.doi.clone()),
        url: extra_metadata.as_ref().and_then(|m| m.url.clone()),
        place: extra_metadata.as_ref().and_then(|m| m.place.clone()),
        edition: extra_metadata.as_ref().and_then(|m| m.edition.clone()),
        series: extra_metadata.as_ref().and_then(|m| m.series.clone()),
        volume: extra_metadata.as_ref().and_then(|m| m.volume.clone()),
        pages: extra_metadata.as_ref().and_then(|m| m.pages),
        language: extra_metadata.as_ref().and_then(|m| m.language.clone()),
        abstract_text: extra_metadata.as_ref().and_then(|m| m.abstract_text.clone()),
        keywords: extra_metadata
            .as_ref()
            .map(|m| m.keywords.clone())
            .unwrap_or_default(),
    })
}

/// Database row for book query
#[derive(sqlx::FromRow)]
struct BookRow {
    id: String,
    title: String,
    authors: Option<String>,
    metadata: Option<String>,
    created_at: String,
}

/// Extra metadata stored in JSON
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtraMetadata {
    year: Option<i32>,
    publisher: Option<String>,
    isbn: Option<String>,
    doi: Option<String>,
    url: Option<String>,
    place: Option<String>,
    edition: Option<String>,
    series: Option<String>,
    volume: Option<String>,
    pages: Option<i32>,
    language: Option<String>,
    abstract_text: Option<String>,
    #[serde(default)]
    keywords: Vec<String>,
}
