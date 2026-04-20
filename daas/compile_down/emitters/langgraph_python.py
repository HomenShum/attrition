"""LangGraph emitter — translate WorkflowSpec into a StateGraph."""

from __future__ import annotations

from typing import Any

from daas.compile_down.artifact import ArtifactBundle


DEFAULT_TARGET_MODEL = "gpt-4o-mini"


def emit_bundle(spec: Any, *, target_model: str | None = None) -> ArtifactBundle:
    model = target_model or DEFAULT_TARGET_MODEL
    trace_id = getattr(spec, "source_trace_id", "unknown")
    orchestrator_prompt = getattr(spec, "orchestrator_system_prompt", "") or "you are helpful"
    workers = list(getattr(spec, "workers", []) or [])

    bundle = ArtifactBundle(runtime_lane="langgraph_python", target_model=model)
    bundle.add("graph.py", _graph_py(model, orchestrator_prompt, workers, trace_id), "python")
    bundle.add("state.py", _state_py(), "python")
    bundle.add("runner.py", _runner_py(), "python")
    bundle.add("requirements.txt", "langgraph>=0.6.0\nlangchain-core>=0.3.0\nlangchain-openai>=0.2.0\n", "text")
    bundle.add("README.md", _readme_md(trace_id, model, workers), "markdown")
    return bundle


def _safe(s: str) -> str:
    return repr(s)


def _snake(s: str) -> str:
    return s.lower().replace(" ", "_").replace("-", "_").replace(".", "_")


def _graph_py(model: str, prompt: str, workers: list[Any], trace_id: str) -> str:
    worker_names = [
        w.get("name") if isinstance(w, dict) else getattr(w, "name", None)
        for w in workers
    ]
    worker_names = [_snake(n) for n in worker_names if n]
    if not worker_names:
        worker_names = ["executor"]

    nodes = "\n\n".join(
        f'def {n}_node(state: GraphState) -> GraphState:\n'
        f'    """Worker node: {n}"""\n'
        f'    llm = ChatOpenAI(model=MODEL, temperature=0)\n'
        f'    msg = llm.invoke([\n'
        f'        {{"role": "system", "content": SYSTEM_PROMPT}},\n'
        f'        {{"role": "user", "content": state["query"]}},\n'
        f'    ])\n'
        f'    new_scratch = dict(state.get("scratchpad", {{}}))\n'
        f'    new_scratch["{n}"] = msg.content\n'
        f'    return {{**state, "scratchpad": new_scratch}}'
        for n in worker_names
    )
    add_nodes = "\n".join(f'    graph.add_node("{n}", {n}_node)' for n in worker_names)
    chain_edges = "\n".join(
        f'    graph.add_edge("{a}", "{b}")'
        for a, b in zip(worker_names, worker_names[1:])
    )
    first = worker_names[0]
    last = worker_names[-1]
    return f'''"""LangGraph translation — distilled from trace {trace_id}."""

from __future__ import annotations

from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph

from state import GraphState

MODEL = "{model}"
SYSTEM_PROMPT = {_safe(prompt)}


{nodes}


def compaction_node(state: GraphState) -> GraphState:
    """Final compaction — orchestrator-style. Produces `final_answer`."""
    scratch = state.get("scratchpad", {{}})
    compacted = "\\n\\n".join(f"### {{k}}\\n{{v}}" for k, v in scratch.items())
    llm = ChatOpenAI(model=MODEL, temperature=0)
    msg = llm.invoke([
        {{"role": "system", "content": SYSTEM_PROMPT + " Compact worker outputs into a single answer."}},
        {{"role": "user", "content": state["query"] + "\\n\\nWORKER OUTPUTS:\\n" + compacted}},
    ])
    return {{**state, "final_answer": msg.content}}


def build_graph() -> StateGraph:
    graph = StateGraph(GraphState)
{add_nodes}
    graph.add_node("compaction", compaction_node)
    graph.add_edge(START, "{first}")
{chain_edges}
    graph.add_edge("{last}", "compaction")
    graph.add_edge("compaction", END)
    return graph.compile()


app = build_graph()


def run(query: str) -> dict:
    out = app.invoke({{"query": query, "scratchpad": {{}}}})
    return {{"final_answer": out.get("final_answer", ""), "state": out}}
'''


def _state_py() -> str:
    return '''"""Shared graph state — TypedDict per LangGraph convention."""

from typing import Any, TypedDict


class GraphState(TypedDict, total=False):
    query: str
    scratchpad: dict[str, Any]
    final_answer: str
'''


def _runner_py() -> str:
    return '''"""CLI entry — runs the compiled LangGraph."""

import argparse
from graph import run


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


def _readme_md(trace_id: str, model: str, workers: list[Any]) -> str:
    worker_names = [w.get("name") if isinstance(w, dict) else getattr(w, "name", "?") for w in workers]
    return f'''# LangGraph translation — trace `{trace_id}`

Target model: `{model}` via langchain-openai. Replace with any
LangChain-compatible chat model.

## Nodes
{chr(10).join(f"- `{n}`" for n in worker_names) or "- `executor` (default single-worker pipeline)"}
- `compaction` (final answer assembly)

## Run

```bash
pip install -r requirements.txt
export OPENAI_API_KEY=...
python runner.py --query "..."
```
'''
