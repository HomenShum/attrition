"""Fidelity CLI — register externalization, run trials, record verdict.

Usage (MMLU-Pro prompt distillation example):

    python -m daas.fidelity.cli \
        --benchmark mmlu_pro \
        --externalization-id mmlu_pro_cot_v1 \
        --form prompt \
        --artifact daas/fidelity/artifacts/mmlu_pro_cot_v1.json \
        --source-model gemini-3.1-pro-preview \
        --small-model gemini-3.1-flash-lite-preview \
        --large-model gemini-3.1-pro-preview \
        --limit 60 \
        --category law \
        --record

``--record`` pushes each trial + the aggregate verdict to the attrition
Convex deployment. Without it the run is offline-only (useful for
iterating on the externalization without burning Convex rows).

The CLI is adapter-aware: ``--benchmark mmlu_pro`` wires the MMLU-Pro
adapter + the mmlu_pro prompt scaffold; ``--benchmark bfcl`` (future)
would wire the BFCL adapter + a BFCL tool-schema scaffold.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from daas.benchmarks.mmlu_pro import runner as mmlu_pro_runner
from daas.benchmarks.judgebench import runner as judgebench_runner
from daas.fidelity import Externalization
from daas.fidelity.trial import (
    prompt_scaffold_for_mmlu_pro,
    prompt_scaffold_passthrough,
    run_trials,
)

CONVEX_PROD_URL = "https://joyous-walrus-428.convex.cloud"


def _adapter_for(benchmark: str):
    if benchmark == "mmlu_pro":
        return mmlu_pro_runner
    if benchmark == "judgebench":
        return judgebench_runner
    raise SystemExit(
        f"unknown benchmark {benchmark!r}. Known: mmlu_pro, judgebench. "
        "Add the adapter + scaffold function to daas/fidelity/cli.py."
    )


def _scaffold_for(benchmark: str, form: str):
    if benchmark == "mmlu_pro" and form == "prompt":
        return prompt_scaffold_for_mmlu_pro
    if benchmark == "judgebench" and form == "prompt":
        # JudgeBench tasks already contain the full question in task["question"]
        # and are consumed by judgebench.live_replay — the scaffold here is a
        # no-op passthrough unless/until we distill a judge-specific preamble.
        return prompt_scaffold_passthrough
    raise SystemExit(
        f"no scaffold known for (benchmark={benchmark}, form={form}). "
        "Implement one in daas/fidelity/trial.py."
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--benchmark", required=True, choices=["mmlu_pro", "judgebench"])
    p.add_argument("--externalization-id", required=True)
    p.add_argument("--form", required=True, choices=["prompt", "tool_schema", "scaffold_graph"])
    p.add_argument("--artifact", required=True, type=Path, help="Path to JSON artifact")
    p.add_argument("--source-model", required=True)
    p.add_argument("--small-model", required=True)
    p.add_argument("--large-model", required=True)
    p.add_argument("--limit", type=int, default=60)
    p.add_argument("--category", default=None, help="mmlu_pro category filter (e.g. law)")
    p.add_argument("--split", default=None, help="judgebench split: claude | gpt")
    p.add_argument("--notes", default="")
    p.add_argument("--record", action="store_true", help="Write trials + verdict to Convex")
    p.add_argument("--convex-url", default=CONVEX_PROD_URL)
    args = p.parse_args(argv)

    if not args.artifact.exists():
        print(f"[fatal] artifact not found: {args.artifact}", file=sys.stderr)
        return 2
    artifact_text = args.artifact.read_text(encoding="utf-8")
    try:
        artifact_obj = json.loads(artifact_text)
    except json.JSONDecodeError as exc:
        print(f"[fatal] artifact is not valid JSON: {exc}", file=sys.stderr)
        return 2

    externalization = Externalization(
        id=args.externalization_id,
        form=args.form,  # type: ignore[arg-type]
        artifact=artifact_obj,
        source_model=args.source_model,
        source_trace_ids=list(artifact_obj.get("source_trace_ids", [])),
        notes=args.notes,
    )

    adapter = _adapter_for(args.benchmark)
    scaffold = _scaffold_for(args.benchmark, args.form)

    load_kwargs: dict[str, Any] = {}
    if args.category and args.benchmark == "mmlu_pro":
        load_kwargs["category"] = args.category
    if args.split and args.benchmark == "judgebench":
        load_kwargs["split"] = args.split

    convex_client = None
    if args.record:
        try:
            from convex import ConvexClient  # type: ignore
        except ImportError:
            print("[fatal] --record requires `pip install convex`", file=sys.stderr)
            return 3
        convex_client = ConvexClient(args.convex_url)
        # Upsert externalization first. Convex `v.optional(...)` means the
        # field must be ABSENT when missing, NOT null — passing None
        # throws. Build args dict conditionally.
        reg_args: dict[str, Any] = {
            "externalizationId": externalization.id,
            "form": externalization.form,
            "artifactJson": json.dumps(externalization.artifact, ensure_ascii=False),
            "sourceModel": externalization.source_model,
            "sourceTraceIdsJson": json.dumps(externalization.source_trace_ids),
        }
        if externalization.notes:
            reg_args["notes"] = externalization.notes
        convex_client.mutation(
            "domains/daas/fidelity:registerExternalization",
            reg_args,
        )

    print(f"\n=== Fidelity trial: {externalization.id} vs {args.benchmark} ===")
    print(f"  small={args.small_model}  large={args.large_model}")
    print(f"  n={args.limit}  category={args.category or 'all'}")
    started = time.time()
    trials, verdict = run_trials(
        adapter=adapter,
        externalization=externalization,
        benchmark_id=args.benchmark,
        small_model=args.small_model,
        large_model=args.large_model,
        apply_scaffold=scaffold,
        limit=args.limit,
        load_kwargs=load_kwargs,
    )
    elapsed = int(time.time() - started)

    total_cost = sum(
        (t.baseline_cost_usd + t.ceiling_cost_usd + t.distilled_cost_usd) for t in trials
    )

    print(f"\n--- Results ({elapsed}s, total cost ${total_cost:.4f}) ---")
    print(f"  verdict:   {verdict.verdict.upper()}")
    print(f"  baseline:  {verdict.baseline.rate:.1%}  CI95=[{verdict.baseline.ci_lo:.1%}, {verdict.baseline.ci_hi:.1%}]")
    print(f"  ceiling:   {verdict.ceiling.rate:.1%}  CI95=[{verdict.ceiling.ci_lo:.1%}, {verdict.ceiling.ci_hi:.1%}]")
    print(f"  distilled: {verdict.distilled.rate:.1%}  CI95=[{verdict.distilled.ci_lo:.1%}, {verdict.distilled.ci_hi:.1%}]")
    print(f"  gap:       {verdict.gap_pp:+.1f}pp (significant: {verdict.gap_significant})")
    print(f"  transfer:  {verdict.transfer_pp:+.1f}pp (significant: {verdict.transfer_significant})")
    if verdict.fidelity_pct is not None:
        print(f"  fidelity:  {verdict.fidelity_pct:.0%}")
    print(f"\n  {verdict.narrative}")

    if convex_client is not None:
        # Write trials (one mutation per trial — could batch, but bounded n)
        for t in trials:
            kwargs = {
                "externalizationId": t.externalization_id,
                "benchmarkId": t.benchmark_id,
                "taskId": t.task_id,
                "baselineModel": args.small_model,
                "ceilingModel": args.large_model,
                "distilledModel": f"{args.small_model}+{externalization.id}",
                "baselinePassed": t.baseline_passed,
                "ceilingPassed": t.ceiling_passed,
                "distilledPassed": t.distilled_passed,
                "baselineCostUsd": t.baseline_cost_usd,
                "ceilingCostUsd": t.ceiling_cost_usd,
                "distilledCostUsd": t.distilled_cost_usd,
            }
            if t.baseline_error:
                kwargs["baselineError"] = t.baseline_error
            if t.ceiling_error:
                kwargs["ceilingError"] = t.ceiling_error
            if t.distilled_error:
                kwargs["distilledError"] = t.distilled_error
            convex_client.mutation("domains/daas/fidelity:recordTrial", kwargs)

        verdict_kwargs = {
            "externalizationId": verdict.externalization_id,
            "benchmarkId": verdict.benchmark_id,
            "verdict": verdict.verdict,
            "n": verdict.baseline.total,
            "baselineRate": verdict.baseline.rate,
            "baselineCiLo": verdict.baseline.ci_lo,
            "baselineCiHi": verdict.baseline.ci_hi,
            "ceilingRate": verdict.ceiling.rate,
            "ceilingCiLo": verdict.ceiling.ci_lo,
            "ceilingCiHi": verdict.ceiling.ci_hi,
            "distilledRate": verdict.distilled.rate,
            "distilledCiLo": verdict.distilled.ci_lo,
            "distilledCiHi": verdict.distilled.ci_hi,
            "gapPp": verdict.gap_pp,
            "transferPp": verdict.transfer_pp,
            "gapSignificant": verdict.gap_significant,
            "transferSignificant": verdict.transfer_significant,
            "regressionSignificant": verdict.regression_significant,
            "narrative": verdict.narrative,
            "totalCostUsd": total_cost,
        }
        if verdict.fidelity_pct is not None:
            verdict_kwargs["fidelityPct"] = verdict.fidelity_pct
        convex_client.mutation(
            "domains/daas/fidelity:recordVerdict", verdict_kwargs
        )
        print(f"\n  recorded {len(trials)} trials + 1 verdict to {args.convex_url}")

    return 0 if verdict.verdict != "insufficient_data" else 4


if __name__ == "__main__":
    raise SystemExit(main())
