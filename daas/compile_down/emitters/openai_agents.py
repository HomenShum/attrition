"""OpenAI Agents SDK emitter — translate to openai-agents-python."""

from __future__ import annotations

import json
from typing import Any

from daas.compile_down.artifact import ArtifactBundle


DEFAULT_TARGET_MODEL = "gpt-4o-mini"


def emit_bundle(spec: Any, *, target_model: str | None = None) -> ArtifactBundle:
    model = target_model or DEFAULT_TARGET_MODEL
    trace_id = getattr(spec, "source_trace_id", "unknown")
    orchestrator_prompt = getattr(spec, "orchestrator_system_prompt", "") or "you are helpful"
    tools = list(getattr(spec, "tools", []) or [])
    workers = list(getattr(spec, "workers", []) or [])

    bundle = ArtifactBundle(runtime_lane="openai_agents_sdk", target_model=model)
    bundle.add("agent.py", _agent_py(model, orchestrator_prompt, tools, workers, trace_id), "python")
    bundle.add("tools.py", _tools_py(tools), "python")
    bundle.add("runner.py", _runner_py(), "python")
    bundle.add("requirements.txt", "openai-agents>=0.1.0\nopenai>=1.0.0\n", "text")
    bundle.add("README.md", _readme_md(trace_id, model, tools), "markdown")
    return bundle


def _safe(s: str) -> str:
    return repr(s)


def _snake(s: str) -> str:
    return s.lower().replace(" ", "_").replace("-", "_").replace(".", "_")


def _agent_py(
    model: str,
    prompt: str,
    tools: list[Any],
    workers: list[Any],
    trace_id: str,
) -> str:
    tool_imports = [
        f"    {_snake(t.get('name') or getattr(t, 'name', '?'))}"
        for t in tools
        if (t.get("name") if isinstance(t, dict) else getattr(t, "name", None))
    ]
    worker_names = [
        w.get("name") if isinstance(w, dict) else getattr(w, "name", None) for w in workers
    ]
    worker_names = [w for w in worker_names if w]
    handoff_block = (
        ",\n".join(
            f'    Handoff(agent_name="{n}", tool_name_override="handoff_to_{_snake(n)}")'
            for n in worker_names
        )
        if worker_names
        else ""
    )
    handoff_import = "from agents import Handoff\n" if worker_names else ""
    handoff_section = f"\n{handoff_import}\nHANDOFFS = [\n{handoff_block}\n]\n" if worker_names else ""
    # Build the `from tools import (...)` block only when there are tools —
    # empty parens `from tools import ()` is a SyntaxError.
    if tool_imports:
        import_block = "from tools import (\n" + ",\n".join(tool_imports) + ",\n)"
        tools_list_expr = ", ".join(imp.strip() for imp in tool_imports)
    else:
        import_block = "# (no tools in distilled spec — add @function_tool fns in tools.py)"
        tools_list_expr = ""
    return f'''"""OpenAI Agents SDK translation — distilled from trace {trace_id}."""

from __future__ import annotations

from agents import Agent, Runner
{import_block}
{handoff_section}

MODEL = "{model}"
SYSTEM_PROMPT = {_safe(prompt)}

agent = Agent(
    name="compiled_agent",
    model=MODEL,
    instructions=SYSTEM_PROMPT,
    tools=[{tools_list_expr}],
)


def run(query: str) -> dict:
    result = Runner.run_sync(agent, input=query)
    return {{
        "final_answer": getattr(result, "final_output", ""),
        "raw": result,
    }}
'''


def _tools_py(tools: list[Any]) -> str:
    if not tools:
        return '''"""No tools in distilled spec. Add @function_tool-decorated functions here."""

# Example template:
# from agents import function_tool
#
# @function_tool
# def my_tool(arg: str) -> str:
#     """Tool description used by the agent."""
#     return f"result: {arg}"
'''
    fns: list[str] = []
    for t in tools:
        name = t.get("name") if isinstance(t, dict) else getattr(t, "name", None)
        purpose = t.get("purpose") if isinstance(t, dict) else getattr(t, "purpose", "")
        if not name:
            continue
        fns.append(
            f'@function_tool\n'
            f'def {_snake(name)}(args_json: str = "{{}}") -> str:\n'
            f'    """{str(purpose)[:240]}\n    """\n'
            f'    return "not_implemented: {name}"\n'
        )
    body = "\n\n".join(fns)
    return f'''"""@function_tool wrappers for every tool in the distilled spec."""

from agents import function_tool

{body}
'''


def _runner_py() -> str:
    return '''"""CLI entry for the OpenAI Agents SDK translated package."""

import argparse
from agent import run


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--query", required=True)
    args = p.parse_args()
    out = run(args.query)
    print(out["final_answer"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''


def _readme_md(trace_id: str, model: str, tools: list[Any]) -> str:
    tool_names = [t.get("name") if isinstance(t, dict) else getattr(t, "name", "?") for t in tools]
    return f'''# OpenAI Agents SDK translation — trace `{trace_id}`

Target model: `{model}`.

## Tools
{chr(10).join(f"- `{n}`" for n in tool_names) or "_(none)_"}

## Run

```bash
pip install -r requirements.txt
export OPENAI_API_KEY=...
python runner.py --query "..."
```

## Notes
- Replace every `not_implemented: <name>` return in `tools.py` with a real
  handler before rollout.
- Fidelity must be verified via `daas.fidelity.cli` against the source
  workflow's benchmarks before this replaces a live agent.
'''
