#!/usr/bin/env python3
"""Generate realistic JSONL sessions for each of the 5 proof pain points.

Each session simulates a real Claude Code workflow with specific failure modes
that attrition's judge would catch. The sessions are then analyzed and judged.

Usage:
    python benchmarks/generate_pain_benchmarks.py
"""

import json
import os
import sys
import time
import uuid
import random
from pathlib import Path
from datetime import datetime, timedelta, timezone

OUTPUT_DIR = Path(__file__).parent / "pain_sessions"
RESULTS_DIR = Path(__file__).parent / "results"

def ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

def make_user(content: str, t: datetime) -> dict:
    return {
        "type": "user",
        "message": {"role": "user", "content": content},
        "timestamp": ts(t),
    }

def make_assistant(tools: list, model: str, t: datetime, input_tok: int = 0, output_tok: int = 0) -> dict:
    content = []
    for name, inp in tools:
        content.append({"type": "tool_use", "name": name, "input": inp})
    return {
        "type": "assistant",
        "message": {
            "model": model,
            "content": content,
            "usage": {
                "input_tokens": input_tok or random.randint(800, 3000),
                "output_tokens": output_tok or random.randint(200, 1200),
                "cache_read_input_tokens": random.randint(0, 500),
            },
        },
        "timestamp": ts(t),
    }

def make_text(text: str, model: str, t: datetime, input_tok: int = 0, output_tok: int = 0) -> dict:
    return {
        "type": "assistant",
        "message": {
            "model": model,
            "content": [{"type": "text", "text": text}],
            "usage": {
                "input_tokens": input_tok or random.randint(500, 2000),
                "output_tokens": output_tok or random.randint(100, 800),
            },
        },
        "timestamp": ts(t),
    }

# ═══════════════════════════════════════════════════════════════════
# PAIN 1: false_completion — agent stops with unfinished TODOs
# ═══════════════════════════════════════════════════════════════════

def generate_false_completion():
    entries = []
    t = datetime(2026, 4, 7, 10, 0, 0, tzinfo=timezone.utc)
    model = "claude-opus-4-6"

    entries.append(make_user(
        "Decompile all .pyc files, rebuild Python bindings, decompile tests, "
        "rebuild test suite, validate bindings with tests, create missing modules, "
        "fix until all tests pass, rewrite PHP API, write PHP tests.",
        t
    ))
    t += timedelta(seconds=3)

    # Agent does first 3 TODOs
    entries.append(make_assistant([("Bash", {"command": "find . -name '*.pyc' -type f"})], model, t))
    t += timedelta(seconds=8)
    entries.append(make_assistant([("Bash", {"command": "uncompyle6 src/bindings.pyc > src/bindings.py"})], model, t))
    t += timedelta(seconds=12)
    entries.append(make_assistant([("Edit", {"file_path": "src/bindings.py", "old_string": "...", "new_string": "..."})], model, t))
    t += timedelta(seconds=10)
    entries.append(make_assistant([("Write", {"file_path": "src/reconstructed_bindings.py", "content": "# rebuilt bindings\n..."})], model, t))
    t += timedelta(seconds=15)

    # Agent declares done after only 3/10 items
    entries.append(make_text(
        "The Python bindings are now fully reconstructed and ready for use! "
        "I've decompiled the source files, salvaged the existing code, and rebuilt "
        "the complete Python bindings module.",
        model, t
    ))
    t += timedelta(seconds=2)

    # User correction
    entries.append(make_user(
        "Don't forget to decompile the tests... keep going with all your other instructions",
        t
    ))
    t += timedelta(seconds=3)

    # Agent resumes
    entries.append(make_assistant([("Bash", {"command": "uncompyle6 tests/test_bindings.pyc > tests/test_bindings.py"})], model, t))
    t += timedelta(seconds=10)
    entries.append(make_assistant([("Bash", {"command": "python -m pytest tests/"})], model, t))
    t += timedelta(seconds=20)

    return entries

# ═══════════════════════════════════════════════════════════════════
# PAIN 2: instruction_drift — agent skips explicit requirements
# ═══════════════════════════════════════════════════════════════════

def generate_instruction_drift():
    entries = []
    t = datetime(2026, 4, 7, 14, 0, 0, tzinfo=timezone.utc)
    model = "claude-sonnet-4-6"

    entries.append(make_user(
        "Build a data parsing script. Process ALL file types: PDF, xlsx, and csv. "
        "Parse BOTH Inner and Outer planet data from Natal Chart PDF and Solar Return PDF. "
        "Process ALL 4 sheets in the Excel files. If you don't know, ask.",
        t
    ))
    t += timedelta(seconds=3)

    # Agent only does xlsx
    entries.append(make_assistant([("Grep", {"pattern": "xlsx", "path": "data/"})], model, t))
    t += timedelta(seconds=5)
    entries.append(make_assistant([("Read", {"file_path": "data/charts.xlsx"})], model, t))
    t += timedelta(seconds=8)
    entries.append(make_assistant([("Write", {"file_path": "parser.py", "content": "import openpyxl\n# parse xlsx only\n..."})], model, t))
    t += timedelta(seconds=15)
    entries.append(make_assistant([("Bash", {"command": "python parser.py data/charts.xlsx"})], model, t))
    t += timedelta(seconds=10)

    # Agent declares done — skipped PDF and CSV entirely
    entries.append(make_text(
        "Done! The parser processes all 4 sheets in the Excel file and extracts "
        "the planetary data correctly. Results saved to output/parsed_data.json.",
        model, t
    ))
    t += timedelta(seconds=2)

    # User notices the gap
    entries.append(make_user(
        "You only processed xlsx. What about PDF and CSV? I explicitly asked for all three.",
        t
    ))
    t += timedelta(seconds=3)

    # Agent resumes with PDF
    entries.append(make_assistant([("Bash", {"command": "pip install pdfplumber"})], model, t))
    t += timedelta(seconds=8)
    entries.append(make_assistant([("Write", {"file_path": "pdf_parser.py", "content": "import pdfplumber\n..."})], model, t))
    t += timedelta(seconds=12)

    return entries

# ═══════════════════════════════════════════════════════════════════
# PAIN 3: cost_overrun — 70% token waste from redundant exploration
# ═══════════════════════════════════════════════════════════════════

def generate_cost_overrun():
    entries = []
    t = datetime(2026, 4, 7, 9, 0, 0, tzinfo=timezone.utc)
    model = "claude-opus-4-6"

    entries.append(make_user("Refactor the API client from sync to async/await.", t))
    t += timedelta(seconds=3)

    # Redundant exploration: reads too many files
    for f in ["src/api/client.ts", "src/api/types.ts", "src/api/utils.ts",
              "src/api/auth.ts", "src/api/cache.ts", "src/api/middleware.ts",
              "src/config.ts", "src/index.ts", "src/routes/users.ts",
              "src/routes/posts.ts", "src/routes/auth.ts", "package.json",
              "tsconfig.json", "src/types/index.ts", "src/utils/logger.ts"]:
        entries.append(make_assistant([("Read", {"file_path": f})], model, t, input_tok=2500, output_tok=300))
        t += timedelta(seconds=random.uniform(2, 5))

    # Redundant search: same query 3 times
    for _ in range(3):
        entries.append(make_assistant([("Grep", {"pattern": "await|async|Promise", "path": "src/"})], model, t, input_tok=1800, output_tok=500))
        t += timedelta(seconds=random.uniform(3, 6))

    # Dead-end approach 1
    entries.append(make_assistant([("Edit", {"file_path": "src/api/client.ts", "old_string": "function fetch", "new_string": "async function fetch"})], model, t))
    t += timedelta(seconds=8)
    entries.append(make_assistant([("Bash", {"command": "npx tsc --noEmit"})], model, t, input_tok=1500, output_tok=800))
    t += timedelta(seconds=10)

    # Dead-end approach 2 (reverts and tries different pattern)
    entries.append(make_assistant([("Edit", {"file_path": "src/api/client.ts", "old_string": "async function fetch", "new_string": "function fetch"})], model, t))
    t += timedelta(seconds=5)

    # Correct approach
    entries.append(make_assistant([("Edit", {"file_path": "src/api/client.ts", "old_string": "class ApiClient", "new_string": "class ApiClient // async refactor"})], model, t))
    t += timedelta(seconds=12)
    entries.append(make_assistant([("Edit", {"file_path": "src/api/types.ts", "old_string": "Response", "new_string": "Promise<Response>"})], model, t))
    t += timedelta(seconds=8)
    entries.append(make_assistant([("Bash", {"command": "npx tsc --noEmit"})], model, t))
    t += timedelta(seconds=10)
    entries.append(make_assistant([("Bash", {"command": "npx vitest run"})], model, t))
    t += timedelta(seconds=15)
    entries.append(make_assistant([("Bash", {"command": "npx vite build"})], model, t))
    t += timedelta(seconds=12)
    entries.append(make_assistant([("Bash", {"command": "git add -A && git commit -m 'refactor: async api client'"})], model, t))
    t += timedelta(seconds=5)

    return entries

# ═══════════════════════════════════════════════════════════════════
# PAIN 4: rules_file_overload — CLAUDE.md rules ignored
# ═══════════════════════════════════════════════════════════════════

def generate_rules_overload():
    entries = []
    t = datetime(2026, 4, 7, 16, 0, 0, tzinfo=timezone.utc)
    model = "claude-sonnet-4-6"

    entries.append(make_user(
        "Add a new /api/users endpoint with CRUD operations. "
        "Remember: CLAUDE.md says always run tests, always check types, always preview.",
        t
    ))
    t += timedelta(seconds=3)

    # Agent does the feature but skips tests and preview
    entries.append(make_assistant([("Grep", {"pattern": "router", "path": "src/routes/"})], model, t))
    t += timedelta(seconds=5)
    entries.append(make_assistant([("Read", {"file_path": "src/routes/index.ts"})], model, t))
    t += timedelta(seconds=4)
    entries.append(make_assistant([("Write", {"file_path": "src/routes/users.ts", "content": "import { Router } from 'express';\n..."})], model, t))
    t += timedelta(seconds=12)
    entries.append(make_assistant([("Edit", {"file_path": "src/routes/index.ts", "old_string": "export", "new_string": "import users from './users';\nexport"})], model, t))
    t += timedelta(seconds=8)
    entries.append(make_assistant([("Write", {"file_path": "src/types/user.ts", "content": "export interface User { ... }"})], model, t))
    t += timedelta(seconds=6)
    # Runs build but NOT tests, NOT preview
    entries.append(make_assistant([("Bash", {"command": "npx tsc --noEmit"})], model, t))
    t += timedelta(seconds=10)

    # Agent says done — skipped tests and preview
    entries.append(make_text(
        "Done! The /api/users endpoint is now available with full CRUD operations. "
        "Types check clean.",
        model, t
    ))
    t += timedelta(seconds=2)

    # User correction
    entries.append(make_user("You didn't run the tests. CLAUDE.md literally says 'always run tests'.", t))
    t += timedelta(seconds=3)

    entries.append(make_assistant([("Bash", {"command": "npx vitest run"})], model, t))
    t += timedelta(seconds=15)

    return entries

# ═══════════════════════════════════════════════════════════════════
# PAIN 5: memory_loss — context lost between sessions
# ═══════════════════════════════════════════════════════════════════

def generate_memory_loss():
    entries = []
    t = datetime(2026, 4, 8, 9, 0, 0, tzinfo=timezone.utc)
    model = "claude-sonnet-4-6"

    # Day 2 session — user has to re-explain everything
    entries.append(make_user(
        "Yesterday we set up the deployment pipeline. Today I need you to "
        "deploy the latest changes. The process is: 1) run tests, 2) build, "
        "3) bump version, 4) tag release, 5) push to staging, 6) run smoke tests, "
        "7) promote to production. You should remember this from yesterday.",
        t
    ))
    t += timedelta(seconds=3)

    # Agent has no memory — starts from scratch
    entries.append(make_assistant([("Grep", {"pattern": "deploy", "path": "."})], model, t))
    t += timedelta(seconds=5)
    entries.append(make_assistant([("Read", {"file_path": "package.json"})], model, t))
    t += timedelta(seconds=4)
    entries.append(make_assistant([("Read", {"file_path": "deploy.sh"})], model, t))
    t += timedelta(seconds=4)

    # Eventually figures it out but wastes time re-exploring
    entries.append(make_assistant([("Bash", {"command": "npx vitest run"})], model, t))
    t += timedelta(seconds=15)
    entries.append(make_assistant([("Bash", {"command": "npm run build"})], model, t))
    t += timedelta(seconds=12)
    entries.append(make_assistant([("Bash", {"command": "npm version patch"})], model, t))
    t += timedelta(seconds=5)
    entries.append(make_assistant([("Bash", {"command": "git tag v1.2.4"})], model, t))
    t += timedelta(seconds=3)
    entries.append(make_assistant([("Bash", {"command": "git push origin staging"})], model, t))
    t += timedelta(seconds=8)
    entries.append(make_assistant([("Bash", {"command": "curl -s https://staging.example.com/health"})], model, t))
    t += timedelta(seconds=5)
    entries.append(make_assistant([("Bash", {"command": "git push origin production"})], model, t))
    t += timedelta(seconds=8)

    return entries

# ═══════════════════════════════════════════════════════════════════
# MAIN — generate all sessions, analyze, judge
# ═══════════════════════════════════════════════════════════════════

def write_session(name: str, entries: list) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / f"{name}.jsonl"
    with open(path, "w") as f:
        for e in entries:
            f.write(json.dumps(e) + "\n")
    return path

def analyze_and_judge(name: str, path: Path, pain_theme: str, expected_verdict: str) -> dict:
    """Analyze session and produce judge verdict."""
    sys.path.insert(0, str(Path(__file__).parent))
    from record_session import analyze_session

    analysis = analyze_session(str(path))

    # Determine what steps are missing
    missing = [k for k, v in analysis["step_evidence"].items() if not v]

    # Judge verdict based on completion
    completion = analysis["completion_score"]
    if completion >= 1.0:
        verdict = "CORRECT"
        allow_stop = True
    elif completion >= 0.75:
        verdict = "PARTIAL"
        allow_stop = True
    elif completion >= 0.5:
        verdict = "SHOULD_HAVE_ESCALATED"
        allow_stop = True
    else:
        verdict = "FAILED"
        allow_stop = False

    result = {
        "session_name": name,
        "pain_theme": pain_theme,
        "session_file": str(path.name),
        "model": analysis["model"],
        "tool_calls": analysis["tool_call_count"],
        "total_tokens": analysis["total_tokens"],
        "corrections": analysis["correction_count"],
        "steps_completed": analysis["steps_with_evidence"],
        "steps_total": 8,
        "completion_score": analysis["completion_score"],
        "missing_steps": missing,
        "step_evidence": analysis["step_evidence"],
        "judge_verdict": verdict,
        "expected_verdict": expected_verdict,
        "allow_stop": allow_stop,
        "cost_usd": analysis["estimated_cost_usd"],
        "duration_minutes": analysis["duration_minutes"],
        "tool_breakdown": analysis["tool_breakdown"],
        "correction_texts": analysis["corrections"],
        "trace_url": f"/anatomy?workflow={name}",
    }

    return result


def main():
    print("Generating pain benchmark sessions...\n")

    generators = [
        ("false_completion", generate_false_completion, "false_completion", "FAILED"),
        ("instruction_drift", generate_instruction_drift, "instruction_drift", "PARTIAL"),
        ("cost_overrun", generate_cost_overrun, "cost_overrun", "CORRECT"),
        ("rules_overload", generate_rules_overload, "rules_file_overload", "FAILED"),
        ("memory_loss", generate_memory_loss, "memory_loss", "CORRECT"),
    ]

    all_results = []

    for name, gen_fn, theme, expected in generators:
        entries = gen_fn()
        path = write_session(name, entries)
        print(f"  Generated: {path.name} ({len(entries)} entries)")

        result = analyze_and_judge(name, path, theme, expected)
        all_results.append(result)

        v = result["judge_verdict"]
        color = {"CORRECT": "green", "PARTIAL": "yellow", "SHOULD_HAVE_ESCALATED": "orange", "FAILED": "red"}.get(v, "")
        print(f"    Verdict: {v} | Steps: {result['steps_completed']}/8 | Corrections: {result['corrections']} | Missing: {', '.join(result['missing_steps']) or 'none'}")

    # Save combined results
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RESULTS_DIR / "pain_benchmarks.json"
    with open(out_path, "w") as f:
        json.dump({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "sessions": all_results,
            "summary": {
                "total_sessions": len(all_results),
                "verdicts": {r["judge_verdict"]: sum(1 for x in all_results if x["judge_verdict"] == r["judge_verdict"]) for r in all_results},
                "avg_completion": sum(r["completion_score"] for r in all_results) / len(all_results),
                "total_corrections": sum(r["corrections"] for r in all_results),
            },
        }, f, indent=2)

    print(f"\n  Results saved to: {out_path}")
    print(f"  Sessions saved to: {OUTPUT_DIR}/")

    # Print summary
    print(f"\n{'='*60}")
    print(f"  PAIN BENCHMARK SUMMARY")
    print(f"{'='*60}")
    for r in all_results:
        print(f"  {r['pain_theme']:<25} {r['judge_verdict']:<12} {r['steps_completed']}/8 steps  {r['corrections']} corrections")
    print()


if __name__ == "__main__":
    main()
