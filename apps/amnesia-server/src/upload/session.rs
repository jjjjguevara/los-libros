//! Upload Session Manager
//!
//! Manages upload sessions with:
//! - In-memory session storage with mutex protection
//! - Automatic session expiry cleanup
//! - Session state persistence to database

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;
use uuid::Uuid;

use super::types::{
    HandshakeRequest, UploadSession, SessionStatus, UploadError,
    MAX_CONCURRENT_UPLOADS,
};

// ============================================================================
// Session Manager
// ============================================================================

/// Manages upload sessions
#[derive(Clone)]
pub struct SessionManager {
    inner: Arc<SessionManagerInner>,
}

struct SessionManagerInner {
    /// Active sessions indexed by ID
    sessions: RwLock<HashMap<Uuid, UploadSession>>,

    /// Sessions indexed by file hash (for deduplication)
    sessions_by_hash: RwLock<HashMap<String, Vec<Uuid>>>,

    /// Maximum concurrent uploads (0 = unlimited)
    max_concurrent: usize,
}

impl SessionManager {
    /// Create a new session manager
    pub fn new() -> Self {
        Self {
            inner: Arc::new(SessionManagerInner {
                sessions: RwLock::new(HashMap::new()),
                sessions_by_hash: RwLock::new(HashMap::new()),
                max_concurrent: MAX_CONCURRENT_UPLOADS,
            }),
        }
    }

    /// Create a new session manager with custom max concurrent limit
    pub fn with_max_concurrent(max: usize) -> Self {
        Self {
            inner: Arc::new(SessionManagerInner {
                sessions: RwLock::new(HashMap::new()),
                sessions_by_hash: RwLock::new(HashMap::new()),
                max_concurrent: max,
            }),
        }
    }

    // ========================================================================
    // Session Lifecycle
    // ========================================================================

    /// Create a new upload session
    pub async fn create_session(
        &self,
        request: &HandshakeRequest,
    ) -> Result<UploadSession, UploadError> {
        // Check concurrent upload limit
        if self.inner.max_concurrent > 0 {
            let sessions = self.inner.sessions.read().await;
            let active_count = sessions
                .values()
                .filter(|s| matches!(s.status, SessionStatus::Pending | SessionStatus::Uploading))
                .count();

            if active_count >= self.inner.max_concurrent {
                return Err(UploadError::InternalError(format!(
                    "Too many concurrent uploads (max: {})",
                    self.inner.max_concurrent
                )));
            }
        }

        // Create new session
        let session = UploadSession::new(request);
        let id = session.id;
        let hash = session.file_hash.clone();

        // Store session
        {
            let mut sessions = self.inner.sessions.write().await;
            sessions.insert(id, session.clone());
        }

        // Index by hash for deduplication
        {
            let mut by_hash = self.inner.sessions_by_hash.write().await;
            by_hash.entry(hash).or_default().push(id);
        }

        tracing::info!(
            session_id = %id,
            file_name = %request.file_name,
            file_size = request.file_size,
            chunks = request.chunk_hashes.len(),
            "Created upload session"
        );

        Ok(session)
    }

    /// Get a session by ID
    pub async fn get_session(&self, id: Uuid) -> Result<UploadSession, UploadError> {
        let sessions = self.inner.sessions.read().await;
        sessions
            .get(&id)
            .cloned()
            .ok_or_else(|| UploadError::SessionNotFound(id.to_string()))
    }

    /// Get a session by string ID
    pub async fn get_session_by_str(&self, id: &str) -> Result<UploadSession, UploadError> {
        let uuid = Uuid::parse_str(id)
            .map_err(|_| UploadError::SessionNotFound(id.to_string()))?;
        self.get_session(uuid).await
    }

    /// Update a session
    pub async fn update_session(&self, session: UploadSession) -> Result<(), UploadError> {
        let mut sessions = self.inner.sessions.write().await;
        if !sessions.contains_key(&session.id) {
            return Err(UploadError::SessionNotFound(session.id.to_string()));
        }
        sessions.insert(session.id, session);
        Ok(())
    }

    /// Mark a chunk as received
    pub async fn mark_chunk_received(
        &self,
        session_id: Uuid,
        chunk_index: usize,
    ) -> Result<UploadSession, UploadError> {
        let mut sessions = self.inner.sessions.write().await;

        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| UploadError::SessionNotFound(session_id.to_string()))?;

        // Check if session is expired
        if session.is_expired() {
            session.status = SessionStatus::Expired;
            return Err(UploadError::SessionExpired(session_id.to_string()));
        }

        // Check if session is in valid state
        if !matches!(session.status, SessionStatus::Pending | SessionStatus::Uploading) {
            return Err(UploadError::InternalError(format!(
                "Session in invalid state: {:?}",
                session.status
            )));
        }

        // Validate chunk index
        if chunk_index >= session.chunk_hashes.len() {
            return Err(UploadError::ChunkIndexOutOfBounds {
                index: chunk_index,
                max: session.chunk_hashes.len() - 1,
            });
        }

        // Mark chunk received
        session.mark_chunk_received(chunk_index);
        session.status = SessionStatus::Uploading;

        // Check if complete
        if session.is_complete() {
            session.status = SessionStatus::Ready;
        }

        Ok(session.clone())
    }

    /// Complete a session (after file assembly)
    pub async fn complete_session(&self, session_id: Uuid) -> Result<(), UploadError> {
        let mut sessions = self.inner.sessions.write().await;

        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| UploadError::SessionNotFound(session_id.to_string()))?;

        session.status = SessionStatus::Complete;

        tracing::info!(
            session_id = %session_id,
            file_name = %session.file_name,
            "Upload session completed"
        );

        Ok(())
    }

    /// Cancel/delete a session
    pub async fn cancel_session(&self, session_id: Uuid) -> Result<UploadSession, UploadError> {
        let session = {
            let mut sessions = self.inner.sessions.write().await;
            sessions
                .remove(&session_id)
                .ok_or_else(|| UploadError::SessionNotFound(session_id.to_string()))?
        };

        // Remove from hash index
        {
            let mut by_hash = self.inner.sessions_by_hash.write().await;
            if let Some(ids) = by_hash.get_mut(&session.file_hash) {
                ids.retain(|id| *id != session_id);
                if ids.is_empty() {
                    by_hash.remove(&session.file_hash);
                }
            }
        }

        tracing::info!(
            session_id = %session_id,
            file_name = %session.file_name,
            "Upload session cancelled"
        );

        Ok(session)
    }

    // ========================================================================
    // Query Methods
    // ========================================================================

    /// Find sessions by file hash
    pub async fn find_by_hash(&self, file_hash: &str) -> Vec<UploadSession> {
        let by_hash = self.inner.sessions_by_hash.read().await;
        let sessions = self.inner.sessions.read().await;

        by_hash
            .get(file_hash)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| sessions.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get all active sessions
    pub async fn get_active_sessions(&self) -> Vec<UploadSession> {
        let sessions = self.inner.sessions.read().await;
        sessions
            .values()
            .filter(|s| matches!(s.status, SessionStatus::Pending | SessionStatus::Uploading | SessionStatus::Ready))
            .cloned()
            .collect()
    }

    /// Get session count
    pub async fn session_count(&self) -> usize {
        let sessions = self.inner.sessions.read().await;
        sessions.len()
    }

    /// Get active session count
    pub async fn active_session_count(&self) -> usize {
        let sessions = self.inner.sessions.read().await;
        sessions
            .values()
            .filter(|s| matches!(s.status, SessionStatus::Pending | SessionStatus::Uploading))
            .count()
    }

    // ========================================================================
    // Cleanup
    // ========================================================================

    /// Clean up expired sessions
    ///
    /// Returns the number of sessions cleaned up
    pub async fn cleanup_expired(&self) -> usize {
        let now = Utc::now();
        let mut expired_ids = Vec::new();

        // Find expired sessions
        {
            let sessions = self.inner.sessions.read().await;
            for (id, session) in sessions.iter() {
                if session.expires_at < now {
                    expired_ids.push(*id);
                }
            }
        }

        // Remove expired sessions
        let count = expired_ids.len();
        for id in expired_ids {
            if let Ok(session) = self.cancel_session(id).await {
                tracing::debug!(
                    session_id = %id,
                    file_name = %session.file_name,
                    "Cleaned up expired session"
                );
            }
        }

        if count > 0 {
            tracing::info!(count = count, "Cleaned up expired upload sessions");
        }

        count
    }

    /// Clean up sessions older than a given duration
    pub async fn cleanup_older_than(&self, hours: i64) -> usize {
        let cutoff = Utc::now() - chrono::Duration::hours(hours);
        let mut old_ids = Vec::new();

        {
            let sessions = self.inner.sessions.read().await;
            for (id, session) in sessions.iter() {
                if session.created_at < cutoff {
                    old_ids.push(*id);
                }
            }
        }

        let count = old_ids.len();
        for id in old_ids {
            let _ = self.cancel_session(id).await;
        }

        count
    }

    /// Start background cleanup task
    pub fn start_cleanup_task(self) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(300)); // 5 minutes

            loop {
                interval.tick().await;
                self.cleanup_expired().await;
            }
        })
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_request() -> HandshakeRequest {
        HandshakeRequest {
            file_name: "test.epub".to_string(),
            file_size: 1024 * 1024,
            file_hash: "abc123".to_string(),
            chunk_hashes: vec!["chunk1".to_string(), "chunk2".to_string()],
            mime_type: "application/epub+zip".to_string(),
            chunk_size: None,
        }
    }

    #[tokio::test]
    async fn test_create_session() {
        let manager = SessionManager::new();
        let request = create_test_request();

        let session = manager.create_session(&request).await.unwrap();

        assert_eq!(session.file_name, "test.epub");
        assert_eq!(session.file_size, 1024 * 1024);
        assert_eq!(session.chunk_hashes.len(), 2);
        assert_eq!(session.status, SessionStatus::Pending);
    }

    #[tokio::test]
    async fn test_mark_chunk_received() {
        let manager = SessionManager::new();
        let request = create_test_request();
        let session = manager.create_session(&request).await.unwrap();

        // Mark first chunk
        let updated = manager.mark_chunk_received(session.id, 0).await.unwrap();
        assert_eq!(updated.received_chunks, vec![0]);
        assert_eq!(updated.status, SessionStatus::Uploading);

        // Mark second chunk
        let updated = manager.mark_chunk_received(session.id, 1).await.unwrap();
        assert_eq!(updated.received_chunks, vec![0, 1]);
        assert_eq!(updated.status, SessionStatus::Ready);
        assert!(updated.is_complete());
    }

    #[tokio::test]
    async fn test_find_by_hash() {
        let manager = SessionManager::new();
        let request = create_test_request();
        let session = manager.create_session(&request).await.unwrap();

        let found = manager.find_by_hash("abc123").await;
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, session.id);

        let not_found = manager.find_by_hash("nonexistent").await;
        assert!(not_found.is_empty());
    }

    #[tokio::test]
    async fn test_cancel_session() {
        let manager = SessionManager::new();
        let request = create_test_request();
        let session = manager.create_session(&request).await.unwrap();

        manager.cancel_session(session.id).await.unwrap();

        let result = manager.get_session(session.id).await;
        assert!(result.is_err());
    }
}
