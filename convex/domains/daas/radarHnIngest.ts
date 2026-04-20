// Radar ingestion — Hacker News Firebase REST as a tier3 weak-signal source.
//
// HN is NOT authoritative. We ingest it explicitly tagged sourceTier =
// tier3_weak so the Radar UI renders a "weak signal" badge on every row.
// Never used alone to update an internal prior — it augments the tier1
// GitHub feeds.
//
// API: https://hacker-news.firebaseio.com/v0/
//   /topstories.json       -> int[] (ids of top 500 stories)
//   /item/<id>.json        -> { id, by, title, url, time, score, ... }
//
// We query topstories and filter by keyword match against a small watchlist
// of agent-relevant terms. Unauthenticated, no rate limit at our volume.

"use node";

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";

const HN_TIMEOUT_MS = 6_000;
const MAX_ITEMS_PER_RUN = 25;
const SUMMARY_MAX = 280;

// Keyword watchlist — title must contain at least one (case-insensitive).
// Keep tight; noise pollutes the "weak signal" bucket.
const HN_KEYWORDS = [
  "claude code",
  "claude agent",
  "agent sdk",
  "mcp server",
  "langgraph",
  "langchain",
  "openai agents",
  "anthropic sdk",
  "swe-bench",
  "bfcl",
  "tau2",
  "judgebench",
  "terminal-bench",
  "browsecomp",
  "tool calling",
  "function calling",
  "llm agent",
  "ai agent",
  "orchestrator worker",
  "scaffold",
  "distillation",
];

// Map matched keyword -> stack key used across the product. Any keyword
// not listed falls back to "hacker_news" so the Radar still has a filter.
const KEYWORD_TO_STACK: Record<string, string> = {
  "claude code": "claude_code",
  "claude agent": "anthropic_sdk",
  "agent sdk": "openai_agents_sdk",
  "mcp server": "mcp_ecosystem",
  "langgraph": "langgraph",
  "langchain": "langchain",
  "openai agents": "openai_agents_sdk",
  "anthropic sdk": "anthropic_sdk",
  "swe-bench": "benchmarks",
  "bfcl": "benchmarks",
  "tau2": "benchmarks",
  "judgebench": "benchmarks",
  "terminal-bench": "benchmarks",
  "browsecomp": "benchmarks",
};

// Map matched keyword -> which recommender prior to update (runtime / eval / none).
const KEYWORD_TO_PRIOR: Record<string, "runtime" | "eval" | "none"> = {
  "claude code": "runtime",
  "agent sdk": "runtime",
  "mcp server": "runtime",
  "langgraph": "runtime",
  "langchain": "runtime",
  "openai agents": "runtime",
  "anthropic sdk": "runtime",
  "swe-bench": "eval",
  "bfcl": "eval",
  "tau2": "eval",
  "judgebench": "eval",
  "terminal-bench": "eval",
  "browsecomp": "eval",
  "tool calling": "runtime",
  "function calling": "runtime",
  "llm agent": "runtime",
  "ai agent": "runtime",
  "orchestrator worker": "runtime",
  "scaffold": "runtime",
  "distillation": "eval",
};

type HnStory = {
  id: number;
  type?: string;
  by?: string;
  title?: string;
  url?: string;
  time?: number;
  score?: number;
};


async function _fetchJSON(url: string): Promise<unknown> {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(HN_TIMEOUT_MS),
    headers: { "User-Agent": "attrition-radar-hn" },
  });
  if (!resp.ok) {
    throw new Error(`HN HTTP ${resp.status} for ${url}`);
  }
  return resp.json();
}


function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}


function matchKeyword(title: string): string | null {
  const lower = title.toLowerCase();
  for (const kw of HN_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}


type HnIngestReport = {
  checked: number;
  matched: number;
  upserted: number;
  updated: number;
  errors: Array<{ id: number; message: string }>;
  runMs: number;
};


export const ingestHn = action({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<HnIngestReport> => {
    const started = Date.now();
    const limit = Math.min(args.limit ?? MAX_ITEMS_PER_RUN, 50);
    const errors: HnIngestReport["errors"] = [];
    let checked = 0;
    let matched = 0;
    let upserted = 0;
    let updated = 0;

    let topIds: number[] = [];
    try {
      const json = (await _fetchJSON(
        "https://hacker-news.firebaseio.com/v0/topstories.json",
      )) as number[];
      if (Array.isArray(json)) topIds = json.slice(0, 150);
    } catch (err) {
      // If we can't even fetch topstories, return error honestly
      return {
        checked: 0,
        matched: 0,
        upserted: 0,
        updated: 0,
        errors: [{ id: 0, message: String(err).slice(0, 300) }],
        runMs: Date.now() - started,
      };
    }

    // Fetch each candidate and filter by keyword. Bounded loop.
    for (const id of topIds) {
      if (matched >= limit) break;
      checked += 1;
      let story: HnStory;
      try {
        story = (await _fetchJSON(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
        )) as HnStory;
      } catch (err) {
        errors.push({ id, message: String(err).slice(0, 200) });
        continue;
      }
      if (!story || story.type !== "story" || !story.title) continue;
      const kw = matchKeyword(story.title);
      if (!kw) continue;
      matched += 1;

      const stack = KEYWORD_TO_STACK[kw] ?? "hacker_news";
      const prior = KEYWORD_TO_PRIOR[kw] ?? "none";
      const changedMs = story.time ? story.time * 1000 : Date.now();
      const title = truncate(story.title, 200);
      const summary = truncate(
        `HN story matched on "${kw}" (score ${story.score ?? 0}, by ${story.by ?? "unknown"}). Treat as weak signal; confirm against Tier 1 sources before updating priors.`,
        SUMMARY_MAX,
      );
      const url = story.url ?? `https://news.ycombinator.com/item?id=${story.id}`;

      try {
        const res = await ctx.runMutation(api.domains.daas.radar.upsertItem, {
          itemId: `hn:${stack}:${story.id}`,
          category: "watchlist",
          sourceTier: "tier3_weak",
          stack,
          title,
          summary,
          url,
          changedAt: changedMs,
          affectsLanesJson: JSON.stringify([]),
          updatesPrior: prior,
          suggestedAction:
            "Weak signal. Don't act on this alone; check the matching Tier 1 repo/changelog for a corroborating release before updating recommender priors.",
        });
        if (res?.updated) updated += 1;
        else upserted += 1;
      } catch (err) {
        errors.push({ id, message: String(err).slice(0, 200) });
      }
    }

    return {
      checked,
      matched,
      upserted,
      updated,
      errors,
      runMs: Date.now() - started,
    };
  },
});


export const ingestHnInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<HnIngestReport> => {
    const started = Date.now();
    const report = (await ctx.runAction(
      api.domains.daas.radarHnIngest.ingestHn,
      {},
    )) as HnIngestReport;
    try {
      const auditArgs: {
        op: string;
        actorKind: string;
        status: string;
        metaJson: string;
        durationMs: number;
        errorMessage?: string;
      } = {
        op: "radar.ingestHn",
        actorKind: "cron",
        status: report.errors.length === 0 ? "ok" : "error",
        metaJson: JSON.stringify({
          checked: report.checked,
          matched: report.matched,
          upserted: report.upserted,
          updated: report.updated,
          errorCount: report.errors.length,
        }),
        durationMs: Date.now() - started,
      };
      if (report.errors.length > 0) {
        auditArgs.errorMessage = `${report.errors.length} error(s); first: ${report.errors[0].message.slice(0, 120)}`;
      }
      await ctx.runMutation(internal.domains.daas.mutations.logAuditEvent, auditArgs);
    } catch {
      // Best-effort audit
    }
    return report;
  },
});
