/**
 * evaluatorSeed — idempotent seed of the builtin LLM-as-judge evaluators.
 *
 * Called at startup via the seedBuiltinEvaluators mutation. Each run
 * upserts by `name`, so shipping additional evaluators is just adding
 * entries here and re-deploying.
 *
 * Design principles borrowed from Arize AX:
 *   - Each evaluator returns STRICT JSON: {score, verdict, rationale}
 *   - `score` is 0..1 numeric — enables averaging across runs
 *   - `verdict` is bounded enum (pass|fail|warn|skip)
 *   - `rationale` is one sentence (cap 500 chars via mutation)
 *
 * Templates support tokens: {{RUN_INPUT}}, {{FINAL_OUTPUT}}, {{LANE}},
 * {{DRIVER}}, {{MODE}}, {{SPAN_COUNT}}, {{TOTAL_COST}}, {{SPANS_SUMMARY}}.
 */

import { mutation } from "../../_generated/server";

const JUDGE_TAIL = `\n\nReply with STRICT JSON only: {"score": <0..1 float>, "verdict": "pass"|"fail"|"warn"|"skip", "rationale": "<one sentence>"}. No markdown. No preamble. One sentence rationale only.`;

export const BUILTIN_EVALUATORS: Array<{
  name: string;
  label: string;
  description: string;
  kind: string;
  systemPrompt: string;
  userTemplate: string;
  judgeModel: string;
  active: boolean;
  priority: number;
  seeded: boolean;
}> = [
  {
    name: "output_quality",
    label: "Output Quality",
    description:
      "Did the agent produce a useful, on-task answer that addresses the user's input?",
    kind: "llm-as-judge",
    systemPrompt:
      "You are a quality-rating judge. You evaluate whether an agent's final output " +
      "actually addresses the user's request. Score 1.0 when the output fully answers " +
      "the request, 0.5 when partial, 0.0 when off-topic or empty. Score doesn't " +
      "penalize correctness of facts — that's a different evaluator. Focus on: did " +
      "the agent stay on task, produce structured output, and cover the user's ask.",
    userTemplate:
      "User input:\n{{RUN_INPUT}}\n\nAgent's final output:\n{{FINAL_OUTPUT}}" +
      JUDGE_TAIL,
    judgeModel: "claude-haiku-4-5",
    active: true,
    priority: 100,
    seeded: true,
  },
  {
    name: "hallucination_check",
    label: "Hallucination Check",
    description:
      "Did the agent invent facts not present in the tool-call results or the prompt?",
    kind: "llm-as-judge",
    systemPrompt:
      "You are a grounding judge. Examine the span summary (tool calls + outputs) " +
      "and the final output. If the final output asserts a fact NOT present in any " +
      "tool result or the user prompt, that's a hallucination — score 0.0 with verdict=fail. " +
      "Directional claims ('stock sufficient', 'order accepted') that are backed by a " +
      "tool result pass. Score 1.0 when every factual claim is traceable to a tool " +
      "output or the user's words.",
    userTemplate:
      "User input:\n{{RUN_INPUT}}\n\nSpan summary (tool calls + outputs):\n{{SPANS_SUMMARY}}\n\n" +
      "Agent's final output:\n{{FINAL_OUTPUT}}" +
      JUDGE_TAIL,
    judgeModel: "claude-haiku-4-5",
    active: true,
    priority: 90,
    seeded: true,
  },
  {
    name: "tool_use_correctness",
    label: "Tool-Use Correctness",
    description:
      "Did the agent call the right tools in the right order with valid arguments?",
    kind: "llm-as-judge",
    systemPrompt:
      "You are a tool-use judge. Look at the sequence of tool calls in the span " +
      "summary and decide whether the agent chose appropriate tools, in a sensible " +
      "order, with well-formed arguments. If no tools were expected (simple_chain " +
      "lane), score 1.0 unconditionally. For tool_first_chain and orchestrator_worker " +
      "lanes, grade the sequence: search-before-reply, lookup-before-dispatch, etc.",
    userTemplate:
      "Lane: {{LANE}}\nUser input:\n{{RUN_INPUT}}\n\nSpan summary (shows tool calls):\n{{SPANS_SUMMARY}}" +
      JUDGE_TAIL,
    judgeModel: "claude-haiku-4-5",
    active: true,
    priority: 80,
    seeded: true,
  },
  {
    name: "cost_efficiency",
    label: "Cost Efficiency",
    description:
      "Did the agent resolve the task with a reasonable number of turns + tokens?",
    kind: "llm-as-judge",
    systemPrompt:
      "You are a cost-efficiency judge. Evaluate whether the agent used a " +
      "reasonable number of turns and tokens for the task complexity. A single-LLM " +
      "question should be 1 LLM span at low cost. A multi-step ops task (orchestrator" +
      "_worker lane) is reasonable up to 4 LLM turns and $0.02. Score 1.0 when the " +
      "run is lean, 0.5 when slightly wasteful, 0.0 when runaway (e.g. hit max " +
      "turns, cost over $0.05 on a trivial task).",
    userTemplate:
      "Lane: {{LANE}}\nUser input:\n{{RUN_INPUT}}\n\nSpan summary:\n{{SPANS_SUMMARY}}\n\n" +
      "Totals: {{SPAN_COUNT}} spans, {{TOTAL_COST}} spent." +
      JUDGE_TAIL,
    judgeModel: "claude-haiku-4-5",
    active: true,
    priority: 70,
    seeded: true,
  },
  {
    name: "run_completion",
    label: "Run Completion",
    description:
      "Did the run complete without a terminal error, and did it produce a final output?",
    kind: "llm-as-judge",
    systemPrompt:
      "You are a completion-status judge. Pass when the run has a non-empty final " +
      "output and no error spans. Warn when there's a final output but also error " +
      "spans. Fail when final output is empty or a max-turns ceiling was hit " +
      "(visible in spans as 'Reached max N turns without a final answer.').",
    userTemplate:
      "Span summary:\n{{SPANS_SUMMARY}}\n\nFinal output (may be empty):\n{{FINAL_OUTPUT}}" +
      JUDGE_TAIL,
    judgeModel: "claude-haiku-4-5",
    active: true,
    priority: 60,
    seeded: true,
  },
];

/**
 * Idempotent seed mutation. Safe to call repeatedly — upserts by name.
 * Invoked via `npx convex run domains/daas/evaluatorSeed:seedBuiltinEvaluators`
 * after a schema push, or automatically via the seed cron (future).
 */
export const seedBuiltinEvaluators = mutation({
  args: {},
  handler: async (ctx): Promise<{ seeded: number }> => {
    let count = 0;
    for (const e of BUILTIN_EVALUATORS) {
      const existing = await ctx.db
        .query("agentEvaluators")
        .withIndex("by_name", (q) => q.eq("name", e.name))
        .unique()
        .catch(() => null);
      const payload = {
        ...e,
        createdAt: existing?.createdAt ?? Date.now(),
      };
      if (existing) {
        await ctx.db.patch(existing._id, payload);
      } else {
        await ctx.db.insert("agentEvaluators", payload);
      }
      count++;
    }
    return { seeded: count };
  },
});
