//! nodebench-qa-sdk: Rust SDK for consuming nodebench-qa services
//!
//! Provides a typed client for external applications to interact with
//! the nodebench-qa API and MCP server.

use nodebench_qa_core::types::{QaResult, SitemapResult, UxAuditResult};
use nodebench_qa_core::Result;
use serde::Deserialize;

/// Client for the nodebench-qa API
pub struct NbqaClient {
    base_url: String,
    client: reqwest::Client,
    auth_token: Option<String>,
}

impl NbqaClient {
    /// Create a new client pointing at a nodebench-qa server
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            client: reqwest::Client::new(),
            auth_token: None,
        }
    }

    /// Set an authentication token
    pub fn with_auth(mut self, token: &str) -> Self {
        self.auth_token = Some(token.to_string());
        self
    }

    /// Run a QA check on a URL
    pub async fn qa_check(&self, url: &str) -> Result<QaResult> {
        let resp = self
            .client
            .post(format!("{}/api/qa/check", self.base_url))
            .json(&serde_json::json!({ "url": url }))
            .send()
            .await?;

        let result: QaResult = resp.json().await.map_err(|e| {
            nodebench_qa_core::Error::Internal(format!("Failed to parse QA result: {}", e))
        })?;
        Ok(result)
    }

    /// Generate a sitemap for a URL
    pub async fn sitemap(&self, url: &str, max_depth: u8, max_pages: usize) -> Result<SitemapResult> {
        let resp = self
            .client
            .post(format!("{}/api/qa/sitemap", self.base_url))
            .json(&serde_json::json!({
                "url": url,
                "max_depth": max_depth,
                "max_pages": max_pages,
            }))
            .send()
            .await?;

        let result: SitemapResult = resp.json().await.map_err(|e| {
            nodebench_qa_core::Error::Internal(format!("Failed to parse sitemap: {}", e))
        })?;
        Ok(result)
    }

    /// Run a UX audit on a URL
    pub async fn ux_audit(&self, url: &str) -> Result<UxAuditResult> {
        let resp = self
            .client
            .post(format!("{}/api/qa/ux-audit", self.base_url))
            .json(&serde_json::json!({ "url": url }))
            .send()
            .await?;

        let result: UxAuditResult = resp.json().await.map_err(|e| {
            nodebench_qa_core::Error::Internal(format!("Failed to parse UX audit: {}", e))
        })?;
        Ok(result)
    }

    /// Check server health
    pub async fn health(&self) -> Result<HealthResponse> {
        let resp = self
            .client
            .get(format!("{}/health", self.base_url))
            .send()
            .await?;

        let result: HealthResponse = resp.json().await.map_err(|e| {
            nodebench_qa_core::Error::Internal(format!("Failed to parse health: {}", e))
        })?;
        Ok(result)
    }
}

#[derive(Debug, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub uptime_secs: u64,
}
