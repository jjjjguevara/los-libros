//! Search API routes
//!
//! Provides FTS5-powered search endpoints for books and highlights.
//! Performance: ~50x faster than LIKE queries.

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::db::{
    BookSearchResult, FTS5Search, FTS5Stats, HighlightSearchResult, UnifiedSearchResult,
};
use crate::error::Result;
use crate::state::AppState;

/// Create the search router
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/books", get(search_books))
        .route("/highlights", get(search_highlights))
        .route("/unified", get(search_unified))
        .route("/stats", get(get_search_stats))
        .route("/rebuild", get(rebuild_indexes))
}

/// Query parameters for book search
#[derive(Debug, Deserialize)]
pub struct BookSearchQuery {
    /// Search query
    pub q: String,
    /// Filter by author
    pub authors: Option<String>,
    /// Maximum results (default: 100)
    #[serde(default = "default_limit")]
    pub limit: i32,
}

fn default_limit() -> i32 {
    100
}

/// Search books endpoint
///
/// GET /api/v1/search/books?q=rust async&authors=Steve Klabnik
async fn search_books(
    State(state): State<AppState>,
    Query(query): Query<BookSearchQuery>,
) -> Result<Json<SearchResponse<BookSearchResult>>> {
    let fts = FTS5Search::new(state.db());

    let results = if query.authors.is_some() {
        fts.search_books_advanced(&query.q, query.authors.as_deref(), query.limit)
            .await?
    } else {
        fts.search_books(&query.q, query.limit).await?
    };

    Ok(Json(SearchResponse {
        query: query.q,
        count: results.len(),
        results,
    }))
}

/// Query parameters for highlight search
#[derive(Debug, Deserialize)]
pub struct HighlightSearchQuery {
    /// Search query
    pub q: String,
    /// Filter by book ID
    pub book_id: Option<String>,
    /// Filter by colors (comma-separated)
    pub colors: Option<String>,
    /// Maximum results (default: 100)
    #[serde(default = "default_limit")]
    pub limit: i32,
}

/// Search highlights endpoint
///
/// GET /api/v1/search/highlights?q=async await&colors=yellow,blue
async fn search_highlights(
    State(state): State<AppState>,
    Query(query): Query<HighlightSearchQuery>,
) -> Result<Json<SearchResponse<HighlightSearchResult>>> {
    let fts = FTS5Search::new(state.db());

    let colors: Vec<String> = query
        .colors
        .as_ref()
        .map(|c| c.split(',').map(|s| s.trim().to_string()).collect())
        .unwrap_or_default();

    let results = if query.book_id.is_some() || !colors.is_empty() {
        fts.search_highlights_filtered(&query.q, query.book_id.as_deref(), &colors, query.limit)
            .await?
    } else {
        fts.search_highlights(&query.q, query.limit).await?
    };

    Ok(Json(SearchResponse {
        query: query.q,
        count: results.len(),
        results,
    }))
}

/// Query parameters for unified search
#[derive(Debug, Deserialize)]
pub struct UnifiedSearchQuery {
    /// Search query
    pub q: String,
    /// Maximum results (default: 50)
    #[serde(default = "default_unified_limit")]
    pub limit: i32,
}

fn default_unified_limit() -> i32 {
    50
}

/// Unified search endpoint (books + highlights)
///
/// GET /api/v1/search/unified?q=dependency injection
async fn search_unified(
    State(state): State<AppState>,
    Query(query): Query<UnifiedSearchQuery>,
) -> Result<Json<SearchResponse<UnifiedSearchResult>>> {
    let fts = FTS5Search::new(state.db());

    let results = fts.search_unified(&query.q, query.limit).await?;

    Ok(Json(SearchResponse {
        query: query.q,
        count: results.len(),
        results,
    }))
}

/// Get search index statistics
///
/// GET /api/v1/search/stats
async fn get_search_stats(State(state): State<AppState>) -> Result<Json<FTS5Stats>> {
    let fts = FTS5Search::new(state.db());
    let stats = fts.get_stats().await?;
    Ok(Json(stats))
}

/// Rebuild search indexes (admin operation)
///
/// GET /api/v1/search/rebuild
async fn rebuild_indexes(State(state): State<AppState>) -> Result<Json<RebuildResult>> {
    let fts = FTS5Search::new(state.db());

    let books_count = fts.rebuild_books_index().await?;
    let highlights_count = fts.rebuild_highlights_index().await?;

    Ok(Json(RebuildResult {
        success: true,
        books_indexed: books_count,
        highlights_indexed: highlights_count,
    }))
}

/// Generic search response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse<T> {
    pub query: String,
    pub count: usize,
    pub results: Vec<T>,
}

/// Index rebuild result
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildResult {
    pub success: bool,
    pub books_indexed: usize,
    pub highlights_indexed: usize,
}
