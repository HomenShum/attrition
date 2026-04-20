"""orchestrator_worker emitter — fan-out workers + compaction + handoffs.

Emits a Python package that implements the Anthropic "Building Effective
Agents" orchestrator-worker pattern: one orchestrator, N workers, shared
scratchpad, bounded handoffs. Target: google-genai by default.

Files:
  orchestrator.py  — main loop, fan-out, compaction
  workers/         — one file per worker in the spec
  tools.py         — tool allowlist + dispatch
  state.py         — scratchpad + run state
  handoffs.py      — handoff payload schemas + trigger rules
  schemas.py
  prompts.py
  runner.py        — CLI entry
  requirements.txt
  README.md
"""

from __future__ import annotations

import json
from typing import Any

from daas.compile_down.artifact import ArtifactBundle


DEFAULT_TARGET_MODEL = "gemini-3.1-flash-lite-preview"


def emit_bundle(spec: Any, *, target_model: str | None = None) -> ArtifactBundle:
    model = target_model or getattr(spec, "executor_model", None) or DEFAULT_TARGET_MODEL
    trace_id = getattr(spec, "source_trace_id", "unknown")
    workers = list(getattr(spec, "workers", []) or [])
    tools = list(getattr(spec, "tools", []) or [])
    orchestrator_prompt = getattr(spec, "orchestrator_system_prompt", "") or (
        "You are an orchestrator. Decompose the task, assign workers, compact results."
    )
    success_criteria = list(getattr(spec, "success_criteria", []) or [])
    domain_rules = list(getattr(spec, "domain_rules", []) or [])

    bundle = ArtifactBundle(runtime_lane="orchestrator_worker", target_model=model)

    bundle.add(
        "prompts.py",
        _prompts_py(orchestrator_prompt, workers, success_criteria, domain_rules, trace_id),
        "python",
    )
    bundle.add("schemas.py", _schemas_py(), "python")
    bundle.add("state.py", _state_py(), "python")
    bundle.add("tools.py", _tools_py(tools), "python")
    bundle.add("handoffs.py", _handoffs_py(workers), "python")
    bundle.add("orchestrator.py", _orchestrator_py(model), "python")
    if not workers:
        # Emit a single default "executor" worker so the package runs.
        bundle.add(
            "workers/executor.py",
            _worker_py("executor", "General-purpose task executor.", "you are an executor", []),
            "python",
        )
    else:
        for w in workers:
            name = w.get("name") if isinstance(w, dict) else getattr(w, "name", None)
            role = w.get("role") if isinstance(w, dict) else getattr(w, "role", "")
            worker_prompt = (
                w.get("system_prompt") if isinstance(w, dict) else getattr(w, "system_prompt", "")
            )
            worker_tools = (
                w.get("tools") if isinstance(w, dict) else getattr(w, "tools", [])
            ) or []
            if not name:
                continue
            bundle.add(
                f"workers/{_snake(name)}.py",
                _worker_py(name, role or "worker", worker_prompt or "", worker_tools),
                "python",
            )
    bundle.add("workers/__init__.py", "", "python")
    bundle.add("runner.py", _runner_py(model), "python")
    bundle.add("requirements.txt", "google-genai>=1.0.0\n", "text")
    bundle.add("README.md", _readme_md(trace_id, model, workers, tools), "markdown")
    return bundle


def _safe_str(s: str) -> str:
    return repr(s)


def _snake(s: str) -> str:
    return s.lower().replace(" ", "_").replace("-", "_").replace(".", "_")


def _prompts_py(
    orchestrator_prompt: str,
    workers: list[Any],
    success_criteria: list[str],
    rules: list[str],
    trace_id: str,
) -> str:
    criteria = "\n".join(f"  - {c}" for c in success_criteria) or "  (none)"
    rules_b = "\n".join(f"  - {r}" for r in rules) or "  (none)"
    full = (
        orchestrator_prompt
        + "\n\nRules:\n"
        "- Break the task into 1-4 discrete worker assignments.\n"
        "- Workers write to their own section of the scratchpad; you compact at the end.\n"
        "- Only you emit the final answer to the user."
    )
    return (
        f'"""Distilled prompts from trace {trace_id}.\n\n'
        f'Success criteria:\n{criteria}\n\n'
        f'Domain rules:\n{rules_b}\n"""\n\n'
        f'ORCHESTRATOR_SYSTEM_PROMPT = {_safe_str(full)}\n'
    )


def _schemas_py() -> str:
    return '''"""I/O schemas for the orchestrator-worker runtime."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class RunInput:
    query: str
    context: dict[str, Any] = field(default_factory=dict)


@dataclass
class WorkerAssignment:
    worker: str
    task: str
    tools_allowed: list[str] = field(default_factory=list)


@dataclass
class WorkerOutput:
    worker: str
    content: str
    tool_calls: list = field(default_factory=list)
    cost_usd: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class RunOutput:
    final_answer: str
    worker_outputs: list[WorkerOutput] = field(default_factory=list)
    total_cost_usd: float = 0.0
    total_tokens: int = 0
    duration_ms: int = 0
'''


def _state_py() -> str:
    return '''"""Shared scratchpad — workers write, orchestrator reads on compaction."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Scratchpad:
    sections: dict[str, list[str]] = field(default_factory=dict)

    def append(self, worker: str, text: str) -> None:
        self.sections.setdefault(worker, []).append(text)

    def read(self, worker: str) -> list[str]:
        return list(self.sections.get(worker, []))

    def compact(self) -> str:
        parts: list[str] = []
        for worker, entries in self.sections.items():
            parts.append(f"### {worker}\\n" + "\\n".join(entries))
        return "\\n\\n".join(parts)
'''


def _handoffs_py(workers: list[Any]) -> str:
    names = [
        (w.get("name") if isinstance(w, dict) else getattr(w, "name", None))
        for w in workers
    ]
    names = [n for n in names if n]
    if not names:
        names = ["executor"]
    literal = " | ".join(f'"{n}"' for n in names)
    return f'''"""Handoff payload + triggers. Orchestrator uses this to route to workers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

WorkerName = Literal[{literal}]


@dataclass
class Handoff:
    target: WorkerName
    task: str
    payload: dict
    reason: str  # why this handoff is warranted
'''


def _tools_py(tools: list[Any]) -> str:
    decls: list[dict[str, Any]] = []
    handlers: list[str] = []
    for t in tools:
        name = t.get("name") if isinstance(t, dict) else getattr(t, "name", None)
        purpose = t.get("purpose") if isinstance(t, dict) else getattr(t, "purpose", "")
        if not name:
            continue
        decls.append(
            {
                "name": name,
                "description": str(purpose)[:512],
                "parameters": {"type": "OBJECT", "properties": {}},
            }
        )
        handlers.append(name)
    decls_json = json.dumps(decls, indent=2)
    stubs = "\n\n".join(
        f'def _stub_{_snake(n)}(args: dict) -> dict:\n    """TODO: implement tool {n}."""\n    return {{"status": "not_implemented", "tool": "{n}", "args": args}}'
        for n in handlers
    ) or "# No tools in distilled spec — add handlers when they are introduced."
    handler_map = ",\n    ".join(f'"{n}": _stub_{_snake(n)}' for n in handlers) or ""
    return f'''"""Tool declarations + dispatch. Used by every worker."""

from typing import Any, Callable

GEMINI_TOOLS = [
    {{"functionDeclarations": {decls_json}}}
]

{stubs}


HANDLERS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {{
    {handler_map}
}}


def dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
    fn = HANDLERS.get(name)
    if fn is None:
        return {{"error": f"no handler for tool '{{name}}'"}}
    return fn(args)
'''


def _worker_py(name: str, role: str, prompt: str, tools: list[str]) -> str:
    prompt = prompt or f"You are the {name} worker. Role: {role}. Be concise and factual."
    tools_list = ", ".join(f'"{t}"' for t in tools) if tools else ""
    return f'''"""Worker: {name} ({role})."""

from __future__ import annotations

WORKER_NAME = "{name}"
WORKER_ROLE = "{role}"
WORKER_SYSTEM_PROMPT = {_safe_str(prompt)}
WORKER_TOOLS = [{tools_list}]
'''


def _orchestrator_py(model: str) -> str:
    return f'''"""Orchestrator loop — fan-out, compaction, final answer."""

from __future__ import annotations

import json
import os
import time
import urllib.request

from prompts import ORCHESTRATOR_SYSTEM_PROMPT
from schemas import RunInput, RunOutput, WorkerOutput
from state import Scratchpad
from tools import GEMINI_TOOLS, dispatch

MODEL = "{model}"
MAX_WORKER_TURNS = 3


def _gemini_key() -> str:
    k = os.environ.get("GEMINI_API_KEY")
    if not k:
        raise RuntimeError("Set GEMINI_API_KEY")
    return k


def _post(url: str, body: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={{"Content-Type": "application/json"}},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def _gemini(system: str, turns: list, key: str) -> dict:
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/"
        f"models/{{MODEL}}:generateContent?key={{key}}"
    )
    body = {{
        "systemInstruction": {{"parts": [{{"text": system}}]}},
        "contents": turns,
        "tools": GEMINI_TOOLS,
        "generationConfig": {{"temperature": 0.2, "maxOutputTokens": 2048}},
    }}
    return _post(url, body)


def run(inp: RunInput) -> RunOutput:
    key = _gemini_key()
    scratch = Scratchpad()
    started = time.time()
    in_tok = out_tok = 0
    worker_outputs: list[WorkerOutput] = []

    # 1. Ask orchestrator to plan
    plan_turns = [
        {{
            "role": "user",
            "parts": [
                {{
                    "text": (
                        "Plan 1-4 worker assignments as JSON array of "
                        '{{worker, task, tools_allowed}}. Query: ' + inp.query
                    )
                }}
            ],
        }}
    ]
    plan_resp = _gemini(ORCHESTRATOR_SYSTEM_PROMPT, plan_turns, key)
    usage = plan_resp.get("usageMetadata", {{}})
    in_tok += int(usage.get("promptTokenCount", 0))
    out_tok += int(usage.get("candidatesTokenCount", 0))

    # 2. Execute each worker assignment (sequential to start — parallelize later)
    plan_text = ""
    if plan_resp.get("candidates"):
        parts = plan_resp["candidates"][0].get("content", {{}}).get("parts", [])
        plan_text = "".join(str(p.get("text", "")) for p in parts)
    scratch.append("orchestrator", f"PLAN:\\n{{plan_text}}")

    # 3. Compact + emit final answer
    compact_turns = [
        {{
            "role": "user",
            "parts": [
                {{"text": "Compact the worker outputs below into a final answer.\\n\\n" + scratch.compact() + "\\n\\nQUERY: " + inp.query}}
            ],
        }}
    ]
    final = _gemini(ORCHESTRATOR_SYSTEM_PROMPT, compact_turns, key)
    usage = final.get("usageMetadata", {{}})
    in_tok += int(usage.get("promptTokenCount", 0))
    out_tok += int(usage.get("candidatesTokenCount", 0))
    final_text = ""
    if final.get("candidates"):
        parts = final["candidates"][0].get("content", {{}}).get("parts", [])
        final_text = "".join(str(p.get("text", "")) for p in parts)

    # Flash Lite pricing
    cost = in_tok * 0.10 / 1_000_000 + out_tok * 0.40 / 1_000_000
    return RunOutput(
        final_answer=final_text,
        worker_outputs=worker_outputs,
        total_cost_usd=cost,
        total_tokens=in_tok + out_tok,
        duration_ms=int((time.time() - started) * 1000),
    )
'''


def _runner_py(model: str) -> str:
    return f'''"""CLI entry for the orchestrator-worker package."""

import argparse

from orchestrator import run
from schemas import RunInput


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--query", required=True)
    args = p.parse_args()
    out = run(RunInput(query=args.query))
    print(out.final_answer)
    print(
        f"\\n[cost ${{out.total_cost_usd:.6f}} "
        f"tokens={{out.total_tokens}} duration={{out.duration_ms}}ms]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''


def _readme_md(trace_id: str, model: str, workers: list[Any], tools: list[Any]) -> str:
    worker_names = [
        w.get("name") if isinstance(w, dict) else getattr(w, "name", "?") for w in workers
    ] or ["executor (default)"]
    tool_names = [t.get("name") if isinstance(t, dict) else getattr(t, "name", "?") for t in tools] or []
    return f'''# Orchestrator-worker scaffold — distilled from trace `{trace_id}`

Target model: `{model}`. Pattern: Anthropic "Building Effective Agents"
orchestrator-worker, one shared scratchpad, compaction at close.

## Workers
{chr(10).join(f"- `{n}`" for n in worker_names)}

## Tools
{chr(10).join(f"- `{t}`" for t in tool_names) or "_(no tools in distilled spec)_"}

## Run

```bash
pip install -r requirements.txt
export GEMINI_API_KEY=...
python runner.py --query "your question"
```

## Next steps
1. Replace each `_stub_*` in `tools.py` with a real handler.
2. Implement per-worker dispatch in `orchestrator.py` (the minimal
   version just runs plan + compact; extend to full fan-out when
   tools are real).
3. Run `daas.fidelity.cli` to verify the scaffold transfers fidelity
   from the source trace before production rollout.
'''
