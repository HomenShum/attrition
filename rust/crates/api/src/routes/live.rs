//! Live status endpoints for the attrition dashboard.
//!
//! GET /api/live/status    — full status JSON (hooks, workflow, activity, verdict)
//! GET /api/live/activity  — recent activity feed with optional ?limit=N
//! GET /api/live/workflow   — active workflow with step evidence

use axum::{extract::Query, extract::State, routing::get, Json, Router};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;

use crate::state::AppState;

// ── Request params ────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ActivityParams {
    pub limit: Option<usize>,
}

// ── Response types ────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct LiveStatusResponse {
    pub hooks_installed: usize,
    pub hooks: Vec<HookInfo>,
    pub active_workflow: Option<WorkflowStatus>,
    pub recent_activity: Vec<ActivityEvent>,
    pub blocked_searches: usize,
    pub total_events: usize,
    pub session_duration_sec: u64,
    pub verdict_if_stopped_now: String,
}

#[derive(Serialize)]
pub struct HookInfo {
    pub name: String,
    pub detail: String,
}

#[derive(Serialize, Clone)]
pub struct WorkflowStatus {
    pub name: String,
    pub steps: Vec<WorkflowStepStatus>,
    pub completion_pct: u32,
}

#[derive(Serialize, Clone)]
pub struct WorkflowStepStatus {
    pub name: String,
    pub has_evidence: bool,
    pub evidence_tools: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct ActivityEvent {
    pub ts: String,
    pub tool: String,
    pub keys: Vec<String>,
    pub scrubbed: String,
    pub was_blocked: bool,
}

// ── Helpers ───────────────────────────────────────────────────────────────

/// Resolve ~/.attrition/ directory.
fn attrition_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".attrition")
}

/// Resolve ~/.claude/settings.json path.
fn claude_settings_path() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".claude").join("settings.json")
}

/// Read installed hooks from Claude Code settings.json.
fn read_hooks() -> Vec<HookInfo> {
    let path = claude_settings_path();
    if !path.exists() {
        return Vec::new();
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let settings: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let mut hooks = Vec::new();
    if let Some(hooks_obj) = settings.get("hooks").and_then(|h| h.as_object()) {
        for (name, _value) in hooks_obj {
            let detail = match name.as_str() {
                "PreToolUse" => "Grep|Glob|WebSearch".to_string(),
                "Stop" => "hard-block enabled".to_string(),
                _ => String::new(),
            };
            hooks.push(HookInfo {
                name: name.clone(),
                detail,
            });
        }
    }

    hooks
}

/// Read active workflow from ~/.attrition/active_workflow.json.
fn read_workflow() -> Option<WorkflowStatus> {
    let path = attrition_dir().join("active_workflow.json");
    if !path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;

    let name = value.get("name")?.as_str()?.to_string();
    let steps_arr = value.get("steps")?.as_array()?;

    let steps: Vec<WorkflowStepStatus> = steps_arr
        .iter()
        .filter_map(|s| {
            let step_name = s.get("name")?.as_str()?.to_string();
            let has_evidence = s
                .get("has_evidence")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let evidence_tools = s
                .get("evidence_tools")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|t| t.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            Some(WorkflowStepStatus {
                name: step_name,
                has_evidence,
                evidence_tools,
            })
        })
        .collect();

    let completed = steps.iter().filter(|s| s.has_evidence).count();
    let total = steps.len();
    let completion_pct = if total > 0 {
        (completed as f64 / total as f64 * 100.0) as u32
    } else {
        0
    };

    Some(WorkflowStatus {
        name,
        steps,
        completion_pct,
    })
}

/// Read recent activity entries from ~/.attrition/activity.jsonl.
fn read_activity(limit: usize) -> (Vec<ActivityEvent>, usize) {
    let path = attrition_dir().join("activity.jsonl");
    if !path.exists() {
        return (Vec::new(), 0);
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return (Vec::new(), 0),
    };

    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    let total = lines.len();

    let start = if lines.len() > limit {
        lines.len() - limit
    } else {
        0
    };
    let recent_lines = &lines[start..];

    let entries: Vec<ActivityEvent> = recent_lines
        .iter()
        .filter_map(|line| {
            let v: serde_json::Value = serde_json::from_str(line).ok()?;
            let ts = v
                .get("ts")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();
            let tool = v
                .get("tool")
                .and_then(|t| t.as_str())
                .unwrap_or("unknown")
                .to_string();
            let was_blocked = v
                .get("blocked")
                .and_then(|b| b.as_bool())
                .unwrap_or(false);
            let keys: Vec<String> = v
                .get("input_keys")
                .and_then(|k| k.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|k| k.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let scrubbed = keys.join(", ");

            Some(ActivityEvent {
                ts,
                tool,
                keys,
                scrubbed,
                was_blocked,
            })
        })
        .collect();

    (entries, total)
}

/// Count blocked searches in ~/.attrition/search_log.jsonl.
fn count_blocked() -> usize {
    let path = attrition_dir().join("search_log.jsonl");
    if !path.exists() {
        return 0;
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return 0,
    };

    content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter(|l| l.contains("\"blocked\":true") || l.contains("\"blocked\": true"))
        .count()
}

/// Compute what the verdict would be if the agent stopped right now.
fn compute_verdict(workflow: &Option<WorkflowStatus>, activity: &[ActivityEvent]) -> String {
    if let Some(wf) = workflow {
        if wf.completion_pct >= 80 {
            "ALLOW".to_string()
        } else if wf.completion_pct >= 50 {
            "ESCALATE".to_string()
        } else {
            "BLOCK".to_string()
        }
    } else if activity.is_empty() {
        "ALLOW".to_string()
    } else {
        let has_build = activity
            .iter()
            .any(|e| e.tool.contains("Bash") && (e.scrubbed.contains("build") || e.scrubbed.contains("tsc")));
        let has_test = activity
            .iter()
            .any(|e| e.tool.contains("Bash") && (e.scrubbed.contains("test") || e.scrubbed.contains("vitest")));
        if has_build && has_test {
            "ALLOW".to_string()
        } else if has_build || has_test {
            "ESCALATE".to_string()
        } else if activity.len() < 5 {
            "ALLOW".to_string()
        } else {
            "ESCALATE".to_string()
        }
    }
}

/// Compute session duration from first and last activity timestamps.
fn session_duration(activity: &[ActivityEvent]) -> u64 {
    if activity.len() < 2 {
        return 0;
    }

    let parse_ts = |ts: &str| -> Option<u64> {
        // ISO 8601: ...THH:MM:SS...
        if ts.len() >= 19 {
            let time_part = &ts[11..19];
            let parts: Vec<&str> = time_part.split(':').collect();
            if parts.len() == 3 {
                let h: u64 = parts[0].parse().ok()?;
                let m: u64 = parts[1].parse().ok()?;
                let s: u64 = parts[2].parse().ok()?;
                return Some(h * 3600 + m * 60 + s);
            }
        }
        None
    };

    let first = parse_ts(&activity[0].ts);
    let last = parse_ts(&activity[activity.len() - 1].ts);

    match (first, last) {
        (Some(f), Some(l)) if l >= f => l - f,
        _ => 0,
    }
}

// ── Route handlers ────────────────────────────────────────────────────────

/// GET /api/live/status — full status JSON
async fn get_live_status(State(state): State<Arc<AppState>>) -> Json<LiveStatusResponse> {
    state.increment_requests();

    let hooks = read_hooks();
    let hooks_installed = hooks.len();
    let workflow = read_workflow();
    let (activity, total_events) = read_activity(10);
    let blocked_searches = count_blocked();
    let duration = session_duration(&activity);
    let verdict = compute_verdict(&workflow, &activity);

    Json(LiveStatusResponse {
        hooks_installed,
        hooks,
        active_workflow: workflow,
        recent_activity: activity,
        blocked_searches,
        total_events,
        session_duration_sec: duration,
        verdict_if_stopped_now: verdict,
    })
}

/// GET /api/live/activity?limit=50 — recent activity feed
async fn get_live_activity(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ActivityParams>,
) -> Json<Vec<ActivityEvent>> {
    state.increment_requests();

    let limit = params.limit.unwrap_or(50);
    let (entries, _total) = read_activity(limit);
    Json(entries)
}

/// GET /api/live/workflow — active workflow with step evidence
async fn get_live_workflow(
    State(state): State<Arc<AppState>>,
) -> Json<Option<WorkflowStatus>> {
    state.increment_requests();
    Json(read_workflow())
}

// ── Router ────────────────────────────────────────────────────────────────

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/status", get(get_live_status))
        .route("/activity", get(get_live_activity))
        .route("/workflow", get(get_live_workflow))
}
