# User Workflow Gap Analysis: Why Would Anyone Use attrition.sh?

## What developers ACTUALLY do with Claude Code in 2026

Based on [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code), [agent-skills](https://github.com/addyosmani/agent-skills), [awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills), and [Claude Code common workflows docs](https://code.claude.com/docs/en/common-workflows):

### Top 5 daily workflows:
1. **Code review + PR creation** — review code, write tests, create PR
2. **Debugging** — find bug, reproduce, fix, verify
3. **Feature implementation** — spec → implement → test → ship
4. **Refactoring** — rename, restructure, migrate patterns
5. **Research + context gathering** — search docs, read code, understand system

### What the ecosystem already provides:
- **135 agents** in awesome-claude-code-toolkit
- **1000+ skills** in awesome-agent-skills
- **20+ hooks** people have written
- **Hermes Agent** with self-improving skill memory (FTS5, 10ms lookup)
- **Addy Osmani's agent-skills** with test-driven-dev, code-reviewer, security-auditor

## The honest question: does attrition.sh solve a REAL gap?

### What the ecosystem DOES have:
- Skills for every workflow (test, review, debug, implement, deploy)
- Hooks for quality gates (lint checks, test enforcement)
- Memory tools (Supermemory, claude-mem, Hermes self-evolving skills)
- Multi-agent orchestration (Teams, Swarms, parallel agents)

### What the ecosystem does NOT have:
1. **Measured cost per workflow** — nobody tells you "this workflow cost $1.84 and took 8m12s"
2. **Before/after proof** — nobody shows "run 1 cost X, replay cost Y, savings Z%"
3. **Cross-session workflow replay** — skills are instructions, not recorded executions
4. **Workflow completion judgment** — hooks can check lint, but nobody checks "did you follow the 7-step process?"
5. **Correction learning** — nobody captures "you forgot X" and tightens enforcement next time

## Where attrition.sh fits in the user journey

The average Claude Code power user already has:
- CLAUDE.md with their rules
- 3-5 installed skills
- Maybe a few hooks
- Maybe Supermemory for context

**They DON'T have:**
- Any idea what their workflows cost
- Any way to replay a successful workflow cheaper
- Any enforcement that their multi-step process was fully followed
- Any proof that their repeated workflows are getting faster/cheaper over time

## What attrition.sh's landing page should communicate in 10 seconds

NOT: "We catch when agents skip steps" (too abstract, sounds like another quality gate)
NOT: "Always-on judge for AI agents" (sounds like enterprise monitoring)
NOT: "Workflow memory + distillation" (sounds like a research project)

### What it SHOULD say:

> **Know what your Claude Code sessions actually cost.
> Replay the good ones cheaper.**
>
> attrition wraps your agent sessions, measures real cost and latency,
> and helps you replay successful workflows at 60-80% lower cost.
>
> [See a real run: $1.84 → $0.27]

### Why this works:
1. **Immediately relatable** — every CC user wonders "how much am I spending?"
2. **Concrete value** — "$1.84 → $0.27" is a number, not a concept
3. **Easy to try** — "wrap your session" is one step
4. **Builds on existing workflow** — doesn't replace their skills/hooks/memory

## The 3 user scenarios that sell attrition

### Scenario 1: "What did that cost?"
User runs a complex Claude Code session (refactor, feature build, research).
**Without attrition:** No idea what it cost. Just sees a monthly bill.
**With attrition:** "That session: 12 minutes, $1.84, 47 tool calls, 6 sources."

### Scenario 2: "I do this every sprint"
User runs the same deploy/test/review workflow every sprint.
**Without attrition:** Pays frontier price every time. Re-discovers the same steps.
**With attrition:** "Replayed last sprint's workflow. Same quality. $0.27 instead of $1.84."

### Scenario 3: "Did it actually do everything?"
User asked for a 7-step process. Agent said "Done!" after 4 steps.
**Without attrition:** User discovers the gap manually, re-explains.
**With attrition:** "3 of 7 steps missing. Blocked until complete."

## What the Captured Runs page should show

NOT abstract "pipeline runs" — those are internal NodeBench concepts.

INSTEAD: show workflows that map to what CC users actually do:

| Workflow | Duration | Cost | Replay Cost | Savings |
|----------|----------|------|-------------|---------|
| API client refactor | 8m 12s | $1.84 | $0.27 | 85% |
| Add auth tests | 4m 30s | $0.92 | $0.15 | 84% |
| Deploy to production | 2m 15s | $0.41 | $0.08 | 80% |
| Competitive analysis | 6m 45s | $1.52 | $0.22 | 86% |
| Bug fix + PR creation | 3m 20s | $0.68 | $0.11 | 84% |

**Every row: a real workflow that a real developer would recognize.**

## Competitive positioning (honest)

| Tool | What it does | attrition's relationship |
|------|-------------|------------------------|
| **Skills** (agent-skills, awesome-skills) | Tell the agent HOW to work | attrition measures whether it DID the work |
| **Hooks** (lint, test, format) | Check code quality gates | attrition checks workflow completion |
| **Memory** (Supermemory, claude-mem) | Remember context | attrition remembers + replays entire workflows |
| **Hermes Agent** | Self-evolving skills | attrition is self-improving workflow replay |
| **CLAUDE.md** | Static rules | attrition is dynamic enforcement + measurement |

## Sources
- [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)
- [agent-skills by Addy Osmani](https://github.com/addyosmani/agent-skills)
- [awesome-agent-skills (1000+)](https://github.com/VoltAgent/awesome-agent-skills)
- [Claude Code common workflows](https://code.claude.com/docs/en/common-workflows)
- [Claude Code 2026 daily OS](https://medium.com/@richardhightower/claude-code-2026-the-daily-operating-system-top-developers-actually-use-d393a2a5186d)
- [awesome-claude-code-toolkit (135 agents)](https://github.com/rohitg00/awesome-claude-code-toolkit)
