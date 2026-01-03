//! Annotation API endpoints
//!
//! Provides REST API for managing annotations (highlights, notes, bookmarks).

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::annotations::{
    Annotation, AnnotationQuery, AnnotationRepository, AnnotationTarget, AnnotationType,
};
use crate::state::AppState;

/// Create the annotations router
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_annotations).post(create_annotation))
        .route("/{id}", get(get_annotation).put(update_annotation).delete(delete_annotation))
        .route("/book/{book_id}", get(list_book_annotations))
        .route("/book/{book_id}/count", get(count_book_annotations))
}

/// Query parameters for listing annotations
#[derive(Debug, Deserialize)]
pub struct ListParams {
    book_id: Option<String>,
    user_id: Option<String>,
    #[serde(rename = "type")]
    annotation_type: Option<String>,
    chapter: Option<String>,
    limit: Option<i32>,
    offset: Option<i32>,
}

/// Request body for creating/updating annotations
#[derive(Debug, Deserialize)]
pub struct CreateAnnotationRequest {
    #[serde(rename = "bookId")]
    pub book_id: String,
    #[serde(rename = "userId")]
    pub user_id: Option<String>,
    #[serde(rename = "type")]
    pub annotation_type: String,
    pub target: AnnotationTargetRequest,
    pub body: Option<AnnotationBodyRequest>,
    pub style: Option<AnnotationStyleRequest>,
}

#[derive(Debug, Deserialize)]
pub struct AnnotationTargetRequest {
    pub source: String,
    pub cfi: Option<String>,
    #[serde(rename = "textQuote")]
    pub text_quote: Option<TextQuoteRequest>,
    pub progression: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct TextQuoteRequest {
    pub exact: String,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AnnotationBodyRequest {
    pub value: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AnnotationStyleRequest {
    pub color: Option<String>,
    pub opacity: Option<f32>,
}

/// Request body for updating annotations
#[derive(Debug, Deserialize)]
pub struct UpdateAnnotationRequest {
    pub body: Option<AnnotationBodyRequest>,
    pub style: Option<AnnotationStyleRequest>,
}

/// Response types
#[derive(Debug, Serialize)]
pub struct AnnotationResponse {
    pub annotation: Annotation,
}

#[derive(Debug, Serialize)]
pub struct AnnotationsListResponse {
    pub annotations: Vec<Annotation>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
pub struct CountResponse {
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

/// List annotations with optional filters
async fn list_annotations(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<AnnotationsListResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo = AnnotationRepository::new(state.db());

    let query = AnnotationQuery {
        book_id: params.book_id,
        user_id: params.user_id,
        annotation_type: params.annotation_type.as_ref().and_then(parse_type),
        chapter_href: params.chapter,
        limit: params.limit,
        offset: params.offset,
    };

    let annotations = repo.list(&query).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;

    let total = annotations.len();
    Ok(Json(AnnotationsListResponse { annotations, total }))
}

/// List annotations for a specific book
async fn list_book_annotations(
    State(state): State<AppState>,
    Path(book_id): Path<String>,
    Query(params): Query<ListParams>,
) -> Result<Json<AnnotationsListResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo = AnnotationRepository::new(state.db());

    let query = AnnotationQuery {
        book_id: Some(book_id),
        user_id: params.user_id,
        annotation_type: params.annotation_type.as_ref().and_then(parse_type),
        chapter_href: params.chapter,
        limit: params.limit,
        offset: params.offset,
    };

    let annotations = repo.list(&query).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;

    let total = annotations.len();
    Ok(Json(AnnotationsListResponse { annotations, total }))
}

/// Get annotation count for a book
async fn count_book_annotations(
    State(state): State<AppState>,
    Path(book_id): Path<String>,
) -> Result<Json<CountResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo = AnnotationRepository::new(state.db());

    let count = repo.count_for_book(&book_id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;

    Ok(Json(CountResponse { count }))
}

/// Create a new annotation
async fn create_annotation(
    State(state): State<AppState>,
    Json(req): Json<CreateAnnotationRequest>,
) -> Result<(StatusCode, Json<AnnotationResponse>), (StatusCode, Json<ErrorResponse>)> {
    let repo = AnnotationRepository::new(state.db());

    // Build target with selectors
    let mut target = if let Some(cfi) = &req.target.cfi {
        AnnotationTarget::from_cfi(&req.target.source, cfi)
    } else {
        AnnotationTarget::with_selectors(&req.target.source, vec![])
    };

    // Add text quote selector if provided
    if let Some(quote) = &req.target.text_quote {
        target.add_text_quote(&quote.exact, quote.prefix.as_deref(), quote.suffix.as_deref());
    }

    // Add progression selector if provided
    if let Some(progression) = req.target.progression {
        target.add_progression(progression);
    }

    // Create annotation based on type
    let mut annotation = match req.annotation_type.as_str() {
        "highlight" => Annotation::new_highlight(&req.book_id, target),
        "note" => {
            let note_text = req
                .body
                .as_ref()
                .and_then(|b| b.value.as_deref())
                .unwrap_or("");
            Annotation::new_note(&req.book_id, target, note_text)
        }
        "bookmark" => Annotation::new_bookmark(&req.book_id, target),
        _ => Annotation::new_highlight(&req.book_id, target),
    };

    // Set user ID if provided
    if let Some(user_id) = &req.user_id {
        annotation = annotation.with_user(user_id);
    }

    // Set style if provided
    if let Some(style) = &req.style {
        if let Some(color) = &style.color {
            annotation = annotation.with_color(color);
        }
    }

    repo.save(&annotation).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;

    Ok((StatusCode::CREATED, Json(AnnotationResponse { annotation })))
}

/// Get a single annotation
async fn get_annotation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<AnnotationResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo = AnnotationRepository::new(state.db());

    let annotation = repo.get(&id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;

    match annotation {
        Some(annotation) => Ok(Json(AnnotationResponse { annotation })),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("Annotation '{}' not found", id),
            }),
        )),
    }
}

/// Update an annotation
async fn update_annotation(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateAnnotationRequest>,
) -> Result<Json<AnnotationResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo = AnnotationRepository::new(state.db());

    let mut annotation = repo
        .get(&id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: format!("Annotation '{}' not found", id),
                }),
            )
        })?;

    // Update body if provided
    if let Some(body_req) = req.body {
        if let Some(ref mut body) = annotation.body {
            body.value = body_req.value;
        } else if body_req.value.is_some() {
            annotation.body = Some(crate::annotations::AnnotationBody {
                body_type: crate::annotations::BodyType::TextualBody,
                value: body_req.value,
                format: Some("text/plain".to_string()),
            });
        }
    }

    // Update style if provided
    if let Some(style_req) = req.style {
        let current_style = annotation
            .style
            .take()
            .unwrap_or_else(crate::annotations::AnnotationStyle::default);
        annotation.style = Some(crate::annotations::AnnotationStyle {
            color: style_req.color.unwrap_or(current_style.color),
            opacity: style_req.opacity.or(current_style.opacity),
        });
    }

    // Update timestamp
    annotation.updated_at = chrono::Utc::now();

    repo.save(&annotation).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;

    Ok(Json(AnnotationResponse { annotation }))
}

/// Delete an annotation
async fn delete_annotation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let repo = AnnotationRepository::new(state.db());

    let deleted = repo.delete(&id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;

    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("Annotation '{}' not found", id),
            }),
        ))
    }
}

fn parse_type(s: &String) -> Option<AnnotationType> {
    match s.as_str() {
        "highlight" => Some(AnnotationType::Highlight),
        "note" => Some(AnnotationType::Note),
        "bookmark" => Some(AnnotationType::Bookmark),
        "underline" => Some(AnnotationType::Underline),
        _ => None,
    }
}
