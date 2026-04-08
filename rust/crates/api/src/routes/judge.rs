//! Judge Hook HTTP endpoints — 4-hook lifecycle for Claude Code integration.
//!
//! POST /api/judge/on-prompt        — detect workflow from prompt text
//! POST /api/judge/on-tool-use      — track tool usage, nudge if needed
//! POST /api/judge/on-stop          — run completion judge, produce verdict
//! POST /api/judge/on-session-start — check for prior incomplete sessions

use axum::{extract::State, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::state::AppState;

// ── Workflow detection ─────────────────────────────────────────────────────

/// Built-in workflow patterns for keyword-based detection.
struct WorkflowPattern {
    name: &'static str,
    keywords: &'static [&'static str],
    steps: &'static [&'static str],
    inject_context: &'static str,
}

const WORKFLOW_PATTERNS: &[WorkflowPattern] = &[
    WorkflowPattern {
        name: "dev-flywheel",
        keywords: &["flywheel", "full pass", "ship properly", "ship it properly", "pre-release"],
        steps: &[
            "tsc --noEmit (type check)",
            "vitest run (tests)",
            "vite build (bundle)",
            "visual surface sweep",
            "a11y spot-check",
            "content freshness",
            "bundle sanity",
        ],
        inject_context: "This looks like a dev-flywheel workflow. Expected steps: type-check, test, build, visual sweep, a11y check, content review, bundle check. I'll track progress.",
    },
    WorkflowPattern {
        name: "qa-audit",
        keywords: &["qa", "audit", "test all surfaces", "dogfood", "full qa"],
        steps: &[
            "build gate (tsc + vite)",
            "test gate (vitest)",
            "visual surface sweep (5 surfaces)",
            "agent panel check",
            "regression check",
        ],
        inject_context: "This looks like a QA audit workflow. Expected steps: build gate, test gate, visual sweep, agent panel, regression check. I'll track completion.",
    },
    WorkflowPattern {
        name: "research",
        keywords: &["research", "search latest", "investigate", "deep dive", "look into"],
        steps: &[
            "define research scope",
            "gather sources",
            "synthesize findings",
            "produce deliverable",
        ],
        inject_context: "This looks like a research workflow. Expected steps: scope, gather, synthesize, deliver. I'll track progress.",
    },
];

/// Detect a workflow from prompt text using keyword matching.
fn detect_workflow(prompt: &str) -> Option<&'static WorkflowPattern> {
    let lower = prompt.to_lowercase();
    WORKFLOW_PATTERNS.iter().find(|p| {
        p.keywords.iter().any(|kw| lower.contains(kw))
    })
}

// ── In-memory session evidence ─────────────────────────────────────────────

/// Lightweight session evidence tracker (held in AppState via the JudgeEngine).
/// This is separate from the full JudgeEngine workflow sessions — it tracks
/// tool-call-level evidence for the hook lifecycle.
#[derive(Debug, Clone, Default, Serialize)]
pub struct HookSession {
    pub session_id: String,
    pub workflow_name: Option<String>,
    pub expected_steps: Vec<String>,
    pub tool_calls: Vec<String>,
    pub completed_steps: Vec<String>,
    pub nudges_sent: usize,
}

// ── Request / Response types ───────────────────────────────────────────────

#[derive(Deserialize)]
pub struct OnPromptRequest {
    pub prompt: String,
    pub session_id: Option<String>,
}

#[derive(Serialize)]
pub struct OnPromptResponse {
    pub detected: bool,
    pub workflow_name: Option<String>,
    pub inject_context: Option<String>,
}

#[derive(Deserialize)]
pub struct OnToolUseRequest {
    pub tool_name: String,
    pub input: serde_json::Value,
    pub session_id: String,
}

#[derive(Serialize)]
pub struct OnToolUseResponse {
    pub nudge: Option<String>,
    pub progress: ProgressInfo,
}

#[derive(Serialize)]
pub struct ProgressInfo {
    pub total_steps: usize,
    pub completed: usize,
}

#[derive(Deserialize)]
pub struct OnStopRequest {
    pub session_id: String,
}

#[derive(Serialize)]
pub struct OnStopResponse {
    pub allow_stop: bool,
    pub verdict: String,
    pub missing_steps: Vec<String>,
    pub message: String,
}

#[derive(Deserialize)]
pub struct OnSessionStartRequest {
    pub session_id: String,
}

#[derive(Serialize)]
pub struct OnSessionStartResponse {
    pub has_prior: bool,
    pub prior_verdict: Option<String>,
    pub inject_context: Option<String>,
}

// ── Step detection from tool calls ─────────────────────────────────────────

/// Check if a tool call corresponds to a known workflow step.
fn tool_matches_step(tool_name: &str, input: &serde_json::Value, step: &str) -> bool {
    let step_lower = step.to_lowercase();
    let tool_lower = tool_name.to_lowercase();
    let input_str = input.to_string().to_lowercase();

    // Match by tool name patterns
    if step_lower.contains("tsc") || step_lower.contains("type check") {
        return tool_lower.contains("bash") && input_str.contains("tsc");
    }
    if step_lower.contains("vitest") || step_lower.contains("test") {
        return tool_lower.contains("bash") && (input_str.contains("vitest") || input_str.contains("test"));
    }
    if step_lower.contains("vite build") || step_lower.contains("bundle") {
        return tool_lower.contains("bash") && input_str.contains("build");
    }
    if step_lower.contains("visual") || step_lower.contains("surface sweep") {
        return tool_lower.contains("screenshot") || tool_lower.contains("preview");
    }
    if step_lower.contains("a11y") || step_lower.contains("accessibility") {
        return input_str.contains("a11y") || input_str.contains("accessibility") || input_str.contains("aria");
    }
    if step_lower.contains("regression") {
        return input_str.contains("regression") || input_str.contains("grep");
    }
    if step_lower.contains("agent panel") {
        return input_str.contains("agent") || input_str.contains("panel");
    }
    if step_lower.contains("research") || step_lower.contains("gather") {
        return tool_lower.contains("search") || tool_lower.contains("web") || tool_lower.contains("fetch");
    }
    if step_lower.contains("synthesize") || step_lower.contains("deliverable") {
        return tool_lower.contains("write") || tool_lower.contains("edit");
    }

    false
}

// ── Handlers ───────────────────────────────────────────────────────────────

async fn on_prompt(
    State(state): State<Arc<AppState>>,
    Json(req): Json<OnPromptRequest>,
) -> Json<OnPromptResponse> {
    state.increment_requests();

    match detect_workflow(&req.prompt) {
        Some(pattern) => {
            // Create or update hook session if session_id provided
            if let Some(sid) = &req.session_id {
                let mut sessions = state.hook_sessions.lock().await;
                let session = sessions.entry(sid.clone()).or_insert_with(|| HookSession {
                    session_id: sid.clone(),
                    ..Default::default()
                });
                session.workflow_name = Some(pattern.name.to_string());
                session.expected_steps = pattern.steps.iter().map(|s| s.to_string()).collect();
            }

            Json(OnPromptResponse {
                detected: true,
                workflow_name: Some(pattern.name.to_string()),
                inject_context: Some(pattern.inject_context.to_string()),
            })
        }
        None => Json(OnPromptResponse {
            detected: false,
            workflow_name: None,
            inject_context: None,
        }),
    }
}

async fn on_tool_use(
    State(state): State<Arc<AppState>>,
    Json(req): Json<OnToolUseRequest>,
) -> Json<OnToolUseResponse> {
    state.increment_requests();

    let mut sessions = state.hook_sessions.lock().await;
    let session = sessions.entry(req.session_id.clone()).or_insert_with(|| HookSession {
        session_id: req.session_id.clone(),
        ..Default::default()
    });

    // Record the tool call
    session.tool_calls.push(req.tool_name.clone());

    // Check if this tool call completes any expected step
    let mut newly_completed = Vec::new();
    for step in &session.expected_steps {
        if !session.completed_steps.contains(step)
            && tool_matches_step(&req.tool_name, &req.input, step)
        {
            newly_completed.push(step.clone());
        }
    }
    session.completed_steps.extend(newly_completed);

    let total = session.expected_steps.len();
    let completed = session.completed_steps.len();

    // Generate nudge if we have a workflow and there are remaining steps
    let nudge = if total > 0 && completed < total {
        let remaining: Vec<&str> = session
            .expected_steps
            .iter()
            .filter(|s| !session.completed_steps.contains(s))
            .map(|s| s.as_str())
            .collect();

        // Only nudge every 5 tool calls to avoid noise
        if session.tool_calls.len() % 5 == 0 && !remaining.is_empty() {
            session.nudges_sent += 1;
            Some(format!(
                "Progress: {}/{} steps. Remaining: {}",
                completed,
                total,
                remaining.join(", ")
            ))
        } else {
            None
        }
    } else {
        None
    };

    Json(OnToolUseResponse {
        nudge,
        progress: ProgressInfo {
            total_steps: total,
            completed,
        },
    })
}

async fn on_stop(
    State(state): State<Arc<AppState>>,
    Json(req): Json<OnStopRequest>,
) -> Json<OnStopResponse> {
    state.increment_requests();

    let sessions = state.hook_sessions.lock().await;

    match sessions.get(&req.session_id) {
        Some(session) if !session.expected_steps.is_empty() => {
            let missing: Vec<String> = session
                .expected_steps
                .iter()
                .filter(|s| !session.completed_steps.contains(s))
                .cloned()
                .collect();

            let completed = session.completed_steps.len();
            let total = session.expected_steps.len();

            if missing.is_empty() {
                Json(OnStopResponse {
                    allow_stop: true,
                    verdict: "correct".to_string(),
                    missing_steps: vec![],
                    message: format!(
                        "All {total} steps completed for {}. Ship it.",
                        session.workflow_name.as_deref().unwrap_or("workflow")
                    ),
                })
            } else {
                let pct = (completed as f64 / total as f64 * 100.0) as u32;
                Json(OnStopResponse {
                    allow_stop: false,
                    verdict: "incomplete".to_string(),
                    missing_steps: missing.clone(),
                    message: format!(
                        "Only {completed}/{total} steps done ({pct}%). Missing: {}. Don't stop yet.",
                        missing.join(", ")
                    ),
                })
            }
        }
        Some(_) => {
            // Session exists but no workflow detected — trivial task, allow stop
            Json(OnStopResponse {
                allow_stop: true,
                verdict: "correct".to_string(),
                missing_steps: vec![],
                message: "No workflow tracked. Task appears complete.".to_string(),
            })
        }
        None => {
            // Unknown session — allow stop, no data to judge
            Json(OnStopResponse {
                allow_stop: true,
                verdict: "correct".to_string(),
                missing_steps: vec![],
                message: "No session data found. Allowing stop.".to_string(),
            })
        }
    }
}

async fn on_session_start(
    State(state): State<Arc<AppState>>,
    Json(req): Json<OnSessionStartRequest>,
) -> Json<OnSessionStartResponse> {
    state.increment_requests();

    let sessions = state.hook_sessions.lock().await;

    // Check for a prior session with the same ID that had an incomplete verdict
    match sessions.get(&req.session_id) {
        Some(session) => {
            let missing: Vec<&str> = session
                .expected_steps
                .iter()
                .filter(|s| !session.completed_steps.contains(s))
                .map(|s| s.as_str())
                .collect();

            let has_incomplete = !session.expected_steps.is_empty() && !missing.is_empty();

            if has_incomplete {
                Json(OnSessionStartResponse {
                    has_prior: true,
                    prior_verdict: Some("incomplete".to_string()),
                    inject_context: Some(format!(
                        "Prior session for {} was incomplete. Missing steps: {}. Consider resuming.",
                        session.workflow_name.as_deref().unwrap_or("workflow"),
                        missing.join(", ")
                    )),
                })
            } else {
                Json(OnSessionStartResponse {
                    has_prior: true,
                    prior_verdict: Some("correct".to_string()),
                    inject_context: None,
                })
            }
        }
        None => Json(OnSessionStartResponse {
            has_prior: false,
            prior_verdict: None,
            inject_context: None,
        }),
    }
}

// ── Route registration ─────────────────────────────────────────────────────

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/on-prompt", post(on_prompt))
        .route("/on-tool-use", post(on_tool_use))
        .route("/on-stop", post(on_stop))
        .route("/on-session-start", post(on_session_start))
}
