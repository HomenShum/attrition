## RETHINK REDESIGN APR 2026

### Why This Section Exists

We applied the same behavioral design principles that made Linear, Perplexity, ChatGPT, Notion, and Vercel feel premium — and found that both NodeBench and attrition.sh violate all five of them. This section is a permanent record of that audit and the execution plan.

### The 5 Principles We Violate

#### 1. VALUE BEFORE IDENTITY — time-to-wow < 5 seconds

**What premium products do**: ChatGPT has one text box. Perplexity has one search bar. Linear lets you create an issue in 3 seconds from Cmd+K. The first pixel IS the first action.

**What we do wrong**: Both products lead with explanation pages, competitive tables, feature cards, and navigation systems. The user must understand what we are before they can use us.

**Fix**: The first thing on screen must be the thing you do. For attrition: a scan input. For NodeBench: the Ask search bar. Everything else is below the fold.

#### 2. SPEED IS A FEATURE, NOT A METRIC

**What premium products do**: Linear renders in sub-50ms. ChatGPT streams responses so 3 seconds feels like watching someone think. Perplexity shows sources progressively.

**What we do wrong**: Attrition's chat panel has hardcoded fake delays. Cloud Run cold starts take 1-5s with no feedback. NodeBench's pipeline has no progressive streaming of answer sections. No skeleton loading on surface transitions.

**Fix**: Hard latency budgets — first visible response < 800ms, first source < 2s, first complete section < 5s. Progressive rendering, not batch reveals.

#### 3. THE OUTPUT IS THE DISTRIBUTION

**What premium products do**: Every ChatGPT conversation is a screenshot people share. Every Perplexity answer has a shareable URL with citations. TikTok watermarks videos for cross-platform sharing.

**What we do wrong**: Neither product generates shareable URLs for results. No screenshot-worthy artifact. No "send this to a colleague" moment.

**Fix**: Generate shareable result URLs (`/scan/:id`, `/report/:id`) that render without auth. Design result cards as screenshot-worthy single visuals.

#### 4. MEET USERS WHERE THEY ARE

**What premium products do**: Linear has Cmd+K everywhere. ChatGPT's absence of UI IS the UI. Products meet users in their existing workflow, not in a new navigation system.

**What we do wrong**: Attrition has 11 pages with 4+ nav tabs. NodeBench has 5 surfaces with sidebar + top nav + bottom nav. Users must learn a navigation system before getting value.

**Fix**: Make chat/search the primary surface. Everything reachable from one input. URL-based queries (`?q=` or `?scan=`) that skip all navigation.

#### 5. THE PRODUCT IMPROVES ITSELF

**What premium products do**: TikTok's algorithm gets better with every swipe. ChatGPT's memory makes later interactions more relevant. Notion AI fits into existing blocks.

**What we do wrong**: No visible learning in either product. The infrastructure exists (correction learner, Me context, workflow memory) but nothing in the UI says "I'm getting better for you."

**Fix**: Show "based on your previous N sessions" suggestions. Show correction learning visibly. Make returning users see personalized context that proves the product knows them.

### The Deeper Problem: Surface Sprawl

**attrition.sh**: 11 pages (Landing, Proof, Improvements, Get Started, Live, Workflows, Judge, Anatomy, Benchmark, Compare, Chat) for a product that does ONE thing — catch when agents skip steps. Should be 3 surfaces: scanner + chat + docs.

**NodeBench**: 5 surfaces (Ask, Workspace, Packets, History, Connect) plus Oracle, flywheel, trajectory, benchmark, and dogfood surfaces. The MCP server has 350+ tools across 57 domains. Should follow the Addy Osmani agent-skills pattern: each skill = ONE thing, ONE workflow.

### The MCP Bloat Problem

Both products have MCP tool registries that grew by accretion, not by design.

**NodeBench MCP**: 350+ tools, 57 domains, progressive discovery layers, analytics client, embedding index, dashboard launcher, profiling hooks — all in the boot path. Performance is self-benchmarked, not user-value-benchmarked.

**attrition MCP**: 12 tools where 6 would do. `bp.sitemap`, `bp.ux_audit`, `bp.diff_crawl`, `bp.workflow`, `bp.pipeline`, `bp.workflows` are sub-features of `bp.check` and `bp.capture`.

**What good looks like** (Addy Osmani's agent-skills):
- Each skill is ONE thing with ONE workflow
- README shows: what it does, how to use it, what you get
- No discovery layer — install what you want
- No 350-tool registry — 5 skills that each do 1 thing well

### Concrete Execution Board

| # | Principle | Fix | Metric to enforce | Ship order |
|---|-----------|-----|--------------------|------------|
| 1 | Value before identity | First pixel = input field, not explanation | Time from load to first action < 5s | Week 1 |
| 2 | Speed as feature | Progressive rendering, remove fake delays, hard latency budgets | First visible result < 800ms | Week 1 |
| 3 | Output = distribution | Shareable result URLs, screenshot-worthy cards | Every result has a shareable URL | Week 2 |
| 4 | Meet users where they are | Chat/search as primary surface, collapse nav | User can do everything from one input | Week 2 |
| 5 | Product improves itself | Visible learning, personalized suggestions | Returning user sees context from prior sessions | Week 3 |
| 6 | MCP discipline | Reduce to core tools, one workflow per skill | attrition: 6 tools. NodeBench: skill-based, not registry-based | Week 3 |

### Root Causes (from competitor analysis)

1. **One dominant job per screen** — Notion frames the problem as software sprawl. The fix is subtracting tools, not adding surfaces.
2. **Trust comes from visible reasoning, not decorative UI** — Linear and Perplexity build trust through transparent reasoning and cited sources, not bordered cards.
3. **Speed is product behavior, not backend optimization** — If it takes >200ms, make it faster. Premium feel comes from response cadence and zero hesitation.
4. **Quality is a system, not a cleanup sprint** — Linear has Quality Wednesdays (1,000+ small fixes) and zero-bugs policy (fix now or explicitly decline).
5. **The product gets more useful as it knows more context** — ChatGPT memory, Notion AI in existing blocks, Perplexity exportable artifacts.

### Quality Operating System (from Linear)

Without a permanent quality lane, the UI will drift back into inconsistency.

- **Weekly**: papercut pass — motion, spacing, hover, focus, empty-state review
- **Per-push**: no bug backlog dumping — bugs are fixed now or explicitly declined
- **Instrumented**: time-to-value metrics, not just render counts
  - `ask_submitted_at`
  - `first_partial_answer_at`
  - `first_source_at`
  - `first_saved_report_at`
  - `first_return_visit_at`

### The One-Line Version

**Both products should feel like Perplexity for their domain: one input, one answer, shareable results, visibly getting smarter.**

Not: multi-surface dashboards with competitive comparison tables and 350-tool registries.

### References

- [Linear on speed + transparent reasoning](https://linear.app)
- [Perplexity answer engine model](https://perplexity.ai)
- [Notion on software sprawl](https://notion.so)
- [Vercel virtual product tour](https://vercel.com)
- [ChatGPT memory + connected apps](https://openai.com)
- [Addy Osmani agent-skills](https://github.com/addyosmani/agent-skills)
- [Meta HyperAgents](https://hyperagents.agency/)
- [Linear Quality Wednesdays](https://linear.app/blog)
- [Linear Zero-bugs policy](https://linear.app/blog)
- Full audit: `docs/BEHAVIORAL_DESIGN_AUDIT.md`
