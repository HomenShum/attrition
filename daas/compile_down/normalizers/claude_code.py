"""Claude Code JSONL session normalizer.

Input shape (one JSON object per line, observed in ~/.claude/projects/):
  {"type": "user", "message": {"content": ...}, "timestamp": "..."}
  {"type": "assistant", "message": {"content": [...], "model": "..."}, "timestamp": "..."}
  {"type": "tool_use", "name": "...", "input": {...}, "timestamp": "..."}
  {"type": "tool_result", "tool_use_id": "...", "content": ..., "timestamp": "..."}

We collapse this into a CanonicalTrace with:
  query         = first user message
  final_answer  = last assistant message's text content
  steps         = ordered (assistant | tool | user) turns with tool_calls
  source_model  = model from first assistant turn
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from daas.schemas import CanonicalTrace, ToolInvocation, TraceStep


def from_claude_code_jsonl(
    path: Path | str, *, session_id: str | None = None
) -> CanonicalTrace:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Claude Code session file not found: {p}")

    query = ""
    final_answer = ""
    source_model = ""
    steps: list[TraceStep] = []
    total_in = 0
    total_out = 0

    with p.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = str(row.get("type") or "")
            msg = row.get("message") or {}
            if kind == "user":
                raw_content = msg.get("content") or row.get("content") or ""
                # Detect tool-result wrappers: Claude Code JSONL stores
                # tool results as role=user messages whose content is a
                # list containing one or more {"type": "tool_result"}
                # blocks. We reclassify those as role="tool" so that
                # downstream phase/meta-workflow distillers don't treat
                # every tool round-trip as a human redirect.
                is_tool_result_wrapper = isinstance(raw_content, list) and any(
                    isinstance(b, dict) and b.get("type") == "tool_result"
                    for b in raw_content
                )
                content_text = (
                    raw_content
                    if isinstance(raw_content, str)
                    else _flatten_content(raw_content)
                )
                if is_tool_result_wrapper:
                    steps.append(TraceStep(role="tool", content=content_text))
                else:
                    if not query:
                        query = content_text
                    steps.append(TraceStep(role="user", content=content_text))
            elif kind == "assistant":
                content = msg.get("content") or []
                model = msg.get("model") or ""
                if model and not source_model:
                    source_model = model
                text_content = _flatten_content(content)
                tool_calls: list[ToolInvocation] = []
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "tool_use":
                            tool_calls.append(
                                ToolInvocation(
                                    name=str(block.get("name") or ""),
                                    args=dict(block.get("input") or {}),
                                    result_summary="",
                                )
                            )
                usage = msg.get("usage") or {}
                in_tok = int(usage.get("input_tokens", 0))
                out_tok = int(usage.get("output_tokens", 0))
                total_in += in_tok
                total_out += out_tok
                final_answer = text_content or final_answer
                steps.append(
                    TraceStep(
                        role="assistant",
                        model=model or None,
                        content=text_content,
                        tool_calls=tool_calls,
                        input_tokens=in_tok,
                        output_tokens=out_tok,
                    )
                )
            elif kind == "tool_use":
                steps.append(
                    TraceStep(
                        role="tool",
                        content="",
                        tool_calls=[
                            ToolInvocation(
                                name=str(row.get("name") or ""),
                                args=dict(row.get("input") or {}),
                                result_summary="",
                            )
                        ],
                    )
                )
            elif kind == "tool_result":
                content = row.get("content")
                steps.append(
                    TraceStep(
                        role="tool",
                        content=_flatten_content(content),
                    )
                )

    return CanonicalTrace(
        session_id=session_id or p.stem,
        source_model=source_model or "claude-unknown",
        query=query,
        final_answer=final_answer,
        steps=steps,
        total_tokens=total_in + total_out,
    )


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
                    parts.append(str(b.get("text", "")))
                elif t == "tool_result":
                    parts.append(str(b.get("content", "")))
                # tool_use blocks are handled separately by caller
            elif isinstance(b, str):
                parts.append(b)
        return "\n".join(parts)
    if isinstance(content, dict):
        if "text" in content:
            return str(content["text"])
    return str(content)
