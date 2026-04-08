import { useState, useEffect } from "react";
import { Layout } from "../components/Layout";
import {
  seedDemoData,
  getComparisons,
  type ModelComparison,
  type CanonicalEvent,
  type EventType,
} from "../lib/demo-data";

// --------------------------------------------------------------------------
// Event type colors (consistent with Distill page)
// --------------------------------------------------------------------------

const EVENT_COLORS: Record<EventType, string> = {
  Think:    "#a0a0a0",
  ToolCall: "#63b3ed",
  FileEdit: "#48bb78",
  Search:   "#ecc94b",
  Decision: "#a882ff",
  Assert:   "#ef4444",
};

// --------------------------------------------------------------------------
// Mini event row
// --------------------------------------------------------------------------

function EventRow({
  event,
  index,
  highlighted,
}: {
  event: CanonicalEvent;
  index: number;
  highlighted?: boolean;
}) {
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
          background: EVENT_COLORS[event.type],
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
        {event.summary}
      </span>
      <span
        style={{
          fontSize: "0.625rem",
          fontFamily: "'JetBrains Mono', monospace",
          color: "var(--text-muted)",
          flexShrink: 0,
        }}
      >
        {event.tokens}t
      </span>
    </div>
  );
}

// --------------------------------------------------------------------------
// Stat card
// --------------------------------------------------------------------------

function StatCard({
  label,
  modelA,
  modelB,
  format,
  higherIsBetter,
}: {
  label: string;
  modelA: number;
  modelB: number;
  format: (v: number) => string;
  higherIsBetter?: boolean;
}) {
  const aWins = higherIsBetter ? modelA >= modelB : modelA <= modelB;
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
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
        <div>
          <div
            style={{
              fontSize: "1.125rem",
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              color: aWins ? "#48bb78" : "var(--text-primary)",
            }}
          >
            {format(modelA)}
          </div>
          <div style={{ fontSize: "0.625rem", color: "var(--text-muted)" }}>Model A</div>
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
            {format(modelB)}
          </div>
          <div style={{ fontSize: "0.625rem", color: "var(--text-muted)" }}>Model B</div>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Connection lines (SVG overlay)
// --------------------------------------------------------------------------

function ConnectionLines({ countA, countB }: { countA: number; countB: number }) {
  const maxCount = Math.max(countA, countB);
  const lineHeight = 28; // approximate row height
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
        const yA = i * (totalHeight / countA) + lineHeight / 2;
        const yB = i * (totalHeight / countB) + lineHeight / 2;
        const diverges = Math.abs(yA - yB) > lineHeight;
        return (
          <line
            key={i}
            x1={0}
            y1={yA}
            x2={40}
            y2={yB}
            stroke={diverges ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.06)"}
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

function ComparisonDetail({ comparison }: { comparison: ModelComparison }) {
  const { modelA, modelB } = comparison;

  // Identify divergent events (events that exist in A but differ in B)
  const divergentIndices = new Set<number>();
  const maxLen = Math.max(modelA.events.length, modelB.events.length);
  for (let i = 0; i < maxLen; i++) {
    const a = modelA.events[i];
    const b = modelB.events[i];
    if (!a || !b) {
      divergentIndices.add(i);
    } else if (a.type !== b.type || Math.abs(a.tokens - b.tokens) / a.tokens > 0.2) {
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
          label="Tokens"
          modelA={modelA.tokens}
          modelB={modelB.tokens}
          format={(v) => v.toLocaleString()}
        />
        <StatCard
          label="Cost"
          modelA={modelA.cost}
          modelB={modelB.cost}
          format={(v) => `$${v.toFixed(2)}`}
        />
        <StatCard
          label="Duration"
          modelA={modelA.durationMs}
          modelB={modelB.durationMs}
          format={(v) => `${(v / 1000).toFixed(1)}s`}
        />
        <StatCard
          label="Judge Score"
          modelA={modelA.judgeScore}
          modelB={modelB.judgeScore}
          format={(v) => `${v}/100`}
          higherIsBetter
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
              {modelA.name}
            </span>
            <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>
              {modelA.events.length} events
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {modelA.events.map((event, i) => (
              <EventRow
                key={event.id}
                event={event}
                index={i}
                highlighted={divergentIndices.has(i)}
              />
            ))}
          </div>
        </div>

        {/* Connection lines */}
        <div style={{ display: "flex", alignItems: "flex-start", paddingTop: 40 }}>
          <ConnectionLines
            countA={modelA.events.length}
            countB={modelB.events.length}
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
              {modelB.name}
            </span>
            <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>
              {modelB.events.length} events
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {modelB.events.map((event, i) => (
              <EventRow
                key={event.id}
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
          <div key={type} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
            {type}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
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
  const [comparisons, setComparisons] = useState<ModelComparison[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    seedDemoData();
    const cmps = getComparisons();
    setComparisons(cmps);
    if (cmps.length > 0) setSelectedId(cmps[0].id);
    setLoading(false);
  }, []);

  const selected = comparisons.find((c) => c.id === selectedId) ?? null;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Layout>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.5rem" }}>
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
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
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
            Loading comparisons...
          </div>
        )}

        {/* Empty state */}
        {!loading && comparisons.length === 0 && (
          <div
            style={{
              padding: "4rem 2rem",
              textAlign: "center",
              borderRadius: "0.75rem",
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
            }}
          >
            <div style={{ fontSize: "2rem", marginBottom: "1rem", opacity: 0.3 }}>
              {"\u2194"}
            </div>
            <h3
              style={{
                fontSize: "1.125rem",
                fontWeight: 600,
                marginBottom: "0.75rem",
              }}
            >
              No comparisons yet
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
              Model Compare replays the same captured workflow through two different models,
              then shows a side-by-side diff of their event timelines, tokens, cost, and judge scores.
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
              <span style={{ color: "var(--accent)" }}>$</span> bp compare --workflow wf_01
              --models opus-4-6,sonnet-4-6
            </div>
          </div>
        )}

        {/* Comparison selector + detail */}
        {!loading && comparisons.length > 0 && (
          <div>
            {/* Comparison tabs */}
            {comparisons.length > 1 && (
              <div
                style={{
                  display: "flex",
                  gap: "0.375rem",
                  marginBottom: "1.5rem",
                }}
              >
                {comparisons.map((cmp) => (
                  <button
                    key={cmp.id}
                    onClick={() => setSelectedId(cmp.id)}
                    style={{
                      padding: "0.5rem 1rem",
                      borderRadius: "0.5rem",
                      border:
                        selectedId === cmp.id
                          ? "1px solid rgba(217,119,87,0.3)"
                          : "1px solid var(--border)",
                      background:
                        selectedId === cmp.id
                          ? "rgba(217,119,87,0.08)"
                          : "transparent",
                      color:
                        selectedId === cmp.id
                          ? "var(--accent)"
                          : "var(--text-secondary)",
                      fontSize: "0.8125rem",
                      fontWeight: 500,
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {cmp.workflowName} &middot; {cmp.modelA.name} vs {cmp.modelB.name}
                  </button>
                ))}
              </div>
            )}

            {/* Detail */}
            {selected && (
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
                  <h2
                    style={{
                      fontSize: "1.125rem",
                      fontWeight: 600,
                    }}
                  >
                    {selected.workflowName}
                  </h2>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    {formatDate(selected.createdAt)}
                  </span>
                </div>
                <ComparisonDetail comparison={selected} />
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
