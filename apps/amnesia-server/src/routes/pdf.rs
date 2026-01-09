//! PDF API endpoints
//!
//! **DEPRECATED**: This API is deprecated in favor of `/api/v1/documents`.
//! See `routes/documents.rs` for the unified document API that handles both PDF and EPUB.
//!
//! Migration guide:
//! - `GET /api/v1/pdf/:id` → `GET /api/v1/documents/:id`
//! - `GET /api/v1/pdf/:id/pages/:page` → `GET /api/v1/documents/:id/items/:index/render`
//! - `GET /api/v1/pdf/:id/pages/:page/text` → `GET /api/v1/documents/:id/items/:index/text`
//! - `GET /api/v1/pdf/:id/pages/:page/thumbnail` → `GET /api/v1/documents/:id/items/:index/thumbnail`
//! - `GET /api/v1/pdf/:id/search` → `GET /api/v1/documents/:id/search`
//!
//! PDF-specific endpoints (OCR, forms) have no equivalent in the documents API yet.
//!
//! Legacy endpoints - provides REST API for PDF document management:
//! - Upload PDFs
//! - List PDFs
//! - Get PDF metadata and TOC
//! - Render pages
//! - Get text layers
//! - Search content

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{header, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::db::{CreateHighlight, Highlight, HighlightRepository, UpdateHighlight};
use crate::document::TocEntry;
use crate::ocr::{OcrRect, OcrRequest, OcrResult, OcrService, OcrServiceConfig};
use crate::pdf::{
    FormField, FormInfo, ImageFormat, PageRenderRequest, ParsedPdf, PdfMetadata, PdfSearchResult,
    SignatureInfo, TextLayer,
};
use crate::state::AppState;

/// Response for PDF list
#[derive(Serialize)]
pub struct PdfListResponse {
    pub pdfs: Vec<PdfSummary>,
    pub total: usize,
}

/// Summary of a PDF for list view
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfSummary {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub page_count: usize,
}

/// Full PDF details response
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfDetailResponse {
    pub id: String,
    pub metadata: PdfMetadata,
    pub toc: Vec<TocEntry>,
    pub page_count: usize,
    pub has_text_layer: bool,
    pub orientation: String,
}

/// Upload response
#[derive(Serialize)]
pub struct UploadResponse {
    pub id: String,
    pub title: String,
    pub message: String,
    pub page_count: usize,
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

/// Query parameters for page rendering
#[derive(Debug, Deserialize)]
pub struct PageRenderQuery {
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
    /// Maximum results (default: 50)
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
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

/// Validate page number is within PDF bounds
/// Returns the PDF if valid, or an error response if invalid
async fn validate_page_range(
    state: &AppState,
    id: &str,
    page: usize,
) -> Result<ParsedPdf, (StatusCode, Json<ErrorResponse>)> {
    // First check PDF exists
    let pdf = state.pdf_cache().get_pdf(id).await.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
        )
    })?;

    // Validate page range (pages are 1-indexed)
    if page < 1 || page > pdf.page_count {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::with_details(
                "Invalid page number",
                format!(
                    "Page {} is out of range. PDF '{}' has {} pages (valid range: 1-{})",
                    page, id, pdf.page_count, pdf.page_count
                ),
            )),
        ));
    }

    Ok(pdf)
}

/// Middleware to add deprecation headers to all responses
///
/// Adds RFC-compliant deprecation headers:
/// - `Deprecation`: RFC 9745 format (Unix timestamp with @ prefix)
/// - `Sunset`: RFC 8594 format (HTTP-date)
/// - `Link`: RFC 8288 alternate relation to successor API
async fn add_deprecation_header(
    request: axum::http::Request<Body>,
    next: Next,
) -> Response {
    let mut response = next.run(request).await;

    // Deprecation header (RFC 9745) - Unix timestamp for June 1, 2026 00:00:00 UTC
    // Indicates when the API was deprecated
    response.headers_mut().insert(
        "Deprecation",
        HeaderValue::from_static("@1767225600"),
    );

    // Sunset header (RFC 8594) - HTTP-date format (RFC 7231)
    // Indicates when the API will be removed
    response.headers_mut().insert(
        "Sunset",
        HeaderValue::from_static("Mon, 01 Jun 2026 00:00:00 GMT"),
    );

    // Link header (RFC 8288) - Points to replacement API
    // Using rel="alternate" as this is a different resource representation
    response.headers_mut().insert(
        "Link",
        HeaderValue::from_static("</api/v1/documents>; rel=\"alternate\""),
    );

    response
}

/// Create the PDF router
///
/// **DEPRECATED**: Use `/api/v1/documents` instead.
/// This router adds deprecation headers to all responses.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_pdfs).post(upload_pdf))
        .route("/:id", get(get_pdf).delete(delete_pdf))
        .route("/:id/pages/:page", get(render_page))
        .route("/:id/pages/:page/text", get(get_text_layer))
        .route("/:id/pages/:page/thumbnail", get(render_thumbnail))
        .route("/:id/pages/:page/ocr", post(ocr_region))
        .route("/:id/search", get(search_pdf))
        .route("/:id/ocr/providers", get(list_ocr_providers))
        // Annotations (per Phase 8 plan)
        .route(
            "/:id/annotations",
            get(list_annotations).post(create_annotation),
        )
        .route(
            "/:id/annotations/:annotation_id",
            get(get_annotation)
                .put(update_annotation)
                .delete(delete_annotation),
        )
        // Forms (Phase 9)
        .route("/:id/forms", get(get_form_info))
        .route("/:id/forms/fields", get(list_form_fields))
        .route("/:id/forms/signatures", get(list_signatures))
        // Allow up to 200MB uploads for large PDFs
        .layer(DefaultBodyLimit::max(200 * 1024 * 1024))
        // Add deprecation headers to all responses
        .layer(middleware::from_fn(add_deprecation_header))
}

/// List all cached PDFs
async fn list_pdfs(State(state): State<AppState>) -> Json<PdfListResponse> {
    let pdfs = state.pdf_cache().get_all_pdfs().await;

    let summaries: Vec<PdfSummary> = pdfs
        .iter()
        .map(|pdf| PdfSummary {
            id: pdf.id.clone(),
            title: pdf.metadata.title.clone(),
            author: pdf.metadata.author.clone(),
            page_count: pdf.page_count,
        })
        .collect();

    let total = summaries.len();

    Json(PdfListResponse {
        pdfs: summaries,
        total,
    })
}

/// Upload a new PDF
async fn upload_pdf(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, (StatusCode, Json<ErrorResponse>)> {
    tracing::debug!("Starting PDF upload processing");

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

        if name == "file" || name == "pdf" {
            let filename = field
                .file_name()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "unknown.pdf".to_string());

            // Generate PDF ID from filename
            let pdf_id = filename
                .strip_suffix(".pdf")
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

            // Parse the PDF
            let pdf = state
                .pdf_cache()
                .load_from_bytes(&data, pdf_id.clone())
                .await
                .map_err(|e| {
                    tracing::error!("Failed to parse PDF: {}", e);
                    (
                        StatusCode::BAD_REQUEST,
                        Json(ErrorResponse::with_details("Failed to parse PDF", e.to_string())),
                    )
                })?;

            tracing::info!("PDF uploaded: '{}' with {} pages", pdf.id, pdf.page_count);

            // Background pre-render first page at common scales for faster initial load
            let cache_clone = state.pdf_cache().clone();
            let pdf_id_clone = pdf.id.clone();
            tokio::spawn(async move {
                for scale in [1.0, 1.5, 2.0] {
                    let request = PageRenderRequest {
                        page: 1,
                        scale,
                        format: ImageFormat::Png,
                        rotation: 0,
                    };
                    match cache_clone.render_page(&pdf_id_clone, &request).await {
                        Ok(_) => tracing::debug!("Pre-rendered page 1 at scale {} for '{}'", scale, pdf_id_clone),
                        Err(e) => tracing::debug!("Pre-render skipped for '{}' at scale {}: {}", pdf_id_clone, scale, e),
                    }
                }
            });

            return Ok(Json(UploadResponse {
                id: pdf.id.clone(),
                title: pdf.metadata.title.clone(),
                message: "PDF uploaded successfully".to_string(),
                page_count: pdf.page_count,
            }));
        }
    }

    tracing::warn!("No file field found in multipart upload");
    Err((
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse::new("No file provided. Use field name 'file' or 'pdf'")),
    ))
}

/// Get PDF details by ID
async fn get_pdf(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<PdfDetailResponse>, (StatusCode, Json<ErrorResponse>)> {
    tracing::debug!("Looking up PDF with ID: '{}'", id);

    let pdf = state.pdf_cache().get_pdf(&id).await.ok_or_else(|| {
        tracing::warn!("PDF '{}' not found in cache", id);
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
        )
    })?;

    Ok(Json(PdfDetailResponse {
        id: pdf.id,
        metadata: pdf.metadata,
        toc: pdf.toc,
        page_count: pdf.page_count,
        has_text_layer: pdf.has_text_layer,
        orientation: format!("{:?}", pdf.orientation).to_lowercase(),
    }))
}

/// Delete a PDF from cache
async fn delete_pdf(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    if !state.pdf_cache().contains(&id).await {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
        ));
    }

    state.pdf_cache().remove(&id).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Render a page as an image
async fn render_page(
    State(state): State<AppState>,
    Path((id, page)): Path<(String, usize)>,
    Query(query): Query<PageRenderQuery>,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    // Validate page exists before rendering
    validate_page_range(&state, &id, page).await?;

    // Parse format
    let format = match query.format.to_lowercase().as_str() {
        "jpeg" | "jpg" => ImageFormat::Jpeg,
        "webp" => ImageFormat::Webp,
        _ => ImageFormat::Png,
    };

    let request = PageRenderRequest {
        page,
        scale: query.scale,
        format,
        rotation: query.rotation,
    };

    let data = state
        .pdf_cache()
        .render_page(&id, &request)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    format!("Failed to render page {} of PDF '{}'", page, id),
                    e.to_string(),
                )),
            )
        })?;

    // Build response with proper content type
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, format.content_type())
        .header(header::CACHE_CONTROL, "max-age=3600")
        .body(Body::from(data))
        .unwrap();

    Ok(response)
}

/// Render a thumbnail
async fn render_thumbnail(
    State(state): State<AppState>,
    Path((id, page)): Path<(String, usize)>,
    Query(query): Query<ThumbnailQuery>,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    // Validate page exists before rendering
    validate_page_range(&state, &id, page).await?;

    let data = state
        .pdf_cache()
        .render_thumbnail(&id, page, query.size)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    format!("Failed to render thumbnail for page {} of PDF '{}'", page, id),
                    e.to_string(),
                )),
            )
        })?;

    // Thumbnails are always JPEG
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header(header::CACHE_CONTROL, "max-age=86400") // Cache thumbnails longer
        .body(Body::from(data))
        .unwrap();

    Ok(response)
}

/// Get text layer for a page
async fn get_text_layer(
    State(state): State<AppState>,
    Path((id, page)): Path<(String, usize)>,
) -> Result<Json<TextLayer>, (StatusCode, Json<ErrorResponse>)> {
    // Validate page exists before extracting text
    validate_page_range(&state, &id, page).await?;

    let layer = state
        .pdf_cache()
        .get_text_layer(&id, page)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    format!("Failed to get text layer for page {} of PDF '{}'", page, id),
                    e.to_string(),
                )),
            )
        })?;

    Ok(Json(layer))
}

/// Search PDF content
async fn search_pdf(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<PdfSearchResult>>, (StatusCode, Json<ErrorResponse>)> {
    let results = state
        .pdf_cache()
        .search(&id, &query.q, query.limit)
        .await
        .map_err(|e| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::with_details(
                    format!("Failed to search PDF '{}'", id),
                    e.to_string(),
                )),
            )
        })?;

    Ok(Json(results))
}

/// Response for available OCR providers
#[derive(Serialize)]
pub struct OcrProvidersResponse {
    pub providers: Vec<String>,
}

/// List available OCR providers
async fn list_ocr_providers(
    State(_state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<OcrProvidersResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Check if PDF exists
    if !_state.pdf_cache().contains(&id).await {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
        ));
    }

    // Create OCR service and get available providers
    let config = OcrServiceConfig::default();
    let service = OcrService::new(config);
    let providers = service.available_providers().await;

    let provider_names: Vec<String> = providers
        .into_iter()
        .map(|p| format!("{:?}", p).to_lowercase())
        .collect();

    Ok(Json(OcrProvidersResponse {
        providers: provider_names,
    }))
}

/// OCR a region of a PDF page
async fn ocr_region(
    State(state): State<AppState>,
    Path((id, page)): Path<(String, usize)>,
    Json(request): Json<OcrRequest>,
) -> Result<Json<OcrResult>, (StatusCode, Json<ErrorResponse>)> {
    tracing::debug!(
        "OCR request for PDF '{}' page {} region {:?}",
        id,
        page,
        request.rect
    );

    // Check if PDF exists
    if !state.pdf_cache().contains(&id).await {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
        ));
    }

    // Create OCR service
    let config = OcrServiceConfig::default();
    let service = OcrService::new(config);

    // Perform OCR
    let result = service
        .ocr_pdf_region(
            &id,
            page,
            &request.rect,
            request.provider,
            request.language.as_deref(),
            state.pdf_cache(),
        )
        .await
        .map_err(|e| {
            tracing::error!("OCR failed for PDF '{}' page {}: {}", id, page, e);
            (
                e.status_code(),
                Json(ErrorResponse::with_details(
                    format!("OCR failed for page {} of PDF '{}'", page, id),
                    e.to_string(),
                )),
            )
        })?;

    tracing::info!(
        "OCR completed for PDF '{}' page {} using {:?} (confidence: {:.1}%)",
        id,
        page,
        result.provider,
        result.confidence
    );

    Ok(Json(result))
}

// ============================================================================
// PDF Annotations API (Phase 8)
// ============================================================================

/// Response for annotations list
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationsResponse {
    pub annotations: Vec<Highlight>,
    pub total: usize,
}

/// List all annotations for a PDF
async fn list_annotations(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<AnnotationsResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Check if PDF exists in cache
    if !state.pdf_cache().contains(&id).await {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
        ));
    }

    let repo = HighlightRepository::new(state.db());
    let annotations = repo
        .list_for_book(&id, None)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to list annotations",
                    e.to_string(),
                )),
            )
        })?;

    // Filter to only PDF annotations
    let pdf_annotations: Vec<Highlight> = annotations
        .into_iter()
        .filter(|a| a.document_format == "pdf")
        .collect();

    let total = pdf_annotations.len();

    Ok(Json(AnnotationsResponse {
        annotations: pdf_annotations,
        total,
    }))
}

/// Create a new annotation for a PDF
async fn create_annotation(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(mut data): Json<CreateHighlight>,
) -> Result<(StatusCode, Json<Highlight>), (StatusCode, Json<ErrorResponse>)> {
    // Check if PDF exists in cache
    if !state.pdf_cache().contains(&id).await {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
        ));
    }

    // Force document_format to pdf
    data.document_format = Some("pdf".to_string());

    let repo = HighlightRepository::new(state.db());
    let annotation = repo
        .create(&id, None, &data)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to create annotation",
                    e.to_string(),
                )),
            )
        })?;

    Ok((StatusCode::CREATED, Json(annotation)))
}

/// Get a specific annotation
async fn get_annotation(
    State(state): State<AppState>,
    Path((id, annotation_id)): Path<(String, String)>,
) -> Result<Json<Highlight>, (StatusCode, Json<ErrorResponse>)> {
    // Check if PDF exists in cache
    if !state.pdf_cache().contains(&id).await {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
        ));
    }

    let repo = HighlightRepository::new(state.db());
    let annotation = repo
        .get(&annotation_id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get annotation",
                    e.to_string(),
                )),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(format!(
                    "Annotation '{}' not found",
                    annotation_id
                ))),
            )
        })?;

    // Verify the annotation belongs to this PDF
    if annotation.book_id != id {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!(
                "Annotation '{}' not found in PDF '{}'",
                annotation_id, id
            ))),
        ));
    }

    Ok(Json(annotation))
}

/// Update an annotation
async fn update_annotation(
    State(state): State<AppState>,
    Path((id, annotation_id)): Path<(String, String)>,
    Json(data): Json<UpdateHighlight>,
) -> Result<Json<Highlight>, (StatusCode, Json<ErrorResponse>)> {
    // Check if PDF exists in cache
    if !state.pdf_cache().contains(&id).await {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
        ));
    }

    let repo = HighlightRepository::new(state.db());

    // First verify the annotation exists and belongs to this PDF
    let existing = repo
        .get(&annotation_id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get annotation",
                    e.to_string(),
                )),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(format!(
                    "Annotation '{}' not found",
                    annotation_id
                ))),
            )
        })?;

    if existing.book_id != id {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!(
                "Annotation '{}' not found in PDF '{}'",
                annotation_id, id
            ))),
        ));
    }

    // Update the annotation
    let annotation = repo
        .update(&annotation_id, &data)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to update annotation",
                    e.to_string(),
                )),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(format!(
                    "Annotation '{}' not found",
                    annotation_id
                ))),
            )
        })?;

    Ok(Json(annotation))
}

/// Delete an annotation
async fn delete_annotation(
    State(state): State<AppState>,
    Path((id, annotation_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    // Check if PDF exists in cache
    if !state.pdf_cache().contains(&id).await {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
        ));
    }

    let repo = HighlightRepository::new(state.db());

    // First verify the annotation exists and belongs to this PDF
    let existing = repo
        .get(&annotation_id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get annotation",
                    e.to_string(),
                )),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(format!(
                    "Annotation '{}' not found",
                    annotation_id
                ))),
            )
        })?;

    if existing.book_id != id {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!(
                "Annotation '{}' not found in PDF '{}'",
                annotation_id, id
            ))),
        ));
    }

    // Delete the annotation
    let deleted = repo
        .delete(&annotation_id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to delete annotation",
                    e.to_string(),
                )),
            )
        })?;

    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!(
                "Annotation '{}' not found",
                annotation_id
            ))),
        ))
    }
}

// ============================================================================
// Form Endpoints (Phase 9)
// ============================================================================

/// Response for form information
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormInfoResponse {
    /// PDF ID
    pub id: String,
    /// Form information
    #[serde(flatten)]
    pub form_info: FormInfo,
}

/// Response for form fields list
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormFieldsResponse {
    /// PDF ID
    pub id: String,
    /// Total number of fields
    pub total: usize,
    /// Form fields
    pub fields: Vec<FormField>,
}

/// Response for signatures list
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignaturesResponse {
    /// PDF ID
    pub id: String,
    /// Total number of signatures
    pub total: usize,
    /// Signature fields
    pub signatures: Vec<SignatureInfo>,
}

/// Get form information for a PDF
///
/// Returns information about whether the PDF contains forms (AcroForm or XFA),
/// the number of form fields, and whether calculations are needed.
async fn get_form_info(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<FormInfoResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Check if PDF exists in cache
    if !state.pdf_cache().contains(&id).await {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
        ));
    }

    // Get the parser for form extraction
    let form_info = state
        .pdf_cache()
        .with_parser(&id, |parser| parser.get_form_info())
        .await
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
            )
        })?
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to extract form information",
                    e.to_string(),
                )),
            )
        })?;

    Ok(Json(FormInfoResponse {
        id: id.clone(),
        form_info,
    }))
}

/// List all form fields in a PDF
///
/// Returns detailed information about each form field including:
/// - Field name and type
/// - Current and default values
/// - Validation constraints (required, max length, etc.)
/// - Options for dropdown/listbox fields
async fn list_form_fields(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<FormFieldsResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Check if PDF exists in cache
    if !state.pdf_cache().contains(&id).await {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
        ));
    }

    // Get form fields
    let form_info = state
        .pdf_cache()
        .with_parser(&id, |parser| parser.get_form_info())
        .await
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
            )
        })?
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to extract form fields",
                    e.to_string(),
                )),
            )
        })?;

    let total = form_info.fields.len();

    Ok(Json(FormFieldsResponse {
        id: id.clone(),
        total,
        fields: form_info.fields,
    }))
}

/// List all digital signatures in a PDF
///
/// Returns information about signature fields including:
/// - Signer name
/// - Signing time and reason
/// - Validation status (note: full cryptographic validation not yet implemented)
async fn list_signatures(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<SignaturesResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Check if PDF exists in cache
    if !state.pdf_cache().contains(&id).await {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
        ));
    }

    // Get signatures
    let signatures = state
        .pdf_cache()
        .with_parser(&id, |parser| parser.get_signatures())
        .await
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
            )
        })?
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to extract signatures",
                    e.to_string(),
                )),
            )
        })?;

    let total = signatures.len();

    Ok(Json(SignaturesResponse {
        id: id.clone(),
        total,
        signatures,
    }))
}
