//! Health check endpoints

use axum::{routing::get, Json, Router};
use serde::Serialize;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
    pub service: &'static str,
}

pub async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy",
        version: env!("CARGO_PKG_VERSION"),
        service: "los-libros-server",
    })
}

pub fn router() -> Router {
    Router::new().route("/", get(health_check))
}
