# Why Would Anyone Come to attrition.sh?

The honest answer, grounded in what developers are actually screaming about right now.

## The Pain (from real GitHub issues + Reddit + dev blogs, April 2026)

### Pain 1: "My agent burned $55 and I couldn't stop it"

> "Background agents wasted approximately 1,415,373 tokens (~$55-106 USD).
> Claude acknowledged that 'Background agents cannot be stopped' and that
> its claim of being able to stop them 'was a lie.'"
> — [GitHub #41461](https://github.com/anthropics/claude-code/issues/41461)

> "A sub-agent got stuck in an infinite loop, repeatedly executing the same
> failing command approximately 300+ times until it timed out after ~4.6 hours."
> — [GitHub #15909](https://github.com/anthropics/claude-code/issues/15909)

> "A stuck agent burned 16+ million tokens (~$30+) doing redundant work."
> — [GitHub #13996](https://github.com/anthropics/claude-code/issues/13996)

### Pain 2: "I have no idea where my tokens went"

> "Claude Code provides no in-session cost feedback, leaving developers on
> pay-per-token API plans blind until they check their billing dashboard."
> — [Verdent AI](https://www.verdent.ai/guides/claude-code-pricing-2026)

> "The subscription model has one real frustration: you can't see where your
> tokens go."
> — [Product Compass](https://www.productcompass.pm/p/claude-code-pricing)

> "Claude Code v2.1.100 silently adds ~20,000 invisible tokens to every
> single request."
> — [Efficienist](https://efficienist.com/claude-code-may-be-burning-your-limits-with-invisible-tokens-you-cant-see-or-audit/)

### Pain 3: "70% of my agent's tokens are waste"

> "One developer tracked 42 agent runs on a FastAPI codebase and found
> 70% waste from reading too many files, failed attempts, and verbose
> tool output."
> — [Morph LLM](https://www.morphllm.com/ai-coding-costs)

> "Your AI Agent Might Be Wasting 97% of Its Tokens Reading Instructions
> It Never Uses."
> — [Medium](https://medium.com/@DebaA/your-ai-agent-is-wasting-97-of-its-tokens-reading-instructions-it-never-uses-f46582e57a9b)

> "AI coding agents use 99.4% input tokens because they lack persistent
> memory, and every turn requires re-reading the entire context."
> — [BSWEN](https://docs.bswen.com/blog/2026-03-10-ai-coding-context-window-problem/)

### Pain 4: "My limit runs out in 90 minutes instead of 5 hours"

> "Claude Code has been consuming tokens at abnormally high rates since
> March 23, 2026, with some users burning through their entire 5-hour
> session limit in under 90 minutes."
> — [MacRumors](https://www.macrumors.com/2026/03/26/claude-code-users-rapid-rate-limit-drain-bug/)

> "Even on the Max 20x plan at $200 per month, users report hitting their
> quota within hours."
> — [DevClass](https://www.devclass.com/ai-ml/2026/04/01/anthropic-admits-claude-code-users-hitting-usage-limits-way-faster-than-expected/5213575)

### Pain 5: "I can't justify this spend to my manager"

> "Organizations cannot accurately budget for AI tools or track ROI,
> teams may unknowingly use expensive models for simple tasks, and
> executives lack concrete data to justify AI tool investments."
> — [Cline Issue #4540](https://github.com/cline/cline/issues/4540)

> "CTOs and CFOs lack concrete data to justify AI tool investments."
> — Same issue, 47 upvotes

## What Exists Today (and why it's not enough)

| Tool | What it does | What it DOESN'T do |
|------|-------------|-------------------|
| **Claudetop** | Real-time token burn rate in terminal | Doesn't tell you what to CHANGE |
| **Tokemon** | Dashboard of per-project costs | Doesn't prevent the next runaway |
| **Tokscale** | CLI usage tracker across tools | Tracks, doesn't optimize |
| **LiteLLM** | Proxy with spend tracking | Requires infrastructure change, doesn't prescribe |
| **AgentOps** | Session monitoring + replays | Monitors, doesn't route or recommend |
| **Cline 3.8** | In-extension cost display | Cline-only, no cross-tool visibility |

### The gap they all share: DIAGNOSIS without PRESCRIPTION

Every tool answers "how much did I spend?"
Nobody answers "how should I have spent it?"

## Why attrition.sh — The Specific Answer

attrition.sh is NOT another cost dashboard. It answers three questions nobody else answers:

### Question 1: "Which of my agent calls should have used a cheaper model?"

After capturing your session, attrition classifies every LLM call:
- **Routine** (file reading, simple edits, tool dispatch) → should be executor (Sonnet/Haiku)
- **Complex** (architecture, debugging, multi-file reasoning) → justified advisor (Opus)

**Output**: "42% of your Opus calls were routine tasks. Route them to Sonnet. Estimated savings: $18.40/day."

This is what nobody else does. Claudetop shows you burned $30. attrition shows you $18.40 of it was unnecessary.

### Question 2: "Would the advisor pattern have caught this runaway?"

When an agent loops (GitHub issues #27281, #26171, #15909, #41461), attrition's judge detects:
- Same tool called 3+ times with similar args → escalation trigger
- Token count exceeding threshold without progress → budget gate
- Background agent diverging from task → stop signal

**Output**: "This session entered a 47-iteration loop at minute 12. An advisor gate at 8,000 tokens would have caught it. Cost saved: $29.50."

### Question 3: "Can I prove ROI to my engineering manager?"

attrition generates a weekly report:
```
WEEK OF APRIL 14, 2026
Sessions tracked: 142
Total measured cost: $234.50
Estimated cost without optimization: $892.00
Measured savings: $657.50 (73.7%)
Advisor escalations: 23 (16.2% of sessions)
Advisor effectiveness: 91.3% (21/23 resolved the issue)
Zero-correction sessions: 89.4%
```

Every number is MEASURED from real API token counts. Not estimated. Not projected. Measured.

## The Onboarding Path (why it's zero friction)

```
Developer hits Claude Code rate limit for the 3rd time this week
    ↓
Googles "why is Claude Code burning my tokens"
    ↓
Finds attrition.sh — "know where your tokens actually go"
    ↓
pip install attrition          ← 5 seconds, no infrastructure
    ↓
python -m attrition.scanner .  ← scans their codebase, finds LLM calls
    ↓
Claude Code reads the scan report, proposes advisor hooks
    ↓
One-liner: enable_advisor_tracking()
    ↓
Next session: attrition.sh/advisor shows real cost breakdown
    ↓
Developer sees "62% of Opus calls were routine → save $X/day"
    ↓
Shows manager the weekly report → justifies the tool spend
    ↓
Manager buys Team plan ($99/seat) for the engineering team
```

## What Triggers the First Visit

The developer comes to attrition.sh because of ONE of these moments:

1. **Rate limit hit** — "I ran out of Claude Code quota in 90 minutes AGAIN"
2. **Shock bill** — "My API bill was $65 when I expected $10"
3. **Agent loop** — "My background agent burned 1.4M tokens while I was at lunch"
4. **Manager asks** — "Can you show me what we're spending on AI tools?"
5. **Advisor curiosity** — "Anthropic just announced the advisor pattern, does it actually work?"

Each of these moments maps to a specific attrition.sh page:
- Rate limit → `/advisor` (shows model routing recommendations)
- Shock bill → `/improvements` (shows captured runs with real costs)
- Agent loop → `/proof` (shows how the judge catches loops)
- Manager asks → weekly report export
- Advisor curiosity → `/advisor` + `/benchmark`

## Competitive Positioning

**attrition.sh is not Datadog for LLMs.** That's Langfuse, Braintrust, Helicone.

**attrition.sh is not a cost dashboard.** That's Claudetop, Tokemon, Tokscale.

**attrition.sh is the advisor pattern optimizer.** It tells you:
- Which calls to route cheaper (prescription)
- When to escalate to expensive models (triggers)
- Whether the pattern is actually saving money (measurement)
- How to prove it to your manager (reporting)

## The One-Sentence Pitch

**"attrition.sh tells you which agent calls are wasting money and exactly how to stop it — measured from your real API usage, not estimates."**
