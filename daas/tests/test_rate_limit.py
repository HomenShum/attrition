"""Scenario tests for the rate-limit shield."""

from __future__ import annotations

import pytest

from daas.compile_down.rate_limit import (
    PER_IP_RPM,
    PER_SESSION_MAX_TOOLS,
    SessionToolLimitExceeded,
    check_ip_rate_limit,
    enforce_session_tool_cap,
)


def test_ip_rate_limit_allows_up_to_cap():
    ip = "scenario-a"
    t0 = 1_000_000.0
    for i in range(PER_IP_RPM):
        allowed, remaining = check_ip_rate_limit(ip, now=t0 + i * 0.1)
        assert allowed, f"request {i} should be allowed"
    # Next one inside window should be denied
    allowed, _ = check_ip_rate_limit(ip, now=t0 + 0.5)
    assert not allowed


def test_ip_rate_limit_recovers_after_window():
    ip = "scenario-b"
    t0 = 2_000_000.0
    for i in range(PER_IP_RPM):
        check_ip_rate_limit(ip, now=t0 + i * 0.05)
    # Force window to slide past
    later, _ = check_ip_rate_limit(ip, now=t0 + 120.0)
    assert later


def test_ip_rate_limit_is_per_ip():
    t0 = 3_000_000.0
    for i in range(PER_IP_RPM):
        check_ip_rate_limit("alpha", now=t0 + i * 0.05)
    # alpha is saturated; beta should still pass
    allowed, _ = check_ip_rate_limit("beta", now=t0 + 0.01)
    assert allowed


def test_session_tool_cap_clamps():
    assert enforce_session_tool_cap(0) == 0
    assert enforce_session_tool_cap(10) == 10
    assert enforce_session_tool_cap(PER_SESSION_MAX_TOOLS) == PER_SESSION_MAX_TOOLS
    # Above cap but not pathological -> clamp
    assert enforce_session_tool_cap(100) == PER_SESSION_MAX_TOOLS
    assert enforce_session_tool_cap(1000) == PER_SESSION_MAX_TOOLS


def test_session_tool_cap_refuses_pathological():
    with pytest.raises(SessionToolLimitExceeded):
        enforce_session_tool_cap(10_001)


def test_session_tool_cap_refuses_negative():
    with pytest.raises(ValueError):
        enforce_session_tool_cap(-1)
