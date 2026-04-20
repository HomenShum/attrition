"""tau2-bench — customer-service agent eval (retail / telecom / airline).

Source: https://github.com/sierra-research/tau2-bench
License: Apache 2.0

tau2 evaluates a customer-service agent given:
  - a policy document
  - a tool surface (DB + external APIs)
  - a user goal
  - optional user-side tools

The agent must satisfy the goal while following policy. Scoring is
deterministic via DB-end-state match + expected-action match against
the Sierra policy engine.

This is the closest public analog to FloorAI's retail-ops flow and is
the default benchmark attrition runs for retail / support compile_up
and compile_down recommendations.

## Sierra simulator integration

The full tau2 scoring path requires the `sierra-research/tau2-bench`
repository cloned locally with the Sierra simulator installed:

    git clone https://github.com/sierra-research/tau2-bench
    cd tau2-bench
    pip install -e .

Once installed, ``run_task`` uses the simulator's scoring path. Without
it, run_task returns a harness_error indicating the simulator is missing
— the adapter NEVER fakes a verdict.

The task loader (``load_tasks``) works offline from the HuggingFace
mirror at ``HuggingFaceH4/tau2-bench-data`` — you can inspect task
structure without the simulator installed.
"""

from daas.benchmarks.tau2.runner import (
    load_tasks,
    run_task,
    simulator_available,
)

__all__ = ["load_tasks", "run_task", "simulator_available"]
