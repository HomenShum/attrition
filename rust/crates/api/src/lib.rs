//! attrition-api: Axum HTTP API server
//!
//! Provides the REST API for QA operations, agent orchestration,
//! and frontend communication.
//!
//! In production (Cloud Run), the same binary serves the React frontend
//! as static files — no separate web server needed.

pub mod routes;
pub mod state;

use axum::Router;
use attrition_core::AppConfig;
use state::AppState;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;

/// Build the complete Axum router with all routes mounted.
///
/// When `ATTRITION_STATIC_DIR` is set (or `/app/static` exists), the router
/// falls back to serving the React frontend for any path that doesn't match
/// an API route. This lets a single `bp serve` process handle both the API
/// and the SPA in production.
pub fn build_router(config: &AppConfig) -> Router {
    let state = Arc::new(AppState::new(config.clone()));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let router = Router::new()
        .nest("/api", routes::api_routes())
        .nest("/health", routes::health_routes())
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    // Serve frontend static files if a static directory is available.
    // Priority: $ATTRITION_STATIC_DIR > /app/static (Docker) > ./frontend/dist (dev)
    let static_dir = resolve_static_dir();
    if let Some(dir) = static_dir {
        tracing::info!("Serving static files from {}", dir.display());
        router.fallback_service(
            ServeDir::new(&dir).append_index_html_on_directories(true),
        )
    } else {
        tracing::info!("No static directory found — API-only mode");
        router
    }
}

/// Resolve the directory containing the built React frontend.
fn resolve_static_dir() -> Option<PathBuf> {
    // 1. Explicit env var (set in Dockerfile)
    if let Ok(dir) = std::env::var("ATTRITION_STATIC_DIR") {
        let p = PathBuf::from(&dir);
        if p.join("index.html").exists() {
            return Some(p);
        }
    }
    // 2. Docker default
    let docker_default = PathBuf::from("/app/static");
    if docker_default.join("index.html").exists() {
        return Some(docker_default);
    }
    // 3. Local dev (running from repo root)
    let dev_default = PathBuf::from("frontend/dist");
    if dev_default.join("index.html").exists() {
        return Some(dev_default);
    }
    None
}
