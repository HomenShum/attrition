"""Redact common secret patterns from JSON/MD artifacts before committing.

Runs in place. Designed for the `daas/results/` output files that
embed real Claude Code session text (which can contain API keys,
tokens, OAuth credentials, etc.).
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Patterns to redact — covers the obvious classes. Each pattern leaves a
# stable tag that makes it grep-visible which category was caught.
PATTERNS: tuple[tuple[str, re.Pattern[str], str], ...] = (
    ("gcp_api_key", re.compile(r"AIza[0-9A-Za-z_-]{35}"), "[REDACTED_GCP_API_KEY]"),
    ("openai_key", re.compile(r"sk-(?:proj-)?[A-Za-z0-9_-]{20,}"), "[REDACTED_OPENAI_KEY]"),
    ("anthropic_key", re.compile(r"sk-ant-[A-Za-z0-9_-]{30,}"), "[REDACTED_ANTHROPIC_KEY]"),
    ("github_pat", re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"), "[REDACTED_GITHUB_PAT]"),
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[REDACTED_AWS_KEY]"),
    ("slack_token", re.compile(r"xox[baprs]-[0-9A-Za-z-]{10,}"), "[REDACTED_SLACK_TOKEN]"),
    ("generic_bearer", re.compile(r"Bearer\s+[A-Za-z0-9_\-.=]{30,}"), "Bearer [REDACTED_TOKEN]"),
    # Convex deploy / access keys sometimes look like base64-ish long runs.
    ("convex_deploy", re.compile(r"dev:[a-z-]+\|[A-Za-z0-9_+/=-]{30,}"), "[REDACTED_CONVEX_DEPLOY_KEY]"),
    ("private_key_block", re.compile(r"-----BEGIN [A-Z ]+PRIVATE KEY-----[^-]*-----END [A-Z ]+PRIVATE KEY-----", re.DOTALL), "[REDACTED_PRIVATE_KEY]"),
)


def redact_text(text: str) -> tuple[str, dict[str, int]]:
    counts: dict[str, int] = {}
    for label, pat, replacement in PATTERNS:
        new, n = pat.subn(replacement, text)
        if n:
            counts[label] = counts.get(label, 0) + n
            text = new
    return text, counts


def redact_file(path: Path) -> dict[str, int]:
    try:
        data = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return {}
    new, counts = redact_text(data)
    if counts:
        path.write_text(new, encoding="utf-8")
    return counts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="+", help="Files or dirs to redact in place")
    args = ap.parse_args()

    total: dict[str, int] = {}
    files_touched = 0
    for p in args.paths:
        path = Path(p)
        if path.is_dir():
            targets = [q for q in path.rglob("*") if q.is_file() and q.suffix.lower() in {".json", ".md", ".txt", ".jsonl"}]
        else:
            targets = [path]
        for q in targets:
            counts = redact_file(q)
            if counts:
                files_touched += 1
                for k, v in counts.items():
                    total[k] = total.get(k, 0) + v
                print(f"[redacted] {q}  {counts}")

    print(f"\n[DONE] files touched: {files_touched}  totals: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
