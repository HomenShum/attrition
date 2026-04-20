"""Offline tests for JudgeBench adapter — no HF / API calls."""

from __future__ import annotations

import pytest

from daas.benchmarks.judgebench.runner import (
    _normalize_label,
    extract_pick,
    run_task,
)


def test_extract_pick_better_answer_pattern() -> None:
    assert extract_pick("After reading both, the better answer is A.") == "A"
    assert extract_pick("the correct answer is B") == "B"


def test_extract_pick_boxed() -> None:
    assert extract_pick("Analysis: ... \\boxed{A}") == "A"


def test_extract_pick_response_better_form() -> None:
    assert extract_pick("Response A is better because ...") == "A"
    assert extract_pick("response (B) is better.") == "B"


def test_extract_pick_bare_last_line() -> None:
    assert extract_pick("Long reasoning...\n\nA") == "A"
    assert extract_pick("Long reasoning...\n\n(B)") == "B"


def test_extract_pick_returns_none_when_ambiguous() -> None:
    assert extract_pick("I am not sure") is None
    # No canonical context + no bare-letter last line
    assert extract_pick("Between A and B, both are fine") is None


def test_extract_pick_returns_none_on_empty() -> None:
    assert extract_pick("") is None
    assert extract_pick(None) is None  # type: ignore[arg-type]


def test_normalize_label_accepts_string_letter() -> None:
    assert _normalize_label("A") == "A"
    assert _normalize_label("b") == "B"
    assert _normalize_label("response_A") == "A"


def test_normalize_label_accepts_comparator_form() -> None:
    # Real JudgeBench split uses "A>B" syntax
    assert _normalize_label("A>B") == "A"
    assert _normalize_label("B>A") == "B"
    assert _normalize_label("  A > B  ") == "A"


def test_normalize_label_rejects_equal_comparator() -> None:
    # "A>A" is nonsensical; don't guess
    assert _normalize_label("A>A") is None


def test_normalize_label_accepts_int() -> None:
    assert _normalize_label(0) == "A"
    assert _normalize_label(1) == "B"


def test_normalize_label_returns_none_on_garbage() -> None:
    assert _normalize_label(None) is None
    assert _normalize_label("maybe") is None


def _task(label: str, **extra) -> dict:
    return {
        "pair_id": "p1",
        "question": "q",
        "response_A": "a",
        "response_B": "b",
        "label": label,
        **extra,
    }


def _artifact(pick: str | None, err: str | None = None) -> dict:
    return {
        "pick": pick,
        "response_text": "stub",
        "_meta": {
            "model": "test",
            "input_tokens": 0,
            "output_tokens": 0,
            "cost_usd": 0.0,
            "duration_ms": 0,
            "error": err,
        },
    }


def test_run_task_correct_pick_passes() -> None:
    r = run_task(_task("A"), _artifact("A"))
    assert r.passed is True
    assert r.score == 1.0
    assert r.benchmark_id == "judgebench"


def test_run_task_wrong_pick_fails() -> None:
    r = run_task(_task("A"), _artifact("B"))
    assert r.passed is False
    assert r.score == 0.0


def test_run_task_missing_pick_fails() -> None:
    r = run_task(_task("A"), _artifact(None))
    assert r.passed is False


def test_run_task_missing_label_is_harness_error() -> None:
    t = {"pair_id": "p", "question": "q", "response_A": "a", "response_B": "b"}
    r = run_task(t, _artifact("A"))
    assert r.harness_error == "missing_label"
    assert r.passed is False


def test_run_task_api_error_surfaces() -> None:
    r = run_task(_task("A"), _artifact(None, err="HTTPError 500"))
    assert r.harness_error == "HTTPError 500"
    assert r.passed is False


def test_run_task_case_insensitive_pick() -> None:
    r = run_task(_task("a"), _artifact("A"))
    assert r.passed is True


def test_run_task_int_label() -> None:
    # HF dataset sometimes uses 0/1 labels
    r = run_task({"pair_id": "p", "question": "q", "response_A": "a", "response_B": "b", "label": 1}, _artifact("B"))
    assert r.passed is True
