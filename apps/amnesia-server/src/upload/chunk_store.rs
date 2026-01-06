//! Chunk Store
//!
//! Temporary storage for uploaded chunks before assembly.
//! Supports both local filesystem and S3 storage backends.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;
use sha2::{Sha256, Digest};
use uuid::Uuid;

use crate::storage::S3Client;
use super::types::{ChunkMetadata, UploadError};

// ============================================================================
// Chunk Store Trait
// ============================================================================

/// Trait for chunk storage backends
#[async_trait::async_trait]
pub trait ChunkStorage: Send + Sync {
    /// Store a chunk
    async fn store_chunk(
        &self,
        session_id: Uuid,
        chunk_index: usize,
        data: &[u8],
        expected_hash: &str,
    ) -> Result<ChunkMetadata, UploadError>;

    /// Get a chunk by session and index
    async fn get_chunk(
        &self,
        session_id: Uuid,
        chunk_index: usize,
    ) -> Result<Vec<u8>, UploadError>;

    /// Check if a chunk exists by hash
    async fn chunk_exists(&self, hash: &str) -> bool;

    /// Get chunk by hash (for deduplication)
    async fn get_chunk_by_hash(&self, hash: &str) -> Result<Vec<u8>, UploadError>;

    /// Delete all chunks for a session
    async fn delete_session_chunks(&self, session_id: Uuid) -> Result<usize, UploadError>;

    /// Assemble chunks into final file
    async fn assemble_chunks(
        &self,
        session_id: Uuid,
        chunk_count: usize,
    ) -> Result<Vec<u8>, UploadError>;
}

// ============================================================================
// Chunk Store (Main Implementation)
// ============================================================================

/// Main chunk store with pluggable backends
#[derive(Clone)]
pub struct ChunkStore {
    inner: Arc<ChunkStoreInner>,
}

struct ChunkStoreInner {
    /// Storage backend
    backend: Box<dyn ChunkStorage>,

    /// Chunk metadata cache (hash -> metadata)
    chunk_index: RwLock<HashMap<String, ChunkMetadata>>,

    /// Session -> chunk hash mappings
    session_chunks: RwLock<HashMap<Uuid, HashMap<usize, String>>>,
}

impl ChunkStore {
    /// Create with local filesystem storage
    pub fn with_local_storage(base_path: PathBuf) -> Self {
        Self {
            inner: Arc::new(ChunkStoreInner {
                backend: Box::new(LocalChunkStorage::new(base_path)),
                chunk_index: RwLock::new(HashMap::new()),
                session_chunks: RwLock::new(HashMap::new()),
            }),
        }
    }

    /// Create with S3 storage
    pub fn with_s3_storage(s3_client: S3Client, prefix: String) -> Self {
        Self {
            inner: Arc::new(ChunkStoreInner {
                backend: Box::new(S3ChunkStorage::new(s3_client, prefix)),
                chunk_index: RwLock::new(HashMap::new()),
                session_chunks: RwLock::new(HashMap::new()),
            }),
        }
    }

    /// Store a chunk with hash verification
    pub async fn store_chunk(
        &self,
        session_id: Uuid,
        chunk_index: usize,
        data: &[u8],
        expected_hash: &str,
    ) -> Result<ChunkMetadata, UploadError> {
        // Verify hash
        let actual_hash = compute_hash(data);
        if actual_hash != expected_hash {
            return Err(UploadError::ChunkHashMismatch {
                expected: expected_hash.to_string(),
                actual: actual_hash,
            });
        }

        // Check if chunk already exists (content-addressable)
        {
            let index = self.inner.chunk_index.read().await;
            if let Some(metadata) = index.get(&actual_hash) {
                // Chunk exists, just update mappings
                let mut session_chunks = self.inner.session_chunks.write().await;
                session_chunks
                    .entry(session_id)
                    .or_default()
                    .insert(chunk_index, actual_hash.clone());

                tracing::debug!(
                    session_id = %session_id,
                    chunk_index = chunk_index,
                    hash = %actual_hash,
                    "Chunk already exists, reusing"
                );

                return Ok(metadata.clone());
            }
        }

        // Store new chunk
        let metadata = self.inner.backend.store_chunk(
            session_id,
            chunk_index,
            data,
            expected_hash,
        ).await?;

        // Update indices
        {
            let mut index = self.inner.chunk_index.write().await;
            index.insert(actual_hash.clone(), metadata.clone());
        }

        {
            let mut session_chunks = self.inner.session_chunks.write().await;
            session_chunks
                .entry(session_id)
                .or_default()
                .insert(chunk_index, actual_hash);
        }

        Ok(metadata)
    }

    /// Get a chunk for a session
    pub async fn get_chunk(
        &self,
        session_id: Uuid,
        chunk_index: usize,
    ) -> Result<Vec<u8>, UploadError> {
        // Try to get from hash first
        let hash = {
            let session_chunks = self.inner.session_chunks.read().await;
            session_chunks
                .get(&session_id)
                .and_then(|chunks| chunks.get(&chunk_index))
                .cloned()
        };

        if let Some(hash) = hash {
            return self.inner.backend.get_chunk_by_hash(&hash).await;
        }

        // Fallback to direct storage
        self.inner.backend.get_chunk(session_id, chunk_index).await
    }

    /// Check if a chunk hash already exists
    pub async fn chunk_exists(&self, hash: &str) -> bool {
        let index = self.inner.chunk_index.read().await;
        index.contains_key(hash)
    }

    /// Find existing chunks from a list of hashes
    pub async fn find_existing_chunks(&self, hashes: &[String]) -> Vec<usize> {
        let index = self.inner.chunk_index.read().await;
        hashes
            .iter()
            .enumerate()
            .filter(|(_, hash)| index.contains_key(*hash))
            .map(|(i, _)| i)
            .collect()
    }

    /// Delete all chunks for a session
    pub async fn delete_session_chunks(&self, session_id: Uuid) -> Result<usize, UploadError> {
        // Remove from session mapping
        {
            let mut session_chunks = self.inner.session_chunks.write().await;
            session_chunks.remove(&session_id);
        }

        // Delete actual chunks
        self.inner.backend.delete_session_chunks(session_id).await
    }

    /// Assemble chunks into final file
    pub async fn assemble_chunks(
        &self,
        session_id: Uuid,
        chunk_count: usize,
    ) -> Result<Vec<u8>, UploadError> {
        self.inner.backend.assemble_chunks(session_id, chunk_count).await
    }

    /// Get total stored chunk count
    pub async fn chunk_count(&self) -> usize {
        let index = self.inner.chunk_index.read().await;
        index.len()
    }

    /// Cleanup orphaned chunks (not referenced by any session)
    pub async fn cleanup_orphaned(&self) -> usize {
        // Get all session chunk hashes
        let session_hashes: std::collections::HashSet<String> = {
            let session_chunks = self.inner.session_chunks.read().await;
            session_chunks
                .values()
                .flat_map(|chunks| chunks.values().cloned())
                .collect()
        };

        // Find orphaned chunks
        let orphaned: Vec<String> = {
            let index = self.inner.chunk_index.read().await;
            index
                .keys()
                .filter(|hash| !session_hashes.contains(*hash))
                .cloned()
                .collect()
        };

        let count = orphaned.len();

        // Remove orphaned from index
        if !orphaned.is_empty() {
            let mut index = self.inner.chunk_index.write().await;
            for hash in orphaned {
                index.remove(&hash);
            }
            tracing::info!(count = count, "Cleaned up orphaned chunks");
        }

        count
    }
}

// ============================================================================
// Local Filesystem Storage
// ============================================================================

/// Local filesystem chunk storage
struct LocalChunkStorage {
    base_path: PathBuf,
}

impl LocalChunkStorage {
    fn new(base_path: PathBuf) -> Self {
        Self { base_path }
    }

    fn chunk_path(&self, session_id: Uuid, chunk_index: usize) -> PathBuf {
        self.base_path
            .join("chunks")
            .join(session_id.to_string())
            .join(format!("{:08}.chunk", chunk_index))
    }

    fn hash_path(&self, hash: &str) -> PathBuf {
        // Content-addressable storage: first 2 chars as directory
        let (prefix, rest) = hash.split_at(2.min(hash.len()));
        self.base_path
            .join("by-hash")
            .join(prefix)
            .join(rest)
    }
}

#[async_trait::async_trait]
impl ChunkStorage for LocalChunkStorage {
    async fn store_chunk(
        &self,
        session_id: Uuid,
        chunk_index: usize,
        data: &[u8],
        expected_hash: &str,
    ) -> Result<ChunkMetadata, UploadError> {
        // Store by session/index
        let session_path = self.chunk_path(session_id, chunk_index);
        if let Some(parent) = session_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| UploadError::StorageError(e.to_string()))?;
        }

        tokio::fs::write(&session_path, data)
            .await
            .map_err(|e| UploadError::StorageError(e.to_string()))?;

        // Also store by hash (content-addressable)
        let hash_path = self.hash_path(expected_hash);
        if let Some(parent) = hash_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| UploadError::StorageError(e.to_string()))?;
        }

        // Hard link to avoid duplication
        if !hash_path.exists() {
            tokio::fs::copy(&session_path, &hash_path)
                .await
                .map_err(|e| UploadError::StorageError(e.to_string()))?;
        }

        Ok(ChunkMetadata {
            hash: expected_hash.to_string(),
            size: data.len(),
            storage_path: session_path.to_string_lossy().to_string(),
            stored_at: Utc::now(),
            ref_count: 1,
        })
    }

    async fn get_chunk(
        &self,
        session_id: Uuid,
        chunk_index: usize,
    ) -> Result<Vec<u8>, UploadError> {
        let path = self.chunk_path(session_id, chunk_index);
        tokio::fs::read(&path)
            .await
            .map_err(|e| UploadError::StorageError(format!("Failed to read chunk: {}", e)))
    }

    async fn chunk_exists(&self, hash: &str) -> bool {
        let path = self.hash_path(hash);
        path.exists()
    }

    async fn get_chunk_by_hash(&self, hash: &str) -> Result<Vec<u8>, UploadError> {
        let path = self.hash_path(hash);
        tokio::fs::read(&path)
            .await
            .map_err(|e| UploadError::StorageError(format!("Failed to read chunk by hash: {}", e)))
    }

    async fn delete_session_chunks(&self, session_id: Uuid) -> Result<usize, UploadError> {
        let session_dir = self.base_path.join("chunks").join(session_id.to_string());

        if !session_dir.exists() {
            return Ok(0);
        }

        let mut count = 0;
        let mut entries = tokio::fs::read_dir(&session_dir)
            .await
            .map_err(|e| UploadError::StorageError(e.to_string()))?;

        while let Some(entry) = entries.next_entry().await
            .map_err(|e| UploadError::StorageError(e.to_string()))?
        {
            tokio::fs::remove_file(entry.path())
                .await
                .map_err(|e| UploadError::StorageError(e.to_string()))?;
            count += 1;
        }

        // Remove empty directory
        let _ = tokio::fs::remove_dir(&session_dir).await;

        Ok(count)
    }

    async fn assemble_chunks(
        &self,
        session_id: Uuid,
        chunk_count: usize,
    ) -> Result<Vec<u8>, UploadError> {
        let mut result = Vec::new();

        for i in 0..chunk_count {
            let chunk = self.get_chunk(session_id, i).await?;
            result.extend_from_slice(&chunk);
        }

        Ok(result)
    }
}

// ============================================================================
// S3 Storage
// ============================================================================

/// S3-based chunk storage
struct S3ChunkStorage {
    client: S3Client,
    prefix: String,
}

impl S3ChunkStorage {
    fn new(client: S3Client, prefix: String) -> Self {
        Self { client, prefix }
    }

    fn chunk_key(&self, session_id: Uuid, chunk_index: usize) -> String {
        format!(
            "{}/chunks/{}/{:08}.chunk",
            self.prefix,
            session_id,
            chunk_index
        )
    }

    fn hash_key(&self, hash: &str) -> String {
        let (prefix, rest) = hash.split_at(2.min(hash.len()));
        format!("{}/by-hash/{}/{}", self.prefix, prefix, rest)
    }
}

#[async_trait::async_trait]
impl ChunkStorage for S3ChunkStorage {
    async fn store_chunk(
        &self,
        session_id: Uuid,
        chunk_index: usize,
        data: &[u8],
        expected_hash: &str,
    ) -> Result<ChunkMetadata, UploadError> {
        let key = self.chunk_key(session_id, chunk_index);

        self.client
            .put_object(&key, data.to_vec(), "application/octet-stream")
            .await
            .map_err(|e| UploadError::StorageError(e.to_string()))?;

        // Also store by hash for deduplication
        let hash_key = self.hash_key(expected_hash);
        self.client
            .put_object(&hash_key, data.to_vec(), "application/octet-stream")
            .await
            .map_err(|e| UploadError::StorageError(e.to_string()))?;

        Ok(ChunkMetadata {
            hash: expected_hash.to_string(),
            size: data.len(),
            storage_path: key,
            stored_at: Utc::now(),
            ref_count: 1,
        })
    }

    async fn get_chunk(
        &self,
        session_id: Uuid,
        chunk_index: usize,
    ) -> Result<Vec<u8>, UploadError> {
        let key = self.chunk_key(session_id, chunk_index);

        let obj = self.client
            .get_object(&key)
            .await
            .map_err(|e| UploadError::StorageError(format!("Failed to get chunk from S3: {}", e)))?;

        Ok(obj.data)
    }

    async fn chunk_exists(&self, hash: &str) -> bool {
        let key = self.hash_key(hash);
        self.client.object_exists(&key).await.unwrap_or(false)
    }

    async fn get_chunk_by_hash(&self, hash: &str) -> Result<Vec<u8>, UploadError> {
        let key = self.hash_key(hash);

        let obj = self.client
            .get_object(&key)
            .await
            .map_err(|e| UploadError::StorageError(format!("Failed to get chunk by hash: {}", e)))?;

        Ok(obj.data)
    }

    async fn delete_session_chunks(&self, session_id: Uuid) -> Result<usize, UploadError> {
        let prefix = format!("{}/chunks/{}/", self.prefix, session_id);

        self.client
            .delete_objects_with_prefix(&prefix)
            .await
            .map_err(|e| UploadError::StorageError(e.to_string()))
    }

    async fn assemble_chunks(
        &self,
        session_id: Uuid,
        chunk_count: usize,
    ) -> Result<Vec<u8>, UploadError> {
        let mut result = Vec::new();

        for i in 0..chunk_count {
            let chunk = self.get_chunk(session_id, i).await?;
            result.extend_from_slice(&chunk);
        }

        Ok(result)
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Compute SHA-256 hash of data
pub fn compute_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

/// Verify hash matches data
pub fn verify_hash(data: &[u8], expected_hash: &str) -> bool {
    compute_hash(data) == expected_hash
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_compute_hash() {
        let data = b"Hello, World!";
        let hash = compute_hash(data);
        assert_eq!(hash.len(), 64); // SHA-256 = 32 bytes = 64 hex chars
    }

    #[tokio::test]
    async fn test_local_chunk_storage() {
        let temp_dir = TempDir::new().unwrap();
        let store = ChunkStore::with_local_storage(temp_dir.path().to_path_buf());

        let session_id = Uuid::new_v4();
        let data = b"test chunk data";
        let hash = compute_hash(data);

        // Store chunk
        let metadata = store
            .store_chunk(session_id, 0, data, &hash)
            .await
            .unwrap();

        assert_eq!(metadata.hash, hash);
        assert_eq!(metadata.size, data.len());

        // Get chunk
        let retrieved = store.get_chunk(session_id, 0).await.unwrap();
        assert_eq!(retrieved, data);

        // Check existence
        assert!(store.chunk_exists(&hash).await);
        assert!(!store.chunk_exists("nonexistent").await);

        // Delete session chunks
        let deleted = store.delete_session_chunks(session_id).await.unwrap();
        assert_eq!(deleted, 1);
    }

    #[tokio::test]
    async fn test_chunk_assembly() {
        let temp_dir = TempDir::new().unwrap();
        let store = ChunkStore::with_local_storage(temp_dir.path().to_path_buf());

        let session_id = Uuid::new_v4();

        // Store multiple chunks
        let chunk1 = b"Hello, ";
        let chunk2 = b"World!";

        let hash1 = compute_hash(chunk1);
        let hash2 = compute_hash(chunk2);

        store.store_chunk(session_id, 0, chunk1, &hash1).await.unwrap();
        store.store_chunk(session_id, 1, chunk2, &hash2).await.unwrap();

        // Assemble
        let assembled = store.assemble_chunks(session_id, 2).await.unwrap();
        assert_eq!(assembled, b"Hello, World!");
    }

    #[tokio::test]
    async fn test_hash_mismatch() {
        let temp_dir = TempDir::new().unwrap();
        let store = ChunkStore::with_local_storage(temp_dir.path().to_path_buf());

        let session_id = Uuid::new_v4();
        let data = b"test data";

        let result = store
            .store_chunk(session_id, 0, data, "wrong_hash")
            .await;

        assert!(matches!(result, Err(UploadError::ChunkHashMismatch { .. })));
    }
}
