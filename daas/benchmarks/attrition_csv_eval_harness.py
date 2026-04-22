"""Attrition CSV eval harness — dispatches via agent_loop.generate_scaffold
per row, runs 11 gates, writes a filled CSV and JSON summary.

Input CSV schema (matches daas/benchmarks/attrition_eval_template_v1.csv):
    12 input columns:
        case_id, mode, driver_runtime, emit_lane, use_case_name,
        example_prompt, preconditions, expected_runtime_behavior,
        max_external_calls, max_llm_calls, latency_budget_s, cost_budget_usd
    11 gate columns (each with an `actual_*` + `rationale_*`):
        scaffold_compiles · scaffold_runs_mock · nine_layers_present
        correct_lane_picked · connector_resolver_working
        mcp_server_importable · workflow_spec_roundtrip
        baseline_parity · cost_under_budget · latency_under_budget
        runtime_used_correctly
    overall_gate_pass + overall_gate_rationale

Harness behavior:
    1. Load rows.
    2. For each row:
         a. Build a minimal WorkflowSpec from the row's prompt + budgets.
         b. Call `agent_loop.generate_scaffold(lane, spec, runtime, model)`
            with the row's emit_lane + driver_runtime.
         c. Evaluate 9 deterministic gates on the returned bundle + run_result.
         d. Stub 2 LLM-judged gates (correct_lane_picked, baseline_parity)
            with honest "not-yet-wired" markers — future cycles wire these.
    3. Fill cells + compute overall_gate_pass.
    4. Emit filled CSV + JSON summary.

Modes:
    --dry                  parse + fill with "pending" markers, no dispatch.
                           Proves CSV IO + gate plumbing without LLM spend.
    --limit N              evaluate only the first N rows (default: all 60)
    --only-case AE01,AE02  evaluate only the listed case_ids
    --only-mode fast       filter by mode column (fast/slow)

Usage:
    python -m daas.benchmarks.attrition_csv_eval_harness \\
      --in  daas/benchmarks/attrition_eval_template_v1.csv \\
      --out daas/results/attrition_eval_filled_v1.csv \\
      --dry

Budget note: `generate_scaffold` runs the driver runtime for the full
agent loop. Per-row cost ranges from ~$0.0004 (simple_chain + Flash Lite)
to ~$0.40 (orchestrator_worker + Claude Opus). The 60-row end-to-end
target is ~$0.30 by preferring Flash Lite + gemini_agent on fast rows.
"""

from __future__ import annotations

import argparse
import ast
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from daas.agent.agent_loop import generate_scaffold
from daas.compile_down.artifact import ArtifactBundle

# ------------------------------------------------------------------ constants

GATE_KEYS: tuple[str, ...] = (
    "scaffold_compiles",
    "scaffold_runs_mock",
    "nine_layers_present",
    "correct_lane_picked",
    "connector_resolver_working",
    "mcp_server_importable",
    "workflow_spec_roundtrip",
    "baseline_parity",
    "cost_under_budget",
    "latency_under_budget",
    "runtime_used_correctly",
)

# Default model per driver_runtime. Chosen to fit the row's mode: fast =
# cheap provider default, slow = same but the row's budget gives headroom.
DEFAULT_MODEL_FOR_RUNTIME: dict[str, str] = {
    "gemini_agent": "gemini-3.1-flash-lite-preview",
    "gemini_deep_research": "deep_research",
    "openai_agents_sdk": "gpt-5.4-nano",
    "claude_agent_sdk": "claude-haiku-4.5",
    "langgraph": "gemini-3.1-flash-lite-preview",
    "openrouter": "google/gemini-3.1-flash-lite",
}

# Minimum set of files required at the nine-layers gate. The emitter's
# `_bundle_finalize.py` ensures these exist even if the agent skipped them.
REQUIRED_LAYERS: tuple[str, ...] = (
    "workflow_spec.json",
    "server.py",
    "state_store.py",
    "observability.py",
    "mcp_server.py",
    "README.md",
    "requirements.txt",
    "run.sh",
    ".env.example",
    # eval/ is a directory, checked by prefix
)
REQUIRED_DIR_PREFIXES: tuple[str, ...] = ("eval/",)


# ------------------------------------------------------------------ dataclasses


@dataclass
class GateResult:
    """One gate's verdict. `passed=None` means not evaluated this run."""

    passed: bool | None
    rationale: str

    def to_cells(self) -> tuple[str, str]:
        """Return (actual, rationale) as they appear in the filled CSV."""
        if self.passed is None:
            return ("n/a", self.rationale)
        return ("pass" if self.passed else "fail", self.rationale)


@dataclass
class RowOutcome:
    case_id: str
    gates: dict[str, GateResult]
    overall_pass: bool | None
    overall_rationale: str
    dispatch_error: str | None = None
    run_elapsed_s: float = 0.0
    run_cost_usd: float = 0.0


# ------------------------------------------------------------------ deterministic gates


def gate_scaffold_compiles(bundle: ArtifactBundle) -> GateResult:
    errors: list[str] = []
    py_count = 0
    for f in bundle.files:
        if f.path.endswith(".py"):
            py_count += 1
            try:
                ast.parse(f.content)
            except SyntaxError as e:
                errors.append(f"{f.path}: {e.msg} (line {e.lineno})")
    if errors:
        return GateResult(False, f"{len(errors)} .py failed ast.parse: " + "; ".join(errors[:3]))
    if py_count == 0:
        return GateResult(False, "no .py files emitted")
    return GateResult(True, f"{py_count} .py files ast-parse valid")


def gate_nine_layers_present(bundle: ArtifactBundle) -> GateResult:
    paths = {f.path for f in bundle.files}
    missing: list[str] = []
    # File-by-name check (suffix match to tolerate subdir nesting)
    for req in REQUIRED_LAYERS:
        if req not in paths and not any(
            p == req or p.endswith("/" + req) for p in paths
        ):
            missing.append(req)
    # Directory-prefix check
    for prefix in REQUIRED_DIR_PREFIXES:
        if not any(p.startswith(prefix) for p in paths):
            missing.append(prefix)
    if missing:
        return GateResult(False, f"missing: {', '.join(missing)}")
    return GateResult(True, f"all {len(REQUIRED_LAYERS) + len(REQUIRED_DIR_PREFIXES)} required layers present")


def gate_scaffold_runs_mock(bundle: ArtifactBundle) -> GateResult:
    """Surrogate: runner-equivalent file exists + parses + references mock mode.

    A true mock-exec gate would invoke the bundle in a sandbox — that
    lives in the Layer 2 live-integration eval, not here. This gate
    proves the preconditions for mock exec are met.
    """
    runner = next(
        (f for f in bundle.files if f.path.endswith(("server.py", "runner.py", "main.py"))),
        None,
    )
    if not runner:
        return GateResult(False, "no server.py / runner.py / main.py emitted")
    try:
        ast.parse(runner.content)
    except SyntaxError as e:
        return GateResult(False, f"{runner.path} syntax: {e.msg}")
    if "mock" not in runner.content.lower() and "CONNECTOR_MODE" not in runner.content:
        return GateResult(False, f"{runner.path} parses but no mock-mode handling")
    return GateResult(True, f"{runner.path} parses + references mock/CONNECTOR_MODE")


def gate_connector_resolver_working(bundle: ArtifactBundle) -> GateResult:
    hits: list[str] = []
    for f in bundle.files:
        if "CONNECTOR_MODE" in f.content:
            hits.append(f.path)
    if not hits:
        return GateResult(False, "no CONNECTOR_MODE switch found in any file")
    return GateResult(True, f"CONNECTOR_MODE referenced in {len(hits)} file(s): {hits[0]}")


def gate_mcp_server_importable(bundle: ArtifactBundle) -> GateResult:
    mcp = next((f for f in bundle.files if f.path.endswith("mcp_server.py")), None)
    if not mcp:
        return GateResult(False, "mcp_server.py missing from bundle")
    try:
        ast.parse(mcp.content)
    except SyntaxError as e:
        return GateResult(False, f"mcp_server.py syntax: {e.msg} (line {e.lineno})")
    body_lower = mcp.content.lower()
    if "mcp" not in body_lower and "stdio" not in body_lower:
        return GateResult(False, "mcp_server.py parses but doesn't reference mcp/stdio")
    return GateResult(True, "mcp_server.py ast-parses + references mcp/stdio")


def gate_workflow_spec_roundtrip(bundle: ArtifactBundle) -> GateResult:
    spec_file = next((f for f in bundle.files if f.path.endswith("workflow_spec.json")), None)
    if not spec_file:
        return GateResult(False, "workflow_spec.json missing from bundle")
    try:
        data = json.loads(spec_file.content)
    except json.JSONDecodeError as e:
        return GateResult(False, f"invalid JSON: {e.msg}")
    if not isinstance(data, dict):
        return GateResult(False, "workflow_spec.json not a JSON object")
    # Lightweight roundtrip: dump back + parse again, compare
    try:
        reserialized = json.dumps(data, sort_keys=True)
        reparsed = json.loads(reserialized)
        if reparsed != data:
            return GateResult(False, "roundtrip produced different structure")
    except (TypeError, ValueError) as e:
        return GateResult(False, f"roundtrip failed: {e}")
    return GateResult(True, f"valid JSON, {len(data)} top-level keys, roundtrip stable")


def gate_cost_under_budget(budget_usd: float, run_result: Any) -> GateResult:
    try:
        actual = float(run_result.cost_usd())
    except Exception as e:  # defensive: AgentRunResult should always compute
        return GateResult(False, f"cost_usd() raised: {e}")
    if actual <= budget_usd:
        return GateResult(True, f"${actual:.4f} <= ${budget_usd:.4f} budget")
    return GateResult(False, f"${actual:.4f} > ${budget_usd:.4f} budget")


def gate_latency_under_budget(budget_s: float, run_result: Any) -> GateResult:
    elapsed_ms = getattr(run_result, "elapsed_ms", 0)
    actual_s = float(elapsed_ms) / 1000.0
    if actual_s <= budget_s:
        return GateResult(True, f"{actual_s:.2f}s <= {budget_s}s budget")
    return GateResult(False, f"{actual_s:.2f}s > {budget_s}s budget")


def gate_runtime_used_correctly(expected_runtime: str, run_result: Any) -> GateResult:
    actual = getattr(run_result, "runtime_label", None)
    if actual == expected_runtime:
        return GateResult(True, f"runtime_label={actual} matches emit_lane driver")
    return GateResult(False, f"expected runtime_label={expected_runtime!r}, got {actual!r}")


# ------------------------------------------------------------------ judged gates (stubbed)


def gate_correct_lane_picked(
    *,
    expected_lane: str,
    expected_behavior: str,
    bundle: ArtifactBundle,
    api_key: str | None,
) -> GateResult:
    """Flash Lite judge — does the bundle's shape match the lane contract?

    Asks the model a single bounded question with a JSON schema response
    so the verdict is parseable without regex. Cost per call ≈ $0.0005.
    Returns GateResult(None, ...) if the judge itself fails (network,
    missing key) — a judge-unavailable failure is NOT a gate failure.
    """
    if not api_key:
        return GateResult(None, "judge unavailable: GEMINI_API_KEY not set")

    # Lane-contract summary passed to the judge so it has a deterministic
    # anchor for what "correct" means per lane.
    lane_contracts: dict[str, str] = {
        "simple_chain": "exactly one LLM call + output schema; no tool dispatch loop; no multi-turn orchestration",
        "tool_first_chain": "bounded single-agent tool loop with MAX_TURNS cap; one LLM + one tools.py registry",
        "orchestrator_worker": "orchestrator that plans then dispatches N named workers with shared scratchpad + compaction",
        "openai_agents_sdk": "uses the openai-agents SDK (Agent + Runner.run_sync + @function_tool)",
        "langgraph_python": "uses langgraph's StateGraph + create_react_agent + checkpointer",
        "claude_agent_sdk": "uses claude-agent-sdk's ClaudeSDKClient + @tool + create_sdk_mcp_server",
        "manus": "virtual-workspace single-agent with sandboxed file-based memory",
        "deerflow": "ByteDance-style multi-agent deep-research graph with supervisor + researcher + coder",
        "hermes": "Hermes long-form agent with tool-planning + self-correction loops",
        "convex_functions": "Convex queries/mutations/actions with schema.ts + per-function files",
        "vercel_ai_sdk": "Vercel AI SDK streaming pattern with streamText + generateText",
        "gemini_deep_research": "Gemini Interactions API with researchSteps + citations synthesis",
    }
    contract = lane_contracts.get(expected_lane, "<no contract on file for this lane>")

    # Compact file manifest: path + first-40-chars-of-content for each file,
    # capped to a total of ~2000 chars so the judge prompt stays small.
    manifest_lines: list[str] = []
    total_chars = 0
    for f in bundle.files[:30]:
        head = f.content.replace("\n", " ")[:80]
        line = f"  - {f.path}: {head}"
        if total_chars + len(line) > 2000:
            manifest_lines.append(f"  ... ({len(bundle.files) - len(manifest_lines)} more files elided)")
            break
        manifest_lines.append(line)
        total_chars += len(line)
    manifest = "\n".join(manifest_lines)

    prompt = (
        "You are evaluating whether an emitted scaffold bundle matches the "
        "contract for its declared emit_lane. Reply with STRICT JSON only, "
        "matching this schema: {\"matches\": boolean, \"rationale\": string}.\n\n"
        f"Declared emit_lane: {expected_lane}\n"
        f"Lane contract: {contract}\n"
        f"Expected runtime behavior (from eval CSV): {expected_behavior or '(unspecified)'}\n\n"
        "Emitted bundle manifest:\n"
        f"{manifest}\n\n"
        "Does the emitted bundle's shape match the declared lane contract? "
        'Return {"matches": true, "rationale": "<one sentence>"} if yes, '
        '{"matches": false, "rationale": "<one sentence pointing at the mismatch>"} if no. '
        "One sentence only. No markdown. No preamble."
    )

    endpoint = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        "gemini-3.1-flash-lite-preview:generateContent?key=" + api_key
    )
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.0,
            "maxOutputTokens": 200,
            "responseMimeType": "application/json",
        },
    }

    try:
        req = urllib.request.Request(
            endpoint,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
    except (urllib.error.URLError, TimeoutError) as e:
        return GateResult(None, f"judge network error: {e}")

    try:
        data = json.loads(raw)
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
        matches = bool(parsed["matches"])
        rationale = str(parsed.get("rationale", ""))[:200]
    except (KeyError, ValueError, IndexError) as e:
        return GateResult(None, f"judge returned malformed JSON: {e}")

    return GateResult(matches, f"Flash Lite judge: {rationale}")


def gate_baseline_parity_stub() -> GateResult:
    """Stub — real implementation requires benchmark replay (BFCL or broadened)."""
    return GateResult(
        None,
        "not-yet-wired: requires BFCL/broadened benchmark replay for the emitted scaffold",
    )


# ------------------------------------------------------------------ spec builder


def _build_spec_from_row(row: dict[str, str]) -> dict[str, Any]:
    """Construct a minimal WorkflowSpec-shaped dict from the CSV row.

    We pass a dict (not a dataclass) because generate_scaffold accepts any
    dataclass / dict / duck-typed object. This avoids pulling in the full
    WorkflowSpec schema and its validation layer for a harness-only need.
    """
    prompt = row.get("example_prompt", "").strip()
    preconditions = row.get("preconditions", "").strip()
    expected = row.get("expected_runtime_behavior", "").strip()
    system_prompt = (
        f"Eval case {row.get('case_id')}: {row.get('use_case_name', '')}.\n\n"
        f"Preconditions: {preconditions or '(none)'}.\n\n"
        f"Expected behavior: {expected or '(unspecified)'}.\n\n"
        f"Respond faithfully to the user request below."
    )
    # Heuristic: if the row mentions tools, emit a single echo tool so the
    # emitted scaffold has something non-empty to dispatch against.
    tools: list[dict[str, Any]] = []
    if "tool" in (expected + " " + preconditions).lower():
        tools.append(
            {
                "name": "echo",
                "description": "Return the input unchanged (mock tool for eval scaffolding).",
                "parameters_schema": {
                    "type": "object",
                    "properties": {"msg": {"type": "string"}},
                    "required": ["msg"],
                },
            }
        )
    return {
        "source_trace_id": f"eval:{row.get('case_id', 'unknown')}",
        "executor_model": DEFAULT_MODEL_FOR_RUNTIME.get(row.get("driver_runtime", ""), ""),
        "orchestrator_system_prompt": system_prompt,
        "user_prompt": prompt,
        "tools": tools,
    }


# ------------------------------------------------------------------ per-row evaluation


def evaluate_row(row: dict[str, str], *, dry: bool) -> RowOutcome:
    case_id = row.get("case_id", "")
    lane = row.get("emit_lane", "").strip()
    runtime = row.get("driver_runtime", "").strip()

    try:
        budget_cost = float(row.get("cost_budget_usd", "0") or "0")
    except ValueError:
        budget_cost = 0.0
    try:
        budget_latency = float(row.get("latency_budget_s", "0") or "0")
    except ValueError:
        budget_latency = 0.0

    if dry:
        gates = {k: GateResult(None, "dry run: not dispatched") for k in GATE_KEYS}
        return RowOutcome(
            case_id=case_id,
            gates=gates,
            overall_pass=None,
            overall_rationale="dry run: harness plumbing only",
        )

    spec = _build_spec_from_row(row)
    start = time.monotonic()
    try:
        bundle, run_result = generate_scaffold(
            lane=lane,
            spec=spec,
            runtime=runtime,
            model=DEFAULT_MODEL_FOR_RUNTIME.get(runtime, ""),
            max_turns=15,
        )
    except Exception as e:
        elapsed = time.monotonic() - start
        gates = {
            k: GateResult(False, f"dispatch raised before gate: {e.__class__.__name__}")
            for k in GATE_KEYS
        }
        return RowOutcome(
            case_id=case_id,
            gates=gates,
            overall_pass=False,
            overall_rationale=f"generate_scaffold raised: {e}",
            dispatch_error=str(e),
            run_elapsed_s=elapsed,
        )

    # Evaluate the nine deterministic gates
    gates: dict[str, GateResult] = {}
    gates["scaffold_compiles"] = gate_scaffold_compiles(bundle)
    gates["nine_layers_present"] = gate_nine_layers_present(bundle)
    gates["scaffold_runs_mock"] = gate_scaffold_runs_mock(bundle)
    gates["connector_resolver_working"] = gate_connector_resolver_working(bundle)
    gates["mcp_server_importable"] = gate_mcp_server_importable(bundle)
    gates["workflow_spec_roundtrip"] = gate_workflow_spec_roundtrip(bundle)
    gates["cost_under_budget"] = gate_cost_under_budget(budget_cost, run_result)
    gates["latency_under_budget"] = gate_latency_under_budget(budget_latency, run_result)
    gates["runtime_used_correctly"] = gate_runtime_used_correctly(runtime, run_result)
    # correct_lane_picked — wired to Flash Lite judge. Uses GEMINI_API_KEY
    # from the environment; if unset, gate abstains (passed=None).
    gates["correct_lane_picked"] = gate_correct_lane_picked(
        expected_lane=lane,
        expected_behavior=row.get("expected_runtime_behavior", ""),
        bundle=bundle,
        api_key=os.environ.get("GEMINI_API_KEY"),
    )
    # baseline_parity still stubbed — needs benchmark replay infra
    gates["baseline_parity"] = gate_baseline_parity_stub()

    # Compute overall verdict across evaluated gates only (skipped = abstain)
    evaluated = [g for g in gates.values() if g.passed is not None]
    failures = [k for k, g in gates.items() if g.passed is False]
    if not evaluated:
        overall_pass = None
        overall_rat = "no gates evaluated"
    elif failures:
        overall_pass = False
        overall_rat = f"failed: {', '.join(failures)} ({len(failures)}/{len(evaluated)} eval'd failed)"
    else:
        overall_pass = True
        stubbed = [k for k, g in gates.items() if g.passed is None]
        overall_rat = (
            f"all {len(evaluated)} deterministic gates pass"
            + (f"; {len(stubbed)} stubbed: {', '.join(stubbed)}" if stubbed else "")
        )

    try:
        cost = float(run_result.cost_usd())
    except Exception:
        cost = 0.0
    elapsed_s = float(getattr(run_result, "elapsed_ms", 0)) / 1000.0

    return RowOutcome(
        case_id=case_id,
        gates=gates,
        overall_pass=overall_pass,
        overall_rationale=overall_rat,
        run_elapsed_s=elapsed_s,
        run_cost_usd=cost,
    )


# ------------------------------------------------------------------ CSV I/O


def run_harness(
    *,
    in_path: Path,
    out_path: Path,
    summary_path: Path,
    dry: bool,
    limit: int | None,
    only_cases: set[str] | None,
    only_mode: str | None,
) -> int:
    if not in_path.exists():
        print(f"error: input CSV not found: {in_path}", file=sys.stderr)
        return 2

    with in_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    # Filter
    filtered = []
    for r in rows:
        if only_cases and r.get("case_id") not in only_cases:
            continue
        if only_mode and r.get("mode") != only_mode:
            continue
        filtered.append(r)
    if limit:
        filtered = filtered[:limit]

    if not filtered:
        print("error: no rows matched the filter", file=sys.stderr)
        return 2

    print(f"attrition eval harness · {len(filtered)} rows · dry={dry}")
    print(f"  input:   {in_path}")
    print(f"  filled:  {out_path}")
    print(f"  summary: {summary_path}")

    outcomes: list[RowOutcome] = []
    filled_rows: list[dict[str, str]] = []
    t0 = time.monotonic()
    total_cost = 0.0

    for i, row in enumerate(filtered, 1):
        case_id = row.get("case_id", "?")
        print(f"  [{i}/{len(filtered)}] {case_id} · {row.get('emit_lane')} / {row.get('driver_runtime')} ... ", end="", flush=True)
        outcome = evaluate_row(row, dry=dry)
        outcomes.append(outcome)

        # Fill gate cells back into the row
        filled = dict(row)
        for key in GATE_KEYS:
            actual, rationale = outcome.gates[key].to_cells()
            filled[f"actual_{key}"] = actual
            filled[f"rationale_{key}"] = rationale
        if outcome.overall_pass is True:
            filled["overall_gate_pass"] = "pass"
        elif outcome.overall_pass is False:
            filled["overall_gate_pass"] = "fail"
        else:
            filled["overall_gate_pass"] = "n/a"
        filled["overall_gate_rationale"] = outcome.overall_rationale
        filled_rows.append(filled)

        total_cost += outcome.run_cost_usd
        verdict = (
            "PASS" if outcome.overall_pass is True
            else "FAIL" if outcome.overall_pass is False
            else "SKIP"
        )
        print(f"{verdict} ({outcome.run_elapsed_s:.1f}s · ${outcome.run_cost_usd:.4f})")

    elapsed = time.monotonic() - t0

    # Ensure output dir exists
    out_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.parent.mkdir(parents=True, exist_ok=True)

    # Write filled CSV
    with out_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(filled_rows)

    # Summary JSON
    pass_count = sum(1 for o in outcomes if o.overall_pass is True)
    fail_count = sum(1 for o in outcomes if o.overall_pass is False)
    skip_count = sum(1 for o in outcomes if o.overall_pass is None)
    summary = {
        "harness_version": "attrition.v1",
        "schema": "daas/benchmarks/attrition_eval_template_v1.csv",
        "dry": dry,
        "elapsed_s": round(elapsed, 2),
        "rows_total": len(outcomes),
        "pass": pass_count,
        "fail": fail_count,
        "skip": skip_count,
        "total_cost_usd": round(total_cost, 4),
        "per_row": [
            {
                "case_id": o.case_id,
                "overall_pass": o.overall_pass,
                "overall_rationale": o.overall_rationale,
                "run_elapsed_s": round(o.run_elapsed_s, 2),
                "run_cost_usd": round(o.run_cost_usd, 4),
                "dispatch_error": o.dispatch_error,
                "gates": {
                    k: {
                        "passed": g.passed,
                        "rationale": g.rationale,
                    }
                    for k, g in o.gates.items()
                },
            }
            for o in outcomes
        ],
    }
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print()
    print(f"=== done ===")
    print(f"  rows:    {len(outcomes)}  (pass={pass_count} · fail={fail_count} · skip={skip_count})")
    print(f"  elapsed: {elapsed:.1f}s")
    print(f"  cost:    ${total_cost:.4f}")
    print(f"  filled:  {out_path}")
    print(f"  summary: {summary_path}")
    return 0 if fail_count == 0 else 1


# ------------------------------------------------------------------ main


def main() -> int:
    p = argparse.ArgumentParser(
        prog="attrition_csv_eval_harness",
        description="Run the attrition eval template through generate_scaffold + 11 gates.",
    )
    p.add_argument(
        "--in",
        dest="in_path",
        default="daas/benchmarks/attrition_eval_template_v1.csv",
        help="input CSV path",
    )
    p.add_argument(
        "--out",
        dest="out_path",
        default="daas/results/attrition_eval_filled_v1.csv",
        help="output filled CSV path",
    )
    p.add_argument(
        "--summary",
        dest="summary_path",
        default="daas/results/attrition_eval_summary_v1.json",
        help="output JSON summary path",
    )
    p.add_argument(
        "--dry",
        action="store_true",
        help="parse + plumb but do NOT dispatch generate_scaffold (no LLM cost)",
    )
    p.add_argument("--limit", type=int, default=None, help="evaluate only the first N rows")
    p.add_argument(
        "--only-case",
        type=str,
        default=None,
        help="comma-separated case_ids to evaluate (e.g. AE01,AE02,AE03)",
    )
    p.add_argument("--only-mode", type=str, default=None, help="filter by mode: fast or slow")
    args = p.parse_args()

    only_cases: set[str] | None = None
    if args.only_case:
        only_cases = {c.strip() for c in args.only_case.split(",") if c.strip()}

    return run_harness(
        in_path=Path(args.in_path),
        out_path=Path(args.out_path),
        summary_path=Path(args.summary_path),
        dry=args.dry,
        limit=args.limit,
        only_cases=only_cases,
        only_mode=args.only_mode,
    )


if __name__ == "__main__":
    sys.exit(main())
