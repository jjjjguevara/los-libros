//! Unified Document API endpoints
//!
//! Provides format-agnostic REST API for document management:
//! - Upload documents (PDF, EPUB)
//! - List documents
//! - Get document metadata and TOC
//! - Render items (pages/chapters)
//! - Get structured text with positions
//! - Search content with bounding boxes
//! - Get embedded resources (CSS, images, fonts, XHTML chapters)
//!
//! This is the unified API that replaces separate `/books` and `/pdf` endpoints.
//! It uses the `DocumentParser` and `DocumentRenderer` traits for format-agnostic
//! operations.
//!
//! ## EPUB Content Access
//!
//! For EPUBs, the resources endpoint supports accessing raw XHTML chapter content:
//!
//! ```
//! GET /api/v1/documents/:id/resources/OEBPS/Text/chapter1.xhtml
//! ```
//!
//! This enables client-side EPUB rendering by:
//! 1. Fetching the ToC/spine from document metadata
//! 2. Requesting raw XHTML for each chapter via the resources endpoint
//! 3. Rendering the HTML content directly in the browser
//!
//! The resources endpoint uses fuzzy path matching to handle path variations in EPUBs:
//! - Exact match first (e.g., "OEBPS/Styles/style.css")
//! - Path suffix match (e.g., "Styles/style.css" → "OEBPS/Styles/style.css")
//! - Filename match (e.g., "style.css" → any file named style.css)

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::Response,
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::document::{
    DocumentFormat, DocumentParser, DocumentRenderer, ImageFormat, ParsedDocument, RenderRequest,
    SearchOptions, StructuredText, TocEntry,
};
use crate::formats::epub::EpubDocumentHandler;
use crate::formats::pdf::PdfDocumentHandler;
use crate::state::AppState;

// ============================================================================
// Input Validation Constants
// ============================================================================

/// Maximum scale factor for rendering (matches underlying renderer limits)
const MAX_SCALE: f32 = 4.0;
/// Minimum scale factor for rendering
const MIN_SCALE: f32 = 0.1;
/// Valid rotation values in degrees
const VALID_ROTATIONS: &[u16] = &[0, 90, 180, 270];
/// Maximum search results to prevent memory exhaustion
const MAX_SEARCH_LIMIT: usize = 1000;
/// Maximum context length in characters
const MAX_CONTEXT_LENGTH: usize = 500;
/// Maximum thumbnail dimension
const MAX_THUMBNAIL_SIZE: u32 = 2048;

/// Response for document list
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentListResponse {
    pub documents: Vec<DocumentSummary>,
    pub total: usize,
}

/// Summary of a document for list view
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub id: String,
    pub format: String,
    pub title: String,
    pub author: Option<String>,
    pub item_count: usize,
}

/// Full document details response
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDetailResponse {
    pub id: String,
    pub format: String,
    pub title: String,
    pub creators: Vec<CreatorResponse>,
    pub publisher: Option<String>,
    pub description: Option<String>,
    pub date: Option<String>,
    pub toc: Vec<TocEntry>,
    pub item_count: usize,
    pub has_text_layer: bool,
}

/// Creator info response
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorResponse {
    pub name: String,
    pub role: Option<String>,
}

/// Upload response
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResponse {
    pub id: String,
    pub format: String,
    pub title: String,
    pub item_count: usize,
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

/// Query parameters for item rendering
#[derive(Debug, Deserialize)]
pub struct RenderQuery {
    /// Scale factor (default: 1.5)
    #[serde(default = "default_scale")]
    pub scale: f32,
    /// Rotation in degrees (0, 90, 180, 270)
    #[serde(default)]
    pub rotation: u16,
    /// Output format (png, jpeg, webp)
    #[serde(default)]
    pub format: String,
}

fn default_scale() -> f32 {
    1.5
}

/// Query parameters for search
#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    /// Search query
    pub q: String,
    /// Maximum results (default: 100)
    #[serde(default = "default_limit")]
    pub limit: usize,
    /// Include context (prefix/suffix)
    #[serde(default = "default_include_context")]
    pub include_context: bool,
    /// Context length in characters
    #[serde(default = "default_context_length")]
    pub context_length: usize,
    /// Case-insensitive search
    #[serde(default)]
    pub case_insensitive: bool,
    /// Whole word matching
    #[serde(default)]
    pub whole_word: bool,
}

fn default_limit() -> usize {
    100
}

fn default_include_context() -> bool {
    true
}

fn default_context_length() -> usize {
    50
}

/// Query parameters for thumbnail
#[derive(Debug, Deserialize)]
pub struct ThumbnailQuery {
    /// Maximum dimension (default: 200)
    #[serde(default = "default_thumbnail_size")]
    pub size: u32,
}

fn default_thumbnail_size() -> u32 {
    200
}

/// Search result response
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultResponse {
    pub results: Vec<SearchHit>,
    pub total: usize,
    pub query: String,
}

/// Individual search hit
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub item_index: usize,
    pub text: String,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    pub bounds: Vec<BoundingBoxResponse>,
}

/// Bounding box for search results
#[derive(Serialize)]
pub struct BoundingBoxResponse {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// Cached document entry containing all related data
/// Using a single struct prevents race conditions between separate maps
struct CachedDocument {
    parser: Arc<dyn DocumentParser>,
    renderer: Arc<dyn DocumentRenderer>,
    metadata: ParsedDocument,
}

/// In-memory document store (temporary until we integrate with the unified cache)
/// This is a placeholder - in production this would use DocumentCache
struct DocumentStore {
    /// Single map for all document data - ensures atomic inserts/lookups
    entries: tokio::sync::RwLock<std::collections::HashMap<String, CachedDocument>>,
}

impl DocumentStore {
    fn new() -> Self {
        Self {
            entries: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        }
    }

    /// Check if a document ID already exists
    async fn contains(&self, id: &str) -> bool {
        self.entries.read().await.contains_key(id)
    }

    /// Insert a document atomically (all data at once)
    async fn insert(
        &self,
        id: String,
        parser: Arc<dyn DocumentParser>,
        renderer: Arc<dyn DocumentRenderer>,
        metadata: ParsedDocument,
    ) {
        let mut entries = self.entries.write().await;
        entries.insert(
            id,
            CachedDocument {
                parser,
                renderer,
                metadata,
            },
        );
    }

    /// Remove a document atomically
    async fn remove(&self, id: &str) -> bool {
        self.entries.write().await.remove(id).is_some()
    }
}

static DOCUMENT_STORE: std::sync::LazyLock<DocumentStore> =
    std::sync::LazyLock::new(DocumentStore::new);

/// Create the documents router
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_documents).post(upload_document))
        .route("/:id", get(get_document).delete(delete_document))
        .route("/:id/items/:index/render", get(render_item))
        .route("/:id/items/:index/text", get(get_structured_text))
        .route("/:id/items/:index/thumbnail", get(render_thumbnail))
        .route("/:id/search", get(search_document))
        .route("/:id/resources/*href", get(get_resource))
        // Allow up to 200MB uploads for large documents
        .layer(DefaultBodyLimit::max(200 * 1024 * 1024))
}

/// List all cached documents
async fn list_documents(State(_state): State<AppState>) -> Json<DocumentListResponse> {
    let entries = DOCUMENT_STORE.entries.read().await;

    let summaries: Vec<DocumentSummary> = entries
        .values()
        .map(|entry| DocumentSummary {
            id: entry.metadata.id.clone(),
            format: format!("{:?}", entry.metadata.format).to_lowercase(),
            title: entry.metadata.metadata.title.clone(),
            author: entry.metadata.metadata.creators.first().map(|c| c.name.clone()),
            item_count: entry.metadata.item_count,
        })
        .collect();

    let total = summaries.len();

    Json(DocumentListResponse {
        documents: summaries,
        total,
    })
}

/// Upload a new document (PDF or EPUB)
async fn upload_document(
    State(_state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, (StatusCode, Json<ErrorResponse>)> {
    tracing::debug!("Starting document upload processing");

    // Extract the file from multipart
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::error!("Failed to read multipart field: {}", e);
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::with_details(
                "Failed to read upload",
                e.to_string(),
            )),
        )
    })? {
        let name = field.name().unwrap_or("").to_string();
        let filename = field.file_name().map(|s| s.to_string());
        let content_type = field.content_type().map(|s| s.to_string());

        tracing::debug!(
            "Received field: name='{}', filename={:?}, content_type={:?}",
            name,
            filename,
            content_type
        );

        if name == "file" || name == "document" {
            let filename = field
                .file_name()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "unknown".to_string());

            // Read file bytes
            let data = field.bytes().await.map_err(|e| {
                tracing::error!("Failed to read file data: {}", e);
                (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse::with_details(
                        "Failed to read file data",
                        e.to_string(),
                    )),
                )
            })?;

            tracing::debug!("Read {} bytes of file data", data.len());

            // Detect format from magic bytes
            let format = DocumentFormat::from_magic_bytes(&data).ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse::new(
                        "Unsupported document format. Only PDF and EPUB are supported.",
                    )),
                )
            })?;

            // Generate document ID from filename
            let extension = match format {
                DocumentFormat::Pdf => ".pdf",
                DocumentFormat::Epub => ".epub",
            };
            let doc_id = filename
                .strip_suffix(extension)
                .unwrap_or(&filename)
                .to_string();

            // Check if document ID already exists (prevent silent overwrites)
            if DOCUMENT_STORE.contains(&doc_id).await {
                return Err((
                    StatusCode::CONFLICT,
                    Json(ErrorResponse::new(format!(
                        "Document with ID '{}' already exists. Use DELETE first to replace.",
                        doc_id
                    ))),
                ));
            }

            // Parse the document based on format
            let (parser, renderer, parsed): (
                Arc<dyn DocumentParser>,
                Arc<dyn DocumentRenderer>,
                ParsedDocument,
            ) = match format {
                DocumentFormat::Pdf => {
                    let handler = PdfDocumentHandler::from_bytes(data.to_vec(), doc_id.clone())
                        .map_err(|e| {
                            tracing::error!("Failed to parse PDF: {}", e);
                            (
                                StatusCode::BAD_REQUEST,
                                Json(ErrorResponse::with_details(
                                    "Failed to parse PDF",
                                    e.to_string(),
                                )),
                            )
                        })?;
                    let handler = Arc::new(handler);
                    let parsed = handler.parse().await.map_err(|e| {
                        (
                            StatusCode::BAD_REQUEST,
                            Json(ErrorResponse::with_details(
                                "Failed to parse PDF metadata",
                                e.to_string(),
                            )),
                        )
                    })?;
                    (handler.clone(), handler, parsed)
                }
                DocumentFormat::Epub => {
                    let handler = EpubDocumentHandler::from_bytes(data.to_vec(), doc_id.clone())
                        .map_err(|e| {
                            tracing::error!("Failed to parse EPUB: {}", e);
                            (
                                StatusCode::BAD_REQUEST,
                                Json(ErrorResponse::with_details(
                                    "Failed to parse EPUB",
                                    e.to_string(),
                                )),
                            )
                        })?;
                    let handler = Arc::new(handler);
                    let parsed = handler.parse().await.map_err(|e| {
                        (
                            StatusCode::BAD_REQUEST,
                            Json(ErrorResponse::with_details(
                                "Failed to parse EPUB metadata",
                                e.to_string(),
                            )),
                        )
                    })?;
                    (handler.clone(), handler, parsed)
                }
            };

            // Store atomically in our temporary store
            let id = parsed.id.clone();
            let title = parsed.metadata.title.clone();
            let item_count = parsed.item_count;
            let format_str = format!("{:?}", format).to_lowercase();

            DOCUMENT_STORE
                .insert(id.clone(), parser, renderer, parsed)
                .await;

            tracing::info!(
                "Document uploaded: '{}' ({}) with {} items",
                id,
                format_str,
                item_count
            );

            return Ok(Json(UploadResponse {
                id,
                format: format_str,
                title,
                item_count,
                message: "Document uploaded successfully".to_string(),
            }));
        }
    }

    tracing::warn!("No file field found in multipart upload");
    Err((
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse::new(
            "No file provided. Use field name 'file' or 'document'",
        )),
    ))
}

/// Get document details by ID
async fn get_document(
    State(_state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<DocumentDetailResponse>, (StatusCode, Json<ErrorResponse>)> {
    tracing::debug!("Looking up document with ID: '{}'", id);

    let entries = DOCUMENT_STORE.entries.read().await;
    let entry = entries.get(&id).ok_or_else(|| {
        tracing::warn!("Document '{}' not found", id);
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("Document '{}' not found", id))),
        )
    })?;
    let doc = &entry.metadata;

    Ok(Json(DocumentDetailResponse {
        id: doc.id.clone(),
        format: format!("{:?}", doc.format).to_lowercase(),
        title: doc.metadata.title.clone(),
        creators: doc
            .metadata
            .creators
            .iter()
            .map(|c| CreatorResponse {
                name: c.name.clone(),
                role: c.role.clone(),
            })
            .collect(),
        publisher: doc.metadata.publisher.clone(),
        description: doc.metadata.description.clone(),
        date: doc.metadata.date.clone(),
        toc: doc.toc.clone(),
        item_count: doc.item_count,
        has_text_layer: doc.has_text_layer,
    }))
}

/// Delete a document
async fn delete_document(
    State(_state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    // Remove atomically - returns false if document didn't exist
    if !DOCUMENT_STORE.remove(&id).await {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("Document '{}' not found", id))),
        ));
    }

    tracing::info!("Document '{}' deleted", id);
    Ok(StatusCode::NO_CONTENT)
}

/// Render an item (page for PDF, chapter for EPUB) as an image
async fn render_item(
    State(_state): State<AppState>,
    Path((id, index)): Path<(String, usize)>,
    Query(query): Query<RenderQuery>,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    // Validate rotation parameter
    if !VALID_ROTATIONS.contains(&query.rotation) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(
                "Rotation must be 0, 90, 180, or 270 degrees",
            )),
        ));
    }

    // Clamp scale to valid range
    let scale = query.scale.clamp(MIN_SCALE, MAX_SCALE);

    // Get entry (contains renderer, parser, and metadata)
    let entries = DOCUMENT_STORE.entries.read().await;
    let entry = entries.get(&id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("Document '{}' not found", id))),
        )
    })?;

    // Validate item index before expensive rendering
    if index >= entry.metadata.item_count {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!(
                "Item {} not found. Document has {} items (0-{})",
                index,
                entry.metadata.item_count,
                entry.metadata.item_count.saturating_sub(1)
            ))),
        ));
    }

    // Parse format
    let format = match query.format.to_lowercase().as_str() {
        "jpeg" | "jpg" => ImageFormat::Jpeg,
        "webp" => ImageFormat::Webp,
        _ => ImageFormat::Png,
    };

    let request = RenderRequest {
        item_index: index,
        scale,
        format,
        rotation: query.rotation,
        ..Default::default()
    };

    let result = entry.renderer.render_item(&request).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details(
                format!("Failed to render item {} of document '{}'", index, id),
                e.to_string(),
            )),
        )
    })?;

    // Build response with proper content type
    let content_type = match result.format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::Webp => "image/webp",
    };

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "max-age=3600")
        .body(Body::from(result.data))
        .expect("hardcoded headers cannot fail");

    Ok(response)
}

/// Get structured text with character positions for an item
async fn get_structured_text(
    State(_state): State<AppState>,
    Path((id, index)): Path<(String, usize)>,
) -> Result<Json<StructuredText>, (StatusCode, Json<ErrorResponse>)> {
    // Get entry
    let entries = DOCUMENT_STORE.entries.read().await;
    let entry = entries.get(&id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("Document '{}' not found", id))),
        )
    })?;

    // Validate item index before expensive operation
    if index >= entry.metadata.item_count {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!(
                "Item {} not found. Document has {} items (0-{})",
                index,
                entry.metadata.item_count,
                entry.metadata.item_count.saturating_sub(1)
            ))),
        ));
    }

    let stext = entry.parser.get_structured_text(index).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details(
                format!(
                    "Failed to get structured text for item {} of document '{}'",
                    index, id
                ),
                e.to_string(),
            )),
        )
    })?;

    Ok(Json(stext))
}

/// Render a thumbnail for an item
async fn render_thumbnail(
    State(_state): State<AppState>,
    Path((id, index)): Path<(String, usize)>,
    Query(query): Query<ThumbnailQuery>,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    // Clamp size to valid range
    let size = query.size.min(MAX_THUMBNAIL_SIZE);

    // Get entry
    let entries = DOCUMENT_STORE.entries.read().await;
    let entry = entries.get(&id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("Document '{}' not found", id))),
        )
    })?;

    // Validate item index before expensive operation
    if index >= entry.metadata.item_count {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!(
                "Item {} not found. Document has {} items (0-{})",
                index,
                entry.metadata.item_count,
                entry.metadata.item_count.saturating_sub(1)
            ))),
        ));
    }

    let result = entry
        .renderer
        .render_thumbnail(index, size)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    format!(
                        "Failed to render thumbnail for item {} of document '{}'",
                        index, id
                    ),
                    e.to_string(),
                )),
            )
        })?;

    // Thumbnails are typically JPEG
    let content_type = match result.format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::Webp => "image/webp",
    };

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "max-age=86400")
        .body(Body::from(result.data))
        .expect("hardcoded headers cannot fail");

    Ok(response)
}

/// Search document content
async fn search_document(
    State(_state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<SearchResultResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Clamp search parameters to prevent resource exhaustion
    let limit = query.limit.min(MAX_SEARCH_LIMIT);
    let context_length = query.context_length.min(MAX_CONTEXT_LENGTH);

    // Get entry
    let entries = DOCUMENT_STORE.entries.read().await;
    let entry = entries.get(&id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("Document '{}' not found", id))),
        )
    })?;

    let options = SearchOptions {
        limit,
        include_context: query.include_context,
        context_length,
        case_insensitive: query.case_insensitive,
        whole_word: query.whole_word,
        ..Default::default()
    };

    let results = entry.parser.search(&query.q, options).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details(
                format!("Failed to search document '{}'", id),
                e.to_string(),
            )),
        )
    })?;

    let total = results.len();
    let hits: Vec<SearchHit> = results
        .into_iter()
        .map(|r| SearchHit {
            item_index: r.item_index,
            text: r.text,
            prefix: r.prefix,
            suffix: r.suffix,
            bounds: r
                .bounds
                .into_iter()
                .map(|b| BoundingBoxResponse {
                    x: b.x,
                    y: b.y,
                    width: b.width,
                    height: b.height,
                })
                .collect(),
        })
        .collect();

    Ok(Json(SearchResultResponse {
        results: hits,
        total,
        query: query.q,
    }))
}

/// Get an embedded resource (image, CSS, font)
async fn get_resource(
    State(_state): State<AppState>,
    Path((id, href)): Path<(String, String)>,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    // Get entry
    let entries = DOCUMENT_STORE.entries.read().await;
    let entry = entries.get(&id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("Document '{}' not found", id))),
        )
    })?;

    let resource = entry.renderer.get_resource(&href).await.map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::with_details(
                format!("Resource '{}' not found in document '{}'", href, id),
                e.to_string(),
            )),
        )
    })?;

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, resource.mime_type)
        .header(header::CACHE_CONTROL, "max-age=3600")
        .body(Body::from(resource.content))
        .expect("hardcoded headers cannot fail");

    Ok(response)
}
