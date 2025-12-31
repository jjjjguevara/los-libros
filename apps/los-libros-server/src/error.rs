//! Error types for the Los Libros server

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use thiserror::Error;

/// Application-wide result type
pub type Result<T> = std::result::Result<T, AppError>;

/// Application error type
#[derive(Error, Debug)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("S3 error: {0}")]
    Storage(#[from] StorageError),

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("XML parsing error: {0}")]
    XmlParse(#[from] quick_xml::Error),

    #[error("XML deserialization error: {0}")]
    XmlDeserialize(#[from] quick_xml::de::DeError),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("UTF-8 error: {0}")]
    Utf8(#[from] std::string::FromUtf8Error),
}

/// Storage-specific errors
#[derive(Error, Debug)]
pub enum StorageError {
    #[error("S3 connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Bucket not found: {0}")]
    BucketNotFound(String),

    #[error("Object not found: {0}")]
    ObjectNotFound(String),

    #[error("Access denied: {0}")]
    AccessDenied(String),

    #[error("S3 SDK error: {0}")]
    SdkError(String),
}

/// Error response body
#[derive(Serialize)]
struct ErrorResponse {
    error: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<String>,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error_type, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, "not_found", msg.clone()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "bad_request", msg.clone()),
            AppError::Internal(msg) => {
                tracing::error!("Internal error: {}", msg);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "An internal error occurred".to_string(),
                )
            }
            AppError::Storage(e) => {
                tracing::error!("Storage error: {}", e);
                match e {
                    StorageError::ObjectNotFound(key) => {
                        (StatusCode::NOT_FOUND, "not_found", format!("Object not found: {}", key))
                    }
                    StorageError::BucketNotFound(bucket) => {
                        (StatusCode::NOT_FOUND, "not_found", format!("Bucket not found: {}", bucket))
                    }
                    StorageError::AccessDenied(_) => (
                        StatusCode::FORBIDDEN,
                        "access_denied",
                        "Access denied".to_string(),
                    ),
                    _ => (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "storage_error",
                        "Storage error".to_string(),
                    ),
                }
            }
            AppError::Database(e) => {
                tracing::error!("Database error: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "database_error",
                    "Database error".to_string(),
                )
            }
            AppError::XmlParse(e) => {
                tracing::error!("XML parse error: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "parse_error",
                    "Failed to parse XML".to_string(),
                )
            }
            AppError::XmlDeserialize(e) => {
                tracing::error!("XML deserialize error: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "parse_error",
                    "Failed to deserialize XML".to_string(),
                )
            }
            AppError::Utf8(e) => {
                tracing::error!("UTF-8 error: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "encoding_error",
                    "Invalid UTF-8 encoding".to_string(),
                )
            }
            AppError::Io(e) => {
                tracing::error!("IO error: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "io_error",
                    "IO error".to_string(),
                )
            }
        };

        let body = Json(ErrorResponse {
            error: error_type.to_string(),
            message,
            details: if cfg!(debug_assertions) {
                Some(self.to_string())
            } else {
                None
            },
        });

        (status, body).into_response()
    }
}
