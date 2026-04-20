"""Tests for the Cycle 6 translation emitters + normalizers."""

from __future__ import annotations

import ast
import json
from pathlib import Path

import pytest

from daas.compile_down import emit, ArtifactBundle
from daas.compile_down.normalizers import (
    from_claude_code_jsonl,
    from_cursor_session,
    from_langgraph_graph,
)
from daas.schemas import WorkflowSpec


def _spec(tools=None, workers=None, rules=None) -> WorkflowSpec:
    return WorkflowSpec(
        source_trace_id="t_test",
        executor_model="gemini-3.1-flash-lite-preview",
        orchestrator_system_prompt="you are helpful",
        tools=tools or [],
        workers=workers or [],
        domain_rules=rules or [],
    )


# ---------------------------------------------------------------------------
# orchestrator_worker emitter
# ---------------------------------------------------------------------------


def test_orchestrator_worker_emits_expected_files() -> None:
    bundle = emit("orchestrator_worker", _spec())
    paths = {f.path for f in bundle.files}
    assert "orchestrator.py" in paths
    assert "state.py" in paths
    assert "tools.py" in paths
    assert "handoffs.py" in paths
    # Default executor worker present
    assert "workers/executor.py" in paths


def test_orchestrator_worker_emits_per_worker_file() -> None:
    workers = [
        {"name": "planner", "role": "planner", "system_prompt": "plan", "tools": []},
        {"name": "retriever", "role": "retriever", "system_prompt": "retrieve", "tools": ["search"]},
    ]
    bundle = emit("orchestrator_worker", _spec(workers=workers))
    paths = {f.path for f in bundle.files}
    assert "workers/planner.py" in paths
    assert "workers/retriever.py" in paths


def test_orchestrator_worker_all_python_valid() -> None:
    bundle = emit("orchestrator_worker", _spec(tools=[{"name": "fetch", "purpose": "..."}]))
    for f in bundle.files:
        if f.path.endswith(".py") and f.content:
            ast.parse(f.content)


# ---------------------------------------------------------------------------
# openai_agents_sdk emitter
# ---------------------------------------------------------------------------


def test_openai_agents_emits_agent_py() -> None:
    bundle = emit("openai_agents_sdk", _spec(tools=[{"name": "lookup", "purpose": "..."}]))
    paths = {f.path for f in bundle.files}
    assert "agent.py" in paths
    assert "tools.py" in paths


def test_openai_agents_tool_fns_decorated() -> None:
    bundle = emit("openai_agents_sdk", _spec(tools=[{"name": "add_numbers", "purpose": "sum them"}]))
    tools = next(f for f in bundle.files if f.path == "tools.py").content
    assert "@function_tool" in tools
    assert "def add_numbers" in tools
    ast.parse(tools)


def test_openai_agents_all_python_valid() -> None:
    bundle = emit("openai_agents_sdk", _spec())
    for f in bundle.files:
        if f.path.endswith(".py"):
            ast.parse(f.content)


# ---------------------------------------------------------------------------
# langgraph_python emitter
# ---------------------------------------------------------------------------


def test_langgraph_emits_graph_py() -> None:
    bundle = emit("langgraph_python", _spec())
    paths = {f.path for f in bundle.files}
    assert "graph.py" in paths
    assert "state.py" in paths
    assert "runner.py" in paths


def test_langgraph_graph_contains_compiled_entry() -> None:
    bundle = emit("langgraph_python", _spec())
    graph = next(f for f in bundle.files if f.path == "graph.py").content
    assert "build_graph" in graph
    assert "StateGraph" in graph
    ast.parse(graph)


def test_langgraph_per_worker_node() -> None:
    workers = [
        {"name": "planner", "role": "planner", "system_prompt": "", "tools": []},
        {"name": "writer", "role": "writer", "system_prompt": "", "tools": []},
    ]
    bundle = emit("langgraph_python", _spec(workers=workers))
    graph = next(f for f in bundle.files if f.path == "graph.py").content
    assert "planner_node" in graph
    assert "writer_node" in graph
    ast.parse(graph)


# ---------------------------------------------------------------------------
# Normalizers
# ---------------------------------------------------------------------------


def test_claude_code_normalizer(tmp_path: Path) -> None:
    # Build a synthetic claude-code JSONL
    lines = [
        json.dumps({"type": "user", "message": {"content": "hello"}}),
        json.dumps(
            {
                "type": "assistant",
                "message": {
                    "model": "claude-3.5-sonnet",
                    "content": [{"type": "text", "text": "hi!"}],
                    "usage": {"input_tokens": 10, "output_tokens": 3},
                },
            }
        ),
    ]
    p = tmp_path / "session.jsonl"
    p.write_text("\n".join(lines), encoding="utf-8")
    trace = from_claude_code_jsonl(p, session_id="s1")
    assert trace.session_id == "s1"
    assert trace.query == "hello"
    assert "hi!" in trace.final_answer
    assert trace.source_model == "claude-3.5-sonnet"
    assert trace.total_tokens == 13


def test_claude_code_normalizer_missing_file() -> None:
    with pytest.raises(FileNotFoundError):
        from_claude_code_jsonl("/nonexistent/file.jsonl")


def test_claude_code_normalizer_extracts_tool_calls(tmp_path: Path) -> None:
    lines = [
        json.dumps({"type": "user", "message": {"content": "search for X"}}),
        json.dumps(
            {
                "type": "assistant",
                "message": {
                    "model": "claude",
                    "content": [
                        {"type": "text", "text": "let me search"},
                        {"type": "tool_use", "name": "web_search", "input": {"q": "X"}},
                    ],
                },
            }
        ),
    ]
    p = tmp_path / "s.jsonl"
    p.write_text("\n".join(lines), encoding="utf-8")
    trace = from_claude_code_jsonl(p)
    # One assistant step, which has one tool_call
    assistant_steps = [s for s in trace.steps if s.role == "assistant"]
    assert len(assistant_steps) == 1
    assert len(assistant_steps[0].tool_calls) == 1
    assert assistant_steps[0].tool_calls[0].name == "web_search"


def test_cursor_normalizer_messages_shape() -> None:
    data = {
        "messages": [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]
    }
    trace = from_cursor_session(data, session_id="c1")
    assert trace.query == "hi"
    assert trace.final_answer == "hello"


def test_cursor_normalizer_events_shape() -> None:
    data = {
        "events": [
            {"kind": "user", "text": "run it"},
            {"kind": "assistant", "text": "done", "tool_calls": [{"name": "run", "args": {}}]},
        ]
    }
    trace = from_cursor_session(data)
    assert trace.query == "run it"
    assert any(s.tool_calls for s in trace.steps)


def test_langgraph_import_extracts_workers_and_edges() -> None:
    graph = {
        "nodes": [
            {"id": "__start__", "name": "START"},
            {"id": "planner", "metadata": {"system_prompt": "plan"}},
            {"id": "executor", "metadata": {"tools": ["run"]}},
            {"id": "__end__", "name": "END"},
        ],
        "edges": [
            {"source": "__start__", "target": "planner"},
            {"source": "planner", "target": "executor"},
            {"source": "executor", "target": "__end__"},
        ],
    }
    spec = from_langgraph_graph(graph)
    worker_names = {w.name for w in spec.workers}
    assert worker_names == {"planner", "executor"}  # START/END excluded
    assert len(spec.handoffs) == 1  # only the real planner->executor edge
    assert spec.handoffs[0].from_agent == "planner"
    assert spec.handoffs[0].to_agent == "executor"


# ---------------------------------------------------------------------------
# End-to-end: normalize -> spec -> emit (translation chain)
# ---------------------------------------------------------------------------


def test_full_translation_claude_to_openai(tmp_path: Path) -> None:
    lines = [
        json.dumps({"type": "user", "message": {"content": "build a thing"}}),
        json.dumps(
            {
                "type": "assistant",
                "message": {
                    "model": "claude",
                    "content": [
                        {"type": "text", "text": "building..."},
                        {"type": "tool_use", "name": "edit_file", "input": {"path": "x"}},
                    ],
                },
            }
        ),
    ]
    p = tmp_path / "s.jsonl"
    p.write_text("\n".join(lines), encoding="utf-8")
    trace = from_claude_code_jsonl(p)
    # Build a minimal spec from the trace
    from daas.compile_down.cli import trace_to_workflow_spec

    spec = trace_to_workflow_spec(trace.to_dict(), "gpt-4o-mini")
    bundle = emit("openai_agents_sdk", spec)
    # Tool from Claude session should be present in emitted tools.py
    tools = next(f for f in bundle.files if f.path == "tools.py").content
    assert "edit_file" in tools
    ast.parse(tools)
