// Rate limiting for Architect classify calls.
//
// Uses the existing daasRateBuckets table (created for DaaS HTTP ingest).
// Per-bucket 20 classify calls / 5-minute window by default. Bucket key
// is "architect:<ip-or-session-prefix>" so traffic from one caller can't
// burn another caller's quota.
//
// Agentic reliability:
//   [BOUND]         hard cap per bucket; over-cap classify rejected.
//   [HONEST_STATUS] rate-limited callers get reason="rate_limited" not
//                   a fake verdict.

import { v } from "convex/values";
import { mutation } from "../../_generated/server";

const WINDOW_MS = 5 * 60 * 1_000;     // 5 min
const MAX_PER_WINDOW = 20;

/**
 * Increment a classify bucket. Returns { allowed, remaining, resetAt }.
 * Callers (Node action) invoke this BEFORE hitting Gemini; on allowed=false
 * they short-circuit with a clear error message.
 */
export const checkClassifyBucket = mutation({
  args: {
    bucketKey: v.string(), // e.g. "architect:<sessionSlugPrefix>"
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("daasRateBuckets")
      .withIndex("by_bucketKey", (q) => q.eq("bucketKey", args.bucketKey))
      .unique();

    if (!existing) {
      await ctx.db.insert("daasRateBuckets", {
        bucketKey: args.bucketKey,
        count: 1,
        resetAt: now + WINDOW_MS,
        updatedAt: now,
      });
      return { allowed: true, remaining: MAX_PER_WINDOW - 1, resetAt: now + WINDOW_MS };
    }

    if (existing.resetAt <= now) {
      // Window elapsed — reset
      await ctx.db.patch(existing._id, {
        count: 1,
        resetAt: now + WINDOW_MS,
        updatedAt: now,
      });
      return { allowed: true, remaining: MAX_PER_WINDOW - 1, resetAt: now + WINDOW_MS };
    }

    if (existing.count >= MAX_PER_WINDOW) {
      return { allowed: false, remaining: 0, resetAt: existing.resetAt };
    }

    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
      updatedAt: now,
    });
    return {
      allowed: true,
      remaining: MAX_PER_WINDOW - existing.count - 1,
      resetAt: existing.resetAt,
    };
  },
});
