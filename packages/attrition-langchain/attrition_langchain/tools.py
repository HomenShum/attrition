"""LangChain tool wrappers for the attrition API.

Usage with LangGraph / LangChain agents:

    from attrition_langchain import AttritionScanTool, AttritionJudgeTool

    tools = [
        AttritionScanTool(endpoint="https://attrition-XXXX.run.app"),
        AttritionJudgeTool(endpoint="https://attrition-XXXX.run.app"),
    ]
    agent = create_react_agent(llm, tools)
"""

from __future__ import annotations

from typing import Optional, Type

import httpx
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Input schemas
# ---------------------------------------------------------------------------

class ScanInput(BaseModel):
    """Input for the attrition_scan tool."""
    url: str = Field(description="URL to scan for QA issues")
    timeout: int = Field(
        default=30000,
        description="Timeout in milliseconds (default 30 000)",
    )


class JudgeInput(BaseModel):
    """Input for the attrition_judge tool."""
    session_id: str = Field(description="Session ID to judge")


class DistillInput(BaseModel):
    """Input for the attrition_distill tool."""
    workflow_id: str = Field(description="Workflow ID to distill into a cheaper replay")


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

class AttritionScanTool(BaseTool):
    """Scan a URL for QA issues -- JS errors, accessibility gaps, rendering
    problems, performance regressions, and broken links."""

    name: str = "attrition_scan"
    description: str = (
        "Scan a URL for QA issues: JavaScript errors, accessibility violations, "
        "rendering problems, performance regressions, broken links. "
        "Returns a score out of 100 and a list of issues."
    )
    args_schema: Type[BaseModel] = ScanInput
    endpoint: str = "https://attrition.sh"

    def _run(self, url: str, timeout: int = 30000) -> str:
        with httpx.Client(timeout=timeout / 1000) as client:
            resp = client.post(
                f"{self.endpoint}/api/qa/check",
                json={"url": url, "timeout": timeout},
            )
            resp.raise_for_status()
            data = resp.json()

        score = data.get("score", "N/A")
        issues = data.get("issues", [])
        issue_count = len(issues)

        lines = [f"Score: {score}/100 ({issue_count} issues)"]
        for issue in issues[:10]:  # Cap at 10 to avoid flooding context
            severity = issue.get("severity", "info")
            message = issue.get("message", str(issue))
            lines.append(f"  [{severity}] {message}")
        if issue_count > 10:
            lines.append(f"  ... and {issue_count - 10} more")

        return "\n".join(lines)

    async def _arun(self, url: str, timeout: int = 30000) -> str:
        async with httpx.AsyncClient(timeout=timeout / 1000) as client:
            resp = await client.post(
                f"{self.endpoint}/api/qa/check",
                json={"url": url, "timeout": timeout},
            )
            resp.raise_for_status()
            data = resp.json()

        score = data.get("score", "N/A")
        issues = data.get("issues", [])
        return f"Score: {score}/100, Issues: {len(issues)}"


class AttritionJudgeTool(BaseTool):
    """Judge whether a workflow is complete -- checks required steps against
    tool-call evidence captured by the hook system."""

    name: str = "attrition_judge"
    description: str = (
        "Judge whether a coding agent workflow is complete. Checks required "
        "steps against tool-call evidence captured by attrition hooks. "
        "Returns a verdict (pass/fail/partial) with details."
    )
    args_schema: Type[BaseModel] = JudgeInput
    endpoint: str = "https://attrition.sh"

    def _run(self, session_id: str) -> str:
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                f"{self.endpoint}/api/judge/sessions/{session_id}",
            )
            if resp.status_code == 404:
                return f"No judge session found for session_id={session_id}"
            resp.raise_for_status()
            data = resp.json()

        verdict = data.get("verdict", "unknown")
        score = data.get("score", "N/A")
        steps_total = data.get("steps_total", 0)
        steps_passed = data.get("steps_passed", 0)

        return (
            f"Verdict: {verdict} | Score: {score} | "
            f"Steps: {steps_passed}/{steps_total}"
        )

    async def _arun(self, session_id: str) -> str:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{self.endpoint}/api/judge/sessions/{session_id}",
            )
            if resp.status_code == 404:
                return f"No judge session found for session_id={session_id}"
            resp.raise_for_status()
            data = resp.json()

        return f"Verdict: {data.get('verdict', 'unknown')}"


class AttritionDistillTool(BaseTool):
    """Distill a captured workflow into a cheaper replay sequence."""

    name: str = "attrition_distill"
    description: str = (
        "Distill a captured frontier-model workflow into a cheaper replay "
        "sequence. Returns the distilled workflow ID and estimated cost savings."
    )
    args_schema: Type[BaseModel] = DistillInput
    endpoint: str = "https://attrition.sh"

    def _run(self, workflow_id: str) -> str:
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{self.endpoint}/api/workflows/{workflow_id}/distill",
            )
            if resp.status_code == 404:
                return f"No workflow found for workflow_id={workflow_id}"
            resp.raise_for_status()
            data = resp.json()

        distilled_id = data.get("distilled_id", "unknown")
        savings = data.get("cost_savings_pct", 0)
        return f"Distilled: {distilled_id} | Savings: {savings}%"

    async def _arun(self, workflow_id: str) -> str:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self.endpoint}/api/workflows/{workflow_id}/distill",
            )
            if resp.status_code == 404:
                return f"No workflow found for workflow_id={workflow_id}"
            resp.raise_for_status()
            data = resp.json()

        return f"Distilled: {data.get('distilled_id', 'unknown')}"
