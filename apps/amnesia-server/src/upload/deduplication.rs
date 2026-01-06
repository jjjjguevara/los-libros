//! Deduplication Service
//!
//! Provides file and chunk-level deduplication using SHA-256 hashes.
//! Enables instant uploads for duplicate files.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use sqlx::SqlitePool;

use super::chunk_store::ChunkStore;
use super::types::{DeduplicationResult, UploadError};

// ============================================================================
// Deduplication Service
// ============================================================================

/// Service for detecting and handling duplicate files and chunks
#[derive(Clone)]
pub struct DeduplicationService {
    inner: Arc<DeduplicationServiceInner>,
}

struct DeduplicationServiceInner {
    /// Database pool for file hash lookups
    db: SqlitePool,

    /// Chunk store for chunk existence checks
    chunk_store: ChunkStore,

    /// In-memory cache of file hashes -> book IDs
    file_cache: RwLock<HashMap<String, String>>,

    /// Cache TTL in seconds (0 = no expiry)
    cache_ttl: u64,
}

impl DeduplicationService {
    /// Create a new deduplication service
    pub fn new(db: SqlitePool, chunk_store: ChunkStore) -> Self {
        Self {
            inner: Arc::new(DeduplicationServiceInner {
                db,
                chunk_store,
                file_cache: RwLock::new(HashMap::new()),
                cache_ttl: 3600, // 1 hour default
            }),
        }
    }

    /// Create with custom cache TTL
    pub fn with_cache_ttl(db: SqlitePool, chunk_store: ChunkStore, ttl_seconds: u64) -> Self {
        Self {
            inner: Arc::new(DeduplicationServiceInner {
                db,
                chunk_store,
                file_cache: RwLock::new(HashMap::new()),
                cache_ttl: ttl_seconds,
            }),
        }
    }

    // ========================================================================
    // File-Level Deduplication
    // ========================================================================

    /// Check if a file with the given hash already exists
    pub async fn check_file_exists(&self, file_hash: &str) -> Result<Option<String>, UploadError> {
        // Check cache first
        {
            let cache = self.inner.file_cache.read().await;
            if let Some(book_id) = cache.get(file_hash) {
                tracing::debug!(
                    file_hash = %file_hash,
                    book_id = %book_id,
                    "File found in cache"
                );
                return Ok(Some(book_id.clone()));
            }
        }

        // Check database
        let result = sqlx::query_scalar::<_, String>(
            r#"
            SELECT id FROM books WHERE file_hash = ?
            "#,
        )
        .bind(file_hash)
        .fetch_optional(&self.inner.db)
        .await
        .map_err(|e| UploadError::DatabaseError(e.to_string()))?;

        // Update cache if found
        if let Some(ref book_id) = result {
            let mut cache = self.inner.file_cache.write().await;
            cache.insert(file_hash.to_string(), book_id.clone());
        }

        Ok(result)
    }

    /// Register a file hash for a book
    pub async fn register_file(&self, file_hash: &str, book_id: &str) -> Result<(), UploadError> {
        // Update database
        sqlx::query(
            r#"
            UPDATE books SET file_hash = ? WHERE id = ?
            "#,
        )
        .bind(file_hash)
        .bind(book_id)
        .execute(&self.inner.db)
        .await
        .map_err(|e| UploadError::DatabaseError(e.to_string()))?;

        // Update cache
        {
            let mut cache = self.inner.file_cache.write().await;
            cache.insert(file_hash.to_string(), book_id.to_string());
        }

        tracing::info!(
            file_hash = %file_hash,
            book_id = %book_id,
            "Registered file hash"
        );

        Ok(())
    }

    // ========================================================================
    // Chunk-Level Deduplication
    // ========================================================================

    /// Check which chunks already exist
    pub async fn check_chunks_exist(&self, chunk_hashes: &[String]) -> Vec<usize> {
        self.inner.chunk_store.find_existing_chunks(chunk_hashes).await
    }

    /// Full deduplication check
    ///
    /// Returns information about whether the file exists and which chunks
    /// need to be uploaded.
    pub async fn check_deduplication(
        &self,
        file_hash: &str,
        chunk_hashes: &[String],
    ) -> Result<DeduplicationResult, UploadError> {
        // Check if complete file exists
        let existing_book_id = self.check_file_exists(file_hash).await?;

        if existing_book_id.is_some() {
            // File exists - instant upload!
            tracing::info!(
                file_hash = %file_hash,
                book_id = existing_book_id.as_ref().unwrap(),
                "Duplicate file detected - instant upload"
            );

            return Ok(DeduplicationResult {
                file_exists: true,
                existing_book_id,
                existing_chunks: (0..chunk_hashes.len()).collect(),
                needed_chunks: vec![],
            });
        }

        // File doesn't exist - check chunks
        let existing_chunks = self.check_chunks_exist(chunk_hashes).await;
        let needed_chunks: Vec<usize> = (0..chunk_hashes.len())
            .filter(|i| !existing_chunks.contains(i))
            .collect();

        let savings = if !chunk_hashes.is_empty() {
            (existing_chunks.len() as f64 / chunk_hashes.len() as f64) * 100.0
        } else {
            0.0
        };

        tracing::info!(
            file_hash = %file_hash,
            total_chunks = chunk_hashes.len(),
            existing_chunks = existing_chunks.len(),
            needed_chunks = needed_chunks.len(),
            savings_pct = format!("{:.1}%", savings),
            "Deduplication check complete"
        );

        Ok(DeduplicationResult {
            file_exists: false,
            existing_book_id: None,
            existing_chunks,
            needed_chunks,
        })
    }

    // ========================================================================
    // Cache Management
    // ========================================================================

    /// Clear the file hash cache
    pub async fn clear_cache(&self) {
        let mut cache = self.inner.file_cache.write().await;
        cache.clear();
        tracing::debug!("Cleared deduplication cache");
    }

    /// Get cache statistics
    pub async fn cache_stats(&self) -> CacheStats {
        let cache = self.inner.file_cache.read().await;
        CacheStats {
            entries: cache.len(),
            ttl_seconds: self.inner.cache_ttl,
        }
    }

    /// Preload cache from database
    pub async fn preload_cache(&self, limit: usize) -> Result<usize, UploadError> {
        let rows = sqlx::query_as::<_, (String, String)>(
            r#"
            SELECT id, file_hash FROM books
            WHERE file_hash IS NOT NULL
            ORDER BY created_at DESC
            LIMIT ?
            "#,
        )
        .bind(limit as i64)
        .fetch_all(&self.inner.db)
        .await
        .map_err(|e| UploadError::DatabaseError(e.to_string()))?;

        let count = rows.len();
        let mut cache = self.inner.file_cache.write().await;
        for (book_id, file_hash) in rows {
            cache.insert(file_hash, book_id);
        }

        tracing::info!(count = count, "Preloaded deduplication cache");
        Ok(count)
    }
}

// ============================================================================
// Cache Statistics
// ============================================================================

/// Statistics about the deduplication cache
#[derive(Debug, Clone)]
pub struct CacheStats {
    /// Number of entries in cache
    pub entries: usize,
    /// Cache TTL in seconds
    pub ttl_seconds: u64,
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Calculate potential bandwidth savings
pub fn calculate_savings(total_size: u64, skipped_chunks: usize, chunk_size: usize) -> SavingsInfo {
    let skipped_bytes = (skipped_chunks * chunk_size) as u64;
    let percentage = if total_size > 0 {
        (skipped_bytes as f64 / total_size as f64) * 100.0
    } else {
        0.0
    };

    SavingsInfo {
        total_size,
        skipped_bytes,
        transfer_bytes: total_size.saturating_sub(skipped_bytes),
        savings_percentage: percentage,
    }
}

/// Bandwidth savings information
#[derive(Debug, Clone)]
pub struct SavingsInfo {
    /// Total file size
    pub total_size: u64,
    /// Bytes skipped due to deduplication
    pub skipped_bytes: u64,
    /// Bytes that need to be transferred
    pub transfer_bytes: u64,
    /// Percentage savings
    pub savings_percentage: f64,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_savings() {
        // 10 chunks, 3 skipped, 1MB chunk size
        let savings = calculate_savings(10 * 1024 * 1024, 3, 1024 * 1024);

        assert_eq!(savings.total_size, 10 * 1024 * 1024);
        assert_eq!(savings.skipped_bytes, 3 * 1024 * 1024);
        assert_eq!(savings.transfer_bytes, 7 * 1024 * 1024);
        assert!((savings.savings_percentage - 30.0).abs() < 0.1);
    }

    #[test]
    fn test_calculate_savings_empty() {
        let savings = calculate_savings(0, 0, 1024 * 1024);
        assert_eq!(savings.savings_percentage, 0.0);
    }

    #[test]
    fn test_calculate_savings_full_dedup() {
        // All 5 chunks already exist
        let savings = calculate_savings(5 * 1024 * 1024, 5, 1024 * 1024);
        assert_eq!(savings.transfer_bytes, 0);
        assert!((savings.savings_percentage - 100.0).abs() < 0.1);
    }
}
