//! OPDS catalog routes
//!
//! Serves OPDS 1.2 Atom feeds for book browsing and acquisition.

use axum::{
    extract::{Path, Query, State},
    http::header,
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::error::Result;
use crate::library::{LibraryBook, LibraryScanner};
use crate::opds::{serialize_feed, mime, OPDSEntry, OPDSFeed};
use crate::state::AppState;

/// Cached library state
#[derive(Clone)]
pub struct LibraryCache {
    books: Arc<RwLock<Vec<LibraryBook>>>,
}

impl LibraryCache {
    pub fn new() -> Self {
        Self {
            books: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub async fn refresh(&self, scanner: &LibraryScanner) -> Result<()> {
        let books = scanner.scan_library().await?;
        *self.books.write().await = books;
        Ok(())
    }

    pub async fn get_books(&self) -> Vec<LibraryBook> {
        self.books.read().await.clone()
    }
}

/// Create the OPDS router
pub fn router(cache: LibraryCache) -> Router<AppState> {
    Router::new()
        .route("/", get(root_catalog))
        .route("/all", get(all_books))
        .route("/authors", get(authors_list))
        .route("/author/:name", get(author_books))
        .route("/series", get(series_list))
        .route("/series/:name", get(series_books))
        .route("/recent", get(recent_books))
        .route("/search", get(search_books))
        .route("/refresh", get(refresh_library))
        .layer(axum::Extension(cache))
}

/// Response with OPDS XML content type
struct OPDSResponse(String);

impl IntoResponse for OPDSResponse {
    fn into_response(self) -> Response {
        (
            [(header::CONTENT_TYPE, mime::ATOM_XML)],
            self.0,
        )
            .into_response()
    }
}

/// Get base URL from request
fn base_url(state: &AppState) -> String {
    format!(
        "http://{}:{}",
        state.config().server.host,
        state.config().server.port
    )
}

/// Root catalog
async fn root_catalog(State(state): State<AppState>) -> Result<OPDSResponse> {
    let feed = OPDSFeed::root_catalog(&base_url(&state));
    let xml = serialize_feed(&feed)?;
    Ok(OPDSResponse(xml))
}

/// All books
async fn all_books(
    State(state): State<AppState>,
    axum::Extension(cache): axum::Extension<LibraryCache>,
) -> Result<OPDSResponse> {
    let books = cache.get_books().await;
    let base = base_url(&state);

    let mut feed = OPDSFeed::acquisition("All Books", &format!("{}/opds/all", base));
    feed.links.push(crate::opds::OPDSLink {
        href: "/opds".to_string(),
        rel: Some(crate::opds::rel::UP.to_string()),
        link_type: Some(mime::ATOM_CATALOG.to_string()),
        title: None,
    });
    feed.add_books(&books, &base);

    let xml = serialize_feed(&feed)?;
    Ok(OPDSResponse(xml))
}

/// Authors list
async fn authors_list(
    State(state): State<AppState>,
    axum::Extension(cache): axum::Extension<LibraryCache>,
) -> Result<OPDSResponse> {
    let books = cache.get_books().await;
    let base = base_url(&state);

    // Group by author
    let mut author_counts: HashMap<String, usize> = HashMap::new();
    for book in &books {
        if let Some(ref author) = book.author {
            *author_counts.entry(author.clone()).or_insert(0) += 1;
        }
    }

    let mut authors: Vec<_> = author_counts.into_iter().collect();
    authors.sort_by(|a, b| a.0.cmp(&b.0));

    let mut feed = OPDSFeed::navigation("Authors", &format!("{}/opds/authors", base));
    feed.links.push(crate::opds::OPDSLink {
        href: "/opds".to_string(),
        rel: Some(crate::opds::rel::UP.to_string()),
        link_type: Some(mime::ATOM_CATALOG.to_string()),
        title: None,
    });

    for (author, count) in authors {
        let encoded = urlencoding::encode(&author);
        feed.add_navigation_entry(OPDSEntry::navigation(
            &author,
            &format!("{} books", count),
            &format!("{}/opds/author/{}", base, encoded),
        ));
    }

    let xml = serialize_feed(&feed)?;
    Ok(OPDSResponse(xml))
}

/// Books by a specific author
async fn author_books(
    State(state): State<AppState>,
    axum::Extension(cache): axum::Extension<LibraryCache>,
    Path(name): Path<String>,
) -> Result<OPDSResponse> {
    let books = cache.get_books().await;
    let base = base_url(&state);

    let author_books: Vec<_> = books
        .iter()
        .filter(|b| b.author.as_deref() == Some(&name))
        .cloned()
        .collect();

    let mut feed = OPDSFeed::acquisition(&name, &format!("{}/opds/author/{}", base, urlencoding::encode(&name)));
    feed.links.push(crate::opds::OPDSLink {
        href: "/opds/authors".to_string(),
        rel: Some(crate::opds::rel::UP.to_string()),
        link_type: Some(mime::ATOM_CATALOG.to_string()),
        title: None,
    });
    feed.add_books(&author_books, &base);

    let xml = serialize_feed(&feed)?;
    Ok(OPDSResponse(xml))
}

/// Series list
async fn series_list(
    State(state): State<AppState>,
    axum::Extension(cache): axum::Extension<LibraryCache>,
) -> Result<OPDSResponse> {
    let books = cache.get_books().await;
    let base = base_url(&state);

    // Group by series
    let mut series_counts: HashMap<String, usize> = HashMap::new();
    for book in &books {
        if let Some(ref series) = book.series {
            *series_counts.entry(series.clone()).or_insert(0) += 1;
        }
    }

    let mut series_list: Vec<_> = series_counts.into_iter().collect();
    series_list.sort_by(|a, b| a.0.cmp(&b.0));

    let mut feed = OPDSFeed::navigation("Series", &format!("{}/opds/series", base));
    feed.links.push(crate::opds::OPDSLink {
        href: "/opds".to_string(),
        rel: Some(crate::opds::rel::UP.to_string()),
        link_type: Some(mime::ATOM_CATALOG.to_string()),
        title: None,
    });

    for (series, count) in series_list {
        let encoded = urlencoding::encode(&series);
        feed.add_navigation_entry(OPDSEntry::navigation(
            &series,
            &format!("{} books", count),
            &format!("{}/opds/series/{}", base, encoded),
        ));
    }

    let xml = serialize_feed(&feed)?;
    Ok(OPDSResponse(xml))
}

/// Books in a specific series
async fn series_books(
    State(state): State<AppState>,
    axum::Extension(cache): axum::Extension<LibraryCache>,
    Path(name): Path<String>,
) -> Result<OPDSResponse> {
    let books = cache.get_books().await;
    let base = base_url(&state);

    let mut series_books: Vec<_> = books
        .iter()
        .filter(|b| b.series.as_deref() == Some(&name))
        .cloned()
        .collect();

    // Sort by series index
    series_books.sort_by(|a, b| {
        a.series_index
            .unwrap_or(0.0)
            .partial_cmp(&b.series_index.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut feed = OPDSFeed::acquisition(&name, &format!("{}/opds/series/{}", base, urlencoding::encode(&name)));
    feed.links.push(crate::opds::OPDSLink {
        href: "/opds/series".to_string(),
        rel: Some(crate::opds::rel::UP.to_string()),
        link_type: Some(mime::ATOM_CATALOG.to_string()),
        title: None,
    });
    feed.add_books(&series_books, &base);

    let xml = serialize_feed(&feed)?;
    Ok(OPDSResponse(xml))
}

/// Recently added books
async fn recent_books(
    State(state): State<AppState>,
    axum::Extension(cache): axum::Extension<LibraryCache>,
) -> Result<OPDSResponse> {
    let mut books = cache.get_books().await;
    let base = base_url(&state);

    // Sort by added date, most recent first
    books.sort_by(|a, b| b.added_at.cmp(&a.added_at));

    // Take the 50 most recent
    let recent: Vec<_> = books.into_iter().take(50).collect();

    let mut feed = OPDSFeed::acquisition("Recent Books", &format!("{}/opds/recent", base));
    feed.links.push(crate::opds::OPDSLink {
        href: "/opds".to_string(),
        rel: Some(crate::opds::rel::UP.to_string()),
        link_type: Some(mime::ATOM_CATALOG.to_string()),
        title: None,
    });
    feed.add_books(&recent, &base);

    let xml = serialize_feed(&feed)?;
    Ok(OPDSResponse(xml))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
}

/// Search books
async fn search_books(
    State(state): State<AppState>,
    axum::Extension(cache): axum::Extension<LibraryCache>,
    Query(query): Query<SearchQuery>,
) -> Result<OPDSResponse> {
    let books = cache.get_books().await;
    let base = base_url(&state);
    let q = query.q.to_lowercase();

    // Simple search: match title, author, or tags
    let results: Vec<_> = books
        .iter()
        .filter(|b| {
            b.title.to_lowercase().contains(&q)
                || b.author.as_ref().map_or(false, |a| a.to_lowercase().contains(&q))
                || b.tags.iter().any(|t| t.to_lowercase().contains(&q))
                || b.series.as_ref().map_or(false, |s| s.to_lowercase().contains(&q))
        })
        .cloned()
        .collect();

    let mut feed = OPDSFeed::acquisition(
        &format!("Search: {}", query.q),
        &format!("{}/opds/search?q={}", base, urlencoding::encode(&query.q)),
    );
    feed.links.push(crate::opds::OPDSLink {
        href: "/opds".to_string(),
        rel: Some(crate::opds::rel::UP.to_string()),
        link_type: Some(mime::ATOM_CATALOG.to_string()),
        title: None,
    });
    feed.add_books(&results, &base);

    let xml = serialize_feed(&feed)?;
    Ok(OPDSResponse(xml))
}

/// Refresh library cache
async fn refresh_library(
    State(state): State<AppState>,
    axum::Extension(cache): axum::Extension<LibraryCache>,
) -> Result<String> {
    let scanner = LibraryScanner::new(state.s3_client().clone());
    cache.refresh(&scanner).await?;
    let count = cache.get_books().await.len();
    Ok(format!("Library refreshed: {} books", count))
}
