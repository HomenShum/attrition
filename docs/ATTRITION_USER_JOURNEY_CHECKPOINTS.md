# attrition user journey — 1 / 5 / 15 / 30 / 60 min checkpoints

Goal: condense **first-contact → shipped-to-prod** into five unambiguous
milestones, each mapped to a **trust threshold** the user has to cross. Users
clone **exactly once**, at the 30-min mark, after the platform proves the
output is what they actually want. No speculative clones, no "let me try it
locally first." The web app carries them all the way to the green-verdict
moment, then hands off a zip that drops into their existing codebase.

## Why five, not four — and not six

Each checkpoint corresponds to a distinct trust leap. Collapse any two and
users either (a) lose faith and bounce, or (b) clone prematurely and never
come back. The five trust thresholds:

| Threshold | Min | What the user learns |
|---|---|---|
| T1: "it's alive" | 1 | the engine is connected to my input — not a broken demo |
| T2: "it gets me" | 5 | it understood my workflow; classifier is right |
| T3: "real code" | 15 | the scaffold is shaped like code I'd write; gates are green |
| T4: "it's mine" | 30 | I refined it to match my codebase; I'm downloading once |
| T5: "in prod" | 60 | one real request → one real response through my deployed copy |

**Why add T1 (1-min)?** Users landing on a new AI tool default to "this is
probably broken" within ~10 seconds of a blank screen. The 1-min checkpoint
buys trust that something concrete is happening to *their* input — not a
canned demo playing. Without T1, the 5-min cognitive load (reading a full
architecture card) lands on a skeptical user.

**Why not a 60+ / 90-min one?** T5 (first prod request) is the commercially
meaningful endpoint. Observability / drift / retraining belong to a different
lifecycle (post-deploy ops), not the onboarding journey. Keep this doc scoped.

## The five checkpoints at a glance

| Min | Milestone | What user LITERALLY sees | Clone? | Success criterion |
|---|---|---|---|---|
| **1**  | "it's alive"                     | streaming text panel: first classifier tokens rendering next to their input within <2 s | no | >1 token of real output has appeared against their input |
| **5**  | "attrition gets my problem"      | Architecture Blueprint card: lane name + confidence + component layer chips + Interpretive Boundary block | no | user nods: "yeah, that's my use case" |
| **15** | "scaffold matches my intent"     | Scaffold Workbench: file tree materializing file-by-file on the left, code viewer + Preview tab (sandboxed `./run.sh --mock` live terminal) on the right, Evaluation Gate strip of 11 badges below | no | verdict is green; Preview tab shows mock responses flowing |
| **30** | "scaffold is refined + verified" | same Workbench + chat panel at bottom; inline diffs (red fade-out / green slide-in) after each refine; Download ZIP button unlocks | **yes — Download ZIP** | zip on laptop, gates green, "this matches what I want" checked |
| **60** | "running against real traffic"   | their own terminal + their own prod URL; optional Next Steps checklist page in web app that ticks ✅ as their scaffold pings a webhook from each milestone | (already cloned) | agent responds to one real prod request end-to-end |

Nothing earlier than 30 min produces a local clone. That's the whole point.

---

## 1-min checkpoint — "it's alive"

**Path:** Landing page → click "Try it" (or immediately paste into hero input).

**What the user LITERALLY sees (screen layout):**

```
┌────────────────────────────────────────────────────────────────┐
│  attrition.sh                                   [sign in]      │
├─────────────────────────────┬──────────────────────────────────┤
│  YOUR INPUT                 │  CLASSIFIER (streaming)          │
│                             │                                  │
│  "Build me an agent that    │  Reading your input...█          │
│   takes a customer support  │                                  │
│   ticket, searches our KB,  │  This looks like a               │
│   drafts a reply, and       │  **tool_first_chain** lane       │
│   routes to Slack if        │  (87% confidence) ...            │
│   unresolved."              │                                  │
│                             │  [cursor blinking]               │
└─────────────────────────────┴──────────────────────────────────┘
```

**Rendering specifics:**
- Split-pane. Input on the left stays visible and highlighted (so the user
  can see attrition is reading *their* text, not playing a demo).
- Right pane has a header badge: "🟢 classifier streaming (flash-lite)"
- Tokens render via Server-Sent Events, word-by-word. Cursor blinks.
- <2 s to first visible token (cached classifier, Flash Lite model).
- The exact spans of the input that are driving the classification highlight
  inline as the model identifies them — the left pane gets
  yellow-background underlines under `"ticket"`, `"searches our KB"`,
  `"routes to Slack"`.

**What's NOT there yet:** no lane card, no SDK, no scaffold button. Just
proof-of-life that THEIR input is being processed.

**UX requirements:**
- First token <2 s (hard SLO — slower than this looks broken)
- Streaming must visibly halt if the model errors (not pretend to keep going)
- "Stop" button visible from token 1 (reversibility builds trust)

**Already shipped:** streaming classifier endpoint. **Missing:** split-pane
layout with input-span highlighting; today the input is hidden once you
submit.

---

## 5-min checkpoint — first-contact trust

**Path:** 1-min streaming completes → streaming collapses into an
Architecture Blueprint card.

**What the user LITERALLY sees (screen layout):**

```
┌────────────────────────────────────────────────────────────────┐
│  YOUR WORKFLOW → SCAFFOLD PLAN                                 │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   Lane:         tool_first_chain        87% confidence         │
│   Driver SDK:   openai_agents_sdk       [change]               │
│                                                                │
│   Component layers:                                            │
│   [orchestrator] [3 workers] [state_store] [4 tools]           │
│   [eval harness] [observability]                               │
│                                                                │
│   Tools attrition will wire:                                   │
│   • kb_search (your knowledge base)                            │
│   • draft_reply (LLM generation)                               │
│   • slack_notify (your Slack)                                  │
│                                                                │
│   📐 INTERPRETIVE BOUNDARY                                     │
│   Confident about: multi-step dispatch, tool orchestration     │
│   Inferring: replies are stateless per-ticket                  │
│   Missing: your KB is Notion? Confluence? [tell me]            │
│                                                                │
│              [ Build this scaffold → ]                         │
└────────────────────────────────────────────────────────────────┘
```

**Rendering specifics:**
- Full-width card replaces the streaming pane. Input stays pinned at top.
- Each "[bracket]" is an interactive chip — click [change] next to Driver
  SDK → dropdown of 6 runtimes (gemini_agent, openai_agents_sdk, etc.)
- Interpretive Boundary is always visible, never collapsed — it's the
  honesty signal.
- [tell me] is a chip that opens an inline text input to disambiguate.
- CTA button is disabled if confidence <50% until user clicks a
  disambiguation chip.

**What's NOT shown:** no code yet. No buttons that write to disk. No clone
button. Just "here's what I think you're asking for, correct me if I'm wrong."

**UX requirements:**
- `<2 s` to first streamed token (cached classifier + Flash Lite)
- "Not quite — it's more like ___" correction chip above the lane card
- Classifier output always cites the 2-3 spans in the input that drove the pick

**Already shipped:** `Architect.tsx` + classifier + lane recommendation.

**Missing bits:**
- Interpretive Boundary is rendered but not always honest about low-confidence picks
- No telemetry on "user landed → how many seconds to first correction-or-accept"

---

## 15-min checkpoint — scaffold inspection

**Path:** Click "Build this scaffold" on the Blueprint card → workbench
opens → watch agent emit the bundle live.

**What the user LITERALLY sees (screen layout):**

```
┌────────────────────────────────────────────────────────────────────┐
│ Driven by: openai_agents_sdk · gpt-5.4 · 8m34s elapsed · turn 11/20│
├──────────────────────┬─────────────────────────────────────────────┤
│  FILES (10/10)       │  [Code]  [Preview]  [Spec]                  │
│                      ├─────────────────────────────────────────────┤
│  ✓ workflow_spec.json│  # server.py                                │
│  ✓ server.py         │  from agents import Agent, Runner           │
│  ✓ state_store.py    │  from .tools import KB_TOOLS, SLACK_TOOL    │
│  ✓ eval/             │                                             │
│    ✓ cases.jsonl     │  agent = Agent(                             │
│    ✓ harness.py      │      name="support_drafter",                │
│  ✓ observability.py  │      tools=KB_TOOLS + [SLACK_TOOL],         │
│  ✓ mcp_server.py     │      model="gpt-5.4"                        │
│  ⟳ README.md         │  )                                          │
│  · requirements.txt  │                                             │
│  · run.sh            │  # [line 23 highlighted — currently writing]│
│  · .env.example      │                                             │
├──────────────────────┴─────────────────────────────────────────────┤
│ EVALUATION GATES                                                   │
│ ✅ compiles  ✅ 9-layers  ✅ lane-match  ✅ connector-resolver     │
│ ✅ mcp-load  ✅ spec-roundtrip  ✅ baseline  ✅ cost-budget         │
│ ✅ latency   ✅ runtime-used   ⟳ runs-mock                         │
│                                                                    │
│ [ Download ZIP — locked, 1 gate pending ]                          │
└────────────────────────────────────────────────────────────────────┘
```

**Rendering specifics:**
- VS Code-shaped split-pane layout: file tree left, tabbed content right,
  gate strip at bottom.
- File tree materializes one entry at a time as the agent calls
  `write_file`. Each entry fades in. Current file has a `⟳` spinner; done
  files have `✓`.
- **Code tab:** syntax-highlighted rendering of the currently-selected
  file. The line being written right now has a yellow highlight that
  moves as the agent streams.
- **Preview tab** (the crucial "literally see output" moment): embedded
  xterm.js terminal. When user clicks, a sandboxed container runs
  `CONNECTOR_MODE=mock ./run.sh`. They see:
  ```
  $ ./run.sh --mock
  [mock] kb_search('refund policy') → returned 3 canned snippets
  [mock] draft_reply(...) → "Thanks for reaching out. Based on our..."
  [mock] slack_notify → [suppressed, CONNECTOR_MODE=mock]
  ✓ Run complete in 1.2s
  ```
  This is the moment the user sees *their* scaffold produce an actual
  response shape, not just source code.
- **Spec tab:** human-readable rendering of `workflow_spec.json` as a
  canonical summary ("Orchestrator: 1 · Workers: 3 · Tools: 4 · State:
  stateless-per-ticket").
- **Gate strip:** 11 horizontal badges. Each is hover-expandable to show
  the rationale ("lane-match: PASS — skill file loaded was
  `tool_first_chain.md`, emitted layout matches expected shape").
- **Download ZIP button** is explicitly GREYED OUT with tooltip: "1 gate
  still evaluating" or "2 gates failed — click to see fix suggestions."

**What's NOT shown:** no clone button available yet. Download ZIP is gated.

**What's NOT shown:** no clone button yet. Download ZIP is **gated behind
green verdict**. If any gate is red, the button is disabled with a tooltip
explaining which gate failed.

**UX requirements:**
- Gate verdict latency <30 s for fast lanes, <90 s for slow lanes
- Each gate's rationale is a one-line sentence a non-expert can read
- Red gate → inline "Fix this" chat prompt pre-filled ("the `nine_layers_present` gate failed because `observability.py` is missing — regenerate with that file?")

**Already shipped:** agent_loop.py + runtime adapters + skills manifest +
Evaluation Gate banner + `finalize_bundle` safety net.

**Missing bits:**
- Preview tab shows static file contents but doesn't actually exec `run.sh --mock` in a sandbox
- Gates 4 (correct_lane_picked) and 11 (runtime_used_correctly) are LLM-judged, not deterministic — variance across runs needs majority vote or a cache

---

## 30-min checkpoint — refine-then-clone

**Path:** Same Workbench as 15-min + bottom chat panel appears → refine →
regenerate → re-gate → download.

**What the user LITERALLY sees (screen layout):**

```
┌────────────────────────────────────────────────────────────────────┐
│  [Workbench from 15-min, unchanged]                                │
├──────────────────────┬─────────────────────────────────────────────┤
│                      │  # state_store.py (DIFF after refine)       │
│  ...file tree...     │                                             │
│                      │  - import sqlite3                           │
│                      │  + import asyncpg                           │
│                      │  - DB_PATH = ".attrition/state.db"          │
│                      │  + DATABASE_URL = os.environ["DATABASE_URL"]│
│                      │    [green slide-in, red fade-out animation] │
├──────────────────────┴─────────────────────────────────────────────┤
│ EVALUATION GATES — all green ✅                                    │
│ [ ✓ This matches what I want ]  [ Download ZIP ↓ ]                 │
├────────────────────────────────────────────────────────────────────┤
│  💬 CHAT                                                           │
│  You: "Use Postgres not MySQL"                                     │
│  attrition: I'll change state_store.py and requirements.txt. Here's│
│      the diff → [preview above]. Cost: $0.03. Apply? [yes] [no]    │
│  You: "And add Slack notifier with channel + text params"          │
│  attrition: ⟳ generating (turn 3/5)...                             │
└────────────────────────────────────────────────────────────────────┘
```

**Rendering specifics:**
- Chat panel slides up from the bottom when gates first go all-green.
- Each user message triggers a **preview-then-apply** pattern: attrition
  shows the diff as a ghost overlay on the code pane BEFORE writing. User
  clicks [yes] to commit. This is the critical "nothing happens without my
  approval" pattern that earns trust for the Download ZIP click.
- Diffs animate: red lines fade to 0%, green lines slide in from left.
  Takes 400ms — slow enough to see, fast enough to not be annoying.
- A cost tally in the chat header shows cumulative spend for this session
  ("$0.14 so far · ~$0.02 per refinement").
- The **Download ZIP** button transitions from grey → pulsing amber (when
  gates go green) → solid terracotta (when "this matches what I want"
  checkbox ticks).
- After download: a confirmation modal appears with the next-step hint:
  *"Your zip includes `.attrition/provenance.json` — keep it in git so we
  can warn you of SDK drift later. [Keep reading in 60-min checkpoint →]"*

**Example refinement dialogs the user can send:**
- "We use Postgres not MySQL. Change the state_store."
- "Add a Slack notifier tool with params `channel` and `text`."
- "The orchestrator prompt should mention our brand voice — attach `brand.md`."
- "Use OpenRouter with Claude Sonnet instead of direct Anthropic."
- "Shorten the eval set to 5 canonical cases, not 20."

**What happens on each refine:**
- Only the files that need to change get re-emitted (idempotent file writes)
- Full gate suite re-runs
- Diff shown inline with animation
- Cost/latency delta for this refinement shown in chat

**The clone moment:** Download ZIP is only enabled when **all 11 gates are
green AND the user explicitly ticks "this matches what I want"**. This is the
intentional friction point — the whole product is optimized around making
this the **last time** the user asks attrition to generate anything for this
workflow. After clone, they own the code.

**UX requirements:**
- Diff view must highlight deletions + additions side-by-side
- "Undo last refine" button (state_store in Convex so refinements are reversible)
- Export metadata baked into zip: `.attrition/provenance.json` records lane,
  runtime, model, skill hash, gate verdicts, generation timestamp — so on
  future SDK bumps we can surface a "your scaffold was built against
  claude-agent-sdk 0.1.4, current is 0.2.0, re-run gates?" nudge

**Already shipped:** Download ZIP button, zip generation, gate-gating.

**Missing bits:**
- Chat-refine loop not implemented end-to-end (today: regenerate-from-scratch,
  not refine-specific-files)
- No diff view — just a full re-render
- `.attrition/provenance.json` not written yet
- No "this matches what I want" explicit confirm checkbox

---

## 60-min checkpoint — drop-in + ship to prod

**Path:** Terminal on user's laptop, their existing codebase. **The web app
is still open in a tab**, but only as a Next-Steps Checklist that ticks ✅
via webhook pings from the user's local `run.sh`.

**What the user LITERALLY sees (two surfaces simultaneously):**

**Surface A — their own terminal:**
```
$ unzip attrition-scaffold.zip -d my-project/agent/
$ cd my-project/agent
$ cp .env.example .env
$ $EDITOR .env           # fill in ANTHROPIC_API_KEY, DATABASE_URL, ...
$ ./run.sh --mock
[mock] kb_search → canned
[mock] draft_reply → canned
[mock] slack_notify → suppressed
✓ Mock exec passed in 1.1s · pinged attrition webhook

$ $EDITOR connectors/_live_kb_search.py    # replace TODO with real Notion call
$ $EDITOR connectors/_live_slack_notify.py # replace TODO with real Slack SDK call
$ CONNECTOR_MODE=live ./run.sh --smoke
[live] kb_search('refund policy') → 3 real snippets from Notion
[live] draft_reply(...) → "Thanks for reaching out..."
[live] slack_notify → posted to #support-overflow
✓ Live smoke passed in 3.4s · pinged attrition webhook

$ vercel deploy   # or: npx convex deploy · docker build && gcloud run deploy
Deployed to https://my-agent.vercel.app
```

**Surface B — attrition web app (same browser tab they cloned from):**
```
┌────────────────────────────────────────────────────────────────┐
│  NEXT STEPS — post-download checklist                          │
│  (pings in live from your scaffold — opt out in .env)          │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   ✅ Downloaded ZIP                              12:34 PM       │
│   ✅ Mock exec passed                             12:41 PM      │
│   ✅ Live smoke passed                             1:02 PM      │
│   ⏳ Waiting for first prod request...                         │
│                                                                │
│   ─── lane-specific deploy recipe ───                          │
│   Your lane is openai_agents_sdk → deploy target: Docker + Run │
│   [copy deploy command] [open recipe →]                        │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

Eventually:
```
   ✅ First prod request responded                   1:07 PM
   🎉 You're live in production.
```

**Rendering specifics:**
- The web app listens on `POST /api/scaffold/ping` with a
  `provenanceId` (from the zip's `.attrition/provenance.json`).
- The scaffold's `run.sh` emits pings on each milestone, *opt-in,
  anonymized* (no PII, no credentials, just "event: live_smoke_pass").
- If the user declines telemetry, the checklist surfaces as a manual
  click-through instead — each step has a "[ mark done ]" button.
- The deploy recipe panel is **lane-determined**, not runtime-determined
  — a `vercel_ai_sdk` scaffold gets `vercel deploy`, a `langgraph_python`
  one gets a Dockerfile + gcloud recipe, etc. Max 12 recipes, not 72.

### Step-by-step (the printed README walks them through):

```bash
# 1. Unzip alongside your existing code
unzip attrition-scaffold.zip -d my-project/agent/
cd my-project

# 2. Fill in real credentials
cp agent/.env.example agent/.env
# Edit: ANTHROPIC_API_KEY, OPENAI_API_KEY, DATABASE_URL, etc.

# 3. Verify mock mode still works after you've edited it
cd agent && ./run.sh --mock
# Expected: all 11 gates still green; mock connector returns canned responses

# 4. Replace connector stubs with your real handlers
# Open agent/connectors/_live_*.py stubs — each one has a TODO block
# Replace each with your actual API call (Slack, Postgres, Vercel, etc.)

# 5. Flip to live mode and run end-to-end once
CONNECTOR_MODE=live ./run.sh --smoke
# Expected: one real request → one real response → exit 0

# 6. Deploy (lane-specific)
# vercel_ai_sdk    → vercel deploy
# convex_functions → npx convex deploy
# claude_agent_sdk → docker build + cloud run deploy
# langgraph_python → docker + your k8s of choice
# openai_agents_sdk→ docker + your runtime of choice
```

### Success criterion
One real request hits the deployed agent, gets a real response, and the
observability hook records a trace event with cost + latency + tool-calls.

### What the scaffold guarantees out of the box
- `CONNECTOR_MODE=mock` ↔ `CONNECTOR_MODE=live` toggle already wired
- `.env.example` lists every key the scaffold reads, with source-of-truth docs
- `run.sh --mock` / `--smoke` / `--eval` subcommands pre-wired
- Observability events land in stdout as JSONL by default; swap for Honeycomb/
  Langfuse/OTel by editing `observability.py` in one place
- README has a "When to come back to attrition" section: only if the workflow
  changes fundamentally (new lane, new runtime), not for incremental edits

### UX requirements for this checkpoint
Not all of this is the web app — much is the emitted README + scripts:
- Deploy template per lane (the 12 lanes × 6 runtime combos means at most
  ~12 deploy recipes — not 72 — because deploy target is mostly
  lane-determined)
- `_live_<tool>.py` stubs have a commented-out working example from the docs
  of each target API (Slack SDK, Postgres via asyncpg, Stripe SDK, etc.)
- `./run.sh --smoke` lives in the emitted bundle and runs ONE real request
  with live connectors — this is the "does my prod setup actually work"
  test

### Missing bits
- Per-lane deploy template docs (biggest gap — need a one-pager per lane)
- `_live_*.py` stubs currently empty; need working skeleton per common tool
- `./run.sh --smoke` subcommand not implemented
- `.attrition/provenance.json` missing → no way to warn user of SDK drift
  later

---

## What exists vs what's missing (punch list)

| Checkpoint | Shipped | Missing |
|---|---|---|
| 5 min  | Architect + classifier + lane card + Interpretive Boundary | honest low-confidence rendering, "time to first correction/accept" telemetry |
| 15 min | agent_loop + runtime adapters + 9-layer bundle + gate banner + Files tab | sandboxed `run.sh --mock` exec in Preview, deterministic/majority-vote for LLM-judged gates |
| 30 min | Download ZIP button, zip gen, gate-gating | refine-specific-file chat loop, diff view, `.attrition/provenance.json`, explicit "this matches" checkbox |
| 60 min | mock/live toggle, .env.example, run.sh skeleton | per-lane deploy templates, `_live_<tool>.py` working skeletons, `run.sh --smoke`, SDK-drift nudge |

## How this connects to the eval framework

The 60-row `attrition_eval_template_v1.csv` validates the **15-min checkpoint**
(scaffold compiles, nine layers present, gates green). It does NOT validate
30-min or 60-min checkpoints.

- **Layer 1 (structural)** — `attrition_eval_template_v1.csv` 60 rows. ✅ Ships now.
- **Layer 2 (live integration)** — ~15 new cases: pip_install_succeeds,
  integration_drop_in_{next,django,fastapi}, modification_survives,
  adversarial_fuzzing, semver_bump_simulation. Validates the **60-min
  checkpoint**. 1-2 days to build.
- **Layer 3 (user telemetry)** — instrument Download ZIP button + `./run.sh
  --smoke` callback. Measures **actual checkpoint hit rate per user**: what %
  reach 5 min, % reach 15, % reach 30, % reach 60. ~2 hours to wire.

Once we have 90 days of Layer 3 data, we can correlate: "users whose 15-min
gate verdict was green shipped to prod 3× more often than those with red
gates" — which tells us the gates actually predict user outcomes, not just
scaffold regression.

## The honest product framing

> "Five minutes to 'you get my problem.' Fifteen minutes to 'this is the
> scaffold I would have written.' Thirty minutes to 'I've refined it, I've
> verified it, I'm downloading this exactly once.' Sixty minutes to 'this is
> responding to real traffic in production.' Clone once. Own it forever. Come
> back only when the workflow fundamentally changes."

That's the contract. Everything in the product gates back to one of those
four moments.
