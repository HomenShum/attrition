//! Workflow REST endpoints — CRUD for captured workflows.
//!
//! GET  /api/workflows          — list all captured workflows
//! GET  /api/workflows/:id      — get full workflow detail
//! POST /api/workflows/capture  — capture from JSONL path
//! DELETE /api/workflows/:id    — delete a workflow

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::state::AppState;

// ── Response types ────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct WorkflowSummaryResponse {
    pub id: String,
    pub name: String,
    pub source_model: String,
    pub event_count: usize,
    pub captured_at: String,
    pub fingerprint: String,
}

#[derive(Serialize)]
pub struct WorkflowDetailResponse {
    pub id: String,
    pub name: String,
    pub source_model: String,
    pub captured_at: String,
    pub events: serde_json::Value,
    pub metadata: serde_json::Value,
    pub fingerprint: String,
}

#[derive(Deserialize)]
pub struct CaptureRequest {
    pub session_path: String,
    pub name: Option<String>,
    pub model: Option<String>,
}

#[derive(Serialize)]
pub struct CaptureResponse {
    pub id: String,
    pub name: String,
    pub event_count: usize,
}

#[derive(Serialize)]
struct ApiError {
    error: String,
    status: u16,
}

// ── Handlers ──────────────────────────────────────────────────────────────

/// GET /api/workflows — list all captured workflows
async fn list_workflows(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<WorkflowSummaryResponse>>, impl IntoResponse> {
    state.increment_requests();

    let store = state.workflow_store.lock().await;
    match store.list_workflows() {
        Ok(summaries) => {
            let resp: Vec<WorkflowSummaryResponse> = summaries
                .into_iter()
                .map(|s| WorkflowSummaryResponse {
                    id: s.id.to_string(),
                    name: s.name,
                    source_model: s.source_model,
                    event_count: s.event_count,
                    captured_at: s.captured_at.to_rfc3339(),
                    fingerprint: s.fingerprint,
                })
                .collect();
            Ok(Json(resp))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError {
                error: e.to_string(),
                status: 500,
            }),
        )),
    }
}

/// GET /api/workflows/:id — get full workflow detail
async fn get_workflow(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<WorkflowDetailResponse>, impl IntoResponse> {
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

    let store = state.workflow_store.lock().await;
    match store.get_workflow(uuid) {
        Ok(Some(wf)) => {
            let events = serde_json::to_value(&wf.events).unwrap_or_default();
            let metadata = serde_json::to_value(&wf.metadata).unwrap_or_default();
            Ok(Json(WorkflowDetailResponse {
                id: wf.id.to_string(),
                name: wf.name,
                source_model: wf.source_model,
                captured_at: wf.captured_at.to_rfc3339(),
                events,
                metadata,
                fingerprint: wf.fingerprint,
            }))
        }
        Ok(None) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiError {
                error: format!("Workflow {id} not found"),
                status: 404,
            }),
        )),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError {
                error: e.to_string(),
                status: 500,
            }),
        )),
    }
}

/// POST /api/workflows/capture — capture from JSONL path
async fn capture_workflow(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CaptureRequest>,
) -> Result<Json<CaptureResponse>, impl IntoResponse> {
    state.increment_requests();

    // Read the JSONL file
    let data = match std::fs::read(&req.session_path) {
        Ok(d) => d,
        Err(e) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiError {
                    error: format!("Cannot read file {}: {e}", req.session_path),
                    status: 400,
                }),
            ))
        }
    };

    // Parse using the Claude Code adapter
    use attrition_workflow::adapters::WorkflowAdapter;
    let events = match attrition_workflow::adapters::claude_code::ClaudeCodeAdapter::parse(&data) {
        Ok(e) => e,
        Err(e) => {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(ApiError {
                    error: format!("Failed to parse session: {e}"),
                    status: 422,
                }),
            ))
        }
    };

    let name = req.name.unwrap_or_else(|| {
        std::path::Path::new(&req.session_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unnamed")
            .to_string()
    });
    let model = req.model.unwrap_or_else(|| "unknown".to_string());
    let event_count = events.len();

    let metadata = attrition_workflow::WorkflowMetadata {
        adapter: "claude-code".to_string(),
        session_id: None,
        project_path: None,
        total_tokens: attrition_workflow::TokenCost::default(),
        duration_ms: 0,
        task_description: name.clone(),
    };

    let workflow = attrition_workflow::Workflow::new(name.clone(), model, events, metadata);
    let wf_id = workflow.id.to_string();

    let store = state.workflow_store.lock().await;
    match store.save_workflow(&workflow) {
        Ok(()) => Ok(Json(CaptureResponse {
            id: wf_id,
            name,
            event_count,
        })),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError {
                error: e.to_string(),
                status: 500,
            }),
        )),
    }
}

/// DELETE /api/workflows/:id — delete a workflow
async fn delete_workflow(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<StatusCode, impl IntoResponse> {
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

    let store = state.workflow_store.lock().await;
    match store.delete_workflow(uuid) {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiError {
                error: e.to_string(),
                status: 404,
            }),
        )),
    }
}

// ── Route registration ────────────────────────────────────────────────────

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_workflows))
        .route("/capture", post(capture_workflow))
        .route("/{id}", get(get_workflow).delete(delete_workflow))
}
