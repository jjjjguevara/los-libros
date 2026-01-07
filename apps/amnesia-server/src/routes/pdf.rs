//! PDF API endpoints
//!
//! Provides REST API for PDF document management:
//! - Upload PDFs
//! - List PDFs
//! - Get PDF metadata and TOC
//! - Render pages
//! - Get text layers
//! - Search content

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};

use crate::epub::TocEntry;
use crate::ocr::{OcrRect, OcrRequest, OcrResult, OcrService, OcrServiceConfig};
use crate::pdf::{ImageFormat, PageDimensions, PageRenderRequest, ParsedPdf, PdfMetadata, PdfSearchResult, TextLayer};
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
    /// First page width in points (72 points = 1 inch)
    pub page_width: f32,
    /// First page height in points (72 points = 1 inch)
    pub page_height: f32,
    /// Dimensions for each page (index 0 = page 1)
    /// Enables proper layout for PDFs with variable page sizes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_dimensions: Option<Vec<PageDimensions>>,
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
    /// Scale factor (default: 1.5). Ignored if dpi is provided.
    #[serde(default = "default_scale")]
    pub scale: f32,
    /// DPI for rendering (72, 96, 150, 200, 300). If provided, overrides scale.
    /// Scale is calculated as: dpi / 72.0
    pub dpi: Option<u32>,
    /// Rotation in degrees (0, 90, 180, 270)
    #[serde(default)]
    pub rotation: u16,
    /// Output format (png, jpeg, webp)
    #[serde(default)]
    pub format: String,
    /// Image quality for lossy formats (1-100). Default: 85
    pub quality: Option<u8>,
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

/// Query parameters for batch page rendering
#[derive(Debug, Deserialize)]
pub struct BatchRenderQuery {
    /// Comma-separated list of page numbers (e.g., "1,2,3,4,5")
    pub pages: String,
    /// Scale factor (default: 1.5). Ignored if dpi is provided.
    #[serde(default = "default_scale")]
    pub scale: f32,
    /// DPI for rendering (72, 96, 150, 200, 300). If provided, overrides scale.
    pub dpi: Option<u32>,
    /// Rotation in degrees (0, 90, 180, 270)
    #[serde(default)]
    pub rotation: u16,
    /// Output format (png, jpeg, webp)
    #[serde(default)]
    pub format: String,
    /// Image quality for lossy formats (1-100). Default: 85
    pub quality: Option<u8>,
}

/// Individual page result in batch response
#[derive(Serialize)]
pub struct BatchPageResult {
    pub page: usize,
    /// Base64-encoded image data
    pub data: String,
    /// Content type (e.g., "image/png")
    pub content_type: String,
}

/// Batch render response
#[derive(Serialize)]
pub struct BatchRenderResponse {
    pub pages: Vec<BatchPageResult>,
    /// Pages that failed to render
    pub errors: Vec<BatchPageError>,
}

/// Error for individual page in batch
#[derive(Serialize)]
pub struct BatchPageError {
    pub page: usize,
    pub error: String,
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

/// Create the PDF router
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_pdfs).post(upload_pdf))
        .route("/:id", get(get_pdf).delete(delete_pdf))
        .route("/:id/pages/:page", get(render_page))
        .route("/:id/pages/batch", get(batch_render_pages))
        .route("/:id/pages/:page/text", get(get_text_layer))
        .route("/:id/pages/:page/text-svg", get(get_text_layer_svg))
        .route("/:id/pages/:page/thumbnail", get(render_thumbnail))
        .route("/:id/pages/:page/ocr", post(ocr_region))
        .route("/:id/search", get(search_pdf))
        .route("/:id/ocr/providers", get(list_ocr_providers))
        // Allow up to 1.5GB uploads for very large PDFs (e.g., dictionaries)
        .layer(DefaultBodyLimit::max(1536 * 1024 * 1024))
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
                        quality: 85,
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
        page_width: pdf.page_width,
        page_height: pdf.page_height,
        page_dimensions: pdf.page_dimensions,
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

    // Calculate scale: use DPI if provided, otherwise use scale directly
    // DPI to scale: scale = dpi / 72.0 (PDF points are 72 per inch)
    let scale = match query.dpi {
        Some(dpi) => (dpi as f32) / 72.0,
        None => query.scale,
    };

    let request = PageRenderRequest {
        page,
        scale,
        format,
        rotation: query.rotation,
        quality: query.quality.unwrap_or(85),
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

/// Batch render multiple pages in parallel
///
/// Renders multiple pages concurrently and returns them in a single JSON response.
/// Pages are rendered in parallel (limited by the cache's render semaphore).
async fn batch_render_pages(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<BatchRenderQuery>,
) -> Result<Json<BatchRenderResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Parse page numbers from comma-separated string
    let page_numbers: Vec<usize> = query
        .pages
        .split(',')
        .filter_map(|s| s.trim().parse::<usize>().ok())
        .collect();

    if page_numbers.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new("No valid page numbers provided")),
        ));
    }

    // Limit to 20 pages per batch request for memory safety
    if page_numbers.len() > 20 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new("Maximum 20 pages per batch request")),
        ));
    }

    // Get PDF to validate it exists and check page bounds
    let pdf = state
        .pdf_cache()
        .get_pdf(&id)
        .await
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(format!("PDF '{}' not found", id))),
            )
        })?;

    // Parse format
    let format = match query.format.to_lowercase().as_str() {
        "jpeg" | "jpg" => ImageFormat::Jpeg,
        "webp" => ImageFormat::Webp,
        _ => ImageFormat::Png,
    };

    // Calculate scale: use DPI if provided, otherwise use scale directly
    let scale = match query.dpi {
        Some(dpi) => (dpi as f32) / 72.0,
        None => query.scale,
    };

    let quality = query.quality.unwrap_or(85);
    let rotation = query.rotation;
    let content_type = format.content_type().to_string();

    // Spawn concurrent render tasks for each page
    let cache = state.pdf_cache().clone();
    let mut handles = Vec::with_capacity(page_numbers.len());

    for page in page_numbers.clone() {
        let cache = cache.clone();
        let id = id.clone();
        let format = format.clone();
        let page_count = pdf.page_count;

        handles.push(tokio::spawn(async move {
            // Validate page is within bounds
            if page == 0 || page > page_count {
                return Err((page, format!("Page {} out of range (1-{})", page, page_count)));
            }

            let request = PageRenderRequest {
                page,
                scale,
                format,
                rotation,
                quality,
            };

            match cache.render_page(&id, &request).await {
                Ok(data) => Ok((page, data)),
                Err(e) => Err((page, e.to_string())),
            }
        }));
    }

    // Collect results
    let mut pages = Vec::with_capacity(page_numbers.len());
    let mut errors = Vec::new();

    for handle in handles {
        match handle.await {
            Ok(Ok((page, data))) => {
                pages.push(BatchPageResult {
                    page,
                    data: BASE64.encode(&data),
                    content_type: content_type.clone(),
                });
            }
            Ok(Err((page, error))) => {
                errors.push(BatchPageError { page, error });
            }
            Err(e) => {
                tracing::error!("Task join error during batch render: {}", e);
            }
        }
    }

    // Sort pages by page number for consistent ordering
    pages.sort_by_key(|p| p.page);
    errors.sort_by_key(|e| e.page);

    Ok(Json(BatchRenderResponse { pages, errors }))
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

/// Get text layer for a page as SVG
///
/// Returns an SVG document with transparent text elements positioned to match
/// the PDF layout. This enables crisp text selection at any zoom level when
/// overlaid on the raster page image.
async fn get_text_layer_svg(
    State(state): State<AppState>,
    Path((id, page)): Path<(String, usize)>,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
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

    // Generate SVG from text layer
    let svg = crate::pdf::generate_svg(&layer);

    // Return as SVG with appropriate content type
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/svg+xml")
        .header(header::CACHE_CONTROL, "max-age=3600") // Cache for 1 hour
        .body(Body::from(svg))
        .unwrap();

    Ok(response)
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
