#!/usr/bin/env python3
"""Record and analyze Claude Code sessions for benchmark data.

Reads JSONL session files exported from Claude Code, extracts token usage,
tool calls, correction patterns, and workflow step evidence. Produces a
structured analysis suitable for before/after comparison.

Usage:
    python record_session.py --test              # generate + analyze mock session
    python record_session.py --path session.jsonl # analyze a specific file
    python record_session.py --dir ./sessions/    # analyze all .jsonl in a dir
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

# ── Model pricing (USD per million tokens) ──────────────────────────

MODEL_PRICING: dict[str, dict[str, float]] = {
    "claude-opus-4-6":   {"input": 15.00, "output": 75.00},
    "claude-sonnet-4-6": {"input": 3.00,  "output": 15.00},
    "claude-haiku-4-5":  {"input": 0.80,  "output": 4.00},
    # Fallback for unknown models
    "default":           {"input": 3.00,  "output": 15.00},
}

# ── Correction patterns ─────────────────────────────────────────────

CORRECTION_PATTERNS = [
    re.compile(r"you forgot", re.IGNORECASE),
    re.compile(r"you didn'?t", re.IGNORECASE),
    re.compile(r"you skipped", re.IGNORECASE),
    re.compile(r"you missed", re.IGNORECASE),
    re.compile(r"where'?s the", re.IGNORECASE),
    re.compile(r"what about the", re.IGNORECASE),
]

# ── Workflow step classification ─────────────────────────────────────

STEP_CLASSIFIERS: dict[str, list[str]] = {
    "search":    ["Grep", "Glob", "WebSearch", "web_search"],
    "read":      ["Read", "read_file"],
    "edit":      ["Edit", "Write", "write_file"],
    "test":      ["test", "vitest", "jest", "pytest", "cargo test"],
    "build":     ["build", "tsc", "cargo build", "npm run build", "vite build"],
    "preview":   ["preview_screenshot", "preview_start", "preview_snapshot"],
    "commit":    ["git commit", "git add"],
    "qa_check":  ["qa", "lint", "eslint", "clippy", "check"],
}

TOTAL_STEPS = len(STEP_CLASSIFIERS)


def classify_tool_call(tool_name: str, args_str: str = "") -> list[str]:
    """Return which workflow steps a tool call provides evidence for."""
    matched: list[str] = []
    combined = f"{tool_name} {args_str}".lower()

    for step, keywords in STEP_CLASSIFIERS.items():
        for kw in keywords:
            if kw.lower() in combined:
                matched.append(step)
                break

    return matched


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate cost in USD for a given model and token counts."""
    pricing = MODEL_PRICING.get(model, MODEL_PRICING["default"])
    cost = (input_tokens / 1_000_000) * pricing["input"]
    cost += (output_tokens / 1_000_000) * pricing["output"]
    return round(cost, 6)


def analyze_session(path: str) -> dict[str, Any]:
    """Analyze a single JSONL session file.

    Returns a dict with:
      - total_input_tokens, total_output_tokens, total_tokens
      - wall_clock_seconds
      - tool_call_count, tool_breakdown (by tool name)
      - correction_count, corrections (list of matched text)
      - step_evidence (which of 8 steps have evidence)
      - completion_score (steps_with_evidence / 8)
      - estimated_cost_usd
      - model (most frequently used)
    """
    filepath = Path(path)
    if not filepath.exists():
        raise FileNotFoundError(f"Session file not found: {path}")

    total_input = 0
    total_output = 0
    tool_calls: dict[str, int] = {}
    tool_call_count = 0
    corrections: list[str] = []
    step_evidence: dict[str, bool] = {step: False for step in STEP_CLASSIFIERS}
    timestamps: list[float] = []
    models_seen: dict[str, int] = {}

    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Extract timestamp
            ts = entry.get("timestamp") or entry.get("ts") or entry.get("time")
            if ts:
                if isinstance(ts, str):
                    # Try ISO format
                    try:
                        from datetime import datetime, timezone
                        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                        timestamps.append(dt.timestamp())
                    except (ValueError, ImportError):
                        pass
                elif isinstance(ts, (int, float)):
                    timestamps.append(float(ts))

            # Extract usage / tokens
            usage = entry.get("usage", {})
            if usage:
                total_input += usage.get("input_tokens", 0)
                total_output += usage.get("output_tokens", 0)

            # Extract model
            model = entry.get("model", "")
            if model:
                models_seen[model] = models_seen.get(model, 0) + 1

            # Extract tool calls
            tool_name = entry.get("tool") or entry.get("tool_name") or ""
            if not tool_name:
                # Check for nested tool_use content blocks
                content = entry.get("content", [])
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "tool_use":
                            tool_name = block.get("name", "")
                            args_str = json.dumps(block.get("input", {}))
                            if tool_name:
                                tool_calls[tool_name] = tool_calls.get(tool_name, 0) + 1
                                tool_call_count += 1
                                for step in classify_tool_call(tool_name, args_str):
                                    step_evidence[step] = True

            if tool_name and not isinstance(entry.get("content"), list):
                args_str = json.dumps(entry.get("args", entry.get("input", {})))
                tool_calls[tool_name] = tool_calls.get(tool_name, 0) + 1
                tool_call_count += 1
                for step in classify_tool_call(tool_name, args_str):
                    step_evidence[step] = True

            # Check for Bash tool calls with test/build/commit commands
            if tool_name in ("Bash", "bash", "execute"):
                cmd = ""
                args = entry.get("args", entry.get("input", {}))
                if isinstance(args, dict):
                    cmd = args.get("command", "")
                elif isinstance(args, str):
                    cmd = args
                if cmd:
                    for step in classify_tool_call("Bash", cmd):
                        step_evidence[step] = True

            # Check for corrections in human messages
            role = entry.get("role", "")
            text = ""
            if role == "human" or role == "user":
                content = entry.get("content", "")
                if isinstance(content, str):
                    text = content
                elif isinstance(content, list):
                    text = " ".join(
                        b.get("text", "") for b in content
                        if isinstance(b, dict) and b.get("type") == "text"
                    )

            if text:
                for pattern in CORRECTION_PATTERNS:
                    if pattern.search(text):
                        # Extract a short context around the match
                        match = pattern.search(text)
                        if match:
                            start = max(0, match.start() - 20)
                            end = min(len(text), match.end() + 40)
                            corrections.append(text[start:end].strip())

    # Wall clock time
    wall_clock = 0.0
    if len(timestamps) >= 2:
        wall_clock = max(timestamps) - min(timestamps)

    # Most common model
    primary_model = "unknown"
    if models_seen:
        primary_model = max(models_seen, key=models_seen.get)

    # Completion score
    steps_with_evidence = sum(1 for v in step_evidence.values() if v)
    completion_score = round(steps_with_evidence / TOTAL_STEPS, 3)

    # Cost estimate
    cost = estimate_cost(primary_model, total_input, total_output)

    return {
        "file": str(filepath.name),
        "model": primary_model,
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "total_tokens": total_input + total_output,
        "wall_clock_seconds": round(wall_clock, 1),
        "tool_call_count": tool_call_count,
        "tool_breakdown": dict(sorted(tool_calls.items(), key=lambda x: -x[1])),
        "correction_count": len(corrections),
        "corrections": corrections,
        "step_evidence": step_evidence,
        "steps_with_evidence": steps_with_evidence,
        "completion_score": completion_score,
        "estimated_cost_usd": cost,
    }


def analyze_directory(dir_path: str) -> list[dict[str, Any]]:
    """Analyze all .jsonl files in a directory."""
    dirp = Path(dir_path)
    if not dirp.is_dir():
        raise NotADirectoryError(f"Not a directory: {dir_path}")

    results = []
    for f in sorted(dirp.glob("*.jsonl")):
        try:
            result = analyze_session(str(f))
            results.append(result)
        except Exception as e:
            print(f"  [WARN] Skipping {f.name}: {e}", file=sys.stderr)

    return results


def generate_mock_session(output_path: str | None = None) -> str:
    """Generate a realistic mock JSONL session for testing."""
    import random

    if output_path is None:
        output_path = "/tmp/mock_session.jsonl"

    base_ts = time.time() - 600  # 10 minutes ago
    entries: list[dict] = []
    ts = base_ts

    # Human message
    entries.append({
        "role": "human",
        "content": "Add a dark mode toggle to the settings page. Make sure to run tests and build.",
        "timestamp": ts,
    })
    ts += 2

    # Assistant response with tool calls
    tools_sequence = [
        ("Grep", {"command": "dark mode", "path": "src/"}),
        ("Read", {"file_path": "src/pages/Settings.tsx"}),
        ("Glob", {"pattern": "**/*.css"}),
        ("Edit", {"file_path": "src/pages/Settings.tsx", "old_string": "...", "new_string": "..."}),
        ("Write", {"file_path": "src/styles/dark-mode.css", "content": "..."}),
        ("Bash", {"command": "npx vitest run"}),
        ("Bash", {"command": "npx tsc --noEmit"}),
        ("Bash", {"command": "npx vite build"}),
        ("Bash", {"command": "git add -A && git commit -m 'feat: add dark mode toggle'"}),
    ]

    for tool_name, tool_args in tools_sequence:
        entries.append({
            "role": "assistant",
            "content": [{"type": "tool_use", "name": tool_name, "input": tool_args}],
            "model": "claude-sonnet-4-6",
            "usage": {
                "input_tokens": random.randint(800, 3000),
                "output_tokens": random.randint(200, 1500),
            },
            "timestamp": ts,
        })
        ts += random.uniform(3, 15)

    # Human correction
    entries.append({
        "role": "human",
        "content": "You forgot to check the preview screenshot.",
        "timestamp": ts,
    })
    ts += 2

    # Additional tool call after correction
    entries.append({
        "role": "assistant",
        "content": [{"type": "tool_use", "name": "preview_screenshot", "input": {}}],
        "model": "claude-sonnet-4-6",
        "usage": {
            "input_tokens": random.randint(500, 1500),
            "output_tokens": random.randint(100, 800),
        },
        "timestamp": ts,
    })

    with open(output_path, "w", encoding="utf-8") as f:
        for entry in entries:
            f.write(json.dumps(entry) + "\n")

    return output_path


def format_table(analysis: dict[str, Any]) -> str:
    """Format a single analysis as a readable table."""
    lines: list[str] = []
    lines.append(f"{'=' * 60}")
    lines.append(f"  Session: {analysis['file']}")
    lines.append(f"  Model:   {analysis['model']}")
    lines.append(f"{'=' * 60}")
    lines.append("")
    lines.append(f"  {'Metric':<30} {'Value':>20}")
    lines.append(f"  {'-' * 30} {'-' * 20}")
    lines.append(f"  {'Input tokens':<30} {analysis['total_input_tokens']:>20,}")
    lines.append(f"  {'Output tokens':<30} {analysis['total_output_tokens']:>20,}")
    lines.append(f"  {'Total tokens':<30} {analysis['total_tokens']:>20,}")
    lines.append(f"  {'Wall clock (sec)':<30} {analysis['wall_clock_seconds']:>20.1f}")
    lines.append(f"  {'Tool calls':<30} {analysis['tool_call_count']:>20}")
    lines.append(f"  {'Corrections':<30} {analysis['correction_count']:>20}")
    lines.append(f"  {'Completion score':<30} {analysis['completion_score']:>20.1%}")
    cost_str = f"${analysis['estimated_cost_usd']:.4f}"
    lines.append(f"  {'Estimated cost (USD)':<30} {cost_str:>20}")
    lines.append("")

    # Step evidence
    lines.append("  Step Evidence:")
    for step, has_evidence in analysis["step_evidence"].items():
        marker = "[x]" if has_evidence else "[ ]"
        lines.append(f"    {marker} {step}")
    lines.append("")

    # Tool breakdown (top 10)
    if analysis["tool_breakdown"]:
        lines.append("  Tool Breakdown:")
        for tool, count in list(analysis["tool_breakdown"].items())[:10]:
            lines.append(f"    {tool:<30} {count:>5}x")
        lines.append("")

    # Corrections
    if analysis["corrections"]:
        lines.append("  Corrections detected:")
        for c in analysis["corrections"]:
            lines.append(f"    - \"{c}\"")
        lines.append("")

    return "\n".join(lines)


def append_to_log(analysis: dict[str, Any]) -> None:
    """Append analysis result to ~/.attrition/benchmark_log.jsonl."""
    log_dir = Path.home() / ".attrition"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "benchmark_log.jsonl"

    record = {
        "timestamp": time.time(),
        "iso_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **analysis,
    }

    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Record and analyze Claude Code sessions for benchmark data."
    )
    parser.add_argument("--path", type=str, help="Path to a specific JSONL session file")
    parser.add_argument("--dir", type=str, help="Path to a directory of JSONL session files")
    parser.add_argument("--test", action="store_true", help="Generate a mock session and analyze it")
    parser.add_argument("--json", action="store_true", help="Output as JSON instead of table")
    args = parser.parse_args()

    if not any([args.path, args.dir, args.test]):
        parser.print_help()
        sys.exit(1)

    results: list[dict[str, Any]] = []

    if args.test:
        mock_path = generate_mock_session()
        print(f"Generated mock session: {mock_path}\n")
        result = analyze_session(mock_path)
        results.append(result)

    elif args.path:
        result = analyze_session(args.path)
        results.append(result)

    elif args.dir:
        results = analyze_directory(args.dir)
        if not results:
            print("No .jsonl files found in directory.", file=sys.stderr)
            sys.exit(1)

    # Output
    for result in results:
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(format_table(result))

        append_to_log(result)

    if not args.json and len(results) > 1:
        avg_tokens = sum(r["total_tokens"] for r in results) / len(results)
        avg_completion = sum(r["completion_score"] for r in results) / len(results)
        avg_corrections = sum(r["correction_count"] for r in results) / len(results)
        print(f"\n  Summary ({len(results)} sessions):")
        print(f"    Avg tokens:      {avg_tokens:,.0f}")
        print(f"    Avg completion:  {avg_completion:.1%}")
        print(f"    Avg corrections: {avg_corrections:.1f}")

    print(f"\n  Results appended to ~/.attrition/benchmark_log.jsonl")


if __name__ == "__main__":
    main()
