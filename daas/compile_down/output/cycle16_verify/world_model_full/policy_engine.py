"""Policy engine bootstrap for the world-model substrate.

Usage in your generated runtime (e.g. orchestrator.py):

    from policy_engine import PolicyEngine, PolicyViolation

    engine = PolicyEngine.from_yaml_file("policies.yaml")

    try:
        engine.validate_action(action_name, args, context)
        # proceed to emit
    except PolicyViolation as e:
        engine.record_denial(e)
        # handle (block / human-escalate / fall back)

To vendor: copy attrition's policy_engine.py into this
package, or import from the attrition daas package if
you've installed it.
"""

try:
    from daas.compile_down.world_model.policy_engine import (
        PolicyEngine,
        PolicyViolation,
        Policy,
    )
except ImportError:  # vendored path fallback
    # Copy daas/compile_down/world_model/policy_engine.py next
    # to this file for zero-dep use.
    raise ImportError(
        "policy_engine.py not found. Either `pip install -e ."
        " the attrition repo or copy the module next to this"
        " file."
    )

__all__ = ["PolicyEngine", "PolicyViolation", "Policy"]
