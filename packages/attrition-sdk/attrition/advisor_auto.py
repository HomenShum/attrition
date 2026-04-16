"""Auto-instrumentation for advisor mode — zero-config cost tracking.

Monkey-patches Anthropic and OpenAI clients to automatically detect
executor vs advisor calls based on model name. No manual log_executor_call()
or log_advisor_call() needed.

Usage:
    from attrition.advisor_auto import enable_advisor_tracking

    enable_advisor_tracking(
        executor_models=["claude-sonnet-4-6", "gpt-4o-mini"],
        advisor_models=["claude-opus-4-6", "gpt-4o"],
    )

    # Now all LLM calls are automatically tracked.
    # Calls to executor models → tracked as executor
    # Calls to advisor models → tracked as advisor
    # Session summary pushed on atexit.
"""

import atexit
import functools
import time
from typing import Optional

from attrition.advisor import AdvisorTracker

_tracker: Optional[AdvisorTracker] = None
_executor_models: set[str] = set()
_advisor_models: set[str] = set()
_patched: set[str] = set()


def enable_advisor_tracking(
    executor_models: Optional[list[str]] = None,
    advisor_models: Optional[list[str]] = None,
    endpoint: Optional[str] = None,
    auto_end_session: bool = True,
):
    """Enable automatic advisor mode tracking on all LLM calls.

    Args:
        executor_models: Model names that are "cheap" executors.
            Default: ["claude-sonnet-4-6", "claude-haiku-4-5", "gpt-4o-mini"]
        advisor_models: Model names that are "expensive" advisors.
            Default: ["claude-opus-4-6", "gpt-4o", "gpt-4-turbo", "o1-preview"]
        endpoint: attrition backend URL
        auto_end_session: Push session summary on process exit
    """
    global _tracker, _executor_models, _advisor_models

    _executor_models = set(executor_models or [
        "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-3-5-sonnet",
        "claude-haiku-4-5", "claude-3-5-haiku",
        "gpt-4o-mini", "gpt-3.5-turbo",
        "gemini-3.1-flash-lite-preview", "gemini-2.5-flash",
    ])

    _advisor_models = set(advisor_models or [
        "claude-opus-4-6", "claude-opus-4-5",
        "gpt-4o", "gpt-4-turbo", "o1-preview", "o1-mini", "o3-mini",
        "gemini-2.5-pro",
    ])

    # Pick the first executor/advisor as the tracker's primary models
    exec_model = list(_executor_models)[0] if _executor_models else "claude-sonnet-4-6"
    adv_model = list(_advisor_models)[0] if _advisor_models else "claude-opus-4-6"

    _tracker = AdvisorTracker(
        executor_model=exec_model,
        advisor_model=adv_model,
        endpoint=endpoint,
    )

    # Patch available providers
    _try_patch_anthropic()
    _try_patch_openai()

    # Auto-push session summary on exit
    if auto_end_session:
        atexit.register(_auto_end_session)


def _classify_model(model: str) -> str:
    """Classify a model as 'executor', 'advisor', or 'unknown'."""
    if model in _executor_models:
        return "executor"
    if model in _advisor_models:
        return "advisor"
    # Heuristic: expensive models are advisors
    lower = model.lower()
    if any(k in lower for k in ["opus", "gpt-4o", "o1-", "o3-", "pro"]):
        if "mini" not in lower:
            return "advisor"
    return "executor"  # Default to executor (cheaper assumption)


def _try_patch_anthropic():
    """Monkey-patch Anthropic Messages.create to auto-track."""
    if "anthropic" in _patched:
        return
    try:
        import anthropic
        original_create = anthropic.resources.Messages.create

        @functools.wraps(original_create)
        def tracked_create(self, *args, **kwargs):
            start = time.time()
            response = original_create(self, *args, **kwargs)
            latency_ms = int((time.time() - start) * 1000)

            model = kwargs.get("model", getattr(response, "model", "unknown"))
            usage = getattr(response, "usage", None)
            if usage and _tracker:
                inp = getattr(usage, "input_tokens", 0)
                out = getattr(usage, "output_tokens", 0)
                role = _classify_model(model)

                if role == "advisor":
                    # Detect trigger from context
                    _tracker.log_advisor_call(
                        trigger="auto_detected",
                        input_tokens=inp,
                        output_tokens=out,
                        advice_type="llm_call",
                        advice_summary=f"Auto-detected {model} call",
                        latency_ms=latency_ms,
                    )
                else:
                    _tracker.log_executor_call(
                        input_tokens=inp,
                        output_tokens=out,
                    )

            return response

        anthropic.resources.Messages.create = tracked_create
        _patched.add("anthropic")
    except (ImportError, AttributeError):
        pass


def _try_patch_openai():
    """Monkey-patch OpenAI ChatCompletions.create to auto-track."""
    if "openai" in _patched:
        return
    try:
        import openai
        original_create = openai.resources.chat.Completions.create

        @functools.wraps(original_create)
        def tracked_create(self, *args, **kwargs):
            start = time.time()
            response = original_create(self, *args, **kwargs)
            latency_ms = int((time.time() - start) * 1000)

            model = kwargs.get("model", getattr(response, "model", "unknown"))
            usage = getattr(response, "usage", None)
            if usage and _tracker:
                inp = getattr(usage, "prompt_tokens", 0)
                out = getattr(usage, "completion_tokens", 0)
                role = _classify_model(model)

                if role == "advisor":
                    _tracker.log_advisor_call(
                        trigger="auto_detected",
                        input_tokens=inp,
                        output_tokens=out,
                        advice_type="llm_call",
                        advice_summary=f"Auto-detected {model} call",
                        latency_ms=latency_ms,
                    )
                else:
                    _tracker.log_executor_call(
                        input_tokens=inp,
                        output_tokens=out,
                    )

            return response

        openai.resources.chat.Completions.create = tracked_create
        _patched.add("openai")
    except (ImportError, AttributeError):
        pass


def _auto_end_session():
    """Called on process exit to push session summary."""
    if _tracker:
        try:
            _tracker.end_session(task_completed=True, user_corrections=0)
        except Exception:
            pass
