//! Simple API key authentication middleware.
//!
//! Behavior:
//! - If `BP_ADMIN_KEY` env var is NOT set, auth is disabled (open access).
//! - If set, all `/api/*` routes require `Authorization: Bearer <key>` header.
//! - Admin key gets full access. Regular keys (from `BP_API_KEYS`) get standard access.
//! - `/health`, `/mcp`, and static files skip auth entirely.

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::sync::Arc;

use crate::state::AppState;

/// Axum middleware that enforces API key auth on /api/* routes.
///
/// Extracts the bearer token from the `Authorization` header and validates it
/// against the admin key and API key list stored in AppState.
pub async fn require_auth(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    // If auth is not enabled, pass through everything
    if !state.auth_enabled() {
        return next.run(request).await;
    }

    let path = request.uri().path().to_owned();

    // Skip auth for non-API routes (health, MCP, static files)
    if !path.starts_with("/api") {
        return next.run(request).await;
    }

    // Extract bearer token from Authorization header.
    // Clone into an owned String so we don't hold a borrow on `request`.
    let token: Option<String> = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|header| {
            if header.starts_with("Bearer ") {
                Some(header[7..].to_owned())
            } else {
                None
            }
        });

    let token = match token {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({
                    "error": "Missing or invalid Authorization header",
                    "hint": "Use: Authorization: Bearer <your-api-key>"
                })),
            )
                .into_response();
        }
    };

    // Validate the key
    if !state.validate_key(&token) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Invalid API key"
            })),
        )
            .into_response();
    }

    next.run(request).await
}
