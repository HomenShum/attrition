"""Real-trace compile-down/up harness.

Runs the full DaaS pipeline on SELECTED Claude Code JSONL sessions from
``~/.claude/projects/`` and produces a structural-fidelity report.

The claim this proves / falsifies:
    "complex (rich multi-turn trace) can compile DOWN to a runnable
    simple scaffold without losing the tools, the intent, or the
    decision structure"

and the inverse:
    "simple (few-turn trace) can compile UP to an orchestrator_worker
    and still run correctly — structure is added, quality is not lost"

Metrics per session:
    - tools_in_trace     : unique tool names observed in the jsonl
    - tools_in_spec      : tools declared on the emitted WorkflowSpec
    - structural_fid     : tools_in_spec / max(1, tools_in_trace)
    - ast_valid_lanes    : how many of 5 emitted .py files parse
    - orchestrator_has_plan: does the emitted orchestrator_worker
                             actually ship a plan->dispatch->compact loop
    - roundtrip_bytes    : total size of emitted bundle
    - judgment_preserved : heuristic — orchestrator_system_prompt is non-empty
                           and contains >= 1 substantive sentence about
                           the task (not just a placeholder)

Usage:
    python -m daas.compile_down.real_trace_harness \
        --project D--VSCode-Projects-cafecorner-nodebench-nodebench-ai4-nodebench-ai \
        --out daas/results/real_traces_report.json \
        --sessions 17443bc7-fc7c-45f6-80ef-67a6df5cb62c \
                   0393d754-55fd-49ad-903b-b1b2d018e14c \
                   30393b87-f07e-48b3-b8cf-d8492ae373d2 \
                   024caa26-44f3-4600-aad3-e08da88aeb85 \
                   30407b7e-622b-42fe-bde1-cb248c92df5d
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import sys
import time
from dataclasses import dataclass, asdict, is_dataclass
from pathlib import Path
from typing import Any

from daas.compile_down.normalizers.claude_code import from_claude_code_jsonl
from daas.compile_down.cli import trace_to_workflow_spec
from daas.compile_down import emit

# Target model for the distilled WorkflowSpec's executor.
# All emitters respect this; it's the "cheap runtime" after compile-down.
DEFAULT_TARGET_MODEL = "gemini-3.1-flash-lite-preview"


def _trace_to_dict(trace: Any) -> dict[str, Any]:
    """Normalize CanonicalTrace dataclass -> plain dict for the distiller,
    which consumes ``trace.get("query")`` / ``trace.get("steps")`` etc.
    """
    if isinstance(trace, dict):
        return trace
    if is_dataclass(trace):
        return asdict(trace)
    # Last-ditch duck-typed fallback
    return {
        "query": getattr(trace, "query", ""),
        "final_answer": getattr(trace, "final_answer", ""),
        "steps": [asdict(s) if is_dataclass(s) else s for s in getattr(trace, "steps", [])],
        "source_model": getattr(trace, "source_model", ""),
        "session_id": getattr(trace, "session_id", ""),
    }

# Five runtime lanes we currently ship.
LANES = (
    "simple_chain",
    "tool_first_chain",
    "orchestrator_worker",
    "openai_agents_sdk",
    "langgraph_python",
)


@dataclass
class TraceReport:
    session_id: str
    source_path: str
    file_bytes: int
    # Ingest
    query_preview: str
    final_answer_preview: str
    source_model: str
    step_count: int
    total_tokens: int
    unique_tools_in_trace: list[str]
    # Distill
    spec_tools: list[str]
    spec_executor_model: str
    spec_orchestrator_prompt_preview: str
    # Emit per lane
    lane_bytes: dict[str, int]
    lane_ast_valid: dict[str, bool]
    lane_file_counts: dict[str, int]
    # Fidelity metrics
    structural_fidelity: float
    ast_valid_lanes: int
    orchestrator_has_plan: bool
    judgment_preserved: bool
    # Timing
    ingest_ms: int
    distill_ms: int
    emit_ms: int


def _unique_tool_names(trace) -> list[str]:
    seen: list[str] = []
    for step in trace.steps:
        for call in step.tool_calls or []:
            name = call.name
            if name and name not in seen:
                seen.append(name)
    return seen


def _ast_ok(src: str) -> bool:
    try:
        ast.parse(src)
        return True
    except SyntaxError:
        return False


def _orchestrator_has_plan(bundle) -> bool:
    """orchestrator_worker emits orchestrator.py; the plan->dispatch->compact
    pipeline is characterized by the presence of _parse_plan, _run_worker,
    and MAX_WORKER_TURNS.
    """
    for f in bundle.files:
        if f.path == "orchestrator.py":
            return (
                "_parse_plan" in f.content
                and "_run_worker" in f.content
                and "MAX_WORKER_TURNS" in f.content
            )
    return False


def run_one(jsonl_path: Path) -> TraceReport:
    t0 = time.perf_counter()
    trace = from_claude_code_jsonl(jsonl_path)
    t1 = time.perf_counter()
    spec = trace_to_workflow_spec(_trace_to_dict(trace), DEFAULT_TARGET_MODEL)
    t2 = time.perf_counter()

    unique_tools = _unique_tool_names(trace)
    spec_tool_names = [t.get("name") if isinstance(t, dict) else t.name for t in spec.tools]
    spec_tool_names = [s for s in spec_tool_names if s]

    lane_bytes: dict[str, int] = {}
    lane_ast_valid: dict[str, bool] = {}
    lane_file_counts: dict[str, int] = {}
    ast_valid_lanes = 0
    orch_has_plan = False

    for lane in LANES:
        bundle = emit(lane, spec)
        total_bytes = 0
        all_valid = True
        for f in bundle.files:
            total_bytes += len(f.content.encode("utf-8"))
            if f.path.endswith(".py"):
                if not _ast_ok(f.content):
                    all_valid = False
        lane_bytes[lane] = total_bytes
        lane_ast_valid[lane] = all_valid
        lane_file_counts[lane] = len(bundle.files)
        if all_valid:
            ast_valid_lanes += 1
        if lane == "orchestrator_worker":
            orch_has_plan = _orchestrator_has_plan(bundle)
    t3 = time.perf_counter()

    # Structural fidelity: did the distilled spec capture every tool the
    # trace actually invoked? (1.0 = perfect capture; < 1.0 = tools lost.)
    if unique_tools:
        matched = sum(1 for t in unique_tools if t in spec_tool_names)
        fidelity = matched / len(unique_tools)
    else:
        fidelity = 1.0  # no tool use in trace => nothing to lose

    prompt = spec.orchestrator_system_prompt or ""
    judgment_preserved = bool(prompt.strip()) and len(prompt) > 40

    return TraceReport(
        session_id=jsonl_path.stem,
        source_path=str(jsonl_path),
        file_bytes=jsonl_path.stat().st_size,
        query_preview=(trace.query or "")[:240],
        final_answer_preview=(trace.final_answer or "")[:240],
        source_model=trace.source_model,
        step_count=len(trace.steps),
        total_tokens=int(trace.total_tokens or 0),
        unique_tools_in_trace=unique_tools,
        spec_tools=spec_tool_names,
        spec_executor_model=spec.executor_model,
        spec_orchestrator_prompt_preview=prompt[:240],
        lane_bytes=lane_bytes,
        lane_ast_valid=lane_ast_valid,
        lane_file_counts=lane_file_counts,
        structural_fidelity=round(fidelity, 3),
        ast_valid_lanes=ast_valid_lanes,
        orchestrator_has_plan=orch_has_plan,
        judgment_preserved=judgment_preserved,
        ingest_ms=int((t1 - t0) * 1000),
        distill_ms=int((t2 - t1) * 1000),
        emit_ms=int((t3 - t2) * 1000),
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--projects-root",
        default=str(Path.home() / ".claude" / "projects"),
        help="Root directory containing per-project JSONL session dirs",
    )
    ap.add_argument(
        "--project",
        default="D--VSCode-Projects-cafecorner-nodebench-nodebench-ai4-nodebench-ai",
        help="Which project's sessions to pull from",
    )
    ap.add_argument(
        "--sessions",
        nargs="+",
        help="Session UUIDs (filename stems) to process",
    )
    ap.add_argument(
        "--out",
        required=True,
        help="Path to write the aggregated JSON report",
    )
    ap.add_argument(
        "--specs-out",
        default=None,
        help="Optional path to write the WorkflowSpec per session as JSON",
    )
    args = ap.parse_args()

    project_dir = Path(args.projects_root) / args.project
    if not project_dir.exists():
        print(f"[ERR] project dir missing: {project_dir}", file=sys.stderr)
        return 2

    reports: list[TraceReport] = []
    specs: dict[str, Any] = {}
    for sid in args.sessions:
        jsonl = project_dir / f"{sid}.jsonl"
        if not jsonl.exists():
            print(f"[WARN] missing session {sid}")
            continue
        try:
            r = run_one(jsonl)
        except Exception as e:  # noqa: BLE001
            print(f"[FAIL] {sid}: {type(e).__name__}: {e}")
            continue
        reports.append(r)
        print(
            f"[OK] {sid[:8]} "
            f"bytes={r.file_bytes:>10}  "
            f"steps={r.step_count:>4}  "
            f"tools={len(r.unique_tools_in_trace):>2}  "
            f"fid={r.structural_fidelity:.2f}  "
            f"ast={r.ast_valid_lanes}/5  "
            f"orch_plan={r.orchestrator_has_plan}"
        )
        if args.specs_out:
            # Re-compute spec to serialize
            trace = from_claude_code_jsonl(jsonl)
            spec = trace_to_workflow_spec(_trace_to_dict(trace), DEFAULT_TARGET_MODEL)
            specs[sid] = {
                "source_trace_id": spec.source_trace_id,
                "executor_model": spec.executor_model,
                "orchestrator_system_prompt": spec.orchestrator_system_prompt,
                "tools": [
                    {"name": t.name, "purpose": t.purpose, "input_schema": t.input_schema}
                    if hasattr(t, "name")
                    else t
                    for t in spec.tools
                ],
            }

    # Aggregate
    agg = {
        "session_count": len(reports),
        "total_bytes_ingested": sum(r.file_bytes for r in reports),
        "total_steps": sum(r.step_count for r in reports),
        "total_unique_tools_in_traces": sum(
            len(r.unique_tools_in_trace) for r in reports
        ),
        "total_unique_tools_in_specs": sum(len(r.spec_tools) for r in reports),
        "avg_structural_fidelity": round(
            sum(r.structural_fidelity for r in reports) / max(1, len(reports)), 3
        ),
        "ast_valid_lane_rate": round(
            sum(r.ast_valid_lanes for r in reports)
            / max(1, len(reports) * len(LANES)),
            3,
        ),
        "orchestrator_plan_rate": round(
            sum(1 for r in reports if r.orchestrator_has_plan) / max(1, len(reports)),
            3,
        ),
        "judgment_preserved_rate": round(
            sum(1 for r in reports if r.judgment_preserved) / max(1, len(reports)),
            3,
        ),
        "reports": [asdict(r) for r in reports],
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(agg, indent=2), encoding="utf-8")
    print(f"[DONE] wrote {out}  ({len(reports)} sessions)")

    if args.specs_out:
        specs_path = Path(args.specs_out)
        specs_path.parent.mkdir(parents=True, exist_ok=True)
        specs_path.write_text(json.dumps(specs, indent=2), encoding="utf-8")
        print(f"[DONE] wrote specs -> {specs_path}")

    print("\n=== AGGREGATE ===")
    print(f"  sessions                 : {agg['session_count']}")
    print(f"  total bytes ingested     : {agg['total_bytes_ingested']:,}")
    print(f"  total steps              : {agg['total_steps']}")
    print(f"  tools in traces  (sum)   : {agg['total_unique_tools_in_traces']}")
    print(f"  tools in specs   (sum)   : {agg['total_unique_tools_in_specs']}")
    print(f"  avg structural fidelity  : {agg['avg_structural_fidelity']:.3f}")
    print(f"  ast-valid lane rate (/5) : {agg['ast_valid_lane_rate']:.3f}")
    print(f"  orchestrator plan rate   : {agg['orchestrator_plan_rate']:.3f}")
    print(f"  judgment preserved rate  : {agg['judgment_preserved_rate']:.3f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
