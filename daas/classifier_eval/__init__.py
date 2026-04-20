"""Classifier eval harness — calibrates Architect's triage accuracy.

The Architect page's classifier (Convex Node action in
convex/domains/daas/architectClassifier.ts) runs Gemini Flash Lite to
pick runtime/world_model/intent lanes. Before any recommender claim
downstream, we need to know: is the classifier itself right?

This harness:
  1. Loads daas/classifier_eval/gold.jsonl — 30 hand-labeled prompts.
  2. Runs each prompt against the LIVE Convex architectClassifier action.
  3. Scores each response on 3 axes (runtime / world_model / intent).
  4. Reports per-axis accuracy + confusion matrix + a bounded verdict.

Scoring is deterministic — no LLM judge. Each axis is exact-match
against the gold label. Insufficient-data verdict fires if fewer than
20 prompts successfully classify.
"""

from daas.classifier_eval.runner import (
    GoldPrompt,
    EvalResult,
    load_gold,
    score_response,
    run_eval,
)

__all__ = ["GoldPrompt", "EvalResult", "load_gold", "score_response", "run_eval"]
