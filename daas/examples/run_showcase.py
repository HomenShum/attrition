"""End-to-end pipeline showcase — runs 3 diverse queries through the live
prod Convex deployment and captures every artifact (trace, WorkflowSpec,
replay, judgment with boolean checks) to JSON files for inspection.

The user explicitly asked: "can it actually show me a scaffolded real
example and judged results after distillation" — this script answers yes,
by producing inspectable artifacts at daas/examples/results/.

Usage:
    python3 run_showcase.py
    # then open daas/examples/results/showcase.html
"""

import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from convex import ConvexClient

CONVEX_URL = "https://agile-caribou-964.convex.cloud"
CONVEX_SITE = "https://agile-caribou-964.convex.site"

# Fresh Gemini API key for running Pro manually (to get the EXPERT trace)
# that we then ingest + distill + replay.
def _load_gemini_key() -> str:
    env = Path("D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/nodebench-ai/.env.local")
    for line in env.read_text().splitlines():
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("GEMINI_API_KEY not found")


RESULTS = Path(__file__).parent / "results"
RESULTS.mkdir(parents=True, exist_ok=True)


# Diverse queries designed to exercise different worker roles. Each pair is
# (session_id_base, query, repo_context_json).
QUERIES = [
    (
        "showcase_api_failure",
        "Our Stripe webhook returned 504 errors for 30 minutes this morning affecting 420 customer payments. What happened and what should we do?",
        {
            "url": "https://showcase.example.com/ops",
            "affected_service": "payments.stripe.webhook",
            "impact_window": "2026-04-19 06:30-07:00 PDT",
            "related_issues": ["ISS-PAY-033", "POL-OPS-011"],
        },
    ),
    (
        "showcase_hiring_decision",
        "We have 3 senior engineering candidates who all passed the technical bar. Given our current team is heavy on backend and we're pivoting to AI agent products, who should we prioritize?",
        {
            "url": "https://showcase.example.com/hiring",
            "open_role": "senior_engineer",
            "team_composition": "8 backend, 2 frontend, 0 ML",
            "strategic_priority": "Q2 2026 AI agent product launch",
            "related_issues": ["ISS-HIRE-012", "POL-HR-008"],
        },
    ),
    (
        "showcase_competitive_analysis",
        "Anthropic just launched Opus 4.7 with 2.7pp higher SWE-bench Multilingual at -11.9% cost via the advisor pattern. How should we position our roadmap against this?",
        {
            "url": "https://showcase.example.com/strategy",
            "competitor": "Anthropic",
            "product_context": "enterprise AI agent platform",
            "related_issues": ["ISS-STRAT-045", "POL-PROD-002"],
        },
    ),
]


def call_gemini_pro(query: str, repo_context: dict, api_key: str) -> dict:
    """Call Pro directly to produce the EXPERT trace that we'll ingest."""
    ctx_summary = json.dumps(repo_context, indent=2)
    prompt = f"""You are an expert operations analyst. Answer the following query with:
1. Reference any relevant issue/policy IDs from the context
2. Numbered immediate actions (within 1 hour)
3. Numbered follow-up actions (today / this week)
4. Risk / impact quantification where possible
5. Cross-org or competitive pattern notes

Be specific. Cite context IDs. Use numbered lists. Structure the response
with clear sections (Issue Identified, Applicable Policy, Immediate Actions,
Follow-up Actions, Risk/Impact).

CONTEXT:
{ctx_summary}

QUERY: {query}

RESPONSE:"""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key={api_key}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2000},
    }
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    start = time.time()
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    duration_ms = int((time.time() - start) * 1000)
    text = "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
    usage = data.get("usageMetadata", {})
    inp = usage.get("promptTokenCount", 0)
    out = usage.get("candidatesTokenCount", 0)
    cost = (inp / 1e6) * 1.25 + (out / 1e6) * 5.0
    return {
        "text": text,
        "input_tokens": inp,
        "output_tokens": out,
        "total_tokens": inp + out,
        "cost_usd": cost,
        "duration_ms": duration_ms,
    }


def http_ingest(session_id: str, query: str, expert: dict, repo_context: dict):
    payload = {
        "sessionId": session_id,
        "sourceModel": "gemini-3.1-pro-preview",
        "sourceSystem": "showcase-e2e",
        "query": query,
        "finalAnswer": expert["text"],
        "totalCostUsd": expert["cost_usd"],
        "totalTokens": expert["total_tokens"],
        "durationMs": expert["duration_ms"],
        "repoContextJson": json.dumps(repo_context),
    }
    req = urllib.request.Request(f"{CONVEX_SITE}/api/daas/ingest",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json",
                 "x-daas-api-key": "showcase-e2e-client-1234567890ab"},
        method="POST")
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def main():
    api_key = _load_gemini_key()
    c = ConvexClient(CONVEX_URL)

    # Clean any prior showcase rows
    c.action("domains/daas/admin:runAdminOp",
             {"op": "deleteTracesByPrefix", "sessionIdPrefix": "showcase_"})
    print("Cleaned prior showcase_* rows\n")

    all_artifacts = []

    for base_id, query, repo_context in QUERIES:
        session_id = f"{base_id}_{int(time.time())}"
        print(f"\n{'=' * 60}")
        print(f"QUERY: {query[:80]}")
        print(f"session: {session_id}")

        # 1. Get expert Pro response
        print("\n[1] Calling Pro (expert)...")
        expert = call_gemini_pro(query, repo_context, api_key)
        print(f"  pro cost=${expert['cost_usd']:.6f} tokens={expert['total_tokens']}")

        # 2. Ingest via HTTP
        print("\n[2] HTTP ingest...")
        ingest = http_ingest(session_id, query, expert, repo_context)
        print(f"  traceId={ingest.get('traceId')} ok={ingest.get('ok')}")

        # 3. Distill
        print("\n[3] Distill (server-side Pro)...")
        distilled = c.action("domains/daas/actions:distillTrace",
                             {"sessionId": session_id})
        print(f"  spec: workers={distilled['workerCount']} tools={distilled['toolCount']}")
        print(f"  distill cost=${distilled['distillCostUsd']:.6f}")

        # 4. Replay
        print("\n[4] Replay (server-side Flash Lite)...")
        replay = c.action("domains/daas/actions:replayTrace",
                          {"sessionId": session_id})
        print(f"  dispatched: {replay['workersDispatched']}")
        print(f"  replay cost=${replay['replayCostUsd']:.6f} tokens={replay['replayTokens']}")

        # 5. Judge with generic rubric
        print("\n[5] Judge (LLM boolean rubric)...")
        judgment = c.action("domains/daas/actions:judgeReplay",
                            {"sessionId": session_id,
                             "replayId": replay["replayId"],
                             "rubricId": "daas.generic.v1"})
        print(f"  verdict={judgment['verdict']} "
              f"passed={judgment['passedCount']}/{judgment['totalCount']}")

        # 6. Load full artifacts via getRun
        detail = c.query("domains/daas/queries:getRun", {"sessionId": session_id})
        all_artifacts.append({
            "query": query,
            "repo_context": repo_context,
            "session_id": session_id,
            "expert": expert,
            "distilled": distilled,
            "replay": replay,
            "judgment": judgment,
            "full_run": detail,
        })
        time.sleep(1)

    # Save full artifacts
    out_json = RESULTS / "showcase.json"
    out_json.write_text(
        json.dumps(
            all_artifacts,
            indent=2,
            default=lambda o: float(o) if hasattr(o, "__float__") else str(o),
        ),
        encoding="utf-8",
    )
    print(f"\n\nArtifacts saved: {out_json}")

    # Keep the rows in prod so /daas page shows them too
    print(f"\nLeaving {len(QUERIES)} showcase rows in prod so /daas shows them live.")

if __name__ == "__main__":
    main()
