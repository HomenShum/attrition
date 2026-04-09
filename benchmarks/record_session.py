#!/usr/bin/env python3
"""Record and analyze Claude Code sessions for benchmark data.

Reads JSONL session files from Claude Code (~/.claude/projects/**/*.jsonl),
extracts token usage, tool calls, correction patterns, and workflow step
evidence. Produces structured analysis for before/after comparison.

Claude Code JSONL format:
  Each line is a JSON object with:
    - "type": "user" | "assistant"
    - "message": { "role", "content": [...blocks...], "usage": {...}, "model": "..." }
    - "timestamp": ISO string

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
    "gpt-4o":            {"input": 2.50,  "output": 10.00},
    "gpt-4o-mini":       {"input": 0.15,  "output": 0.60},
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
    re.compile(r"you also forgot", re.IGNORECASE),
    re.compile(r"you never", re.IGNORECASE),
]

# ── Workflow step classification ─────────────────────────────────────

STEP_CLASSIFIERS: dict[str, list[str]] = {
    "search":    ["Grep", "Glob", "WebSearch", "web_search", "WebFetch"],
    "read":      ["Read", "read_file", "execute_file"],
    "edit":      ["Edit", "Write", "write_file", "NotebookEdit"],
    "test":      ["test", "vitest", "jest", "pytest", "cargo test"],
    "build":     ["build", "tsc", "cargo build", "cargo check", "npm run build", "vite build"],
    "preview":   ["preview_screenshot", "preview_start", "preview_snapshot", "Claude_in_Chrome"],
    "commit":    ["git commit", "git add", "git push"],
    "qa_check":  ["qa", "lint", "eslint", "clippy", "audit", "check"],
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
    pricing = MODEL_PRICING.get(model, MODEL_PRICING["default"])
    cost = (input_tokens / 1_000_000) * pricing["input"]
    cost += (output_tokens / 1_000_000) * pricing["output"]
    return round(cost, 4)


def analyze_session(path: str) -> dict[str, Any]:
    """Analyze a Claude Code JSONL session file.

    Handles the nested format:
      {"type":"assistant","message":{"model":"...","content":[...],"usage":{...}},"timestamp":"..."}
      {"type":"user","message":{"content":"..."},"timestamp":"..."}
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
    timestamps: list[str] = []
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

            # ── Timestamp ────────────────────────────────────────
            ts = entry.get("timestamp", "")
            if ts:
                timestamps.append(ts)

            # ── The message envelope ─────────────────────────────
            msg = entry.get("message", {})
            if not isinstance(msg, dict):
                # Flat format fallback (non-Claude-Code JSONL)
                msg = entry

            # ── Token usage (inside message.usage) ───────────────
            usage = msg.get("usage", {})
            if isinstance(usage, dict):
                total_input += usage.get("input_tokens", 0)
                total_input += usage.get("cache_read_input_tokens", 0)
                total_input += usage.get("cache_creation_input_tokens", 0)
                total_output += usage.get("output_tokens", 0)

            # ── Model ────────────────────────────────────────────
            model = msg.get("model", "")
            if model:
                models_seen[model] = models_seen.get(model, 0) + 1

            # ── Tool calls (from message.content blocks) ─────────
            content = msg.get("content", [])
            if isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "tool_use":
                        name = block.get("name", "")
                        if not name:
                            continue
                        tool_calls[name] = tool_calls.get(name, 0) + 1
                        tool_call_count += 1

                        # Classify for step evidence
                        inp = block.get("input", {})
                        args_str = ""
                        if isinstance(inp, dict):
                            args_str = json.dumps(inp)
                        elif isinstance(inp, str):
                            args_str = inp

                        for step in classify_tool_call(name, args_str):
                            step_evidence[step] = True

                        # Special: Bash with test/build/commit commands
                        if name.lower() in ("bash",):
                            cmd = ""
                            if isinstance(inp, dict):
                                cmd = inp.get("command", "")
                            if cmd:
                                for step in classify_tool_call("Bash", cmd):
                                    step_evidence[step] = True

            # ── Corrections (from user messages) ─────────────────
            entry_type = entry.get("type", "")
            if entry_type == "user":
                user_content = msg.get("content", "")
                text = ""
                if isinstance(user_content, str):
                    text = user_content
                elif isinstance(user_content, list):
                    parts = []
                    for block in user_content:
                        if isinstance(block, dict):
                            if block.get("type") == "text":
                                parts.append(block.get("text", ""))
                            elif "content" in block:
                                c = block["content"]
                                if isinstance(c, str):
                                    parts.append(c)
                    text = " ".join(parts)

                if text:
                    for pattern in CORRECTION_PATTERNS:
                        m = pattern.search(text)
                        if m:
                            start = max(0, m.start() - 20)
                            end = min(len(text), m.end() + 60)
                            corrections.append(text[start:end].strip())
                            break  # one correction per message

    # ── Wall clock time ──────────────────────────────────────────
    wall_clock = 0.0
    if len(timestamps) >= 2:
        try:
            from datetime import datetime
            t0 = datetime.fromisoformat(timestamps[0].replace("Z", "+00:00"))
            t1 = datetime.fromisoformat(timestamps[-1].replace("Z", "+00:00"))
            wall_clock = (t1 - t0).total_seconds()
        except Exception:
            pass

    # ── Primary model ────────────────────────────────────────────
    primary_model = "unknown"
    if models_seen:
        primary_model = max(models_seen, key=models_seen.get)

    # ── Completion score ─────────────────────────────────────────
    steps_with_evidence = sum(1 for v in step_evidence.values() if v)
    completion_score = round(steps_with_evidence / TOTAL_STEPS, 3)

    # ── Cost ─────────────────────────────────────────────────────
    cost = estimate_cost(primary_model, total_input, total_output)

    return {
        "file": str(filepath.name),
        "model": primary_model,
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "total_tokens": total_input + total_output,
        "wall_clock_seconds": round(wall_clock, 1),
        "duration_minutes": round(wall_clock / 60, 1),
        "tool_call_count": tool_call_count,
        "tool_breakdown": dict(sorted(tool_calls.items(), key=lambda x: -x[1])),
        "correction_count": len(corrections),
        "corrections": corrections,
        "step_evidence": step_evidence,
        "steps_with_evidence": steps_with_evidence,
        "steps_completed": f"{steps_with_evidence}/{TOTAL_STEPS}",
        "completion_score": completion_score,
        "estimated_cost_usd": cost,
    }


def analyze_directory(dir_path: str) -> list[dict[str, Any]]:
    dirp = Path(dir_path)
    if not dirp.is_dir():
        raise NotADirectoryError(f"Not a directory: {dir_path}")
    results = []
    for f in sorted(dirp.glob("*.jsonl")):
        try:
            results.append(analyze_session(str(f)))
        except Exception as e:
            print(f"  [WARN] Skipping {f.name}: {e}", file=sys.stderr)
    return results


def generate_mock_session(output_path: str | None = None) -> str:
    import random
    if output_path is None:
        output_path = os.path.join(os.environ.get("TEMP", "/tmp"), "mock_session.jsonl")

    base_ts = "2026-04-08T10:00:00.000Z"
    entries = []

    # User prompt
    entries.append({
        "type": "user",
        "message": {"role": "user", "content": "Add dark mode toggle to settings. Run tests and build."},
        "timestamp": "2026-04-08T10:00:00.000Z",
    })

    tools = [
        ("Grep", {"pattern": "theme", "path": "src/"}, 1200, 400),
        ("Read", {"file_path": "src/Settings.tsx"}, 800, 200),
        ("Glob", {"pattern": "**/*.css"}, 600, 300),
        ("Edit", {"file_path": "src/Settings.tsx", "old_string": "x", "new_string": "y"}, 1500, 800),
        ("Write", {"file_path": "src/dark-mode.css", "content": "..."}, 1000, 600),
        ("Bash", {"command": "npx vitest run"}, 900, 500),
        ("Bash", {"command": "npx tsc --noEmit"}, 800, 300),
        ("Bash", {"command": "npx vite build"}, 700, 400),
        ("Bash", {"command": "git add -A && git commit -m 'feat: dark mode'"}, 600, 200),
    ]

    for i, (name, inp, tok_in, tok_out) in enumerate(tools):
        entries.append({
            "type": "assistant",
            "message": {
                "model": "claude-sonnet-4-6",
                "content": [{"type": "tool_use", "name": name, "input": inp}],
                "usage": {"input_tokens": tok_in + random.randint(-200, 200), "output_tokens": tok_out + random.randint(-100, 100)},
            },
            "timestamp": f"2026-04-08T10:0{i+1}:00.000Z",
        })

    # User correction
    entries.append({
        "type": "user",
        "message": {"role": "user", "content": "You forgot to check the preview."},
        "timestamp": "2026-04-08T10:10:00.000Z",
    })

    entries.append({
        "type": "assistant",
        "message": {
            "model": "claude-sonnet-4-6",
            "content": [{"type": "tool_use", "name": "mcp__Claude_Preview__preview_screenshot", "input": {}}],
            "usage": {"input_tokens": 500, "output_tokens": 200},
        },
        "timestamp": "2026-04-08T10:11:00.000Z",
    })

    with open(output_path, "w") as f:
        for e in entries:
            f.write(json.dumps(e) + "\n")
    return output_path


def format_table(a: dict[str, Any]) -> str:
    lines = []
    lines.append(f"{'='*60}")
    lines.append(f"  Session: {a['file']}")
    lines.append(f"  Model:   {a['model']}")
    lines.append(f"{'='*60}")
    lines.append(f"  {'Metric':<30} {'Value':>20}")
    lines.append(f"  {'-'*30} {'-'*20}")
    lines.append(f"  {'Input tokens':<30} {a['total_input_tokens']:>20,}")
    lines.append(f"  {'Output tokens':<30} {a['total_output_tokens']:>20,}")
    lines.append(f"  {'Total tokens':<30} {a['total_tokens']:>20,}")
    lines.append(f"  {'Duration (min)':<30} {a['duration_minutes']:>20.1f}")
    lines.append(f"  {'Tool calls':<30} {a['tool_call_count']:>20}")
    lines.append(f"  {'Corrections':<30} {a['correction_count']:>20}")
    lines.append(f"  {'Completion':<30} {a['steps_completed']:>20}")
    lines.append(f"  {'Completion score':<30} {a['completion_score']:>20.0%}")
    lines.append(f"  {'Estimated cost':<30} {'$'+str(a['estimated_cost_usd']):>20}")
    lines.append("")
    lines.append("  Step Evidence:")
    for step, has in a["step_evidence"].items():
        lines.append(f"    {'[x]' if has else '[ ]'} {step}")
    lines.append("")
    if a["tool_breakdown"]:
        lines.append("  Top Tools:")
        for tool, count in list(a["tool_breakdown"].items())[:10]:
            lines.append(f"    {tool:<40} {count:>5}x")
    if a["corrections"]:
        lines.append("\n  Corrections:")
        for c in a["corrections"]:
            lines.append(f'    - "{c}"')
    return "\n".join(lines)


def append_to_log(analysis: dict[str, Any]) -> None:
    log_dir = Path.home() / ".attrition"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "benchmark_log.jsonl"
    record = {"logged_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **analysis}
    with open(log_path, "a") as f:
        f.write(json.dumps(record) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze Claude Code sessions for benchmark data.")
    parser.add_argument("--path", type=str, help="Path to a JSONL session file")
    parser.add_argument("--dir", type=str, help="Directory of JSONL files")
    parser.add_argument("--test", action="store_true", help="Generate + analyze mock session")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    args = parser.parse_args()

    if not any([args.path, args.dir, args.test]):
        parser.print_help()
        sys.exit(1)

    results = []
    if args.test:
        mock = generate_mock_session()
        print(f"Mock session: {mock}\n")
        results.append(analyze_session(mock))
    elif args.path:
        results.append(analyze_session(args.path))
    elif args.dir:
        results = analyze_directory(args.dir)

    for r in results:
        if args.json:
            print(json.dumps(r, indent=2))
        else:
            print(format_table(r))
        append_to_log(r)

    print(f"\n  Logged to ~/.attrition/benchmark_log.jsonl")


if __name__ == "__main__":
    main()
