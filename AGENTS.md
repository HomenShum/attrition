# nodebench-qa Agent Architecture

## Overview

Hierarchical multi-agent QA system. Coordinator routes tasks to specialist agents. Each specialist follows the OAVR (Observe-Act-Verify-Reason) pattern.

## Agent Hierarchy

```
Coordinator
  |
  +-- QA Pipeline Agent
  |     +-- Crawl Stage
  |     +-- Analyze Stage
  |     +-- Test Generate Stage
  |     +-- Execute Stage
  |     +-- Verify Stage
  |     +-- Report Stage
  |
  +-- Crawl Agent
  |     +-- BFS Crawler
  |     +-- Link Extractor
  |     +-- Screenshot Capturer
  |
  +-- Workflow Agent
  |     +-- Recorder
  |     +-- Trajectory Cache
  |     +-- Replay Engine
  |
  +-- Device Testing Agent (future)
        +-- Screen Classifier (OAVR)
        +-- Action Verifier (OAVR)
        +-- Failure Diagnosis (OAVR)
        +-- Bug Reproducer (OAVR)
```

## OAVR Pattern

Every sub-agent follows a 4-phase cycle:

1. **Observe** — Capture current state (screenshot, DOM, network requests)
2. **Act** — Execute an action (click, type, navigate, scroll)
3. **Verify** — Confirm action produced expected results
4. **Reason** — Decide next action based on verification outcome

Decisions: `Continue`, `Retry`, `Escalate`, `Complete`, `Abort`

## Task Routing

The Coordinator classifies incoming tasks and routes to the appropriate specialist:

| Task Type | Routed To |
|-----------|-----------|
| `QaCheck`, `UxAudit` | QA Pipeline Agent |
| `Sitemap`, `DiffCrawl` | Crawl Agent |
| `WorkflowRecord`, `WorkflowReplay` | Workflow Agent |
| `DeviceTest` | Device Testing Agent |
| `CustomPipeline` | Custom Pipeline |

## QA Pipeline Stages

1. **Crawl** — Discover all pages via BFS
2. **Analyze** — Run QA checks on each page
3. **Test Generate** — Generate test cases from discovered issues
4. **Execute** — Run test cases
5. **Verify** — Verify test results
6. **Report** — Aggregate and format results

## Trajectory Replay

The key cost-saving mechanism:

1. Record workflow steps (navigate, click, type, assert)
2. Cache deterministic steps (navigate, screenshot, wait)
3. On replay, skip cached steps — only re-execute non-deterministic ones
4. Target: 60-70% token savings on repeat runs

## Crate Map

- `rust/crates/agents/src/coordinator.rs` — Task routing, agent lifecycle
- `rust/crates/agents/src/pipeline.rs` — QA pipeline (6 stages)
- `rust/crates/agents/src/oavr.rs` — OAVR pattern types
- `rust/crates/qa-engine/src/workflow.rs` — Workflow recording and replay
