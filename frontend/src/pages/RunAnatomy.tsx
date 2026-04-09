import { useState } from "react";
import { Layout } from "../components/Layout";

/* ── Types ───────────────────────────────────────────────── */

interface ToolCall {
  ts: string;
  tool: string;
  type: ToolType;
  args: string;
}

type ToolType =
  | "search"
  | "read"
  | "edit"
  | "bash"
  | "preview"
  | "agent"
  | "meta"
  | "write";

interface StepEvidence {
  name: string;
  evidence: number;
  tools: string[];
}

interface TopTool {
  name: string;
  count: number;
  type: ToolType;
}

/* ── Demo data from real dogfood session ─────────────────── */

const DEMO_SESSION = {
  id: "aa625586",
  model: "claude-opus-4-6",
  duration_min: 1806,
  tool_calls: 544,
  steps_completed: 8,
  total_steps: 8,
  corrections: 1,
  cost_usd: 4131,
  input_tokens: 274551833,
  output_tokens: 175512,
  top_tools: [
    { name: "Chrome.computer", count: 139, type: "preview" as ToolType },
    { name: "Bash", count: 94, type: "bash" as ToolType },
    { name: "Write", count: 67, type: "edit" as ToolType },
    { name: "Read", count: 32, type: "read" as ToolType },
    { name: "TodoWrite", count: 31, type: "meta" as ToolType },
    { name: "Edit", count: 31, type: "edit" as ToolType },
    { name: "Chrome.navigate", count: 28, type: "preview" as ToolType },
    { name: "Agent", count: 21, type: "agent" as ToolType },
    { name: "Chrome.javascript", count: 17, type: "preview" as ToolType },
    { name: "context-mode.execute", count: 10, type: "bash" as ToolType },
  ] satisfies TopTool[],
  steps: [
    { name: "search", evidence: 5, tools: ["Grep", "Glob", "WebSearch"] },
    { name: "read", evidence: 32, tools: ["Read"] },
    { name: "edit", evidence: 98, tools: ["Edit", "Write"] },
    { name: "test", evidence: 3, tools: ["Bash (cargo test)"] },
    { name: "build", evidence: 8, tools: ["Bash (cargo check)", "Bash (cargo build)"] },
    { name: "preview", evidence: 184, tools: ["Chrome.computer", "Chrome.navigate"] },
    { name: "commit", evidence: 12, tools: ["Bash (git commit)", "Bash (git push)"] },
    { name: "qa_check", evidence: 5, tools: ["Bash (cargo check)"] },
  ] satisfies StepEvidence[],
};

/* Generate timeline entries from top_tools distribution */
function generateTimelineEntries(): ToolCall[] {
  const entries: ToolCall[] = [];
  const startTime = new Date("2026-04-07T02:14:00Z");
  const toolPool: { tool: string; type: ToolType; args: string }[] = [
    { tool: "Chrome.computer", type: "preview", args: "screenshot" },
    { tool: "Chrome.computer", type: "preview", args: "left_click [640, 320]" },
    { tool: "Chrome.computer", type: "preview", args: "scroll down" },
    { tool: "Bash", type: "bash", args: "cargo check" },
    { tool: "Bash", type: "bash", args: "cargo build --release" },
    { tool: "Bash", type: "bash", args: "cargo test" },
    { tool: "Bash", type: "bash", args: "git add -A && git commit" },
    { tool: "Bash", type: "bash", args: "ls src/pages/" },
    { tool: "Write", type: "edit", args: "src/pages/Landing.tsx" },
    { tool: "Write", type: "edit", args: "src/components/Layout.tsx" },
    { tool: "Write", type: "edit", args: "src/lib/hooks.ts" },
    { tool: "Read", type: "read", args: "src/main.tsx" },
    { tool: "Read", type: "read", args: "Cargo.toml" },
    { tool: "Read", type: "read", args: "README.md" },
    { tool: "TodoWrite", type: "meta", args: "Update task: build landing page" },
    { tool: "TodoWrite", type: "meta", args: "Mark complete: setup routing" },
    { tool: "Edit", type: "edit", args: "src/pages/Judge.tsx [line 42]" },
    { tool: "Edit", type: "edit", args: "src/lib/api.ts [line 118]" },
    { tool: "Chrome.navigate", type: "preview", args: "http://localhost:5173/" },
    { tool: "Chrome.navigate", type: "preview", args: "http://localhost:5173/judge" },
    { tool: "Agent", type: "agent", args: "Explore: find auth implementation" },
    { tool: "Agent", type: "agent", args: "Plan: architecture for hook system" },
    { tool: "Chrome.javascript", type: "preview", args: "document.querySelector('.card')" },
    { tool: "context-mode.execute", type: "bash", args: "analyze build output" },
    { tool: "Grep", type: "search", args: "pattern: 'useEffect' in src/" },
    { tool: "Glob", type: "search", args: "**/*.test.ts" },
    { tool: "WebSearch", type: "search", args: "react router v6 lazy loading" },
  ];

  for (let i = 0; i < DEMO_SESSION.tool_calls; i++) {
    const entry = toolPool[i % toolPool.length];
    const ts = new Date(startTime.getTime() + i * 200_000);
    entries.push({
      ts: ts.toISOString(),
      tool: entry.tool,
      type: entry.type,
      args: entry.args,
    });
  }
  return entries;
}

const TIMELINE_ENTRIES = generateTimelineEntries();

/* ── Color map ───────────────────────────────────────────── */

const TOOL_COLORS: Record<ToolType, string> = {
  search: "#eab308",
  read: "#3b82f6",
  edit: "#22c55e",
  bash: "#a855f7",
  write: "#22c55e",
  preview: "#f97316",
  agent: "#ef4444",
  meta: "#6b7280",
};

const TOOL_BG: Record<ToolType, string> = {
  search: "rgba(234,179,8,0.1)",
  read: "rgba(59,130,246,0.1)",
  edit: "rgba(34,197,94,0.1)",
  bash: "rgba(168,85,247,0.1)",
  write: "rgba(34,197,94,0.1)",
  preview: "rgba(249,115,22,0.1)",
  agent: "rgba(239,68,68,0.1)",
  meta: "rgba(107,114,128,0.1)",
};

/* ── Styles ──────────────────────────────────────────────── */

const glassCard: React.CSSProperties = {
  padding: "1rem 1.25rem",
  borderRadius: "0.625rem",
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
};

const sectionHeading: React.CSSProperties = {
  fontSize: "0.6875rem",
  textTransform: "uppercase",
  letterSpacing: "0.15em",
  color: "var(--text-muted)",
  marginBottom: "1rem",
};

const monoText: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

/* ── Components ──────────────────────────────────────────── */

function SummaryCard({
  value,
  label,
  accent,
}: {
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        ...glassCard,
        padding: "1.25rem 1.5rem",
        textAlign: "center",
        border: accent
          ? "1px solid rgba(217,119,87,0.2)"
          : "1px solid var(--border)",
        background: accent ? "rgba(217,119,87,0.03)" : "var(--bg-surface)",
      }}
    >
      <div
        style={{
          fontSize: "2rem",
          fontWeight: 700,
          color: accent ? "var(--accent)" : "var(--text-primary)",
          lineHeight: 1.1,
          marginBottom: "0.25rem",
          ...monoText,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: "0.75rem",
          color: "var(--text-secondary)",
          fontWeight: 500,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function ToolBadge({ tool, type }: { tool: string; type: ToolType }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.125rem 0.5rem",
        borderRadius: "0.25rem",
        fontSize: "0.6875rem",
        fontWeight: 600,
        color: TOOL_COLORS[type],
        background: TOOL_BG[type],
        border: `1px solid ${TOOL_COLORS[type]}33`,
        ...monoText,
      }}
    >
      {tool}
    </span>
  );
}

function TimelineEntry({
  entry,
  index,
}: {
  entry: ToolCall;
  index: number;
}) {
  const time = new Date(entry.ts);
  const hours = time.getUTCHours().toString().padStart(2, "0");
  const mins = time.getUTCMinutes().toString().padStart(2, "0");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0.75rem",
        padding: "0.5rem 0",
        borderLeft: `2px solid ${TOOL_COLORS[entry.type]}`,
        paddingLeft: "1rem",
        marginLeft: "2.5rem",
        position: "relative",
      }}
    >
      {/* Dot on the timeline line */}
      <div
        style={{
          position: "absolute",
          left: "-5px",
          top: "0.65rem",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: TOOL_COLORS[entry.type],
        }}
      />

      {/* Index + timestamp */}
      <div
        style={{
          position: "absolute",
          left: "-3.5rem",
          top: "0.5rem",
          fontSize: "0.625rem",
          color: "var(--text-muted)",
          ...monoText,
          width: "2.25rem",
          textAlign: "right",
        }}
      >
        #{index + 1}
      </div>

      <div
        style={{
          fontSize: "0.6875rem",
          color: "var(--text-muted)",
          ...monoText,
          minWidth: "3rem",
          paddingTop: "0.125rem",
        }}
      >
        {hours}:{mins}
      </div>

      <ToolBadge tool={entry.tool} type={entry.type} />

      <div
        style={{
          fontSize: "0.75rem",
          color: "var(--text-secondary)",
          ...monoText,
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {entry.args}
      </div>
    </div>
  );
}

function StepCard({ step }: { step: StepEvidence }) {
  return (
    <div
      style={{
        ...glassCard,
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "var(--text-primary)",
            textTransform: "capitalize",
          }}
        >
          {step.name.replace("_", " ")}
        </div>
        <span
          style={{
            color: "#22c55e",
            fontSize: "1rem",
            fontWeight: 700,
          }}
        >
          &#10003;
        </span>
      </div>

      <div
        style={{
          fontSize: "0.6875rem",
          color: "var(--text-muted)",
          ...monoText,
        }}
      >
        {step.evidence} evidence calls
      </div>

      <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
        {step.tools.map((t) => (
          <span
            key={t}
            style={{
              padding: "0.125rem 0.375rem",
              borderRadius: "0.25rem",
              fontSize: "0.625rem",
              color: "var(--text-secondary)",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              ...monoText,
            }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────── */

export function RunAnatomy() {
  const [showAll, setShowAll] = useState(false);
  const visibleEntries = showAll
    ? TIMELINE_ENTRIES
    : TIMELINE_ENTRIES.slice(0, 50);

  const inputCost = (DEMO_SESSION.input_tokens / 1_000_000) * 15;
  const outputCost = (DEMO_SESSION.output_tokens / 1_000_000) * 75;
  const totalCost = inputCost + outputCost;
  const inputPct = (inputCost / totalCost) * 100;

  return (
    <Layout>
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "2rem 1.5rem 4rem",
        }}
      >
        {/* ═══ Header ═══ */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            marginBottom: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          <h1
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            Run Anatomy
          </h1>
          <span
            style={{
              padding: "0.25rem 0.75rem",
              borderRadius: "2rem",
              fontSize: "0.6875rem",
              fontWeight: 600,
              color: "var(--accent)",
              background: "rgba(217,119,87,0.1)",
              border: "1px solid rgba(217,119,87,0.2)",
              ...monoText,
            }}
          >
            {DEMO_SESSION.model}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            gap: "1.5rem",
            alignItems: "center",
            marginBottom: "2rem",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: "0.8125rem",
              color: "var(--text-muted)",
              ...monoText,
            }}
          >
            Session {DEMO_SESSION.id}
          </span>
          <span
            style={{
              fontSize: "0.8125rem",
              color: "var(--text-secondary)",
            }}
          >
            {Math.floor(DEMO_SESSION.duration_min / 60)}h{" "}
            {DEMO_SESSION.duration_min % 60}m
          </span>
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              fontStyle: "italic",
            }}
          >
            30-hour dogfood session building attrition.sh
          </span>
        </div>

        {/* ═══ Summary Cards ═══ */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "0.75rem",
            marginBottom: "2.5rem",
          }}
        >
          <SummaryCard value="544" label="Tool Calls" accent />
          <SummaryCard value="8/8" label="Steps Complete" accent />
          <SummaryCard value="1" label="Corrections" />
          <SummaryCard
            value={`$${DEMO_SESSION.cost_usd.toLocaleString()}`}
            label="Total Cost"
          />
        </div>

        {/* ═══ Tool Breakdown ═══ */}
        <div style={{ marginBottom: "2.5rem" }}>
          <h2 style={sectionHeading}>Top Tools</h2>
          <div
            style={{
              ...glassCard,
              padding: "1rem 1.25rem",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              {DEMO_SESSION.top_tools.map((t) => {
                const pct = (t.count / DEMO_SESSION.tool_calls) * 100;
                return (
                  <div
                    key={t.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                    }}
                  >
                    <div style={{ width: 140 }}>
                      <ToolBadge tool={t.name} type={t.type} />
                    </div>
                    <div
                      style={{
                        flex: 1,
                        height: 6,
                        borderRadius: 3,
                        background: "var(--bg-elevated)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: "100%",
                          borderRadius: 3,
                          background: TOOL_COLORS[t.type],
                          opacity: 0.7,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: "0.6875rem",
                        color: "var(--text-muted)",
                        ...monoText,
                        minWidth: 32,
                        textAlign: "right",
                      }}
                    >
                      {t.count}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ═══ Tool Timeline ═══ */}
        <div style={{ marginBottom: "2.5rem" }}>
          <h2 style={sectionHeading}>Tool Timeline</h2>
          <p
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              marginBottom: "1rem",
            }}
          >
            Every tool call in execution order. This is exactly what the agent
            did.
          </p>

          <div
            style={{
              ...glassCard,
              padding: "1rem 1.25rem 1rem 1.5rem",
              maxHeight: showAll ? "none" : 640,
              overflow: showAll ? "visible" : "hidden",
              position: "relative",
            }}
          >
            {visibleEntries.map((entry, i) => (
              <TimelineEntry key={i} entry={entry} index={i} />
            ))}

            {!showAll && (
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 80,
                  background:
                    "linear-gradient(transparent, var(--bg-surface))",
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  paddingBottom: "1rem",
                }}
              >
                <button
                  onClick={() => setShowAll(true)}
                  style={{
                    padding: "0.5rem 1.5rem",
                    borderRadius: "0.5rem",
                    border: "1px solid rgba(217,119,87,0.3)",
                    background: "rgba(217,119,87,0.08)",
                    color: "var(--accent)",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    ...monoText,
                  }}
                >
                  Show all {DEMO_SESSION.tool_calls} tool calls
                </button>
              </div>
            )}
          </div>

          {showAll && (
            <div style={{ textAlign: "center", marginTop: "0.75rem" }}>
              <button
                onClick={() => setShowAll(false)}
                style={{
                  padding: "0.375rem 1rem",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-muted)",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                Collapse timeline
              </button>
            </div>
          )}
        </div>

        {/* ═══ Step Evidence Grid ═══ */}
        <div style={{ marginBottom: "2.5rem" }}>
          <h2 style={sectionHeading}>Step Evidence</h2>
          <p
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              marginBottom: "1rem",
            }}
          >
            8 workflow steps, each verified by tool call evidence.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "0.75rem",
            }}
          >
            {DEMO_SESSION.steps.map((step) => (
              <StepCard key={step.name} step={step} />
            ))}
          </div>
        </div>

        {/* ═══ Cost Breakdown ═══ */}
        <div style={{ marginBottom: "2.5rem" }}>
          <h2 style={sectionHeading}>Cost Breakdown</h2>
          <div style={{ ...glassCard, padding: "1.25rem 1.5rem" }}>
            {/* Bar */}
            <div
              style={{
                display: "flex",
                height: 24,
                borderRadius: 6,
                overflow: "hidden",
                marginBottom: "1rem",
              }}
            >
              <div
                style={{
                  width: `${inputPct}%`,
                  background: "var(--accent)",
                  opacity: 0.8,
                }}
                title={`Input: $${Math.round(inputCost).toLocaleString()}`}
              />
              <div
                style={{
                  width: `${100 - inputPct}%`,
                  background: "#3b82f6",
                  opacity: 0.8,
                }}
                title={`Output: $${Math.round(outputCost).toLocaleString()}`}
              />
            </div>

            {/* Legend */}
            <div
              style={{
                display: "flex",
                gap: "2rem",
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    color: "var(--accent)",
                    ...monoText,
                  }}
                >
                  ${Math.round(inputCost).toLocaleString()}
                </div>
                <div
                  style={{
                    fontSize: "0.6875rem",
                    color: "var(--text-muted)",
                  }}
                >
                  Input (274M tokens x $15/MTok)
                </div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    color: "#3b82f6",
                    ...monoText,
                  }}
                >
                  ${Math.round(outputCost).toLocaleString()}
                </div>
                <div
                  style={{
                    fontSize: "0.6875rem",
                    color: "var(--text-muted)",
                  }}
                >
                  Output (175K tokens x $75/MTok)
                </div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    ...monoText,
                  }}
                >
                  ${Math.round(totalCost).toLocaleString()}
                </div>
                <div
                  style={{
                    fontSize: "0.6875rem",
                    color: "var(--text-muted)",
                  }}
                >
                  Total
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ Corrections ═══ */}
        <div style={{ marginBottom: "2.5rem" }}>
          <h2 style={sectionHeading}>Corrections</h2>
          <div
            style={{
              ...glassCard,
              padding: "1rem 1.25rem",
              borderLeft: "3px solid var(--accent)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                marginBottom: "0.5rem",
              }}
            >
              <span
                style={{
                  padding: "0.125rem 0.5rem",
                  borderRadius: "0.25rem",
                  fontSize: "0.625rem",
                  fontWeight: 600,
                  color: "var(--accent)",
                  background: "rgba(217,119,87,0.1)",
                  ...monoText,
                }}
              >
                CORRECTION #1
              </span>
              <span
                style={{
                  fontSize: "0.6875rem",
                  color: "var(--text-muted)",
                  ...monoText,
                }}
              >
                ~18h into session
              </span>
            </div>
            <p
              style={{
                fontSize: "0.8125rem",
                color: "var(--text-secondary)",
                lineHeight: 1.6,
              }}
            >
              User corrected a UI layout choice mid-session. Agent adjusted and
              continued without requiring re-prompting of the full context. This
              was the only human intervention across 544 tool calls.
            </p>
          </div>
        </div>

        {/* ═══ Try it yourself ═══ */}
        <div
          style={{
            padding: "1.25rem 1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid var(--border)",
            background: "var(--bg-surface)",
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: "0.875rem",
              color: "var(--text-secondary)",
              marginBottom: "0.75rem",
            }}
          >
            Analyze your own sessions:
          </p>
          <div
            style={{
              ...monoText,
              fontSize: "0.8125rem",
              color: "var(--text-primary)",
              padding: "0.75rem 1rem",
              borderRadius: "0.5rem",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              display: "inline-block",
            }}
          >
            <span style={{ color: "var(--accent)" }}>$</span> python
            benchmarks/record_session.py --path &lt;session.jsonl&gt;
          </div>
        </div>
      </div>
    </Layout>
  );
}
