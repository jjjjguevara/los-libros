//! Sync module for multi-device synchronization
//!
//! Provides:
//! - Version-based change tracking
//! - Conflict detection and resolution
//! - Push/pull sync operations
//!
//! # Sync Protocol
//!
//! 1. Client sends `PushRequest` with local changes
//! 2. Server detects conflicts with changes since `last_known_version`
//! 3. Server applies non-conflicting changes and returns conflicts
//! 4. Client resolves conflicts and retries if needed
//! 5. Client sends `PullRequest` to get server changes
//!
//! # Conflict Resolution
//!
//! - Delete wins over update
//! - Most recent change wins for concurrent updates
//! - Disjoint field updates can be merged

mod conflict;
mod store;
mod types;

pub use conflict::{ConflictResolver, ConflictWinner, ResolvedConflict};
pub use store::SyncRepository;
pub use types::{
    Conflict, ConflictResolution, EntityType, OperationType, PullRequest, PullResponse,
    PushRequest, PushResponse, SyncOperation, SyncRecord, SyncStatus,
};
