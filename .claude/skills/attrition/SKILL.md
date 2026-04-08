---
name: attrition
description: Capture, distill, and replay coding agent workflows
triggers: ["bp", "attrition", "capture workflow", "distill", "judge", "replay workflow"]
---

# Attrition -- Workflow Memory + Distillation

Capture frontier model workflows, distill them for cheaper replay, and judge replay correctness.

## Core Workflow

### 1. Capture a session

After a coding session completes, capture it into a replayable workflow:

```
bp capture ~/.claude/sessions/<session-id>.jsonl --name "feature-auth-flow" --model claude-opus-4-6
```

Or via MCP tool:
```json
{"tool": "bp.capture", "arguments": {"session_path": "/path/to/session.jsonl", "name": "feature-auth-flow"}}
```

### 2. List captured workflows

```
bp workflows
```

Or via MCP: `bp.workflows` (no arguments)

### 3. Distill for cheaper replay

Compress a workflow for replay on a cheaper model:

```
bp distill <workflow-id> --target claude-sonnet-4-20250514
```

Or via MCP:
```json
{"tool": "bp.distill", "arguments": {"workflow_id": "abc123", "target_model": "claude-sonnet-4-20250514"}}
```

This produces:
- Compressed event stream (redundant steps eliminated)
- Copy-paste blocks (deterministic content injected without LLM regeneration)
- Verification checkpoints (assertions to validate during replay)
- Cost estimate for the target model

### 4. Judge a replay

Start a judge session to verify replay correctness:

```json
{"tool": "bp.judge.start", "arguments": {"workflow_id": "abc123", "replay_model": "claude-sonnet-4-20250514"}}
```

During replay, report each actual event:

```json
{"tool": "bp.judge.event", "arguments": {"session_id": "<from-start>", "event": {"type": "tool_call", "tool": "Bash", "args": {"command": "cargo test"}, "result": {"output": "ok"}, "duration_ms": 1000}}}
```

If divergence is detected, the judge returns a nudge with correction hints.

Finalize to get the verdict:

```json
{"tool": "bp.judge.verdict", "arguments": {"session_id": "<from-start>"}}
```

## Verdicts

| Verdict | Meaning | Action |
|---------|---------|--------|
| `correct` | Perfect replay match | Ship it |
| `partial` (score > 0.8) | Minor divergences | Review divergence list |
| `partial` (score < 0.8) | Significant divergences | Investigate before shipping |
| `escalate` | Too many major divergences | Human review required |
| `failed` | Critical divergences | Do not ship -- fix or re-capture |

## MCP Tools Reference

| Tool | Description |
|------|-------------|
| `bp.capture` | Parse JSONL session, save as workflow |
| `bp.workflows` | List all captured workflows |
| `bp.distill` | Distill workflow for cheaper replay |
| `bp.judge.start` | Start judge session for replay verification |
| `bp.judge.event` | Report actual event, get nudge if divergent |
| `bp.judge.verdict` | Finalize session, produce verdict |

## Storage

Workflows are stored in SQLite at `~/.attrition/workflows.db`. The database is created automatically on first use.
