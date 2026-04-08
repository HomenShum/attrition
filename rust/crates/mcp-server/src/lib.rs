//! attrition-mcp: MCP (Model Context Protocol) server
//!
//! Exposes workflow capture and distillation tools via JSON-RPC over HTTP
//! for AI coding agents (Claude Code, Cursor, Windsurf, Devin, etc.)

pub mod protocol;
pub mod tools;

use axum::{routing::post, Router};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct McpState {
    pub tools: Vec<tools::McpTool>,
    pub workflow_store: Mutex<attrition_workflow::storage::WorkflowStore>,
    pub judge_engine: Mutex<attrition_judge::engine::JudgeEngine>,
}

impl McpState {
    pub fn new() -> Self {
        let db_path = Self::workflow_db_path();
        let store = attrition_workflow::storage::WorkflowStore::new(&db_path)
            .expect("Failed to open workflow database");

        Self {
            tools: tools::register_all(),
            workflow_store: Mutex::new(store),
            judge_engine: Mutex::new(attrition_judge::engine::JudgeEngine::new()),
        }
    }

    /// Resolve the workflow database path (~/.attrition/workflows.db).
    fn workflow_db_path() -> PathBuf {
        let base = if let Some(proj_dirs) =
            directories::ProjectDirs::from("", "", "attrition")
        {
            proj_dirs.data_dir().to_path_buf()
        } else {
            let home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_else(|_| ".".to_string());
            PathBuf::from(home).join(".attrition")
        };
        std::fs::create_dir_all(&base).ok();
        base.join("workflows.db")
    }
}

impl Default for McpState {
    fn default() -> Self {
        Self::new()
    }
}

/// Build the MCP server router
pub fn build_mcp_router() -> Router {
    let state = Arc::new(McpState::new());

    Router::new()
        .route("/mcp", post(protocol::handle_jsonrpc))
        .with_state(state)
}
