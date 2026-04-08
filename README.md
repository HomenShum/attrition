# nodebench-qa

**Full-stack QA platform for AI coding agents.** Rust-powered, MCP-native.

AI agents re-crawl apps from scratch on every QA run — 31K tokens, 254 seconds each time. nodebench-qa gives agents *memory*: replay saved workflows at 60-70% fewer tokens.

> Rust rewrite of [retention.sh](https://github.com/Homen-ta/retention). Same concept, ground-up reimplementation in Rust + React.

## Quick Start

```bash
# Install the CLI
cargo install nodebench-qa-cli

# Run a QA check
nbqa check http://localhost:3000

# Start the full server (API + MCP)
nbqa serve

# Run a UX audit
nbqa audit http://localhost:3000

# Generate a sitemap
nbqa sitemap http://localhost:3000

# Run the full pipeline
nbqa pipeline http://localhost:3000
```

## MCP Tools

Use from Claude Code, Cursor, Windsurf, or any MCP-compatible agent:

| Tool | Description |
|------|-------------|
| `nbqa.check` | Full QA check — JS errors, a11y, rendering, performance |
| `nbqa.sitemap` | Crawl and generate interactive sitemap |
| `nbqa.ux_audit` | 21-rule UX audit with scoring |
| `nbqa.diff_crawl` | Before/after comparison crawl |
| `nbqa.workflow` | Start workflow recording for trajectory replay |
| `nbqa.pipeline` | Full QA pipeline: crawl, analyze, test, verify, report |

### MCP Configuration

Add to your `.mcp.json` or Claude Code settings:

```json
{
  "mcpServers": {
    "nodebench-qa": {
      "command": "nbqa",
      "args": ["serve", "--mcp"]
    }
  }
}
```

## Architecture

8-crate Rust workspace + React frontend:

```
nodebench-qa/
  rust/crates/
    core/          Core types, config, error handling
    api/           Axum HTTP API server
    mcp-server/    MCP protocol (JSON-RPC over HTTP)
    qa-engine/     Browser automation, crawling, audits
    agents/        Multi-agent orchestration (OAVR pattern)
    cli/           CLI binary (nbqa)
    telemetry/     Structured logging, tracing
    sdk/           Rust SDK for external consumers
  frontend/        React 19 + Vite + TypeScript
```

### Key Differences from retention.sh

| Aspect | retention.sh | nodebench-qa |
|--------|-------------|--------------|
| Language | Python (FastAPI) | Rust (Axum) |
| Frontend | React 19 + Vite | React 19 + Vite (kept) |
| Agent SDK | OpenAI Agents SDK | Native Rust agents |
| MCP | Node.js (`ta-studio-mcp`) | Rust (`nodebench-qa-mcp`) |
| CLI | Node.js (`retention`) | Rust (`nbqa`) |
| Binary | `retention` | `nbqa` |
| Config dir | N/A | `~/.nodebench-qa/` |
| Tool prefix | `ta.*` | `nbqa.*` |

## Development

### Prerequisites

- Rust 1.85+ (2024 edition)
- Node.js 22+
- Chrome/Chromium (for browser automation)

### Build

```bash
# Build all Rust crates
cargo build --workspace

# Build release binary
cargo build --release -p nodebench-qa-cli

# Run tests
cargo test --workspace

# Frontend dev
cd frontend && npm install && npm run dev
```

### Dev Server

```bash
# Start API + MCP server
nbqa serve --port 8100

# Frontend dev server (proxies to API)
cd frontend && npm run dev
```

## Parity Tracking

See [PARITY.md](PARITY.md) for behavioral parity status against retention.sh.

## License

MIT

## Disclaimer

This project is a ground-up Rust rewrite inspired by [retention.sh](https://github.com/Homen-ta/retention). It is not affiliated with, endorsed by, or maintained by Tests Assured / TA Studios.
