# attrition

**Workflow Memory + Distillation Engine.** Capture frontier model workflows, distill for cheaper replay.

AI coding agents produce brilliant multi-step workflows -- refactors, bug fixes, feature builds -- then throw them away. attrition captures these workflows, distills them by eliminating redundant steps, and replays them on cheaper models at 60-70% lower token cost. A judge engine verifies replay correctness in real time.

> Rust workspace with MCP protocol support. Works with Claude Code, Cursor, Windsurf, and any MCP-compatible agent.

## Quick Start

```bash
# Install
cargo install attrition-cli

# Capture a Claude Code session
bp capture ~/.claude/sessions/session.jsonl --name "auth-refactor"

# Distill for cheaper replay
bp distill <workflow-id> --target claude-sonnet-4-20250514

# Start the MCP server
bp serve

# Run a QA check
bp check http://localhost:3000

# List captured workflows
bp workflows
```

## Architecture

12-crate Rust workspace:

```
attrition/
  rust/crates/
    core/          Core types, config, error handling
    api/           Axum HTTP API server
    mcp-server/    MCP protocol (JSON-RPC over HTTP), 12 tools
    qa-engine/     Browser automation, crawling, UX audit
    agents/        Multi-agent orchestration (OAVR pattern)
    cli/           CLI binary (bp), 11 subcommands
    telemetry/     Structured logging via tracing
    sdk/           Rust SDK client for external consumers
    workflow/      Canonical event stream capture + SQLite storage
    distiller/     4-strategy workflow distillation engine
    judge/         Replay judgment engine (verdict + nudge + attention)
    llm-client/    Anthropic Messages API client
```

### How It Works

```
  Claude Code session (.jsonl)
         |
    bp capture         --> Canonical event stream --> SQLite
         |
    bp distill         --> Eliminate redundant steps
         |                 Extract copy-paste blocks
         |                 Compress reasoning
         |                 Insert checkpoints
         |
    bp judge           --> Compare expected vs actual
         |                 Issue nudges on divergence
         |                 Produce verdict (correct/partial/escalate/failed)
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `bp serve` | Start API + MCP server |
| `bp check <url>` | Run QA check (JS errors, a11y, rendering, perf) |
| `bp sitemap <url>` | Crawl and generate sitemap |
| `bp audit <url>` | 21-rule UX audit with scoring |
| `bp diff <url>` | Before/after comparison crawl |
| `bp pipeline <url>` | Full QA pipeline |
| `bp health` | Server health status |
| `bp info` | Version and system info |
| `bp capture <path>` | Capture Claude Code JSONL session as workflow |
| `bp workflows` | List all captured workflows |
| `bp distill <id>` | Distill workflow for cheaper model replay |
| `bp judge <id>` | Start judge session for replay verification |

## MCP Tools

12 tools exposed via JSON-RPC for AI coding agents:

| Tool | Description |
|------|-------------|
| `bp.check` | Full QA check -- JS errors, a11y, rendering, performance |
| `bp.sitemap` | Crawl and generate interactive sitemap |
| `bp.ux_audit` | 21-rule UX audit with scoring |
| `bp.diff_crawl` | Before/after comparison crawl |
| `bp.workflow` | Start workflow recording for trajectory replay |
| `bp.pipeline` | Full QA pipeline: crawl, analyze, test, verify, report |
| `bp.capture` | Parse JSONL session, save as replayable workflow |
| `bp.workflows` | List all captured workflows |
| `bp.distill` | Distill workflow for cheaper model replay |
| `bp.judge.start` | Start judge session for replay verification |
| `bp.judge.event` | Report actual event, get nudge if divergent |
| `bp.judge.verdict` | Finalize session, produce verdict |

### MCP Configuration

Add to your `.mcp.json` or Claude Code settings:

```json
{
  "mcpServers": {
    "attrition": {
      "command": "bp",
      "args": ["serve", "--mcp"]
    }
  }
}
```

## Distillation Strategies

The distiller applies four strategies in sequence:

1. **Step elimination** -- Remove dead-end searches (0 results), failed retries, overwritten edits
2. **Copy-paste block extraction** -- Identify deterministic outputs (file contents, data lookups) that can be injected without LLM regeneration
3. **Context compression** -- Merge consecutive Think blocks, truncate verbose reasoning, remove summary restating
4. **Checkpoint extraction** -- Insert verification points at Assert events and file operations for replay validation

## Judge Verdicts

| Verdict | Score | Meaning |
|---------|-------|---------|
| `correct` | 1.0 | Perfect replay, all checkpoints pass |
| `partial` | 0.5-1.0 | Minor divergences, replay mostly correct |
| `escalate` | -- | Too many major divergences, human review needed |
| `failed` | -- | Critical divergences, replay produced incorrect results |

## Development

### Prerequisites

- Rust 1.85+ (2024 edition)
- Node.js 22+ (frontend)
- Chrome/Chromium (browser automation)

### Build

```bash
cargo build --workspace          # Build all 12 crates
cargo test --workspace           # Run all tests
cargo build --release -p attrition-cli  # Release binary
```

### Dev Server

```bash
bp serve --port 8100             # API on 8100, MCP on 8101
cd frontend && npm run dev       # Frontend dev server on 5173
```

## License

MIT
