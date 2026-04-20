"""Tests for the connector resolver inside emitted tool_first_chain tools.py.

Proves the runtime claim: flipping CONNECTOR_MODE changes what dispatch()
returns for a given tool. This is what the Builder UI toggle is really
plumbing into — not just a localStorage flip with no executing effect.
"""

from __future__ import annotations

import ast
import os
import tempfile
import textwrap
from pathlib import Path

import pytest

from daas.compile_down import emit
from daas.schemas import WorkflowSpec


def _spec_with_tools() -> WorkflowSpec:
    return WorkflowSpec(
        source_trace_id="conn_test",
        executor_model="gemini-3.1-flash-lite-preview",
        orchestrator_system_prompt="be useful",
        tools=[
            {"name": "lookup_sku", "purpose": "SKU lookup", "input_schema": {}},
            {"name": "place_order", "purpose": "Place an order", "input_schema": {}},
        ],
    )


def _write_and_import(tools_code: str, tmp: Path):
    """Write emitted tools.py to a tmp file and import it as a module.

    We use exec() into a dedicated namespace so no sys.path pollution.
    """
    ns: dict = {}
    exec(compile(tools_code, str(tmp / "tools.py"), "exec"), ns)
    return ns


def test_emitted_tools_py_is_syntactically_valid() -> None:
    bundle = emit("tool_first_chain", _spec_with_tools())
    tools_content = next(f for f in bundle.files if f.path == "tools.py").content
    ast.parse(tools_content)


def test_emitted_tools_has_stub_and_live_handlers() -> None:
    bundle = emit("tool_first_chain", _spec_with_tools())
    tools_content = next(f for f in bundle.files if f.path == "tools.py").content
    # Both handler maps present
    assert "STUB_HANDLERS" in tools_content
    assert "LIVE_HANDLERS" in tools_content
    # Both handler functions per tool
    assert "_stub_lookup_sku" in tools_content
    assert "_live_lookup_sku" in tools_content
    assert "_stub_place_order" in tools_content
    assert "_live_place_order" in tools_content
    # Resolver function
    assert "_resolve_handler" in tools_content


def test_dispatch_mock_mode_returns_stub_output(tmp_path: Path) -> None:
    bundle = emit("tool_first_chain", _spec_with_tools())
    tools_content = next(f for f in bundle.files if f.path == "tools.py").content

    # Force mock mode
    prev_mode = os.environ.get("CONNECTOR_MODE")
    os.environ["CONNECTOR_MODE"] = "mock"
    try:
        ns = _write_and_import(tools_content, tmp_path)
        result = ns["dispatch"]("lookup_sku", {"id": "abc"})
        assert result["status"] == "mock"
        assert result["tool"] == "lookup_sku"
        assert result["args"] == {"id": "abc"}
    finally:
        if prev_mode is None:
            os.environ.pop("CONNECTOR_MODE", None)
        else:
            os.environ["CONNECTOR_MODE"] = prev_mode


def test_dispatch_live_mode_surfaces_not_implemented(tmp_path: Path) -> None:
    bundle = emit("tool_first_chain", _spec_with_tools())
    tools_content = next(f for f in bundle.files if f.path == "tools.py").content

    prev_mode = os.environ.get("CONNECTOR_MODE")
    os.environ["CONNECTOR_MODE"] = "live"
    try:
        ns = _write_and_import(tools_content, tmp_path)
        result = ns["dispatch"]("lookup_sku", {"id": "abc"})
        # Live mode MUST hit the live handler; live handler raises
        # NotImplementedError; dispatch converts that to a
        # structured {"error": "not_implemented", ...} payload.
        assert result["error"] == "not_implemented"
        assert result["tool"] == "lookup_sku"
        assert result["mode"] == "live"
    finally:
        if prev_mode is None:
            os.environ.pop("CONNECTOR_MODE", None)
        else:
            os.environ["CONNECTOR_MODE"] = prev_mode


def test_dispatch_hybrid_mode_uses_per_tool_override(tmp_path: Path) -> None:
    bundle = emit("tool_first_chain", _spec_with_tools())
    tools_content = next(f for f in bundle.files if f.path == "tools.py").content

    prev_mode = os.environ.get("CONNECTOR_MODE")
    prev_over = os.environ.get("CONNECTOR_OVERRIDES")
    os.environ["CONNECTOR_MODE"] = "hybrid"
    # Only lookup_sku goes live in hybrid; place_order stays mock
    os.environ["CONNECTOR_OVERRIDES"] = '{"lookup_sku": "live"}'
    try:
        ns = _write_and_import(tools_content, tmp_path)
        live_result = ns["dispatch"]("lookup_sku", {"id": "x"})
        mock_result = ns["dispatch"]("place_order", {"sku": "x"})
        # lookup_sku -> live -> NotImplementedError -> error payload
        assert live_result["error"] == "not_implemented"
        assert live_result["tool"] == "lookup_sku"
        # place_order -> mock fallback
        assert mock_result["status"] == "mock"
        assert mock_result["tool"] == "place_order"
    finally:
        if prev_mode is None:
            os.environ.pop("CONNECTOR_MODE", None)
        else:
            os.environ["CONNECTOR_MODE"] = prev_mode
        if prev_over is None:
            os.environ.pop("CONNECTOR_OVERRIDES", None)
        else:
            os.environ["CONNECTOR_OVERRIDES"] = prev_over


def test_dispatch_unknown_tool_returns_error(tmp_path: Path) -> None:
    bundle = emit("tool_first_chain", _spec_with_tools())
    tools_content = next(f for f in bundle.files if f.path == "tools.py").content
    ns = _write_and_import(tools_content, tmp_path)
    result = ns["dispatch"]("no_such_tool", {})
    assert "no handler registered" in result["error"]


def test_hybrid_mode_bad_overrides_json_does_not_crash(tmp_path: Path) -> None:
    bundle = emit("tool_first_chain", _spec_with_tools())
    tools_content = next(f for f in bundle.files if f.path == "tools.py").content

    prev_mode = os.environ.get("CONNECTOR_MODE")
    prev_over = os.environ.get("CONNECTOR_OVERRIDES")
    os.environ["CONNECTOR_MODE"] = "hybrid"
    os.environ["CONNECTOR_OVERRIDES"] = "not valid json"
    try:
        ns = _write_and_import(tools_content, tmp_path)
        # Dispatch should gracefully fall back to mock on malformed overrides
        result = ns["dispatch"]("lookup_sku", {})
        assert result["status"] == "mock"
    finally:
        if prev_mode is None:
            os.environ.pop("CONNECTOR_MODE", None)
        else:
            os.environ["CONNECTOR_MODE"] = prev_mode
        if prev_over is None:
            os.environ.pop("CONNECTOR_OVERRIDES", None)
        else:
            os.environ["CONNECTOR_OVERRIDES"] = prev_over


def test_no_tools_spec_still_valid_python(tmp_path: Path) -> None:
    from daas.schemas import WorkflowSpec as _W

    bundle = emit(
        "tool_first_chain",
        _W(
            source_trace_id="empty",
            executor_model="gemini-3.1-flash-lite-preview",
            orchestrator_system_prompt="hi",
            tools=[],
        ),
    )
    tools_content = next(f for f in bundle.files if f.path == "tools.py").content
    ast.parse(tools_content)
    ns = _write_and_import(tools_content, tmp_path)
    # Dispatch on missing tool returns structured error
    r = ns["dispatch"]("anything", {})
    assert "no handler registered" in r["error"]
