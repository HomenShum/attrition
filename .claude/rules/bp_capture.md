# Auto-Capture Workflows

When a complex multi-step coding task completes (3+ tool calls, file edits, or test cycles), suggest capturing it as a replayable workflow.

## When to suggest

- After completing a multi-file refactor, feature implementation, or bug fix
- After a test-fix-verify cycle that succeeded
- After any task involving 5+ sequential tool calls
- When the user says "save this workflow" or "capture this session"

## How to capture

1. Locate the Claude Code session JSONL file (usually in `~/.claude/sessions/`)
2. Run: `bp capture <path-to-session.jsonl> --name "descriptive-name"`
3. Report the workflow ID and event count
4. Suggest distillation if the workflow has 20+ events: `bp distill <id> --target claude-sonnet-4-20250514`

## Why capture

- Frontier model workflows are ephemeral -- once the session ends, the reasoning and tool sequence are lost
- Captured workflows can be replayed on cheaper models (60-70% token savings)
- The judge engine verifies replay correctness, catching divergences before they cause bugs
- Workflow fingerprints detect duplicate patterns across sessions

## Do not capture

- Simple single-file edits or typo fixes
- Conversations that are purely Q&A with no tool usage
- Sessions where the user explicitly asked not to save
