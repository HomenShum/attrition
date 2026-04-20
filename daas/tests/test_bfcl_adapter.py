"""Tests for the BFCL v3 adapter — scenario-based, offline-safe.

Covers:
  * to_bfcl_format: three input shapes + malformed rejection
  * score_calls: exact match, name mismatch, arg mismatch, partial, extra
  * run_task: happy path + harness error path

No HuggingFace / network calls — tests use inline mock task fixtures that
match the documented BFCL v3 schema exactly.
"""

from __future__ import annotations

import pytest

from daas.benchmarks.bfcl.runner import (
    BfclCall,
    _args_match,
    run_task,
    score_calls,
    to_bfcl_format,
)


# ---------------------------------------------------------------------------
# to_bfcl_format — three input shapes
# ---------------------------------------------------------------------------


def test_to_bfcl_format_canonical_daas_shape() -> None:
    artifact = {
        "toolCalls": [
            {"worker": "BugLocator", "tool": "search_code", "args": {"pattern": "foo"}},
            {"worker": "PatchProposer", "tool": "apply_patch", "args": {"diff": "x"}},
        ]
    }
    calls = to_bfcl_format(artifact)
    assert len(calls) == 2
    assert calls[0].name == "search_code"
    assert calls[0].arguments == {"pattern": "foo"}
    assert calls[1].name == "apply_patch"


def test_to_bfcl_format_calls_shorthand() -> None:
    artifact = {"calls": [{"name": "get_weather", "arguments": {"city": "SF"}}]}
    calls = to_bfcl_format(artifact)
    assert calls == [BfclCall(name="get_weather", arguments={"city": "SF"})]


def test_to_bfcl_format_bare_list_passthrough() -> None:
    artifact = [{"name": "fn", "arguments": {"a": 1}}]
    calls = to_bfcl_format(artifact)
    assert calls[0].name == "fn"
    assert calls[0].arguments == {"a": 1}


def test_to_bfcl_format_skips_toolcall_without_name() -> None:
    # BFCL treats a missing-name call as a miss, not a crash
    artifact = {"toolCalls": [{"worker": "W", "args": {}}]}
    calls = to_bfcl_format(artifact)
    assert calls == []


def test_to_bfcl_format_unknown_shape_raises() -> None:
    with pytest.raises(ValueError, match="unrecognized"):
        to_bfcl_format({"garbage": True})


# ---------------------------------------------------------------------------
# score_calls — AST semantics
# ---------------------------------------------------------------------------


def test_score_exact_match_passes() -> None:
    expected = [{"name": "f", "arguments": {"x": 1}}]
    actual = [BfclCall(name="f", arguments={"x": 1})]
    passed, score, detail = score_calls(expected, actual)
    assert passed is True
    assert score == 1.0


def test_score_name_mismatch_fails() -> None:
    expected = [{"name": "f", "arguments": {"x": 1}}]
    actual = [BfclCall(name="g", arguments={"x": 1})]
    passed, score, detail = score_calls(expected, actual)
    assert passed is False
    assert score == 0.0


def test_score_arg_mismatch_fails() -> None:
    expected = [{"name": "f", "arguments": {"x": 1}}]
    actual = [BfclCall(name="f", arguments={"x": 2})]
    passed, score, detail = score_calls(expected, actual)
    assert passed is False
    assert score == 0.0


def test_score_partial_match_returns_fractional() -> None:
    expected = [
        {"name": "f", "arguments": {"x": 1}},
        {"name": "g", "arguments": {"y": 2}},
    ]
    actual = [BfclCall(name="f", arguments={"x": 1})]  # second call missing
    passed, score, detail = score_calls(expected, actual)
    assert passed is False
    assert score == 0.5


def test_score_optional_arg_wildcard() -> None:
    # "<optional>" in the reference = wildcard: any value accepted
    expected = [{"name": "f", "arguments": {"x": 1, "verbose": "<optional>"}}]
    actual = [BfclCall(name="f", arguments={"x": 1, "verbose": True})]
    passed, score, _ = score_calls(expected, actual)
    assert passed is True
    assert score == 1.0


def test_score_extra_actual_calls_do_not_block_pass() -> None:
    # Extra actual calls beyond expected don't cause a fail — matched
    # count over expected count is what matters (AST semantics)
    expected = [{"name": "f", "arguments": {"x": 1}}]
    actual = [
        BfclCall(name="f", arguments={"x": 1}),
        BfclCall(name="extra", arguments={}),
    ]
    passed, score, _ = score_calls(expected, actual)
    assert passed is True


def test_score_each_expected_matched_once() -> None:
    # Duplicate actual call of the same shape can't satisfy 2 different expecteds
    expected = [
        {"name": "f", "arguments": {"x": 1}},
        {"name": "f", "arguments": {"x": 1}},
    ]
    actual = [BfclCall(name="f", arguments={"x": 1})]  # only one real call
    passed, score, _ = score_calls(expected, actual)
    assert passed is False
    assert score == 0.5


def test_score_empty_expected_is_trivially_pass() -> None:
    passed, score, _ = score_calls([], [])
    assert passed is True
    assert score == 1.0


# ---------------------------------------------------------------------------
# _args_match — unit coverage
# ---------------------------------------------------------------------------


def test_args_match_missing_key_fails() -> None:
    assert _args_match({"x": 1}, {}) is False


def test_args_match_extra_actual_key_ok() -> None:
    # Extra keys on actual are fine (BFCL doesn't forbid over-specification)
    assert _args_match({"x": 1}, {"x": 1, "y": 2}) is True


def test_args_match_list_order_sensitive() -> None:
    assert _args_match({"xs": [1, 2]}, {"xs": [2, 1]}) is False


# ---------------------------------------------------------------------------
# run_task — end-to-end
# ---------------------------------------------------------------------------


def test_run_task_happy_path() -> None:
    task = {
        "id": "simple_0",
        "ground_truth": [{"name": "add", "arguments": {"a": 1, "b": 2}}],
    }
    artifact = {"toolCalls": [{"tool": "add", "args": {"a": 1, "b": 2}}]}
    r = run_task(task, artifact)
    assert r.benchmark_id == "bfcl_v3"
    assert r.task_id == "simple_0"
    assert r.passed is True
    assert r.score == 1.0
    assert r.harness_error is None


def test_run_task_reports_harness_error_without_crashing() -> None:
    task = {"id": "simple_1", "ground_truth": [{"name": "add", "arguments": {}}]}
    artifact = {"garbage": True}  # triggers ValueError in to_bfcl_format
    r = run_task(task, artifact)
    assert r.passed is False
    assert r.score == 0.0
    assert r.harness_error is not None
    assert "ValueError" in r.harness_error


def test_run_task_possible_answer_alias() -> None:
    # BFCL v3 tasks use ``possible_answer`` in some dumps; the adapter
    # accepts both that and ``ground_truth``.
    task = {
        "id": "live_0",
        "possible_answer": [{"name": "echo", "arguments": {"s": "hi"}}],
    }
    artifact = {"toolCalls": [{"tool": "echo", "args": {"s": "hi"}}]}
    r = run_task(task, artifact)
    assert r.passed is True


# ---------------------------------------------------------------------------
# Adversarial / scale: long argument lists, many calls
# ---------------------------------------------------------------------------


def test_score_many_calls_scales() -> None:
    # 100 expected calls, all matched exactly — validates no quadratic blowup
    expected = [{"name": f"fn_{i}", "arguments": {"i": i}} for i in range(100)]
    actual = [BfclCall(name=f"fn_{i}", arguments={"i": i}) for i in range(100)]
    passed, score, _ = score_calls(expected, actual)
    assert passed is True
    assert score == 1.0


def test_score_degraded_50pct_match() -> None:
    # Adversarial: half the actual calls are wrong — score must be 0.5 honest
    expected = [{"name": f"fn_{i}", "arguments": {"i": i}} for i in range(10)]
    actual = [BfclCall(name=f"fn_{i}", arguments={"i": i}) for i in range(5)]
    passed, score, _ = score_calls(expected, actual)
    assert passed is False
    assert score == 0.5


# ---------------------------------------------------------------------------
# BFCL v3 native possible_answer shape — real-world compatibility
# ---------------------------------------------------------------------------


def test_score_bfcl_native_shape_any_of_match() -> None:
    # Real BFCL v3 ground_truth: {fn_name: {arg: [vals]}} where value list is any-of
    expected = [
        {
            "calculate_triangle_area": {
                "base": [10],
                "height": [5],
                "unit": ["units", ""],  # "units" OR absent
            }
        }
    ]
    actual = [BfclCall(name="calculate_triangle_area", arguments={"base": 10, "height": 5, "unit": "units"})]
    passed, score, detail = score_calls(expected, actual)
    assert passed is True
    assert score == 1.0
    assert detail["mode"] == "local_ast"


def test_score_bfcl_native_shape_optional_arg_may_be_omitted() -> None:
    # unit has "" in list -> omitting it is acceptable
    expected = [
        {"calc": {"x": [1], "unit": ["units", ""]}}
    ]
    actual = [BfclCall(name="calc", arguments={"x": 1})]  # unit omitted
    passed, score, _ = score_calls(expected, actual)
    assert passed is True


def test_score_bfcl_native_shape_required_arg_missing_fails() -> None:
    # x has only [1] (no "" sentinel) -> required
    expected = [{"calc": {"x": [1]}}]
    actual = [BfclCall(name="calc", arguments={})]
    passed, score, _ = score_calls(expected, actual)
    assert passed is False


def test_score_bfcl_native_shape_loose_numeric_equality() -> None:
    # BFCL tolerates "10" == 10 for numeric coercion
    expected = [{"fn": {"x": [10]}}]
    actual = [BfclCall(name="fn", arguments={"x": "10"})]
    passed, score, _ = score_calls(expected, actual)
    assert passed is True


def test_score_bfcl_native_shape_wrong_value_fails() -> None:
    expected = [{"fn": {"x": [10]}}]
    actual = [BfclCall(name="fn", arguments={"x": 99})]
    passed, score, _ = score_calls(expected, actual)
    assert passed is False


def test_normalize_rejects_ambiguous_multikey_entry() -> None:
    from daas.benchmarks.bfcl.runner import _normalize_expected
    with pytest.raises(ValueError, match="ambiguous"):
        _normalize_expected([{"fn_a": {}, "fn_b": {}}])
