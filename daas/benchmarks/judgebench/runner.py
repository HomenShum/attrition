"""JudgeBench adapter — load task, ask judge for A-or-B pick, score exact-match.

Task schema (normalized — JudgeBench variants differ slightly in the HF
dataset; we handle the v1 `pair_id / question / response_A / response_B /
label` shape):

    pair_id     : str
    question    : str
    response_A  : str
    response_B  : str
    label       : "A" | "B"         # which response is gold-preferred
    category    : str               # "knowledge" | "reasoning" | "math" | "coding"

Scoring: exact-match on A/B pick extracted from the judge's free-text.
No LLM in the judge-of-judge loop — the benchmark's own gold label is
the source of truth.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from daas.benchmarks import BenchmarkResult

JUDGEBENCH_REPO = "ScalerLab/JudgeBench"
JUDGEBENCH_CACHE_DIR = Path(__file__).resolve().parent.parent / "_cache" / "judgebench"

GEMINI_FLASH_LITE = "gemini-3.1-flash-lite-preview"
GEMINI_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/"
    "models/{model}:generateContent?key={key}"
)
GEMINI_TIMEOUT_SECONDS = 30

FLASH_LITE_INPUT_USD_PER_TOK = 0.10 / 1_000_000
FLASH_LITE_OUTPUT_USD_PER_TOK = 0.40 / 1_000_000
PRO_INPUT_USD_PER_TOK = 1.25 / 1_000_000
PRO_OUTPUT_USD_PER_TOK = 5.00 / 1_000_000


def _resolve_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key
    env_local = Path(
        "D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/nodebench-ai/.env.local"
    )
    if env_local.exists():
        for line in env_local.read_text(encoding="utf-8").splitlines():
            if line.startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("GEMINI_API_KEY not set")


# ---------------------------------------------------------------------------
# Dataset loading
# ---------------------------------------------------------------------------


def load_tasks(
    limit: int = 50,
    *,
    split: str = "claude",
    force_refresh: bool = False,
) -> list[dict[str, Any]]:
    """Load `limit` JudgeBench tasks from HF.

    The upstream dataset exposes two splits:
      claude — pairs where one response is from Claude
      gpt    — pairs where one response is from GPT
    Default is ``claude`` since attrition's primary judge is Gemini
    Flash Lite and Claude-vs-other pairs reveal cross-family bias.
    """
    JUDGEBENCH_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached = JUDGEBENCH_CACHE_DIR / f"{split}.jsonl"
    if cached.exists() and not force_refresh:
        with cached.open("r", encoding="utf-8") as fh:
            rows = [json.loads(line) for line in fh if line.strip()]
        if rows:
            return rows[:limit]

    try:
        from datasets import load_dataset  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("pip install datasets") from exc

    ds = load_dataset(JUDGEBENCH_REPO, split=split)
    rows: list[dict[str, Any]] = []
    for i, item in enumerate(ds):  # type: ignore[assignment]
        rows.append(dict(item))
        if i + 1 >= limit:
            break
    with cached.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    return rows


# ---------------------------------------------------------------------------
# Pick extraction
# ---------------------------------------------------------------------------


_PICK_PATTERNS = [
    re.compile(r"\b(?:the\s+)?(?:better|correct|preferred)\s+(?:answer|response)\s+is\s+\(?([AB])\)?", re.IGNORECASE),
    re.compile(r"\bmy\s+answer\s+is\s+\(?([AB])\)?", re.IGNORECASE),
    re.compile(r"\bpick[:\s]*\(?([AB])\)?", re.IGNORECASE),
    re.compile(r"\b(?:verdict|decision|choice)[:=\s]*\(?([AB])\)?", re.IGNORECASE),
    re.compile(r"\banswer[:=\s]*\(?([AB])\)?", re.IGNORECASE),
    re.compile(r"\\boxed\{\s*([AB])\s*\}", re.IGNORECASE),
    re.compile(r"response\s*\(?([AB])\)?\s+is\s+better", re.IGNORECASE),
]


def extract_pick(text: str | None) -> str | None:
    """Return 'A', 'B', or None. Canonical patterns only — no last-letter fallback."""
    if not text:
        return None
    for pat in _PICK_PATTERNS:
        m = pat.search(text)
        if m:
            return m.group(1).upper()
    # Bare-last-line fallback — accept "A", "B", "(A)", "A." if it IS the line
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    if not lines:
        return None
    last = lines[-1]
    if re.fullmatch(r"\(?([AB])\)?\.?", last):
        m = re.fullmatch(r"\(?([AB])\)?\.?", last)
        if m:
            return m.group(1).upper()
    return None


# ---------------------------------------------------------------------------
# Live replay
# ---------------------------------------------------------------------------


def _format_prompt(task: dict[str, Any]) -> str:
    q = str(task.get("question") or task.get("prompt") or "")
    a = str(task.get("response_A") or task.get("A") or "")
    b = str(task.get("response_B") or task.get("B") or "")
    return (
        "You are judging which response to a question is objectively more correct.\n"
        "Do not reward length, confidence, or stylistic polish — only correctness.\n\n"
        f"QUESTION:\n{q}\n\n"
        f"RESPONSE A:\n{a}\n\n"
        f"RESPONSE B:\n{b}\n\n"
        "Work through it, then state your answer on a new line as "
        '"The better answer is X" where X is A or B.'
    )


def live_replay(
    task: dict[str, Any],
    *,
    api_key: str | None = None,
    model: str = GEMINI_FLASH_LITE,
) -> dict[str, Any]:
    """Ask the judge to pick A or B. Returns a compatible artifact shape."""
    key = api_key or _resolve_api_key()
    prompt = _format_prompt(task)
    max_tokens = 4096 if "pro" in model else 2048

    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.0, "maxOutputTokens": max_tokens},
    }
    url = GEMINI_URL_TEMPLATE.format(model=model, key=key)
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=GEMINI_TIMEOUT_SECONDS) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")[:512]
        return _error_artifact(model, started, f"HTTPError {exc.code}: {body_text}")
    except Exception as exc:
        return _error_artifact(model, started, f"{type(exc).__name__}: {exc}")

    duration_ms = int((time.time() - started) * 1000)
    text = ""
    finish_reason = None
    cands = payload.get("candidates") or []
    if cands:
        c0 = cands[0]
        finish_reason = c0.get("finishReason")
        text = "".join(str(p.get("text", "")) for p in (c0.get("content") or {}).get("parts") or [])

    pick = extract_pick(text)
    truncation = None
    if finish_reason == "MAX_TOKENS" and pick is None:
        truncation = f"truncated_at_max_tokens ({max_tokens})"

    usage = payload.get("usageMetadata") or {}
    in_tok = int(usage.get("promptTokenCount", 0))
    out_tok = int(usage.get("candidatesTokenCount", 0))
    if "pro" in model:
        cost = in_tok * PRO_INPUT_USD_PER_TOK + out_tok * PRO_OUTPUT_USD_PER_TOK
    else:
        cost = in_tok * FLASH_LITE_INPUT_USD_PER_TOK + out_tok * FLASH_LITE_OUTPUT_USD_PER_TOK

    return {
        "pick": pick,
        "response_text": text,
        "_meta": {
            "model": model,
            "input_tokens": in_tok,
            "output_tokens": out_tok,
            "cost_usd": cost,
            "duration_ms": duration_ms,
            "finish_reason": finish_reason,
            "error": truncation,
        },
    }


def _error_artifact(model: str, started: float, err: str) -> dict[str, Any]:
    return {
        "pick": None,
        "response_text": "",
        "_meta": {
            "model": model,
            "input_tokens": 0,
            "output_tokens": 0,
            "cost_usd": 0.0,
            "duration_ms": int((time.time() - started) * 1000),
            "error": err,
        },
    }


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def _task_id(task: dict[str, Any]) -> str:
    for k in ("pair_id", "id", "question_id", "index"):
        if k in task and task[k] is not None:
            return str(task[k])
    # Fallback — hash the question
    import hashlib

    return hashlib.sha256(str(task.get("question", "")).encode()).hexdigest()[:12]


def run_task(task: dict[str, Any], artifact: dict[str, Any]) -> BenchmarkResult:
    expected = task.get("label") or task.get("gold") or task.get("preferred")
    task_id = _task_id(task)
    meta = artifact.get("_meta") if isinstance(artifact, dict) else None
    meta_error = meta.get("error") if isinstance(meta, dict) else None

    if expected is None:
        return BenchmarkResult(
            benchmark_id="judgebench",
            task_id=task_id,
            passed=False,
            score=0.0,
            raw_result={"_meta": meta} if meta else {},
            harness_error="missing_label",
        )

    pick = artifact.get("pick") if isinstance(artifact, dict) else None
    # Normalize label — HF dataset sometimes uses 0/1 or "response_A"/"response_B"
    normalized_expected = _normalize_label(expected)
    normalized_pick = pick.upper() if isinstance(pick, str) else None

    passed = (
        normalized_pick is not None
        and normalized_expected is not None
        and normalized_pick == normalized_expected
    )
    return BenchmarkResult(
        benchmark_id="judgebench",
        task_id=task_id,
        passed=passed,
        score=1.0 if passed else 0.0,
        raw_result={
            "expected": normalized_expected,
            "actual": normalized_pick,
            "category": task.get("category"),
            "_meta": meta,
        },
        harness_error=str(meta_error) if meta_error else None,
    )


def _normalize_label(label: Any) -> str | None:
    """Normalize JudgeBench labels to 'A' or 'B'.

    Upstream exposes several shapes across splits:
      "A"        — bare letter
      "A>B"      — A is preferred (canonical comparator form)
      "response_A" / "response_B"
      0 / 1      — 0 => A, 1 => B
    """
    if isinstance(label, (int, bool)):
        return "A" if int(label) == 0 else "B"
    if isinstance(label, str):
        up = label.strip().upper()
        if up in ("A", "B"):
            return up
        # Comparator form: "A>B" means A beats B
        if ">" in up:
            lhs, _, rhs = up.partition(">")
            lhs = lhs.strip()
            rhs = rhs.strip()
            if lhs in ("A", "B") and rhs in ("A", "B") and lhs != rhs:
                return lhs
            return None  # Malformed comparator — bail; don't fall through
        # "response_A" / "response_B" / "A is better"
        if up.startswith("RESPONSE_") and len(up) >= len("RESPONSE_A"):
            last = up[-1]
            if last in ("A", "B"):
                return last
        if "A" in up and "B" not in up:
            return "A"
        if "B" in up and "A" not in up:
            return "B"
    return None
