//! Reading progress API routes

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, put},
    Json, Router,
};
use sqlx::SqlitePool;

use crate::db::{ProgressRepository, ProgressUpdate, ReadingProgress};
use crate::error::{AppError, Result};
use crate::state::AppState;

/// Extended state with database pool
#[derive(Clone)]
pub struct ProgressState {
    pub pool: SqlitePool,
}

/// Create the progress router
pub fn router(pool: SqlitePool) -> Router<AppState> {
    let state = ProgressState { pool };

    Router::new()
        .route("/", get(list_all_progress))
        .route("/:book_id", get(get_progress))
        .route("/:book_id", put(update_progress))
        .route("/:book_id", delete(delete_progress))
        .route("/recent/:limit", get(recent_progress))
        .layer(axum::Extension(state))
}

/// List all progress
async fn list_all_progress(
    axum::Extension(state): axum::Extension<ProgressState>,
) -> Result<Json<Vec<ReadingProgress>>> {
    let repo = ProgressRepository::new(&state.pool);
    let progress = repo.list(None).await?;
    Ok(Json(progress))
}

/// Get progress for a specific book
async fn get_progress(
    axum::Extension(state): axum::Extension<ProgressState>,
    Path(book_id): Path<String>,
) -> Result<Json<ReadingProgress>> {
    let repo = ProgressRepository::new(&state.pool);
    let progress = repo
        .get(&book_id, None)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("No progress for book: {}", book_id)))?;
    Ok(Json(progress))
}

/// Update progress for a book
async fn update_progress(
    axum::Extension(state): axum::Extension<ProgressState>,
    Path(book_id): Path<String>,
    Json(update): Json<ProgressUpdate>,
) -> Result<Json<ReadingProgress>> {
    let repo = ProgressRepository::new(&state.pool);
    let progress = repo.upsert(&book_id, None, &update).await?;
    Ok(Json(progress))
}

/// Delete progress for a book
async fn delete_progress(
    axum::Extension(state): axum::Extension<ProgressState>,
    Path(book_id): Path<String>,
) -> Result<StatusCode> {
    let repo = ProgressRepository::new(&state.pool);
    let deleted = repo.delete(&book_id, None).await?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::NotFound(format!("No progress for book: {}", book_id)))
    }
}

/// Get recently read books
async fn recent_progress(
    axum::Extension(state): axum::Extension<ProgressState>,
    Path(limit): Path<i32>,
) -> Result<Json<Vec<ReadingProgress>>> {
    let repo = ProgressRepository::new(&state.pool);
    let progress = repo.recent(None, limit.min(100)).await?;
    Ok(Json(progress))
}
