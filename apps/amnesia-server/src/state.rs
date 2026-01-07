//! Application state management

use std::sync::Arc;

use sqlx::SqlitePool;

use crate::config::Config;
use crate::epub::BookCache;
use crate::pdf::{PdfCache, PdfService, PdfServiceError};
use crate::storage::S3Client;

/// Error type for state initialization
#[derive(Debug, thiserror::Error)]
pub enum StateError {
    #[error("Failed to initialize PDF service: {0}")]
    PdfServiceInit(#[from] PdfServiceError),
}

/// Shared application state
#[derive(Clone)]
pub struct AppState {
    inner: Arc<AppStateInner>,
}

struct AppStateInner {
    pub config: Config,
    pub s3_client: S3Client,
    pub db: SqlitePool,
    pub book_cache: BookCache,
    pub pdf_cache: PdfCache,
}

impl AppState {
    /// Create a new application state
    ///
    /// This starts the PdfService actor which initializes PDFium.
    /// Returns an error if PDFium cannot be loaded.
    pub async fn new(config: Config, s3_client: S3Client, db: SqlitePool) -> Result<Self, StateError> {
        // Start the PDF service actor (initializes PDFium)
        let pdf_service = PdfService::start()?;

        // Give the actor thread time to initialize PDFium
        // This ensures the first PDF request doesn't fail due to race
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // Create PDF cache with the service handle
        let pdf_cache = PdfCache::new(pdf_service);

        Ok(Self {
            inner: Arc::new(AppStateInner {
                config,
                s3_client,
                db,
                book_cache: BookCache::new(),
                pdf_cache,
            }),
        })
    }

    /// Get the configuration
    pub fn config(&self) -> &Config {
        &self.inner.config
    }

    /// Get the S3 client
    pub fn s3_client(&self) -> &S3Client {
        &self.inner.s3_client
    }

    /// Get the database pool
    pub fn db(&self) -> &SqlitePool {
        &self.inner.db
    }

    /// Get the book cache
    pub fn book_cache(&self) -> &BookCache {
        &self.inner.book_cache
    }

    /// Get the PDF cache
    pub fn pdf_cache(&self) -> &PdfCache {
        &self.inner.pdf_cache
    }

    /// Shutdown the PDF service gracefully
    ///
    /// This should be called before the application exits to ensure
    /// PDFium is properly cleaned up (FPDF_DestroyLibrary called once).
    pub async fn shutdown(&self) -> Result<(), PdfServiceError> {
        tracing::info!("Shutting down application state...");
        self.inner.pdf_cache.shutdown().await
    }
}
