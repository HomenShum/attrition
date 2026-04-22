"""Rate-limit shield for the emit + eval pipeline.

Two complementary limits:

    1. Per-IP RPM    — 60 requests / minute rolling window
    2. Per-session   — 40-tool soft cap on a single emit

Stdlib-only, in-memory, thread-safe. When running behind a load
balancer with multiple Cloud Run replicas, this becomes per-replica
and the effective global limit is replicas × 60 RPM, which is still
orders of magnitude below any Gemini tier-1 cap.

If you need durable cross-replica rate-limiting later, swap the
``_ip_bucket`` dict for a Redis ZSET — same interface.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any, Callable

# ---------- limits --------------------------------------------------------
PER_IP_RPM = 60
WINDOW_SECONDS = 60.0
PER_SESSION_MAX_TOOLS = 40


# ---------- per-IP window --------------------------------------------------
_ip_bucket: dict[str, deque[float]] = {}
_ip_lock = threading.Lock()


def check_ip_rate_limit(ip: str, *, now: float | None = None) -> tuple[bool, int]:
    """Return (allowed, remaining). Purely non-blocking; caller decides
    whether to 429 or queue.
    """
    t = now if now is not None else time.time()
    with _ip_lock:
        bucket = _ip_bucket.setdefault(ip, deque())
        cutoff = t - WINDOW_SECONDS
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= PER_IP_RPM:
            return False, 0
        bucket.append(t)
        return True, PER_IP_RPM - len(bucket)


# ---------- per-session tool cap ------------------------------------------
class SessionToolLimitExceeded(Exception):
    """Raised when a single emit spec declares more tools than we
    evaluate in a single round-trip. Surface this as a user-facing
    message: "Large spec detected — evaluating first 40 tools; the
    rest are queued."
    """


def enforce_session_tool_cap(tool_count: int) -> int:
    """Return the SAFE tool count to use (clamped to the cap).
    Raises if the input is pathological.
    """
    if tool_count < 0:
        raise ValueError("tool_count must be non-negative")
    if tool_count == 0:
        return 0
    if tool_count > PER_SESSION_MAX_TOOLS:
        # We allow it but clamp; caller is responsible for telling the
        # user which N tools got evaluated. Pathological inputs
        # (> 10_000) are still refused — those are almost certainly
        # an attack or a bad spec.
        if tool_count > 10_000:
            raise SessionToolLimitExceeded(
                f"spec declares {tool_count} tools — pathological, refused"
            )
        return PER_SESSION_MAX_TOOLS
    return tool_count


# ---------- decorator ----------------------------------------------------
def rate_limited(ip_getter: Callable[..., str] = lambda **kw: kw.get("ip", "unknown")):
    """Decorator: 429 before invoking the wrapped function if the IP's
    rolling window is saturated. The wrapped function should take
    ``ip=`` kwarg (or provide a custom ``ip_getter``).
    """

    def wrap(fn: Callable[..., Any]) -> Callable[..., Any]:
        def inner(*args: Any, **kwargs: Any) -> Any:
            ip = ip_getter(*args, **kwargs)
            allowed, remaining = check_ip_rate_limit(ip)
            if not allowed:
                raise RuntimeError(
                    f"rate-limited ({PER_IP_RPM} RPM cap exceeded for {ip}); "
                    f"try again in <= {int(WINDOW_SECONDS)} seconds"
                )
            return fn(*args, **kwargs)

        inner.__wrapped__ = fn  # type: ignore[attr-defined]
        inner.__name__ = fn.__name__
        return inner

    return wrap


__all__ = [
    "PER_IP_RPM",
    "WINDOW_SECONDS",
    "PER_SESSION_MAX_TOOLS",
    "SessionToolLimitExceeded",
    "check_ip_rate_limit",
    "enforce_session_tool_cap",
    "rate_limited",
]
