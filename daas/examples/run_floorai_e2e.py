"""End-to-end FloorAI test against the new attrition Convex deployment.

Confirms the full DaaS pipeline works on attrition.sh with FloorAI's real
retail-ops data:
  1. Run Pro directly on 3 FloorAI queries (expert traces)
  2. Push each trace via attrition.sh's HTTP ingest endpoint
  3. Trigger server-side distillTrace (Convex action) — Pro extracts scaffolds
  4. Trigger server-side replayTrace (Convex action) — Flash Lite executes
  5. Trigger server-side judgeReplay with the retail_ops rubric
  6. Verify all artifacts land at attrition.sh/daas

Uses the same FloorAI seed data (policies + issues CSV) that the live
FloorAI Convex agent uses, so the expert traces are realistic.
"""

import json
import time
import urllib.request
from pathlib import Path
from convex import ConvexClient

ATTRITION_CONVEX = "https://joyous-walrus-428.convex.cloud"
ATTRITION_SITE = "https://joyous-walrus-428.convex.site"
FLOORAI_DATA = Path("D:/VSCode Projects/cafecorner_nodebench/floorai/data")

RESULTS = Path(__file__).parent / "results"
RESULTS.mkdir(parents=True, exist_ok=True)


def _gemini_key() -> str:
    env = Path("D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/nodebench-ai/.env.local")
    for line in env.read_text().splitlines():
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("GEMINI_API_KEY not found")


def load_floorai_context() -> dict:
    return {
        "policies": json.loads((FLOORAI_DATA / "policies.json").read_text(encoding="utf-8")),
        "issues_csv": (FLOORAI_DATA / "synthetic_issues.csv").read_text(encoding="utf-8"),
    }


FLOORAI_QUERIES = [
    ("floorai_attrition_milk",     "STR-101", "What's happening with our milk delivery?"),
    ("floorai_attrition_staffing", "STR-103", "We're short-staffed today, 3 people called out. What should I do?"),
    ("floorai_attrition_cooler",   "STR-104", "Our walk-in cooler is at 52 degrees, what do I do?"),
]


def call_gemini_pro(query: str, ctx: dict, store_id: str, api_key: str) -> dict:
    policies_summary = "".join(
        f"  {p.get('policyId','?')} [{p.get('category','?')}]: {p.get('title','')}: {str(p.get('content',''))[:240]}\n"
        for p in ctx.get("policies", [])[:15]
    )
    issues_head = "\n".join(ctx.get("issues_csv", "").split("\n")[:50])
    prompt = f"""You are a retail operations assistant for a multi-store grocery chain.

Using the context brief below, answer the manager's query with:
1. Reference specific issue IDs (e.g. ISS-001)
2. Reference specific policy IDs (e.g. POL-INV-003)
3. Numbered immediate actions
4. Numbered follow-up actions
5. Cross-store patterns or revenue impact

Be concise, specific, cite every factual claim.

STORE: {store_id}

POLICIES:
{policies_summary}

ISSUES:
{issues_head}

QUERY: {query}

RESPONSE:"""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key={api_key}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2500},
    }
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    start = time.time()
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    duration_ms = int((time.time() - start) * 1000)
    text = "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
    usage = data.get("usageMetadata", {})
    inp = usage.get("promptTokenCount", 0); out = usage.get("candidatesTokenCount", 0)
    return {
        "text": text,
        "input_tokens": inp, "output_tokens": out,
        "total_tokens": inp + out,
        "cost_usd": (inp / 1e6) * 1.25 + (out / 1e6) * 5.0,
        "duration_ms": duration_ms,
    }


def http_ingest(session_id: str, query: str, expert: dict, store_id: str) -> dict:
    payload = {
        "sessionId": session_id,
        "sourceModel": "gemini-3.1-pro-preview",
        "sourceSystem": "floorai-attrition-e2e",
        "query": query,
        "finalAnswer": expert["text"],
        "totalCostUsd": expert["cost_usd"],
        "totalTokens": expert["total_tokens"],
        "durationMs": expert["duration_ms"],
        "repoContextJson": json.dumps({
            "url": "https://github.com/HomenShum/floorai",
            "store_id": store_id,
        }),
    }
    req = urllib.request.Request(f"{ATTRITION_SITE}/api/daas/ingest",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def main():
    api_key = _gemini_key()
    c = ConvexClient(ATTRITION_CONVEX)
    ctx = load_floorai_context()

    # Clean any prior attrition-e2e rows (use admin action via CLI since key required)
    try:
        c.action("domains/daas/admin:runAdminOp",
                 {"op": "deleteTracesByPrefix", "sessionIdPrefix": "floorai_attrition_"})
    except Exception:
        pass
    print(f"Running E2E against attrition Convex: {ATTRITION_CONVEX}\n")

    results = []
    for base_id, store_id, query in FLOORAI_QUERIES:
        session_id = f"{base_id}_{int(time.time())}"
        print(f"\n{'=' * 60}")
        print(f"[FloorAI] {query}")
        print(f"session: {session_id}")

        print("\n[1] Pro (expert)...")
        expert = call_gemini_pro(query, ctx, store_id, api_key)
        print(f"    cost=${expert['cost_usd']:.6f} tokens={expert['total_tokens']}")

        print("[2] HTTP ingest...")
        ing = http_ingest(session_id, query, expert, store_id)
        print(f"    traceId={ing.get('traceId')}")

        print("[3] Distill...")
        dstl = c.action("domains/daas/actions:distillTrace", {"sessionId": session_id})
        print(f"    workers={dstl['workerCount']} tools={dstl['toolCount']} cost=${dstl['distillCostUsd']:.6f}")

        print("[4] Replay...")
        rpl = c.action("domains/daas/actions:replayTrace", {"sessionId": session_id})
        print(f"    dispatched: {rpl['workersDispatched']}")
        print(f"    cost=${rpl['replayCostUsd']:.6f}  (original was ${expert['cost_usd']:.6f})")

        print("[5] Judge (retail_ops rubric)...")
        jg = c.action("domains/daas/actions:judgeReplay", {
            "sessionId": session_id,
            "replayId": rpl["replayId"],
            "rubricId": "daas.retail_ops.v1",
        })
        print(f"    verdict={jg['verdict']}  {jg['passedCount']}/{jg['totalCount']}")

        results.append({
            "session_id": session_id,
            "query": query,
            "store_id": store_id,
            "expert_cost": expert["cost_usd"],
            "distill_cost": dstl["distillCostUsd"],
            "replay_cost": rpl["replayCostUsd"],
            "workers": rpl["workersDispatched"],
            "verdict": jg["verdict"],
            "passed": jg["passedCount"],
            "total": jg["totalCount"],
        })
        time.sleep(1)

    # Aggregate
    stats = c.query("domains/daas/queries:getAggregateStats", {})
    print(f"\n\n{'=' * 60}\nAGGREGATE (attrition Convex):")
    for k, v in stats.items():
        print(f"  {k}: {v}")

    out = RESULTS / "floorai_e2e.json"
    out.write_text(json.dumps({"results": results, "stats": stats}, indent=2, default=str), encoding="utf-8")
    print(f"\nSaved {out}")
    print(f"\nView at: https://attrition.sh/daas")


if __name__ == "__main__":
    main()
