"""Shared helper: emit tools.py with connector-mode-aware dispatch.

Both tool_first_chain and orchestrator_worker emitters call into this
so the connector resolver behavior is identical across runtime lanes.
Changing it here changes it everywhere — single source of truth for
the mock/live/hybrid executing layer.
"""

from __future__ import annotations

import json
from typing import Any


def snake(s: str) -> str:
    """Python-identifier-safe snake_case for generated handler fn names."""
    return (
        str(s)
        .replace(".", "_")
        .replace("-", "_")
        .replace(" ", "_")
        .lower()
    )


def to_gemini_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Best-effort mapping from free-form input_schema to Gemini's
    functionDeclarations parameter shape."""
    if not isinstance(schema, dict):
        return {"type": "OBJECT", "properties": {}}
    if "type" not in schema:
        return {"type": "OBJECT", "properties": schema or {}}
    type_map = {
        "str": "STRING",
        "string": "STRING",
        "int": "INTEGER",
        "integer": "INTEGER",
        "float": "NUMBER",
        "number": "NUMBER",
        "bool": "BOOLEAN",
        "boolean": "BOOLEAN",
        "list": "ARRAY",
        "array": "ARRAY",
        "dict": "OBJECT",
        "object": "OBJECT",
    }
    t = type_map.get(str(schema.get("type", "object")).lower(), "OBJECT")
    out: dict[str, Any] = {"type": t}
    if "description" in schema:
        out["description"] = str(schema["description"])[:512]
    if t == "OBJECT" and isinstance(schema.get("properties"), dict):
        out["properties"] = {
            k: to_gemini_schema(v if isinstance(v, dict) else {"type": "string"})
            for k, v in schema["properties"].items()
        }
        if isinstance(schema.get("required"), list):
            out["required"] = list(schema["required"])
    if t == "ARRAY":
        out["items"] = to_gemini_schema(schema.get("items") or {"type": "string"})
    return out


def emit_tools_py(tools: list[Any]) -> str:
    """Emit a tools.py with:
      - GEMINI_TOOLS (functionDeclarations)
      - _stub_<name> + _live_<name> per tool
      - STUB_HANDLERS + LIVE_HANDLERS registries
      - _resolve_handler() reading CONNECTOR_MODE env
      - dispatch(name, args) routing through the resolver

    Used by every runtime-lane emitter that declares tools.
    """
    decls: list[dict[str, Any]] = []
    handlers: list[tuple[str, str]] = []
    for t in tools:
        name = getattr(t, "name", None) or (t.get("name") if isinstance(t, dict) else None)
        purpose = getattr(t, "purpose", None) or (t.get("purpose") if isinstance(t, dict) else "")
        input_schema = (
            getattr(t, "input_schema", None)
            or (t.get("input_schema") if isinstance(t, dict) else {})
            or {}
        )
        if not name:
            continue
        decls.append(
            {
                "name": name,
                "description": str(purpose)[:512],
                "parameters": to_gemini_schema(input_schema),
            }
        )
        handlers.append((name, snake(name)))

    decls_json = json.dumps(decls, indent=2, ensure_ascii=False)
    stub_map = ",\n    ".join(f'"{n}": _stub_{s}' for n, s in handlers) or ""
    live_map = ",\n    ".join(f'"{n}": _live_{s}' for n, s in handlers) or ""
    stub_fns = "\n\n".join(
        f'def _stub_{s}(args: dict) -> dict:\n'
        f'    """Mock handler for `{n}` — safe default, returns fixture."""\n'
        f'    return {{"status": "mock", "tool": "{n}", "args": args, "_result": "fixture-placeholder"}}'
        for n, s in handlers
    ) or "# No tools in distilled spec."
    live_fns = "\n\n".join(
        f'def _live_{s}(args: dict) -> dict:\n'
        f'    """Live handler for `{n}` — REPLACE with real DB/API/MCP call."""\n'
        f'    raise NotImplementedError(\n'
        f'        "live handler for {n} not wired. Flip CONNECTOR_MODE=mock or "\n'
        f'        "implement _live_{s} with the actual integration."\n'
        f'    )'
        for n, s in handlers
    ) or "# No tools in distilled spec."

    return f'''"""Tool declarations + connector-mode-aware dispatch.

Three modes (set via CONNECTOR_MODE env var, default "mock"):
  mock    — every call returns stub fixture data. Safe for dev.
  live    — every call hits the real _live_<name> handler.
            Raises NotImplementedError until you implement them.
  hybrid  — per-tool override via CONNECTOR_OVERRIDES env JSON.
            e.g. CONNECTOR_OVERRIDES=\'{{"lookup_sku": "live"}}\'
            Unlisted tools fall back to mock.

Every handler pair (_stub_<name>, _live_<name>) should return a JSON-
serializable dict. The dispatcher calls _resolve_handler(name)(args).
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable

GEMINI_TOOLS = [
    {{
        "functionDeclarations": {decls_json}
    }}
]

# --- stub handlers (safe defaults; always available) ---

{stub_fns}

# --- live handlers (user implements; NotImplementedError until wired) ---

{live_fns}


STUB_HANDLERS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {{
    {stub_map}
}}

LIVE_HANDLERS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {{
    {live_map}
}}


def _resolve_handler(name: str) -> Callable[[dict[str, Any]], dict[str, Any]] | None:
    """Pick stub vs live based on CONNECTOR_MODE + CONNECTOR_OVERRIDES."""
    mode = (os.environ.get("CONNECTOR_MODE") or "mock").lower()
    if mode == "live":
        return LIVE_HANDLERS.get(name)
    if mode == "hybrid":
        try:
            overrides = json.loads(os.environ.get("CONNECTOR_OVERRIDES") or "{{}}")
        except json.JSONDecodeError:
            overrides = {{}}
        target = overrides.get(name, "mock")
        if target == "live":
            return LIVE_HANDLERS.get(name)
        return STUB_HANDLERS.get(name)
    return STUB_HANDLERS.get(name)


def dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Route one tool call through the connector resolver."""
    fn = _resolve_handler(name)
    if fn is None:
        return {{"error": f"no handler registered for tool '{{name}}'"}}
    try:
        return fn(args)
    except NotImplementedError as exc:
        return {{
            "error": "not_implemented",
            "tool": name,
            "detail": str(exc),
            "mode": (os.environ.get("CONNECTOR_MODE") or "mock"),
        }}
'''
