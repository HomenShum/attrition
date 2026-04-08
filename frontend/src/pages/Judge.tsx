import { useState, useEffect } from "react";
import { Layout } from "../components/Layout";
import {
  seedDemoData,
  getJudgeSessions,
  type JudgeSession,
  type Verdict,
  type DivergenceSeverity,
  type Divergence,
  type Nudge,
} from "../lib/demo-data";

// --------------------------------------------------------------------------
// Verdict / severity badge helpers
// --------------------------------------------------------------------------

const VERDICT_COLORS: Record<Verdict, { bg: string; fg: string }> = {
  Correct:  { bg: "rgba(72,187,120,0.12)",  fg: "#48bb78" },
  Partial:  { bg: "rgba(236,201,75,0.12)",  fg: "#ecc94b" },
  Escalate: { bg: "rgba(217,119,87,0.12)",  fg: "#d97757" },
  Failed:   { bg: "rgba(239,68,68,0.12)",   fg: "#ef4444" },
};

const SEVERITY_COLORS: Record<DivergenceSeverity, { bg: string; fg: string }> = {
  Minor:    { bg: "rgba(99,179,237,0.12)",  fg: "#63b3ed" },
  Major:    { bg: "rgba(217,119,87,0.12)",  fg: "#d97757" },
  Critical: { bg: "rgba(239,68,68,0.12)",   fg: "#ef4444" },
};

function Badge({ label, colors }: { label: string; colors: { bg: string; fg: string } }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.1875rem 0.625rem",
        borderRadius: "9999px",
        fontSize: "0.6875rem",
        fontWeight: 600,
        fontFamily: "'JetBrains Mono', monospace",
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.fg}22`,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {label}
    </span>
  );
}

// --------------------------------------------------------------------------
// Attention heatmap
// --------------------------------------------------------------------------

function AttentionHeatmap({ statuses }: { statuses: JudgeSession["eventStatuses"] }) {
  const STATUS_COLORS: Record<string, string> = {
    Followed: "#48bb78",
    Skipped:  "#4a5568",
    Diverged: "#ef4444",
  };

  return (
    <div>
      <div
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--text-muted)",
          marginBottom: "0.5rem",
        }}
      >
        Attention Heatmap
      </div>
      <div
        style={{
          display: "flex",
          gap: 2,
          borderRadius: "0.375rem",
          overflow: "hidden",
        }}
      >
        {statuses.map((status, i) => (
          <div
            key={i}
            title={`Event ${i + 1}: ${status}`}
            style={{
              flex: 1,
              height: 24,
              background: STATUS_COLORS[status],
              opacity: 0.8,
              transition: "opacity 0.15s",
              cursor: "default",
              minWidth: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.8"; }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginTop: "0.375rem",
          fontSize: "0.6875rem",
          color: "var(--text-muted)",
        }}
      >
        {Object.entries(STATUS_COLORS).map(([label, color]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Divergence card
// --------------------------------------------------------------------------

function DivergenceCard({ div, nudges }: { div: Divergence; nudges: Nudge[] }) {
  const sevColors = SEVERITY_COLORS[div.severity];
  const relatedNudges = nudges.filter((n) => n.divergenceId === div.id);

  return (
    <div
      style={{
        padding: "1rem 1.25rem",
        borderRadius: "0.625rem",
        border: `1px solid ${sevColors.fg}22`,
        background: "var(--bg-surface)",
        marginBottom: "0.75rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <Badge label={div.severity} colors={sevColors} />
        <span
          style={{
            fontSize: "0.75rem",
            color: "var(--text-muted)",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Event #{div.eventIndex + 1}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <div>
          <div
            style={{
              fontSize: "0.625rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-muted)",
              marginBottom: "0.25rem",
            }}
          >
            Expected
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 }}>
            {div.expected}
          </p>
        </div>
        <div>
          <div
            style={{
              fontSize: "0.625rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-muted)",
              marginBottom: "0.25rem",
            }}
          >
            Actual
          </div>
          <p style={{ fontSize: "0.8125rem", color: "#ef4444", lineHeight: 1.5, margin: 0 }}>
            {div.actual}
          </p>
        </div>
      </div>

      <div
        style={{
          padding: "0.625rem 0.875rem",
          borderRadius: "0.375rem",
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          fontSize: "0.8125rem",
          color: "var(--text-secondary)",
          lineHeight: 1.5,
          marginBottom: relatedNudges.length > 0 ? "0.75rem" : 0,
        }}
      >
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>Suggestion:</span>{" "}
        {div.suggestion}
      </div>

      {/* Nudge history */}
      {relatedNudges.length > 0 && (
        <div>
          <div
            style={{
              fontSize: "0.625rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-muted)",
              marginBottom: "0.375rem",
            }}
          >
            Nudge History
          </div>
          {relatedNudges.map((nudge) => (
            <div
              key={nudge.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.5rem",
                padding: "0.375rem 0",
                fontSize: "0.75rem",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  padding: "0.0625rem 0.375rem",
                  borderRadius: "0.25rem",
                  fontSize: "0.625rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  background:
                    nudge.status === "accepted"
                      ? "rgba(72,187,120,0.12)"
                      : nudge.status === "rejected"
                      ? "rgba(239,68,68,0.12)"
                      : "rgba(236,201,75,0.12)",
                  color:
                    nudge.status === "accepted"
                      ? "#48bb78"
                      : nudge.status === "rejected"
                      ? "#ef4444"
                      : "#ecc94b",
                  flexShrink: 0,
                }}
              >
                {nudge.status}
              </span>
              <span style={{ color: "var(--text-secondary)", lineHeight: 1.4 }}>
                {nudge.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Main component
// --------------------------------------------------------------------------

export function Judge() {
  const [sessions, setSessions] = useState<JudgeSession[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    seedDemoData();
    setSessions(getJudgeSessions());
    setLoading(false);
  }, []);

  const activeSessions = sessions.filter(
    (s) => s.progress < s.totalEvents || s.verdict === "Partial" || s.verdict === "Escalate",
  );

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
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem 1.5rem" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "1.5rem",
            flexWrap: "wrap",
            gap: "1rem",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "1.75rem",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                marginBottom: "0.25rem",
              }}
            >
              Judge Dashboard
            </h1>
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
              {activeSessions.length} active session{activeSessions.length !== 1 ? "s" : ""}
            </p>
          </div>
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
            Loading sessions...
          </div>
        )}

        {/* Empty state */}
        {!loading && sessions.length === 0 && (
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
              {"\u2696"}
            </div>
            <h3
              style={{
                fontSize: "1.125rem",
                fontWeight: 600,
                marginBottom: "0.5rem",
              }}
            >
              No judge sessions
            </h3>
            <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
              Start a replay to activate the judge.
            </p>
          </div>
        )}

        {/* Sessions table */}
        {!loading && sessions.length > 0 && (
          <div
            style={{
              borderRadius: "0.75rem",
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Workflow", "Replay Model", "Progress", "Verdict", "Divergences", ""].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          padding: "0.75rem 1rem",
                          fontSize: "0.6875rem",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          color: "var(--text-muted)",
                          textAlign: h === "" ? "right" : "left",
                          borderBottom: "1px solid var(--border)",
                          background: "var(--bg-elevated)",
                        }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => {
                  const isExpanded = expandedId === session.id;
                  const progressPct = Math.round(
                    (session.progress / session.totalEvents) * 100,
                  );
                  const verdictColors = VERDICT_COLORS[session.verdict];

                  return (
                    <>
                      <tr
                        key={session.id}
                        style={{
                          cursor: "pointer",
                          transition: "background 0.1s",
                        }}
                        onClick={() =>
                          setExpandedId(isExpanded ? null : session.id)
                        }
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "var(--bg-elevated)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            fontSize: "0.875rem",
                            fontWeight: 500,
                            color: "var(--text-primary)",
                            borderBottom: "1px solid var(--border)",
                          }}
                        >
                          {session.workflowName}
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            borderBottom: "1px solid var(--border)",
                          }}
                        >
                          <span
                            style={{
                              display: "inline-block",
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
                            {session.replayModel}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            borderBottom: "1px solid var(--border)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <div
                              style={{
                                flex: 1,
                                height: 6,
                                borderRadius: 3,
                                background: "var(--bg-primary)",
                                overflow: "hidden",
                                maxWidth: 100,
                              }}
                            >
                              <div
                                style={{
                                  width: `${progressPct}%`,
                                  height: "100%",
                                  background:
                                    progressPct === 100
                                      ? "#48bb78"
                                      : "var(--accent)",
                                  borderRadius: 3,
                                  transition: "width 0.3s",
                                }}
                              />
                            </div>
                            <span
                              style={{
                                fontSize: "0.75rem",
                                fontFamily: "'JetBrains Mono', monospace",
                                color: "var(--text-muted)",
                              }}
                            >
                              {session.progress}/{session.totalEvents}
                            </span>
                          </div>
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            borderBottom: "1px solid var(--border)",
                          }}
                        >
                          <Badge label={session.verdict} colors={verdictColors} />
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            fontSize: "0.875rem",
                            fontFamily: "'JetBrains Mono', monospace",
                            color: session.divergences.length > 0 ? "#d97757" : "var(--text-muted)",
                            borderBottom: "1px solid var(--border)",
                          }}
                        >
                          {session.divergences.length}
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            textAlign: "right",
                            borderBottom: "1px solid var(--border)",
                            fontSize: "0.75rem",
                            color: "var(--text-muted)",
                          }}
                        >
                          {isExpanded ? "\u25B2" : "\u25BC"}
                        </td>
                      </tr>

                      {/* Expanded detail row */}
                      {isExpanded && (
                        <tr key={`${session.id}_detail`}>
                          <td
                            colSpan={6}
                            style={{
                              padding: "1.25rem 1.5rem",
                              borderBottom: "1px solid var(--border)",
                              background: "var(--bg-primary)",
                            }}
                          >
                            {/* Attention heatmap */}
                            <div style={{ marginBottom: "1.25rem" }}>
                              <AttentionHeatmap statuses={session.eventStatuses} />
                            </div>

                            {/* Divergences */}
                            <div
                              style={{
                                fontSize: "0.6875rem",
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: "0.08em",
                                color: "var(--text-muted)",
                                marginBottom: "0.625rem",
                              }}
                            >
                              Divergences ({session.divergences.length})
                            </div>
                            {session.divergences.map((div) => (
                              <DivergenceCard
                                key={div.id}
                                div={div}
                                nudges={session.nudges}
                              />
                            ))}

                            {/* Session metadata */}
                            <div
                              style={{
                                display: "flex",
                                gap: "2rem",
                                marginTop: "1rem",
                                fontSize: "0.75rem",
                                color: "var(--text-muted)",
                              }}
                            >
                              <span>Started: {formatDate(session.startedAt)}</span>
                              <span>
                                Nudges: {session.nudges.length} (
                                {session.nudges.filter((n) => n.status === "accepted").length}{" "}
                                accepted)
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
