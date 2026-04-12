//! Retention Bridge endpoints — NodeBench ↔ Attrition integration.
//!
//! POST /api/retention/register     — Register NodeBench team connection
//! POST /api/retention/sync         — Sync QA findings from NodeBench
//! GET  /api/retention/status       — Get connection status + recent events
//! POST /api/retention/webhook      — Receive webhook events from NodeBench
//! POST /api/retention/push-packet  — Ingest delta packets from NodeBench
//! GET  /api/retention/packets      — List ingested packets

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::Arc;

use crate::state::AppState;

// ── Bounded constants (BOUND) ────────────────────────────────────────────────

const MAX_EVENTS: usize = 500;
const MAX_PACKETS: usize = 1000;
const MAX_FINDINGS_PER_SYNC: usize = 200;

// ── File-backed persistence ─────────────────────────────────────────────────

/// JSONL + JSON file-backed store for retention data.
/// All I/O is best-effort — never panics on missing/corrupt files.
pub struct RetentionStore {
    data_dir: PathBuf,
}

impl RetentionStore {
    pub fn new() -> Self {
        let data_dir = std::env::var("ATTRITION_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                let home = std::env::var("HOME")
                    .or_else(|_| std::env::var("USERPROFILE"))
                    .unwrap_or_else(|_| ".".to_string());
                PathBuf::from(home).join(".attrition")
            });
        std::fs::create_dir_all(&data_dir).ok();
        Self { data_dir }
    }

    // ── Events (JSONL: one JSON object per line) ────────────────────────────

    pub fn save_event(&self, event: &crate::state::RetentionEvent) {
        let path = self.data_dir.join("retention_events.jsonl");
        let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        else {
            return;
        };
        if let Ok(line) = serde_json::to_string(event) {
            let _ = writeln!(file, "{}", line);
        }
    }

    pub fn load_events(&self) -> Vec<crate::state::RetentionEvent> {
        let path = self.data_dir.join("retention_events.jsonl");
        let Ok(file) = std::fs::File::open(&path) else {
            return Vec::new();
        };
        let reader = std::io::BufReader::new(file);
        let all: Vec<crate::state::RetentionEvent> = reader
            .lines()
            .filter_map(|line| line.ok())
            .filter_map(|line| serde_json::from_str(&line).ok())
            .collect();
        // Return only the last MAX_EVENTS entries
        if all.len() > MAX_EVENTS {
            all[all.len() - MAX_EVENTS..].to_vec()
        } else {
            all
        }
    }

    // ── Packets (JSONL: one JSON object per line) ───────────────────────────

    pub fn save_packet(&self, packet: &crate::state::RetentionPacket) {
        let path = self.data_dir.join("retention_packets.jsonl");
        let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        else {
            return;
        };
        if let Ok(line) = serde_json::to_string(packet) {
            let _ = writeln!(file, "{}", line);
        }
    }

    pub fn load_packets(&self) -> Vec<crate::state::RetentionPacket> {
        let path = self.data_dir.join("retention_packets.jsonl");
        let Ok(file) = std::fs::File::open(&path) else {
            return Vec::new();
        };
        let reader = std::io::BufReader::new(file);
        let all: Vec<crate::state::RetentionPacket> = reader
            .lines()
            .filter_map(|line| line.ok())
            .filter_map(|line| serde_json::from_str(&line).ok())
            .collect();
        // Return only the last MAX_PACKETS entries
        if all.len() > MAX_PACKETS {
            all[all.len() - MAX_PACKETS..].to_vec()
        } else {
            all
        }
    }

    // ── Connection (single JSON file, overwritten each save) ────────────────

    pub fn save_connection(&self, conn: &crate::state::RetentionConnection) {
        let path = self.data_dir.join("retention_connection.json");
        let Ok(json) = serde_json::to_string_pretty(conn) else {
            return;
        };
        let _ = std::fs::write(&path, json);
    }

    pub fn load_connection(&self) -> Option<crate::state::RetentionConnection> {
        let path = self.data_dir.join("retention_connection.json");
        let Ok(data) = std::fs::read_to_string(&path) else {
            return None;
        };
        serde_json::from_str(&data).ok()
    }
}

// ── Request types ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    pub team_code: String,
    pub peer_id: Option<String>,
    pub version: Option<String>,
    pub member_count: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    pub qa_findings: Option<Vec<QaFinding>>,
    pub qa_score: Option<u8>,
    pub tokens_saved: Option<u64>,
    pub team_members: Option<u32>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct QaFinding {
    pub page: String,
    pub score: u8,
    pub issues: Vec<String>,
}

#[derive(Deserialize)]
pub struct WebhookRequest {
    pub event: String,
    pub data: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushPacketRequest {
    #[serde(rename = "type")]
    pub packet_type: Option<String>,
    pub subject: Option<String>,
    pub summary: Option<String>,
    pub data: Option<serde_json::Value>,
}

// ── Response types ───────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterResponse {
    pub status: &'static str,
    pub session_id: String,
    pub team_code: String,
    pub peer_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResponse {
    pub synced: bool,
    pub qa_findings_count: usize,
    pub workflows_stored: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusResponse {
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection: Option<ConnectionInfo>,
    pub recent_events: Vec<RetentionEventResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub team_code: String,
    pub peer_id: String,
    pub connected_at: String,
    pub last_sync: Option<String>,
    pub qa_score: Option<u8>,
    pub tokens_saved: Option<u64>,
    pub version: Option<String>,
}

#[derive(Serialize)]
pub struct RetentionEventResponse {
    pub event: String,
    pub data: serde_json::Value,
    pub timestamp: String,
}

#[derive(Serialize)]
pub struct WebhookResponse {
    pub received: bool,
    pub event: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushPacketResponse {
    pub status: &'static str,
    #[serde(rename = "type")]
    pub packet_type: String,
    pub subject: String,
}

#[derive(Serialize)]
pub struct PacketListItem {
    #[serde(rename = "type")]
    pub packet_type: String,
    pub subject: String,
    pub summary: String,
    pub timestamp: String,
}

#[derive(Serialize)]
pub struct PacketListResponse {
    pub packets: Vec<PacketListItem>,
}

#[derive(Serialize)]
struct ApiError {
    error: String,
    status: u16,
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/// POST /retention/register — Register a NodeBench team connection.
async fn register(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RegisterRequest>,
) -> Result<Json<RegisterResponse>, impl IntoResponse> {
    state.increment_requests();

    if req.team_code.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                error: "teamCode is required".to_string(),
                status: 400,
            }),
        ));
    }

    let peer_id = req.peer_id.unwrap_or_else(|| {
        format!("peer:monitor:retention:{}", req.team_code)
    });
    let now = chrono::Utc::now().to_rfc3339();
    let session_id = format!("rs_{:x}", chrono::Utc::now().timestamp());

    // Store connection
    {
        let new_conn = crate::state::RetentionConnection {
            team_code: req.team_code.clone(),
            peer_id: peer_id.clone(),
            connected_at: now.clone(),
            last_sync: None,
            qa_score: None,
            tokens_saved: None,
            member_count: req.member_count,
            version: req.version,
        };
        state.retention_store.save_connection(&new_conn);
        let mut conn = state.retention_connection.lock().await;
        *conn = Some(new_conn);
    }

    // Log event (BOUND: evict oldest if at capacity)
    {
        let event = crate::state::RetentionEvent {
            event: "registered".to_string(),
            data: serde_json::json!({
                "teamCode": req.team_code,
                "peerId": peer_id,
            }),
            timestamp: now,
        };
        state.retention_store.save_event(&event);
        let mut events = state.retention_events.lock().await;
        events.push(event);
        if events.len() > MAX_EVENTS {
            let drain_count = events.len() - MAX_EVENTS;
            events.drain(..drain_count);
        }
    }

    Ok(Json(RegisterResponse {
        status: "connected",
        session_id,
        team_code: req.team_code,
        peer_id,
    }))
}

/// POST /retention/sync — Accept QA findings from NodeBench pipeline runs.
async fn sync(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SyncRequest>,
) -> Json<SyncResponse> {
    state.increment_requests();

    let now = chrono::Utc::now().to_rfc3339();

    // Cap findings to prevent unbounded ingestion (BOUND)
    let findings = req.qa_findings.unwrap_or_default();
    let capped_findings: Vec<QaFinding> = findings.into_iter().take(MAX_FINDINGS_PER_SYNC).collect();
    let findings_count = capped_findings.len();

    // Convert findings to workflow events and store
    let mut workflows_stored: usize = 0;
    {
        let store = state.workflow_store.lock().await;
        for finding in &capped_findings {
            // Create a CanonicalEvent::ToolCall per QA finding
            let events = vec![attrition_workflow::CanonicalEvent::ToolCall {
                tool: "qa_finding".to_string(),
                args: serde_json::json!({
                    "page": finding.page,
                    "score": finding.score,
                }),
                result: serde_json::json!({
                    "issues": finding.issues,
                }),
                duration_ms: 0,
            }];

            let metadata = attrition_workflow::WorkflowMetadata {
                adapter: "nodebench-retention".to_string(),
                session_id: None,
                project_path: None,
                total_tokens: attrition_workflow::TokenCost::default(),
                duration_ms: 0,
                task_description: format!("QA finding: {} (score {})", finding.page, finding.score),
            };

            let workflow = attrition_workflow::Workflow::new(
                format!("qa-finding-{}", finding.page),
                "nodebench".to_string(),
                events,
                metadata,
            );

            if store.save_workflow(&workflow).is_ok() {
                workflows_stored += 1;
            }
        }
    }

    // Update connection stats
    {
        let mut conn = state.retention_connection.lock().await;
        if let Some(ref mut c) = *conn {
            c.last_sync = Some(now.clone());
            if let Some(score) = req.qa_score {
                c.qa_score = Some(score);
            }
            if let Some(tokens) = req.tokens_saved {
                c.tokens_saved = Some(tokens);
            }
            if let Some(members) = req.team_members {
                c.member_count = Some(members);
            }
            state.retention_store.save_connection(c);
        }
    }

    // Log event (BOUND)
    {
        let event = crate::state::RetentionEvent {
            event: "sync".to_string(),
            data: serde_json::json!({
                "findingCount": findings_count,
                "qaScore": req.qa_score,
                "tokensSaved": req.tokens_saved,
                "workflowsStored": workflows_stored,
            }),
            timestamp: now,
        };
        state.retention_store.save_event(&event);
        let mut events = state.retention_events.lock().await;
        events.push(event);
        if events.len() > MAX_EVENTS {
            let drain_count = events.len() - MAX_EVENTS;
            events.drain(..drain_count);
        }
    }

    Json(SyncResponse {
        synced: true,
        qa_findings_count: findings_count,
        workflows_stored,
    })
}

/// GET /retention/status — Return current connection state + recent events.
async fn status(
    State(state): State<Arc<AppState>>,
) -> Json<StatusResponse> {
    state.increment_requests();

    let conn = state.retention_connection.lock().await;
    let events = state.retention_events.lock().await;

    let connection = conn.as_ref().map(|c| ConnectionInfo {
        team_code: c.team_code.clone(),
        peer_id: c.peer_id.clone(),
        connected_at: c.connected_at.clone(),
        last_sync: c.last_sync.clone(),
        qa_score: c.qa_score,
        tokens_saved: c.tokens_saved,
        version: c.version.clone(),
    });

    let recent: Vec<RetentionEventResponse> = events
        .iter()
        .rev()
        .take(10)
        .map(|e| RetentionEventResponse {
            event: e.event.clone(),
            data: e.data.clone(),
            timestamp: e.timestamp.clone(),
        })
        .collect();

    Json(StatusResponse {
        connected: conn.is_some(),
        connection,
        recent_events: recent,
    })
}

/// POST /retention/webhook — Accept webhook events from NodeBench.
async fn webhook(
    State(state): State<Arc<AppState>>,
    Json(req): Json<WebhookRequest>,
) -> Result<Json<WebhookResponse>, impl IntoResponse> {
    state.increment_requests();

    if req.event.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                error: "event type is required".to_string(),
                status: 400,
            }),
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let data = req.data.unwrap_or(serde_json::Value::Null);

    // Handle specific event types
    match req.event.as_str() {
        "crawl_complete" => {
            if let Some(score) = data.get("qaScore").and_then(|v| v.as_u64()) {
                let mut conn = state.retention_connection.lock().await;
                if let Some(ref mut c) = *conn {
                    c.qa_score = Some(score.min(255) as u8);
                    state.retention_store.save_connection(c);
                }
            }
        }
        "pipeline_complete" => {
            // Capture as workflow checkpoint in the store
            let events = vec![attrition_workflow::CanonicalEvent::Checkpoint {
                label: "pipeline_complete".to_string(),
                state_hash: format!("{:x}", chrono::Utc::now().timestamp()),
            }];
            let metadata = attrition_workflow::WorkflowMetadata {
                adapter: "nodebench-webhook".to_string(),
                session_id: None,
                project_path: None,
                total_tokens: attrition_workflow::TokenCost::default(),
                duration_ms: 0,
                task_description: "Pipeline completion event".to_string(),
            };
            let workflow = attrition_workflow::Workflow::new(
                "pipeline-complete".to_string(),
                "nodebench".to_string(),
                events,
                metadata,
            );
            let store = state.workflow_store.lock().await;
            let _ = store.save_workflow(&workflow);
        }
        // "search_complete", "packet_published" — log only
        _ => {}
    }

    // Log event (BOUND)
    {
        let event = crate::state::RetentionEvent {
            event: req.event.clone(),
            data: data.clone(),
            timestamp: now,
        };
        state.retention_store.save_event(&event);
        let mut events = state.retention_events.lock().await;
        events.push(event);
        if events.len() > MAX_EVENTS {
            let drain_count = events.len() - MAX_EVENTS;
            events.drain(..drain_count);
        }
    }

    Ok(Json(WebhookResponse {
        received: true,
        event: req.event,
    }))
}

/// POST /retention/push-packet — Ingest delta packets from NodeBench.
async fn push_packet(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PushPacketRequest>,
) -> Result<Json<PushPacketResponse>, impl IntoResponse> {
    state.increment_requests();

    let packet_type = req.packet_type.unwrap_or_default();
    let subject = req.subject.unwrap_or_default();

    if packet_type.is_empty() || subject.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                error: "type and subject are required".to_string(),
                status: 400,
            }),
        ));
    }

    let summary = req.summary.unwrap_or_default();
    let data = req.data.unwrap_or(serde_json::Value::Null);
    let now = chrono::Utc::now().to_rfc3339();

    // Store packet (BOUND: evict oldest if at capacity)
    {
        let packet = crate::state::RetentionPacket {
            packet_type: packet_type.clone(),
            subject: subject.clone(),
            summary: summary.clone(),
            data: data.clone(),
            timestamp: now.clone(),
        };
        state.retention_store.save_packet(&packet);
        let mut packets = state.retention_packets.lock().await;
        packets.push(packet);
        if packets.len() > MAX_PACKETS {
            let drain_count = packets.len() - MAX_PACKETS;
            packets.drain(..drain_count);
        }
    }

    // Log event (BOUND)
    {
        let event = crate::state::RetentionEvent {
            event: "packet_ingested".to_string(),
            data: serde_json::json!({
                "type": packet_type,
                "subject": subject,
            }),
            timestamp: now,
        };
        state.retention_store.save_event(&event);
        let mut events = state.retention_events.lock().await;
        events.push(event);
        if events.len() > MAX_EVENTS {
            let drain_count = events.len() - MAX_EVENTS;
            events.drain(..drain_count);
        }
    }

    // Update connection last_sync
    {
        let mut conn = state.retention_connection.lock().await;
        if let Some(ref mut c) = *conn {
            c.last_sync = Some(chrono::Utc::now().to_rfc3339());
            state.retention_store.save_connection(c);
        }
    }

    Ok(Json(PushPacketResponse {
        status: "ingested",
        packet_type,
        subject,
    }))
}

/// GET /retention/packets — Return all ingested packets.
async fn list_packets(
    State(state): State<Arc<AppState>>,
) -> Json<PacketListResponse> {
    state.increment_requests();

    let packets = state.retention_packets.lock().await;
    let items: Vec<PacketListItem> = packets
        .iter()
        .map(|p| PacketListItem {
            packet_type: p.packet_type.clone(),
            subject: p.subject.clone(),
            summary: p.summary.clone(),
            timestamp: p.timestamp.clone(),
        })
        .collect();

    Json(PacketListResponse { packets: items })
}

// ── Route registration ───────────────────────────────────────────────────────

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/register", post(register))
        .route("/sync", post(sync))
        .route("/status", get(status))
        .route("/webhook", post(webhook))
        .route("/push-packet", post(push_packet))
        .route("/packets", get(list_packets))
}
