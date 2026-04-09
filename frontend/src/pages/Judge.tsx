import { useState, useEffect } from "react";
import { Layout } from "../components/Layout";
import {
  listJudgeSessions,
  getJudgeSession,
  type JudgeSessionSummary,
  type JudgeSessionDetail,
  type DivergenceEntry,
  type NudgeEntry,
} from "../lib/api";

/* ── Types for display ─────────────────────────────────────────────── */

type Verdict = "correct" | "partial" | "failed" | "escalate";
type DisplaySeverity = "Major" | "Minor" | "Critical";
type EventStatus = "Followed" | "Skipped" | "Diverged";

/* ── Styling helpers ────────────────────────────────────────────────── */

const mono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

const VERDICT_COLORS: Record<Verdict, { bg: string; fg: string }> = {
  correct: { bg: "rgba(72,187,120,0.12)", fg: "#48bb78" },
  partial: { bg: "rgba(236,201,75,0.12)", fg: "#ecc94b" },
  failed: { bg: "rgba(239,68,68,0.12)", fg: "#ef4444" },
  escalate: { bg: "rgba(168,130,255,0.12)", fg: "#a882ff" },
};

const SEVERITY_COLORS: Record<string, { bg: string; fg: string }> = {
  minor: { bg: "rgba(99,179,237,0.12)", fg: "#63b3ed" },
  major: { bg: "rgba(217,119,87,0.12)", fg: "#d97757" },
  critical: { bg: "rgba(239,68,68,0.12)", fg: "#ef4444" },
};

function Badge({
  label,
  colors,
}: {
  label: string;
  colors: { bg: string; fg: string };
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.1875rem 0.625rem",
        borderRadius: "9999px",
        fontSize: "0.6875rem",
        fontWeight: 600,
        ...mono,
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

/* ── Attention heatmap ──────────────────────────────────────────────── */

const STATUS_COLORS: Record<EventStatus, string> = {
  Followed: "#48bb78",
  Skipped: "#63b3ed",
  Diverged: "#ef4444",
};

function AttentionHeatmap({ statuses }: { statuses: EventStatus[] }) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#9a9590",
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
              minWidth: 4,
              cursor: "default",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = "0.8";
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginTop: "0.375rem",
          fontSize: "0.6875rem",
          color: "#9a9590",
        }}
      >
        {Object.entries(STATUS_COLORS).map(([label, color]) => (
          <div
            key={label}
            style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: color,
              }}
            />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Divergence card ────────────────────────────────────────────────── */

function DivergenceCard({
  div,
  nudges,
}: {
  div: DivergenceEntry;
  nudges: NudgeEntry[];
}) {
  const sev = div.severity;
  const sevColors = SEVERITY_COLORS[sev] ?? SEVERITY_COLORS.minor;
  const displaySev: DisplaySeverity =
    sev === "critical" ? "Critical" : sev === "major" ? "Major" : "Minor";
  const relatedNudges = nudges.filter(
    (n) => n.event_index === div.event_index,
  );

  const expectedSummary =
    typeof div.expected === "object" && div.expected !== null
      ? (div.expected as Record<string, unknown>).type
        ? `${(div.expected as Record<string, unknown>).type}: ${JSON.stringify(div.expected).slice(0, 120)}`
        : JSON.stringify(div.expected).slice(0, 150)
      : String(div.expected);

  const actualSummary =
    typeof div.actual === "object" && div.actual !== null
      ? (div.actual as Record<string, unknown>).type
        ? `${(div.actual as Record<string, unknown>).type}: ${JSON.stringify(div.actual).slice(0, 120)}`
        : JSON.stringify(div.actual).slice(0, 150)
      : String(div.actual);

  return (
    <div
      style={{
        padding: "1rem 1.25rem",
        borderRadius: "0.625rem",
        border: `1px solid ${sevColors.fg}22`,
        background: "#141415",
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
        <Badge label={displaySev} colors={sevColors} />
        <span style={{ fontSize: "0.75rem", color: "#9a9590", ...mono }}>
          Event #{div.event_index + 1}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "0.625rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#9a9590",
              marginBottom: "0.25rem",
            }}
          >
            Expected
          </div>
          <p
            style={{
              fontSize: "0.8125rem",
              color: "#9a9590",
              lineHeight: 1.5,
              margin: 0,
              wordBreak: "break-word",
            }}
          >
            {expectedSummary}
          </p>
        </div>
        <div>
          <div
            style={{
              fontSize: "0.625rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#9a9590",
              marginBottom: "0.25rem",
            }}
          >
            Actual
          </div>
          <p
            style={{
              fontSize: "0.8125rem",
              color: "#ef4444",
              lineHeight: 1.5,
              margin: 0,
              wordBreak: "break-word",
            }}
          >
            {actualSummary}
          </p>
        </div>
      </div>

      <div
        style={{
          padding: "0.625rem 0.875rem",
          borderRadius: "0.375rem",
          background: "#0a0a0b",
          border: "1px solid rgba(255,255,255,0.06)",
          fontSize: "0.8125rem",
          color: "#9a9590",
          lineHeight: 1.5,
          marginBottom: relatedNudges.length > 0 ? "0.75rem" : 0,
        }}
      >
        <span style={{ color: "#d97757", fontWeight: 600 }}>Suggestion:</span>{" "}
        {div.suggestion}
      </div>

      {relatedNudges.length > 0 && (
        <div>
          <div
            style={{
              fontSize: "0.625rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#9a9590",
              marginBottom: "0.375rem",
            }}
          >
            Nudges
          </div>
          {relatedNudges.map((nudge, i) => (
            <div
              key={i}
              style={{
                padding: "0.375rem 0",
                fontSize: "0.75rem",
                color: "#9a9590",
                lineHeight: 1.4,
              }}
            >
              {nudge.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Shared state banners ──────────────────────────────────────────── */

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
      <div style={{ fontSize: "2rem", marginBottom: "1rem", opacity: 0.3 }}>
        {"\u26A0"}
      </div>
      <h3
        style={{
          fontSize: "1.125rem",
          fontWeight: 600,
          marginBottom: "0.5rem",
          color: "#ef4444",
        }}
      >
        Backend unreachable
      </h3>
      <p style={{ fontSize: "0.875rem", color: "#9a9590", marginBottom: "1rem" }}>
        Start the server to see live judge data:
      </p>
      <div
        style={{
          display: "inline-block",
          padding: "0.75rem 1.25rem",
          borderRadius: "0.5rem",
          background: "#0a0a0b",
          border: "1px solid rgba(255,255,255,0.06)",
          ...mono,
          fontSize: "0.8125rem",
          color: "#9a9590",
        }}
      >
        <span style={{ color: "#d97757" }}>$</span> bp serve --port 8100
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
        border: "1px solid rgba(255,255,255,0.06)",
        background: "#141415",
      }}
    >
      <div style={{ fontSize: "2rem", marginBottom: "1rem", opacity: 0.3 }}>
        {"\u2696"}
      </div>
      <h3
        style={{
          fontSize: "1.125rem",
          fontWeight: 600,
          marginBottom: "0.75rem",
          color: "#e8e6e3",
        }}
      >
        No judge sessions
      </h3>
      <p
        style={{
          fontSize: "0.875rem",
          color: "#9a9590",
          maxWidth: 480,
          margin: "0 auto 1.5rem",
          lineHeight: 1.6,
        }}
      >
        Start a replay to judge how a different model executes a captured workflow.
      </p>
      <div
        style={{
          display: "inline-block",
          padding: "0.75rem 1.25rem",
          borderRadius: "0.5rem",
          background: "#0a0a0b",
          border: "1px solid rgba(255,255,255,0.06)",
          ...mono,
          fontSize: "0.8125rem",
          color: "#9a9590",
        }}
      >
        <span style={{ color: "#d97757" }}>$</span> bp judge {"<workflow-id>"}
      </div>
    </div>
  );
}

/* ── Helper: build heatmap from detail ─────────────────────────────── */

function buildEventStatuses(
  detail: JudgeSessionDetail,
): EventStatus[] {
  const expected = detail.events_expected;
  const actual = detail.events_actual;
  const maxLen = Math.max(expected.length, actual.length);
  const statuses: EventStatus[] = [];

  // Build divergence index set from verdict
  const divIndices = new Set<number>();
  if (detail.verdict?.divergences) {
    for (const d of detail.verdict.divergences) {
      divIndices.add(d.event_index);
    }
  }

  for (let i = 0; i < maxLen; i++) {
    if (divIndices.has(i)) {
      statuses.push("Diverged");
    } else if (i >= actual.length) {
      statuses.push("Skipped");
    } else {
      statuses.push("Followed");
    }
  }
  return statuses;
}

/* ── Main component ─────────────────────────────────────────────────── */

export function Judge() {
  const [sessions, setSessions] = useState<JudgeSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] =
    useState<JudgeSessionDetail | null>(null);

  useEffect(() => {
    listJudgeSessions()
      .then((data) => {
        setSessions(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });
  }, []);

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(id);
    try {
      const detail = await getJudgeSession(id);
      setExpandedDetail(detail);
    } catch {
      setExpandedDetail(null);
    }
  };

  const thStyle: React.CSSProperties = {
    padding: "0.75rem 1rem",
    fontSize: "0.6875rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#9a9590",
    textAlign: "left",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "#1a1a1b",
  };

  return (
    <Layout>
      <div
        style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}
      >
        {/* Header */}
        <div style={{ marginBottom: "1.5rem" }}>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              marginBottom: "0.25rem",
              color: "#e8e6e3",
            }}
          >
            Judge Dashboard
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#9a9590" }}>
            {loading
              ? "Loading..."
              : error
              ? "Server unreachable"
              : `${sessions.length} judge sessions`}
          </p>
        </div>

        {/* States */}
        {loading && (
          <div
            style={{
              padding: "3rem",
              textAlign: "center",
              color: "#9a9590",
            }}
          >
            Loading sessions...
          </div>
        )}
        {!loading && error && <ServerDownBanner />}
        {!loading && !error && sessions.length === 0 && <EmptyState />}

        {/* Sessions table */}
        {!loading && !error && sessions.length > 0 && (
          <div
            style={{
              borderRadius: "0.75rem",
              border: "1px solid rgba(255,255,255,0.06)",
              background: "#141415",
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {[
                    "Workflow",
                    "Replay Model",
                    "Progress",
                    "Verdict",
                    "Divergences",
                    "",
                  ].map((h) => (
                    <th
                      key={h || "_toggle"}
                      style={{
                        ...thStyle,
                        textAlign: h === "" ? "right" : "left",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => {
                  const isExpanded = expandedId === session.id;
                  const verdictKey: Verdict = session.verdict?.verdict ?? "partial";
                  const verdictColors =
                    VERDICT_COLORS[verdictKey] ?? VERDICT_COLORS.partial;
                  const isOpus = session.replay_model.includes("opus");
                  const modelColor = isOpus
                    ? "#d97757"
                    : session.replay_model.includes("sonnet")
                    ? "#63b3ed"
                    : "#a882ff";
                  const modelBg = isOpus
                    ? "rgba(217,119,87,0.12)"
                    : session.replay_model.includes("sonnet")
                    ? "rgba(99,179,237,0.12)"
                    : "rgba(168,130,255,0.12)";
                  const divCount =
                    session.verdict?.divergences?.length ?? 0;

                  return (
                    <tbody key={session.id}>
                      <tr
                        style={{
                          cursor: "pointer",
                          transition: "background 0.1s",
                        }}
                        onClick={() => handleExpand(session.id)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "#1a1a1b";
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
                            color: "#e8e6e3",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                          }}
                        >
                          {session.workflow_id.slice(0, 8)}...
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                          }}
                        >
                          <span
                            style={{
                              display: "inline-block",
                              padding: "0.1875rem 0.625rem",
                              borderRadius: "9999px",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              ...mono,
                              background: modelBg,
                              color: modelColor,
                              border: `1px solid ${modelColor}33`,
                            }}
                          >
                            {session.replay_model}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            ...mono,
                            fontSize: "0.75rem",
                            color: "#9a9590",
                          }}
                        >
                          {session.events_actual}/{session.events_expected}
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                          }}
                        >
                          <Badge
                            label={verdictKey.toUpperCase()}
                            colors={verdictColors}
                          />
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            fontSize: "0.875rem",
                            ...mono,
                            color: divCount > 0 ? "#d97757" : "#9a9590",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                          }}
                        >
                          {divCount}
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            textAlign: "right",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            fontSize: "0.75rem",
                            color: "#9a9590",
                          }}
                        >
                          {isExpanded ? "\u25B2" : "\u25BC"}
                        </td>
                      </tr>

                      {/* Expanded detail */}
                      {isExpanded && expandedDetail && (
                        <tr>
                          <td
                            colSpan={6}
                            style={{
                              padding: "1.25rem 1.5rem",
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                              background: "#0a0a0b",
                            }}
                          >
                            {/* Heatmap */}
                            <div style={{ marginBottom: "1.25rem" }}>
                              <AttentionHeatmap
                                statuses={buildEventStatuses(expandedDetail)}
                              />
                            </div>

                            {/* Divergences */}
                            {expandedDetail.verdict?.divergences &&
                              expandedDetail.verdict.divergences.length > 0 && (
                                <>
                                  <div
                                    style={{
                                      fontSize: "0.6875rem",
                                      fontWeight: 600,
                                      textTransform: "uppercase",
                                      letterSpacing: "0.08em",
                                      color: "#9a9590",
                                      marginBottom: "0.625rem",
                                    }}
                                  >
                                    Divergences (
                                    {expandedDetail.verdict.divergences.length})
                                  </div>
                                  {expandedDetail.verdict.divergences.map(
                                    (div, i) => (
                                      <DivergenceCard
                                        key={i}
                                        div={div}
                                        nudges={expandedDetail.nudges}
                                      />
                                    ),
                                  )}
                                </>
                              )}

                            {(!expandedDetail.verdict?.divergences ||
                              expandedDetail.verdict.divergences.length ===
                                0) && (
                              <div
                                style={{
                                  fontSize: "0.8125rem",
                                  color: "#48bb78",
                                  padding: "0.75rem 0",
                                }}
                              >
                                No divergences -- all{" "}
                                {expandedDetail.events_expected.length} events
                                followed the canonical workflow.
                              </div>
                            )}

                            {/* Metadata */}
                            <div
                              style={{
                                display: "flex",
                                gap: "2rem",
                                marginTop: "1rem",
                                fontSize: "0.75rem",
                                color: "#9a9590",
                              }}
                            >
                              <span>
                                Started:{" "}
                                {new Date(
                                  expandedDetail.started_at,
                                ).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              <span>
                                Nudges: {expandedDetail.nudges.length}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* How the judge works */}
        <div style={{ marginTop: "2rem" }}>
          <div
            style={{
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              color: "#9a9590",
              marginBottom: "0.75rem",
            }}
          >
            How the judge works
          </div>
          <div
            style={{
              padding: "1rem 1.25rem",
              borderRadius: "0.625rem",
              border: "1px solid rgba(255,255,255,0.06)",
              background: "#141415",
              ...mono,
              fontSize: "0.8125rem",
              color: "#9a9590",
              lineHeight: 2,
            }}
          >
            <div>
              <span style={{ color: "#d97757" }}>1.</span> Start{" "}
              <span style={{ color: "#e8e6e3" }}>bp.judge.start</span>{" "}
              {"{"} workflow_id, replay_model {"}"}
            </div>
            <div>
              <span style={{ color: "#d97757" }}>2.</span> Each tool call{" "}
              <span style={{ color: "#e8e6e3" }}>bp.judge.event</span>{" "}
              {"{"} actual_event {"}"}
            </div>
            <div>
              <span style={{ color: "#d97757" }}>3.</span> Divergence? Nudge
              returned to agent
            </div>
            <div>
              <span style={{ color: "#d97757" }}>4.</span> Done{" "}
              <span style={{ color: "#e8e6e3" }}>bp.judge.verdict</span>{" "}
              {"{"} session_id {"}"} {"\u2192"} CORRECT / PARTIAL / FAILED
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
