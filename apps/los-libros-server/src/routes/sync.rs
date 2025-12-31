//! Sync API endpoints
//!
//! Provides endpoints for multi-device synchronization.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::state::AppState;
use crate::sync::{
    ConflictResolver, PullRequest, PullResponse, PushRequest, PushResponse, SyncRepository,
    SyncStatus,
};

/// Create the sync router
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/push", post(push_changes))
        .route("/pull", post(pull_changes))
        .route("/status/{book_id}", get(get_sync_status))
}

/// Error response
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

/// Push local changes to server
async fn push_changes(
    State(state): State<AppState>,
    Json(req): Json<PushRequest>,
) -> Result<Json<PushResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo = SyncRepository::new(state.db());
    let resolver = ConflictResolver::default();

    // Get operations since the client's last known version
    let server_ops = repo
        .get_operations_since(&req.book_id, req.last_known_version, None)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;

    let mut conflicts = Vec::new();
    let mut accepted = Vec::new();

    // Check each client operation for conflicts
    for op in &req.operations {
        if let Some(conflict) = resolver.detect_conflict(op, &server_ops) {
            conflicts.push(conflict);
        } else {
            // No conflict - record the operation
            if let Err(e) = repo.record_operation(&req.book_id, op).await {
                tracing::warn!("Failed to record operation {}: {}", op.id, e);
                continue;
            }
            accepted.push(op.id.clone());
        }
    }

    // Increment version if we accepted any operations
    let new_version = if !accepted.is_empty() {
        repo.increment_version(&req.book_id, &req.device_id)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: e.to_string(),
                    }),
                )
            })?
    } else {
        repo.get_version(&req.book_id).await.unwrap_or(0)
    };

    Ok(Json(PushResponse {
        success: conflicts.is_empty(),
        version: new_version,
        conflicts,
        accepted_count: accepted.len(),
    }))
}

/// Pull changes from server
async fn pull_changes(
    State(state): State<AppState>,
    Json(req): Json<PullRequest>,
) -> Result<Json<PullResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo = SyncRepository::new(state.db());

    let operations = repo
        .get_operations_since(&req.book_id, req.since_version, Some(100))
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;

    let current_version = repo.get_version(&req.book_id).await.unwrap_or(0);

    // Check if there are more operations beyond this batch
    let has_more = operations.len() == 100;

    Ok(Json(PullResponse {
        operations,
        current_version,
        has_more,
    }))
}

/// Get sync status for a book
async fn get_sync_status(
    State(state): State<AppState>,
    Path(book_id): Path<String>,
) -> Result<Json<SyncStatus>, (StatusCode, Json<ErrorResponse>)> {
    let repo = SyncRepository::new(state.db());

    let status = repo.get_status(&book_id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;

    Ok(Json(status))
}
