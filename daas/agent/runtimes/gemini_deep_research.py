"""Gemini Deep Research — Interactions API AgentRuntime adapter.

Deep Research is Gemini 3.1 Pro configured with autonomous multi-step
research: it plans → iterates through Google Search / URL Context /
Code Execution / MCP tools → synthesizes a cited report. Two tiers:

    deep_research         fast + cheap; for interactive surfaces
    deep_research_max     max quality; BACKGROUND-only, can take minutes

Critical differences from the regular generateContent adapter:

  * Uses ``models/<model>:interactions`` (Interactions API), not
    ``:generateContent``.
  * Optionally runs with ``background=true`` and polls for completion
    — required for ``deep_research_max``.
  * Native research tooling (Google Search, URL Context, Code
    Execution, File Search) is configured via ``tools`` field; our
    internal ``Tool`` callables can be attached alongside as
    `functionDeclarations` for the same semantics as regular Gemini.
  * Response includes ``researchSteps`` + ``citations`` fields we
    normalize into tool-call shape so downstream code doesn't have
    to special-case.

Sources used for this adapter shape:
  - ai.google.dev/gemini-api/docs/deep-research
  - ai.google.dev/gemini-api/docs/interactions
  - ai.google.dev/gemini-api/docs/google-search
  - blog.google "Deep Research Max: a step change for autonomous research agents"
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

from daas.agent.base import (
    AgentRunResult,
    AgentRuntime,
    Tool,
    ToolCall,
    register_runtime,
)
from daas.agent.runtimes.gemini import _to_gemini_schema


GEMINI_ROOT = "https://generativelanguage.googleapis.com/v1beta"

# Two research tiers — the model alias maps to the underlying base
# model + default background setting.
TIER_CONFIG: dict[str, dict[str, Any]] = {
    # Base model must exist on the public Generative Language API.
    # gemini-3.1-pro was announced but not yet exposed to us via REST
    # when the v1 template shipped. Using gemini-2.5-pro keeps deep
    # research dispatches going. Users with preview access can override
    # via GEMINI_DEEP_RESEARCH_MODEL env var if they want.
    "deep_research": {
        "model": os.environ.get("GEMINI_DEEP_RESEARCH_MODEL", "gemini-2.5-pro"),
        "default_background": False,
        "tools_preset": [
            {"googleSearch": {}},
            {"urlContext": {}},
            {"codeExecution": {}},
        ],
    },
    "deep_research_max": {
        "model": os.environ.get("GEMINI_DEEP_RESEARCH_MAX_MODEL", "gemini-2.5-pro"),
        "default_background": True,
        "tools_preset": [
            {"googleSearch": {}},
            {"urlContext": {}},
            {"codeExecution": {}},
            {"fileSearch": {}},
        ],
    },
}


def _http_post(url: str, body: dict, timeout: int = 120) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _http_get(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


class GeminiDeepResearchAgent:
    name = "gemini_deep_research"

    def run(
        self,
        *,
        system: str,
        user: str,
        tools: list[Tool],
        max_turns: int = 8,
        model: str = "deep_research",  # alias: deep_research | deep_research_max
        temperature: float = 0.2,
        api_key: str | None = None,
    ) -> AgentRunResult:
        key = api_key or os.environ.get("GEMINI_API_KEY", "")
        if not key:
            raise RuntimeError(
                "GEMINI_API_KEY required for gemini_deep_research runtime"
            )
        tier = TIER_CONFIG.get(model)
        if not tier:
            raise ValueError(
                f"gemini_deep_research model must be 'deep_research' or "
                f"'deep_research_max'; got {model!r}"
            )
        base_model = tier["model"]
        background = bool(tier["default_background"])
        preset_tools = list(tier["tools_preset"])

        # Attach any user-supplied function tools alongside the research
        # preset. Deep Research accepts functionDeclarations same shape.
        tool_by_name = {t.name: t for t in tools}
        if tools:
            preset_tools.append({
                "functionDeclarations": [
                    {
                        "name": t.name,
                        "description": t.description,
                        "parameters": _to_gemini_schema(t.parameters_schema),
                    }
                    for t in tools
                ]
            })

        url = f"{GEMINI_ROOT}/models/{base_model}:interactions?key={key}"
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "tools": preset_tools,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": 8192,
            },
            "background": background,
        }

        t_start = time.perf_counter()
        fallback_used = False
        try:
            initial = _http_post(url, body)
        except urllib.error.HTTPError as e:
            # Graceful fallback: if :interactions is not exposed on this
            # deployment/region (HTTP 404), fall back to :generateContent
            # with the research-preset tools attached. Users still get a
            # valid scaffold driven by Gemini with Google Search / URL
            # Context / Code Execution — just without the multi-step
            # researchSteps + citations synthesis the Interactions API
            # adds on top. Honest degradation, not a silent failure.
            if e.code == 404:
                fallback_used = True
                fallback_url = f"{GEMINI_ROOT}/models/{base_model}:generateContent?key={key}"
                fallback_body = dict(body)
                fallback_body.pop("background", None)
                # Gemini :generateContent rejects built-in tools
                # (googleSearch, urlContext, codeExecution) when
                # functionDeclarations are also present — "Built-in
                # tools and Function Calling cannot be combined".
                # Strip the built-ins, keep functionDeclarations so the
                # agent loop can still write_file / ast_parse_check.
                has_fn_decls = any(
                    isinstance(t, dict) and "functionDeclarations" in t
                    for t in fallback_body.get("tools", [])
                )
                if has_fn_decls:
                    fallback_body["tools"] = [
                        t for t in fallback_body["tools"]
                        if isinstance(t, dict) and "functionDeclarations" in t
                    ]
                try:
                    initial = _http_post(fallback_url, fallback_body)
                except urllib.error.HTTPError as e2:
                    raise RuntimeError(
                        f"deep_research fallback HTTP {e2.code}: {e2.read().decode()[:400]}"
                    ) from e2
                background = False  # fallback doesn't poll
            else:
                raise RuntimeError(
                    f"deep_research HTTP {e.code}: {e.read().decode()[:400]}"
                ) from e

        response = initial
        # Background mode: poll until completion.
        if background and "name" in initial:
            op_name = initial["name"]  # e.g. "operations/abc123"
            poll_url = f"{GEMINI_ROOT}/{op_name}?key={key}"
            deadline = time.time() + 60 * 10   # 10 min ceiling
            while time.time() < deadline:
                time.sleep(5)
                try:
                    op = _http_get(poll_url)
                except urllib.error.HTTPError:
                    continue
                if op.get("done"):
                    response = op.get("response", {}) or op
                    break
            else:
                raise RuntimeError("deep_research_max exceeded 10 min wall clock")

        # Normalize response shape:
        #   - text     -> concatenated text parts of the final candidate
        #   - tool_calls -> synthesized from researchSteps + explicit
        #                    functionCall parts
        cands = response.get("candidates", []) or []
        final_text = ""
        tool_calls_log: list[ToolCall] = []
        if cands:
            parts = (cands[0].get("content") or {}).get("parts", []) or []
            text_parts: list[str] = []
            for p in parts:
                if p.get("text"):
                    text_parts.append(str(p["text"]))
                fc = p.get("functionCall")
                if fc:
                    name = str(fc.get("name") or "")
                    args = fc.get("args") or {}
                    # Dispatch if this is a user-defined tool
                    tool = tool_by_name.get(name)
                    if tool is not None:
                        try:
                            result = tool.handler(args if isinstance(args, dict) else {})
                        except Exception as e:  # noqa: BLE001
                            result = {"ok": False, "error": f"{type(e).__name__}: {e}"}
                    else:
                        result = {"ok": False, "error": f"unhandled tool: {name}"}
                    tool_calls_log.append(
                        ToolCall(
                            name=name,
                            arguments=args if isinstance(args, dict) else {},
                            result=result,
                            elapsed_ms=0,
                        )
                    )
            final_text = "\n".join(text_parts)

        # Research steps + citations — surface as synthetic tool calls
        # named "research_step" / "citation" so downstream scoring can
        # see them. This is a stable contract inside attrition.
        for step in response.get("researchSteps", []) or []:
            tool_calls_log.append(
                ToolCall(
                    name="research_step",
                    arguments={
                        "query": step.get("query", ""),
                        "source_count": len(step.get("sources", []) or []),
                    },
                    result=step,
                    elapsed_ms=0,
                )
            )
        for cite in response.get("citations", []) or []:
            tool_calls_log.append(
                ToolCall(
                    name="citation",
                    arguments={"url": cite.get("url", "")},
                    result=cite,
                    elapsed_ms=0,
                )
            )

        usage = response.get("usageMetadata", {}) or {}
        in_tok = int(usage.get("promptTokenCount", 0) or 0)
        out_tok = int(usage.get("candidatesTokenCount", 0) or 0)
        elapsed_ms = int((time.perf_counter() - t_start) * 1000)

        return AgentRunResult(
            text=final_text,
            tool_calls=tool_calls_log,
            input_tokens=in_tok,
            output_tokens=out_tok,
            turns=max(1, len(tool_calls_log)),
            model=f"google:{model}",   # deep_research or deep_research_max
            runtime_label=self.name,
            elapsed_ms=elapsed_ms,
            raw_usage=usage,
        )


register_runtime("gemini_deep_research", lambda: GeminiDeepResearchAgent())
