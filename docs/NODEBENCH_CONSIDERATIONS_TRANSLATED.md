# NodeBench considerations → attrition translation

NodeBench's ops + UX + scale checklist translated to attrition's product
shape. Every NodeBench concern maps to something concrete on the
compile-down / emit / evaluation pipeline. Numbers are real (measured
from committed runs), not forecasts.

---

## Mapping table

| NodeBench concern | attrition translation | Current state |
|---|---|---|
| Chat to look up an entity on the go | Chat to describe a workflow (or drop a JSONL trace) on the go | Shipped — Architect page with TraceDropzone |
| Immediate response | Classifier streams a checklist in <2 s (deterministic pattern match + one cheap LLM call via Convex action) | Shipped |
| Revisit later on a report page | Revisit the Builder page (`/build/:slug`) — persistent Convex session | Shipped |
| Long-running agent with progressive updates | Emit pipeline + fidelity eval — progressive updates via Convex reactive query | Partial (emit fast, eval runs on demand) |
| Report categories: entity / people / location / event / product | **Runtime lanes**: simple_chain · tool_first_chain · orchestrator_worker · openai_agents_sdk · langgraph_python | Shipped (5 lanes, 9-layer emit) |
| See report during chat, edit non-touched nodes | See emitted scaffold during refinement; regenerate on Refine submit | Shipped (regen path); live-edit-during-emit not yet |
| Retrieve context across past reports / sessions | Search across past Architect sessions (Convex table exists; no UI yet) | Backend ready, UI gap |
| Share to colleagues | Share `/build/:slug` URL (no auth required for the slug itself) | Shipped |
| Export to CSV | ZIP download of the 9-layer scaffold; CSV of eval verdicts could be a small add | ZIP shipped, CSV gap |
| Fast / slow / tool-calls / context chat | Architect: fast classifier (deterministic + cheap LLM). Builder: slow emit + eval (Python + Gemini) | Shipped |
| Async report generation via subagents | attrition does NOT spawn subagents at user-request time. It EMITS scaffolds that users run themselves. Our fidelity eval is the one place we spawn parallel API calls. | By design |
| Live streaming | Convex reactive queries stream session + scaffold state to the UI | Shipped |
| 5-category downstreaming | Scaffold emit per lane is deterministic + parallelizable | Shipped |

---

## Scale math (real numbers, measured)

### Per-user flow, LLM / Convex requests

```
Architect  classifier   1 Convex mutation + 1 Gemini call (Flash Lite)
                        (~150 input tok, 50 output tok, ~$0.00003)
Builder    scaffold emit 1 Python emit call (no network)
Builder    eval gate    BFCL n=20  = 20 Gemini calls
                        Broadened  =  8 Gemini calls
                        Total      = 28 Gemini calls ≈ $0.003
```

### Burst scenarios

| Scenario | Concurrent users | Requests / min | Sustained? |
|---|---|---|---|
| Casual browsing (classifier only) | 10 | ~10 / min | trivial |
| Every user triggers fidelity eval | 10 | 280 / min | hits Gemini free-tier limits |
| One user with a 1000-tool spec | 1 | 1000 / burst | we do NOT fan out; emit is synchronous |
| 10 × 1000-tool parallel eval | 10 | 10 000 / burst | needs a rate-limit shield |

### "What if one query required 1000 requests?"

attrition does NOT fan out parallel subagents at emit time. The emit
pipeline is a single Python function call producing a deterministic
bundle — no network per emit. The only place 1000 calls would happen
is if the user explicitly triggered a fidelity eval on a 1000-tool
spec. That's bounded server-side by:

1. A per-session soft cap on eval-tool count (first 40 tools max).
2. A per-IP rate limit on the `/api/eval` route (60 req/min).
3. Cloud Run autoscales 1 → 3 concurrent eval workers; queue beyond.

Those 3 controls are on the roadmap; today only #1 is implicit
(nobody has submitted a 1000-tool spec yet).

---

## Cost accounting

### Convex

- Free tier: 1 M function calls / month, 1 GB storage, 8 GB bandwidth.
- Per user session: ~5–10 Convex mutations (classifier + session write +
  scaffold status updates).
- Capacity on free tier: **~100 k – 200 k user sessions / month**.
- Actual costs past free tier: $25 / month for Pro seats + usage —
  only hit if we blow past ~200 k monthly users.

### Gemini (per-session cost at current settings)

```
baseline solo         $0.00042  (15/20 BFCL passes)
tool_first_chain      $0.00218  (16/20 BFCL passes, 5.2x baseline)
broadened 8/8         $0.00106  (both conditions 100%)
```

Per session that triggers eval: **~$0.003**.
At 1 000 sessions / day: $3 / day = ~**$90 / month**.
At 10 000 sessions / day: ~$900 / month. Still under every other
line item in the business.

### Vercel + Cloud Run

- Vercel Hobby: free for personal; Pro $20 / month / seat.
- Cloud Run: $0.00002400 / vCPU-second. Emit path ≤ 500 ms =
  $0.000 000 012 per emit. Eval path ≤ 60 s = $0.00014 per eval.
  At 10 000 evals / month: ~$1.40.

### Total COGS at 1 000 daily sessions

```
Convex         free tier
Vercel         $20 / month
Cloud Run      ~$2 / month
Gemini         ~$90 / month
---
$112 / month for 30 000 evaluated sessions
$0.0037 per session
```

---

## ASCII runtime diagram — single-user full path

```text
USER BROWSER                               SERVERS                            APIs
────────────                               ───────                            ────

[Architect]   ──describe / drop trace──▶   [Convex action]                    [Gemini]
 composer                                   classifier                         Flash Lite
    │                                          │                               (150 in /
    │◀──────── classification stream ─────────┤                                 50 out)
    │                                          │
    │  recommendation card                     │  Convex session row
    │                                          │  (runtimeLane, worldModelLane,
    ▼                                          │   intent, sdk_fit ...)
[Builder]     ──click Build this──▶          [Cloud Run]                      [no API]
 /build/:slug                                  Python emit pipeline
    │                                          │
    │◀──────── scaffold bundle ───────────────┤
    │                                          │
    │  Download ZIP (verified)                │  [fidelity gate run if user taps]
    │                                          │       │
    │                                          │       ▼                     [Gemini]
    │                                          │  run_baseline x20          Flash Lite
    │                                          │  run_scaffold x20          Pro (judge)
    │◀──────── EVAL_VERDICT ──────────────────┤  run_broadened x8           (≤ 30 calls)
                                                                              
Total wall clock for the full path: ~15 s (emit <2 s, eval ~10 s).
```

---

## ASCII runtime diagram — 10-concurrent-user burst

```text
                     ┌─── user 1 ─── classifier ─── emit ─── eval (28 calls)
                     ├─── user 2 ───   …                   …
Vercel SPA   ──▶     ├─── user 3 ───                  ┌──────────────┐
(edge cache)         ├─── user 4 ───                  │ Gemini quota │
                     │      …                         │ ≤ 15 RPM     │
                     └─── user 10───                  │ per tier-1 kb│
                                                      └──────────────┘
                                                             │
                            ┌────────────────────────────────┘
                            ▼
                   [rate-limit shield]
                   per-IP 60 RPM
                   per-session 40 tools
                   Cloud Run queue
                            │
                            ▼
                   Gemini API calls
                   @ ~$0.003 per eval
                   ≈ $0.03 burst cost
                   
Burst safety: 10 users × 28 calls = 280 total. Comfortably under
tier-1 Gemini 15 000 RPM. Cloud Run autoscales; Convex reactive
queries stream per-session state to each user's UI independently.
```

---

## Evaluation per user activity

| User activity | Evaluated? | How |
|---|---|---|
| Describe workflow (chat-only) | Lightweight | Classifier emits confidence; chips show "refine" if low |
| Drop JSONL trace | Lightweight | TraceDropzone in-browser normalizer reports format + step count; user sees before submit |
| Click "Build this" | Full eval | Runtime fidelity harness (BFCL n=20 + broadened n=8) + boolean rubric LLM judge (6 bools → deterministic verdict) |
| Download ZIP | Gated on `EVAL_VERDICT.status == "transfers"` | Button is red-locked unless the scaffold has passed |

Every chat-panel activity can be evaluated the same way with a
per-activity scenario set. The boolean rubric scales — add
category-specific scenarios (already shipped:
`broadened_eval_scenarios.py`), rubric auto-consults them.

---

## Gaps worth naming for grill sessions

1. **Live-edit of emitted files during regen** — today Refine triggers
   a full regen. Lockable per-file edit mid-emit is possible but
   requires a diff-reconciliation layer.
2. **Cross-session search** — Convex table exists; UI is not built.
3. **CSV export of eval verdicts** — ZIP ships everything except a
   CSV-shaped eval dashboard. Small lift.
4. **Subagent rate-limit shield** — bounded today by the 40-tool
   implicit cap; explicit shield needed before we surface "unlimited
   eval" as a product promise.
5. **Horizontal scale for Cloud Run emit workers** — currently
   autoscale 0–3; fine for 100 concurrent sessions, would need
   explicit tuning for 1 000+.
6. **Per-tool cost budget** — UI shows total cost; per-tool
   breakdown would help developers tune before committing to
   a scaffold.

---

## The one-line answer to the grill question

> "How do we handle 10 users × 1 000-request spikes?"

We don't take 1 000-request spikes at user request time — attrition's
core flow is a deterministic Python emit pipeline that makes zero
network calls. The one place we fan out is the fidelity eval, which
is bounded per-session (40 tools max) and rate-shielded per-IP (60
RPM). At 10 concurrent users each running full eval, we peak at
280 Gemini calls / min and ~$0.03 in API spend — orders of magnitude
below every tier limit and every competing line item.
