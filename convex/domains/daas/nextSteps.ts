/**
 * nextSteps — queries + mutations that back the /next-steps/:slug page
 * (the 60-min checkpoint of the user journey).
 *
 * The emitted scaffold pings us via POST /attritionPing (see
 * convex/http.ts) when it crosses a milestone. The webhook calls
 * `recordPing` here; the UI subscribes via `listPingsForSession`.
 *
 * Bounded invariants (agentic_reliability.md):
 *   - BOUND:          query capped at 200 rows per session
 *   - HONEST_STATUS:  failed writes throw — no silent 2xx
 *   - BOUND_READ:     raw payload capped at 4KB before insert
 *   - DETERMINISTIC:  idempotent per (sessionSlug, event)
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";

const ALLOWED_EVENTS = new Set([
  "downloaded",
  "mock_exec_pass",
  "live_smoke_pass",
  "first_prod_request",
  "deployed",
]);

const MAX_RAW_BYTES = 4 * 1024; // 4KB — BOUND_READ on external payloads
const MAX_LIST_ROWS = 200; // BOUND

export const recordPing = mutation({
  args: {
    sessionSlug: v.string(),
    event: v.string(),
    clientTs: v.number(),
    runtimeLane: v.optional(v.string()),
    driverRuntime: v.optional(v.string()),
    raw: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate event — reject unknown to prevent attack via raw string field.
    if (!ALLOWED_EVENTS.has(args.event)) {
      throw new Error(`unknown event: ${args.event}`);
    }
    // BOUND_READ — cap raw payload before we store it.
    if (args.raw.length > MAX_RAW_BYTES) {
      throw new Error(
        `raw payload exceeds ${MAX_RAW_BYTES} bytes (got ${args.raw.length})`,
      );
    }
    // Idempotent upsert by (sessionSlug, event). Re-pinging the same event
    // overwrites the prior row rather than creating N duplicates.
    const existing = await ctx.db
      .query("scaffoldPings")
      .withIndex("by_sessionSlug_event", (q) =>
        q.eq("sessionSlug", args.sessionSlug).eq("event", args.event),
      )
      .unique()
      .catch(() => null);
    const serverTs = Date.now();
    const row = {
      sessionSlug: args.sessionSlug,
      event: args.event,
      clientTs: args.clientTs,
      serverTs,
      runtimeLane: args.runtimeLane,
      driverRuntime: args.driverRuntime,
      raw: args.raw,
    };
    if (existing) {
      await ctx.db.patch(existing._id, row);
      return { status: "updated" as const, id: existing._id };
    }
    const id = await ctx.db.insert("scaffoldPings", row);
    return { status: "inserted" as const, id };
  },
});

export const listPingsForSession = query({
  args: { sessionSlug: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("scaffoldPings")
      .withIndex("by_sessionSlug_serverTs", (q) =>
        q.eq("sessionSlug", args.sessionSlug),
      )
      .order("desc")
      .take(MAX_LIST_ROWS);
    return rows.map((r) => ({
      _id: r._id,
      event: r.event,
      clientTs: r.clientTs,
      serverTs: r.serverTs,
      runtimeLane: r.runtimeLane ?? null,
      driverRuntime: r.driverRuntime ?? null,
    }));
  },
});
