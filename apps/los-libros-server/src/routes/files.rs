//! File serving routes
//!
//! Serves book files and covers from S3 storage.

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::Response,
    routing::get,
    Router,
};

use crate::error::{AppError, Result};
use crate::state::AppState;

/// Create the files router
pub fn router() -> Router<AppState> {
    Router::new().route("/*path", get(serve_file))
}

/// Serve a file from S3
async fn serve_file(
    State(state): State<AppState>,
    Path(path): Path<String>,
) -> Result<Response> {
    let s3_client = state.s3_client();

    // Get object metadata first
    let metadata = s3_client.head_object(&path).await?;

    // Get the object stream
    let stream = s3_client.get_object_stream(&path).await?;

    // Determine content type
    let content_type = metadata
        .content_type
        .unwrap_or_else(|| guess_content_type(&path));

    // Get filename for Content-Disposition
    let filename = path.rsplit('/').next().unwrap_or(&path);

    // Collect the stream data into bytes
    let bytes = stream
        .collect()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read file stream: {}", e)))?
        .into_bytes();

    let body = Body::from(bytes);

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, metadata.size)
        .header(
            header::CONTENT_DISPOSITION,
            format!("inline; filename=\"{}\"", filename),
        )
        .header(header::CACHE_CONTROL, "public, max-age=86400")
        .body(body)
        .map_err(|e| AppError::Internal(e.to_string()))?)
}

/// Guess content type from file extension
fn guess_content_type(path: &str) -> String {
    let ext = path.rsplit('.').next().unwrap_or("");
    match ext.to_lowercase().as_str() {
        "epub" => "application/epub+zip",
        "pdf" => "application/pdf",
        "mobi" => "application/x-mobipocket-ebook",
        "azw3" | "azw" => "application/vnd.amazon.mobi8-ebook",
        "cbz" => "application/vnd.comicbook+zip",
        "cbr" => "application/vnd.comicbook-rar",
        "fb2" => "application/x-fictionbook+xml",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "opf" => "application/oebps-package+xml",
        "xml" => "application/xml",
        _ => "application/octet-stream",
    }
    .to_string()
}
