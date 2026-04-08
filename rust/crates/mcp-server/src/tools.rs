use std::future::Future;
use std::pin::Pin;

use crate::McpState;

/// An MCP tool definition
pub struct McpTool {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: serde_json::Value,
    pub handler: fn(serde_json::Value) -> Pin<Box<dyn Future<Output = attrition_core::Result<serde_json::Value>> + Send>>,
}

/// Register all available MCP tools
pub fn register_all() -> Vec<McpTool> {
    vec![
        // ── QA tools (stateless) ──────────────────────────────────────
        McpTool {
            name: "bp.check",
            description: "Run a full QA check on a URL — JS errors, accessibility, rendering, performance",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to QA check"
                    },
                    "timeout_ms": {
                        "type": "integer",
                        "description": "Timeout in milliseconds (default: 30000)",
                        "default": 30000
                    }
                },
                "required": ["url"]
            }),
            handler: |args| Box::pin(tool_qa_check(args)),
        },
        McpTool {
            name: "bp.sitemap",
            description: "Crawl a website and generate an interactive sitemap with screenshots",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Root URL to crawl"
                    },
                    "max_depth": {
                        "type": "integer",
                        "description": "Maximum crawl depth (default: 3)",
                        "default": 3
                    },
                    "max_pages": {
                        "type": "integer",
                        "description": "Maximum pages to crawl (default: 50)",
                        "default": 50
                    }
                },
                "required": ["url"]
            }),
            handler: |args| Box::pin(tool_sitemap(args)),
        },
        McpTool {
            name: "bp.ux_audit",
            description: "Run a 21-rule UX audit with scoring and actionable recommendations",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL to audit"
                    }
                },
                "required": ["url"]
            }),
            handler: |args| Box::pin(tool_ux_audit(args)),
        },
        McpTool {
            name: "bp.diff_crawl",
            description: "Compare current site state against a previous baseline crawl",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL to diff crawl"
                    },
                    "baseline_id": {
                        "type": "string",
                        "description": "ID of the baseline crawl to compare against"
                    }
                },
                "required": ["url"]
            }),
            handler: |args| Box::pin(tool_diff_crawl(args)),
        },
        McpTool {
            name: "bp.workflow",
            description: "Start a workflow recording for trajectory replay (60-70% token savings on reruns)",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL to start workflow on"
                    },
                    "name": {
                        "type": "string",
                        "description": "Name for this workflow"
                    }
                },
                "required": ["url"]
            }),
            handler: |args| Box::pin(tool_workflow(args)),
        },
        McpTool {
            name: "bp.pipeline",
            description: "Run the full QA pipeline: crawl, analyze, test, verify, report",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL to run the full pipeline on"
                    }
                },
                "required": ["url"]
            }),
            handler: |args| Box::pin(tool_pipeline(args)),
        },

        // ── Workflow & judge tools (schemas only — handlers are stateful) ──
        // These are registered for tools/list but dispatched via McpState in protocol.rs.
        McpTool {
            name: "bp.capture",
            description: "Parse a Claude Code JSONL session file and save as a replayable workflow",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "session_path": {
                        "type": "string",
                        "description": "Absolute path to the Claude Code .jsonl session file"
                    },
                    "name": {
                        "type": "string",
                        "description": "Workflow name (default: derived from filename)"
                    },
                    "model": {
                        "type": "string",
                        "description": "Source model (default: claude-opus-4-6)",
                        "default": "claude-opus-4-6"
                    }
                },
                "required": ["session_path"]
            }),
            // Placeholder handler — actual dispatch goes through protocol.rs
            handler: |_| Box::pin(async { Ok(serde_json::json!({"error": "routed via stateful handler"})) }),
        },
        McpTool {
            name: "bp.workflows",
            description: "List all captured workflows with ID, name, model, event count, and date",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {},
                "required": []
            }),
            handler: |_| Box::pin(async { Ok(serde_json::json!({"error": "routed via stateful handler"})) }),
        },
        McpTool {
            name: "bp.distill",
            description: "Distill a captured workflow for cheaper replay on a target model",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "workflow_id": {
                        "type": "string",
                        "description": "Workflow ID (short prefix or full UUID)"
                    },
                    "target_model": {
                        "type": "string",
                        "description": "Target model for distillation (e.g. claude-sonnet-4-20250514, gpt-4o-mini)"
                    }
                },
                "required": ["workflow_id", "target_model"]
            }),
            handler: |_| Box::pin(async { Ok(serde_json::json!({"error": "routed via stateful handler"})) }),
        },
        McpTool {
            name: "bp.judge.start",
            description: "Start a judge session to evaluate a workflow replay — compares expected vs actual events",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "workflow_id": {
                        "type": "string",
                        "description": "Workflow ID to judge against"
                    },
                    "replay_model": {
                        "type": "string",
                        "description": "Model being evaluated during replay"
                    }
                },
                "required": ["workflow_id", "replay_model"]
            }),
            handler: |_| Box::pin(async { Ok(serde_json::json!({"error": "routed via stateful handler"})) }),
        },
        McpTool {
            name: "bp.judge.event",
            description: "Report an actual event during replay — returns nudge/correction if divergence detected",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "Judge session ID from bp.judge.start"
                    },
                    "event": {
                        "type": "object",
                        "description": "The actual canonical event produced during replay"
                    }
                },
                "required": ["session_id", "event"]
            }),
            handler: |_| Box::pin(async { Ok(serde_json::json!({"error": "routed via stateful handler"})) }),
        },
        McpTool {
            name: "bp.judge.verdict",
            description: "Finalize a judge session and produce a verdict (correct/partial/escalate/failed)",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "Judge session ID from bp.judge.start"
                    }
                },
                "required": ["session_id"]
            }),
            handler: |_| Box::pin(async { Ok(serde_json::json!({"error": "routed via stateful handler"})) }),
        },
    ]
}

// ── Stateless tool handlers (QA engine) ───────────────────────────────────

async fn tool_qa_check(args: serde_json::Value) -> attrition_core::Result<serde_json::Value> {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let timeout = args.get("timeout_ms").and_then(|v| v.as_u64()).unwrap_or(30_000);
    let result = attrition_engine::qa::run_qa_check(url, timeout).await?;
    serde_json::to_value(result).map_err(|e| attrition_core::Error::Internal(e.to_string()))
}

async fn tool_sitemap(args: serde_json::Value) -> attrition_core::Result<serde_json::Value> {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let max_depth = args.get("max_depth").and_then(|v| v.as_u64()).unwrap_or(3) as u8;
    let max_pages = args.get("max_pages").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
    let result = attrition_engine::crawl::crawl_sitemap(url, max_depth, max_pages).await?;
    serde_json::to_value(result).map_err(|e| attrition_core::Error::Internal(e.to_string()))
}

async fn tool_ux_audit(args: serde_json::Value) -> attrition_core::Result<serde_json::Value> {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let result = attrition_engine::audit::run_ux_audit(url).await?;
    serde_json::to_value(result).map_err(|e| attrition_core::Error::Internal(e.to_string()))
}

async fn tool_diff_crawl(args: serde_json::Value) -> attrition_core::Result<serde_json::Value> {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let baseline_id = args.get("baseline_id").and_then(|v| v.as_str());
    let result = attrition_engine::diff::run_diff_crawl(url, baseline_id).await?;
    serde_json::to_value(result).map_err(|e| attrition_core::Error::Internal(e.to_string()))
}

async fn tool_workflow(args: serde_json::Value) -> attrition_core::Result<serde_json::Value> {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("unnamed");
    let result = attrition_engine::workflow::start_workflow(url, name).await?;
    serde_json::to_value(result).map_err(|e| attrition_core::Error::Internal(e.to_string()))
}

async fn tool_pipeline(args: serde_json::Value) -> attrition_core::Result<serde_json::Value> {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let result = attrition_agents::pipeline::run_pipeline(url).await?;
    serde_json::to_value(result).map_err(|e| attrition_core::Error::Internal(e.to_string()))
}

// ── Stateful tool handlers (workflow store + judge engine) ────────────────

/// bp.capture — parse JSONL, save workflow
pub async fn tool_capture(
    state: &McpState,
    args: serde_json::Value,
) -> attrition_core::Result<serde_json::Value> {
    use attrition_workflow::adapters::claude_code::ClaudeCodeAdapter;
    use attrition_workflow::adapters::WorkflowAdapter;
    use attrition_workflow::{Workflow, WorkflowMetadata, TokenCost};

    let session_path = args
        .get("session_path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| attrition_core::Error::Internal("session_path is required".into()))?;

    let model = args
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("claude-opus-4-6");

    let raw = std::fs::read(session_path).map_err(|e| {
        attrition_core::Error::Internal(format!("Failed to read {}: {}", session_path, e))
    })?;
    let events = ClaudeCodeAdapter::parse(&raw)?;

    let name = args
        .get("name")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| {
            std::path::Path::new(session_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unnamed")
                .to_string()
        });

    let workflow = Workflow::new(
        name.clone(),
        model.to_string(),
        events.clone(),
        WorkflowMetadata {
            adapter: ClaudeCodeAdapter::source_name().to_string(),
            session_id: None,
            project_path: std::path::Path::new(session_path)
                .parent()
                .and_then(|p| p.to_str())
                .map(String::from),
            total_tokens: TokenCost::default(),
            duration_ms: 0,
            task_description: format!("Captured from {}", session_path),
        },
    );

    let store = state.workflow_store.lock().await;
    store.save_workflow(&workflow)?;

    Ok(serde_json::json!({
        "id": workflow.id.to_string(),
        "name": name,
        "model": model,
        "event_count": events.len(),
        "fingerprint": workflow.fingerprint,
        "message": format!("Captured workflow: {} ({} events, {})", name, events.len(), model),
    }))
}

/// bp.workflows — list all workflows
pub async fn tool_workflows(
    state: &McpState,
) -> attrition_core::Result<serde_json::Value> {
    let store = state.workflow_store.lock().await;
    let workflows = store.list_workflows()?;
    serde_json::to_value(&workflows)
        .map_err(|e| attrition_core::Error::Internal(e.to_string()))
}

/// bp.distill — distill a workflow for cheaper replay
pub async fn tool_distill(
    state: &McpState,
    args: serde_json::Value,
) -> attrition_core::Result<serde_json::Value> {
    let workflow_id_str = args
        .get("workflow_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| attrition_core::Error::Internal("workflow_id is required".into()))?;

    let target_model = args
        .get("target_model")
        .and_then(|v| v.as_str())
        .ok_or_else(|| attrition_core::Error::Internal("target_model is required".into()))?;

    let store = state.workflow_store.lock().await;
    let id = resolve_workflow_id_from_store(&*store, workflow_id_str)?;
    let workflow = store
        .get_workflow(id)?
        .ok_or_else(|| attrition_core::Error::NotFound(format!("Workflow {}", id)))?;
    drop(store);

    let distilled = attrition_distiller::distill(&workflow, target_model);

    serde_json::to_value(&distilled)
        .map_err(|e| attrition_core::Error::Internal(e.to_string()))
}

/// bp.judge.start — start a judge session
pub async fn tool_judge_start(
    state: &McpState,
    args: serde_json::Value,
) -> attrition_core::Result<serde_json::Value> {
    let workflow_id_str = args
        .get("workflow_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| attrition_core::Error::Internal("workflow_id is required".into()))?;

    let replay_model = args
        .get("replay_model")
        .and_then(|v| v.as_str())
        .ok_or_else(|| attrition_core::Error::Internal("replay_model is required".into()))?;

    let store = state.workflow_store.lock().await;
    let id = resolve_workflow_id_from_store(&*store, workflow_id_str)?;
    let workflow = store
        .get_workflow(id)?
        .ok_or_else(|| attrition_core::Error::NotFound(format!("Workflow {}", id)))?;
    drop(store);

    let mut engine = state.judge_engine.lock().await;
    let session_id = engine.start_session(
        workflow.id,
        workflow.events.clone(),
        replay_model,
    );

    Ok(serde_json::json!({
        "session_id": session_id.to_string(),
        "workflow_id": workflow.id.to_string(),
        "workflow_name": workflow.name,
        "replay_model": replay_model,
        "expected_events": workflow.events.len(),
        "status": "active",
    }))
}

/// bp.judge.event — report an actual event, get nudge if divergent
pub async fn tool_judge_event(
    state: &McpState,
    args: serde_json::Value,
) -> attrition_core::Result<serde_json::Value> {
    let session_id_str = args
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| attrition_core::Error::Internal("session_id is required".into()))?;

    let session_id = uuid::Uuid::parse_str(session_id_str).map_err(|e| {
        attrition_core::Error::Internal(format!("Invalid session_id UUID: {}", e))
    })?;

    let event_value = args
        .get("event")
        .ok_or_else(|| attrition_core::Error::Internal("event is required".into()))?;

    let event: attrition_workflow::CanonicalEvent =
        serde_json::from_value(event_value.clone()).map_err(|e| {
            attrition_core::Error::Internal(format!("Invalid event format: {}", e))
        })?;

    let mut engine = state.judge_engine.lock().await;
    let nudge = engine.on_event(session_id, event)?;

    match nudge {
        Some(n) => Ok(serde_json::json!({
            "divergence_detected": true,
            "nudge": {
                "at_event": n.at_event,
                "message": n.message,
            },
        })),
        None => Ok(serde_json::json!({
            "divergence_detected": false,
            "nudge": null,
        })),
    }
}

/// bp.judge.verdict — finalize and return verdict
pub async fn tool_judge_verdict(
    state: &McpState,
    args: serde_json::Value,
) -> attrition_core::Result<serde_json::Value> {
    let session_id_str = args
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| attrition_core::Error::Internal("session_id is required".into()))?;

    let session_id = uuid::Uuid::parse_str(session_id_str).map_err(|e| {
        attrition_core::Error::Internal(format!("Invalid session_id UUID: {}", e))
    })?;

    let mut engine = state.judge_engine.lock().await;
    let verdict = engine.finalize(session_id)?;

    serde_json::to_value(&verdict)
        .map_err(|e| attrition_core::Error::Internal(e.to_string()))
}

/// Resolve a workflow ID from a short prefix or full UUID.
fn resolve_workflow_id_from_store(
    store: &attrition_workflow::storage::WorkflowStore,
    input: &str,
) -> attrition_core::Result<uuid::Uuid> {
    // Try full UUID first
    if let Ok(id) = uuid::Uuid::parse_str(input) {
        return Ok(id);
    }

    // Prefix search
    let all = store.list_workflows()?;
    let matches: Vec<_> = all
        .iter()
        .filter(|w| w.id.to_string().starts_with(input))
        .collect();

    match matches.len() {
        0 => Err(attrition_core::Error::NotFound(format!(
            "No workflow found matching '{}'",
            input
        ))),
        1 => Ok(matches[0].id),
        n => Err(attrition_core::Error::Internal(format!(
            "Ambiguous prefix '{}' matches {} workflows",
            input, n
        ))),
    }
}
