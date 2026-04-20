"""Cursor session export normalizer.

Cursor does not publish a formal session export schema; we accept any
JSON with one of:
  { "messages": [{"role", "content", "tool_calls"?}, ...] }
  { "conversation": [{"role", "content"}, ...] }
  { "events": [{"kind", "text", "tool_name"?}, ...] }

We collapse into a CanonicalTrace. This is deliberately lenient so
teams can paste Cursor transcripts without hand-reshaping.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from daas.schemas import CanonicalTrace, ToolInvocation, TraceStep


def from_cursor_session(
    path_or_data: Path | str | dict[str, Any],
    *,
    session_id: str | None = None,
) -> CanonicalTrace:
    if isinstance(path_or_data, (Path, str)):
        p = Path(path_or_data)
        if not p.exists():
            raise FileNotFoundError(f"Cursor session not found: {p}")
        data = json.loads(p.read_text(encoding="utf-8"))
        sid = session_id or p.stem
    else:
        data = path_or_data
        sid = session_id or "cursor_session"

    messages = (
        data.get("messages")
        or data.get("conversation")
        or data.get("events")
        or []
    )
    query = ""
    final_answer = ""
    steps: list[TraceStep] = []
    source_model = str(data.get("model") or "cursor-unknown")

    for m in messages:
        if not isinstance(m, dict):
            continue
        role = m.get("role") or m.get("kind") or ""
        content = m.get("content") or m.get("text") or ""
        content_text = content if isinstance(content, str) else json.dumps(content)
        tool_calls_raw = m.get("tool_calls") or []
        tool_calls: list[ToolInvocation] = []
        for tc in tool_calls_raw:
            if not isinstance(tc, dict):
                continue
            tool_calls.append(
                ToolInvocation(
                    name=str(tc.get("name") or tc.get("function", {}).get("name") or ""),
                    args=dict(tc.get("arguments") or tc.get("args") or {}),
                    result_summary=str(tc.get("result") or ""),
                )
            )
        if role in ("user", "human") and not query:
            query = content_text
        if role in ("assistant", "ai", "model"):
            final_answer = content_text or final_answer
        steps.append(
            TraceStep(
                role=role or "unknown",
                content=content_text,
                tool_calls=tool_calls,
            )
        )

    return CanonicalTrace(
        session_id=sid,
        source_model=source_model,
        query=query,
        final_answer=final_answer,
        steps=steps,
    )
