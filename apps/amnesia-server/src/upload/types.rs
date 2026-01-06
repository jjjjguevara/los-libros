//! Upload types for the up2k protocol

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ============================================================================
// Constants
// ============================================================================

/// Default chunk size: 2MB
pub const DEFAULT_CHUNK_SIZE: usize = 2 * 1024 * 1024;

/// Maximum file size: 500MB
pub const MAX_FILE_SIZE: u64 = 500 * 1024 * 1024;

/// Session expiry time: 24 hours
pub const SESSION_EXPIRY_HOURS: i64 = 24;

/// Maximum concurrent uploads per user (0 = unlimited)
pub const MAX_CONCURRENT_UPLOADS: usize = 5;

// ============================================================================
// Handshake Types
// ============================================================================

/// Request to initiate a chunked upload
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandshakeRequest {
    /// Original file name
    pub file_name: String,

    /// Total file size in bytes
    pub file_size: u64,

    /// SHA-256 hash of the complete file
    pub file_hash: String,

    /// SHA-256 hashes of each chunk (in order)
    pub chunk_hashes: Vec<String>,

    /// MIME type of the file
    pub mime_type: String,

    /// Optional: Expected chunk size (defaults to 2MB)
    #[serde(default)]
    pub chunk_size: Option<usize>,
}

/// Response to handshake request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandshakeResponse {
    /// Upload session ID
    pub session_id: String,

    /// Whether this file already exists (instant upload)
    pub is_duplicate: bool,

    /// If duplicate, the existing book ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_book_id: Option<String>,

    /// Indices of chunks that need to be uploaded
    pub needed_chunks: Vec<usize>,

    /// Indices of chunks that already exist (from other uploads)
    pub existing_chunks: Vec<usize>,

    /// Total chunks expected
    pub total_chunks: usize,

    /// Session expiry time
    pub expires_at: DateTime<Utc>,
}

// ============================================================================
// Chunk Upload Types
// ============================================================================

/// Response after uploading a chunk
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkUploadResponse {
    /// Chunk index that was uploaded
    pub chunk_index: usize,

    /// Whether the chunk was accepted
    pub accepted: bool,

    /// Number of chunks received so far
    pub chunks_received: usize,

    /// Total chunks expected
    pub total_chunks: usize,

    /// Whether all chunks have been received
    pub complete: bool,
}

// ============================================================================
// Finalize Types
// ============================================================================

/// Response after finalizing an upload
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeResponse {
    /// The new book ID
    pub book_id: String,

    /// Book title (extracted from EPUB/PDF)
    pub title: String,

    /// Total file size
    pub size: u64,

    /// S3 key where file is stored
    pub storage_key: String,
}

// ============================================================================
// Session Types
// ============================================================================

/// Upload session state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadSession {
    /// Unique session ID
    pub id: Uuid,

    /// Original file name
    pub file_name: String,

    /// Total file size in bytes
    pub file_size: u64,

    /// SHA-256 hash of complete file
    pub file_hash: String,

    /// MIME type
    pub mime_type: String,

    /// Expected chunk hashes (in order)
    pub chunk_hashes: Vec<String>,

    /// Chunk size used for this upload
    pub chunk_size: usize,

    /// Indices of chunks that have been received
    pub received_chunks: Vec<usize>,

    /// Session creation time
    pub created_at: DateTime<Utc>,

    /// Session expiry time
    pub expires_at: DateTime<Utc>,

    /// Current status
    pub status: SessionStatus,

    /// Optional: User ID if authenticated
    pub user_id: Option<String>,
}

impl UploadSession {
    /// Create a new upload session
    pub fn new(request: &HandshakeRequest) -> Self {
        let now = Utc::now();
        let chunk_size = request.chunk_size.unwrap_or(DEFAULT_CHUNK_SIZE);

        Self {
            id: Uuid::new_v4(),
            file_name: request.file_name.clone(),
            file_size: request.file_size,
            file_hash: request.file_hash.clone(),
            mime_type: request.mime_type.clone(),
            chunk_hashes: request.chunk_hashes.clone(),
            chunk_size,
            received_chunks: Vec::new(),
            created_at: now,
            expires_at: now + chrono::Duration::hours(SESSION_EXPIRY_HOURS),
            status: SessionStatus::Pending,
            user_id: None,
        }
    }

    /// Check if session has expired
    pub fn is_expired(&self) -> bool {
        Utc::now() > self.expires_at
    }

    /// Check if all chunks have been received
    pub fn is_complete(&self) -> bool {
        self.received_chunks.len() == self.chunk_hashes.len()
    }

    /// Get indices of chunks that still need to be uploaded
    pub fn missing_chunks(&self) -> Vec<usize> {
        (0..self.chunk_hashes.len())
            .filter(|i| !self.received_chunks.contains(i))
            .collect()
    }

    /// Mark a chunk as received
    pub fn mark_chunk_received(&mut self, index: usize) {
        if !self.received_chunks.contains(&index) {
            self.received_chunks.push(index);
            self.received_chunks.sort();
        }
    }

    /// Calculate progress percentage
    pub fn progress(&self) -> f64 {
        if self.chunk_hashes.is_empty() {
            return 100.0;
        }
        (self.received_chunks.len() as f64 / self.chunk_hashes.len() as f64) * 100.0
    }
}

/// Session status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    /// Waiting for chunks
    Pending,
    /// Currently receiving chunks
    Uploading,
    /// All chunks received, waiting for finalization
    Ready,
    /// File assembled and stored
    Complete,
    /// Session cancelled or failed
    Failed,
    /// Session expired
    Expired,
}

// ============================================================================
// Error Types
// ============================================================================

/// Upload error types
#[derive(Debug, thiserror::Error)]
pub enum UploadError {
    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Session expired: {0}")]
    SessionExpired(String),

    #[error("Session already complete")]
    SessionComplete,

    #[error("Chunk hash mismatch: expected {expected}, got {actual}")]
    ChunkHashMismatch { expected: String, actual: String },

    #[error("Chunk index out of bounds: {index} (max: {max})")]
    ChunkIndexOutOfBounds { index: usize, max: usize },

    #[error("Chunk already received: {0}")]
    ChunkAlreadyReceived(usize),

    #[error("File too large: {size} bytes (max: {max})")]
    FileTooLarge { size: u64, max: u64 },

    #[error("Invalid file type: {0}")]
    InvalidFileType(String),

    #[error("Missing chunks: {0:?}")]
    MissingChunks(Vec<usize>),

    #[error("Storage error: {0}")]
    StorageError(String),

    #[error("Database error: {0}")]
    DatabaseError(String),

    #[error("Internal error: {0}")]
    InternalError(String),
}

impl UploadError {
    /// Get HTTP status code for this error
    pub fn status_code(&self) -> axum::http::StatusCode {
        use axum::http::StatusCode;
        match self {
            Self::SessionNotFound(_) => StatusCode::NOT_FOUND,
            Self::SessionExpired(_) => StatusCode::GONE,
            Self::SessionComplete => StatusCode::CONFLICT,
            Self::ChunkHashMismatch { .. } => StatusCode::CONFLICT,
            Self::ChunkIndexOutOfBounds { .. } => StatusCode::BAD_REQUEST,
            Self::ChunkAlreadyReceived(_) => StatusCode::CONFLICT,
            Self::FileTooLarge { .. } => StatusCode::PAYLOAD_TOO_LARGE,
            Self::InvalidFileType(_) => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Self::MissingChunks(_) => StatusCode::BAD_REQUEST,
            Self::StorageError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            Self::DatabaseError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            Self::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

// ============================================================================
// Chunk Metadata
// ============================================================================

/// Metadata for a stored chunk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkMetadata {
    /// SHA-256 hash of the chunk
    pub hash: String,

    /// Size in bytes
    pub size: usize,

    /// Storage path (local or S3)
    pub storage_path: String,

    /// When the chunk was stored
    pub stored_at: DateTime<Utc>,

    /// Reference count (how many sessions use this chunk)
    pub ref_count: u32,
}

// ============================================================================
// Deduplication Types
// ============================================================================

/// Result of checking for duplicates
#[derive(Debug, Clone)]
pub struct DeduplicationResult {
    /// Whether the complete file already exists
    pub file_exists: bool,

    /// If file exists, its book ID
    pub existing_book_id: Option<String>,

    /// Chunks that already exist in the store
    pub existing_chunks: Vec<usize>,

    /// Chunks that need to be uploaded
    pub needed_chunks: Vec<usize>,
}
