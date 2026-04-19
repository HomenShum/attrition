# Benchmark Strategy — interpreting the Vellum Opus 4.7 analysis into our design

## What Vellum actually says (raw numbers that matter)

Source: [Vellum: Claude Opus 4.7 Benchmarks Explained](https://www.vellum.ai/blog/claude-opus-4-7-benchmarks-explained) + [Anthropic Advisor Strategy blog](https://claude.com/blog/the-advisor-strategy) + [Artificial Analysis Opus 4.7](https://artificialanalysis.ai/articles/opus-4-7-everything-you-need-to-know).

### The benchmarks Vellum says PREDICT production quality

| Benchmark | Opus 4.7 | What it measures | Why it matters for us |
|-----------|----------|------------------|----------------------|
| **SWE-bench Pro** | 64.3% (vs GPT-5.4 57.7%, Gemini 3.1 Pro 54.2%) | Real open-source repo issues, 4 languages, unit-test pass | Ground truth via tests — no judge subjectivity |
| **SWE-bench Verified** | 87.6% (from 80.8%) | Human-verified SWE-bench subset | Standard reference |
| **SWE-bench Multilingual** | — | Where the advisor pattern was measured | **Sonnet+Opus advisor: +2.7pp at −11.9% cost** |
| **Terminal-Bench 2.0** | 69.4% | Shell/devops/debugging command-line tasks | Tests the harness, not the LLM |
| **MCP-Atlas** | 77.3% (best in class) | Multi-tool orchestration | **Exactly our distillation target** |
| **OSWorld-Verified** | 78.0% | Computer use (GUI) | Long-horizon tool use |
| **CursorBench** | 70% (from 58%) | IDE-integrated autonomous coding | Real editor environment |
| **GDPval-AA** | Anthropic leads | 44 occupations × 9 industries | Cross-domain production agents |
| **GPQA Diamond** | 94.2% | Graduate science reasoning | Near-saturated at frontier |
| **BrowseComp** | 79.3% (DOWN from 83.7%) | Web research | Haiku+Opus advisor = 41.2% (2× Haiku solo 19.7%) |

### Advisor pattern benchmark data (the key evidence)

From Anthropic's advisor post, verified by Vellum:

| Pairing | Delta vs solo executor | Cost delta |
|---------|-----------------------|-----------|
| Sonnet executor + Opus advisor | **+2.7pp SWE-bench Multilingual** | **−11.9%** cost |
| Haiku executor + Opus advisor on BrowseComp | **19.7% → 41.2% (+21.5pp, ~2×)** | 85% cheaper than Sonnet solo but 29% lower quality |

**Implication**: weaker executors benefit MORE from advisor scaffolding. Our V3 tested weak + skill and saw +13.3pp — consistent with the Anthropic pattern. Scaffolding helps weak models more than mid models.

### Cost levers Vellum emphasizes that we missed

| Lever | Savings | V3 relevance |
|-------|---------|--------------|
| Prompt caching | **up to 90%** on repeated context | Our skill should be in CACHED system prompt, not per-query prefix |
| Batch API | **50%** off for non-realtime | Replay evaluation workflows qualify |
| Model tier routing | 92% of strong's quality at 6% cost (our V3) | Confirmed independent of advisor pattern |

### Vellum's methodology recommendation (verbatim guidance)

> "Run your existing eval suite against: (1) Sonnet solo, (2) Sonnet executor with Opus advisor, (3) Opus solo."

Three-way comparison on YOUR workload, not synthetic benchmarks. That is exactly attrition's measurement product — measure the user's real queries under three configurations, show the cost-quality tradeoff.

## What this changes in our design

### 1. Kill MMLU-Pro as our main benchmark

MMLU-Pro is multiple choice. Real agents run tools and produce code. Our V3 used MMLU-Pro and got a misleading signal (mid tier wins). That's a property of one-shot QA, not production agent workloads.

**Replace with**:
- **SWE-bench Verified subset** (20 tasks, unit-test verified) — deterministic pass/fail
- **MCP-Atlas style tool-use scenarios** — matches our distillation target exactly
- **Terminal-Bench 2.0 subset** — command-line multi-step

All three have objective scoring (tests pass, tool calls succeed, goal reached). No judge bias.

### 2. Target Haiku as executor, not Flash

Vellum data: Haiku benefits 2× from Opus advisor. Our V3 used gemini-2.5-flash-lite (weakest). But the cross-vendor comparison suggests:
- If we're scaffolding a Claude stack: Haiku executor + distilled Opus workflow
- If we're scaffolding a Gemini stack: gemini-2.5-flash-lite executor + distilled Pro workflow

Bigger capability gap = bigger scaffolding uplift = stronger wedge evidence.

### 3. Fix the cost-overhead problem with prompt caching

V3's skill prompt added ~900 input tokens per query, killing cost savings. The fix: put the skill in a **cacheable system prompt**. At Anthropic's 90% cache discount, the skill cost drops from 100% overhead to 10% overhead — transforming the economics.

Concretely, the V4 experiment must:
- Use Anthropic or Gemini prompt caching API
- Measure actual cached-input cost, not prefill cost
- Compare against uncached baseline to prove the lever works

### 4. Replay judge must support unit-test verification

Current design (V3) used text similarity + Pro-as-judge. SWE-bench Pro shows the right pattern: run the generated patch, check if unit tests pass. Our replay judge must support:

- **Deterministic gate**: did the generated code pass user's test suite?
- **Tool-call parity**: did the cheap runtime invoke the same tools as the expensive one?
- **Cost delta**: measured from real API tokens (we already have this)

Text similarity is noise. Unit-test pass is truth.

### 5. The distillation pipeline should emit per-workflow benchmarks

When a user distills a workflow, attrition should auto-generate:
- A small eval set of 5-10 variants of that workflow
- Run all three configs (executor solo, executor+advisor, advisor solo) on the eval set
- Produce a three-way comparison card like Vellum's tables
- Ship as the user's "proof artifact" for manager/CFO review

This is the commercial artifact — not our synthetic demo data, but the user's actual workload measured three ways with real numbers.

## V4 experiment design (updated)

### Target
Replace MMLU-Pro multiple-choice with SWE-bench Verified subset (20 tasks).

### Configurations (4)
1. **Weak alone** — Haiku or gemini-2.5-flash-lite
2. **Mid alone** — Sonnet or gemini-3.1-flash-lite-preview
3. **Strong alone** — Opus 4.7 or gemini-3.1-pro-preview
4. **Weak + distilled workflow** — the scaffolded orchestrator-worker runtime, NOT a text skill

### Scoring
- **Primary**: SWE-bench unit-test pass rate (deterministic)
- **Secondary**: cost per task (measured API tokens)
- **Tertiary**: tool-call parity vs strong model's trace

### Success criteria
- **WEDGE CONFIRMED** if: weak+scaffold ≥ 80% of strong pass rate at ≤ 40% cost
- **PARTIAL** if: weak+scaffold ≥ 60% of strong pass rate at ≤ 50% cost
- **REJECTED** otherwise — fold back to routing-only product

### Dataset sources
- SWE-bench Verified: [princeton-nlp/SWE-bench_Verified](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified) (HuggingFace)
- MCP-Atlas: not publicly released yet — build 10-task proxy using real MCP servers
- Terminal-Bench 2.0: [terminal-bench](https://www.tbench.ai/) (Warp's benchmark)

## What stays the same

The distillation-as-a-service pipeline from DISTILLATION_AS_A_SERVICE.md is unchanged. The benchmarks change, not the architecture. The architecture still targets:

- Trace capture via MCP plugin
- WorkflowSpec extraction by distiller
- SDK-agnostic scaffold generation
- Visible replay runtime on attrition.sh
- Measured cost+quality delta card

What changes: the EVIDENCE we publish shifts from MMLU-Pro scores to SWE-bench-style unit-test pass rates + real-workload three-way comparisons.

## References

- [Vellum: Claude Opus 4.7 Benchmarks Explained](https://www.vellum.ai/blog/claude-opus-4-7-benchmarks-explained)
- [Anthropic: The Advisor Strategy](https://claude.com/blog/the-advisor-strategy)
- [Artificial Analysis Opus 4.7 deep dive](https://artificialanalysis.ai/articles/opus-4-7-everything-you-need-to-know)
- [SWE-bench Verified on HuggingFace](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified)
- [Terminal-Bench](https://www.tbench.ai/)
- [Finout: Opus 4.7 real cost story](https://www.finout.io/blog/claude-opus-4.7-pricing-the-real-cost-story-behind-the-unchanged-price-tag) — prompt caching + batch API details
