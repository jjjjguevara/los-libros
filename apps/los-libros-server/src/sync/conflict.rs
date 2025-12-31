//! Conflict detection and resolution
//!
//! Implements strategies for handling concurrent edits from multiple devices.

use chrono::{DateTime, Utc};
use serde_json::Value;

use super::types::{Conflict, ConflictResolution, EntityType, SyncOperation};

/// Conflict resolver with configurable strategies
pub struct ConflictResolver {
    /// Default resolution strategy
    default_strategy: ConflictResolution,
}

impl ConflictResolver {
    /// Create a new resolver with default strategy
    pub fn new(default_strategy: ConflictResolution) -> Self {
        Self { default_strategy }
    }

    /// Detect if there's a conflict between local and server operations
    pub fn detect_conflict(
        &self,
        local_op: &SyncOperation,
        server_ops: &[SyncOperation],
    ) -> Option<Conflict> {
        // Find any server operation that modified the same entity
        let conflicting_server_op = server_ops.iter().find(|server_op| {
            server_op.entity_type == local_op.entity_type
                && server_op.entity_id == local_op.entity_id
                && server_op.device_id != local_op.device_id
        });

        conflicting_server_op.map(|server_op| Conflict {
            entity_type: local_op.entity_type,
            entity_id: local_op.entity_id.clone(),
            local_version: local_op.base_version,
            server_version: server_op.base_version,
            local_data: local_op.payload.clone().unwrap_or(Value::Null),
            server_data: server_op.payload.clone().unwrap_or(Value::Null),
            resolution: self.suggest_resolution(local_op, server_op),
        })
    }

    /// Suggest a resolution strategy based on the conflict type
    fn suggest_resolution(
        &self,
        local_op: &SyncOperation,
        server_op: &SyncOperation,
    ) -> ConflictResolution {
        use super::types::OperationType;

        match (&local_op.operation_type, &server_op.operation_type) {
            // Delete wins over update (simpler model)
            (OperationType::Delete, _) | (_, OperationType::Delete) => {
                if local_op.operation_type == OperationType::Delete {
                    ConflictResolution::UseLocal
                } else {
                    ConflictResolution::UseServer
                }
            }

            // Both are updates - use most recent
            (OperationType::Update, OperationType::Update) => ConflictResolution::UseMostRecent,

            // Create conflicts are rare - use server
            (OperationType::Create, OperationType::Create) => ConflictResolution::UseServer,

            // Default to most recent
            _ => self.default_strategy,
        }
    }

    /// Resolve a conflict and return the winning data
    pub fn resolve(&self, conflict: &Conflict) -> ResolvedConflict {
        match conflict.resolution {
            ConflictResolution::UseServer => ResolvedConflict {
                winner: ConflictWinner::Server,
                data: conflict.server_data.clone(),
                version: conflict.server_version,
            },
            ConflictResolution::UseLocal => ResolvedConflict {
                winner: ConflictWinner::Local,
                data: conflict.local_data.clone(),
                version: conflict.local_version,
            },
            ConflictResolution::UseMostRecent => {
                // Compare timestamps if available
                let local_time = extract_timestamp(&conflict.local_data);
                let server_time = extract_timestamp(&conflict.server_data);

                match (local_time, server_time) {
                    (Some(local), Some(server)) if local > server => ResolvedConflict {
                        winner: ConflictWinner::Local,
                        data: conflict.local_data.clone(),
                        version: conflict.local_version,
                    },
                    _ => ResolvedConflict {
                        winner: ConflictWinner::Server,
                        data: conflict.server_data.clone(),
                        version: conflict.server_version,
                    },
                }
            }
            ConflictResolution::Merge => {
                // Attempt to merge non-conflicting fields
                let merged = merge_json(&conflict.server_data, &conflict.local_data);
                ResolvedConflict {
                    winner: ConflictWinner::Merged,
                    data: merged,
                    version: conflict.server_version.max(conflict.local_version),
                }
            }
            ConflictResolution::Manual => ResolvedConflict {
                winner: ConflictWinner::Unresolved,
                data: Value::Null,
                version: 0,
            },
        }
    }

    /// Check if operations can be auto-merged without conflict
    pub fn can_auto_merge(&self, local_op: &SyncOperation, server_op: &SyncOperation) -> bool {
        // Different entities never conflict
        if local_op.entity_id != server_op.entity_id {
            return true;
        }

        // Different entity types never conflict
        if local_op.entity_type != server_op.entity_type {
            return true;
        }

        // Same device operations are sequential, not conflicting
        if local_op.device_id == server_op.device_id {
            return true;
        }

        // Check if the fields being modified are disjoint
        if let (Some(local_data), Some(server_data)) = (&local_op.payload, &server_op.payload) {
            return fields_are_disjoint(local_data, server_data);
        }

        false
    }
}

impl Default for ConflictResolver {
    fn default() -> Self {
        Self::new(ConflictResolution::UseMostRecent)
    }
}

/// Result of conflict resolution
#[derive(Debug, Clone)]
pub struct ResolvedConflict {
    pub winner: ConflictWinner,
    pub data: Value,
    pub version: u64,
}

/// Which side won the conflict
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictWinner {
    Local,
    Server,
    Merged,
    Unresolved,
}

/// Extract timestamp from JSON data if present
fn extract_timestamp(data: &Value) -> Option<DateTime<Utc>> {
    data.get("updatedAt")
        .or_else(|| data.get("updated_at"))
        .or_else(|| data.get("timestamp"))
        .and_then(|v| v.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
}

/// Merge two JSON objects, preferring local for conflicting keys
fn merge_json(server: &Value, local: &Value) -> Value {
    match (server, local) {
        (Value::Object(server_map), Value::Object(local_map)) => {
            let mut merged = server_map.clone();
            for (key, value) in local_map {
                // Local overwrites server for same keys
                merged.insert(key.clone(), value.clone());
            }
            Value::Object(merged)
        }
        // For non-objects, prefer local
        _ => local.clone(),
    }
}

/// Check if two JSON objects modify disjoint sets of fields
fn fields_are_disjoint(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Object(map_a), Value::Object(map_b)) => {
            // Check if any keys overlap
            !map_a.keys().any(|k| map_b.contains_key(k))
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::types::OperationType;

    fn make_operation(
        entity_id: &str,
        op_type: OperationType,
        device_id: &str,
        payload: Option<Value>,
    ) -> SyncOperation {
        SyncOperation {
            id: uuid::Uuid::new_v4().to_string(),
            operation_type: op_type,
            entity_type: EntityType::Annotation,
            entity_id: entity_id.to_string(),
            payload,
            base_version: 1,
            device_id: device_id.to_string(),
            timestamp: Utc::now(),
        }
    }

    #[test]
    fn test_no_conflict_different_entities() {
        let resolver = ConflictResolver::default();

        let local = make_operation("entity-1", OperationType::Update, "device-1", None);
        let server_ops = vec![make_operation(
            "entity-2",
            OperationType::Update,
            "device-2",
            None,
        )];

        assert!(resolver.detect_conflict(&local, &server_ops).is_none());
    }

    #[test]
    fn test_conflict_same_entity_different_devices() {
        let resolver = ConflictResolver::default();

        let local = make_operation("entity-1", OperationType::Update, "device-1", None);
        let server_ops = vec![make_operation(
            "entity-1",
            OperationType::Update,
            "device-2",
            None,
        )];

        let conflict = resolver.detect_conflict(&local, &server_ops);
        assert!(conflict.is_some());
        assert_eq!(conflict.unwrap().resolution, ConflictResolution::UseMostRecent);
    }

    #[test]
    fn test_no_conflict_same_device() {
        let resolver = ConflictResolver::default();

        let local = make_operation("entity-1", OperationType::Update, "device-1", None);
        let server = make_operation("entity-1", OperationType::Update, "device-1", None);

        assert!(resolver.can_auto_merge(&local, &server));
    }

    #[test]
    fn test_delete_wins() {
        let resolver = ConflictResolver::default();

        let local = make_operation("entity-1", OperationType::Delete, "device-1", None);
        let server_ops = vec![make_operation(
            "entity-1",
            OperationType::Update,
            "device-2",
            None,
        )];

        let conflict = resolver.detect_conflict(&local, &server_ops).unwrap();
        assert_eq!(conflict.resolution, ConflictResolution::UseLocal);
    }

    #[test]
    fn test_merge_json() {
        let server = serde_json::json!({
            "color": "red",
            "note": "server note"
        });
        let local = serde_json::json!({
            "note": "local note",
            "tags": ["a", "b"]
        });

        let merged = merge_json(&server, &local);

        assert_eq!(merged["color"], "red");
        assert_eq!(merged["note"], "local note"); // Local wins
        assert_eq!(merged["tags"], serde_json::json!(["a", "b"]));
    }

    #[test]
    fn test_disjoint_fields() {
        let a = serde_json::json!({"color": "red"});
        let b = serde_json::json!({"note": "text"});

        assert!(fields_are_disjoint(&a, &b));

        let c = serde_json::json!({"color": "blue"});
        assert!(!fields_are_disjoint(&a, &c));
    }
}
