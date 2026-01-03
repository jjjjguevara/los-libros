//! Book API endpoints
//!
//! Provides REST API for EPUB book management:
//! - Upload books
//! - List books
//! - Get book metadata and TOC
//! - Get chapter content
//! - Get resources (images, CSS, fonts)

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::io::Cursor;

use crate::epub::{BookMetadata, ParsedBook, SpineItem, TocEntry};
use crate::state::AppState;

/// Response for book list
#[derive(Serialize)]
pub struct BookListResponse {
    pub books: Vec<BookSummary>,
    pub total: usize,
}

/// Summary of a book for list view
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookSummary {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub cover_href: Option<String>,
}

/// Full book details response
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookDetailResponse {
    pub id: String,
    pub metadata: BookMetadata,
    pub toc: Vec<TocEntry>,
    pub spine: Vec<SpineItem>,
    pub chapter_count: usize,
}

/// Chapter content response
#[derive(Serialize)]
pub struct ChapterResponse {
    pub index: usize,
    pub href: String,
    pub title: Option<String>,
    pub html: String,
}

/// Upload response
#[derive(Serialize)]
pub struct UploadResponse {
    pub id: String,
    pub title: String,
    pub message: String,
}

/// Error response
#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
    pub details: Option<String>,
}

impl ErrorResponse {
    fn new(error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            details: None,
        }
    }

    fn with_details(error: impl Into<String>, details: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            details: Some(details.into()),
        }
    }
}

/// Create the books router
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_books).post(upload_book))
        .route("/:id", get(get_book).delete(delete_book))
        .route("/:id/chapters/*href", get(get_chapter))
        .route("/:id/resources/*href", get(get_resource))
        // Allow up to 100MB uploads for large EPUBs
        .layer(DefaultBodyLimit::max(100 * 1024 * 1024))
}

/// List all cached books
async fn list_books(State(state): State<AppState>) -> Json<BookListResponse> {
    let books = state.book_cache().get_all_books().await;

    let summaries: Vec<BookSummary> = books
        .iter()
        .map(|book| BookSummary {
            id: book.id.clone(),
            title: book.metadata.title.clone(),
            author: book.metadata.creators.first().map(|c| c.name.clone()),
            cover_href: book.metadata.cover_href.clone(),
        })
        .collect();

    let total = summaries.len();

    Json(BookListResponse {
        books: summaries,
        total,
    })
}

/// Upload a new EPUB book
async fn upload_book(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, (StatusCode, Json<ErrorResponse>)> {
    tracing::debug!("Starting book upload processing");

    // Extract the file from multipart
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::error!("Failed to read multipart field: {}", e);
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::with_details("Failed to read upload", e.to_string())),
        )
    })? {
        let name = field.name().unwrap_or("").to_string();
        let filename = field.file_name().map(|s| s.to_string());
        let content_type = field.content_type().map(|s| s.to_string());

        tracing::debug!(
            "Received field: name='{}', filename={:?}, content_type={:?}",
            name, filename, content_type
        );

        if name == "file" || name == "epub" {
            let filename = field
                .file_name()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "unknown.epub".to_string());

            // Generate book ID from filename
            let book_id = filename
                .strip_suffix(".epub")
                .unwrap_or(&filename)
                .to_string();

            // Read file bytes
            let data = field.bytes().await.map_err(|e| {
                tracing::error!("Failed to read file data: {}", e);
                (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse::with_details("Failed to read file data", e.to_string())),
                )
            })?;

            tracing::debug!("Read {} bytes of file data", data.len());

            // Parse the EPUB
            let cursor = Cursor::new(data.to_vec());
            let book = state
                .book_cache()
                .load_from_reader(cursor, book_id.clone())
                .await
                .map_err(|e| {
                    tracing::error!("Failed to parse EPUB: {}", e);
                    (
                        StatusCode::BAD_REQUEST,
                        Json(ErrorResponse::with_details("Failed to parse EPUB", e.to_string())),
                    )
                })?;

            tracing::debug!("Book uploaded with ID: '{}'", book.id);
            return Ok(Json(UploadResponse {
                id: book.id.clone(),
                title: book.metadata.title.clone(),
                message: "Book uploaded successfully".to_string(),
            }));
        }
    }

    tracing::warn!("No file field found in multipart upload");
    Err((
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse::new("No file provided. Use field name 'file' or 'epub'")),
    ))
}

/// Get book details by ID
async fn get_book(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<BookDetailResponse>, (StatusCode, Json<ErrorResponse>)> {
    tracing::debug!("Looking up book with ID: '{}'", id);

    let book = state.book_cache().get_book(&id).await.ok_or_else(|| {
        // List available books for debugging
        tracing::warn!("Book '{}' not found in cache", id);
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("Book '{}' not found", id))),
        )
    })?;

    Ok(Json(BookDetailResponse {
        id: book.id,
        metadata: book.metadata,
        toc: book.toc,
        chapter_count: book.spine.len(),
        spine: book.spine,
    }))
}

/// Delete a book from cache
async fn delete_book(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    if !state.book_cache().contains(&id).await {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("Book '{}' not found", id))),
        ));
    }

    state.book_cache().remove(&id).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Get chapter content by href
async fn get_chapter(
    State(state): State<AppState>,
    Path((id, href)): Path<(String, String)>,
) -> Result<Json<ChapterResponse>, (StatusCode, Json<ErrorResponse>)> {
    let chapter = state
        .book_cache()
        .get_chapter_by_href(&id, &href)
        .await
        .map_err(|e| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::with_details(
                    format!("Chapter '{}' not found in book '{}'", href, id),
                    e.to_string(),
                )),
            )
        })?;

    Ok(Json(ChapterResponse {
        index: chapter.index,
        href: chapter.href,
        title: chapter.title,
        html: chapter.html,
    }))
}

/// Get resource (image, CSS, font) by href
async fn get_resource(
    State(state): State<AppState>,
    Path((id, href)): Path<(String, String)>,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    let resource = state
        .book_cache()
        .get_resource(&id, &href)
        .await
        .map_err(|e| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::with_details(
                    format!("Resource '{}' not found in book '{}'", href, id),
                    e.to_string(),
                )),
            )
        })?;

    // Build response with proper content type
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, resource.media_type)
        .header(header::CACHE_CONTROL, "max-age=3600")
        .body(Body::from(resource.data))
        .unwrap();

    Ok(response)
}
