"""OpenAI Agents SDK / Chat Completions trace normalizer.

Supported input shapes (auto-detected):

1. **Chat completions messages array** (most common):
   ::

       [
         {"role": "user", "content": "..."},
         {"role": "assistant",
          "content": "...",
          "tool_calls": [
            {"id": "call_abc", "type": "function",
             "function": {"name": "lookup_sku",
                          "arguments": "{\"sku\": \"X\"}"}}
          ]},
         {"role": "tool", "tool_call_id": "call_abc", "content": "..."},
         ...
       ]

2. **OpenAI Assistants API run-step stream**:
   ::

       [
         {"id": "step_...", "type": "message_creation",
          "step_details": {"type": "message_creation",
                           "message_creation": {"message_id": "..."}}},
         {"id": "step_...", "type": "tool_calls",
          "step_details": {"type": "tool_calls",
                           "tool_calls": [{"type": "function",
                                           "function": {"name": "...",
                                                        "arguments": "..."}}]},
          "usage": {"prompt_tokens": 40, "completion_tokens": 12}},
         ...
       ]

3. **Agents SDK AgentRun trace** — same shape as Chat Completions
   messages, with an optional top-level ``{"run_id": "...",
   "messages": [...]}`` wrapper.

References:
- https://platform.openai.com/docs/api-reference/chat/object
- https://platform.openai.com/docs/api-reference/runs/stepObject
- https://github.com/openai/openai-agents-python
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from daas.schemas import CanonicalTrace, ToolInvocation, TraceStep


def from_openai_trace(
    source: Path | str | dict | list,
    *,
    session_id: str | None = None,
) -> CanonicalTrace:
    """Normalize an OpenAI trace payload into CanonicalTrace.

    ``source`` can be:
      - a ``Path`` or ``str`` filepath to a JSON or JSONL file
      - a raw JSON string
      - an already-parsed ``list`` (messages / steps) or ``dict``
        (``{"messages": [...]}`` or ``{"steps": [...]}``)
    """
    data = _load(source)
    steps_raw, session_hint = _coerce_to_stream(data)

    query = ""
    final_answer = ""
    source_model = ""
    total_in = 0
    total_out = 0
    out_steps: list[TraceStep] = []

    for event in steps_raw:
        kind = _classify_event(event)
        if kind == "chat_message":
            role = str(event.get("role") or "").lower()
            content_raw = event.get("content")
            content_text = _flatten_content(content_raw)
            tool_calls_raw = event.get("tool_calls") or []
            tool_calls = [_parse_tool_call(tc) for tc in tool_calls_raw]
            tool_calls = [tc for tc in tool_calls if tc is not None]

            if role == "user":
                if not query:
                    query = content_text
                out_steps.append(TraceStep(role="user", content=content_text))
            elif role == "assistant":
                model = str(event.get("model") or "")
                if model and not source_model:
                    source_model = model
                final_answer = content_text or final_answer
                usage = event.get("usage") or {}
                in_tok = int(usage.get("prompt_tokens", usage.get("input_tokens", 0)) or 0)
                out_tok = int(usage.get("completion_tokens", usage.get("output_tokens", 0)) or 0)
                total_in += in_tok
                total_out += out_tok
                out_steps.append(
                    TraceStep(
                        role="assistant",
                        model=model or None,
                        content=content_text,
                        tool_calls=tool_calls,
                        input_tokens=in_tok,
                        output_tokens=out_tok,
                    )
                )
            elif role == "tool":
                # Tool response message
                out_steps.append(
                    TraceStep(role="tool", content=content_text)
                )
            elif role == "system":
                # system prompts are metadata, not a workflow step
                continue
            else:
                # Unknown role -> drop into assistant bucket as neutral
                out_steps.append(
                    TraceStep(role=role or "assistant", content=content_text)
                )

        elif kind == "run_step":
            step_type = str(event.get("type") or "")
            details = event.get("step_details") or {}
            usage = event.get("usage") or {}
            in_tok = int(usage.get("prompt_tokens", 0) or 0)
            out_tok = int(usage.get("completion_tokens", 0) or 0)
            total_in += in_tok
            total_out += out_tok

            if step_type == "tool_calls":
                tool_calls_raw = details.get("tool_calls") or []
                tool_calls = [_parse_tool_call(tc) for tc in tool_calls_raw]
                tool_calls = [tc for tc in tool_calls if tc is not None]
                out_steps.append(
                    TraceStep(
                        role="assistant",
                        content="",
                        tool_calls=tool_calls,
                        input_tokens=in_tok,
                        output_tokens=out_tok,
                    )
                )
            elif step_type == "message_creation":
                # Placeholder message step; actual text lives on the
                # Assistants ``message`` object, which many exporters
                # splice in directly. We emit a zero-content assistant
                # step so the sequence stays correct.
                msg = details.get("message_creation") or {}
                out_steps.append(
                    TraceStep(
                        role="assistant",
                        content=_flatten_content(msg.get("content")),
                        input_tokens=in_tok,
                        output_tokens=out_tok,
                    )
                )

    return CanonicalTrace(
        session_id=session_id or session_hint or "openai-session",
        source_model=source_model or "openai-unknown",
        query=query,
        final_answer=final_answer,
        steps=out_steps,
        total_tokens=total_in + total_out,
    )


# --- helpers --------------------------------------------------------------
def _load(source: Any) -> Any:
    if isinstance(source, (dict, list)):
        return source
    if isinstance(source, (str, Path)):
        p = Path(source)
        if p.exists():
            text = p.read_text(encoding="utf-8")
            # Try JSONL first (stream of objects)
            lines = [ln for ln in text.splitlines() if ln.strip()]
            if len(lines) > 1:
                try:
                    return [json.loads(ln) for ln in lines]
                except json.JSONDecodeError:
                    pass
            return json.loads(text)
        # raw JSON string
        return json.loads(str(source))
    raise TypeError(f"Unsupported source type: {type(source)!r}")


def _coerce_to_stream(data: Any) -> tuple[list[dict], str]:
    """Unwrap common outer shapes to a plain list of event/message dicts."""
    if isinstance(data, dict):
        if "messages" in data and isinstance(data["messages"], list):
            return data["messages"], str(data.get("run_id") or data.get("id") or "")
        if "steps" in data and isinstance(data["steps"], list):
            return data["steps"], str(data.get("run_id") or data.get("id") or "")
        if "data" in data and isinstance(data["data"], list):
            return data["data"], str(data.get("run_id") or data.get("id") or "")
        # Single event
        return [data], ""
    if isinstance(data, list):
        return data, ""
    return [], ""


def _classify_event(event: dict) -> str:
    if not isinstance(event, dict):
        return "unknown"
    if "role" in event:
        return "chat_message"
    if event.get("object") == "thread.run.step" or "step_details" in event:
        return "run_step"
    # Some exporters flatten step_details inline
    if event.get("type") in {"tool_calls", "message_creation"} and (
        "tool_calls" in event or "message_creation" in event
    ):
        return "run_step"
    return "unknown"


def _parse_tool_call(tc: Any) -> ToolInvocation | None:
    if not isinstance(tc, dict):
        return None
    fn = tc.get("function") or {}
    name = str(fn.get("name") or tc.get("name") or "").strip()
    if not name:
        return None
    raw_args = fn.get("arguments") if fn.get("arguments") is not None else tc.get("arguments")
    args: dict[str, Any] = {}
    if isinstance(raw_args, dict):
        args = raw_args
    elif isinstance(raw_args, str) and raw_args.strip():
        try:
            parsed = json.loads(raw_args)
            if isinstance(parsed, dict):
                args = parsed
        except json.JSONDecodeError:
            args = {"_raw": raw_args}
    return ToolInvocation(name=name, args=args, result_summary="")


def _flatten_content(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for b in content:
            if isinstance(b, dict):
                t = b.get("type")
                if t == "text":
                    text = b.get("text") or ""
                    if isinstance(text, dict):
                        text = text.get("value", "")
                    parts.append(str(text))
                elif t == "output_text":
                    parts.append(str(b.get("text") or ""))
                elif t == "image_url":
                    parts.append("[image]")
            elif isinstance(b, str):
                parts.append(b)
        return "\n".join(p for p in parts if p)
    if isinstance(content, dict):
        if "text" in content:
            t = content["text"]
            if isinstance(t, dict):
                return str(t.get("value", ""))
            return str(t)
    return str(content)
