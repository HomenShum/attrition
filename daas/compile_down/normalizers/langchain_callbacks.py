"""LangChain BaseCallbackHandler event-stream normalizer.

LangChain / LangSmith emit a sequence of lifecycle events during an
agent run. The typical shape exported to JSONL by a custom handler
(or directly from LangSmith ``Run`` JSON) is::

    {"event": "on_chain_start",  "run_id": "a", "name": "AgentExecutor",
                                 "inputs": {"input": "find sku X"}}
    {"event": "on_llm_start",    "run_id": "b", "parent_run_id": "a",
                                 "prompts": ["..."]}
    {"event": "on_llm_end",      "run_id": "b",
                                 "response": {"generations": [[{"text": "..."}]],
                                              "llm_output": {"token_usage":
                                                             {"prompt_tokens": 40,
                                                              "completion_tokens": 8}}}}
    {"event": "on_tool_start",   "run_id": "c", "parent_run_id": "a",
                                 "name": "lookup_sku",
                                 "input_str": "{\"sku\": \"X\"}"}
    {"event": "on_tool_end",     "run_id": "c", "output": "$10"}
    {"event": "on_agent_action", "run_id": "a",
                                 "action": {"tool": "lookup_sku",
                                            "tool_input": {"sku": "X"},
                                            "log": "..."}}
    {"event": "on_agent_finish", "run_id": "a",
                                 "finish": {"return_values": {"output": "$10"},
                                            "log": "..."}}
    {"event": "on_chain_end",    "run_id": "a",
                                 "outputs": {"output": "$10"}}

We collapse the stream into a ``CanonicalTrace`` with:
    query         = first ``on_chain_start`` inputs.input
    final_answer  = last ``on_chain_end`` outputs.output
                    (or ``on_agent_finish.finish.return_values.output``)
    steps         = user + alternating (assistant w/ tool_calls, tool) turns
    source_model  = from ``on_llm_start.serialized.id`` when present

References:
- https://python.langchain.com/api_reference/core/callbacks/langchain_core.callbacks.base.BaseCallbackHandler.html
- https://docs.smith.langchain.com/reference/data_formats/run_data_format
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from daas.schemas import CanonicalTrace, ToolInvocation, TraceStep


def from_langchain_events(
    source: Path | str | list,
    *,
    session_id: str | None = None,
) -> CanonicalTrace:
    events = _load_events(source)

    query = ""
    final_answer = ""
    source_model = ""
    total_in = 0
    total_out = 0
    out_steps: list[TraceStep] = []

    # Walk events in order; maintain a "pending assistant" buffer so we
    # can attach tool_calls surfaced via on_agent_action to the previous
    # on_llm_end text.
    pending_assistant: dict[str, Any] | None = None

    def flush_assistant() -> None:
        nonlocal pending_assistant, final_answer
        if pending_assistant is None:
            return
        txt = pending_assistant.get("content", "")
        if txt:
            final_answer = txt
        out_steps.append(
            TraceStep(
                role="assistant",
                model=pending_assistant.get("model") or None,
                content=txt,
                tool_calls=pending_assistant.get("tool_calls") or [],
                input_tokens=int(pending_assistant.get("in_tok", 0) or 0),
                output_tokens=int(pending_assistant.get("out_tok", 0) or 0),
            )
        )
        pending_assistant = None

    for ev in events:
        if not isinstance(ev, dict):
            continue
        name = str(ev.get("event") or ev.get("type") or "")

        if name == "on_chain_start":
            inputs = ev.get("inputs") or {}
            text = _extract_input_text(inputs)
            if text and not query:
                query = text
            if text:
                out_steps.append(TraceStep(role="user", content=text))

        elif name == "on_llm_start":
            flush_assistant()
            ser = ev.get("serialized") or {}
            model = ""
            if isinstance(ser, dict):
                model = (
                    ser.get("id")[-1]
                    if isinstance(ser.get("id"), list) and ser.get("id")
                    else str(ser.get("name") or "")
                )
            if model and not source_model:
                source_model = model
            pending_assistant = {
                "content": "",
                "tool_calls": [],
                "model": model,
                "in_tok": 0,
                "out_tok": 0,
            }

        elif name == "on_llm_end":
            response = ev.get("response") or {}
            text = _extract_generation_text(response)
            usage = (response.get("llm_output") or {}).get("token_usage") or {}
            in_tok = int(usage.get("prompt_tokens", 0) or 0)
            out_tok = int(usage.get("completion_tokens", 0) or 0)
            total_in += in_tok
            total_out += out_tok
            if pending_assistant is None:
                pending_assistant = {"content": "", "tool_calls": []}
            pending_assistant["content"] = text
            pending_assistant["in_tok"] = in_tok
            pending_assistant["out_tok"] = out_tok

        elif name == "on_agent_action":
            action = ev.get("action") or {}
            tname = str(action.get("tool") or "").strip()
            if tname:
                tinput = action.get("tool_input") or {}
                if isinstance(tinput, str):
                    try:
                        tinput = json.loads(tinput)
                    except json.JSONDecodeError:
                        tinput = {"_raw": tinput}
                if pending_assistant is None:
                    pending_assistant = {"content": "", "tool_calls": []}
                pending_assistant["tool_calls"].append(
                    ToolInvocation(
                        name=tname,
                        args=tinput if isinstance(tinput, dict) else {"value": tinput},
                        result_summary="",
                    )
                )

        elif name == "on_tool_start":
            # Surface as an assistant tool call if we haven't already
            tname = str(ev.get("name") or "").strip()
            if tname:
                if pending_assistant is None:
                    pending_assistant = {"content": "", "tool_calls": []}
                raw = ev.get("input_str")
                if isinstance(raw, str) and raw.strip():
                    try:
                        args = json.loads(raw)
                        if not isinstance(args, dict):
                            args = {"value": args}
                    except json.JSONDecodeError:
                        args = {"_raw": raw}
                else:
                    args = ev.get("inputs") if isinstance(ev.get("inputs"), dict) else {}
                pending_assistant["tool_calls"].append(
                    ToolInvocation(name=tname, args=args, result_summary="")
                )

        elif name == "on_tool_end":
            # Flush assistant (carries tool_calls) then emit tool result
            flush_assistant()
            out_steps.append(
                TraceStep(role="tool", content=str(ev.get("output") or ""))
            )

        elif name == "on_agent_finish":
            flush_assistant()
            finish = ev.get("finish") or {}
            rv = finish.get("return_values") or {}
            out = rv.get("output") or rv.get("answer") or ""
            if out:
                final_answer = str(out)

        elif name == "on_chain_end":
            flush_assistant()
            outputs = ev.get("outputs") or {}
            out = _extract_input_text(outputs)
            if out:
                final_answer = out

    flush_assistant()

    return CanonicalTrace(
        session_id=session_id or "langchain-session",
        source_model=source_model or "langchain-unknown",
        query=query,
        final_answer=final_answer,
        steps=out_steps,
        total_tokens=total_in + total_out,
    )


# --- helpers --------------------------------------------------------------
def _load_events(source: Any) -> list[dict]:
    if isinstance(source, list):
        return source
    if isinstance(source, (str, Path)):
        p = Path(source)
        if p.exists():
            text = p.read_text(encoding="utf-8")
            lines = [ln for ln in text.splitlines() if ln.strip()]
            if len(lines) >= 1:
                # JSONL form
                try:
                    return [json.loads(ln) for ln in lines]
                except json.JSONDecodeError:
                    pass
            return json.loads(text)
        # Raw JSON string
        return json.loads(str(source))
    raise TypeError(f"Unsupported source type: {type(source)!r}")


def _extract_input_text(d: Any) -> str:
    if isinstance(d, str):
        return d
    if not isinstance(d, dict):
        return ""
    for k in ("input", "question", "query", "prompt", "output", "answer", "text"):
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v
    return ""


def _extract_generation_text(response: Any) -> str:
    if not isinstance(response, dict):
        return ""
    gens = response.get("generations")
    if isinstance(gens, list) and gens:
        first = gens[0]
        if isinstance(first, list) and first:
            cand = first[0]
            if isinstance(cand, dict):
                return str(cand.get("text") or "")
        elif isinstance(first, dict):
            return str(first.get("text") or "")
    # Some responses put text at top level
    return str(response.get("text") or "")
