// --------------------------------------------------------------------------
// attrition API client
// All endpoints proxy through Vite -> localhost:8100
// --------------------------------------------------------------------------

/** Shape returned by POST /api/qa/check */
export interface QaCheckResult {
  id: string;
  url: string;
  score: number;
  duration_ms: number;
  dimensions: {
    js_errors: number;
    accessibility: number;
    performance: number;
    layout: number;
    seo: number;
    security: number;
  };
  issues: QaIssue[];
  timestamp: string;
}

export interface QaIssue {
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  selector?: string;
  dimension?: string;
}

/** Shape returned by POST /api/qa/sitemap */
export interface SitemapResult {
  url: string;
  pages: SitemapPage[];
  total_pages: number;
  crawl_duration_ms: number;
  timestamp: string;
}

export interface SitemapPage {
  url: string;
  title: string;
  status: number;
  depth: number;
  links: number;
  content_type?: string;
}

/** Shape returned by POST /api/qa/ux-audit */
export interface UxAuditResult {
  url: string;
  score: number;
  rules: UxRule[];
  timestamp: string;
  duration_ms: number;
}

export interface UxRule {
  id: string;
  name: string;
  status: "pass" | "fail" | "skip";
  recommendation?: string;
  details?: string;
}

/** Shape returned by POST /api/qa/diff-crawl */
export interface DiffCrawlResult {
  url: string;
  baseline_pages: number;
  current_pages: number;
  added: string[];
  removed: string[];
  changed: DiffChange[];
  timestamp: string;
}

export interface DiffChange {
  url: string;
  field: string;
  before: string;
  after: string;
}

/** Shape returned by GET /health */
export interface HealthData {
  status: string;
  version: string;
  uptime_secs: number;
  requests_served: number;
}

// --------------------------------------------------------------------------
// Workflow types (GET /api/workflows, GET /api/workflows/:id)
// --------------------------------------------------------------------------

export interface WorkflowSummary {
  id: string;
  name: string;
  source_model: string;
  event_count: number;
  captured_at: string;
  fingerprint: string;
}

export interface WorkflowDetail {
  id: string;
  name: string;
  source_model: string;
  captured_at: string;
  events: CanonicalEventRaw[];
  metadata: WorkflowMetadata;
  fingerprint: string;
}

export interface CanonicalEventRaw {
  type: string;
  [key: string]: unknown;
}

export interface WorkflowMetadata {
  adapter: string;
  session_id?: string;
  project_path?: string;
  total_tokens: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
  };
  duration_ms: number;
  task_description: string;
}

// --------------------------------------------------------------------------
// Judge session types (GET /api/judge/sessions, GET /api/judge/sessions/:id)
// --------------------------------------------------------------------------

export interface JudgeSessionSummary {
  id: string;
  workflow_id: string;
  replay_model: string;
  events_expected: number;
  events_actual: number;
  verdict: VerdictValue | null;
  nudges_count: number;
  started_at: string;
  completed_at: string | null;
}

export interface JudgeSessionDetail {
  id: string;
  workflow_id: string;
  replay_model: string;
  events_expected: CanonicalEventRaw[];
  events_actual: CanonicalEventRaw[];
  checkpoints: CheckpointResult[];
  verdict: VerdictValue | null;
  nudges: NudgeEntry[];
  started_at: string;
  completed_at: string | null;
}

export interface VerdictValue {
  verdict: "correct" | "partial" | "escalate" | "failed";
  score?: number;
  reason?: string;
  divergences?: DivergenceEntry[];
}

export interface DivergenceEntry {
  event_index: number;
  expected: CanonicalEventRaw;
  actual: CanonicalEventRaw;
  severity: "minor" | "major" | "critical";
  suggestion: string;
}

export interface CheckpointResult {
  step_index: number;
  label: string;
  passed: boolean;
  drift_score: number;
  expected_hash: string;
  actual_hash: string;
}

export interface NudgeEntry {
  event_index: number;
  message: string;
  severity: string;
}

// --------------------------------------------------------------------------
// Benchmark types (GET /api/benchmark/results)
// --------------------------------------------------------------------------

export interface BenchmarkResults {
  tasks: BenchmarkTask[];
  summary: BenchmarkSummary;
  source: string;
}

export interface BenchmarkTask {
  task_name: string;
  category: string;
  complexity: string;
  with_attrition: boolean;
  total_tokens: number;
  time_minutes: number;
  corrections: number;
  completion_score: number;
  estimated_cost_usd: number;
  model: string;
  simulated: boolean;
}

export interface BenchmarkSummary {
  total_tasks: number;
  token_savings_pct: number;
  time_savings_pct: number;
  completion_with: number;
  completion_without: number;
  first_pass_success_pct: number;
  avg_corrections_with: number;
  avg_corrections_without: number;
}

// --------------------------------------------------------------------------
// Error wrapper
// --------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore parse failures */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

function post<T>(url: string, body: Record<string, unknown>): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(url: string): Promise<void> {
  return fetch(url, { method: "DELETE" }).then((res) => {
    if (!res.ok && res.status !== 204) {
      throw new ApiError(res.status, `DELETE failed: HTTP ${res.status}`);
    }
  });
}

// --------------------------------------------------------------------------
// QA APIs (existing)
// --------------------------------------------------------------------------

export function qaCheck(url: string): Promise<QaCheckResult> {
  return post<QaCheckResult>("/api/qa/check", { url });
}

export function sitemap(url: string): Promise<SitemapResult> {
  return post<SitemapResult>("/api/qa/sitemap", { url });
}

export function uxAudit(url: string): Promise<UxAuditResult> {
  return post<UxAuditResult>("/api/qa/ux-audit", { url });
}

export function diffCrawl(url: string): Promise<DiffCrawlResult> {
  return post<DiffCrawlResult>("/api/qa/diff-crawl", { url });
}

export function health(): Promise<HealthData> {
  return request<HealthData>("/health");
}

// --------------------------------------------------------------------------
// Workflow APIs
// --------------------------------------------------------------------------

export function listWorkflows(): Promise<WorkflowSummary[]> {
  return request<WorkflowSummary[]>("/api/workflows");
}

export function getWorkflow(id: string): Promise<WorkflowDetail> {
  return request<WorkflowDetail>(`/api/workflows/${id}`);
}

export function captureWorkflow(
  sessionPath: string,
  name?: string,
  model?: string,
): Promise<{ id: string; name: string; event_count: number }> {
  return post("/api/workflows/capture", {
    session_path: sessionPath,
    name,
    model,
  });
}

export function deleteWorkflow(id: string): Promise<void> {
  return del(`/api/workflows/${id}`);
}

// --------------------------------------------------------------------------
// Judge APIs
// --------------------------------------------------------------------------

export function listJudgeSessions(): Promise<JudgeSessionSummary[]> {
  return request<JudgeSessionSummary[]>("/api/judge/sessions");
}

export function getJudgeSession(id: string): Promise<JudgeSessionDetail> {
  return request<JudgeSessionDetail>(`/api/judge/sessions/${id}`);
}

// --------------------------------------------------------------------------
// Benchmark API
// --------------------------------------------------------------------------

export function getBenchmarkResults(): Promise<BenchmarkResults> {
  return request<BenchmarkResults>("/api/benchmark/results");
}
