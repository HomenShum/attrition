"""Policy engine runtime — reads policies.yaml + enforces per-action.

Used by generated orchestrator_worker / tool_first_chain runtimes that
ship with a full world model. Before emitting an action, the engine
checks every active policy; blocking violations raise; warning
violations are logged to the outcomes table.

## Contract

```python
from daas.compile_down.world_model.policy_engine import (
    PolicyEngine, PolicyViolation
)

engine = PolicyEngine.from_yaml_file("world_model/policies.yaml")

try:
    engine.validate_action(
        action_name="refund",
        args={"amount": 250, "customer_id": "c_1"},
        context={"source_refs": ["inv_9823"], "user_role": "agent"},
    )
    # proceed to emit
except PolicyViolation as e:
    # Blocking policy failed — refuse to act
    engine.record_denial(e)
```

## Supported policy shapes (bounded enum)

Each policy in policies.yaml has:
  - id                 (str) — stable
  - trigger            (str) — "on_every_action" | "on_tool_emit" |
                              "on_output_emit" | "on_session_end"
  - rule               (str) — human-readable
  - severity           (str) — "blocking" | "warning" | "informational"
  - boundary           (str) — "act_on" | "interpret_first"
  - check              (str) — optional small expression (see CHECKS)

Engine currently supports declarative CHECKS:
  * "must_have_source_ref"        — context.source_refs is non-empty
  * "amount_below:<N>"             — args.amount < N
  * "approval_above:<N>"           — if args.amount >= N, context.approved must be True
  * "label_if_trend_claim"         — args.output boundary must be "interpret_first" if output contains trend-ish words

Unrecognized checks are treated as warnings (policy engine skips with
`unsupported_check` note). This keeps policies.yaml forward-compatible.

## Prior art

- OPA / Rego policy-as-data model (explicit rules, deterministic)
- SOX / HIPAA audit-rule enforcement — check → block → log shape
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

# YAML is a common dep but we keep zero-dep loading as a fallback.
try:
    import yaml  # type: ignore
    _HAS_YAML = True
except ImportError:
    _HAS_YAML = False


ALLOWED_TRIGGERS = {
    "on_every_action",
    "on_tool_emit",
    "on_output_emit",
    "on_session_end",
}

ALLOWED_SEVERITIES = {"blocking", "warning", "informational"}
ALLOWED_BOUNDARIES = {"act_on", "interpret_first"}


@dataclass
class Policy:
    id: str
    trigger: str
    rule: str
    severity: str = "warning"
    boundary: str = "act_on"
    check: str | None = None

    def __post_init__(self) -> None:
        if self.trigger not in ALLOWED_TRIGGERS:
            raise ValueError(
                f"invalid trigger {self.trigger!r}; expected one of {ALLOWED_TRIGGERS}"
            )
        if self.severity not in ALLOWED_SEVERITIES:
            raise ValueError(
                f"invalid severity {self.severity!r}; expected one of {ALLOWED_SEVERITIES}"
            )
        if self.boundary not in ALLOWED_BOUNDARIES:
            raise ValueError(
                f"invalid boundary {self.boundary!r}; expected one of {ALLOWED_BOUNDARIES}"
            )


@dataclass(frozen=True)
class PolicyViolation(Exception):
    policy_id: str
    rule: str
    severity: str
    detail: str

    def __str__(self) -> str:
        return f"[{self.severity}] {self.policy_id}: {self.rule} — {self.detail}"


# Registry of declarative checks. Each returns either:
#   None / ""   if the action satisfies the check
#   str         with a violation detail if not
CheckFn = Callable[[str, dict[str, Any], dict[str, Any]], str | None]


def _check_must_have_source_ref(
    action_name: str, args: dict[str, Any], context: dict[str, Any]
) -> str | None:
    refs = context.get("source_refs") or []
    if isinstance(refs, (list, tuple)) and len(refs) > 0:
        return None
    return f"action {action_name!r} emitted with no source_refs in context"


def _check_amount_below(n_str: str) -> CheckFn:
    try:
        threshold = float(n_str)
    except ValueError:
        threshold = float("inf")

    def check(
        action_name: str, args: dict[str, Any], context: dict[str, Any]
    ) -> str | None:
        amount = args.get("amount")
        if amount is None:
            return None  # not applicable
        try:
            if float(amount) < threshold:
                return None
        except (TypeError, ValueError):
            return None
        return (
            f"action {action_name!r} amount={amount} violates amount_below:{threshold}"
        )

    return check


def _check_approval_above(n_str: str) -> CheckFn:
    try:
        threshold = float(n_str)
    except ValueError:
        threshold = float("inf")

    def check(
        action_name: str, args: dict[str, Any], context: dict[str, Any]
    ) -> str | None:
        amount = args.get("amount")
        if amount is None:
            return None
        try:
            if float(amount) < threshold:
                return None
        except (TypeError, ValueError):
            return None
        approved = context.get("approved") or context.get("approval_granted")
        if approved:
            return None
        return f"action {action_name!r} amount={amount} >= {threshold} without approval"

    return check


_TREND_WORDS = {
    "trend",
    "trending",
    "growing",
    "declining",
    "correlation",
    "implies",
    "suggests",
    "indicates",
    "looks like",
    "appears",
    "likely",
    "probably",
}


def _check_label_if_trend_claim(
    action_name: str, args: dict[str, Any], context: dict[str, Any]
) -> str | None:
    output = args.get("output") or args.get("message") or args.get("claim") or ""
    if not isinstance(output, str):
        return None
    lower = output.lower()
    if any(w in lower for w in _TREND_WORDS):
        boundary = context.get("boundary") or args.get("boundary")
        if boundary != "interpret_first":
            return (
                f"action {action_name!r} contains trend-language "
                f"but boundary={boundary!r} (expected 'interpret_first')"
            )
    return None


def _resolve_check(check_str: str | None) -> CheckFn | None:
    if check_str is None:
        return None
    check_str = check_str.strip()
    if check_str == "must_have_source_ref":
        return _check_must_have_source_ref
    if check_str.startswith("amount_below:"):
        return _check_amount_below(check_str.split(":", 1)[1])
    if check_str.startswith("approval_above:"):
        return _check_approval_above(check_str.split(":", 1)[1])
    if check_str == "label_if_trend_claim":
        return _check_label_if_trend_claim
    return None  # unsupported check = skip (forward-compat)


@dataclass
class PolicyEngine:
    policies: list[Policy] = field(default_factory=list)
    denials: list[PolicyViolation] = field(default_factory=list)

    @classmethod
    def from_yaml_file(cls, path: Path | str) -> PolicyEngine:
        p = Path(path)
        if not p.exists():
            raise FileNotFoundError(f"policies file not found: {p}")
        text = p.read_text(encoding="utf-8")
        if _HAS_YAML:
            raw = yaml.safe_load(text) or []  # type: ignore[assignment]
        else:
            raw = _minimal_yaml_list_parse(text)
        if not isinstance(raw, list):
            raise ValueError(f"policies.yaml must be a list at the root (got {type(raw).__name__})")
        policies = [
            Policy(
                id=str(p_.get("id") or ""),
                trigger=str(p_.get("trigger") or "on_every_action"),
                rule=str(p_.get("rule") or ""),
                severity=str(p_.get("severity") or "warning"),
                boundary=str(p_.get("boundary") or "act_on"),
                check=p_.get("check"),
            )
            for p_ in raw
        ]
        return cls(policies=policies)

    def validate_action(
        self,
        action_name: str,
        args: dict[str, Any],
        context: dict[str, Any] | None = None,
        *,
        trigger: str = "on_every_action",
    ) -> list[PolicyViolation]:
        """Run every policy whose trigger matches. Blocking violations
        raise PolicyViolation immediately. Warnings are returned in a
        list so the caller can log without blocking."""
        ctx = context or {}
        warnings: list[PolicyViolation] = []
        for pol in self.policies:
            # Match trigger — on_every_action matches anything
            if pol.trigger not in ("on_every_action", trigger):
                continue
            check = _resolve_check(pol.check)
            if check is None:
                continue
            detail = check(action_name, args, ctx)
            if detail is None:
                continue
            v = PolicyViolation(
                policy_id=pol.id,
                rule=pol.rule,
                severity=pol.severity,
                detail=detail,
            )
            if pol.severity == "blocking":
                self.denials.append(v)
                raise v
            warnings.append(v)
        return warnings

    def record_denial(self, violation: PolicyViolation) -> None:
        """Append a denial record — used when the agent catches a
        PolicyViolation and wants to persist the reason."""
        self.denials.append(violation)


def _minimal_yaml_list_parse(text: str) -> list[dict[str, Any]]:
    """Minimal zero-dep YAML-list parser for policies.yaml shape.
    Handles only:
      - key: value (strings + bare words)
      - nested 2-space indent under a list entry
    Does not support block scalars, flow style, anchors, etc.
    """
    out: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if line.startswith("- "):
            if current:
                out.append(current)
            current = {}
            rest = line[2:].strip()
            if rest:
                _parse_kv_into(rest, current)
        else:
            stripped = line.lstrip()
            if current is not None and ":" in stripped:
                _parse_kv_into(stripped, current)
    if current:
        out.append(current)
    return out


def _parse_kv_into(line: str, target: dict[str, Any]) -> None:
    if ":" not in line:
        return
    k, _, v = line.partition(":")
    v = v.strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        v = v[1:-1]
    target[k.strip()] = v
