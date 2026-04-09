//! Judge session REST endpoints — read-only access to judge session data.
//!
//! These are separate from the judge HOOKS at /api/judge/on-* which are
//! POST endpoints for real-time hook integration. These endpoints expose
//! the JudgeEngine's session state for the dashboard UI.
//!
//! GET /api/judge/sessions      — list all judge sessions
//! GET /api/judge/sessions/:id  — get full session detail

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::state::AppState;

// ── Response types ────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct JudgeSessionSummaryResponse {
    pub id: String,
    pub workflow_id: String,
    pub replay_model: String,
    pub events_expected: usize,
    pub events_actual: usize,
    pub verdict: Option<serde_json::Value>,
    pub nudges_count: usize,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Serialize)]
pub struct JudgeSessionDetailResponse {
    pub id: String,
    pub workflow_id: String,
    pub replay_model: String,
    pub events_expected: serde_json::Value,
    pub events_actual: serde_json::Value,
    pub checkpoints: serde_json::Value,
    pub verdict: Option<serde_json::Value>,
    pub nudges: serde_json::Value,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Serialize)]
struct ApiError {
    error: String,
    status: u16,
}

// ── Handlers ──────────────────────────────────────────────────────────────

/// GET /api/judge/sessions — list all judge sessions
async fn list_sessions(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<JudgeSessionSummaryResponse>> {
    state.increment_requests();

    let engine = state.judge_engine.lock().await;
    let sessions = engine.sessions();

    let resp: Vec<JudgeSessionSummaryResponse> = sessions
        .iter()
        .map(|s| JudgeSessionSummaryResponse {
            id: s.id.to_string(),
            workflow_id: s.workflow_id.to_string(),
            replay_model: s.replay_model.clone(),
            events_expected: s.events_expected.len(),
            events_actual: s.events_actual.len(),
            verdict: s.verdict.as_ref().and_then(|v| serde_json::to_value(v).ok()),
            nudges_count: s.nudges.len(),
            started_at: s.started_at.to_rfc3339(),
            completed_at: s.completed_at.map(|t| t.to_rfc3339()),
        })
        .collect();

    Json(resp)
}

/// GET /api/judge/sessions/:id — get full session detail
async fn get_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<JudgeSessionDetailResponse>, impl IntoResponse> {
    state.increment_requests();

    let uuid = match Uuid::parse_str(&id) {
        Ok(u) => u,
        Err(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiError {
                    error: format!("Invalid UUID: {id}"),
                    status: 400,
                }),
            ))
        }
    };

    let engine = state.judge_engine.lock().await;
    match engine.get_session(uuid) {
        Some(s) => Ok(Json(JudgeSessionDetailResponse {
            id: s.id.to_string(),
            workflow_id: s.workflow_id.to_string(),
            replay_model: s.replay_model.clone(),
            events_expected: serde_json::to_value(&s.events_expected).unwrap_or_default(),
            events_actual: serde_json::to_value(&s.events_actual).unwrap_or_default(),
            checkpoints: serde_json::to_value(&s.checkpoints).unwrap_or_default(),
            verdict: s.verdict.as_ref().and_then(|v| serde_json::to_value(v).ok()),
            nudges: serde_json::to_value(&s.nudges).unwrap_or_default(),
            started_at: s.started_at.to_rfc3339(),
            completed_at: s.completed_at.map(|t| t.to_rfc3339()),
        })),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ApiError {
                error: format!("Judge session {id} not found"),
                status: 404,
            }),
        )),
    }
}

// ── Route registration ────────────────────────────────────────────────────

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_sessions))
        .route("/{id}", get(get_session))
}
