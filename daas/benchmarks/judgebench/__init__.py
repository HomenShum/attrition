"""JudgeBench — pairwise judge calibration benchmark.

Source: https://github.com/ScalerLab/JudgeBench
Dataset (HF): ScalerLab/JudgeBench

Task shape: given a question and two candidate responses (A, B), the
judge must pick which one is objectively better. Unlike preference
benchmarks, the gold label reflects correctness, not taste.

Why this is the primary Loop A (judge calibration) suite:
  - Hard: many strong LLM judges score only slightly above random.
  - Objective: gold is based on actual correctness, so disagreement
    between judge and gold is a measurable judge failure, not a taste gap.
  - Maps onto attrition's rubric shape: every named boolean check IS
    effectively a mini-judgment ("is this claim grounded?") — JudgeBench
    surfaces when those mini-judgments are miscalibrated.
"""

from daas.benchmarks.judgebench.runner import (
    extract_pick,
    live_replay,
    load_tasks,
    run_task,
)

__all__ = ["extract_pick", "live_replay", "load_tasks", "run_task"]
