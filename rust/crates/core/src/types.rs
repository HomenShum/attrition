use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── QA Results ──────────────────────────────────────────────────────────────

/// A complete QA check result for a single URL
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QaResult {
    pub id: Uuid,
    pub url: String,
    pub timestamp: DateTime<Utc>,
    pub duration_ms: u64,
    pub issues: Vec<QaIssue>,
    pub score: QaScore,
    pub screenshots: Vec<Screenshot>,
    pub metadata: QaMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QaIssue {
    pub id: Uuid,
    pub severity: Severity,
    pub category: IssueCategory,
    pub title: String,
    pub description: String,
    pub selector: Option<String>,
    pub source_url: String,
    pub evidence: Option<Evidence>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueCategory {
    JsError,
    Accessibility,
    Performance,
    Layout,
    Rendering,
    Network,
    Security,
    Seo,
    Custom(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evidence {
    pub screenshot_id: Option<Uuid>,
    pub console_log: Option<String>,
    pub network_request: Option<NetworkEvidence>,
    pub dom_snapshot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkEvidence {
    pub url: String,
    pub method: String,
    pub status: u16,
    pub response_time_ms: u64,
}

// ── Scoring ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QaScore {
    /// 0-100, weighted across dimensions
    pub overall: u8,
    pub dimensions: ScoreDimensions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreDimensions {
    pub js_errors: u8,
    pub accessibility: u8,
    pub performance: u8,
    pub layout: u8,
    pub seo: u8,
    pub security: u8,
}

// ── Screenshots ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Screenshot {
    pub id: Uuid,
    pub url: String,
    pub viewport: Viewport,
    pub format: ImageFormat,
    pub data: Vec<u8>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Viewport {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    Png,
    Jpeg,
    Webp,
}

// ── Sitemap ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SitemapResult {
    pub root_url: String,
    pub pages: Vec<SitemapPage>,
    pub total_pages: usize,
    pub crawl_duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SitemapPage {
    pub url: String,
    pub title: Option<String>,
    pub status: u16,
    pub depth: u8,
    pub links_to: Vec<String>,
    pub screenshot: Option<Screenshot>,
}

// ── UX Audit ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UxAuditResult {
    pub url: String,
    pub score: u8,
    pub rules_checked: usize,
    pub rules_passed: usize,
    pub findings: Vec<UxFinding>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UxFinding {
    pub rule_id: String,
    pub rule_name: String,
    pub passed: bool,
    pub severity: Severity,
    pub detail: String,
    pub recommendation: Option<String>,
}

// ── Diff Crawl ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffCrawlResult {
    pub url: String,
    pub before: CrawlSnapshot,
    pub after: CrawlSnapshot,
    pub diffs: Vec<PageDiff>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawlSnapshot {
    pub timestamp: DateTime<Utc>,
    pub pages: Vec<SitemapPage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageDiff {
    pub url: String,
    pub diff_type: DiffType,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffType {
    Added,
    Removed,
    Changed,
    StatusChanged,
    ContentChanged,
}

// ── Workflow / Trajectory ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workflow {
    pub id: Uuid,
    pub name: String,
    pub url: String,
    pub steps: Vec<WorkflowStep>,
    pub created_at: DateTime<Utc>,
    pub token_cost: TokenCost,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStep {
    pub action: WorkflowAction,
    pub selector: Option<String>,
    pub value: Option<String>,
    pub screenshot_before: Option<Uuid>,
    pub screenshot_after: Option<Uuid>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowAction {
    Navigate,
    Click,
    Type,
    Scroll,
    Wait,
    Assert,
    Screenshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenCost {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub estimated_cost_usd: f64,
}

// ── QA Metadata ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QaMetadata {
    pub engine_version: String,
    pub browser: Option<String>,
    pub viewport: Viewport,
    pub user_agent: Option<String>,
}

impl Default for QaMetadata {
    fn default() -> Self {
        Self {
            engine_version: env!("CARGO_PKG_VERSION").into(),
            browser: None,
            viewport: Viewport {
                width: 1280,
                height: 800,
            },
            user_agent: None,
        }
    }
}
