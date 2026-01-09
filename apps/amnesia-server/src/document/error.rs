//! Document error types
//!
//! Unified error handling for all document formats (PDF, EPUB).

use thiserror::Error;

/// Unified document error type
#[derive(Debug, Error)]
pub enum DocumentError {
    /// Document not found
    #[error("Document not found: {0}")]
    NotFound(String),

    /// Item (page/chapter) not found
    #[error("Item not found: index {0}")]
    ItemNotFound(usize),

    /// Resource not found (image, CSS, font)
    #[error("Resource not found: {0}")]
    ResourceNotFound(String),

    /// Failed to parse document
    #[error("Parse error: {0}")]
    ParseError(String),

    /// Failed to render content
    #[error("Render error: {0}")]
    RenderError(String),

    /// Invalid content (encoding, format)
    #[error("Invalid content: {0}")]
    InvalidContent(String),

    /// MuPDF context error
    #[error("MuPDF context error: {0}")]
    ContextError(String),

    /// IO error (std::io::Error)
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    /// IO error with string message
    #[error("IO error: {0}")]
    IoErrorStr(String),

    /// Cache error
    #[error("Cache error: {0}")]
    CacheError(String),

    /// Unsupported format
    #[error("Unsupported format: {0}")]
    UnsupportedFormat(String),

    /// Thread pool error
    #[error("Thread pool error: {0}")]
    ThreadPoolError(String),

    /// Text extraction error
    #[error("Text extraction error: {0}")]
    TextExtractionError(String),

    /// Search error
    #[error("Search error: {0}")]
    SearchError(String),

    /// Timeout error
    #[error("Operation timed out after {0} seconds")]
    Timeout(u64),

    /// Image processing error
    #[error("Image error: {0}")]
    ImageError(String),
}

/// Result type alias for document operations
pub type Result<T> = std::result::Result<T, DocumentError>;

/// Alias for Result (used by existing code)
pub type DocumentResult<T> = Result<T>;

impl From<mupdf::Error> for DocumentError {
    fn from(err: mupdf::Error) -> Self {
        DocumentError::ContextError(err.to_string())
    }
}
