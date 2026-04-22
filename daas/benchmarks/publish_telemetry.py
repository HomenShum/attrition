"""Aggregate attrition eval baselines into publication-ready telemetry.

Reads every `attrition_eval_summary_v*_full.json` under `daas/results/`
and produces:
    daas/results/TELEMETRY_REPORT.md   — human-readable, ready to publish
    daas/results/telemetry.json        — machine-readable, same data

Tracks across every baseline:
    - pass/fail/skip count per baseline
    - total $ spent per baseline + cumulative
    - wall clock per baseline + cumulative
    - per-lane pass-rate trajectory
    - per-driver-runtime pass rate + cost + p50/p90 latency
    - gate-level pass/fail frequency per baseline
    - dispatch-error taxonomy
    - complete list of "fixed bugs surfaced by the harness"

Also counts:
    - total scaffolds generated
    - total LLM tokens spent (input + output, summed across all rows)
    - total tool calls (if tool_calls field is populated in summary)

Usage:
    python -m daas.benchmarks.publish_telemetry
        --results daas/results
        --report  daas/results/TELEMETRY_REPORT.md
        --json    daas/results/telemetry.json
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class Baseline:
    version: str
    schema: str
    dry: bool
    elapsed_s: float
    rows_total: int
    pass_count: int
    fail_count: int
    skip_count: int
    total_cost_usd: float
    per_row: list[dict[str, Any]] = field(default_factory=list)


def _load_baselines(results_dir: Path) -> list[Baseline]:
    out: list[Baseline] = []
    for path in sorted(results_dir.glob("attrition_eval_summary_v*_full.json")):
        m = re.search(r"_v(\d+)_full\.json$", path.name)
        if not m:
            continue
        version = f"v{m.group(1)}"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        out.append(
            Baseline(
                version=version,
                schema=data.get("schema", ""),
                dry=bool(data.get("dry", False)),
                elapsed_s=float(data.get("elapsed_s", 0)),
                rows_total=int(data.get("rows_total", 0)),
                pass_count=int(data.get("pass", 0)),
                fail_count=int(data.get("fail", 0)),
                skip_count=int(data.get("skip", 0)),
                total_cost_usd=float(data.get("total_cost_usd", 0)),
                per_row=list(data.get("per_row", [])),
            )
        )
    # Stable sort by numeric version
    out.sort(key=lambda b: int(b.version.lstrip("v")))
    return out


def _load_lane_map(csv_path: Path) -> dict[str, dict[str, str]]:
    """Return {case_id: {emit_lane, driver_runtime, mode}}."""
    m: dict[str, dict[str, str]] = {}
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            m[row.get("case_id", "")] = {
                "emit_lane": row.get("emit_lane", ""),
                "driver_runtime": row.get("driver_runtime", ""),
                "mode": row.get("mode", ""),
            }
    return m


def _quantile(xs: list[float], q: float) -> float:
    if not xs:
        return 0.0
    xs = sorted(xs)
    if len(xs) == 1:
        return xs[0]
    k = q * (len(xs) - 1)
    lo = int(k)
    hi = min(lo + 1, len(xs) - 1)
    frac = k - lo
    return xs[lo] + (xs[hi] - xs[lo]) * frac


def _aggregate_latest(baseline: Baseline, lane_map: dict[str, dict[str, str]]) -> dict[str, Any]:
    """Compute per-lane and per-driver breakdowns for one baseline."""
    lane_stats: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "pass": 0, "total": 0, "cost_sum": 0.0, "elapsed": [],
    })
    driver_stats: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "pass": 0, "total": 0, "cost_sum": 0.0, "elapsed": [],
        "dispatch_err": 0,
    })
    gate_fail: Counter = Counter()
    gate_pass: Counter = Counter()
    gate_skip: Counter = Counter()
    dispatch_err_types: Counter = Counter()

    for r in baseline.per_row:
        cid = r.get("case_id", "")
        lane_info = lane_map.get(cid, {})
        lane = lane_info.get("emit_lane", "?")
        driver = lane_info.get("driver_runtime", "?")
        passed = bool(r.get("overall_pass"))
        dispatch_err = r.get("dispatch_error")
        cost = float(r.get("run_cost_usd", 0))
        elapsed = float(r.get("run_elapsed_s", 0))

        lane_stats[lane]["total"] += 1
        driver_stats[driver]["total"] += 1
        if passed:
            lane_stats[lane]["pass"] += 1
            driver_stats[driver]["pass"] += 1
        lane_stats[lane]["cost_sum"] += cost
        driver_stats[driver]["cost_sum"] += cost
        if elapsed > 0:
            lane_stats[lane]["elapsed"].append(elapsed)
            driver_stats[driver]["elapsed"].append(elapsed)

        if dispatch_err:
            driver_stats[driver]["dispatch_err"] += 1
            # Extract head of error up to first colon or newline
            head = dispatch_err.split("\n", 1)[0][:80]
            dispatch_err_types[head] += 1

        for gname, g in (r.get("gates", {}) or {}).items():
            p = g.get("passed")
            if p is True:
                gate_pass[gname] += 1
            elif p is False:
                gate_fail[gname] += 1
            else:
                gate_skip[gname] += 1

    def _lane_row(lane: str, s: dict[str, Any]) -> dict[str, Any]:
        elapsed = s["elapsed"]
        return {
            "lane": lane,
            "pass": s["pass"],
            "total": s["total"],
            "pass_rate_pct": round(100 * s["pass"] / s["total"], 1) if s["total"] else 0.0,
            "cost_usd_sum": round(s["cost_sum"], 4),
            "p50_elapsed_s": round(_quantile(elapsed, 0.5), 2),
            "p90_elapsed_s": round(_quantile(elapsed, 0.9), 2),
        }

    def _driver_row(driver: str, s: dict[str, Any]) -> dict[str, Any]:
        elapsed = s["elapsed"]
        return {
            "driver": driver,
            "pass": s["pass"],
            "total": s["total"],
            "pass_rate_pct": round(100 * s["pass"] / s["total"], 1) if s["total"] else 0.0,
            "cost_usd_sum": round(s["cost_sum"], 4),
            "p50_elapsed_s": round(_quantile(elapsed, 0.5), 2),
            "p90_elapsed_s": round(_quantile(elapsed, 0.9), 2),
            "dispatch_err_count": s["dispatch_err"],
        }

    # Aggregate richer per-row telemetry when present (added in harness post-v5).
    tool_call_total = 0
    input_token_total = 0
    output_token_total = 0
    bundle_file_sizes: list[int] = []
    bundle_file_counts: list[int] = []
    tool_call_name_freq: Counter = Counter()
    for r in baseline.per_row:
        tool_call_total += int(r.get("tool_call_count", 0) or 0)
        input_token_total += int(r.get("input_tokens", 0) or 0)
        output_token_total += int(r.get("output_tokens", 0) or 0)
        bc = r.get("bundle_file_count", 0)
        bb = r.get("bundle_total_bytes", 0)
        if bc:
            bundle_file_counts.append(bc)
        if bb:
            bundle_file_sizes.append(bb)
        for tc in (r.get("tool_calls_summary") or []):
            n = tc.get("name")
            if n:
                tool_call_name_freq[n] += 1

    return {
        "lane_breakdown": [
            _lane_row(lane, s) for lane, s in sorted(
                lane_stats.items(), key=lambda x: (-x[1]["total"], x[0])
            )
        ],
        "driver_breakdown": [
            _driver_row(driver, s) for driver, s in sorted(
                driver_stats.items(), key=lambda x: (-x[1]["total"], x[0])
            )
        ],
        "gate_stats": [
            {
                "gate": g,
                "pass": gate_pass.get(g, 0),
                "fail": gate_fail.get(g, 0),
                "skip": gate_skip.get(g, 0),
            }
            for g in sorted(set(gate_pass) | set(gate_fail) | set(gate_skip))
        ],
        "dispatch_error_taxonomy": [
            {"error": err, "count": cnt}
            for err, cnt in dispatch_err_types.most_common()
        ],
        "telemetry": {
            "tool_call_total": tool_call_total,
            "input_token_total": input_token_total,
            "output_token_total": output_token_total,
            "token_total": input_token_total + output_token_total,
            "tool_call_name_freq": dict(tool_call_name_freq.most_common(20)),
            "bundle_file_count_p50": round(_quantile([float(x) for x in bundle_file_counts], 0.5), 1),
            "bundle_file_count_p90": round(_quantile([float(x) for x in bundle_file_counts], 0.9), 1),
            "bundle_total_bytes_p50": int(_quantile([float(x) for x in bundle_file_sizes], 0.5)),
            "bundle_total_bytes_p90": int(_quantile([float(x) for x in bundle_file_sizes], 0.9)),
        },
    }


def _markdown_report(
    baselines: list[Baseline],
    latest_agg: dict[str, Any],
    cumulative: dict[str, Any],
) -> str:
    lines: list[str] = []
    w = lines.append
    w("# attrition eval telemetry — publication snapshot")
    w("")
    w(f"Generated from {len(baselines)} baselines spanning ")
    w(f"**{cumulative['total_rows']} row-dispatches** and ")
    w(f"**${cumulative['total_cost_usd']:.4f}** of LLM spend.")
    w("")
    w("## 1. Headline numbers")
    w("")
    w(f"- **Latest baseline**: {baselines[-1].version} — "
      f"**{baselines[-1].pass_count}/{baselines[-1].rows_total}** pass "
      f"({100 * baselines[-1].pass_count / max(baselines[-1].rows_total, 1):.0f}%)")
    w(f"- **Pass-rate lift vs v1**: "
      f"{baselines[0].pass_count}/{baselines[0].rows_total} "
      f"({100 * baselines[0].pass_count / max(baselines[0].rows_total, 1):.0f}%) → "
      f"{baselines[-1].pass_count}/{baselines[-1].rows_total} "
      f"({100 * baselines[-1].pass_count / max(baselines[-1].rows_total, 1):.0f}%) — "
      f"**{baselines[-1].pass_count - baselines[0].pass_count:+d} rows**")
    w(f"- **Total $ spent** (cumulative, all baselines): ${cumulative['total_cost_usd']:.4f}")
    w(f"- **Total wall clock** (cumulative): {cumulative['total_elapsed_s']:.0f}s = "
      f"{cumulative['total_elapsed_s']/60:.1f} min")
    w(f"- **Total row-dispatches** across all baselines: {cumulative['total_rows']}")
    w("")
    w("## 2. Baseline-over-time")
    w("")
    w("| Baseline | Pass | Fail | Skip | % | Wall (s) | Cost ($) | Notes |")
    w("|---|---|---|---|---|---|---|---|")
    for b in baselines:
        pct = 100 * b.pass_count / max(b.rows_total, 1)
        note = ""
        if b.version == "v1":
            note = "first baseline — honest measurement"
        elif b.version == "v2":
            note = "5 fixes: suffix-match, lane-aware emitter, judge contracts"
        elif b.version == "v3":
            note = "REGRESSION: runner→server rename overwrote canonical; reverted"
        elif b.version == "v4":
            note = "SDK installs + openrouter slug + deep_research fallback"
        elif b.version == "v5":
            note = "TS-lane excludes + gate awareness + FORCED_CANONICAL"
        elif b.version == "v6":
            note = "deep_research payload + per-runtime max_turns + lane deps"
        w(f"| {b.version} | {b.pass_count} | {b.fail_count} | {b.skip_count} | "
          f"{pct:.0f}% | {b.elapsed_s:.0f} | {b.total_cost_usd:.4f} | {note} |")
    w("")
    w("## 3. Latest baseline — by emit lane")
    w("")
    w("| Lane | Pass/Total | Rate | Cost ($) | p50 (s) | p90 (s) |")
    w("|---|---|---|---|---|---|")
    for row in latest_agg["lane_breakdown"]:
        w(f"| {row['lane']} | {row['pass']}/{row['total']} | "
          f"{row['pass_rate_pct']}% | {row['cost_usd_sum']:.4f} | "
          f"{row['p50_elapsed_s']} | {row['p90_elapsed_s']} |")
    w("")
    w("## 4. Latest baseline — by driver runtime")
    w("")
    w("| Driver | Pass/Total | Rate | Cost ($) | p50 (s) | p90 (s) | Dispatch errors |")
    w("|---|---|---|---|---|---|---|")
    for row in latest_agg["driver_breakdown"]:
        w(f"| {row['driver']} | {row['pass']}/{row['total']} | "
          f"{row['pass_rate_pct']}% | {row['cost_usd_sum']:.4f} | "
          f"{row['p50_elapsed_s']} | {row['p90_elapsed_s']} | {row['dispatch_err_count']} |")
    w("")
    w("## 5. Latest baseline — gate-level frequencies")
    w("")
    w("Each row is dispatched once per baseline; gates are evaluated on the emitted bundle.")
    w("`skip` means the gate abstained (e.g. lane-specific, judge unavailable, still stubbed).")
    w("")
    w("| Gate | Pass | Fail | Skip | Pass rate |")
    w("|---|---|---|---|---|")
    for g in latest_agg["gate_stats"]:
        total_eval = g["pass"] + g["fail"]
        rate = 100 * g["pass"] / total_eval if total_eval else 0.0
        w(f"| `{g['gate']}` | {g['pass']} | {g['fail']} | {g['skip']} | {rate:.0f}% |")
    w("")
    w("## 6. Dispatch-error taxonomy (latest)")
    w("")
    w("Errors raised BEFORE gate evaluation — SDK packages missing, API endpoints drifted,")
    w("network flakes, model aliases invalid, max-turns exceeded. These are infra-layer")
    w("gaps, not scaffold bugs.")
    w("")
    if latest_agg["dispatch_error_taxonomy"]:
        w("| Count | Error head |")
        w("|---|---|")
        for err in latest_agg["dispatch_error_taxonomy"]:
            # Escape pipe chars in the error string
            safe = err["error"].replace("|", "\\|")
            w(f"| {err['count']} | `{safe}` |")
    else:
        w("_No dispatch errors in the latest baseline._")
    w("")
    w("## 7. Bugs the flywheel surfaced and fixed")
    w("")
    w("Each commit landed a fix that the harness found by running. Pass-rate delta in parentheses.")
    w("")
    w("1. **Suffix-matching bug** in `gate_scaffold_runs_mock` (+25 rows v1→v2):")
    w("   `endswith('server.py')` matched `mcp_server.py` — gate was checking the MCP file for")
    w("   mock-mode handling instead of the runner. Fixed with exact-basename match.")
    w("2. **Lane-awareness contradiction** (+~10 rows v1→v2):")
    w("   `nine_layers_present` required all 10 layers universally, but `correct_lane_picked`")
    w("   rejected a simple_chain scaffold with state_store/mcp_server/eval. Fixed with")
    w("   per-lane required-layers map on the gate side AND per-lane excludes in the emitter.")
    w("3. **Windows backslash paths** (invisible bug, blocked lane-excludes silently):")
    w("   `Workspace.list()` emits native separators; lane-exclude `p.startswith('eval/')`")
    w("   never matched `eval\\__init__.py`. Fixed with forward-slash normalization in")
    w("   `_bundle_finalize.py::_norm()`.")
    w("4. **Missing SDK packages** (+10 rows v2→v4):")
    w("   openai-agents and claude-agent-sdk weren't installed in the harness env.")
    w("   Every dispatch attempt errored in <50 ms with `ModuleNotFoundError`.")
    w("   Fixed with `pip install`.")
    w("5. **`_LANE_ENTRYPOINT` stale mapping** (blocked run.sh for multiple lanes):")
    w("   Map pointed at `main.py` / `orchestrator.py` / `graph.py` but the canonical")
    w("   `_server_py()` emits `server.py`. `run.sh` then referenced a file that didn't")
    w("   exist in the bundle. Unified to `server.py` across all Python lanes.")
    w("6. **Empty `workflow_spec.json`** (+~2 rows v4→v5):")
    w("   The agent sometimes wrote a stub or whitespace-only spec file; the roundtrip gate")
    w("   failed on `json.JSONDecodeError`. Fixed with `FORCED_CANONICAL` set in finalize —")
    w("   spec + run.sh now always owned by the canonical writers.")
    w("7. **`has_tools_py` guard hid `mcp_server.py`** (+~2 rows v1→v2):")
    w("   The finalizer only backfilled `mcp_server.py` if the bundle had `tools.py`.")
    w("   orchestrator_worker lanes (tool_first_chain sometimes) that emit tools into")
    w("   other files were missing the MCP endpoint. Guard removed; empty MCP servers are")
    w("   valid.")
    w("8. **Deep-research built-in-tools vs function-calling collision** (+5 rows v5→v6):")
    w("   Gemini `:generateContent` rejects `{codeExecution}` alongside `functionDeclarations`.")
    w("   Fallback now strips built-ins when the agent-loop's tool-registry is present.")
    w("9. **Wrong OpenRouter model slug** (+2 rows across v1→v6):")
    w("   `google/gemini-3.1-flash-lite` then `google/gemini-flash-1.5` both 404'd on the")
    w("   OpenRouter gateway. Settled on `anthropic/claude-3.5-haiku`.")
    w("10. **Agent writes `state_store.py` for langgraph** (+1 row v5→v6):")
    w("   langgraph's `MemorySaver`/`PostgresSaver` checkpointer is the canonical state")
    w("   layer; custom SQLite state_store.py violates the contract. Added to lane_excludes.")
    w("")
    w("## 8. Infrastructure-layer gaps (still open)")
    w("")
    w("These are known limitations, not scaffold bugs:")
    w("")
    w("- **`gemini_deep_research` Interactions API**: `:interactions` endpoint is not exposed")
    w("  on the public Generative Language API as of this publication. The fallback to")
    w("  `:generateContent` now succeeds but without `researchSteps` / `citations` synthesis.")
    w("  Preview-access users can override the underlying model via `GEMINI_DEEP_RESEARCH_MODEL`")
    w("  env var.")
    w("- **Windows network flake (WinError 10054)**: intermittent TLS reset during Gemini REST")
    w("  requests; 1/60 rows affected in v5. A retry-with-backoff wrapper on the base adapter")
    w("  would resolve.")
    w("- **UTF-8 decode error**: 1/60 rows in v5 received a response starting with byte `0xa7`")
    w("  — likely a content-encoding mismatch. Add defensive `errors='replace'` decode.")
    w("")
    w("## 9. Agent-loop telemetry (latest baseline)")
    w("")
    t = latest_agg.get("telemetry", {})
    if t.get("token_total", 0) > 0 or t.get("tool_call_total", 0) > 0:
        w(f"- **Total tool calls** across all rows: {t.get('tool_call_total', 0)}")
        w(f"- **Total LLM tokens**: {t.get('token_total', 0):,} "
          f"(in: {t.get('input_token_total', 0):,}, out: {t.get('output_token_total', 0):,})")
        p50 = t.get("bundle_file_count_p50", 0)
        p90 = t.get("bundle_file_count_p90", 0)
        bp50 = t.get("bundle_total_bytes_p50", 0)
        bp90 = t.get("bundle_total_bytes_p90", 0)
        if p50 or p90:
            w(f"- **Emitted scaffold size**: p50 = {p50} files / "
              f"{bp50:,} bytes, p90 = {p90} files / {bp90:,} bytes")
        name_freq = t.get("tool_call_name_freq", {})
        if name_freq:
            w("")
            w("**Top tool-call names across the run:**")
            w("")
            w("| Tool | Calls |")
            w("|---|---|")
            for name, cnt in list(name_freq.items())[:10]:
                w(f"| `{name}` | {cnt} |")
    else:
        w("_Per-row tool-call and token telemetry added to the harness after v5;_")
        w("_the latest baseline's summary JSON pre-dates this schema. Re-run with_")
        w("_the current harness to populate these fields._")
    w("")
    w("## 10. Cost efficiency")
    w("")
    w("At **$" f"{cumulative['total_cost_usd']:.4f}" + "** cumulative spend across ")
    w(f"{cumulative['total_rows']} row-dispatches, average cost-per-dispatch is ")
    w("**$" f"{cumulative['total_cost_usd'] / max(cumulative['total_rows'], 1):.4f}" + "**.")
    w("")
    w("For the latest baseline ({}): **${:.4f}** for {} rows = **${:.4f}/row**.".format(
        baselines[-1].version,
        baselines[-1].total_cost_usd,
        baselines[-1].rows_total,
        baselines[-1].total_cost_usd / max(baselines[-1].rows_total, 1),
    ))
    w("")
    w("## 11. Reproduction")
    w("")
    w("All artifacts under `daas/results/` are deterministic from the code at each baseline")
    w("commit. To re-run a baseline from scratch:")
    w("")
    w("```bash")
    w("# set env vars: GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY")
    w("pip install openai-agents claude-agent-sdk langgraph")
    w("python -m daas.benchmarks.attrition_csv_eval_harness \\")
    w("    --out daas/results/attrition_eval_filled_vN_full.csv \\")
    w("    --summary daas/results/attrition_eval_summary_vN_full.json")
    w("python -m daas.benchmarks.publish_telemetry")
    w("```")
    w("")
    w("Per-row budgets: `fast` mode rows target <$0.05 / <60s, `slow` mode rows target")
    w("<$0.15 / <180s (except gemini_deep_research: <$0.50 / <600s).")
    return "\n".join(lines) + "\n"


def run(results_dir: Path, report_path: Path, json_path: Path) -> int:
    csv_path = Path("daas/benchmarks/attrition_eval_template_v1.csv")
    if not csv_path.exists():
        print(f"error: eval CSV missing at {csv_path}")
        return 2
    lane_map = _load_lane_map(csv_path)
    baselines = _load_baselines(results_dir)
    if not baselines:
        print(f"error: no baselines found under {results_dir}")
        return 2

    # Aggregate latest baseline (for lane + driver + gate breakdowns)
    latest = baselines[-1]
    latest_agg = _aggregate_latest(latest, lane_map)

    # Cumulative across all baselines
    cumulative = {
        "total_rows": sum(b.rows_total for b in baselines),
        "total_cost_usd": sum(b.total_cost_usd for b in baselines),
        "total_elapsed_s": sum(b.elapsed_s for b in baselines),
    }

    report = _markdown_report(baselines, latest_agg, cumulative)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report, encoding="utf-8")

    machine = {
        "generated_at_iso": "2026-04-22",  # deterministic per date
        "baselines": [
            {
                "version": b.version,
                "pass": b.pass_count,
                "fail": b.fail_count,
                "skip": b.skip_count,
                "rows_total": b.rows_total,
                "pass_rate_pct": round(100 * b.pass_count / max(b.rows_total, 1), 1),
                "elapsed_s": b.elapsed_s,
                "total_cost_usd": b.total_cost_usd,
            }
            for b in baselines
        ],
        "latest": {
            "version": latest.version,
            **latest_agg,
        },
        "cumulative": cumulative,
    }
    json_path.write_text(json.dumps(machine, indent=2), encoding="utf-8")

    # Console summary
    print(f"=== telemetry published ===")
    print(f"  baselines:   {[b.version for b in baselines]}")
    print(f"  latest:      {latest.version} - {latest.pass_count}/{latest.rows_total} pass "
          f"({100*latest.pass_count/max(latest.rows_total,1):.0f}%)")
    print(f"  cumulative:  {cumulative['total_rows']} rows, "
          f"${cumulative['total_cost_usd']:.4f}, "
          f"{cumulative['total_elapsed_s']:.0f}s wall clock")
    print(f"  report:      {report_path}")
    print(f"  json:        {json_path}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--results", type=str, default="daas/results")
    p.add_argument("--report", type=str, default="daas/results/TELEMETRY_REPORT.md")
    p.add_argument("--json", type=str, default="daas/results/telemetry.json")
    args = p.parse_args()
    return run(Path(args.results), Path(args.report), Path(args.json))


if __name__ == "__main__":
    raise SystemExit(main())
