"""Tests for the world-model policy engine."""

from __future__ import annotations

import pytest

from daas.compile_down.world_model.policy_engine import (
    Policy,
    PolicyEngine,
    PolicyViolation,
    _check_label_if_trend_claim,
    _check_amount_below,
    _check_approval_above,
    _check_must_have_source_ref,
)


# ---------------------------------------------------------------------------
# Check primitives
# ---------------------------------------------------------------------------


def test_must_have_source_ref_passes_when_present() -> None:
    assert _check_must_have_source_ref("fn", {}, {"source_refs": ["x"]}) is None


def test_must_have_source_ref_fails_when_missing() -> None:
    r = _check_must_have_source_ref("fn", {}, {})
    assert r and "source_refs" in r


def test_amount_below_passes() -> None:
    check = _check_amount_below("500")
    assert check("refund", {"amount": 100}, {}) is None


def test_amount_below_fails() -> None:
    check = _check_amount_below("500")
    r = check("refund", {"amount": 700}, {})
    assert r and "amount=700" in r


def test_amount_below_inapplicable_skips() -> None:
    # No amount arg — check returns None (not applicable)
    check = _check_amount_below("500")
    assert check("refund", {}, {}) is None


def test_approval_above_passes_without_trigger() -> None:
    check = _check_approval_above("500")
    assert check("refund", {"amount": 100}, {}) is None  # below threshold


def test_approval_above_requires_approval() -> None:
    check = _check_approval_above("500")
    r = check("refund", {"amount": 800}, {})
    assert r and "without approval" in r


def test_approval_above_granted() -> None:
    check = _check_approval_above("500")
    assert check("refund", {"amount": 800}, {"approved": True}) is None


def test_label_trend_claim_requires_interpret_first() -> None:
    r = _check_label_if_trend_claim(
        "emit",
        {"output": "Revenue is growing this quarter"},
        {"boundary": "act_on"},
    )
    assert r and "boundary" in r


def test_label_trend_claim_passes_when_labeled() -> None:
    r = _check_label_if_trend_claim(
        "emit",
        {"output": "Revenue is growing this quarter"},
        {"boundary": "interpret_first"},
    )
    assert r is None


def test_label_trend_claim_passes_when_no_trend_words() -> None:
    r = _check_label_if_trend_claim(
        "emit",
        {"output": "Balance was $1234.56 as of 2026-04-20"},
        {"boundary": "act_on"},
    )
    assert r is None


# ---------------------------------------------------------------------------
# Policy dataclass validation
# ---------------------------------------------------------------------------


def test_policy_rejects_invalid_trigger() -> None:
    with pytest.raises(ValueError, match="invalid trigger"):
        Policy(id="p1", trigger="whenever", rule="r")


def test_policy_rejects_invalid_severity() -> None:
    with pytest.raises(ValueError, match="invalid severity"):
        Policy(id="p1", trigger="on_every_action", rule="r", severity="maybe")


def test_policy_rejects_invalid_boundary() -> None:
    with pytest.raises(ValueError, match="invalid boundary"):
        Policy(id="p1", trigger="on_every_action", rule="r", boundary="middle")


# ---------------------------------------------------------------------------
# PolicyEngine behavior
# ---------------------------------------------------------------------------


def _base_engine() -> PolicyEngine:
    return PolicyEngine(
        policies=[
            Policy(
                id="p_source",
                trigger="on_every_action",
                rule="Action must have source_refs",
                severity="blocking",
                check="must_have_source_ref",
            ),
            Policy(
                id="p_approve",
                trigger="on_every_action",
                rule="Refund >= $500 requires approval",
                severity="blocking",
                check="approval_above:500",
            ),
            Policy(
                id="p_trend",
                trigger="on_output_emit",
                rule="Trend claims must be interpret_first",
                severity="warning",
                check="label_if_trend_claim",
            ),
        ]
    )


def test_engine_blocks_missing_source_ref() -> None:
    engine = _base_engine()
    with pytest.raises(PolicyViolation) as exc_info:
        engine.validate_action("refund", {"amount": 10}, {})
    assert exc_info.value.policy_id == "p_source"
    assert exc_info.value.severity == "blocking"
    # Denial should be recorded on engine
    assert len(engine.denials) == 1


def test_engine_blocks_unapproved_large_refund() -> None:
    engine = _base_engine()
    with pytest.raises(PolicyViolation) as exc_info:
        engine.validate_action(
            "refund",
            {"amount": 750},
            {"source_refs": ["inv_1"]},  # first policy passes
        )
    assert exc_info.value.policy_id == "p_approve"


def test_engine_passes_small_refund_with_refs() -> None:
    engine = _base_engine()
    warnings = engine.validate_action(
        "refund",
        {"amount": 100},
        {"source_refs": ["inv_1"]},
    )
    assert warnings == []


def test_engine_returns_warnings_for_non_blocking() -> None:
    engine = _base_engine()
    warnings = engine.validate_action(
        "emit",
        {"output": "Sales are trending upward"},
        {"source_refs": ["rpt_1"], "boundary": "act_on"},
        trigger="on_output_emit",
    )
    assert len(warnings) == 1
    assert warnings[0].severity == "warning"
    assert warnings[0].policy_id == "p_trend"


def test_engine_trigger_filter() -> None:
    # on_output_emit trigger shouldn't run on_every_action?
    # Wait — on_every_action policies match every trigger per contract.
    engine = _base_engine()
    # Emitting with trigger "on_tool_emit" still runs p_source + p_approve
    with pytest.raises(PolicyViolation):
        engine.validate_action("fetch", {}, {}, trigger="on_tool_emit")


def test_engine_from_yaml_file(tmp_path) -> None:
    yaml_text = '''- id: test_pol
  trigger: on_every_action
  rule: Must have source refs
  severity: blocking
  check: must_have_source_ref
'''
    p = tmp_path / "policies.yaml"
    p.write_text(yaml_text, encoding="utf-8")
    engine = PolicyEngine.from_yaml_file(p)
    assert len(engine.policies) == 1
    assert engine.policies[0].id == "test_pol"
    with pytest.raises(PolicyViolation):
        engine.validate_action("fn", {}, {})


def test_engine_unknown_check_skipped_not_errored() -> None:
    # Forward-compatible: unknown check = skip
    engine = PolicyEngine(
        policies=[
            Policy(
                id="p_future",
                trigger="on_every_action",
                rule="future check",
                severity="blocking",
                check="some_future_check_we_havent_implemented",
            ),
        ]
    )
    # Should NOT raise
    warnings = engine.validate_action("fn", {}, {})
    assert warnings == []


def test_engine_missing_file_raises() -> None:
    with pytest.raises(FileNotFoundError):
        PolicyEngine.from_yaml_file("/nonexistent/policies.yaml")
