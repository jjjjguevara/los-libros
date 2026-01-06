//! Upload Routes
//!
//! HTTP endpoints for the up2k chunked upload protocol.
//!
//! Endpoints:
//! - POST /api/v1/upload/handshake - Initiate upload, check for duplicates
//! - POST /api/v1/upload/:session_id/chunks/:index - Upload a chunk
//! - POST /api/v1/upload/:session_id/finalize - Assemble and store file
//! - DELETE /api/v1/upload/:session_id - Cancel upload
//! - GET /api/v1/upload/:session_id - Get session status

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use axum::body::Bytes;
use axum::http::header;
use serde::Serialize;
use uuid::Uuid;

use crate::state::AppState;
use crate::upload::{
    ChunkStore, DeduplicationService, SessionManager,
    HandshakeRequest, HandshakeResponse, ChunkUploadResponse, FinalizeResponse,
    UploadError, UploadSession, SessionStatus, MAX_FILE_SIZE,
};

// ============================================================================
// State
// ============================================================================

/// Upload-specific state
#[derive(Clone)]
pub struct UploadState {
    pub session_manager: SessionManager,
    pub chunk_store: ChunkStore,
    pub dedup_service: DeduplicationService,
    pub app_state: AppState,
}

// ============================================================================
// Error Response
// ============================================================================

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
    code: String,
}

impl IntoResponse for UploadError {
    fn into_response(self) -> axum::response::Response {
        let status = self.status_code();
        let code = match &self {
            UploadError::SessionNotFound(_) => "SESSION_NOT_FOUND",
            UploadError::SessionExpired(_) => "SESSION_EXPIRED",
            UploadError::SessionComplete => "SESSION_COMPLETE",
            UploadError::ChunkHashMismatch { .. } => "CHUNK_HASH_MISMATCH",
            UploadError::ChunkIndexOutOfBounds { .. } => "CHUNK_INDEX_OUT_OF_BOUNDS",
            UploadError::ChunkAlreadyReceived(_) => "CHUNK_ALREADY_RECEIVED",
            UploadError::FileTooLarge { .. } => "FILE_TOO_LARGE",
            UploadError::InvalidFileType(_) => "INVALID_FILE_TYPE",
            UploadError::MissingChunks(_) => "MISSING_CHUNKS",
            UploadError::StorageError(_) => "STORAGE_ERROR",
            UploadError::DatabaseError(_) => "DATABASE_ERROR",
            UploadError::InternalError(_) => "INTERNAL_ERROR",
        };

        let body = Json(ErrorResponse {
            error: self.to_string(),
            code: code.to_string(),
        });

        (status, body).into_response()
    }
}

// ============================================================================
// Router
// ============================================================================

/// Create the upload router
pub fn router(state: UploadState) -> Router<AppState> {
    Router::new()
        .route("/handshake", post(handshake))
        .route("/{session_id}/chunks/{index}", post(upload_chunk))
        .route("/{session_id}/finalize", post(finalize))
        .route("/{session_id}", get(get_session))
        .route("/{session_id}", delete(cancel_session))
        .with_state(state)
}

// ============================================================================
// Handlers
// ============================================================================

/// POST /api/v1/upload/handshake
///
/// Initiate a chunked upload. Returns session ID and which chunks are needed.
async fn handshake(
    State(state): State<UploadState>,
    Json(request): Json<HandshakeRequest>,
) -> Result<Json<HandshakeResponse>, UploadError> {
    // Validate file size
    if request.file_size > MAX_FILE_SIZE {
        return Err(UploadError::FileTooLarge {
            size: request.file_size,
            max: MAX_FILE_SIZE,
        });
    }

    // Validate file type
    if !is_valid_file_type(&request.mime_type) {
        return Err(UploadError::InvalidFileType(request.mime_type.clone()));
    }

    // Check for deduplication
    let dedup_result = state
        .dedup_service
        .check_deduplication(&request.file_hash, &request.chunk_hashes)
        .await?;

    // If file already exists, return instant success
    if dedup_result.file_exists {
        return Ok(Json(HandshakeResponse {
            session_id: String::new(), // No session needed
            is_duplicate: true,
            existing_book_id: dedup_result.existing_book_id,
            needed_chunks: vec![],
            existing_chunks: dedup_result.existing_chunks,
            total_chunks: request.chunk_hashes.len(),
            expires_at: chrono::Utc::now(),
        }));
    }

    // Create new upload session
    let session = state.session_manager.create_session(&request).await?;

    tracing::info!(
        session_id = %session.id,
        file_name = %request.file_name,
        file_size = request.file_size,
        needed_chunks = dedup_result.needed_chunks.len(),
        existing_chunks = dedup_result.existing_chunks.len(),
        "Upload handshake complete"
    );

    Ok(Json(HandshakeResponse {
        session_id: session.id.to_string(),
        is_duplicate: false,
        existing_book_id: None,
        needed_chunks: dedup_result.needed_chunks,
        existing_chunks: dedup_result.existing_chunks,
        total_chunks: request.chunk_hashes.len(),
        expires_at: session.expires_at,
    }))
}

/// POST /api/v1/upload/:session_id/chunks/:index
///
/// Upload a single chunk. The chunk data is the raw request body.
async fn upload_chunk(
    State(state): State<UploadState>,
    Path((session_id, chunk_index)): Path<(String, usize)>,
    headers: axum::http::HeaderMap,
    body: Bytes,
) -> Result<Json<ChunkUploadResponse>, UploadError> {
    // Get session
    let session = state.session_manager.get_session_by_str(&session_id).await?;

    // Check session state
    if session.is_expired() {
        return Err(UploadError::SessionExpired(session_id));
    }

    if session.status == SessionStatus::Complete {
        return Err(UploadError::SessionComplete);
    }

    // Validate chunk index
    if chunk_index >= session.chunk_hashes.len() {
        return Err(UploadError::ChunkIndexOutOfBounds {
            index: chunk_index,
            max: session.chunk_hashes.len() - 1,
        });
    }

    // Check if already received
    if session.received_chunks.contains(&chunk_index) {
        return Err(UploadError::ChunkAlreadyReceived(chunk_index));
    }

    // Get expected hash
    let expected_hash = &session.chunk_hashes[chunk_index];

    // Optionally verify with header hash
    if let Some(header_hash) = headers.get("X-Chunk-Hash") {
        let header_hash_str = header_hash.to_str().unwrap_or("");
        if !header_hash_str.is_empty() && header_hash_str != expected_hash {
            tracing::warn!(
                session_id = %session_id,
                chunk_index = chunk_index,
                header_hash = %header_hash_str,
                expected_hash = %expected_hash,
                "Chunk hash header mismatch"
            );
        }
    }

    // Store chunk
    let session_uuid = Uuid::parse_str(&session_id)
        .map_err(|_| UploadError::SessionNotFound(session_id.clone()))?;

    state
        .chunk_store
        .store_chunk(session_uuid, chunk_index, &body, expected_hash)
        .await?;

    // Update session
    let updated = state
        .session_manager
        .mark_chunk_received(session_uuid, chunk_index)
        .await?;

    tracing::debug!(
        session_id = %session_id,
        chunk_index = chunk_index,
        chunks_received = updated.received_chunks.len(),
        total_chunks = updated.chunk_hashes.len(),
        progress = format!("{:.1}%", updated.progress()),
        "Chunk uploaded"
    );

    Ok(Json(ChunkUploadResponse {
        chunk_index,
        accepted: true,
        chunks_received: updated.received_chunks.len(),
        total_chunks: updated.chunk_hashes.len(),
        complete: updated.is_complete(),
    }))
}

/// POST /api/v1/upload/:session_id/finalize
///
/// Assemble chunks and store the final file.
async fn finalize(
    State(state): State<UploadState>,
    Path(session_id): Path<String>,
) -> Result<Json<FinalizeResponse>, UploadError> {
    // Get session
    let session = state.session_manager.get_session_by_str(&session_id).await?;

    // Check session state
    if session.is_expired() {
        return Err(UploadError::SessionExpired(session_id));
    }

    // Check all chunks received
    if !session.is_complete() {
        let missing = session.missing_chunks();
        return Err(UploadError::MissingChunks(missing));
    }

    let session_uuid = session.id;

    // Assemble chunks
    tracing::info!(
        session_id = %session_id,
        file_name = %session.file_name,
        chunks = session.chunk_hashes.len(),
        "Assembling file from chunks"
    );

    let file_data = state
        .chunk_store
        .assemble_chunks(session_uuid, session.chunk_hashes.len())
        .await?;

    // Verify final file hash
    let actual_hash = crate::upload::chunk_store::compute_hash(&file_data);
    if actual_hash != session.file_hash {
        return Err(UploadError::ChunkHashMismatch {
            expected: session.file_hash.clone(),
            actual: actual_hash,
        });
    }

    // Store in S3
    let book_id = Uuid::new_v4().to_string();
    let storage_key = format!("books/{}/{}", book_id, session.file_name);

    state
        .app_state
        .s3_client()
        .put_object(&storage_key, file_data.clone(), &session.mime_type)
        .await
        .map_err(|e| UploadError::StorageError(e.to_string()))?;

    // Extract title from file (basic for now)
    let title = extract_title(&session.file_name, &file_data, &session.mime_type);

    // Register file hash for future deduplication
    // Note: This would typically also create a database record for the book
    // For now, we just log it
    tracing::info!(
        book_id = %book_id,
        file_hash = %session.file_hash,
        title = %title,
        size = file_data.len(),
        "File stored successfully"
    );

    // Mark session complete
    state.session_manager.complete_session(session_uuid).await?;

    // Clean up chunks
    let _ = state.chunk_store.delete_session_chunks(session_uuid).await;

    Ok(Json(FinalizeResponse {
        book_id,
        title,
        size: session.file_size,
        storage_key,
    }))
}

/// GET /api/v1/upload/:session_id
///
/// Get upload session status.
async fn get_session(
    State(state): State<UploadState>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionStatusResponse>, UploadError> {
    let session = state.session_manager.get_session_by_str(&session_id).await?;

    // Calculate progress before moving fields
    let progress = session.progress();
    let chunks_received = session.received_chunks.len();
    let total_chunks = session.chunk_hashes.len();

    Ok(Json(SessionStatusResponse {
        session_id: session.id.to_string(),
        file_name: session.file_name,
        file_size: session.file_size,
        status: session.status,
        chunks_received,
        total_chunks,
        progress,
        created_at: session.created_at,
        expires_at: session.expires_at,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionStatusResponse {
    session_id: String,
    file_name: String,
    file_size: u64,
    status: SessionStatus,
    chunks_received: usize,
    total_chunks: usize,
    progress: f64,
    created_at: chrono::DateTime<chrono::Utc>,
    expires_at: chrono::DateTime<chrono::Utc>,
}

/// DELETE /api/v1/upload/:session_id
///
/// Cancel an upload session.
async fn cancel_session(
    State(state): State<UploadState>,
    Path(session_id): Path<String>,
) -> Result<StatusCode, UploadError> {
    let session_uuid = Uuid::parse_str(&session_id)
        .map_err(|_| UploadError::SessionNotFound(session_id.clone()))?;

    // Cancel session
    state.session_manager.cancel_session(session_uuid).await?;

    // Clean up chunks
    let _ = state.chunk_store.delete_session_chunks(session_uuid).await;

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Helpers
// ============================================================================

/// Check if file type is allowed
fn is_valid_file_type(mime_type: &str) -> bool {
    matches!(
        mime_type,
        "application/epub+zip"
            | "application/pdf"
            | "application/x-mobipocket-ebook"
            | "application/vnd.amazon.ebook"
    )
}

/// Extract title from file (basic implementation)
fn extract_title(file_name: &str, _data: &[u8], _mime_type: &str) -> String {
    // For now, just use filename without extension
    // TODO: Parse EPUB/PDF metadata
    file_name
        .rsplit('.')
        .skip(1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(".")
}

// ============================================================================
// Factory Function
// ============================================================================

/// Create upload state with default configuration
pub fn create_upload_state(app_state: AppState, chunk_base_path: std::path::PathBuf) -> UploadState {
    let session_manager = SessionManager::new();
    let chunk_store = ChunkStore::with_local_storage(chunk_base_path);
    let dedup_service = DeduplicationService::new(
        app_state.db().clone(),
        chunk_store.clone(),
    );

    UploadState {
        session_manager,
        chunk_store,
        dedup_service,
        app_state,
    }
}

/// Create upload state with S3 chunk storage
pub fn create_upload_state_s3(app_state: AppState, chunk_prefix: String) -> UploadState {
    let session_manager = SessionManager::new();
    let chunk_store = ChunkStore::with_s3_storage(
        app_state.s3_client().clone(),
        chunk_prefix,
    );
    let dedup_service = DeduplicationService::new(
        app_state.db().clone(),
        chunk_store.clone(),
    );

    UploadState {
        session_manager,
        chunk_store,
        dedup_service,
        app_state,
    }
}
