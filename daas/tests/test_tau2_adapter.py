"""Offline tests for tau2 adapter — no simulator / no network."""

from __future__ import annotations

import pytest

from daas.benchmarks.tau2.runner import (
    TAU2_DOMAINS,
    _actions_match,
    _db_state_match,
    run_task,
    simulator_available,
)


def test_tau2_domains_contract() -> None:
    # If this changes, every compile_up/down recommendation using tau2
    # needs a lane update. Lock it with a test.
    assert TAU2_DOMAINS == ("retail", "telecom", "airline")


def test_simulator_available_returns_bool() -> None:
    # In CI / test env we expect no simulator installed
    result = simulator_available()
    assert isinstance(result, bool)


def test_run_task_without_simulator_emits_harness_error() -> None:
    t = {"task_id": "t1", "expected_actions": [], "expected_db_state": {"x": 1}}
    r = run_task(t, {"actions_emitted": [], "final_db_state": {"x": 1}})
    # Assuming no simulator installed in test env
    if not simulator_available():
        assert r.harness_error is not None
        assert "sierra_simulator_missing" in r.harness_error
        assert r.passed is False
        assert r.score == 0.0
    else:
        # With simulator, scoring proceeds normally
        assert r.harness_error is None


def test_actions_match_identical_sequence() -> None:
    a = [{"tool": "refund", "args": {"amount": 10}}]
    assert _actions_match(a, a)


def test_actions_match_rejects_count_mismatch() -> None:
    exp = [{"tool": "refund", "args": {"amount": 10}}, {"tool": "notify", "args": {}}]
    act = [{"tool": "refund", "args": {"amount": 10}}]
    assert _actions_match(exp, act) is False


def test_actions_match_rejects_tool_name_mismatch() -> None:
    exp = [{"tool": "refund", "args": {}}]
    act = [{"tool": "cancel", "args": {}}]
    assert _actions_match(exp, act) is False


def test_actions_match_rejects_args_mismatch() -> None:
    exp = [{"tool": "refund", "args": {"amount": 10}}]
    act = [{"tool": "refund", "args": {"amount": 99}}]
    assert _actions_match(exp, act) is False


def test_actions_match_accepts_arguments_alias() -> None:
    exp = [{"tool": "refund", "args": {"amount": 10}}]
    act = [{"name": "refund", "arguments": {"amount": 10}}]
    assert _actions_match(exp, act) is True


def test_db_state_match_identical() -> None:
    assert _db_state_match({"x": 1}, {"x": 1}) is True


def test_db_state_match_rejects_different_values() -> None:
    assert _db_state_match({"x": 1}, {"x": 2}) is False


def test_db_state_match_fails_when_both_empty() -> None:
    # Empty expected + empty actual -> honest fail (no real test happened)
    assert _db_state_match({}, {}) is False
