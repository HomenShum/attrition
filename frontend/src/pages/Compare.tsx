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

// --------------------------------------------------------------------------
// Event type colors
// --------------------------------------------------------------------------

type EventType = "Think" | "ToolCall" | "FileEdit" | "Search" | "Decision" | "Assert" | "Other";

const EVENT_COLORS: Record<EventType, string> = {
  Think: "#a0a0a0",
  ToolCall: "#63b3ed",
  FileEdit: "#48bb78",
  Search: "#ecc94b",
  Decision: "#a882ff",
  Assert: "#ef4444",
  Other: "#6b7280",
};

function mapEventType(raw: CanonicalEventRaw): EventType {
  const t = String(raw.type).toLowerCase();
  if (t === "think") return "Think";
  if (t === "tool_call") return "ToolCall";
  if (t === "file_edit" || t === "file_create") return "FileEdit";
  if (t === "search") return "Search";
  if (t === "decision") return "Decision";
  if (t === "assert") return "Assert";
  return "Other";
}

function eventSummary(raw: CanonicalEventRaw): string {
  const t = String(raw.type).toLowerCase();
  if (t === "think") return String(raw.content ?? "").slice(0, 80);
  if (t === "tool_call") return `${raw.tool}: ${JSON.stringify(raw.args ?? {}).slice(0, 60)}`;
  if (t === "file_edit") return `Edit ${raw.path ?? ""}`;
  if (t === "file_create") return `Create ${raw.path ?? ""}`;
  if (t === "search") return `Search: ${raw.query ?? ""}`;
  if (t === "assert") return `Assert: ${raw.condition ?? ""}`;
  return JSON.stringify(raw).slice(0, 80);
}

function eventTokenEstimate(raw: CanonicalEventRaw): number {
  // Rough estimate: sum up string lengths / 4 as proxy for tokens
  const json = JSON.stringify(raw);
  return Math.round(json.length / 4);
}

// --------------------------------------------------------------------------
// Mini event row
// --------------------------------------------------------------------------

function EventRow({
  event,
  index,
  highlighted,
}: {
  event: CanonicalEventRaw;
  index: number;
  highlighted?: boolean;
}) {
  const type = mapEventType(event);
  const summary = eventSummary(event);
  const tokens = eventTokenEstimate(event);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.375rem 0.625rem",
        borderRadius: "0.375rem",
        border: highlighted
          ? "1px solid rgba(239,68,68,0.3)"
          : "1px solid transparent",
        background: highlighted ? "rgba(239,68,68,0.04)" : "transparent",
        transition: "background 0.1s",
      }}
    >
      <span
        style={{
          fontSize: "0.625rem",
          color: "var(--text-muted)",
          fontFamily: "'JetBrains Mono', monospace",
          minWidth: 16,
        }}
      >
        {index + 1}
      </span>
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: 2,
          background: EVENT_COLORS[type],
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: "0.75rem",
          color: "var(--text-secondary)",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {summary}
      </span>
      <span
        style={{
          fontSize: "0.625rem",
          fontFamily: "'JetBrains Mono', monospace",
          color: "var(--text-muted)",
          flexShrink: 0,
        }}
      >
        {tokens}t
      </span>
    </div>
  );
}

// --------------------------------------------------------------------------
// Stat card
// --------------------------------------------------------------------------

function StatCard({
  label,
  valueA,
  valueB,
  format,
  higherIsBetter,
}: {
  label: string;
  valueA: number;
  valueB: number;
  format: (v: number) => string;
  higherIsBetter?: boolean;
}) {
  const aWins = higherIsBetter ? valueA >= valueB : valueA <= valueB;
  const bWins = !aWins;

  return (
    <div
      style={{
        padding: "1rem",
        borderRadius: "0.625rem",
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
      }}
    >
      <div
        style={{
          fontSize: "0.625rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--text-muted)",
          marginBottom: "0.5rem",
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "1.125rem",
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              color: aWins ? "#48bb78" : "var(--text-primary)",
            }}
          >
            {format(valueA)}
          </div>
          <div style={{ fontSize: "0.625rem", color: "var(--text-muted)" }}>
            Model A
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: "1.125rem",
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              color: bWins ? "#48bb78" : "var(--text-primary)",
            }}
          >
            {format(valueB)}
          </div>
          <div style={{ fontSize: "0.625rem", color: "var(--text-muted)" }}>
            Model B
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Connection lines
// --------------------------------------------------------------------------

function ConnectionLines({
  countA,
  countB,
}: {
  countA: number;
  countB: number;
}) {
  const maxCount = Math.max(countA, countB);
  const lineHeight = 28;
  const totalHeight = maxCount * lineHeight;
  const connectedCount = Math.min(countA, countB);

  return (
    <svg
      width="40"
      height={totalHeight}
      style={{ flexShrink: 0 }}
      viewBox={`0 0 40 ${totalHeight}`}
    >
      {Array.from({ length: connectedCount }).map((_, i) => {
        const yA =
          countA > 0 ? i * (totalHeight / countA) + lineHeight / 2 : 0;
        const yB =
          countB > 0 ? i * (totalHeight / countB) + lineHeight / 2 : 0;
        const diverges = Math.abs(yA - yB) > lineHeight;
        return (
          <line
            key={i}
            x1={0}
            y1={yA}
            x2={40}
            y2={yB}
            stroke={
              diverges
                ? "rgba(239,68,68,0.3)"
                : "rgba(255,255,255,0.06)"
            }
            strokeWidth={1}
          />
        );
      })}
    </svg>
  );
}

// --------------------------------------------------------------------------
// Comparison detail
// --------------------------------------------------------------------------

function ComparisonDetail({
  workflowA,
  workflowB,
}: {
  workflowA: WorkflowDetail;
  workflowB: WorkflowDetail;
}) {
  const eventsA = workflowA.events;
  const eventsB = workflowB.events;

  const tokensA = eventsA.reduce((s, e) => s + eventTokenEstimate(e), 0);
  const tokensB = eventsB.reduce((s, e) => s + eventTokenEstimate(e), 0);

  // Identify divergent events
  const divergentIndices = new Set<number>();
  const maxLen = Math.max(eventsA.length, eventsB.length);
  for (let i = 0; i < maxLen; i++) {
    const a = eventsA[i];
    const b = eventsB[i];
    if (!a || !b) {
      divergentIndices.add(i);
    } else if (mapEventType(a) !== mapEventType(b)) {
      divergentIndices.add(i);
    }
  }

  return (
    <div>
      {/* Stats comparison */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "0.75rem",
          marginBottom: "2rem",
        }}
      >
        <StatCard
          label="Events"
          valueA={eventsA.length}
          valueB={eventsB.length}
          format={(v) => String(v)}
        />
        <StatCard
          label="Est. Tokens"
          valueA={tokensA}
          valueB={tokensB}
          format={(v) => v.toLocaleString()}
        />
      </div>

      {/* Side-by-side event timelines */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 40px 1fr",
          gap: 0,
        }}
      >
        {/* Model A column */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "0.75rem",
              paddingBottom: "0.5rem",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span
              style={{
                padding: "0.1875rem 0.625rem",
                borderRadius: "9999px",
                fontSize: "0.75rem",
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                background: "rgba(217,119,87,0.12)",
                color: "var(--accent)",
                border: "1px solid rgba(217,119,87,0.2)",
              }}
            >
              {workflowA.source_model}
            </span>
            <span
              style={{
                fontSize: "0.6875rem",
                color: "var(--text-muted)",
              }}
            >
              {eventsA.length} events
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {eventsA.map((event, i) => (
              <EventRow
                key={i}
                event={event}
                index={i}
                highlighted={divergentIndices.has(i)}
              />
            ))}
          </div>
        </div>

        {/* Connection lines */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            paddingTop: 40,
          }}
        >
          <ConnectionLines
            countA={eventsA.length}
            countB={eventsB.length}
          />
        </div>

        {/* Model B column */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "0.75rem",
              paddingBottom: "0.5rem",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span
              style={{
                padding: "0.1875rem 0.625rem",
                borderRadius: "9999px",
                fontSize: "0.75rem",
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                background: "rgba(99,179,237,0.12)",
                color: "#63b3ed",
                border: "1px solid rgba(99,179,237,0.2)",
              }}
            >
              {workflowB.source_model}
            </span>
            <span
              style={{
                fontSize: "0.6875rem",
                color: "var(--text-muted)",
              }}
            >
              {eventsB.length} events
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {eventsB.map((event, i) => (
              <EventRow
                key={i}
                event={event}
                index={i}
                highlighted={divergentIndices.has(i)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          marginTop: "1.25rem",
          paddingTop: "1rem",
          borderTop: "1px solid var(--border)",
          fontSize: "0.6875rem",
          color: "var(--text-muted)",
          flexWrap: "wrap",
        }}
      >
        {Object.entries(EVENT_COLORS).map(([type, color]) => (
          <div
            key={type}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: color,
              }}
            />
            {type}
          </div>
        ))}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.25rem",
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              border: "1px solid rgba(239,68,68,0.5)",
              background: "rgba(239,68,68,0.1)",
            }}
          />
          Divergent
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Main component
// --------------------------------------------------------------------------

export function Compare() {
  const [searchParams] = useSearchParams();
  const idA = searchParams.get("a");
  const idB = searchParams.get("b");

  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowA, setWorkflowA] = useState<WorkflowDetail | null>(null);
  const [workflowB, setWorkflowB] = useState<WorkflowDetail | null>(null);
  const [selectedA, setSelectedA] = useState(idA ?? "");
  const [selectedB, setSelectedB] = useState(idB ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load workflow list
  useEffect(() => {
    listWorkflows()
      .then((wfs) => {
        setWorkflows(wfs);
        // Auto-select first two if no params
        if (!idA && wfs.length >= 1) setSelectedA(wfs[0].id);
        if (!idB && wfs.length >= 2) setSelectedB(wfs[1].id);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });
  }, [idA, idB]);

  // Load selected workflows
  useEffect(() => {
    if (selectedA) {
      getWorkflow(selectedA)
        .then(setWorkflowA)
        .catch(() => setWorkflowA(null));
    }
  }, [selectedA]);

  useEffect(() => {
    if (selectedB) {
      getWorkflow(selectedB)
        .then(setWorkflowB)
        .catch(() => setWorkflowB(null));
    }
  }, [selectedB]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <Layout>
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "2rem 1.5rem",
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: "1.5rem" }}>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              marginBottom: "0.25rem",
            }}
          >
            Model Compare
          </h1>
          <p
            style={{
              fontSize: "0.875rem",
              color: "var(--text-muted)",
            }}
          >
            Compare how different models execute the same workflow.
          </p>
        </div>

        {/* Loading */}
        {loading && (
          <div
            style={{
              padding: "3rem",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "0.875rem",
            }}
          >
            Loading workflows...
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div
            style={{
              padding: "3rem 2rem",
              textAlign: "center",
              borderRadius: "0.75rem",
              border: "1px solid rgba(239,68,68,0.15)",
              background: "rgba(239,68,68,0.04)",
            }}
          >
            <h3
              style={{
                fontSize: "1.125rem",
                fontWeight: 600,
                color: "#ef4444",
                marginBottom: "0.5rem",
              }}
            >
              Backend unreachable
            </h3>
            <p
              style={{
                fontSize: "0.875rem",
                color: "var(--text-secondary)",
                marginBottom: "1rem",
              }}
            >
              Start the server to load workflow data:
            </p>
            <div
              style={{
                display: "inline-block",
                padding: "0.75rem 1.25rem",
                borderRadius: "0.5rem",
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.8125rem",
                color: "var(--text-secondary)",
              }}
            >
              <span style={{ color: "var(--accent)" }}>$</span> bp serve
              --port 8100
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && workflows.length < 2 && (
          <div
            style={{
              padding: "4rem 2rem",
              textAlign: "center",
              borderRadius: "0.75rem",
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
            }}
          >
            <div
              style={{
                fontSize: "2rem",
                marginBottom: "1rem",
                opacity: 0.3,
              }}
            >
              {"\u2194"}
            </div>
            <h3
              style={{
                fontSize: "1.125rem",
                fontWeight: 600,
                marginBottom: "0.75rem",
              }}
            >
              {workflows.length === 0
                ? "No workflows captured yet"
                : "Need at least 2 workflows to compare"}
            </h3>
            <p
              style={{
                fontSize: "0.875rem",
                color: "var(--text-secondary)",
                maxWidth: 480,
                margin: "0 auto",
                lineHeight: 1.6,
              }}
            >
              Capture two workflows from different models, then compare their
              event timelines side by side.
            </p>
            <div
              style={{
                marginTop: "1.5rem",
                padding: "0.875rem 1.25rem",
                borderRadius: "0.5rem",
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.8125rem",
                color: "var(--text-secondary)",
                display: "inline-block",
              }}
            >
              <span style={{ color: "var(--accent)" }}>$</span> bp compare
              --workflow wf_01 --models opus-4-6,sonnet-4-6
            </div>
          </div>
        )}

        {/* Workflow selector + comparison */}
        {!loading && !error && workflows.length >= 2 && (
          <div>
            {/* Selectors */}
            <div
              style={{
                display: "flex",
                gap: "1rem",
                marginBottom: "1.5rem",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div>
                <label
                  style={{
                    fontSize: "0.625rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--text-muted)",
                    display: "block",
                    marginBottom: "0.25rem",
                  }}
                >
                  Workflow A
                </label>
                <select
                  value={selectedA}
                  onChange={(e) => setSelectedA(e.target.value)}
                  style={{
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.375rem",
                    border: "1px solid var(--border)",
                    background: "var(--bg-surface)",
                    color: "var(--text-primary)",
                    fontSize: "0.8125rem",
                    minWidth: 200,
                  }}
                >
                  {workflows.map((wf) => (
                    <option key={wf.id} value={wf.id}>
                      {wf.name} ({wf.source_model})
                    </option>
                  ))}
                </select>
              </div>
              <span
                style={{
                  color: "var(--text-muted)",
                  fontSize: "1rem",
                  paddingTop: "1rem",
                }}
              >
                vs
              </span>
              <div>
                <label
                  style={{
                    fontSize: "0.625rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--text-muted)",
                    display: "block",
                    marginBottom: "0.25rem",
                  }}
                >
                  Workflow B
                </label>
                <select
                  value={selectedB}
                  onChange={(e) => setSelectedB(e.target.value)}
                  style={{
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.375rem",
                    border: "1px solid var(--border)",
                    background: "var(--bg-surface)",
                    color: "var(--text-primary)",
                    fontSize: "0.8125rem",
                    minWidth: 200,
                  }}
                >
                  {workflows.map((wf) => (
                    <option key={wf.id} value={wf.id}>
                      {wf.name} ({wf.source_model})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Detail */}
            {workflowA && workflowB && (
              <div
                style={{
                  padding: "1.5rem",
                  borderRadius: "0.75rem",
                  border: "1px solid var(--border)",
                  background: "var(--bg-surface)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "1.5rem",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                  }}
                >
                  <h2 style={{ fontSize: "1.125rem", fontWeight: 600 }}>
                    {workflowA.name} vs {workflowB.name}
                  </h2>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    {formatDate(workflowA.captured_at)}
                  </span>
                </div>
                <ComparisonDetail
                  workflowA={workflowA}
                  workflowB={workflowB}
                />
              </div>
            )}

            {(!workflowA || !workflowB) && (
              <div
                style={{
                  padding: "2rem",
                  textAlign: "center",
                  color: "var(--text-muted)",
                }}
              >
                Select two workflows above to compare them.
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
