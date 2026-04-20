"""LangGraph graph -> WorkflowSpec import.

Unlike Claude Code / Cursor which are SESSION/trace-based, LangGraph
is structural: users describe a directed graph of nodes + edges. We
import the structure (not a specific run) into a WorkflowSpec so
emitters can retarget to e.g. OpenAI Agents SDK.

Input shape — LangGraph `get_graph()` dump:
  {
    "nodes": [{"id": "...", "name": "...", "metadata": {...}}, ...],
    "edges": [{"source": "...", "target": "...", "conditional": bool}, ...]
  }
"""

from __future__ import annotations

from typing import Any

from daas.schemas import HandoffRule, WorkflowSpec, Worker


def from_langgraph_graph(
    graph: dict[str, Any],
    *,
    source_trace_id: str = "langgraph_import",
    target_executor_model: str = "gemini-3.1-flash-lite-preview",
) -> WorkflowSpec:
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []

    workers: list[Worker] = []
    for n in nodes:
        if not isinstance(n, dict):
            continue
        node_id = n.get("id") or n.get("name")
        if not node_id or node_id in ("__start__", "__end__", "START", "END"):
            continue
        workers.append(
            Worker(
                name=str(node_id),
                role=str(n.get("role") or (n.get("metadata") or {}).get("role") or "worker"),
                model=target_executor_model,
                system_prompt=str((n.get("metadata") or {}).get("system_prompt") or ""),
                tools=list((n.get("metadata") or {}).get("tools") or []),
            )
        )

    handoffs: list[HandoffRule] = []
    for e in edges:
        if not isinstance(e, dict):
            continue
        source = str(e.get("source") or "")
        target = str(e.get("target") or "")
        if not source or not target:
            continue
        if source in ("__start__", "START") or target in ("__end__", "END"):
            continue
        handoffs.append(
            HandoffRule(
                from_agent=source,
                to_agent=target,
                trigger=str(e.get("condition") or "sequential"),
                payload_schema={},
            )
        )

    return WorkflowSpec(
        source_trace_id=source_trace_id,
        executor_model=target_executor_model,
        orchestrator_system_prompt=(
            "You are the orchestrator, translating a LangGraph pipeline. "
            "Route work through the declared workers in order defined by handoffs."
        ),
        workers=workers,
        tools=[],
        handoffs=handoffs,
        target_sdk="langgraph",
    )
