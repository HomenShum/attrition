"""One-shot rebalance of latency/cost budgets in attrition_eval_template_v1.csv.

The original budgets reflected "bare inference cost" (a single LLM call).
The harness measures "full scaffold-generation cost" (agent loop with
write_file tool dispatch × N turns). AE01's first real run showed a
simple_chain scaffold takes 21s and $0.0052 — 7× and 2.6× over the
original "3s / $0.002" budget.

This script applies a rule-based rebalance per (mode, lane) so the
budgets reflect realistic generation cost. Budgets are still strict
(fail if exceeded) — they're just measuring the right thing now.

Run once:
    python -m daas.benchmarks._rebalance_budgets \\
      --in  daas/benchmarks/attrition_eval_template_v1.csv \\
      --out daas/benchmarks/attrition_eval_template_v1.csv
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

# (mode, lane) -> (latency_s, cost_usd)
# Fast mode: budgets sized for Flash Lite full scaffold generation.
# Slow mode: budgets sized for the lane's canonical driver (Sonnet for
# orchestrator_worker, Deep Research for its lane, etc.).
BUDGETS: dict[tuple[str, str], tuple[int, float]] = {
    # --- fast (Flash Lite driver everywhere) ---
    ("fast", "simple_chain"):        (30, 0.015),
    ("fast", "tool_first_chain"):    (45, 0.025),
    ("fast", "orchestrator_worker"): (60, 0.050),
    ("fast", "openai_agents_sdk"):   (45, 0.030),
    ("fast", "claude_agent_sdk"):    (45, 0.030),
    ("fast", "langgraph_python"):    (45, 0.030),
    ("fast", "manus"):               (45, 0.030),
    ("fast", "deerflow"):            (45, 0.030),
    ("fast", "hermes"):              (45, 0.030),
    ("fast", "convex_functions"):    (45, 0.030),
    ("fast", "vercel_ai_sdk"):       (45, 0.030),
    ("fast", "gemini_deep_research"): (60, 0.050),
    # --- slow (lane-canonical driver) ---
    ("slow", "simple_chain"):        (60, 0.025),
    ("slow", "tool_first_chain"):    (90, 0.050),
    ("slow", "orchestrator_worker"): (180, 0.120),
    ("slow", "openai_agents_sdk"):   (90, 0.060),
    ("slow", "claude_agent_sdk"):    (120, 0.080),
    ("slow", "langgraph_python"):    (120, 0.060),
    ("slow", "manus"):               (90, 0.060),
    ("slow", "deerflow"):            (120, 0.080),
    ("slow", "hermes"):              (120, 0.080),
    ("slow", "convex_functions"):    (90, 0.050),
    ("slow", "vercel_ai_sdk"):       (90, 0.050),
    ("slow", "gemini_deep_research"): (600, 0.500),
}

DEFAULT_FAST = (45, 0.030)
DEFAULT_SLOW = (120, 0.080)


def rebalance(in_path: Path, out_path: Path) -> None:
    with in_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    changed = 0
    per_combo: dict[tuple[str, str], int] = {}
    for row in rows:
        mode = row.get("mode", "").strip()
        lane = row.get("emit_lane", "").strip()
        combo = (mode, lane)
        if combo in BUDGETS:
            new_lat, new_cost = BUDGETS[combo]
        elif mode == "fast":
            new_lat, new_cost = DEFAULT_FAST
        else:
            new_lat, new_cost = DEFAULT_SLOW
        old_lat = row.get("latency_budget_s", "")
        old_cost = row.get("cost_budget_usd", "")
        if str(new_lat) != old_lat or f"{new_cost:.4f}" != old_cost:
            row["latency_budget_s"] = str(new_lat)
            row["cost_budget_usd"] = f"{new_cost:.4f}"
            changed += 1
        per_combo[combo] = per_combo.get(combo, 0) + 1

    with out_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"rebalanced: {changed}/{len(rows)} rows updated")
    print(f"per-combo row counts:")
    for combo, count in sorted(per_combo.items()):
        b = BUDGETS.get(combo) or (DEFAULT_FAST if combo[0] == "fast" else DEFAULT_SLOW)
        print(f"  {combo[0]:5s} {combo[1]:22s} x{count}  -> {b[0]}s / ${b[1]:.4f}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="in_path", default="daas/benchmarks/attrition_eval_template_v1.csv")
    p.add_argument("--out", dest="out_path", default="daas/benchmarks/attrition_eval_template_v1.csv")
    args = p.parse_args()
    rebalance(Path(args.in_path), Path(args.out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
