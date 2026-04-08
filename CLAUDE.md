# nodebench-qa — Claude Code Project Instructions

## Project Overview
nodebench-qa is a full-stack QA platform for AI coding agents — a Rust + React rewrite of retention.sh. 8-crate Rust workspace with Axum API server, MCP protocol server, browser automation engine, multi-agent orchestration, and CLI binary (`nbqa`). React 19 + Vite + TypeScript frontend.

## Architecture

### Rust Workspace (8 crates)
- `rust/crates/core/` — Core types (`QaResult`, `QaIssue`, `Workflow`, etc.), config (`AppConfig`), errors (`Error` enum)
- `rust/crates/api/` — Axum HTTP server, routes (`/api/qa/*`, `/health`), shared `AppState`
- `rust/crates/mcp-server/` — MCP JSON-RPC protocol, tool registry (6 tools: `nbqa.check`, `nbqa.sitemap`, `nbqa.ux_audit`, `nbqa.diff_crawl`, `nbqa.workflow`, `nbqa.pipeline`)
- `rust/crates/qa-engine/` — QA check, sitemap crawling, 21-rule UX audit, diff crawl, workflow recording/replay
- `rust/crates/agents/` — Coordinator agent, QA pipeline (6 stages), OAVR sub-agent pattern
- `rust/crates/cli/` — CLI binary `nbqa` with subcommands: `serve`, `check`, `sitemap`, `audit`, `diff`, `pipeline`, `health`, `info`
- `rust/crates/telemetry/` — Structured logging via `tracing`, JSON output mode
- `rust/crates/sdk/` — Rust SDK client (`NbqaClient`) for external consumers

### Frontend
- `frontend/` — React 19 + Vite 7 + TypeScript 5.9
- Pages: Landing (QA check input), Dashboard (server health + runs), Results (per-run detail)
- Design: dark theme, terracotta `#d97757` accent, glass cards

## Conventions
- Build: `cargo build --workspace` from root
- Test: `cargo test --workspace`
- Binary: `nbqa` (from `rust/crates/cli/`)
- Config dir: `~/.nodebench-qa/`
- Data dir: `~/.nodebench-qa/data/`
- Server ports: API on 8100, MCP on 8101, frontend dev on 5173
- Tool prefix: `nbqa.*` (not `ta.*`)
- MCP protocol version: `2024-11-05`

## Naming Map (retention.sh -> nodebench-qa)
| retention.sh | nodebench-qa |
|-------------|-------------|
| `retention` (binary) | `nbqa` |
| `ta.*` (MCP tools) | `nbqa.*` |
| `ta-studio-mcp` (npm) | `nodebench-qa-mcp` (crate) |
| `retention-cli` (npm) | `nodebench-qa-cli` (crate) |
| `retention-sdk` (PyPI) | `nodebench-qa-sdk` (crate) |
| `create-retention-app` | `create-nodebench-qa-app` |
| FastAPI (Python) | Axum (Rust) |
| OpenAI Agents SDK | Native Rust agents |

## Key Types (in `core/src/types.rs`)
- `QaResult` — Complete QA check result with issues, score, screenshots
- `QaIssue` — Single issue with severity, category, evidence
- `SitemapResult` / `SitemapPage` — Crawl results
- `UxAuditResult` / `UxFinding` — 21-rule audit results
- `DiffCrawlResult` / `PageDiff` — Before/after comparison
- `Workflow` / `WorkflowStep` — Recorded workflow for trajectory replay
- `TokenCost` — Token usage tracking

## Testing
- Unit tests: `cargo test --workspace`
- Integration tests: `cargo test -p nodebench-qa-api -- --test-threads=1`
- Frontend: `cd frontend && npm test`

## Related Projects
- [retention.sh](https://github.com/Homen-ta/retention) — Original Python implementation
- [nodebench-ai](../nodebench_ai4/nodebench-ai/) — NodeBench MCP server (350 tools)
