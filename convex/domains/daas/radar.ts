// Radar page — normalized ecosystem intelligence feed.
//
// Not an AI news page. Each row is reduced into: what changed, which
// stacks, whether it shifts the recommender's runtime / eval / world_model
// priors, and a suggested action for attrition users.

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { RADAR_CATEGORIES, RADAR_SOURCE_TIERS } from "./schema";

const MAX_SUMMARY = 280;

/**
 * Ingest or upsert a Radar item.
 *
 * Uses itemId as the stable key — re-ingesting the same id (e.g. the
 * Claude Code 1.0.24 release) updates the row rather than duplicating.
 */
export const upsertItem = mutation({
  args: {
    itemId: v.string(),
    category: v.string(),
    sourceTier: v.string(),
    stack: v.string(),
    title: v.string(),
    summary: v.string(),
    url: v.string(),
    changedAt: v.number(),
    affectsLanesJson: v.string(),
    updatesPrior: v.string(),
    suggestedAction: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!RADAR_CATEGORIES.includes(args.category as typeof RADAR_CATEGORIES[number])) {
      throw new Error(`invalid category ${args.category}`);
    }
    if (!RADAR_SOURCE_TIERS.includes(args.sourceTier as typeof RADAR_SOURCE_TIERS[number])) {
      throw new Error(`invalid sourceTier ${args.sourceTier}`);
    }
    if (!["runtime", "eval", "world_model", "none"].includes(args.updatesPrior)) {
      throw new Error(`invalid updatesPrior ${args.updatesPrior}`);
    }
    if (args.summary.length > MAX_SUMMARY) {
      throw new Error(`summary too long (${args.summary.length} > ${MAX_SUMMARY})`);
    }
    const existing = await ctx.db
      .query("radarItems")
      .withIndex("by_itemId", (q) => q.eq("itemId", args.itemId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        category: args.category,
        sourceTier: args.sourceTier,
        stack: args.stack,
        title: args.title,
        summary: args.summary,
        url: args.url,
        changedAt: args.changedAt,
        affectsLanesJson: args.affectsLanesJson,
        updatesPrior: args.updatesPrior,
        suggestedAction: args.suggestedAction,
      });
      return { id: existing._id, updated: true };
    }
    const id = await ctx.db.insert("radarItems", {
      ...args,
      dismissed: false,
      createdAt: Date.now(),
    });
    return { id, updated: false };
  },
});

/** Soft-hide an item from default Radar view */
export const dismissItem = mutation({
  args: { itemId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("radarItems")
      .withIndex("by_itemId", (q) => q.eq("itemId", args.itemId))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, { dismissed: true });
  },
});

/**
 * List Radar items, newest first, filtered by category/stack/tier.
 * Default excludes dismissed.
 */
export const listItems = query({
  args: {
    category: v.optional(v.string()),
    stack: v.optional(v.string()),
    sourceTier: v.optional(v.string()),
    includeDismissed: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 300);
    let rows;
    if (args.category) {
      rows = await ctx.db
        .query("radarItems")
        .withIndex("by_category_changedAt", (q) => q.eq("category", args.category!))
        .order("desc")
        .take(limit * 2);
    } else if (args.stack) {
      rows = await ctx.db
        .query("radarItems")
        .withIndex("by_stack_changedAt", (q) => q.eq("stack", args.stack!))
        .order("desc")
        .take(limit * 2);
    } else if (args.sourceTier) {
      rows = await ctx.db
        .query("radarItems")
        .withIndex("by_sourceTier_changedAt", (q) => q.eq("sourceTier", args.sourceTier!))
        .order("desc")
        .take(limit * 2);
    } else {
      rows = await ctx.db
        .query("radarItems")
        .withIndex("by_changedAt")
        .order("desc")
        .take(limit * 2);
    }
    const includeDismissed = args.includeDismissed ?? false;
    const out = rows.filter((r) => includeDismissed || !r.dismissed).slice(0, limit);
    return out;
  },
});

/**
 * Architect classifier feedback — pulls the 10 most recent Tier-1
 * items that `updatesPrior = "runtime"` or `"eval"`. The classifier
 * action threads these into its prompt as "RECENT ECOSYSTEM CHANGES"
 * context so the recommendation reflects the current state of the
 * agent-framework world, not the state when the prompt was written.
 *
 * Bounded small (10) so the classifier prompt stays under the
 * token budget.
 */
export const getClassifierPriors = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("radarItems")
      .withIndex("by_sourceTier_changedAt", (q) =>
        q.eq("sourceTier", "tier1_official"),
      )
      .order("desc")
      .take(30);
    const filtered = rows
      .filter(
        (r) =>
          !r.dismissed &&
          (r.updatesPrior === "runtime" || r.updatesPrior === "eval"),
      )
      .slice(0, 10)
      .map((r) => ({
        title: r.title,
        stack: r.stack,
        prior: r.updatesPrior,
        summary: r.summary,
        changedAt: r.changedAt,
      }));
    return filtered;
  },
});

/**
 * Ingest health — powers the Radar page's reliability card.
 * Surfaces the most recent `radar.ingestAll` and `radar.ingestHn` audit
 * rows so operators see ingest cadence + error counts without paging
 * through Convex function logs.
 */
export const getIngestHealth = query({
  args: {},
  handler: async (ctx) => {
    const recent = await ctx.db
      .query("daasAuditLog")
      .withIndex("by_createdAt")
      .order("desc")
      .take(100);
    const findLast = (op: string) => recent.find((r) => r.op === op) ?? null;
    return {
      githubReleases: findLast("radar.ingestAll"),
      hackerNews: findLast("radar.ingestHn"),
      // Count errors in the last 24h across all ingest ops
      errorsLast24h: recent.filter(
        (r) =>
          r.status === "error" &&
          (r.op === "radar.ingestAll" || r.op === "radar.ingestHn") &&
          Date.now() - r.createdAt < 24 * 60 * 60 * 1000,
      ).length,
    };
  },
});

/** Counts by category — powers the Radar tab pills */
export const getCategoryCounts = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("radarItems")
      .withIndex("by_changedAt")
      .order("desc")
      .take(500);
    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (r.dismissed) continue;
      counts[r.category] = (counts[r.category] ?? 0) + 1;
    }
    return counts;
  },
});
