use attrition_core::AppConfig;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::Mutex;

use crate::routes::judge::HookSession;

/// Shared application state across all request handlers
pub struct AppState {
    pub config: AppConfig,
    pub request_count: AtomicU64,
    pub start_time: std::time::Instant,
    /// In-memory hook session evidence, keyed by session_id.
    pub hook_sessions: Mutex<HashMap<String, HookSession>>,
    /// Persistent workflow storage (SQLite).
    pub workflow_store: Mutex<attrition_workflow::storage::WorkflowStore>,
    /// Judge engine for replay sessions.
    pub judge_engine: Mutex<attrition_judge::engine::JudgeEngine>,
    /// Admin API key (BP_ADMIN_KEY env var). When set, auth is required on /api/* routes.
    pub admin_key: Option<String>,
    /// Valid API keys (BP_API_KEYS env var, comma-separated). All get standard access.
    pub api_keys: Vec<String>,
}

impl AppState {
    pub fn new(config: AppConfig) -> Self {
        let db_path = Self::workflow_db_path();
        let store = attrition_workflow::storage::WorkflowStore::new(&db_path)
            .expect("Failed to open workflow database");

        let admin_key = std::env::var("BP_ADMIN_KEY").ok().filter(|k| !k.is_empty());
        let api_keys: Vec<String> = std::env::var("BP_API_KEYS")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        if admin_key.is_some() {
            tracing::info!(
                "Auth enabled: admin key set, {} additional API keys loaded",
                api_keys.len()
            );
        } else {
            tracing::info!("Auth disabled: BP_ADMIN_KEY not set — open access mode");
        }

        Self {
            config,
            request_count: AtomicU64::new(0),
            start_time: std::time::Instant::now(),
            hook_sessions: Mutex::new(HashMap::new()),
            workflow_store: Mutex::new(store),
            judge_engine: Mutex::new(attrition_judge::engine::JudgeEngine::new()),
            admin_key,
            api_keys,
        }
    }

    /// Check whether auth is enabled (BP_ADMIN_KEY is set).
    pub fn auth_enabled(&self) -> bool {
        self.admin_key.is_some()
    }

    /// Validate a bearer token. Returns true if the key is the admin key or a valid API key.
    pub fn validate_key(&self, key: &str) -> bool {
        if let Some(ref admin) = self.admin_key {
            if key == admin {
                return true;
            }
        }
        self.api_keys.iter().any(|k| k == key)
    }

    /// Check if a key is the admin key.
    pub fn is_admin(&self, key: &str) -> bool {
        self.admin_key.as_deref() == Some(key)
    }

    pub fn increment_requests(&self) -> u64 {
        self.request_count.fetch_add(1, Ordering::Relaxed)
    }

    pub fn uptime_secs(&self) -> u64 {
        self.start_time.elapsed().as_secs()
    }

    /// Resolve the workflow database path (~/.attrition/workflows.db).
    /// Shared with the MCP server so both see the same data.
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
