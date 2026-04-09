#!/usr/bin/env python3
"""Compare two benchmark sessions or directories (with vs without attrition).

Produces token, time, correction, completion, and cost deltas.

Usage:
    python compare.py --baseline session_a.jsonl --attrition session_b.jsonl
    python compare.py --baseline-dir ./without/ --attrition-dir ./with/
    python compare.py --sample            # generate sample data and compare
    python compare.py --sample --markdown  # markdown table output
    python compare.py --sample --json      # JSON output for landing page
"""

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from record_session import analyze_session, analyze_directory, generate_mock_session


def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def aggregate_analyses(analyses: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate multiple session analyses into summary stats."""
    if not analyses:
        return {
            "sessions": 0,
            "avg_tokens": 0,
            "avg_input_tokens": 0,
            "avg_output_tokens": 0,
            "avg_wall_clock_seconds": 0,
            "avg_tool_calls": 0,
            "avg_corrections": 0,
            "avg_completion_score": 0,
            "avg_cost_usd": 0,
            "total_tokens": 0,
            "total_cost_usd": 0,
        }

    return {
        "sessions": len(analyses),
        "avg_tokens": round(_avg([a["total_tokens"] for a in analyses])),
        "avg_input_tokens": round(_avg([a["total_input_tokens"] for a in analyses])),
        "avg_output_tokens": round(_avg([a["total_output_tokens"] for a in analyses])),
        "avg_wall_clock_seconds": round(_avg([a["wall_clock_seconds"] for a in analyses]), 1),
        "avg_tool_calls": round(_avg([a["tool_call_count"] for a in analyses]), 1),
        "avg_corrections": round(_avg([a["correction_count"] for a in analyses]), 2),
        "avg_completion_score": round(_avg([a["completion_score"] for a in analyses]), 3),
        "avg_cost_usd": round(_avg([a["estimated_cost_usd"] for a in analyses]), 4),
        "total_tokens": sum(a["total_tokens"] for a in analyses),
        "total_cost_usd": round(sum(a["estimated_cost_usd"] for a in analyses), 4),
    }


def compare(baseline: dict[str, Any], attrition: dict[str, Any]) -> dict[str, Any]:
    """Compare aggregated baseline vs attrition stats."""
    def delta_pct(base: float, improved: float) -> float:
        if base == 0:
            return 0.0
        return round(((base - improved) / base) * 100, 1)

    return {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "baseline": baseline,
        "attrition": attrition,
        "deltas": {
            "token_savings_pct": delta_pct(baseline["avg_tokens"], attrition["avg_tokens"]),
            "token_delta": baseline["avg_tokens"] - attrition["avg_tokens"],
            "time_savings_pct": delta_pct(baseline["avg_wall_clock_seconds"], attrition["avg_wall_clock_seconds"]),
            "time_delta_seconds": round(baseline["avg_wall_clock_seconds"] - attrition["avg_wall_clock_seconds"], 1),
            "correction_delta": round(baseline["avg_corrections"] - attrition["avg_corrections"], 2),
            "correction_reduction_pct": delta_pct(baseline["avg_corrections"], attrition["avg_corrections"]),
            "completion_delta": round(attrition["avg_completion_score"] - baseline["avg_completion_score"], 3),
            "cost_savings_pct": delta_pct(baseline["avg_cost_usd"], attrition["avg_cost_usd"]),
            "cost_delta_usd": round(baseline["avg_cost_usd"] - attrition["avg_cost_usd"], 4),
        },
    }


def generate_sample_data() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Generate realistic sample baseline + attrition session data."""
    import random

    random.seed(42)

    baseline_analyses: list[dict[str, Any]] = []
    attrition_analyses: list[dict[str, Any]] = []

    task_profiles = [
        {"name": "add-dark-mode",           "base_tokens": 32000, "base_time": 600, "base_corrections": 2},
        {"name": "fix-login-validation",    "base_tokens": 18000, "base_time": 300, "base_corrections": 1},
        {"name": "refactor-async-client",   "base_tokens": 52000, "base_time": 900, "base_corrections": 3},
        {"name": "add-auth-tests",          "base_tokens": 28000, "base_time": 480, "base_corrections": 2},
        {"name": "update-landing-deploy",   "base_tokens": 48000, "base_time": 840, "base_corrections": 3},
        {"name": "add-api-endpoint",        "base_tokens": 30000, "base_time": 540, "base_corrections": 2},
        {"name": "fix-css-layout",          "base_tokens": 16000, "base_time": 240, "base_corrections": 1},
        {"name": "migrate-database-schema", "base_tokens": 55000, "base_time": 960, "base_corrections": 4},
        {"name": "implement-search",        "base_tokens": 50000, "base_time": 900, "base_corrections": 3},
        {"name": "security-audit-fix",      "base_tokens": 45000, "base_time": 780, "base_corrections": 3},
    ]

    for task in task_profiles:
        # Baseline (without attrition)
        jitter = random.uniform(0.9, 1.1)
        base_input = int(task["base_tokens"] * 0.65 * jitter)
        base_output = int(task["base_tokens"] * 0.35 * jitter)
        base_steps = random.randint(4, 6)

        baseline_analyses.append({
            "file": f"baseline_{task['name']}.jsonl",
            "model": "claude-sonnet-4-6",
            "total_input_tokens": base_input,
            "total_output_tokens": base_output,
            "total_tokens": base_input + base_output,
            "wall_clock_seconds": round(task["base_time"] * jitter, 1),
            "tool_call_count": random.randint(12, 30),
            "tool_breakdown": {"Bash": 5, "Edit": 4, "Read": 3, "Grep": 2},
            "correction_count": task["base_corrections"],
            "corrections": [f"correction_{i}" for i in range(task["base_corrections"])],
            "step_evidence": {s: (i < base_steps) for i, s in enumerate(
                ["search", "read", "edit", "test", "build", "preview", "commit", "qa_check"]
            )},
            "steps_with_evidence": base_steps,
            "completion_score": round(base_steps / 8, 3),
            "estimated_cost_usd": round((base_input / 1e6) * 3.0 + (base_output / 1e6) * 15.0, 4),
        })

        # Attrition (with enforcement)
        savings = random.uniform(0.25, 0.40)
        att_input = int(base_input * (1 - savings))
        att_output = int(base_output * (1 - savings * 0.8))
        att_corrections = max(0, task["base_corrections"] - random.randint(1, task["base_corrections"]))
        att_steps = min(8, base_steps + random.randint(1, 3))

        attrition_analyses.append({
            "file": f"attrition_{task['name']}.jsonl",
            "model": "claude-sonnet-4-6",
            "total_input_tokens": att_input,
            "total_output_tokens": att_output,
            "total_tokens": att_input + att_output,
            "wall_clock_seconds": round(task["base_time"] * (1 - savings * 0.7) * jitter, 1),
            "tool_call_count": random.randint(10, 22),
            "tool_breakdown": {"Bash": 4, "Edit": 3, "Read": 3, "Grep": 2},
            "correction_count": att_corrections,
            "corrections": [f"correction_{i}" for i in range(att_corrections)],
            "step_evidence": {s: (i < att_steps) for i, s in enumerate(
                ["search", "read", "edit", "test", "build", "preview", "commit", "qa_check"]
            )},
            "steps_with_evidence": att_steps,
            "completion_score": round(att_steps / 8, 3),
            "estimated_cost_usd": round((att_input / 1e6) * 3.0 + (att_output / 1e6) * 15.0, 4),
        })

    return baseline_analyses, attrition_analyses


def format_comparison_table(result: dict[str, Any]) -> str:
    """Format comparison as a readable text table."""
    b = result["baseline"]
    a = result["attrition"]
    d = result["deltas"]

    lines: list[str] = []
    lines.append("=" * 70)
    lines.append("  BENCHMARK COMPARISON: Baseline vs Attrition")
    lines.append("=" * 70)
    lines.append("")
    lines.append(f"  {'Metric':<28} {'Baseline':>14} {'Attrition':>14} {'Delta':>10}")
    lines.append(f"  {'-' * 28} {'-' * 14} {'-' * 14} {'-' * 10}")
    lines.append(f"  {'Sessions':<28} {b['sessions']:>14} {a['sessions']:>14} {'':>10}")
    lines.append(f"  {'Avg tokens':<28} {b['avg_tokens']:>14,} {a['avg_tokens']:>14,} {d['token_savings_pct']:>+9.1f}%")
    lines.append(f"  {'Avg time (sec)':<28} {b['avg_wall_clock_seconds']:>14.1f} {a['avg_wall_clock_seconds']:>14.1f} {d['time_savings_pct']:>+9.1f}%")
    lines.append(f"  {'Avg corrections':<28} {b['avg_corrections']:>14.2f} {a['avg_corrections']:>14.2f} {d['correction_reduction_pct']:>+9.1f}%")
    lines.append(f"  {'Avg completion':<28} {b['avg_completion_score']:>13.1%} {a['avg_completion_score']:>13.1%} {d['completion_delta']:>+9.3f}")
    base_cost_str = f"${b['avg_cost_usd']:.4f}"
    att_cost_str = f"${a['avg_cost_usd']:.4f}"
    lines.append(f"  {'Avg cost (USD)':<28} {base_cost_str:>14} {att_cost_str:>14} {d['cost_savings_pct']:>+9.1f}%")
    lines.append("")
    lines.append(f"  Token savings:      {d['token_savings_pct']:.1f}% ({d['token_delta']:,} tokens/session)")
    lines.append(f"  Time savings:       {d['time_savings_pct']:.1f}% ({d['time_delta_seconds']:.0f}s/session)")
    lines.append(f"  Correction savings: {d['correction_reduction_pct']:.1f}% ({d['correction_delta']:.1f} fewer/session)")
    lines.append(f"  Cost savings:       {d['cost_savings_pct']:.1f}% (${d['cost_delta_usd']:.4f}/session)")
    lines.append("")

    return "\n".join(lines)


def format_markdown(result: dict[str, Any]) -> str:
    """Format comparison as a markdown table."""
    b = result["baseline"]
    a = result["attrition"]
    d = result["deltas"]

    lines: list[str] = []
    lines.append("## Benchmark Comparison: Baseline vs Attrition")
    lines.append("")
    lines.append(f"| Metric | Baseline | With Attrition | Delta |")
    lines.append(f"|--------|----------|----------------|-------|")
    lines.append(f"| Sessions | {b['sessions']} | {a['sessions']} | - |")
    lines.append(f"| Avg tokens | {b['avg_tokens']:,} | {a['avg_tokens']:,} | **{d['token_savings_pct']:+.1f}%** |")
    lines.append(f"| Avg time (sec) | {b['avg_wall_clock_seconds']:.1f} | {a['avg_wall_clock_seconds']:.1f} | **{d['time_savings_pct']:+.1f}%** |")
    lines.append(f"| Avg corrections | {b['avg_corrections']:.2f} | {a['avg_corrections']:.2f} | **{d['correction_reduction_pct']:+.1f}%** |")
    lines.append(f"| Avg completion | {b['avg_completion_score']:.1%} | {a['avg_completion_score']:.1%} | **{d['completion_delta']:+.3f}** |")
    lines.append(f"| Avg cost (USD) | ${b['avg_cost_usd']:.4f} | ${a['avg_cost_usd']:.4f} | **{d['cost_savings_pct']:+.1f}%** |")
    lines.append("")
    lines.append(f"**Summary:** {d['token_savings_pct']:.0f}% fewer tokens, {d['time_savings_pct']:.0f}% less time, "
                 f"{d['correction_reduction_pct']:.0f}% fewer corrections")
    lines.append("")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare two benchmark sessions or directories."
    )
    parser.add_argument("--baseline", type=str, help="Path to baseline session JSONL")
    parser.add_argument("--attrition", type=str, help="Path to attrition session JSONL")
    parser.add_argument("--baseline-dir", type=str, help="Directory of baseline sessions")
    parser.add_argument("--attrition-dir", type=str, help="Directory of attrition sessions")
    parser.add_argument("--sample", action="store_true", help="Generate sample data and compare")
    parser.add_argument("--markdown", action="store_true", help="Output as markdown table")
    parser.add_argument("--json", type=str, nargs="?", const="-", help="Output as JSON (optionally to file)")
    args = parser.parse_args()

    if not any([args.baseline, args.baseline_dir, args.sample]):
        parser.print_help()
        sys.exit(1)

    if args.sample:
        baseline_list, attrition_list = generate_sample_data()
    elif args.baseline and args.attrition:
        baseline_list = [analyze_session(args.baseline)]
        attrition_list = [analyze_session(args.attrition)]
    elif args.baseline_dir and args.attrition_dir:
        baseline_list = analyze_directory(args.baseline_dir)
        attrition_list = analyze_directory(args.attrition_dir)
    else:
        print("Error: provide --baseline + --attrition, --baseline-dir + --attrition-dir, or --sample",
              file=sys.stderr)
        sys.exit(1)

    baseline_agg = aggregate_analyses(baseline_list)
    attrition_agg = aggregate_analyses(attrition_list)
    result = compare(baseline_agg, attrition_agg)

    if args.json is not None:
        output = json.dumps(result, indent=2)
        if args.json == "-":
            print(output)
        else:
            Path(args.json).write_text(output, encoding="utf-8")
            print(f"JSON written to {args.json}")
    elif args.markdown:
        print(format_markdown(result))
    else:
        print(format_comparison_table(result))


if __name__ == "__main__":
    main()
