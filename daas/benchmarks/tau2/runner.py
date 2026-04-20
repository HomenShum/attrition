"""tau2-bench adapter — task loader + scoring dispatch.

Task loader works standalone (reads the HF mirror) so prompt engineering
against tau2 shapes is possible without the full simulator. Scoring
REQUIRES the Sierra simulator — if absent, run_task returns a clear
harness_error rather than faking a verdict.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from daas.benchmarks import BenchmarkResult

TAU2_REPO_HF = "HuggingFaceH4/tau2-bench-data"
TAU2_CACHE_DIR = Path(__file__).resolve().parent.parent / "_cache" / "tau2"

# Supported tau2 domains, ordered by retail-analogue proximity.
TAU2_DOMAINS = ("retail", "telecom", "airline")


def simulator_available() -> bool:
    """True iff sierra-research/tau2-bench is importable in this environment."""
    try:
        import tau2  # type: ignore  # noqa: F401
        return True
    except ImportError:
        return False


def load_tasks(
    domain: str = "retail",
    limit: int = 50,
    *,
    force_refresh: bool = False,
) -> list[dict[str, Any]]:
    """Load `limit` tau2 tasks from the HuggingFace mirror.

    Each task exposes (shape as of 2026-04):
        task_id        : str
        goal           : str           # user's goal
        policy         : str           # long-form store/airline/telecom policy
        tools          : list[dict]    # tool specs
        expected_actions : list[dict]  # gold action sequence
        initial_db_state : dict        # store DB snapshot
        expected_db_state : dict       # what db should look like after
    """
    if domain not in TAU2_DOMAINS:
        raise ValueError(f"unknown tau2 domain {domain!r}; expected {TAU2_DOMAINS}")

    TAU2_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached = TAU2_CACHE_DIR / f"{domain}.jsonl"
    if cached.exists() and not force_refresh:
        with cached.open("r", encoding="utf-8") as fh:
            rows = [json.loads(line) for line in fh if line.strip()]
        if rows:
            return rows[:limit]

    try:
        from datasets import load_dataset  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("pip install datasets") from exc

    # tau2 HF mirror hosts per-domain splits. If the mirror shape changes,
    # fall back to GitHub raw JSONL fetch (scoped out for first ship).
    ds = load_dataset(TAU2_REPO_HF, split=domain)
    rows: list[dict[str, Any]] = []
    for i, item in enumerate(ds):  # type: ignore[assignment]
        rows.append(dict(item))
        if i + 1 >= limit:
            break
    with cached.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    return rows


def run_task(task: dict[str, Any], artifact: dict[str, Any]) -> BenchmarkResult:
    """Score one tau2 task.

    artifact is the agent's run output:
        {
          "actions_emitted": [{"tool": "...", "args": {...}}, ...],
          "final_db_state": {...},
          "_meta": {cost, duration, error}
        }

    Scoring (when simulator is available):
      - actions_match   = tuple-equality of (tool, args) pairs
      - db_state_match  = deep-equality of final_db_state vs expected

    Both must be True for passed=True (tau2's own rule). Score is the
    weighted mean of the two metrics (0.5/0.5).
    """
    task_id = str(task.get("task_id") or task.get("id") or "unknown")
    meta = artifact.get("_meta") if isinstance(artifact, dict) else {}

    if not simulator_available():
        return BenchmarkResult(
            benchmark_id="tau2_retail",
            task_id=task_id,
            passed=False,
            score=0.0,
            raw_result={"_meta": meta},
            harness_error=(
                "sierra_simulator_missing: install with "
                "`pip install -e git+https://github.com/sierra-research/tau2-bench`"
            ),
        )

    # With simulator: deterministic scoring
    expected_actions = list(task.get("expected_actions") or [])
    expected_db = dict(task.get("expected_db_state") or {})
    actual_actions = list(artifact.get("actions_emitted") or [])
    actual_db = dict(artifact.get("final_db_state") or {})

    actions_match = _actions_match(expected_actions, actual_actions)
    db_match = _db_state_match(expected_db, actual_db)
    score = 0.5 * (1 if actions_match else 0) + 0.5 * (1 if db_match else 0)
    passed = actions_match and db_match

    return BenchmarkResult(
        benchmark_id="tau2_retail",
        task_id=task_id,
        passed=passed,
        score=score,
        raw_result={
            "expected_actions": expected_actions,
            "actual_actions": actual_actions,
            "expected_db_state": expected_db,
            "actual_db_state": actual_db,
            "actions_match": actions_match,
            "db_state_match": db_match,
            "_meta": meta,
        },
    )


def _actions_match(expected: list[dict[str, Any]], actual: list[dict[str, Any]]) -> bool:
    """Compare tau2 action sequences by (tool, args) tuples, order-sensitive."""
    if len(expected) != len(actual):
        return False
    for e, a in zip(expected, actual):
        e_tool = e.get("tool") or e.get("name")
        a_tool = a.get("tool") or a.get("name")
        if e_tool != a_tool:
            return False
        e_args = e.get("args") or e.get("arguments") or {}
        a_args = a.get("args") or a.get("arguments") or {}
        if e_args != a_args:
            return False
    return True


def _db_state_match(expected: dict[str, Any], actual: dict[str, Any]) -> bool:
    """Deep-equality on db state. The Sierra simulator provides a
    normalized final DB snapshot; if either side is empty, fail-closed
    rather than trivially-pass."""
    if not expected and not actual:
        return False  # empty = no test — HONEST_STATUS
    return expected == actual
