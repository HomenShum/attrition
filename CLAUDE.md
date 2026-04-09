# attrition -- Claude Code Project Instructions

## Project Overview

attrition is a workflow memory and distillation engine for AI coding agents. 12-crate Rust workspace with Axum API server, MCP protocol server (12 tools), workflow capture/storage, 4-strategy distillation engine, replay judgment engine, browser automation, multi-agent orchestration, and CLI binary (`bp`). React 19 + Vite + TypeScript frontend.

Core thesis: frontier model workflows are ephemeral. attrition captures them, distills them by eliminating redundant steps, and replays them on cheaper models at 60-70% lower token cost. A judge engine verifies replay correctness in real time.

## Architecture

### Rust Workspace (12 crates)

- `rust/crates/core/` -- Core types (`QaResult`, `QaIssue`, `Workflow`, etc.), config (`AppConfig`), errors (`Error` enum with `Result<T>` alias)
- `rust/crates/api/` -- Axum HTTP server, routes (`/api/qa/*`, `/health`), shared `AppState`
- `rust/crates/mcp-server/` -- MCP JSON-RPC protocol, tool registry (12 tools: `bp.*`), `McpState` holds `WorkflowStore` + `JudgeEngine` (behind `tokio::sync::Mutex`)
- `rust/crates/qa-engine/` -- QA check, sitemap crawling, 21-rule UX audit, diff crawl, workflow recording/replay
- `rust/crates/agents/` -- Coordinator agent, QA pipeline (6 stages), OAVR sub-agent pattern
- `rust/crates/cli/` -- CLI binary `bp` with 11 subcommands: `serve`, `check`, `sitemap`, `audit`, `diff`, `pipeline`, `health`, `info`, `capture`, `workflows`, `distill`, `judge`
- `rust/crates/telemetry/` -- Structured logging via `tracing`, JSON output mode
- `rust/crates/sdk/` -- Rust SDK client (`BpClient`) for external consumers
- `rust/crates/workflow/` -- Canonical event stream types (`CanonicalEvent` tagged enum), `WorkflowStore` (SQLite), adapters: `ClaudeCodeAdapter` (JSONL), `RawApiAdapter`, `GenericAdapter`
- `rust/crates/distiller/` -- 4-strategy distillation: step elimination, copy-paste block extraction, context compression, checkpoint extraction. `distill(workflow, target_model) -> DistilledWorkflow`
- `rust/crates/judge/` -- Replay judgment engine: `JudgeEngine` (session management), `on_event()` returns nudges on divergence, `finalize()` produces verdicts (correct/partial/escalate/failed), attention maps, drift scoring
- `rust/crates/llm-client/` -- Anthropic Messages API client (`ClaudeClient`), text + vision support, token tracking, retry with exponential backoff

### Frontend

- `frontend/` -- React 19 + Vite 7 + TypeScript 5.9
- Pages: Landing, Dashboard, Results
- Design: dark theme, terracotta `#d97757` accent, glass cards

## Key Types

### workflow crate (`rust/crates/workflow/src/types.rs`)
- `Workflow` -- id, name, source_model, captured_at, events, metadata, fingerprint (SHA-256)
- `CanonicalEvent` -- Tagged enum: Think, ToolCall, Decision, FileEdit, FileCreate, Search, Navigate, Assert, Checkpoint, Nudge
- `WorkflowMetadata` -- adapter, session_id, project_path, total_tokens, duration_ms, task_description
- `TokenCost` -- input_tokens, output_tokens, total_tokens, estimated_cost_usd
- `WorkflowSummary` -- Lightweight listing type (no event data)
- `WorkflowStore` -- SQLite persistence, `save_workflow`, `get_workflow`, `list_workflows`, `find_similar`

### distiller crate (`rust/crates/distiller/src/lib.rs`)
- `DistilledWorkflow` -- id, original_id, original_model, target_model, events, copy_blocks, checkpoints, compression_ratio, estimated_cost
- `distill(workflow, target_model)` -- Public entry point, applies all 4 strategies
- `CopyBlock` -- Deterministic content blocks (confidence-scored)
- `Checkpoint` -- Verification points for replay validation

### judge crate (`rust/crates/judge/src/`)
- `JudgeEngine` -- Holds HashMap of sessions, `start_session`, `on_event`, `check_checkpoint`, `finalize`
- `JudgeSession` -- Full state: expected/actual events, checkpoints, nudges, verdict
- `Verdict` -- Correct, Partial { score, divergences }, Escalate { reason }, Failed { reason }
- `Divergence` -- event_index, expected, actual, severity (Minor/Major/Critical), suggestion
- `Nudge` -- at_event, message, accepted, timestamp
- `AttentionMap` / `AttentionEntry` -- Tracks Followed/Skipped/Diverged per expected event

### adapters (`rust/crates/workflow/src/adapters/`)
- `WorkflowAdapter` trait -- `parse(input: &[u8]) -> Result<Vec<CanonicalEvent>>` + `source_name()`
- `ClaudeCodeAdapter` -- Two-pass JSONL parser: collects tool_results, then maps assistant messages to canonical events
- `map_tool_to_event()` -- Maps Edit->FileEdit, Write->FileCreate, Grep/Glob->Search, Bash/Read->ToolCall

## Conventions

- Build: `cargo build --workspace` from project root
- Test: `cargo test --workspace`
- Binary: `bp` (from `rust/crates/cli/`)
- Config dir: `~/.attrition/`
- Data dir: `~/.attrition/` (SQLite at `workflows.db`)
- Server ports: API on 8100, MCP on 8101, frontend dev on 5173
- Tool prefix: `bp.*`
- MCP protocol version: `2024-11-05`
- MCP state: `McpState` holds `WorkflowStore` (SQLite) + `JudgeEngine` (behind `tokio::sync::Mutex`)
- Stateful tools (`bp.capture`, `bp.workflows`, `bp.distill`, `bp.judge.*`) are dispatched through `McpState` in `protocol.rs`
- Stateless tools (`bp.check`, `bp.sitemap`, etc.) use function-pointer handlers in `tools.rs`

## MCP Tools (12 total)

| Tool | Stateful | Description |
|------|----------|-------------|
| `bp.check` | No | Full QA check |
| `bp.sitemap` | No | Crawl + sitemap |
| `bp.ux_audit` | No | 21-rule UX audit |
| `bp.diff_crawl` | No | Before/after comparison |
| `bp.workflow` | No | Start workflow recording |
| `bp.pipeline` | No | Full QA pipeline |
| `bp.capture` | Yes | Parse JSONL, save workflow |
| `bp.workflows` | Yes | List workflows |
| `bp.distill` | Yes | Distill for cheaper replay |
| `bp.judge.start` | Yes | Start judge session |
| `bp.judge.event` | Yes | Report event, get nudge |
| `bp.judge.verdict` | Yes | Finalize, produce verdict |

## Claude Code Plugin System

attrition ships as a Claude Code plugin (`.claude-plugin/`). The plugin registers 10 hooks across the full session lifecycle:

### Plugin Manifest
- `.claude-plugin/plugin.json` -- Plugin metadata (name, version, entrypoint)
- `.claude-plugin/hooks/hooks.json` -- Hook definitions for all 10 lifecycle events
- `.claude-plugin/skills/attrition/SKILL.md` -- Bundled skill (capture/distill/judge)

### Hook Scripts (10 total)

| Hook | Script | Trigger | Behavior |
|------|--------|---------|----------|
| SessionStart | `session-start.sh` | Session begins | Checks for prior incomplete workflows, persists env vars |
| UserPromptSubmit | `detect-workflow.sh` | User sends prompt | Pattern-matches 5 workflow types (dev_flywheel, qa_audit, research, refactor, deploy), saves required steps |
| PreToolUse | `block-redundant.sh` | Before Grep/Glob/WebSearch | SHA-256 hashes query, blocks exact duplicates within the session |
| PostToolUse | `track-tool.sh` | After any tool call | Scrubs sensitive values, appends to `~/.attrition/activity.jsonl` |
| Stop | `judge-stop.sh` | Agent tries to stop | Scores workflow evidence vs required steps. EXIT 2 = HARD BLOCK if <50% done |
| SubagentStop | `judge-stop.sh` | Subagent tries to stop | Same judge logic as Stop |
| InstructionsLoaded | `inject-workflow.sh` | Instructions refresh | Injects active workflow's required steps into agent context |
| PreCompact | `save-state.sh` | Before context prune | Saves tool summary + active workflow to `compact_state.json` |
| SessionEnd | `auto-capture.sh` | Session ends | Auto-captures sessions with 5+ tool calls to `~/.attrition/auto_captures/` |
| FileChanged | `track-file.sh` | File modified | Appends file path + timestamp to `~/.attrition/file_changes.jsonl` |

### Workflow Detection Patterns

The `detect-workflow.sh` hook recognizes these workflow types:

| Workflow | Trigger Words | Required Steps |
|----------|---------------|----------------|
| dev_flywheel | "flywheel", "full pass", "ship this" | understand plan, search context, inspect, implement, test, verify, commit |
| qa_audit | "qa this", "audit", "dogfood" | start server, navigate pages, check console, test interactions, report |
| research | "research", "investigate", "deep dive" | define scope, web search, read sources, synthesize |
| refactor | "refactor", "migrate", "upgrade" | search patterns, read files, edit, check breaks, update types, test, build |
| deploy | "deploy", "release", "ship to prod" | test, build, bump version, tag, push staging, smoke test, promote |

### Judge Scoring (judge-stop.sh)

| Score | Verdict | Exit Code | Effect |
|-------|---------|-----------|--------|
| 100% | ALLOW | 0 | Clean stop, workflow file removed |
| >= 85% | ALLOW_WARN | 0 | Stop allowed, minor gaps logged |
| >= 50% | ESCALATE | 0 | Warning printed, agent can still stop |
| < 50% | BLOCK | 2 | HARD BLOCK -- agent cannot stop |

### Data Directory (`~/.attrition/`)

| File | Purpose |
|------|---------|
| `activity.jsonl` | Tool call log (scrubbed) |
| `search_log.jsonl` | Search hash dedup log (session-scoped) |
| `active_workflow.json` | Current workflow + required steps |
| `compact_state.json` | Saved state before context prune |
| `file_changes.jsonl` | File modification log |
| `current_session_id` | Current session ID |
| `auto_captures/*.json` | Auto-captured workflow files |
| `workflows.db` | SQLite workflow storage (bp CLI) |

### Installation

Plugin mode (preferred -- inside a git repo):
```bash
curl -sL attrition.sh/install | bash
```
This writes `.claude-plugin/` into the project. Claude Code picks it up automatically.

Legacy mode (fallback -- no git repo):
The installer falls back to injecting hooks directly into `~/.claude/settings.json`.

### Legacy Integration

- `.claude/rules/bp_capture.md` -- Auto-suggest workflow capture after complex tasks
- `.claude/rules/bp_after_fix.md` -- Re-run judge session after code changes
- `.claude/skills/attrition/SKILL.md` -- Full skill with MCP tool usage examples

## Testing

- Unit tests: `cargo test --workspace`
- Integration tests: `cargo test -p attrition-api -- --test-threads=1`
- Frontend: `cd frontend && npm test`
- Workflow crate: roundtrip save/load, list/count, fingerprint similarity
- Distiller: compression ratio, copy block extraction, checkpoint extraction, cost reduction
- Judge: perfect replay verdict, critical divergence, minor divergence, checkpoint pass/fail, double-finalize guard

## Related Projects

- [nodebench-ai](../nodebench_ai4/nodebench-ai/) -- NodeBench MCP server (350 tools)
