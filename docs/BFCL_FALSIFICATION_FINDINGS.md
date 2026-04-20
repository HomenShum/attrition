# BFCL v3 — Falsification Findings

## Purpose

Adversarial red-team of the claim made during the benchmark scaffolding work:

> "Gemini Flash Lite scores 90% on BFCL simple. The 10% gap is the distillation
> opportunity — distill scaffolds from Pro traces to close it."

Running that claim through falsification pressure revealed four findings
that partially refute it.

## Methodology

1. Repeat the baseline runs at larger n with `force_refresh=True` to eliminate
   cache-limited sample bias.
2. Inspect every failure and classify: `WRONG_FN` (capability), `WRONG_ARGS`
   (surface / coercion), `COUNT_DIFF` (structural), `NO_CALL` (executor gave up).
3. Probe the comparator itself (`_loose_eq`) for over-acceptance.
4. Run a no-tools control that must score 0%.
5. Run Pro head-to-head against Flash Lite on the same task set and compute
   shared-failure overlap.

All numbers are real runs against
`gorilla-llm/Berkeley-Function-Calling-Leaderboard` with live Gemini API
calls, `temperature=0`, `functionCallingConfig.mode = ANY`.

## Finding 1 — The initial numbers were within noise

Small-sample claims (n=50 simple, n=20 multiple/parallel):

| Category | rate (n=small) | Wilson 95% CI | halfwidth |
|---|---|---|---|
| simple | 90.0% (45/50) | [78.6%, 95.7%] | ±8.5pp |
| multiple | 85.0% (17/20) | [64.0%, 94.8%] | ±15.4pp |
| parallel | 85.0% (17/20) | [64.0%, 94.8%] | ±15.4pp |

After re-pulling at n=200/100/100 fresh:

| Category | rate (n=large) | Wilson 95% CI | halfwidth |
|---|---|---|---|
| simple | 93.0% (186/200) | [88.6%, 95.8%] | ±3.6pp |
| multiple | 90.0% (90/100) | [82.6%, 94.5%] | ±6.0pp |
| parallel | 86.0% (86/100) | [77.9%, 91.5%] | ±6.8pp |

**What this refutes:** the pass-rate point estimates (90 / 85 / 85) I led with
were within each other's confidence intervals. The n=50/20/20 sample was
insufficient to support a "10% gap" claim; halfwidths bigger than the gap.

**Corrected:** honest CIs require ≥ n=200 per category to talk about
single-digit percentage deltas.

## Finding 2 — Pro does NOT meaningfully outperform Flash Lite on BFCL

Head-to-head on the same tasks:

| Category | Flash Lite pass | Pro pass | delta | Shared failures |
|---|---|---|---|---|
| simple n=50 | 45 | 46 | +2.0pp | 4/5 |
| multiple n=30 | 25 | 26 | +3.3pp | 4/5 |
| parallel n=30 | 25 | 25 | 0.0pp | 5/5 |

**What this refutes:** the "distill Pro's scaffold to lift Flash Lite" thesis
assumes Pro is meaningfully above Flash Lite. **It is not — on BFCL.**
4–5 of every 5 failures are tasks *both* models fail. The remaining 0–1
tasks per sample is within Wilson halfwidth, not statistically distinguishable.

Cost ratio on short-tool tasks: Pro is only ~1.3× the cost of Flash Lite,
not the 100× ratio that would matter for a cost-vs-quality wedge.

**Corrected narrative:** BFCL is saturated for frontier tool-calling models.
The gap to distill against does not exist on this benchmark. To validate
"distill big-model scaffold → small-model lift" we need a benchmark where
Pro demonstrably beats Flash Lite by a wide, statistically-significant margin
(candidate: SWE-bench Verified, where model capability is known to diverge).

## Finding 3 — Failure modes are surface-syntax, not capability

Classified every failure in the n=200/100/100 pull:

| Category | WRONG_ARGS | WRONG_FN | COUNT_DIFF | NO_CALL |
|---|---|---|---|---|
| simple (n=200, 14 fails) | 14 | 0 | 0 | 0 |
| multiple (n=100, 10 fails) | 8 | 2 | 0 | 0 |
| parallel (n=100, 14 fails) | 11 | 0 | 3 | 0 |

Hand-inspection of `WRONG_ARGS` cases: **all 14 simple failures are math
expression formatting** — Flash Lite emits `x^2` when BFCL expects `x**2`
(Python exponent) or `lambda x: x**2`. No tool-choice error, no value error,
no ambiguity — a single surface-syntax convention.

Hand-inspection of `WRONG_FN` on multiple: 2/2 are reasoning errors
("delete columns" → picked `create_backup` instead of `modify_columns`).

Hand-inspection of `COUNT_DIFF` on parallel: 3/3 are "user asked for N
things, model emitted 1" (two theaters / four lawsuits / two derivatives).

**What this refines:** the failures are ~90% mechanical (notation + parallel
counting) and ~10% semantic (function disambiguation). A deterministic rule
layer on top of the executor could fix the mechanical 90% without ever
invoking a larger model. **This is NOT distillation — it's output postprocessing.**

## Finding 4 — Comparator was too lenient

`_loose_eq` accepted case-differences on strings
(`"san francisco" == "San Francisco"`). BFCL's reference AST checker is
case-sensitive. Tightening `_loose_eq` to numeric-coercion-only + whitespace-trim:

| Category | before | after |
|---|---|---|
| simple | 93.0% | 93.0% |
| multiple | 90.0% | 89.0% |
| parallel | 86.0% | 85.0% |

Small shift (1pp on two categories) but in the correct direction — my original
scorer inflated passes by accepting case-hand-waving. The local comparator is
now stricter on strings.

**No-tools control:** `10/10 tasks score 0%` when tool specs are stripped.
Confirms the scorer doesn't leak — if the model can't emit a call, it
deterministically fails every task.

## What stays true

- **BFCL is a ground-truth CI gate for tool-call parity.** That thesis
  survives — deterministic AST comparison against a public dataset is
  exactly the rigor the LLM-rubric judge lacks.
- **The adapter is honest.** No-tools control scores 0, golden scores 100,
  broken scores 0. Tests are 27 scenario-based cases covering happy / sad /
  adversarial / scale.
- **Cost per task is trivial** (~$0.00002 on Flash Lite, ~$0.00003 on Pro).
  Sweeps are cheap; n=1000 across categories would cost ~$0.04. Use bigger n.

## What has to change in the product narrative

The "distill Pro → Flash Lite" story **cannot** use BFCL as its proof point.
The head-to-head on the same tasks shows Pro's lead is within noise.

What BFCL *does* prove:
1. A deterministic comparator surfaces real mechanical failures (math notation,
   parallel counting) that the existing LLM-rubric judge would miss.
2. A rule-based output normalizer — NOT a distilled LLM scaffold — could
   close the 7–15% gap by rewriting `x^2 → x**2` and enforcing "one call per
   enumerated item."

The distillation lift story needs a different benchmark. Candidate fits:
- **SWE-bench Verified** — Pro meaningfully beats Flash Lite (≥30pp gap
  reported on the leaderboard). If a distilled scaffold closes any of that
  gap on a held-out subset, *that* is the sellable claim.
- **τ²-bench retail** — closer to FloorAI; tests tool chains against a
  stateful DB, where reasoning depth matters.

## Next actions (in order)

1. **Run SWE-bench Verified subset** (n=20 tasks) with both Pro and Flash
   Lite solo. Confirm the gap is real before claiming scaffold lift.
2. **Implement `MathExprNormalizer` + `ParallelCountEnforcer` as post-exec
   rules.** Re-run BFCL with Flash Lite + rules. Measured lift goes into
   `daasBenchmarkRuns` as a separate `sessionId` cohort so `getAggregates`
   can show solo vs solo+rules side-by-side.
3. **Only after (1) shows a real gap**, distill the Pro trace for the 5-10
   tasks where Pro wins and Flash Lite fails, generate a scaffold, replay,
   and measure. That's the distillation thesis, running against a benchmark
   where there's actually something to distill.

## Honesty appendix

Running this falsification surfaced three claims I had made with more
confidence than the data supported:

1. "Flash Lite scores 90% on simple" → tight CI was [78.6, 95.7] at n=50; the
   90.0% was a point estimate, not a tight number.
2. "The 10% gap is the distillation opportunity" → the gap is real but Pro
   doesn't meaningfully close it, so distillation isn't the mechanism.
3. "1/100th the cost of Pro" → on BFCL tool-call tasks the cost ratio is
   1.3×, not 100×. The 100× ratio applies to long-context generation, not
   short tool-call emission.

Claims held to tighter bar going forward:

- Numbers without Wilson CIs at n≥200 should not be stated as facts.
- Comparisons ("A beats B") require head-to-head on the same task set, not
  referenced leaderboards.
- Cost ratios stated in absolute terms ("100×") require empirical measurement
  on the task shape in question.
