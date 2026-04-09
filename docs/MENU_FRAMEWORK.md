# attrition.sh — Product Menu Framework

## The Signature Dish

**"Your agent says it's done too early. We catch what it missed."**

Not "workflow intelligence platform." Not "distillation engine." One clear sentence that every developer has felt.

---

## The Menu (what you can buy)

### 1. Workflow Judge — Free
*See what the agent did, what it missed, and whether it should have stopped.*

- Always-on hooks (on-prompt, on-tool-use, on-stop, on-session-start)
- 8-step completion scoring
- CORRECT / PARTIAL / ESCALATE / FAILED verdicts
- Block incomplete work before it ships

**Appetite line:** "Stop re-explaining the same steps every time."

### 2. Replay Kit — Free
*Capture one expensive workflow and replay it cheaper.*

- Capture Claude Code / Cursor / OpenAI sessions as canonical events
- 4-strategy distillation (45% average compression)
- Replay on Sonnet at $2,402 instead of $4,368

**Appetite line:** "Run once on Opus. Replay forever on Sonnet."

### 3. Run Anatomy — Free
*See exactly what your agent did, tool by tool.*

- 560-event tool timeline with color-coded types
- Step evidence grid (which of 8 workflow steps had tool-call proof)
- Cost breakdown (input vs output tokens)
- Correction detection

**Appetite line:** "See exactly what your agent skipped."

### 4. Cloud Dashboard — $19/mo (coming soon)
*Traces, missing steps, verdicts, and savings across your whole team.*

- Team workflow library
- Shared enforcement policies
- Compliance dashboard
- Priority support

**Appetite line:** "Turn 'you forgot the flywheel' into an automatic check for everyone."

---

## The Tasting Menu (first-run experience)

1. `curl -sL attrition.sh/install | bash` (30 seconds)
2. Run one Claude Code task — hooks fire automatically
3. `bp workflows` — see the captured workflow
4. Visit attrition.sh/anatomy — see the tool timeline
5. See what the judge would have caught
6. `bp distill --target sonnet-4-6` — see the savings

**Time to value: 60 seconds.**

---

## Customer Archetypes

### The Engineer
Pain: "I keep telling Claude to run the tests. It keeps forgetting."
Menu item: Workflow Judge
First words: "Catch skipped steps and replay repeated workflows cheaper."

### The Tech Lead
Pain: "I can't see what our agents are actually doing across the team."
Menu item: Cloud Dashboard
First words: "See what happened, what was missed, and where the savings came from."

### The Founder
Pain: "We're burning $4K/session on Opus for repeated workflows."
Menu item: Replay Kit + Distillation
First words: "Turn repeated expensive AI work into reusable operating leverage."

---

## Proof Board

| Proof | Data |
|-------|------|
| Flagship benchmark | 560 tool calls, 8/8 steps, judge verdict CORRECT |
| Distillation savings | 290M → 160M tokens (45%), saves $1,965/replay |
| Real session | 42-hour build of attrition.sh itself |
| Tech depth | 12 Rust crates, 87 tests, 15K lines |
| Provider coverage | 7 runtime wrappers (OpenAI, Anthropic, LangChain, CrewAI...) |

---

## House Style

- **Sharp.** Every number is real, sourced from actual sessions.
- **Receipts.** Show the trace, show the verdict, show the cost.
- **Dark + terracotta.** Glass cards, JetBrains Mono, #d97757 accent.
- **No magic.** "Here's what happened. Here's what was missed. Here's the savings."

---

## Compound Loop: attrition × NodeBench

```
NodeBench build session
    → attrition captures workflow (560 tool calls)
    → judge scores (8/8 CORRECT)
    → learner records patterns
    → next session: judge auto-enforces
    → distill: replay at 45% less
    → NodeBench ships faster
    → attrition gets more proof data
    → attrition improves
    → NodeBench benefits
    → ...
```

This is the HyperAgents pattern: the product improves itself by using itself. The task agent (NodeBench) and the meta agent (attrition) are the same loop.

---

## What the homepage should be (not is)

**Current:** 7 sections, technical, explains the kitchen
**Target:** 3 sections, appetizing, shows the menu

### Section 1: Signature + Install
> Your agent says it's done too early. We catch what it missed.
> `curl -sL attrition.sh/install | bash`
> Free forever. Runs locally.

### Section 2: The Menu (3 cards)
> **Judge** — see what was missed
> **Replay** — do it cheaper next time
> **Anatomy** — see exactly what happened

### Section 3: The Proof
> 560 tool calls. 8/8 steps. Judge: CORRECT. 45% cheaper replay.
> Real data from a real build. [See the anatomy →]
