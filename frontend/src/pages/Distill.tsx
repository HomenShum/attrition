import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import {
  seedDemoData,
  getWorkflow,
  getDistilledWorkflow,
  type Workflow,
  type CanonicalEvent,
  type EventType,
} from "../lib/demo-data";

// --------------------------------------------------------------------------
// Event type styling
// --------------------------------------------------------------------------

const EVENT_COLORS: Record<EventType, { bg: string; fg: string }> = {
  Think:    { bg: "rgba(160,160,160,0.12)", fg: "#a0a0a0" },
  ToolCall: { bg: "rgba(99,179,237,0.12)",  fg: "#63b3ed" },
  FileEdit: { bg: "rgba(72,187,120,0.12)",  fg: "#48bb78" },
  Search:   { bg: "rgba(236,201,75,0.12)",  fg: "#ecc94b" },
  Decision: { bg: "rgba(168,130,255,0.12)", fg: "#a882ff" },
  Assert:   { bg: "rgba(239,68,68,0.12)",   fg: "#ef4444" },
};

function EventTypeBadge({ type }: { type: EventType }) {
  const c = EVENT_COLORS[type];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.125rem 0.5rem",
        borderRadius: "9999px",
        fontSize: "0.6875rem",
        fontWeight: 600,
        fontFamily: "'JetBrains Mono', monospace",
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.fg}22`,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {type}
    </span>
  );
}

// --------------------------------------------------------------------------
// Event card
// --------------------------------------------------------------------------

function EventCard({
  event,
  index,
  eliminated,
}: {
  event: CanonicalEvent;
  index: number;
  eliminated?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        padding: "0.75rem 1rem",
        borderRadius: "0.5rem",
        border: event.checkpoint
          ? "1px solid rgba(217,119,87,0.3)"
          : "1px solid var(--border)",
        background: eliminated ? "transparent" : "var(--bg-surface)",
        opacity: eliminated ? 0.35 : 1,
        textDecoration: eliminated ? "line-through" : "none",
        transition: "opacity 0.2s",
        position: "relative",
      }}
    >
      {event.checkpoint && (
        <div
          style={{
            position: "absolute",
            top: -1,
            right: 12,
            padding: "0.0625rem 0.5rem",
            borderRadius: "0 0 0.25rem 0.25rem",
            background: "var(--accent)",
            color: "#fff",
            fontSize: "0.5625rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            textDecoration: "none",
          }}
        >
          Checkpoint
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          marginBottom: "0.375rem",
        }}
      >
        <span
          style={{
            fontSize: "0.6875rem",
            color: "var(--text-muted)",
            fontFamily: "'JetBrains Mono', monospace",
            minWidth: 20,
          }}
        >
          {index + 1}
        </span>
        <EventTypeBadge type={event.type} />
        <span
          style={{
            fontSize: "0.75rem",
            color: "var(--text-muted)",
            fontFamily: "'JetBrains Mono', monospace",
            marginLeft: "auto",
          }}
        >
          {event.tokens} tok &middot; {event.durationMs}ms
        </span>
      </div>

      <p
        style={{
          fontSize: "0.8125rem",
          color: eliminated ? "var(--text-muted)" : "var(--text-secondary)",
          lineHeight: 1.5,
          margin: 0,
          paddingLeft: "1.625rem",
        }}
      >
        {event.summary}
      </p>

      {event.content && !eliminated && (
        <div style={{ paddingLeft: "1.625rem", marginTop: "0.5rem" }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              padding: "0.25rem 0.5rem",
              borderRadius: "0.25rem",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: "0.6875rem",
              cursor: "pointer",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {expanded ? "\u25BC Hide" : "\u25B6 Show"} content
          </button>
          {expanded && (
            <pre
              style={{
                marginTop: "0.5rem",
                padding: "0.75rem",
                borderRadius: "0.375rem",
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                fontSize: "0.75rem",
                color: "var(--text-secondary)",
                fontFamily: "'JetBrains Mono', monospace",
                overflow: "auto",
                whiteSpace: "pre-wrap",
                maxHeight: 200,
              }}
            >
              {event.content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Main component
// --------------------------------------------------------------------------

export function Distill() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [distilled, setDistilled] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    seedDemoData();
    if (id) {
      setWorkflow(getWorkflow(id));
      setDistilled(getDistilledWorkflow(id));
    }
    setLoading(false);
  }, [id]);

  if (loading) {
    return (
      <Layout>
        <div style={{ padding: "4rem", textAlign: "center", color: "var(--text-muted)" }}>
          Loading...
        </div>
      </Layout>
    );
  }

  if (!workflow) {
    return (
      <Layout>
        <div
          style={{
            maxWidth: 600,
            margin: "4rem auto",
            padding: "3rem 2rem",
            textAlign: "center",
            borderRadius: "0.75rem",
            border: "1px solid var(--border)",
            background: "var(--bg-surface)",
          }}
        >
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Workflow not found
          </h2>
          <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
            The workflow with ID "{id}" does not exist.
          </p>
          <button
            onClick={() => navigate("/workflows")}
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Back to Workflows
          </button>
        </div>
      </Layout>
    );
  }

  const originalEvents = workflow.events;
  const distilledEvents = distilled?.distilledEvents ?? null;
  const originalTokens = originalEvents.reduce((s, e) => s + e.tokens, 0);
  const distilledTokens = distilledEvents
    ? distilledEvents.filter((e) => !e.eliminated).reduce((s, e) => s + e.tokens, 0)
    : null;
  const compressionRatio = distilled?.compression ?? null;
  const costSavings =
    distilledTokens != null
      ? Math.round(((originalTokens - distilledTokens) / originalTokens) * 100)
      : null;

  const modelBadgeStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "0.25rem 0.75rem",
    borderRadius: "9999px",
    fontSize: "0.8125rem",
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', monospace",
    background: "rgba(217,119,87,0.12)",
    color: "var(--accent)",
    border: "1px solid rgba(217,119,87,0.2)",
  };

  return (
    <Layout>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem 1.5rem" }}>
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
          <button
            onClick={() => navigate("/workflows")}
            style={{
              padding: "0.375rem 0.75rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-secondary)",
              fontSize: "0.8125rem",
              cursor: "pointer",
            }}
          >
            {"\u2190"} Back
          </button>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            {workflow.name}
          </h1>
          <span style={modelBadgeStyle}>{workflow.sourceModel}</span>
        </div>

        {/* Stats row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "0.75rem",
            marginBottom: "2rem",
            marginTop: "1.25rem",
          }}
        >
          {[
            { label: "Original Events", value: String(originalEvents.length) },
            {
              label: "Distilled Events",
              value: distilledTokens != null
                ? String(distilledEvents!.filter((e) => !e.eliminated).length)
                : "\u2014",
            },
            {
              label: "Compression",
              value: compressionRatio != null ? `${Math.round(compressionRatio * 100)}%` : "\u2014",
              accent: compressionRatio != null,
            },
            {
              label: "Est. Cost Savings",
              value: costSavings != null ? `~${costSavings}%` : "\u2014",
              accent: costSavings != null,
            },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                padding: "1rem 1.25rem",
                borderRadius: "0.625rem",
                border: "1px solid var(--border)",
                background: "var(--bg-surface)",
              }}
            >
              <div
                style={{
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--text-muted)",
                  marginBottom: "0.375rem",
                }}
              >
                {stat.label}
              </div>
              <div
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: stat.accent ? "#48bb78" : "var(--text-primary)",
                }}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Side-by-side diff */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: distilledEvents ? "1fr 1fr" : "1fr",
            gap: "1.5rem",
          }}
        >
          {/* Original column */}
          <div>
            <h2
              style={{
                fontSize: "0.8125rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--text-muted)",
                marginBottom: "1rem",
                paddingBottom: "0.5rem",
                borderBottom: "1px solid var(--border)",
              }}
            >
              Original ({originalEvents.length} events &middot; {originalTokens.toLocaleString()} tokens)
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {originalEvents.map((event, i) => (
                <EventCard key={event.id} event={event} index={i} />
              ))}
            </div>
          </div>

          {/* Distilled column */}
          {distilledEvents && (
            <div>
              <h2
                style={{
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--text-muted)",
                  marginBottom: "1rem",
                  paddingBottom: "0.5rem",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                Distilled ({distilledEvents.filter((e) => !e.eliminated).length} events &middot;{" "}
                {distilledTokens!.toLocaleString()} tokens)
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {distilledEvents.map((event, i) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    index={i}
                    eliminated={event.eliminated}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* No distillation yet message */}
        {!distilledEvents && (
          <div
            style={{
              marginTop: "2rem",
              padding: "2rem",
              textAlign: "center",
              borderRadius: "0.75rem",
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
            }}
          >
            <p
              style={{
                fontSize: "0.9375rem",
                color: "var(--text-secondary)",
                marginBottom: "1rem",
              }}
            >
              This workflow has not been distilled yet. Run{" "}
              <code
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.8125rem",
                  padding: "0.125rem 0.375rem",
                  borderRadius: "0.25rem",
                  background: "var(--bg-elevated)",
                  color: "var(--accent)",
                }}
              >
                bp distill {workflow.id}
              </code>{" "}
              to compress it.
            </p>
          </div>
        )}

        {/* Replay button */}
        <div style={{ marginTop: "2rem", textAlign: "center" }}>
          <button
            disabled
            style={{
              padding: "0.75rem 2rem",
              borderRadius: "0.625rem",
              border: "none",
              background: "var(--bg-elevated)",
              color: "var(--text-muted)",
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: "not-allowed",
              opacity: 0.5,
            }}
          >
            Replay on Sonnet (coming soon)
          </button>
        </div>
      </div>
    </Layout>
  );
}
