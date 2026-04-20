"""Behavioral spot-check for real-trace compile-down.

The ``real_trace_harness.py`` proves STRUCTURAL fidelity — every tool
the trace invoked is declared on the spec, every emitted ``.py``
parses. That is necessary but not sufficient.

This probe proves BEHAVIORAL fidelity at the dispatch layer:

    For each tool observed in the real trace, does the emitted
    ``tools.py`` — imported in a fresh namespace — have a
    ``dispatch()`` that returns a structured, non-crashing result
    for ``CONNECTOR_MODE=mock``?

If this passes, we know the compile-down didn't just preserve
names — it preserved enough structure that the cheap runtime can
actually receive tool calls and respond. (Live-mode dispatch is
intentionally ``NotImplementedError`` — the user supplies real
handlers; the point of this probe is the SCAFFOLD, not the SPI.)

Usage:
    python -m daas.compile_down.real_trace_behavioral_probe \
        --out daas/results/real_traces_behavioral.json \
        --sessions 30393b87-f07e-48b3-b8cf-d8492ae373d2 \
                   06c10633-6eda-4fe7-add0-4bed4bed35bf \
                   30407b7e-622b-42fe-bde1-cb248c92df5d \
                   1eb2aa83-2626-4f85-bcce-f16f14745ece
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from daas.compile_down.normalizers.claude_code import from_claude_code_jsonl
from daas.compile_down.cli import trace_to_workflow_spec
from daas.compile_down import emit

DEFAULT_TARGET_MODEL = "gemini-3.1-flash-lite-preview"


def _trace_to_dict(trace: Any) -> dict[str, Any]:
    if isinstance(trace, dict):
        return trace
    if is_dataclass(trace):
        return asdict(trace)
    return {
        "query": getattr(trace, "query", ""),
        "final_answer": getattr(trace, "final_answer", ""),
        "steps": [asdict(s) if is_dataclass(s) else s for s in getattr(trace, "steps", [])],
    }


def _unique_tool_names(trace) -> list[str]:
    seen: list[str] = []
    for step in trace.steps:
        for call in step.tool_calls or []:
            name = call.name
            if name and name not in seen:
                seen.append(name)
    return seen


def _import_tools_py(tools_src: str, session_id: str) -> dict[str, Any]:
    """Execute emitted tools.py into a dedicated namespace. No sys.path
    pollution, no disk writes.
    """
    ns: dict[str, Any] = {}
    exec(compile(tools_src, f"<emitted:{session_id}:tools.py>", "exec"), ns)
    return ns


def probe_session(jsonl_path: Path, *, lane: str = "tool_first_chain") -> dict[str, Any]:
    trace = from_claude_code_jsonl(jsonl_path)
    tools_used = _unique_tool_names(trace)
    if not tools_used:
        return {
            "session_id": jsonl_path.stem,
            "tools_used_in_trace": 0,
            "tools_dispatchable_mock": 0,
            "tools_dispatchable_live_stub": 0,
            "tools_unknown_handled": True,
            "dispatch_rate": 1.0,
            "note": "trace had no tool calls (nothing to dispatch)",
        }

    spec = trace_to_workflow_spec(_trace_to_dict(trace), DEFAULT_TARGET_MODEL)
    bundle = emit(lane, spec)
    tools_py = next(f for f in bundle.files if f.path == "tools.py").content

    # MOCK mode: every known tool should return a structured dict
    prev = os.environ.get("CONNECTOR_MODE")
    os.environ["CONNECTOR_MODE"] = "mock"
    mock_dispatched = 0
    live_surfaced = 0
    try:
        ns = _import_tools_py(tools_py, jsonl_path.stem)
        dispatch = ns.get("dispatch")
        if dispatch is None:
            return {
                "session_id": jsonl_path.stem,
                "error": "no dispatch() in emitted tools.py",
            }
        for t in tools_used:
            try:
                r = dispatch(t, {})
                if isinstance(r, dict) and r.get("status") == "mock":
                    mock_dispatched += 1
            except Exception:  # noqa: BLE001
                pass

        # LIVE mode: every known tool should surface a structured
        # not_implemented error (not crash). This proves the live path is
        # wired even though user hasn't supplied real handlers yet.
        os.environ["CONNECTOR_MODE"] = "live"
        ns2 = _import_tools_py(tools_py, jsonl_path.stem)
        dispatch2 = ns2["dispatch"]
        for t in tools_used:
            try:
                r = dispatch2(t, {})
                if isinstance(r, dict) and r.get("error") == "not_implemented":
                    live_surfaced += 1
            except Exception:  # noqa: BLE001
                pass

        # UNKNOWN tool: must return structured error, not crash
        os.environ["CONNECTOR_MODE"] = "mock"
        ns3 = _import_tools_py(tools_py, jsonl_path.stem)
        r_unk = ns3["dispatch"]("__nonexistent_tool__", {})
        unknown_handled = (
            isinstance(r_unk, dict) and "no handler registered" in str(r_unk.get("error", ""))
        )
    finally:
        if prev is None:
            os.environ.pop("CONNECTOR_MODE", None)
        else:
            os.environ["CONNECTOR_MODE"] = prev

    total = len(tools_used)
    return {
        "session_id": jsonl_path.stem,
        "tools_used_in_trace": total,
        "tools_dispatchable_mock": mock_dispatched,
        "tools_dispatchable_live_stub": live_surfaced,
        "tools_unknown_handled": unknown_handled,
        "dispatch_rate": round(mock_dispatched / total, 3),
        "live_stub_rate": round(live_surfaced / total, 3),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--sessions", nargs="+", required=True)
    ap.add_argument(
        "--projects-root",
        default=str(Path.home() / ".claude" / "projects"),
    )
    ap.add_argument(
        "--project",
        default="D--VSCode-Projects-cafecorner-nodebench-nodebench-ai4-nodebench-ai",
    )
    args = ap.parse_args()

    project_dir = Path(args.projects_root) / args.project
    if not project_dir.exists():
        print(f"[ERR] project dir missing: {project_dir}", file=sys.stderr)
        return 2

    results: list[dict[str, Any]] = []
    for sid in args.sessions:
        jsonl = project_dir / f"{sid}.jsonl"
        if not jsonl.exists():
            print(f"[WARN] missing {sid}")
            continue
        t0 = time.perf_counter()
        res = probe_session(jsonl)
        res["elapsed_s"] = round(time.perf_counter() - t0, 2)
        results.append(res)
        print(
            f"[OK] {sid[:8]}  "
            f"tools={res.get('tools_used_in_trace', 0):>3}  "
            f"mock={res.get('tools_dispatchable_mock', 0):>3}  "
            f"live_stub={res.get('tools_dispatchable_live_stub', 0):>3}  "
            f"unk={res.get('tools_unknown_handled', False)}  "
            f"elapsed={res['elapsed_s']}s"
        )

    # Aggregate
    total_tools = sum(r.get("tools_used_in_trace", 0) for r in results)
    total_mock = sum(r.get("tools_dispatchable_mock", 0) for r in results)
    total_live = sum(r.get("tools_dispatchable_live_stub", 0) for r in results)
    all_unknown_handled = all(
        r.get("tools_unknown_handled", False) for r in results if r.get("tools_used_in_trace", 0)
    )

    agg = {
        "session_count": len(results),
        "total_tools_in_traces": total_tools,
        "total_tools_dispatchable_mock": total_mock,
        "total_tools_dispatchable_live_stub": total_live,
        "mock_dispatch_rate": round(total_mock / max(1, total_tools), 3),
        "live_stub_rate": round(total_live / max(1, total_tools), 3),
        "unknown_tool_handled_everywhere": all_unknown_handled,
        "results": results,
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(agg, indent=2), encoding="utf-8")

    print("\n=== BEHAVIORAL DISPATCH AGGREGATE ===")
    print(f"  sessions                        : {agg['session_count']}")
    print(f"  tools used across traces        : {agg['total_tools_in_traces']}")
    print(f"  mock dispatch rate              : {agg['mock_dispatch_rate']:.3f}")
    print(f"  live-stub surfaced rate         : {agg['live_stub_rate']:.3f}")
    print(f"  unknown-tool safely handled     : {agg['unknown_tool_handled_everywhere']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
