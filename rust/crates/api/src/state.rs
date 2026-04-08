use attrition_core::AppConfig;
use std::collections::HashMap;
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
}

impl AppState {
    pub fn new(config: AppConfig) -> Self {
        Self {
            config,
            request_count: AtomicU64::new(0),
            start_time: std::time::Instant::now(),
            hook_sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn increment_requests(&self) -> u64 {
        self.request_count.fetch_add(1, Ordering::Relaxed)
    }

    pub fn uptime_secs(&self) -> u64 {
        self.start_time.elapsed().as_secs()
    }
}
