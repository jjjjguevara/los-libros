//! Sync data types
//!
//! Defines types for multi-device synchronization including:
//! - Sync records with version tracking
//! - Change operations
//! - Conflict detection

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A sync record wrapping any syncable entity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRecord<T> {
    /// The entity being synced
    pub data: T,
    /// Monotonically increasing version number
    pub version: u64,
    /// Device that made this change
    #[serde(rename = "deviceId")]
    pub device_id: String,
    /// Timestamp of the change
    pub timestamp: DateTime<Utc>,
    /// Whether this record has been deleted
    pub deleted: bool,
    /// Checksum for integrity verification
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
}

impl<T> SyncRecord<T> {
    /// Create a new sync record
    pub fn new(data: T, device_id: &str) -> Self {
        Self {
            data,
            version: 1,
            device_id: device_id.to_string(),
            timestamp: Utc::now(),
            deleted: false,
            checksum: None,
        }
    }

    /// Increment version for a new change
    pub fn increment_version(&mut self, device_id: &str) {
        self.version += 1;
        self.device_id = device_id.to_string();
        self.timestamp = Utc::now();
    }

    /// Mark as deleted
    pub fn mark_deleted(&mut self, device_id: &str) {
        self.deleted = true;
        self.increment_version(device_id);
    }
}

/// Types of sync operations
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OperationType {
    Create,
    Update,
    Delete,
}

/// A sync operation representing a change
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncOperation {
    /// Unique operation ID
    pub id: String,
    /// Type of operation
    #[serde(rename = "type")]
    pub operation_type: OperationType,
    /// Entity type being synced
    #[serde(rename = "entityType")]
    pub entity_type: EntityType,
    /// Entity ID
    #[serde(rename = "entityId")]
    pub entity_id: String,
    /// The data payload (JSON)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    /// Base version this operation was made against
    #[serde(rename = "baseVersion")]
    pub base_version: u64,
    /// Device that made this change
    #[serde(rename = "deviceId")]
    pub device_id: String,
    /// Timestamp of the operation
    pub timestamp: DateTime<Utc>,
}

/// Types of entities that can be synced
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntityType {
    Annotation,
    Progress,
    Bookmark,
}

/// Sync status for a book or device
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    /// Last successful sync timestamp
    #[serde(rename = "lastSync")]
    pub last_sync: Option<DateTime<Utc>>,
    /// Current sync version
    pub version: u64,
    /// Number of pending changes
    #[serde(rename = "pendingChanges")]
    pub pending_changes: usize,
    /// Whether sync is in progress
    #[serde(rename = "inProgress")]
    pub in_progress: bool,
    /// Last error if any
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Default for SyncStatus {
    fn default() -> Self {
        Self {
            last_sync: None,
            version: 0,
            pending_changes: 0,
            in_progress: false,
            error: None,
        }
    }
}

/// Request to push changes to server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushRequest {
    /// Device making the push
    #[serde(rename = "deviceId")]
    pub device_id: String,
    /// Book ID being synced
    #[serde(rename = "bookId")]
    pub book_id: String,
    /// Operations to push
    pub operations: Vec<SyncOperation>,
    /// Last known server version
    #[serde(rename = "lastKnownVersion")]
    pub last_known_version: u64,
}

/// Response from push operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushResponse {
    /// Whether push was successful
    pub success: bool,
    /// New server version after push
    pub version: u64,
    /// Conflicts that need resolution
    pub conflicts: Vec<Conflict>,
    /// Operations that were accepted
    #[serde(rename = "acceptedCount")]
    pub accepted_count: usize,
}

/// Request to pull changes from server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequest {
    /// Device making the pull
    #[serde(rename = "deviceId")]
    pub device_id: String,
    /// Book ID being synced
    #[serde(rename = "bookId")]
    pub book_id: String,
    /// Last known version on this device
    #[serde(rename = "sinceVersion")]
    pub since_version: u64,
}

/// Response from pull operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullResponse {
    /// Operations since the requested version
    pub operations: Vec<SyncOperation>,
    /// Current server version
    #[serde(rename = "currentVersion")]
    pub current_version: u64,
    /// Whether there are more changes available
    #[serde(rename = "hasMore")]
    pub has_more: bool,
}

/// A conflict between local and remote changes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conflict {
    /// Entity type in conflict
    #[serde(rename = "entityType")]
    pub entity_type: EntityType,
    /// Entity ID in conflict
    #[serde(rename = "entityId")]
    pub entity_id: String,
    /// Local version of the entity
    #[serde(rename = "localVersion")]
    pub local_version: u64,
    /// Server version of the entity
    #[serde(rename = "serverVersion")]
    pub server_version: u64,
    /// Local data
    #[serde(rename = "localData")]
    pub local_data: serde_json::Value,
    /// Server data
    #[serde(rename = "serverData")]
    pub server_data: serde_json::Value,
    /// Suggested resolution
    pub resolution: ConflictResolution,
}

/// How to resolve a conflict
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictResolution {
    /// Keep the server version
    UseServer,
    /// Keep the local version
    UseLocal,
    /// Use the most recent change
    UseMostRecent,
    /// Merge changes (for compatible updates)
    Merge,
    /// Manual resolution required
    Manual,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sync_record_versioning() {
        let mut record = SyncRecord::new("test data", "device-1");
        assert_eq!(record.version, 1);
        assert_eq!(record.device_id, "device-1");

        record.increment_version("device-2");
        assert_eq!(record.version, 2);
        assert_eq!(record.device_id, "device-2");
    }

    #[test]
    fn test_sync_record_deletion() {
        let mut record = SyncRecord::new("test data", "device-1");
        assert!(!record.deleted);

        record.mark_deleted("device-2");
        assert!(record.deleted);
        assert_eq!(record.version, 2);
    }

    #[test]
    fn test_push_request_serialization() {
        let request = PushRequest {
            device_id: "device-1".to_string(),
            book_id: "book-123".to_string(),
            operations: vec![],
            last_known_version: 5,
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("deviceId"));
        assert!(json.contains("bookId"));
        assert!(json.contains("lastKnownVersion"));
    }
}
