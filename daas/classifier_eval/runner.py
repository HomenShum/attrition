"""Classifier eval runner — hits the LIVE Convex architectClassifier and
scores responses against the 30-prompt gold set.

Each axis (runtime / world_model / intent) is scored exact-match. Output
is per-axis accuracy + confusion matrix. Refuses to emit a verdict on
fewer than 20 successful classifications (too noisy to claim accuracy).

Usage:
    python -m daas.classifier_eval.runner --convex https://joyous-walrus-428.convex.cloud
    python -m daas.classifier_eval.runner --record   # also writes to Convex
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

GOLD_PATH = Path(__file__).resolve().parent / "gold.jsonl"

RUNTIME_LANES = ["simple_chain", "tool_first_chain", "orchestrator_worker", "keep_big_model"]
WORLD_MODEL_LANES = ["lite", "full"]
INTENT_LANES = ["compile_down", "compile_up", "translate", "greenfield", "unknown"]

MIN_N_FOR_VERDICT = 20  # below this we emit "insufficient_data"


@dataclass(frozen=True)
class GoldPrompt:
    id: str
    prompt: str
    runtime_lane: str
    world_model_lane: str
    intent_lane: str
    notes: str = ""


@dataclass(frozen=True)
class EvalResult:
    gold_id: str
    predicted_runtime: str | None
    predicted_world_model: str | None
    predicted_intent: str | None
    gold_runtime: str
    gold_world_model: str
    gold_intent: str
    error: str | None = None

    @property
    def runtime_match(self) -> bool:
        return self.predicted_runtime == self.gold_runtime

    @property
    def world_model_match(self) -> bool:
        return self.predicted_world_model == self.gold_world_model

    @property
    def intent_match(self) -> bool:
        return self.predicted_intent == self.gold_intent

    @property
    def all_three_match(self) -> bool:
        return self.runtime_match and self.world_model_match and self.intent_match


def load_gold(path: Path = GOLD_PATH) -> list[GoldPrompt]:
    out: list[GoldPrompt] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            out.append(
                GoldPrompt(
                    id=row["id"],
                    prompt=row["prompt"],
                    runtime_lane=row["runtime_lane"],
                    world_model_lane=row["world_model_lane"],
                    intent_lane=row["intent_lane"],
                    notes=row.get("notes", ""),
                )
            )
    return out


def score_response(
    gold: GoldPrompt,
    predicted: dict[str, Any] | None,
    error: str | None = None,
) -> EvalResult:
    """Compare a classifier response to a gold prompt. No LLM judge."""
    if predicted is None or error is not None:
        return EvalResult(
            gold_id=gold.id,
            predicted_runtime=None,
            predicted_world_model=None,
            predicted_intent=None,
            gold_runtime=gold.runtime_lane,
            gold_world_model=gold.world_model_lane,
            gold_intent=gold.intent_lane,
            error=error or "no prediction",
        )
    return EvalResult(
        gold_id=gold.id,
        predicted_runtime=predicted.get("runtimeLane"),
        predicted_world_model=predicted.get("worldModelLane"),
        predicted_intent=predicted.get("intentLane"),
        gold_runtime=gold.runtime_lane,
        gold_world_model=gold.world_model_lane,
        gold_intent=gold.intent_lane,
    )


def run_eval(
    convex_url: str,
    *,
    gold: list[GoldPrompt] | None = None,
    sleep_between: float = 0.5,
) -> list[EvalResult]:
    """Run the 30-prompt eval against a live Convex deployment."""
    try:
        from convex import ConvexClient  # type: ignore
    except ImportError as exc:
        raise RuntimeError("pip install convex") from exc

    gold_prompts = gold if gold is not None else load_gold()
    c = ConvexClient(convex_url)
    results: list[EvalResult] = []
    run_ts = int(time.time())

    for i, g in enumerate(gold_prompts):
        slug = f"eval_{run_ts}_{g.id}"
        try:
            # Create the session
            c.mutation(
                "domains/daas/architect:createSession",
                {"sessionSlug": slug, "prompt": g.prompt},
            )
            # Run the classifier action synchronously
            c.action(
                "domains/daas/architectClassifier:classify",
                {"sessionSlug": slug, "prompt": g.prompt},
            )
            session = c.query(
                "domains/daas/architect:getSessionBySlug",
                {"sessionSlug": slug},
            )
            results.append(score_response(g, session))
        except Exception as exc:
            results.append(score_response(g, None, error=str(exc)[:200]))
        print(
            f"  [{i+1:2d}/{len(gold_prompts)}] {g.id}: "
            f"r={results[-1].predicted_runtime or 'ERR'} "
            f"w={results[-1].predicted_world_model or 'ERR'} "
            f"i={results[-1].predicted_intent or 'ERR'}",
            flush=True,
        )
        if sleep_between > 0:
            time.sleep(sleep_between)

    return results


def print_report(results: list[EvalResult]) -> dict[str, Any]:
    total = len(results)
    successful = [r for r in results if r.error is None]
    n = len(successful)
    errors = total - n

    def _acc(extract) -> float:
        if n == 0:
            return 0.0
        return sum(1 for r in successful if extract(r)) / n

    runtime_acc = _acc(lambda r: r.runtime_match)
    world_acc = _acc(lambda r: r.world_model_match)
    intent_acc = _acc(lambda r: r.intent_match)
    all_three_acc = _acc(lambda r: r.all_three_match)

    # Confusion: count gold -> predicted pairs per axis
    runtime_confusion: Counter[tuple[str, str]] = Counter()
    for r in successful:
        runtime_confusion[(r.gold_runtime, r.predicted_runtime or "MISSING")] += 1

    world_confusion: Counter[tuple[str, str]] = Counter()
    for r in successful:
        world_confusion[(r.gold_world_model, r.predicted_world_model or "MISSING")] += 1

    intent_confusion: Counter[tuple[str, str]] = Counter()
    for r in successful:
        intent_confusion[(r.gold_intent, r.predicted_intent or "MISSING")] += 1

    print("\n=== Classifier eval report ===")
    print(f"  n={n}  errors={errors}  total={total}")
    if n < MIN_N_FOR_VERDICT:
        print(f"  VERDICT: insufficient_data (n={n} < {MIN_N_FOR_VERDICT})")
    else:
        print(f"  runtime    accuracy: {runtime_acc:.1%} ({int(runtime_acc*n)}/{n})")
        print(f"  world_model accuracy: {world_acc:.1%} ({int(world_acc*n)}/{n})")
        print(f"  intent     accuracy: {intent_acc:.1%} ({int(intent_acc*n)}/{n})")
        print(f"  all three  accuracy: {all_three_acc:.1%} ({int(all_three_acc*n)}/{n})")

    print("\n  --- Runtime confusions (gold -> predicted) ---")
    for (gold, pred), count in runtime_confusion.most_common():
        flag = "OK " if gold == pred else "err"
        print(f"    {flag} {gold:24s} -> {pred:24s} ({count})")

    print("\n  --- Intent confusions (gold -> predicted) ---")
    for (gold, pred), count in intent_confusion.most_common():
        flag = "OK " if gold == pred else "err"
        print(f"    {flag} {gold:16s} -> {pred:16s} ({count})")

    return {
        "n": n,
        "errors": errors,
        "runtime_accuracy": runtime_acc,
        "world_model_accuracy": world_acc,
        "intent_accuracy": intent_acc,
        "all_three_accuracy": all_three_acc,
        "verdict": "insufficient_data" if n < MIN_N_FOR_VERDICT else "measured",
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--convex", default="https://joyous-walrus-428.convex.cloud")
    p.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent / "results" / f"run_{int(time.time())}.jsonl",
    )
    p.add_argument("--sleep", type=float, default=0.5)
    args = p.parse_args(argv)

    gold = load_gold()
    print(f"Loaded {len(gold)} gold prompts. Starting live eval against {args.convex}...")

    results = run_eval(args.convex, gold=gold, sleep_between=args.sleep)

    # Persist FIRST (so any print/encoding issues don't lose the run data)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as fh:
        for r in results:
            fh.write(
                json.dumps(
                    {
                        "gold_id": r.gold_id,
                        "gold_runtime": r.gold_runtime,
                        "gold_world_model": r.gold_world_model,
                        "gold_intent": r.gold_intent,
                        "predicted_runtime": r.predicted_runtime,
                        "predicted_world_model": r.predicted_world_model,
                        "predicted_intent": r.predicted_intent,
                        "error": r.error,
                        "runtime_match": r.runtime_match,
                        "world_model_match": r.world_model_match,
                        "intent_match": r.intent_match,
                        "all_three_match": r.all_three_match,
                    }
                )
                + "\n"
            )
    summary = print_report(results)
    with args.output.with_suffix(".summary.json").open("w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)
    print(f"\nResults written to {args.output}")
    return 0 if summary["verdict"] != "insufficient_data" else 4


if __name__ == "__main__":
    raise SystemExit(main())
