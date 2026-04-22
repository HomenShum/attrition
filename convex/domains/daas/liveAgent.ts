/**
 * liveAgent — Tier-2/3 of the live-run architecture.
 *
 * Executes a real Claude Messages API call on behalf of the user and
 * emits real spans to the agentTraceSpans table as the run progresses.
 * The /runs/:runId page subscribes to those spans and renders them in
 * real time.
 *
 * What this IS:
 *   - Real LLM calls against Anthropic's Messages API (not a script)
 *   - Real tokens, real cost, real latency
 *   - Real tool-use handling with mock connector responses
 *   - Rate-limited via daasRateBuckets to protect our shared API key
 *   - Optional BYOK: if the user supplies their own key, that's used
 *     instead and our rate limit doesn't apply
 *
 * What this IS NOT:
 *   - Not running the user's literal emitted Python scaffold — that
 *     needs a Python sandbox (Modal / Cloud Run / Docker) and is the
 *     next cycle. This action runs a TS-native demonstration of the
 *     lane the user picked, so they see the shape in action.
 *   - Not streaming tokens mid-call — spans land after each LLM turn
 *     completes, not per-token. Streaming requires SSE and is future.
 *
 * Pricing guard rails (our shared key):
 *   - Haiku 4.5 default (~$0.0001/run at typical prompt size)
 *   - max_tokens capped per call
 *   - max turns capped per lane
 *   - rate limit: 5 runs / hour / session
 *
 * See docs/LIVE_RUN_AND_TRACE_ADR.md for the full architecture.
 */

import { v } from "convex/values";
import { action, query } from "../../_generated/server";
import { api } from "../../_generated/api";

// Pricing per million tokens (Anthropic Messages API list prices)
const PRICING = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-opus-4-7": { input: 5.0, output: 25.0 },
} as const;

const DEFAULT_MODEL = "claude-haiku-4-5";
const MAX_OUTPUT_TOKENS = 1024;
const MAX_TURNS = 4;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_PER_WINDOW = 5;             // 5 runs per hour per session

type ClaudeMessage = {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
};

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

type ClaudeTool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
};

type ClaudeResponse = {
  id: string;
  type: "message";
  role: "assistant";
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
};

function costFor(model: string, inTok: number, outTok: number): number {
  const p = PRICING[model as keyof typeof PRICING] ?? PRICING[DEFAULT_MODEL];
  return (inTok * p.input + outTok * p.output) / 1_000_000;
}

async function callClaude(
  apiKey: string,
  params: {
    model: string;
    system: string;
    messages: ClaudeMessage[];
    tools?: ClaudeTool[];
  },
): Promise<ClaudeResponse> {
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: params.system,
    messages: params.messages,
  };
  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools;
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude ${res.status}: ${errText.slice(0, 200)}`);
  }
  return (await res.json()) as ClaudeResponse;
}

// Mock tool responses for common tool names. In Tier-3 (BYOK with real
// user tools), we'd dispatch to a user-provided handler; for Tier-2
// we return a canned response so the user sees the loop shape.
function mockToolResult(name: string, args: Record<string, unknown>): string {
  const canned: Record<string, (a: Record<string, unknown>) => string> = {
    sku_lookup: (a) =>
      JSON.stringify({ sku: a.sku ?? a.id ?? "UNKNOWN", stock: 120, price: 19.99 }),
    order_place: (a) =>
      JSON.stringify({
        order_id: `MOCK-ORD-${Math.floor(Math.random() * 9000 + 1000)}`,
        sku: a.sku,
        qty: a.qty ?? a.quantity ?? 1,
        status: "accepted",
      }),
    eod_summary: (a) =>
      JSON.stringify({ date: a.date ?? new Date().toISOString().slice(0, 10), orders: 14, revenue: 1832.0 }),
    kb_search: (a) =>
      JSON.stringify({
        query: a.query,
        results: [
          "Refund policy: 30 days from purchase for unopened items.",
          "Shipping: 2-3 business days standard, 1 day express.",
          "Returns: Contact support@example.com with order ID.",
        ],
      }),
    slack_notify: (a) =>
      JSON.stringify({ status: "suppressed", channel: a.channel, mode: "mock" }),
    draft_reply: (a) =>
      JSON.stringify({
        reply: `Thanks for reaching out about "${(a.topic ?? a.text ?? "your request")}". Based on our policy, here's what I can do...`,
      }),
  };
  const fn = canned[name];
  if (fn) return fn(args);
  return JSON.stringify({ mock: true, tool: name, args });
}

/**
 * Pick a sensible default tool set for each lane. Real scaffolds emit
 * tools as part of the bundle; Tier-2 MVP hardcodes lane defaults so
 * first-run UX is smooth without requiring the user to configure tools.
 */
function defaultToolsForLane(lane: string): ClaudeTool[] {
  const retailOps: ClaudeTool[] = [
    {
      name: "sku_lookup",
      description: "Look up inventory and price for a SKU",
      input_schema: {
        type: "object",
        properties: { sku: { type: "string", description: "SKU identifier" } },
        required: ["sku"],
      },
    },
    {
      name: "order_place",
      description: "Place an order for a SKU at a specified quantity",
      input_schema: {
        type: "object",
        properties: {
          sku: { type: "string" },
          qty: { type: "integer", description: "Units to order" },
        },
        required: ["sku", "qty"],
      },
    },
    {
      name: "eod_summary",
      description: "Get end-of-day order summary for a given date",
      input_schema: {
        type: "object",
        properties: { date: { type: "string", description: "ISO date YYYY-MM-DD" } },
      },
    },
  ];
  const supportDesk: ClaudeTool[] = [
    {
      name: "kb_search",
      description: "Search the knowledge base for policies, procedures, or FAQs",
      input_schema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    {
      name: "draft_reply",
      description: "Draft a customer-facing reply given context",
      input_schema: {
        type: "object",
        properties: {
          topic: { type: "string" },
          tone: { type: "string", description: "supportive|formal|brief" },
        },
        required: ["topic"],
      },
    },
    {
      name: "slack_notify",
      description: "Notify a Slack channel about an unresolved ticket",
      input_schema: {
        type: "object",
        properties: {
          channel: { type: "string" },
          text: { type: "string" },
        },
        required: ["channel", "text"],
      },
    },
  ];
  if (lane === "orchestrator_worker") return retailOps;
  if (lane === "tool_first_chain") return supportDesk;
  return [];
}

function systemPromptForLane(lane: string): string {
  if (lane === "simple_chain") {
    return "You are a concise analyst. Answer the user's request directly in <= 5 bullets. No preamble.";
  }
  if (lane === "tool_first_chain") {
    return (
      "You are a customer support agent. Use tools to look up the right answer before replying. " +
      "Always search the knowledge base first, then draft a reply. Notify Slack only if the case is unresolved."
    );
  }
  if (lane === "orchestrator_worker") {
    return (
      "You are an ops orchestrator. Plan which tools to call in order, then dispatch them. " +
      "Use sku_lookup first, then order_place if stock > 0, then eod_summary at the end. " +
      "Be decisive — call tools rather than narrate."
    );
  }
  return "You are a helpful assistant. Be concise.";
}

function newSpanId(i: number): string {
  return `span-${i.toString().padStart(4, "0")}`;
}

/**
 * The main action. Orchestrates:
 *   1. rate-limit check (unless BYOK)
 *   2. startRun
 *   3. per-lane execution with real Claude calls + span emission
 *   4. finishRun with final status
 */
export const runLiveAgent = action({
  args: {
    runId: v.string(),
    sessionSlug: v.optional(v.string()),
    lane: v.string(),
    userPrompt: v.string(),
    model: v.optional(v.string()),
    byokAnthropicKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ runId: string; status: string }> => {
    // Rate limit check — only when using our shared key
    if (!args.byokAnthropicKey) {
      const sessionKey = args.sessionSlug ?? "anon";
      const now = Date.now();
      const windowStart = now - RATE_LIMIT_WINDOW_MS;
      const recentRuns: number = await ctx.runQuery(
        api.domains.daas.liveAgent.countRecentRuns,
        { sessionSlug: sessionKey, since: windowStart },
      );
      void now; // keep var for readability above; suppresses unused warning
      if (recentRuns >= RATE_LIMIT_PER_WINDOW) {
        throw new Error(
          `rate limit: ${RATE_LIMIT_PER_WINDOW} runs/hour on shared key. Bring your own Anthropic key to skip.`,
        );
      }
    }

    const apiKey = args.byokAnthropicKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY missing on server. Supply a BYOK key to proceed.");
    }
    const model = args.model || DEFAULT_MODEL;
    const lane = args.lane || "simple_chain";
    const userPrompt = args.userPrompt.slice(0, 3500);

    // Create the run
    await ctx.runMutation(api.domains.daas.agentTrace.startRun, {
      runId: args.runId,
      sessionSlug: args.sessionSlug,
      runtimeLane: lane,
      driverRuntime: "claude_agent_sdk",
      mode: "live",
      input: userPrompt,
    });

    // Tier-2 dispatch: if EXECUTOR_URL is configured, send the run to
    // the Python sandbox service which runs the LITERAL emitted
    // scaffold and emits spans back via /http/attritionTrace. Falls
    // back to the in-action TS loop below if EXECUTOR_URL is unset or
    // the executor call fails.
    const executorUrl = process.env.EXECUTOR_URL;
    if (executorUrl) {
      try {
        const execRes = await fetch(`${executorUrl.replace(/\/+$/, "")}/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            run_id: args.runId,
            lane,
            user_prompt: userPrompt,
            session_slug: args.sessionSlug,
            byok_anthropic_key: args.byokAnthropicKey,
          }),
        });
        const execBody = await execRes.text();
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(execBody) as Record<string, unknown>;
        } catch {
          parsed = { raw: execBody.slice(0, 500) };
        }
        const parsedInner = (parsed.parsed ?? {}) as Record<string, unknown>;
        const finalOutput =
          typeof parsedInner.final_output === "string"
            ? (parsedInner.final_output as string)
            : typeof parsed.raw === "string"
              ? (parsed.raw as string)
              : "(no final_output from executor)";
        const ok = execRes.ok && parsed.ok !== false;

        // Persist the literal scaffold files the executor just ran so
        // /build/:slug can show the file tree and Download ZIP unlocks.
        // Without this the scaffold lives for ~9 seconds on Cloud Run
        // then gets rmtree'd — users can never take it home.
        try {
          const scaffoldFiles = Array.isArray(parsed.scaffold_files)
            ? (parsed.scaffold_files as Array<{ path: string; content: string; language: string }>)
            : [];
          if (scaffoldFiles.length > 0) {
            const bundleJson = JSON.stringify({ files: scaffoldFiles });
            const totalBytes = scaffoldFiles.reduce(
              (sum, f) => sum + (f.content?.length ?? 0),
              0,
            );
            await ctx.runMutation(api.domains.daas.compileDown.upsertArtifact, {
              sessionSlug: args.sessionSlug,
              runtimeLane: lane,
              targetModel: "claude-haiku-4-5",
              artifactBundleJson: bundleJson,
              filesCount: scaffoldFiles.length,
              totalBytes,
              emitterVersion: "executor-live-v1",
            });
          }
        } catch (err) {
          console.error("scaffold persist failed (non-fatal)", err);
        }

        await ctx.runMutation(api.domains.daas.agentTrace.finishRun, {
          runId: args.runId,
          status: ok ? "complete" : "failed",
          finalOutput: finalOutput.slice(0, 4000),
          errorMessage: ok
            ? undefined
            : typeof parsed.error === "string"
              ? (parsed.error as string).slice(0, 500)
              : `executor HTTP ${execRes.status}`,
        });
        // Auto-run evaluators on the executor path too
        try {
          await ctx.runAction(api.domains.daas.agentEvaluator.runAllActive, {
            runId: args.runId,
          });
        } catch (err) {
          console.error("evaluators runAllActive (executor path) failed", err);
        }
        return { runId: args.runId, status: ok ? "complete" : "failed" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.runMutation(api.domains.daas.agentTrace.recordSpan, {
          runId: args.runId,
          spanId: `exec-err-${Date.now()}`,
          kind: "meta",
          name: "executor.unreachable",
          startedAt: Date.now(),
          finishedAt: Date.now() + 5,
          inputJson: JSON.stringify({ executorUrl }),
          outputJson: JSON.stringify({ error: msg.slice(0, 400) }),
          errorMessage: `executor unreachable: ${msg.slice(0, 200)}`,
        });
        // Fall through to the TS-agent fallback below
      }
    }

    // Emit run_start (TS-agent fallback path)
    let spanIdx = 0;
    const t0 = Date.now();
    await ctx.runMutation(api.domains.daas.agentTrace.recordSpan, {
      runId: args.runId,
      spanId: newSpanId(spanIdx++),
      kind: "meta",
      name: "run_start",
      startedAt: t0,
      finishedAt: t0 + 5,
      inputJson: JSON.stringify({ lane, model, mode: "live", byok: !!args.byokAnthropicKey }),
      outputJson: "",
    });

    const tools = defaultToolsForLane(lane);
    const system = systemPromptForLane(lane);
    let finalOutput = "";
    let errorMessage: string | undefined;

    try {
      if (lane === "simple_chain") {
        // One LLM call
        const spanStart = Date.now();
        const resp = await callClaude(apiKey, {
          model,
          system,
          messages: [{ role: "user", content: userPrompt }],
        });
        const spanEnd = Date.now();
        const textBlocks = resp.content.filter((b) => b.type === "text") as { type: "text"; text: string }[];
        const answer = textBlocks.map((b) => b.text).join("\n");
        await ctx.runMutation(api.domains.daas.agentTrace.recordSpan, {
          runId: args.runId,
          spanId: newSpanId(spanIdx++),
          kind: "llm",
          name: "model.call",
          startedAt: spanStart,
          finishedAt: spanEnd,
          inputJson: JSON.stringify({ system: system.slice(0, 300), user: userPrompt.slice(0, 800) }),
          outputJson: JSON.stringify({ answer: answer.slice(0, 1500), stop_reason: resp.stop_reason }),
          inputTokens: resp.usage.input_tokens,
          outputTokens: resp.usage.output_tokens,
          costUsd: costFor(model, resp.usage.input_tokens, resp.usage.output_tokens),
          modelLabel: model,
        });
        finalOutput = answer;
      } else if (lane === "tool_first_chain" || lane === "orchestrator_worker") {
        // Tool-loop. Repeated LLM calls until stop_reason != "tool_use" or MAX_TURNS.
        const messages: ClaudeMessage[] = [{ role: "user", content: userPrompt }];
        let turns = 0;
        while (turns < MAX_TURNS) {
          const spanStart = Date.now();
          const resp = await callClaude(apiKey, { model, system, messages, tools });
          const spanEnd = Date.now();
          const toolCalls = resp.content.filter(
            (b) => b.type === "tool_use",
          ) as Array<Extract<ClaudeContentBlock, { type: "tool_use" }>>;
          const textBlocks = resp.content.filter(
            (b) => b.type === "text",
          ) as Array<Extract<ClaudeContentBlock, { type: "text" }>>;
          const turnText = textBlocks.map((b) => b.text).join("\n").slice(0, 1500);
          await ctx.runMutation(api.domains.daas.agentTrace.recordSpan, {
            runId: args.runId,
            spanId: newSpanId(spanIdx++),
            kind: "llm",
            name: `turn.${turns + 1}`,
            startedAt: spanStart,
            finishedAt: spanEnd,
            inputJson: JSON.stringify({
              system: system.slice(0, 300),
              messages_count: messages.length,
              tools_count: tools.length,
            }),
            outputJson: JSON.stringify({
              text: turnText,
              tool_calls: toolCalls.map((t) => ({ name: t.name, input: t.input })),
              stop_reason: resp.stop_reason,
            }),
            inputTokens: resp.usage.input_tokens,
            outputTokens: resp.usage.output_tokens,
            costUsd: costFor(model, resp.usage.input_tokens, resp.usage.output_tokens),
            modelLabel: model,
          });

          // If no tool calls, we're done
          if (toolCalls.length === 0) {
            finalOutput = turnText;
            break;
          }

          // Append the assistant message + dispatch each tool call
          messages.push({ role: "assistant", content: resp.content });
          const toolResults: ClaudeContentBlock[] = [];
          for (const call of toolCalls) {
            const toolStart = Date.now();
            const result = mockToolResult(call.name, call.input);
            const toolEnd = Date.now();
            await ctx.runMutation(api.domains.daas.agentTrace.recordSpan, {
              runId: args.runId,
              spanId: newSpanId(spanIdx++),
              kind: "tool",
              name: call.name,
              startedAt: toolStart,
              finishedAt: toolEnd + 5,
              inputJson: JSON.stringify({ args: call.input, connector: "mock" }),
              outputJson: result,
            });
            toolResults.push({
              type: "tool_result",
              tool_use_id: call.id,
              content: result,
            });
          }
          messages.push({ role: "user", content: toolResults });
          turns++;
        }
        if (!finalOutput && turns >= MAX_TURNS) {
          finalOutput = `Reached max ${MAX_TURNS} turns without a final answer.`;
        }
      } else {
        // Fallback: treat unknown lane as simple_chain
        const spanStart = Date.now();
        const resp = await callClaude(apiKey, {
          model,
          system,
          messages: [{ role: "user", content: userPrompt }],
        });
        const spanEnd = Date.now();
        const txt = resp.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text)
          .join("\n");
        await ctx.runMutation(api.domains.daas.agentTrace.recordSpan, {
          runId: args.runId,
          spanId: newSpanId(spanIdx++),
          kind: "llm",
          name: "model.call",
          startedAt: spanStart,
          finishedAt: spanEnd,
          inputJson: JSON.stringify({ system: system.slice(0, 300), user: userPrompt.slice(0, 800) }),
          outputJson: JSON.stringify({ answer: txt.slice(0, 1500) }),
          inputTokens: resp.usage.input_tokens,
          outputTokens: resp.usage.output_tokens,
          costUsd: costFor(model, resp.usage.input_tokens, resp.usage.output_tokens),
          modelLabel: model,
        });
        finalOutput = txt;
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(api.domains.daas.agentTrace.recordSpan, {
        runId: args.runId,
        spanId: newSpanId(spanIdx++),
        kind: "meta",
        name: "run_error",
        startedAt: Date.now(),
        finishedAt: Date.now() + 5,
        inputJson: JSON.stringify({}),
        outputJson: JSON.stringify({ error: errorMessage }),
        errorMessage,
      });
    }

    // Emit run_end
    await ctx.runMutation(api.domains.daas.agentTrace.recordSpan, {
      runId: args.runId,
      spanId: newSpanId(spanIdx++),
      kind: "meta",
      name: "run_end",
      startedAt: Date.now(),
      finishedAt: Date.now() + 5,
      inputJson: JSON.stringify({}),
      outputJson: JSON.stringify({
        final_output_preview: finalOutput.slice(0, 300),
        error: errorMessage,
      }),
    });

    // Mark run terminal
    await ctx.runMutation(api.domains.daas.agentTrace.finishRun, {
      runId: args.runId,
      status: errorMessage ? "failed" : "complete",
      finalOutput: finalOutput || undefined,
      errorMessage,
    });

    // Fire off evaluators asynchronously — don't block the response on
    // judge latency. Each evaluator records its own result via mutation
    // so the /runs page subscription picks them up as they land.
    try {
      await ctx.runAction(api.domains.daas.agentEvaluator.runAllActive, {
        runId: args.runId,
      });
    } catch (err) {
      // Evaluators are best-effort; a judge failure shouldn't fail the run.
      console.error("evaluators runAllActive failed", err);
    }

    return { runId: args.runId, status: errorMessage ? "failed" : "complete" };
  },
});

/**
 * Rate-limit helper — counts live runs by this session in the window.
 * Used inside runLiveAgent before dispatching to prevent shared-key abuse.
 */
export const countRecentRuns = query({
  args: { sessionSlug: v.string(), since: v.number() },
  handler: async (ctx, args): Promise<number> => {
    const rows = await ctx.db
      .query("agentRuns")
      .withIndex("by_sessionSlug_startedAt", (q) =>
        q.eq("sessionSlug", args.sessionSlug).gte("startedAt", args.since),
      )
      .take(50);
    return rows.length;
  },
});
