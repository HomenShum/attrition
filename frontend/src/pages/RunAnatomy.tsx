import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import {
  listWorkflows,
  getWorkflow,
  type WorkflowDetail,
  type WorkflowSummary,
  type CanonicalEventRaw,
} from "../lib/api";

/* ── Types ───────────────────────────────────────────── */

type ToolType =
  | "search"
  | "read"
  | "edit"
  | "bash"
  | "preview"
  | "agent"
  | "meta"
  | "write"
  | "think"
  | "assert"
  | "decision"
  | "other";

/* ── Color map ───────────────────────────────────────── */

const TOOL_COLORS: Record<ToolType, string> = {
  search: "#eab308",
  read: "#3b82f6",
  edit: "#22c55e",
  bash: "#a855f7",
  write: "#22c55e",
  preview: "#f97316",
  agent: "#ef4444",
  meta: "#6b7280",
  think: "#a0a0a0",
  assert: "#ef4444",
  decision: "#a882ff",
  other: "#6b7280",
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
  think: "rgba(160,160,160,0.1)",
  assert: "rgba(239,68,68,0.1)",
  decision: "rgba(168,130,255,0.1)",
  other: "rgba(107,114,128,0.1)",
};

function classifyEvent(event: CanonicalEventRaw): ToolType {
  const t = (event.type as string).toLowerCase();
  if (t === "think") return "think";
  if (t === "search") return "search";
  if (t === "file_edit") return "edit";
  if (t === "file_create") return "write";
  if (t === "tool_call") {
    const tool = String(event.tool ?? "").toLowerCase();
    if (tool.includes("bash")) return "bash";
    if (tool.includes("read")) return "read";
    if (tool.includes("edit") || tool.includes("write")) return "edit";
    if (tool.includes("grep") || tool.includes("glob") || tool.includes("search")) return "search";
    if (tool.includes("chrome") || tool.includes("preview")) return "preview";
    if (tool.includes("agent")) return "agent";
    if (tool.includes("todo")) return "meta";
    return "bash";
  }
  if (t === "assert") return "assert";
  if (t === "decision") return "decision";
  if (t === "checkpoint") return "meta";
  if (t === "nudge") return "meta";
  return "other";
}

function eventSummary(event: CanonicalEventRaw): string {
  const t = (event.type as string).toLowerCase();
  if (t === "think") return String(event.content ?? "").slice(0, 100);
  if (t === "tool_call") return `${event.tool}: ${JSON.stringify(event.args ?? {}).slice(0, 80)}`;
  if (t === "file_edit") return `Edit ${event.path ?? "unknown"}`;
  if (t === "file_create") return `Create ${event.path ?? "unknown"}`;
  if (t === "search") return `Search: ${event.query ?? ""}`;
  if (t === "assert") return `Assert: ${event.condition ?? ""}`;
  if (t === "decision") return `Decision: ${event.content ?? ""}`;
  if (t === "checkpoint") return `Checkpoint: ${event.label ?? event.state_hash ?? ""}`;
  return JSON.stringify(event).slice(0, 100);
}

function eventDuration(event: CanonicalEventRaw): number {
  return Number(event.duration_ms ?? 0);
}

/* ── Styles ──────────────────────────────────────────── */

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

/* ── Components ──────────────────────────────────────── */

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
  event,
  index,
}: {
  event: CanonicalEventRaw;
  index: number;
}) {
  const type = classifyEvent(event);
  const summary = eventSummary(event);
  const dur = eventDuration(event);
  const durStr = dur > 0 ? `${(dur / 1000).toFixed(1)}s` : "";
  const label = event.type === "tool_call" ? String(event.tool ?? event.type) : String(event.type);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0.75rem",
        padding: "0.5rem 0",
        borderLeft: `2px solid ${TOOL_COLORS[type]}`,
        paddingLeft: "1rem",
        marginLeft: "2.5rem",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "-5px",
          top: "0.65rem",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: TOOL_COLORS[type],
        }}
      />
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
        {durStr}
      </div>
      <ToolBadge tool={label} type={type} />
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
        {summary}
      </div>
    </div>
  );
}

function ServerDownBanner() {
  return (
    <div
      style={{
        padding: "3rem 2rem",
        textAlign: "center",
        borderRadius: "0.75rem",
        border: "1px solid rgba(239,68,68,0.15)",
        background: "rgba(239,68,68,0.04)",
      }}
    >
      <h3 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#ef4444", marginBottom: "0.5rem" }}>
        Backend unreachable
      </h3>
      <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
        Start the server to load workflow data:
      </p>
      <div
        style={{
          display: "inline-block",
          padding: "0.75rem 1.25rem",
          borderRadius: "0.5rem",
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          ...monoText,
          fontSize: "0.8125rem",
          color: "var(--text-secondary)",
        }}
      >
        <span style={{ color: "var(--accent)" }}>$</span> bp serve --port 8100
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: "4rem 2rem",
        textAlign: "center",
        borderRadius: "0.75rem",
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
      }}
    >
      <h3 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.75rem" }}>
        No workflows to analyze
      </h3>
      <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", maxWidth: 480, margin: "0 auto 1.5rem", lineHeight: 1.6 }}>
        Capture a session first, then navigate here to see the full event timeline, tool breakdown, and cost analysis.
      </p>
      <div
        style={{
          display: "inline-block",
          padding: "0.75rem 1.25rem",
          borderRadius: "0.5rem",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          ...monoText,
          fontSize: "0.8125rem",
          color: "var(--text-secondary)",
        }}
      >
        <span style={{ color: "var(--accent)" }}>$</span> bp capture {"<session.jsonl>"}
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────── */

export function RunAnatomy() {
  const [searchParams] = useSearchParams();
  const workflowId = searchParams.get("workflow");

  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [allWorkflows, setAllWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        if (workflowId) {
          const wf = await getWorkflow(workflowId);
          setWorkflow(wf);
        } else {
          // No ID provided -- try loading the latest workflow
          const wfs = await listWorkflows();
          setAllWorkflows(wfs);
          if (wfs.length > 0) {
            const latest = await getWorkflow(wfs[0].id);
            setWorkflow(latest);
          }
        }
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      }
    }
    load();
  }, [workflowId]);

  if (loading) {
    return (
      <Layout>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "3rem 1.5rem", textAlign: "center", color: "var(--text-muted)" }}>
          Loading workflow...
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
          <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "1.5rem" }}>Run Anatomy</h1>
          <ServerDownBanner />
        </div>
      </Layout>
    );
  }

  if (!workflow) {
    return (
      <Layout>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
          <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "1.5rem" }}>Run Anatomy</h1>
          <EmptyState />
        </div>
      </Layout>
    );
  }

  // Compute stats from real data
  const events = workflow.events;
  const totalEvents = events.length;
  const totalDurationMs = events.reduce((sum, e) => sum + eventDuration(e), 0);
  const durationMin = Math.round(totalDurationMs / 60000);

  // Build tool frequency map
  const toolFreq: Record<string, { count: number; type: ToolType }> = {};
  for (const event of events) {
    const type = classifyEvent(event);
    const label = event.type === "tool_call" ? String(event.tool ?? "ToolCall") : String(event.type);
    if (!toolFreq[label]) toolFreq[label] = { count: 0, type };
    toolFreq[label].count++;
  }
  const topTools = Object.entries(toolFreq)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  // Token cost from metadata
  const meta = workflow.metadata;
  const inputTokens = meta.total_tokens.input_tokens;
  const outputTokens = meta.total_tokens.output_tokens;
  const inputCost = (inputTokens / 1_000_000) * 15;
  const outputCost = (outputTokens / 1_000_000) * 75;
  const totalCost = inputCost + outputCost;
  const hasCostData = inputTokens > 0 || outputTokens > 0;
  const inputPct = totalCost > 0 ? (inputCost / totalCost) * 100 : 50;

  const visibleEntries = showAll ? events : events.slice(0, 50);

  return (
    <Layout>
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "2rem 1.5rem 4rem",
        }}
      >
        {/* Header */}
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
            {workflow.source_model}
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
            {workflow.name}
          </span>
          {durationMin > 0 && (
            <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
              {Math.floor(durationMin / 60)}h {durationMin % 60}m
            </span>
          )}
          {!workflowId && allWorkflows && allWorkflows.length > 1 && (
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                fontStyle: "italic",
              }}
            >
              Showing latest of {allWorkflows.length} workflows
            </span>
          )}
        </div>

        {/* Summary Cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "0.75rem",
            marginBottom: "2.5rem",
          }}
        >
          <SummaryCard value={String(totalEvents)} label="Events" accent />
          <SummaryCard
            value={`${topTools.length}`}
            label="Unique Tools"
          />
          <SummaryCard
            value={hasCostData ? `$${totalCost.toFixed(2)}` : "N/A"}
            label="Est. Cost"
          />
          <SummaryCard value={workflow.fingerprint.slice(0, 8)} label="Fingerprint" />
        </div>

        {/* Top Tools */}
        {topTools.length > 0 && (
          <div style={{ marginBottom: "2.5rem" }}>
            <h2 style={sectionHeading}>Top Tools</h2>
            <div style={{ ...glassCard, padding: "1rem 1.25rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {topTools.map(([name, { count, type }]) => {
                  const pct = (count / totalEvents) * 100;
                  return (
                    <div
                      key={name}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                      }}
                    >
                      <div style={{ width: 140 }}>
                        <ToolBadge tool={name} type={type} />
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
                            background: TOOL_COLORS[type],
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
                        {count}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Event Timeline */}
        <div style={{ marginBottom: "2.5rem" }}>
          <h2 style={sectionHeading}>Event Timeline</h2>
          <p
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              marginBottom: "1rem",
            }}
          >
            Every event in execution order from the canonical workflow.
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
            {visibleEntries.map((event, i) => (
              <TimelineEntry key={i} event={event} index={i} />
            ))}

            {!showAll && totalEvents > 50 && (
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 80,
                  background: "linear-gradient(transparent, var(--bg-surface))",
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
                  Show all {totalEvents} events
                </button>
              </div>
            )}
          </div>

          {showAll && totalEvents > 50 && (
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

        {/* Cost Breakdown (only if metadata has tokens) */}
        {hasCostData && (
          <div style={{ marginBottom: "2.5rem" }}>
            <h2 style={sectionHeading}>Cost Breakdown</h2>
            <div style={{ ...glassCard, padding: "1.25rem 1.5rem" }}>
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
                  style={{ width: `${inputPct}%`, background: "var(--accent)", opacity: 0.8 }}
                  title={`Input: $${inputCost.toFixed(2)}`}
                />
                <div
                  style={{ width: `${100 - inputPct}%`, background: "#3b82f6", opacity: 0.8 }}
                  title={`Output: $${outputCost.toFixed(2)}`}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "2rem",
                  justifyContent: "center",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--accent)", ...monoText }}>
                    ${inputCost.toFixed(2)}
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>
                    Input ({(inputTokens / 1000).toFixed(0)}K tokens)
                  </div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#3b82f6", ...monoText }}>
                    ${outputCost.toFixed(2)}
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>
                    Output ({(outputTokens / 1000).toFixed(0)}K tokens)
                  </div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", ...monoText }}>
                    ${totalCost.toFixed(2)}
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>Total</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Analyze your own */}
        <div
          style={{
            padding: "1.25rem 1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid var(--border)",
            background: "var(--bg-surface)",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "0.75rem" }}>
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
            <span style={{ color: "var(--accent)" }}>$</span> bp capture {"<session.jsonl>"} --name my-workflow
          </div>
        </div>
      </div>
    </Layout>
  );
}
