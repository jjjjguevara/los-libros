//! Highlights API routes

use axum::{
    extract::Path,
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use sqlx::SqlitePool;

use crate::db::{CreateHighlight, Highlight, HighlightRepository, UpdateHighlight};
use crate::error::{AppError, Result};
use crate::state::AppState;

/// Extended state with database pool
#[derive(Clone)]
pub struct HighlightsState {
    pub pool: SqlitePool,
}

/// Create the highlights router
pub fn router(pool: SqlitePool) -> Router<AppState> {
    let state = HighlightsState { pool };

    Router::new()
        .route("/", get(list_all_highlights))
        .route("/book/:book_id", get(list_book_highlights))
        .route("/book/:book_id", post(create_highlight))
        .route("/book/:book_id/count", get(count_highlights))
        // PDF-specific: list highlights for a specific page
        .route("/book/:book_id/page/:page", get(list_pdf_page_highlights))
        .route("/:id", get(get_highlight))
        .route("/:id", patch(update_highlight))
        .route("/:id", delete(delete_highlight))
        .route("/search", get(search_highlights))
        .layer(axum::Extension(state))
}

/// List all highlights
async fn list_all_highlights(
    axum::Extension(state): axum::Extension<HighlightsState>,
) -> Result<Json<Vec<Highlight>>> {
    let repo = HighlightRepository::new(&state.pool);
    let highlights = repo.list(None).await?;
    Ok(Json(highlights))
}

/// List highlights for a specific book
async fn list_book_highlights(
    axum::Extension(state): axum::Extension<HighlightsState>,
    Path(book_id): Path<String>,
) -> Result<Json<Vec<Highlight>>> {
    let repo = HighlightRepository::new(&state.pool);
    let highlights = repo.list_for_book(&book_id, None).await?;
    Ok(Json(highlights))
}

/// List PDF highlights for a specific page
async fn list_pdf_page_highlights(
    axum::Extension(state): axum::Extension<HighlightsState>,
    Path((book_id, page)): Path<(String, i32)>,
) -> Result<Json<Vec<Highlight>>> {
    let repo = HighlightRepository::new(&state.pool);
    let highlights = repo.list_for_pdf_page(&book_id, page, None).await?;
    Ok(Json(highlights))
}

/// Create a new highlight
async fn create_highlight(
    axum::Extension(state): axum::Extension<HighlightsState>,
    Path(book_id): Path<String>,
    Json(data): Json<CreateHighlight>,
) -> Result<(StatusCode, Json<Highlight>)> {
    let repo = HighlightRepository::new(&state.pool);
    let highlight = repo.create(&book_id, None, &data).await?;
    Ok((StatusCode::CREATED, Json(highlight)))
}

/// Get a specific highlight
async fn get_highlight(
    axum::Extension(state): axum::Extension<HighlightsState>,
    Path(id): Path<String>,
) -> Result<Json<Highlight>> {
    let repo = HighlightRepository::new(&state.pool);
    let highlight = repo
        .get(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Highlight not found: {}", id)))?;
    Ok(Json(highlight))
}

/// Update a highlight
async fn update_highlight(
    axum::Extension(state): axum::Extension<HighlightsState>,
    Path(id): Path<String>,
    Json(data): Json<UpdateHighlight>,
) -> Result<Json<Highlight>> {
    let repo = HighlightRepository::new(&state.pool);
    let highlight = repo
        .update(&id, &data)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Highlight not found: {}", id)))?;
    Ok(Json(highlight))
}

/// Delete a highlight
async fn delete_highlight(
    axum::Extension(state): axum::Extension<HighlightsState>,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    let repo = HighlightRepository::new(&state.pool);
    let deleted = repo.delete(&id).await?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::NotFound(format!("Highlight not found: {}", id)))
    }
}

/// Count highlights for a book
async fn count_highlights(
    axum::Extension(state): axum::Extension<HighlightsState>,
    Path(book_id): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let repo = HighlightRepository::new(&state.pool);
    let count = repo.count_for_book(&book_id, None).await?;
    Ok(Json(serde_json::json!({ "count": count })))
}

/// Search query parameters
#[derive(serde::Deserialize)]
struct SearchQuery {
    q: String,
}

/// Search highlights
async fn search_highlights(
    axum::Extension(state): axum::Extension<HighlightsState>,
    axum::extract::Query(query): axum::extract::Query<SearchQuery>,
) -> Result<Json<Vec<Highlight>>> {
    let repo = HighlightRepository::new(&state.pool);
    let highlights = repo.search(None, &query.q).await?;
    Ok(Json(highlights))
}
