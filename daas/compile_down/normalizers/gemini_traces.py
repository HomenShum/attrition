"""Google Gemini / Vertex AI function-calling trace normalizer.

Supported input shapes (auto-detected):

1. **Multi-turn `contents` history** — the shape you build up as you
   call ``generateContent`` repeatedly::

       [
         {"role": "user",     "parts": [{"text": "find sku X"}]},
         {"role": "model",    "parts": [{"functionCall": {"name": "lookup_sku",
                                                          "args": {"sku": "X"}}}]},
         {"role": "function", "parts": [{"functionResponse":
                                           {"name": "lookup_sku",
                                            "response": {"price": 10}}}]},
         {"role": "model",    "parts": [{"text": "That SKU costs $10."}]},
       ]

2. **A single `generateContent` response**:
   ::

       {
         "candidates": [{
           "content": {"role": "model",
                       "parts": [{"text": "..."},
                                 {"functionCall": {...}}]}
         }],
         "usageMetadata": {"promptTokenCount": 40,
                           "candidatesTokenCount": 12,
                           "totalTokenCount": 52}
       }

3. **A session envelope**:
   ::

       {"session_id": "...",
        "model": "gemini-3.1-pro-preview",
        "contents": [...history...],
        "usage": {...}}

References:
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/function-calling
- https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from daas.schemas import CanonicalTrace, ToolInvocation, TraceStep


def from_gemini_trace(
    source: Path | str | dict | list,
    *,
    session_id: str | None = None,
) -> CanonicalTrace:
    data = _load(source)
    contents, meta = _coerce_to_contents(data)

    query = ""
    final_answer = ""
    source_model = str(meta.get("model") or "") or "gemini-unknown"
    out_steps: list[TraceStep] = []

    # Usage accounting — Gemini reports per-request, not per-step.
    total_in = int(
        (meta.get("usage") or {}).get("promptTokenCount")
        or (meta.get("usageMetadata") or {}).get("promptTokenCount")
        or 0
    )
    total_out = int(
        (meta.get("usage") or {}).get("candidatesTokenCount")
        or (meta.get("usageMetadata") or {}).get("candidatesTokenCount")
        or 0
    )

    for item in contents:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").lower()
        parts = item.get("parts") or []
        if not isinstance(parts, list):
            parts = [parts]

        text_buf: list[str] = []
        tool_calls: list[ToolInvocation] = []
        tool_results: list[str] = []

        for p in parts:
            if isinstance(p, str):
                text_buf.append(p)
                continue
            if not isinstance(p, dict):
                continue
            if "text" in p:
                text_buf.append(str(p.get("text") or ""))
            if "functionCall" in p:
                fc = p["functionCall"] or {}
                name = str(fc.get("name") or "").strip()
                if name:
                    args = fc.get("args") or fc.get("arguments") or {}
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except json.JSONDecodeError:
                            args = {"_raw": args}
                    tool_calls.append(
                        ToolInvocation(
                            name=name,
                            args=args if isinstance(args, dict) else {"value": args},
                            result_summary="",
                        )
                    )
            if "functionResponse" in p:
                fr = p["functionResponse"] or {}
                name = str(fr.get("name") or "")
                resp = fr.get("response")
                tool_results.append(f"{name}: {_truncate(resp)}")
            if "inlineData" in p or "fileData" in p:
                text_buf.append("[media attachment]")

        content_text = "\n".join(t for t in text_buf if t)

        if role in {"user", ""}:
            if not query:
                query = content_text
            out_steps.append(TraceStep(role="user", content=content_text))
        elif role == "model":
            final_answer = content_text or final_answer
            out_steps.append(
                TraceStep(
                    role="assistant",
                    model=source_model or None,
                    content=content_text,
                    tool_calls=tool_calls,
                )
            )
        elif role in {"function", "tool"}:
            out_steps.append(
                TraceStep(
                    role="tool",
                    content="\n".join(tool_results) if tool_results else content_text,
                )
            )
        else:
            out_steps.append(TraceStep(role=role, content=content_text))

    return CanonicalTrace(
        session_id=session_id or str(meta.get("session_id") or "gemini-session"),
        source_model=source_model,
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
            return json.loads(p.read_text(encoding="utf-8"))
        return json.loads(str(source))
    raise TypeError(f"Unsupported source type: {type(source)!r}")


def _coerce_to_contents(data: Any) -> tuple[list[dict], dict]:
    """Return (contents_list, meta_dict) regardless of wrapper shape."""
    if isinstance(data, list):
        return data, {}
    if not isinstance(data, dict):
        return [], {}
    # Full session envelope
    if "contents" in data and isinstance(data["contents"], list):
        return data["contents"], data
    # Single generateContent response
    if "candidates" in data and isinstance(data["candidates"], list):
        synth: list[dict] = []
        for c in data["candidates"]:
            content = (c or {}).get("content")
            if isinstance(content, dict):
                synth.append(content)
        return synth, data
    # Single Content object
    if "parts" in data:
        return [data], {}
    return [], data


def _truncate(value: Any, n: int = 200) -> str:
    try:
        s = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
    except (TypeError, ValueError):
        s = str(value)
    return s if len(s) <= n else s[: n - 1] + "\u2026"
