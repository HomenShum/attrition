"""Scenario tests for the three SDK ingest normalizers:
    - OpenAI Agents SDK / Chat Completions
    - Google Gemini generateContent
    - LangChain BaseCallbackHandler event stream

Each test uses a synthetic fixture that matches the SDK's documented
format exactly (see the docstring at the top of each normalizer for
citations). We verify:
    1. ingest produces a CanonicalTrace with the right shape
    2. every tool invocation in the fixture survives into trace.steps
    3. first user prompt lands in trace.query
    4. final assistant text lands in trace.final_answer
    5. token accounting sums correctly when the fixture provides usage

Coverage matrix:
    - happy path (single tool call, one turn)
    - multi-turn (2+ tool calls across turns)
    - no-tool path (chat-only)
    - malformed / partial (missing fields)
"""

from __future__ import annotations

import json

import pytest

from daas.compile_down.normalizers.openai_agents import from_openai_trace
from daas.compile_down.normalizers.gemini_traces import from_gemini_trace
from daas.compile_down.normalizers.langchain_callbacks import from_langchain_events


# ---------------------------------------------------------------- OpenAI --
def test_openai_chat_completions_messages_single_tool_roundtrip() -> None:
    messages = [
        {"role": "user", "content": "find sku X123"},
        {
            "role": "assistant",
            "model": "gpt-4.1",
            "content": "Looking it up.",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "lookup_sku",
                        "arguments": json.dumps({"sku": "X123"}),
                    },
                }
            ],
            "usage": {"prompt_tokens": 40, "completion_tokens": 8},
        },
        {"role": "tool", "tool_call_id": "call_1", "content": "$10"},
        {
            "role": "assistant",
            "content": "That SKU costs $10.",
            "usage": {"prompt_tokens": 60, "completion_tokens": 10},
        },
    ]
    trace = from_openai_trace(messages)
    assert trace.query == "find sku X123"
    assert trace.final_answer == "That SKU costs $10."
    assert trace.source_model == "gpt-4.1"
    assert trace.total_tokens == 40 + 8 + 60 + 10
    # Tool call preserved with parsed args
    tool_calls = [tc for s in trace.steps for tc in (s.tool_calls or [])]
    assert len(tool_calls) == 1
    assert tool_calls[0].name == "lookup_sku"
    assert tool_calls[0].args == {"sku": "X123"}


def test_openai_assistants_run_steps_stream() -> None:
    steps_stream = [
        {
            "id": "step_1",
            "object": "thread.run.step",
            "type": "tool_calls",
            "step_details": {
                "type": "tool_calls",
                "tool_calls": [
                    {
                        "id": "tc1",
                        "type": "function",
                        "function": {"name": "search", "arguments": "{\"q\":\"x\"}"},
                    },
                    {
                        "id": "tc2",
                        "type": "function",
                        "function": {"name": "fetch", "arguments": "{\"url\":\"http://x\"}"},
                    },
                ],
            },
            "usage": {"prompt_tokens": 100, "completion_tokens": 20},
        },
        {
            "id": "step_2",
            "object": "thread.run.step",
            "type": "message_creation",
            "step_details": {
                "type": "message_creation",
                "message_creation": {"content": "done"},
            },
            "usage": {"prompt_tokens": 120, "completion_tokens": 5},
        },
    ]
    trace = from_openai_trace(steps_stream)
    all_tools = [tc.name for s in trace.steps for tc in (s.tool_calls or [])]
    assert all_tools == ["search", "fetch"]
    assert trace.total_tokens == 100 + 20 + 120 + 5


def test_openai_chat_no_tools_just_text() -> None:
    messages = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi there"},
    ]
    trace = from_openai_trace(messages)
    assert trace.query == "hello"
    assert trace.final_answer == "hi there"
    assert all(not (s.tool_calls or []) for s in trace.steps)


def test_openai_wrapped_in_run_envelope() -> None:
    payload = {
        "run_id": "run_abc",
        "messages": [
            {"role": "user", "content": "q"},
            {"role": "assistant", "content": "a"},
        ],
    }
    trace = from_openai_trace(payload)
    assert trace.session_id == "run_abc"
    assert trace.query == "q"
    assert trace.final_answer == "a"


def test_openai_malformed_tool_args_do_not_crash() -> None:
    messages = [
        {"role": "user", "content": "q"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "type": "function",
                    "function": {"name": "broken", "arguments": "{not valid json"},
                }
            ],
        },
    ]
    trace = from_openai_trace(messages)
    tc = next(tc for s in trace.steps for tc in (s.tool_calls or []))
    assert tc.name == "broken"
    # Arguments survive as _raw when not parseable
    assert "_raw" in tc.args


# ---------------------------------------------------------------- Gemini --
def test_gemini_multi_turn_contents_history() -> None:
    contents = [
        {"role": "user", "parts": [{"text": "find sku X"}]},
        {
            "role": "model",
            "parts": [
                {"text": "Looking up."},
                {"functionCall": {"name": "lookup_sku", "args": {"sku": "X"}}},
            ],
        },
        {
            "role": "function",
            "parts": [
                {
                    "functionResponse": {
                        "name": "lookup_sku",
                        "response": {"price": 10},
                    }
                }
            ],
        },
        {"role": "model", "parts": [{"text": "That SKU costs $10."}]},
    ]
    trace = from_gemini_trace(contents)
    assert trace.query == "find sku X"
    assert trace.final_answer == "That SKU costs $10."
    tool_calls = [tc for s in trace.steps for tc in (s.tool_calls or [])]
    assert [t.name for t in tool_calls] == ["lookup_sku"]
    assert tool_calls[0].args == {"sku": "X"}


def test_gemini_single_generate_content_response_with_usage() -> None:
    resp = {
        "candidates": [
            {
                "content": {
                    "role": "model",
                    "parts": [
                        {"text": "hello world"},
                        {"functionCall": {"name": "toggle", "args": {"on": True}}},
                    ],
                }
            }
        ],
        "usageMetadata": {
            "promptTokenCount": 100,
            "candidatesTokenCount": 20,
            "totalTokenCount": 120,
        },
    }
    trace = from_gemini_trace(resp)
    assert trace.total_tokens == 120
    assert trace.final_answer == "hello world"
    assert [
        tc.name for s in trace.steps for tc in (s.tool_calls or [])
    ] == ["toggle"]


def test_gemini_session_envelope_variant() -> None:
    payload = {
        "session_id": "sess_1",
        "model": "gemini-3.1-pro-preview",
        "contents": [
            {"role": "user", "parts": [{"text": "hi"}]},
            {"role": "model", "parts": [{"text": "hello"}]},
        ],
    }
    trace = from_gemini_trace(payload)
    assert trace.session_id == "sess_1"
    assert trace.source_model == "gemini-3.1-pro-preview"


def test_gemini_string_args_coerce_to_dict() -> None:
    # Some exporters serialize args as a JSON string
    contents = [
        {"role": "user", "parts": [{"text": "q"}]},
        {
            "role": "model",
            "parts": [
                {
                    "functionCall": {
                        "name": "tool_a",
                        "args": "{\"k\": 42}",
                    }
                }
            ],
        },
    ]
    trace = from_gemini_trace(contents)
    tc = next(tc for s in trace.steps for tc in (s.tool_calls or []))
    assert tc.args == {"k": 42}


# ------------------------------------------------------------ LangChain --
def test_langchain_agent_run_single_tool_cycle() -> None:
    events = [
        {
            "event": "on_chain_start",
            "run_id": "root",
            "name": "AgentExecutor",
            "inputs": {"input": "find sku X"},
        },
        {
            "event": "on_llm_start",
            "run_id": "llm1",
            "parent_run_id": "root",
            "serialized": {"id": ["langchain", "chat_models", "openai", "ChatOpenAI"]},
            "prompts": ["..."],
        },
        {
            "event": "on_llm_end",
            "run_id": "llm1",
            "response": {
                "generations": [[{"text": "Calling tool."}]],
                "llm_output": {
                    "token_usage": {"prompt_tokens": 40, "completion_tokens": 8}
                },
            },
        },
        {
            "event": "on_agent_action",
            "run_id": "root",
            "action": {
                "tool": "lookup_sku",
                "tool_input": {"sku": "X"},
                "log": "...",
            },
        },
        {
            "event": "on_tool_start",
            "run_id": "t1",
            "parent_run_id": "root",
            "name": "lookup_sku",
            "input_str": json.dumps({"sku": "X"}),
        },
        {"event": "on_tool_end", "run_id": "t1", "output": "$10"},
        {
            "event": "on_agent_finish",
            "run_id": "root",
            "finish": {"return_values": {"output": "That SKU costs $10."}, "log": "..."},
        },
        {
            "event": "on_chain_end",
            "run_id": "root",
            "outputs": {"output": "That SKU costs $10."},
        },
    ]
    trace = from_langchain_events(events)
    assert trace.query == "find sku X"
    assert trace.final_answer == "That SKU costs $10."
    assert "ChatOpenAI" in trace.source_model or trace.source_model.startswith("ChatOpenAI")
    tool_calls = [tc for s in trace.steps for tc in (s.tool_calls or [])]
    assert any(tc.name == "lookup_sku" for tc in tool_calls)
    assert trace.total_tokens == 40 + 8


def test_langchain_pure_chat_no_tools() -> None:
    events = [
        {"event": "on_chain_start", "run_id": "r", "inputs": {"input": "hi"}},
        {
            "event": "on_llm_start",
            "run_id": "l",
            "serialized": {"name": "ChatAnthropic"},
            "prompts": [""],
        },
        {
            "event": "on_llm_end",
            "run_id": "l",
            "response": {"generations": [[{"text": "hello"}]]},
        },
        {"event": "on_chain_end", "run_id": "r", "outputs": {"output": "hello"}},
    ]
    trace = from_langchain_events(events)
    assert trace.query == "hi"
    assert trace.final_answer == "hello"
    assert all(not (s.tool_calls or []) for s in trace.steps)


def test_langchain_two_tool_cycles_preserved_in_order() -> None:
    events = [
        {"event": "on_chain_start", "run_id": "r", "inputs": {"input": "q"}},
        {
            "event": "on_llm_start",
            "run_id": "l1",
            "serialized": {"name": "ChatOpenAI"},
            "prompts": [""],
        },
        {
            "event": "on_llm_end",
            "run_id": "l1",
            "response": {"generations": [[{"text": "calling A"}]]},
        },
        {
            "event": "on_tool_start",
            "run_id": "a",
            "name": "toolA",
            "input_str": "{\"x\": 1}",
        },
        {"event": "on_tool_end", "run_id": "a", "output": "resA"},
        {
            "event": "on_llm_start",
            "run_id": "l2",
            "serialized": {"name": "ChatOpenAI"},
            "prompts": [""],
        },
        {
            "event": "on_llm_end",
            "run_id": "l2",
            "response": {"generations": [[{"text": "calling B"}]]},
        },
        {
            "event": "on_tool_start",
            "run_id": "b",
            "name": "toolB",
            "input_str": "{\"y\": 2}",
        },
        {"event": "on_tool_end", "run_id": "b", "output": "resB"},
        {
            "event": "on_agent_finish",
            "run_id": "r",
            "finish": {"return_values": {"output": "done"}},
        },
    ]
    trace = from_langchain_events(events)
    names = [tc.name for s in trace.steps for tc in (s.tool_calls or [])]
    assert names == ["toolA", "toolB"]
    # Tool results preserved
    tool_texts = [s.content for s in trace.steps if s.role == "tool"]
    assert "resA" in tool_texts and "resB" in tool_texts


# -------------------------------------------------------- Cross-SDK parity
def test_all_three_normalize_to_same_canonical_shape() -> None:
    """Proof of the vision: three different wire formats collapse to
    the same CanonicalTrace shape — enabling corpus-level analysis
    across SDKs.
    """
    openai_payload = [
        {"role": "user", "content": "q"},
        {
            "role": "assistant",
            "content": "a",
            "tool_calls": [
                {
                    "type": "function",
                    "function": {"name": "T", "arguments": "{\"k\":1}"},
                }
            ],
        },
    ]
    gemini_payload = [
        {"role": "user", "parts": [{"text": "q"}]},
        {
            "role": "model",
            "parts": [
                {"text": "a"},
                {"functionCall": {"name": "T", "args": {"k": 1}}},
            ],
        },
    ]
    lc_events = [
        {"event": "on_chain_start", "run_id": "r", "inputs": {"input": "q"}},
        {
            "event": "on_llm_start",
            "run_id": "l",
            "serialized": {"name": "m"},
            "prompts": [""],
        },
        {
            "event": "on_llm_end",
            "run_id": "l",
            "response": {"generations": [[{"text": "a"}]]},
        },
        {"event": "on_tool_start", "run_id": "t", "name": "T", "input_str": "{\"k\":1}"},
        {"event": "on_tool_end", "run_id": "t", "output": "r"},
        {"event": "on_agent_finish", "run_id": "r", "finish": {"return_values": {"output": "a"}}},
    ]
    t_oai = from_openai_trace(openai_payload)
    t_gem = from_gemini_trace(gemini_payload)
    t_lc = from_langchain_events(lc_events)

    # All three resolved the same user query + tool invocation
    for t in (t_oai, t_gem, t_lc):
        assert t.query == "q"
        tool_names = [tc.name for s in t.steps for tc in (s.tool_calls or [])]
        assert tool_names == ["T"]
        tool_args = [tc.args for s in t.steps for tc in (s.tool_calls or [])]
        assert tool_args[0] == {"k": 1}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
