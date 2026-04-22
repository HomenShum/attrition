# claude_agent_sdk — Anthropic Claude Agent SDK (Python)

## When to pick this lane

- User wants the canonical Claude Code shape: `ClaudeSDKClient` +
  `@tool` decorator + in-process MCP server for custom tools.
- Target model is Claude Opus 4.7 ($5/$25) or Sonnet 4.6 ($3/$15).
- Long-horizon / compaction-heavy work where Claude's own context
  management pays off.

## References

- PyPI: `claude-agent-sdk`
- GitHub: `github.com/anthropics/claude-agent-sdk-python`
- Docs: `platform.claude.com/docs/en/agent-sdk/python`
- Cookbook: `github.com/anthropics/claude-cookbooks/tree/main/claude_agent_sdk`
  — canonical patterns: one-liner research · chief-of-staff ·
  observability · site-reliability · migrating from OpenAI Agents SDK
  · session browser.

## Six canonical shapes (from Anthropic's cookbook)

Pick one to follow based on the user's intent. Each shape is a
validated starting point; the agent should match this structure
rather than inventing a new one.

1. **One-liner research agent** — minimal `query()` + WebSearch +
   Read. For "gather and synthesize" tasks. Single agent loop.
2. **Chief-of-staff agent** — CLAUDE.md for persistent instructions,
   output styles per audience, plan mode before execution, slash
   commands for user shortcuts, hooks for audit trails, subagents
   for domain specialization.
3. **Observability agent** — MCP server (Git, GitHub, or similar)
   for read-only external system access. CI/CD monitoring shape.
4. **Site-reliability agent** — MCP server with read-write tools
   (metrics, configs, services). PreToolUse hooks for safety
   validation. End-to-end incident lifecycle.
5. **OpenAI migration agent** — faithful port from openai-agents
   patterns (Runner.run_sync, @function_tool) to ClaudeSDKClient
   + @tool + create_sdk_mcp_server. Same tool boundaries, different
   SDK.
6. **Session browser** — reads and replays prior session transcripts,
   used for debugging long-running agent chains.

## Files the agent should write

```
agent.py          main script: create tools via @tool, build SDK MCP
                  server, instantiate ClaudeSDKClient with ClaudeAgentOptions
tools.py          @tool-decorated functions (one per capability)
requirements.txt  claude-agent-sdk>=0.1.0 ; python_version>='3.10'
README.md         ANTHROPIC_API_KEY setup + allowed_tools list
run.sh            wraps `python agent.py`
.env.example      ANTHROPIC_API_KEY
workflow_spec.json
eval/             scenarios.py + rubric.py
```

## agent.py spine

```python
from __future__ import annotations
import asyncio, os
from claude_agent_sdk import (
    ClaudeSDKClient, ClaudeAgentOptions, create_sdk_mcp_server, tool,
)

@tool("lookup_sku", "Look up SKU by id", {"type": "object",
      "properties": {"id": {"type": "string"}}, "required": ["id"]})
async def lookup_sku(args: dict) -> dict:
    # user wires live endpoint; mock-mode returns stub
    mode = os.environ.get("CONNECTOR_MODE", "mock")
    if mode == "mock":
        return {"content": [{"type": "text", "text": '{"price": 10}'}]}
    raise NotImplementedError("wire live endpoint")

server = create_sdk_mcp_server(
    name="attrition-tools", version="1.0.0", tools=[lookup_sku],
)

options = ClaudeAgentOptions(
    mcp_servers={"attrition": server},
    allowed_tools=["mcp__attrition__lookup_sku"],
    system_prompt="You are an ops analyst. Use tools to answer.",
    model=os.environ.get("ATTRITION_MODEL", "claude-sonnet-4.6"),
)

async def main():
    async with ClaudeSDKClient(options=options) as client:
        await client.query("Find SKU X123")
        async for msg in client.receive_response():
            print(msg)

if __name__ == "__main__":
    asyncio.run(main())
```

## Key invariants

- `allowed_tools` MUST list every tool we want the agent to call, by
  prefixed MCP name (`mcp__<server>__<tool>`). Omitting = Claude
  refuses to call it.
- Every `@tool` function MUST return the SDK's structured content
  shape (`{"content": [{"type": "text", "text": "..."}]}`).
- Async throughout. Use `asyncio.run` at the entrypoint.

## Optional shape upgrades (from the cookbook, in priority order)

Only add these if the declared workflow genuinely needs them — do
not over-emit. Each adds real structure and real token cost.

### Hooks for safety (PreToolUse)

For lanes where the agent writes or mutates state (incident
response, ops), add a PreToolUse hook that validates args before
the tool runs. Cookbook pattern from notebook 03 (SRE agent):

```python
from claude_agent_sdk import ClaudeAgentOptions, HookEvent

def validate_pool_size(event: HookEvent) -> HookEvent:
    args = event.tool_input or {}
    pool = args.get("pool_size")
    if pool is not None and not (5 <= int(pool) <= 500):
        raise ValueError(f"pool_size {pool!r} out of range 5..500")
    return event

options = ClaudeAgentOptions(
    ...,
    hooks={"PreToolUse": [validate_pool_size]},
)
```

### CLAUDE.md for persistent instructions

For chief-of-staff / domain-expert agents, persist context across
runs via a `CLAUDE.md` in the working directory. The SDK auto-loads
it. Ship a scaffolded one:

```markdown
# CLAUDE.md
You are the on-call engineer for <service>. Always check the
runbook at runbooks/ first. If the metric is X, escalate with
Y. Use the `notify` tool only when threshold Z is breached.
```

### Subagent orchestration

For multi-domain work (finance + legal + ops), spawn specialized
subagents via `client.query()` with narrowed `allowed_tools`
and `system_prompt`. Each subagent gets fresh context, returns a
compacted result to the parent.

### Bash tool for procedural knowledge

Register Python scripts the agent can `bash`-exec for deterministic
computations (amortization schedules, PII redaction, spreadsheet
manipulation). Keeps reasoning separate from execution.

### Output styles per audience

Tailor the system prompt variant to the consumer: terse JSON for
downstream tools, markdown memo for humans, SQL for a BI layer.
Switch at the `ClaudeAgentOptions` level, not mid-stream.

## Known failure modes

- Forgetting `ANTHROPIC_API_KEY` → silent hang at `query()`. Add
  explicit env check at main().
- Tool returns non-structured dict → SDK raises. Wrap everything
  in `{"content": [{"type": "text", "text": json.dumps(result)}]}`.
- Missing `allowed_tools` entry → Claude will refuse to call the
  tool and emit a "sorry I can't do that" response. Always enumerate.
- PreToolUse hook that raises → run terminates. If the hook is
  advisory, log + return event unchanged; only raise on hard-block
  conditions.

## Eval criteria

- `python agent.py` starts without error when ANTHROPIC_API_KEY set.
- Mock-mode returns structured content for every declared tool.
- `ast.parse(agent.py)` + `ast.parse(tools.py)` both clean.
- If hooks are declared, `HookEvent` is imported and the hook
  function signature matches `(event: HookEvent) -> HookEvent`.
- If CLAUDE.md is emitted, it's under 2KB and contains at least
  one verb-imperative line ("Always...", "Use...", "Escalate...").
