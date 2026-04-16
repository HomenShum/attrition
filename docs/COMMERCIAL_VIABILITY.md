# attrition.sh — Commercial Viability Analysis

## Market Context (April 2026)

- Model API spending: **$3.5B → $8.4B** in 12 months (2.4x)
- Enterprise LLM market projected: **$71.1B by 2034**
- Agent platforms: **$750M category** within horizontal AI
- AI observability funding: Braintrust $80M Series B ($800M val), Langfuse acquired by ClickHouse ($15B)
- Anthropic Advisor Strategy: **official API pattern** launched April 9, 2026

## Competitive Landscape

| Player | What They Do | Funding | Weakness |
|--------|-------------|---------|----------|
| **Braintrust** | Observability + evals | $80M Series B | General-purpose, no advisor-specific tooling |
| **Langfuse** | Open-source tracing | Acquired by ClickHouse | Traces everything, optimizes nothing |
| **Helicone** | AI gateway + caching | Growing | Gateway = infrastructure, not workflow intelligence |
| **LiteLLM** | Proxy + spend tracking | Open source | Tracks cost, doesn't reduce it |
| **AgentOps/TokenCost** | Monitoring + estimates | Seed-stage | Estimates, not measurements. No optimization loop |
| **Maxim AI** | Testing + observability | Series A | Focused on eval, not cost optimization |

### Key insight: Everyone tracks cost. Nobody optimizes the advisor pattern.

The advisor pattern (launched April 9, 2026) is Anthropic's official answer to "agents are too expensive." But there's no tooling to:
1. Measure if the pattern is actually saving money
2. Detect when escalation should have happened but didn't
3. Compare sessions with vs without advisor
4. Prove ROI to engineering leadership

## attrition.sh Wedge

**"The cost optimization layer for the advisor pattern."**

Not another observability platform. Not another LLM proxy. A focused tool that answers one question: **"Is your advisor pattern actually saving money?"**

### Why this wedge works:

1. **Timing** — Anthropic launched the advisor API 6 days ago. Every Claude Code user is about to experiment with it. They'll need measurement.

2. **Specificity beats generality** — Braintrust tracks everything for everyone. attrition.sh tracks one thing perfectly: executor vs advisor cost splits. Specialists win in early markets.

3. **The buyer exists** — Engineering managers who just got a $50K/month LLM bill. The advisor pattern promises 60-80% savings. They need proof.

4. **Distribution is solved** — Claude Code plugin installs in 30 seconds. `pip install attrition` patches existing code. No infrastructure changes.

## Three Monetization Paths

### Path 1: Developer Tool (SaaS) — $0 → $29 → $99/mo

| Tier | Price | What |
|------|-------|------|
| Free | $0 | 1K tracked calls/day, 7-day retention, 1 project |
| Pro | $29/mo | 50K calls/day, 90-day retention, unlimited projects |
| Team | $99/seat/mo | Unlimited calls, 1-year retention, team dashboard, budget alerts |
| Enterprise | Custom | SSO, VPC deployment, audit logs, SLA |

Revenue math: 1,000 teams × $99/seat × 3 seats avg = **$297K MRR** = **$3.6M ARR**

### Path 2: Infrastructure (Usage-Based) — per million tracked tokens

| Volume | Price |
|--------|-------|
| First 10M tokens/mo | Free |
| 10M - 1B tokens/mo | $0.10 per million tracked |
| 1B+ tokens/mo | $0.05 per million tracked |

Revenue math: 500 companies × 100M avg tokens/mo × $0.10 = **$5M MRR**

### Path 3: Advisory Optimization API — performance fee

Charge a percentage of PROVEN savings:
- attrition measures: baseline cost (Opus-only) vs optimized cost (advisor pattern)
- Customer pays 10% of measured savings
- Aligned incentives: attrition only earns when customer saves

Revenue math: 100 enterprises × $50K avg savings/mo × 10% = **$500K MRR**

## Go-To-Market

### Phase 1: Developer adoption (Month 1-3)
- Ship to Claude Code plugin marketplace
- Ship to npm/pip registries
- Write "How to measure your advisor pattern savings" blog post
- Post on HN, Reddit r/ClaudeAI, Twitter
- Target: 500 installs, 50 active projects

### Phase 2: Content + community (Month 3-6)
- Publish weekly "Advisor Pattern Benchmark Report" with anonymized data
- Open-source the scanner + auto-instrumentation (keep analytics SaaS)
- Sponsor Claude Code community events
- Target: 2,000 installs, 200 active projects, first paying customer

### Phase 3: Team features (Month 6-12)
- Team dashboard with role-based access
- Budget enforcement (alert when advisor cost share exceeds threshold)
- Integration with Slack/Discord for cost alerts
- Target: 50 paying teams, $15K MRR

### Phase 4: Enterprise (Month 12+)
- Self-hosted deployment option
- SOC2 compliance
- Custom model routing recommendations
- Target: 10 enterprise contracts, $100K+ MRR

## Defensibility

### Moat 1: Advisor-specific intelligence
Every session through attrition builds a dataset of:
- Which escalation triggers are most cost-effective
- Which models pair best (executor + advisor)
- At what token threshold escalation becomes worth it
- Industry-specific patterns (fintech agents vs devtools agents)

This dataset compounds. After 10,000 sessions, attrition can recommend: "For your codebase, use Haiku executor + Sonnet advisor (not Opus). Escalation threshold: 8,000 tokens. Expected savings: 72%."

### Moat 2: Measurement = trust
Competitors estimate. attrition measures. Every number comes from real API usageMetadata. This is the "unattackable" brand position.

### Moat 3: Zero-friction install
Plugin + pip package + auto-instrumentation means attrition is running before the user reads the docs. Braintrust requires SDK integration. Langfuse requires trace instrumentation. attrition requires `pip install attrition && python -c "import attrition; attrition.track()"`.

## Risks and Mitigations

| Risk | Probability | Mitigation |
|------|------------|------------|
| Anthropic builds this into Claude Code natively | High (12-18mo) | Be the third-party standard before they do. They'll build basic, we'll build deep. |
| Braintrust adds advisor tracking | Medium (6-12mo) | Move faster. They have $80M but move like a $800M company. Ship weekly. |
| Advisor pattern doesn't get adopted | Low | Already in the API docs. Every cost-conscious team will try it. |
| Free tier is too generous | Medium | Track engagement. Convert when teams hit 50K calls/day. |
| Enterprise won't trust a small vendor | High | Open-source the core. Sell the hosted service + enterprise features. |

## What to Build Next (Priority Order)

1. **Advisor pattern benchmark report** — Run 100 real sessions, publish measured savings. This IS the marketing.
2. **Budget enforcement** — "Alert me when advisor cost share exceeds 40%." This is the team sale.
3. **Model pairing recommendations** — "Based on 10K sessions, Haiku + Sonnet saves 20% more than Sonnet + Opus for your workload." This is the moat.
4. **Comparison view** — Side-by-side: same task, with advisor vs without. Screenshot-worthy output.
5. **Slack/Discord bot** — Daily cost summary. "Yesterday: 142 sessions, $23.50 total, 78% savings vs Opus-only."

## One-Line Pitch

**"attrition.sh — know if your advisor pattern is actually saving money. Measured, not estimated."**
