# Behavioral Parity: retention.sh -> nodebench-qa

Tracks which retention.sh features have been reimplemented in the Rust rewrite.

## MCP Tools

| retention.sh Tool | nodebench-qa Tool | Status | Notes |
|-------------------|-------------------|--------|-------|
| `ta.qa_check(url)` | `nbqa.check` | Implemented | HTTP-level checks; browser automation pending |
| `ta.sitemap(url)` | `nbqa.sitemap` | Implemented | BFS crawl with link extraction |
| `ta.ux_audit(url)` | `nbqa.ux_audit` | Implemented | 21 rules, 8 fully checked, 13 need browser |
| `ta.diff_crawl(url)` | `nbqa.diff_crawl` | Implemented | Baseline storage pending |
| `ta.start_workflow(url)` | `nbqa.workflow` | Scaffold | Recording needs browser automation |
| `ta.team.invite` | — | Not started | Team collaboration |
| — | `nbqa.pipeline` | New | Full QA pipeline (not in retention.sh) |

## API Endpoints

| retention.sh | nodebench-qa | Status |
|-------------|-------------|--------|
| `POST /api/qa` | `POST /api/qa/check` | Implemented |
| `POST /api/sitemap` | `POST /api/qa/sitemap` | Implemented |
| `POST /api/ux-audit` | `POST /api/qa/ux-audit` | Implemented |
| `POST /api/diff-crawl` | `POST /api/qa/diff-crawl` | Implemented |
| `GET /health` | `GET /health` | Implemented |
| `POST /api/mcp` (JSON-RPC) | `POST /mcp` | Implemented |
| WebSocket streaming | — | Not started |
| Agent coordination | — | Scaffold |

## CLI Commands

| retention.sh | nodebench-qa | Status |
|-------------|-------------|--------|
| `retention` (reads logs) | `nbqa info` | Partial |
| — | `nbqa serve` | New |
| — | `nbqa check <url>` | Implemented |
| — | `nbqa sitemap <url>` | Implemented |
| — | `nbqa audit <url>` | Implemented |
| — | `nbqa diff <url>` | Implemented |
| — | `nbqa pipeline <url>` | Implemented |
| — | `nbqa health` | Implemented |

## Agent System

| retention.sh | nodebench-qa | Status |
|-------------|-------------|--------|
| Coordinator (GPT-5) | `Coordinator` struct | Scaffold |
| Search Assistant | — | Not started |
| Test Generation Specialist | — | Not started |
| Device Testing Specialist | — | Not started |
| OAVR sub-agents | `oavr` module types | Types only |
| QA Pipeline (6 stages) | `pipeline::run_pipeline` | Implemented |
| Golden Bug system | — | Not started |
| Trajectory replay | `workflow::replay_workflow` | Scaffold |

## Frontend

| retention.sh | nodebench-qa | Status |
|-------------|-------------|--------|
| Landing page | `Landing.tsx` | Implemented |
| Dashboard | `Dashboard.tsx` | Implemented |
| Results page | `Results.tsx` | Scaffold |
| Emulator HUD | — | Not started |
| Demo pages | — | Not started |
| Admin pages | — | Not started |

## Infrastructure

| retention.sh | nodebench-qa | Status |
|-------------|-------------|--------|
| Fly.io deploy | — | Not configured |
| Render deploy | — | Not configured |
| Vercel frontend | — | Not configured |
| Docker | — | Not yet |
| Convex backend | — | Not planned (Rust-native) |
| LangSmith tracing | `tracing` crate | Different approach |

## Browser Automation

| Capability | Status |
|-----------|--------|
| Playwright (Python) -> chromiumoxide (Rust) | Dependency added, not wired |
| Screenshot capture | Pending browser integration |
| Console log capture | Pending browser integration |
| Network request capture | Pending browser integration |
| Mobile viewport testing | Pending browser integration |
| Real-time frame streaming | Not started |

## Legend
- **Implemented** — Feature works end-to-end
- **Scaffold** — Types and structure exist, logic is stubbed
- **Types only** — Rust types defined, no runtime behavior
- **Not started** — No code exists yet
- **Not planned** — Deliberately excluded from rewrite
