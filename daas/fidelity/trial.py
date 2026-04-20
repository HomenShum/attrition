"""Trial runner — executes the 3-measurement template on a task batch.

Given a benchmark adapter and an externalization artifact, runs each
task three ways::

    baseline   = small_model.solo(task)
    ceiling    = large_model.solo(task)
    distilled  = small_model.with_scaffold(task, artifact)

Returns a FidelityVerdict that the schema accepts. The runner is
adapter-agnostic: any benchmark that exposes ``load_tasks``, ``run_task``,
``live_replay`` works.

Prior art:
  * Anthropic Building-Effective-Agents: orchestrator fans out measurements
  * arxiv:2310.17389 on rigor in LLM eval reporting (CI, n, provenance)
"""

from __future__ import annotations

from typing import Any, Callable, Protocol

from daas.benchmarks import BenchmarkResult
from daas.fidelity.types import Externalization, FidelityTrial
from daas.fidelity.verdict import classify


class BenchmarkAdapter(Protocol):
    """Contract every benchmark adapter must expose to the trial runner."""

    def load_tasks(self, limit: int, **kw: Any) -> list[dict[str, Any]]: ...
    def live_replay(
        self,
        task: dict[str, Any],
        *,
        model: str,
        **kw: Any,
    ) -> dict[str, Any]: ...
    def run_task(
        self, task: dict[str, Any], artifact: dict[str, Any]
    ) -> BenchmarkResult: ...


# An ApplyScaffold takes (task, externalization) and returns a modified
# task whose live_replay will consume the externalization. For a prompt
# externalization this prepends a preamble to the question; for a tool
# externalization it swaps the tool list; for a scaffold_graph it replays
# the task through the graph runner. The specific transformation is the
# externalization's semantics — the trial runner just invokes it.
ApplyScaffold = Callable[
    [dict[str, Any], Externalization], dict[str, Any]
]


def run_trials(
    adapter: BenchmarkAdapter,
    externalization: Externalization,
    *,
    benchmark_id: str,
    small_model: str,
    large_model: str,
    apply_scaffold: ApplyScaffold,
    limit: int = 60,
    load_kwargs: dict[str, Any] | None = None,
) -> tuple[list[FidelityTrial], Any]:
    """Run the 3-measurement template and return (trials, verdict).

    The trial runner is deliberately sequential — parallel dispatch is a
    later optimization. Each task incurs three live calls; budget at
    ~$0.002-0.005 per task for reasoning benchmarks with Flash Lite +
    Pro.
    """
    load_kwargs = load_kwargs or {}
    tasks = adapter.load_tasks(limit=limit, **load_kwargs)

    trials: list[FidelityTrial] = []
    for task in tasks:
        task_id_field = (
            "id" if "id" in task else ("question_id" if "question_id" in task else None)
        )
        task_id = str(task.get(task_id_field, "unknown"))

        # 1. Baseline: small model, no scaffold
        base_art = adapter.live_replay(task, model=small_model)
        base_r = adapter.run_task(task, base_art)

        # 2. Ceiling: large model, no scaffold
        ceil_art = adapter.live_replay(task, model=large_model)
        ceil_r = adapter.run_task(task, ceil_art)

        # 3. Distilled: small model + externalization applied
        scaffolded_task = apply_scaffold(task, externalization)
        dist_art = adapter.live_replay(scaffolded_task, model=small_model)
        dist_r = adapter.run_task(task, dist_art)

        def _cost(art: dict[str, Any]) -> float:
            m = art.get("_meta") if isinstance(art, dict) else None
            return float(m.get("cost_usd") or 0) if isinstance(m, dict) else 0.0

        trials.append(
            FidelityTrial(
                task_id=task_id,
                benchmark_id=benchmark_id,
                externalization_id=externalization.id,
                baseline_passed=base_r.passed,
                ceiling_passed=ceil_r.passed,
                distilled_passed=dist_r.passed,
                baseline_cost_usd=_cost(base_art),
                ceiling_cost_usd=_cost(ceil_art),
                distilled_cost_usd=_cost(dist_art),
                baseline_error=base_r.harness_error,
                ceiling_error=ceil_r.harness_error,
                distilled_error=dist_r.harness_error,
            )
        )

    verdict = classify(
        trials,
        externalization.id,
        benchmark_id,
        baseline_model=small_model,
        ceiling_model=large_model,
        distilled_model=f"{small_model}+{externalization.id}",
    )
    return trials, verdict


# ---------------------------------------------------------------------------
# Ready-to-use scaffolds for common externalization forms
# ---------------------------------------------------------------------------


def prompt_scaffold_passthrough(
    task: dict[str, Any], ext: Externalization
) -> dict[str, Any]:
    """No-op scaffold for benchmarks where the adapter's live_replay
    already applies the full prompt contract (e.g., JudgeBench's pick-A-or-B
    format). Use when the externalization under test is measured against
    the adapter's default behavior."""
    return task


def prompt_scaffold_for_mmlu_pro(
    task: dict[str, Any], ext: Externalization
) -> dict[str, Any]:
    """Prepend a distilled preamble to an MMLU-Pro question.

    ``ext.artifact["system_prompt"]`` is prepended to the question text.
    This is the minimal valid "prompt distillation" form — the big
    model's CoT pattern encoded as plain text the small model sees first.
    """
    if ext.form != "prompt":
        raise ValueError(
            f"prompt_scaffold_for_mmlu_pro requires form='prompt', got {ext.form!r}"
        )
    preamble = str(ext.artifact.get("system_prompt", "")).strip()
    if not preamble:
        return task
    new = dict(task)
    new["question"] = f"{preamble}\n\n{task.get('question', '')}"
    return new
