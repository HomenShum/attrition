// Fidelity-measurement action surface.
//
// This is the Convex side of the "transfer tacit judgment from runtime
// to compile-time" system. Three mutations (register, record trial,
// record verdict) and three queries (list externalizations, latest
// verdicts, verdict history).
//
// Agentic reliability:
//   [BOUND]         artifactJson capped at 32KB; list queries capped at 500.
//   [HONEST_STATUS] Rejects unknown form / unknown verdict values.
//   [HONEST_SCORES] Verdict is always one of DAAS_TRANSFER_VERDICTS;
//                   no free-form verdict strings accepted.
//   [DETERMINISTIC] All stored fields are inputs or derivable — no
//                   random re-scoring on the server.

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import {
  DAAS_EXTERNALIZATION_FORMS,
  DAAS_TRANSFER_VERDICTS,
} from "./schema";

const MAX_ARTIFACT_BYTES = 32_000;

/**
 * Register (or upsert) an externalization artifact.
 *
 * Uses externalizationId as the stable key — re-registering the same id
 * updates the row. That way you can iterate on a prompt without
 * accumulating dead rows.
 */
export const registerExternalization = mutation({
  args: {
    externalizationId: v.string(),
    form: v.string(),
    artifactJson: v.string(),
    sourceModel: v.string(),
    sourceTraceIdsJson: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (
      !DAAS_EXTERNALIZATION_FORMS.includes(
        args.form as typeof DAAS_EXTERNALIZATION_FORMS[number],
      )
    ) {
      throw new Error(
        `unknown form ${args.form!}; expected one of ${DAAS_EXTERNALIZATION_FORMS.join(", ")}`,
      );
    }
    if (args.artifactJson.length > MAX_ARTIFACT_BYTES) {
      throw new Error(
        `artifactJson exceeds ${MAX_ARTIFACT_BYTES}B bound (${args.artifactJson.length}); store large artifacts elsewhere and reference by id`,
      );
    }
    const existing = await ctx.db
      .query("daasExternalizations")
      .withIndex("by_externalizationId", (q) =>
        q.eq("externalizationId", args.externalizationId),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        form: args.form,
        artifactJson: args.artifactJson,
        sourceModel: args.sourceModel,
        sourceTraceIdsJson: args.sourceTraceIdsJson,
        notes: args.notes,
      });
      return { id: existing._id, updated: true };
    }
    const id = await ctx.db.insert("daasExternalizations", {
      ...args,
      createdAt: now,
    });
    return { id, updated: false };
  },
});

/**
 * Record one per-task fidelity trial.
 *
 * Called by the Python trial runner once per task. Trials are append-only
 * so multiple runs of the same externalization against the same benchmark
 * accumulate — aggregate queries can filter by createdAt.
 */
export const recordTrial = mutation({
  args: {
    externalizationId: v.string(),
    benchmarkId: v.string(),
    taskId: v.string(),
    baselineModel: v.string(),
    ceilingModel: v.string(),
    distilledModel: v.string(),
    baselinePassed: v.boolean(),
    ceilingPassed: v.boolean(),
    distilledPassed: v.boolean(),
    baselineCostUsd: v.number(),
    ceilingCostUsd: v.number(),
    distilledCostUsd: v.number(),
    baselineError: v.optional(v.string()),
    ceilingError: v.optional(v.string()),
    distilledError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("daasFidelityTrials", {
      ...args,
      createdAt: Date.now(),
    });
    return { id };
  },
});

/**
 * Record an aggregated verdict at the end of a trial run.
 */
export const recordVerdict = mutation({
  args: {
    externalizationId: v.string(),
    benchmarkId: v.string(),
    verdict: v.string(),
    n: v.number(),
    baselineRate: v.number(),
    baselineCiLo: v.number(),
    baselineCiHi: v.number(),
    ceilingRate: v.number(),
    ceilingCiLo: v.number(),
    ceilingCiHi: v.number(),
    distilledRate: v.number(),
    distilledCiLo: v.number(),
    distilledCiHi: v.number(),
    gapPp: v.number(),
    transferPp: v.number(),
    fidelityPct: v.optional(v.number()),
    gapSignificant: v.boolean(),
    transferSignificant: v.boolean(),
    regressionSignificant: v.boolean(),
    narrative: v.string(),
    totalCostUsd: v.number(),
  },
  handler: async (ctx, args) => {
    if (
      !DAAS_TRANSFER_VERDICTS.includes(
        args.verdict as typeof DAAS_TRANSFER_VERDICTS[number],
      )
    ) {
      throw new Error(
        `unknown verdict ${args.verdict}; expected one of ${DAAS_TRANSFER_VERDICTS.join(", ")}`,
      );
    }
    if (args.narrative.length > 1000) {
      throw new Error(`narrative > 1000 chars (${args.narrative.length})`);
    }
    const id = await ctx.db.insert("daasFidelityVerdicts", {
      ...args,
      createdAt: Date.now(),
    });
    return { id };
  },
});

/**
 * List externalizations, newest first. Capped at 500.
 */
export const listExternalizations = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 500);
    return await ctx.db
      .query("daasExternalizations")
      .withIndex("by_createdAt")
      .order("desc")
      .take(limit);
  },
});

/**
 * Latest verdict per externalization — the primary dashboard query.
 *
 * Deduplicates to the most recent verdict per externalizationId so the
 * dashboard shows each distillation artifact's current status.
 */
export const listLatestVerdicts = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 500);
    // Pull a larger window and dedupe in-memory — Convex doesn't have
    // DISTINCT ON, and for <500 rows the memory cost is trivial.
    const rows = await ctx.db
      .query("daasFidelityVerdicts")
      .withIndex("by_createdAt")
      .order("desc")
      .take(Math.max(limit * 4, 200));
    const seen = new Set<string>();
    const out: typeof rows = [];
    for (const r of rows) {
      if (seen.has(r.externalizationId)) continue;
      seen.add(r.externalizationId);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  },
});

/**
 * Verdict history for one externalization — shows how the verdict
 * evolved across trial runs.
 */
export const listVerdictHistory = query({
  args: {
    externalizationId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 200);
    return await ctx.db
      .query("daasFidelityVerdicts")
      .withIndex("by_externalizationId_createdAt", (q) =>
        q.eq("externalizationId", args.externalizationId),
      )
      .order("desc")
      .take(limit);
  },
});

/**
 * All verdicts for a specific benchmark — powers Builder's Eval tab,
 * which shows what's recently been measured against e.g. JudgeBench or
 * tau2 so users don't have to flip to /_internal/fidelity.
 */
export const listVerdictsByBenchmark = query({
  args: {
    benchmarkId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 100);
    return await ctx.db
      .query("daasFidelityVerdicts")
      .withIndex("by_benchmarkId_createdAt", (q) =>
        q.eq("benchmarkId", args.benchmarkId),
      )
      .order("desc")
      .take(limit);
  },
});

/**
 * Per-task trial list — drill into which tasks the scaffold helped vs hurt.
 */
export const listTrials = query({
  args: {
    externalizationId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 500);
    return await ctx.db
      .query("daasFidelityTrials")
      .withIndex("by_externalizationId_createdAt", (q) =>
        q.eq("externalizationId", args.externalizationId),
      )
      .order("desc")
      .take(limit);
  },
});
