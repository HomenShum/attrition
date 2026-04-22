/**
 * agentEvaluator — Arize-AX-style LLM-as-judge evaluators for agent runs.
 *
 * Each evaluator is a named template (system prompt + user template + judge
 * model). Run against any agentRuns row via `runEvaluator` action; results
 * land in `agentEvaluationResults` and the /runs/:runId page subscribes.
 *
 * Patterns borrowed from Arize AX (arize.com/docs/ax/evaluate/evaluators):
 *   - Reusable named templates you apply to any trace
 *   - Numeric score + pass/fail verdict + one-sentence rationale
 *   - Auto-run on every completed run
 *
 * Bounded invariants:
 *   BOUND          rationale capped at 500 chars
 *   HONEST_STATUS  judge errors land as verdict="skip" with the error in rationale
 *   DETERMINISTIC  idempotent by (runId, evaluatorName) — re-runs overwrite
 *   BOUND_READ     spans summary capped at 2KB before sent to judge
 */

import { v } from "convex/values";
import { action, mutation, query } from "../../_generated/server";
import { api } from "../../_generated/api";

const MAX_RATIONALE = 500;
const MAX_SPANS_SUMMARY_CHARS = 2000;
const DEFAULT_JUDGE_MODEL = "claude-haiku-4-5";

const PRICING_PER_MILLION = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-opus-4-7": { input: 5.0, output: 25.0 },
} as const;

function costFor(model: string, inTok: number, outTok: number): number {
  const p =
    PRICING_PER_MILLION[model as keyof typeof PRICING_PER_MILLION] ??
    PRICING_PER_MILLION[DEFAULT_JUDGE_MODEL];
  return (inTok * p.input + outTok * p.output) / 1_000_000;
}

// ----------------------------------------------------------- queries

export const listEvaluators = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const rows = args.activeOnly
      ? await ctx.db
          .query("agentEvaluators")
          .withIndex("by_active_priority", (q) => q.eq("active", true))
          .take(50)
      : await ctx.db.query("agentEvaluators").take(100);
    return rows
      .sort((a, b) => b.priority - a.priority)
      .map((r) => ({
        _id: r._id,
        name: r.name,
        label: r.label,
        description: r.description,
        kind: r.kind,
        judgeModel: r.judgeModel,
        active: r.active,
        priority: r.priority,
        seeded: r.seeded,
        createdAt: r.createdAt,
      }));
  },
});

export const listResultsForRun = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agentEvaluationResults")
      .withIndex("by_runId_ranAt", (q) => q.eq("runId", args.runId))
      .take(50);
    rows.sort((a, b) => a.ranAt - b.ranAt);
    return rows.map((r) => ({
      _id: r._id,
      evaluatorName: r.evaluatorName,
      evaluatorLabel: r.evaluatorLabel,
      score: r.score,
      verdict: r.verdict,
      rationale: r.rationale,
      judgeModel: r.judgeModel,
      judgeInputTokens: r.judgeInputTokens,
      judgeOutputTokens: r.judgeOutputTokens,
      judgeCostUsd: r.judgeCostUsd,
      judgeElapsedMs: r.judgeElapsedMs,
      ranAt: r.ranAt,
    }));
  },
});

// ----------------------------------------------------------- upsert mutation

export const upsertEvaluator = mutation({
  args: {
    name: v.string(),
    label: v.string(),
    description: v.string(),
    kind: v.string(),
    systemPrompt: v.string(),
    userTemplate: v.string(),
    judgeModel: v.string(),
    active: v.boolean(),
    priority: v.number(),
    seeded: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentEvaluators")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique()
      .catch(() => null);
    const payload = {
      ...args,
      createdAt: existing?.createdAt ?? Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { name: args.name, status: "updated" as const };
    }
    await ctx.db.insert("agentEvaluators", payload);
    return { name: args.name, status: "created" as const };
  },
});

// ----------------------------------------------------------- result mutation

export const recordResult = mutation({
  args: {
    runId: v.string(),
    evaluatorName: v.string(),
    evaluatorLabel: v.string(),
    score: v.number(),
    verdict: v.string(),
    rationale: v.string(),
    judgeModel: v.string(),
    judgeInputTokens: v.number(),
    judgeOutputTokens: v.number(),
    judgeCostUsd: v.number(),
    judgeElapsedMs: v.number(),
  },
  handler: async (ctx, args) => {
    // Idempotent by (runId, evaluatorName)
    const existing = await ctx.db
      .query("agentEvaluationResults")
      .withIndex("by_runId_ranAt", (q) => q.eq("runId", args.runId))
      .filter((q) => q.eq(q.field("evaluatorName"), args.evaluatorName))
      .first();
    const payload = {
      runId: args.runId,
      evaluatorName: args.evaluatorName,
      evaluatorLabel: args.evaluatorLabel,
      score: Math.max(0, Math.min(1, args.score)),
      verdict: args.verdict,
      rationale: args.rationale.slice(0, MAX_RATIONALE),
      judgeModel: args.judgeModel,
      judgeInputTokens: args.judgeInputTokens,
      judgeOutputTokens: args.judgeOutputTokens,
      judgeCostUsd: args.judgeCostUsd,
      judgeElapsedMs: args.judgeElapsedMs,
      ranAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { status: "updated" as const };
    }
    await ctx.db.insert("agentEvaluationResults", payload);
    return { status: "inserted" as const };
  },
});

// ----------------------------------------------------------- main action

/**
 * Run ONE evaluator against a run. Fetches the run + its spans, fills the
 * evaluator's user template, calls Claude as judge, records the result.
 */
export const runEvaluator = action({
  args: {
    runId: v.string(),
    evaluatorName: v.string(),
  },
  handler: async (ctx, args): Promise<{ status: string; verdict?: string }> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { status: "skipped_no_key" };
    }

    const run = await ctx.runQuery(api.domains.daas.agentTrace.getRun, {
      runId: args.runId,
    });
    if (!run) return { status: "run_not_found" };

    const evaluator = await ctx.runQuery(api.domains.daas.agentEvaluator.getEvaluator, {
      name: args.evaluatorName,
    });
    if (!evaluator) return { status: "evaluator_not_found" };
    if (!evaluator.active) return { status: "evaluator_inactive" };

    const spans = await ctx.runQuery(api.domains.daas.agentTrace.listSpansForRun, {
      runId: args.runId,
    });

    // Build a compact spans summary — one line per span, capped at 2KB
    const lines: string[] = [];
    let total = 0;
    for (const s of spans) {
      const outPreview = s.outputJson.slice(0, 120).replace(/\s+/g, " ");
      const line = `  - [${s.kind}] ${s.name} ${s.costUsd ? `$${s.costUsd.toFixed(4)} ` : ""}${outPreview}`;
      if (total + line.length > MAX_SPANS_SUMMARY_CHARS) {
        lines.push(`  ... (${spans.length - lines.length} more elided)`);
        break;
      }
      lines.push(line);
      total += line.length;
    }
    const spansSummary = lines.join("\n");

    const userPrompt = evaluator.userTemplate
      .replace("{{RUN_INPUT}}", run.input.slice(0, 800))
      .replace("{{FINAL_OUTPUT}}", (run.finalOutput ?? "").slice(0, 1500))
      .replace("{{LANE}}", run.runtimeLane)
      .replace("{{DRIVER}}", run.driverRuntime)
      .replace("{{MODE}}", run.mode)
      .replace("{{SPAN_COUNT}}", String(run.totalSpans))
      .replace("{{TOTAL_COST}}", `$${run.totalCostUsd.toFixed(4)}`)
      .replace("{{SPANS_SUMMARY}}", spansSummary);

    const t0 = Date.now();
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: evaluator.judgeModel,
          max_tokens: 512,
          system: evaluator.systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      const t1 = Date.now();
      if (!res.ok) {
        const errText = await res.text();
        await ctx.runMutation(
          api.domains.daas.agentEvaluator.recordResult,
          {
            runId: args.runId,
            evaluatorName: evaluator.name,
            evaluatorLabel: evaluator.label,
            score: 0,
            verdict: "skip",
            rationale: `judge HTTP ${res.status}: ${errText.slice(0, 150)}`,
            judgeModel: evaluator.judgeModel,
            judgeInputTokens: 0,
            judgeOutputTokens: 0,
            judgeCostUsd: 0,
            judgeElapsedMs: t1 - t0,
          },
        );
        return { status: "judge_error" };
      }
      const data = (await res.json()) as {
        content: Array<{ type: string; text?: string }>;
        usage: { input_tokens: number; output_tokens: number };
      };
      const textBlock = data.content.find((c) => c.type === "text");
      const raw = textBlock?.text ?? "";
      const parsed = parseJudgeReply(raw);
      const costUsd = costFor(
        evaluator.judgeModel,
        data.usage.input_tokens,
        data.usage.output_tokens,
      );
      await ctx.runMutation(api.domains.daas.agentEvaluator.recordResult, {
        runId: args.runId,
        evaluatorName: evaluator.name,
        evaluatorLabel: evaluator.label,
        score: parsed.score,
        verdict: parsed.verdict,
        rationale: parsed.rationale,
        judgeModel: evaluator.judgeModel,
        judgeInputTokens: data.usage.input_tokens,
        judgeOutputTokens: data.usage.output_tokens,
        judgeCostUsd: costUsd,
        judgeElapsedMs: t1 - t0,
      });
      return { status: "recorded", verdict: parsed.verdict };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(api.domains.daas.agentEvaluator.recordResult, {
        runId: args.runId,
        evaluatorName: evaluator.name,
        evaluatorLabel: evaluator.label,
        score: 0,
        verdict: "skip",
        rationale: `judge threw: ${msg.slice(0, 200)}`,
        judgeModel: evaluator.judgeModel,
        judgeInputTokens: 0,
        judgeOutputTokens: 0,
        judgeCostUsd: 0,
        judgeElapsedMs: Date.now() - t0,
      });
      return { status: "judge_threw" };
    }
  },
});

export const getEvaluator = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("agentEvaluators")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique()
      .catch(() => null);
    if (!row) return null;
    return {
      _id: row._id,
      name: row.name,
      label: row.label,
      description: row.description,
      kind: row.kind,
      systemPrompt: row.systemPrompt,
      userTemplate: row.userTemplate,
      judgeModel: row.judgeModel,
      active: row.active,
      priority: row.priority,
      seeded: row.seeded,
    };
  },
});

/**
 * Run every active evaluator sequentially for a run.
 * Called at the end of liveAgent.runLiveAgent after finishRun.
 */
export const runAllActive = action({
  args: { runId: v.string() },
  handler: async (ctx, args): Promise<{ ran: number }> => {
    const evaluators: Array<{ name: string; active: boolean }> = await ctx.runQuery(
      api.domains.daas.agentEvaluator.listEvaluators,
      { activeOnly: true },
    );
    let ran = 0;
    for (const e of evaluators) {
      await ctx.runAction(api.domains.daas.agentEvaluator.runEvaluator, {
        runId: args.runId,
        evaluatorName: e.name,
      });
      ran++;
    }
    return { ran };
  },
});

// ----------------------------------------------------------- judge parser

type JudgeParse = { score: number; verdict: string; rationale: string };

function parseJudgeReply(raw: string): JudgeParse {
  // Expect the judge to reply with JSON: {"score": 0.87, "verdict": "pass", "rationale": "..."}
  // Tolerant parser: strip markdown, find first {, last }, try to parse.
  const trimmed = raw.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = trimmed.slice(first, last + 1);
    try {
      const obj = JSON.parse(slice) as Record<string, unknown>;
      const score =
        typeof obj.score === "number"
          ? obj.score
          : typeof obj.score === "string"
            ? Number(obj.score)
            : 0;
      const verdictRaw =
        typeof obj.verdict === "string" ? obj.verdict.toLowerCase() : "";
      const verdict =
        verdictRaw === "pass" ||
        verdictRaw === "fail" ||
        verdictRaw === "warn" ||
        verdictRaw === "skip"
          ? verdictRaw
          : score >= 0.75
            ? "pass"
            : score >= 0.5
              ? "warn"
              : "fail";
      const rationale =
        typeof obj.rationale === "string"
          ? obj.rationale
          : typeof obj.reason === "string"
            ? obj.reason
            : "(no rationale)";
      return {
        score: Math.max(0, Math.min(1, isNaN(score) ? 0 : score)),
        verdict,
        rationale: rationale.slice(0, MAX_RATIONALE),
      };
    } catch {
      /* fall through */
    }
  }
  // Fallback: treat raw as rationale, score=0, verdict=skip
  return {
    score: 0,
    verdict: "skip",
    rationale: `parse failed: ${raw.slice(0, 300)}`,
  };
}
