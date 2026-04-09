import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import {
  listWorkflows,
  deleteWorkflow as apiDeleteWorkflow,
  type WorkflowSummary,
} from "../lib/api";

/* ── Helpers ────────────────────────────────────────────────────────── */

const mono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

function modelBadge(model: string): React.CSSProperties {
  const isOpus = model.includes("opus");
  const color = isOpus ? "#d97757" : "#63b3ed";
  const bg = isOpus ? "rgba(217,119,87,0.12)" : "rgba(99,179,237,0.12)";
  const border = isOpus ? "rgba(217,119,87,0.2)" : "rgba(99,179,237,0.2)";
  return {
    display: "inline-block",
    padding: "0.1875rem 0.625rem",
    borderRadius: "9999px",
    fontSize: "0.75rem",
    fontWeight: 600,
    ...mono,
    background: bg,
    color,
    border: `1px solid ${border}`,
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

const tdBase: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontSize: "0.875rem",
  color: "#e8e6e3",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  verticalAlign: "middle",
};

const smallBtn = (
  variant: "primary" | "ghost" | "danger",
): React.CSSProperties => ({
  padding: "0.375rem 0.75rem",
  borderRadius: "0.375rem",
  fontSize: "0.75rem",
  fontWeight: 500,
  cursor: "pointer",
  border:
    variant === "primary"
      ? "none"
      : variant === "danger"
      ? "1px solid rgba(239,68,68,0.2)"
      : "1px solid rgba(255,255,255,0.06)",
  background:
    variant === "primary"
      ? "#d97757"
      : variant === "danger"
      ? "rgba(239,68,68,0.08)"
      : "transparent",
  color:
    variant === "primary"
      ? "#fff"
      : variant === "danger"
      ? "#ef4444"
      : "#9a9590",
  transition: "opacity 0.15s",
});

/* ── Shared UI pieces ─────────────────────────────────────────────── */

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
      <p
        style={{
          fontSize: "0.875rem",
          color: "var(--text-secondary)",
          marginBottom: "1rem",
        }}
      >
        Start the backend server to see live data:
      </p>
      <div
        style={{
          display: "inline-block",
          padding: "0.75rem 1.25rem",
          borderRadius: "0.5rem",
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          ...mono,
          fontSize: "0.8125rem",
          color: "var(--text-secondary)",
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
        {"\u{1F4E6}"}
      </div>
      <h3
        style={{
          fontSize: "1.125rem",
          fontWeight: 600,
          marginBottom: "0.75rem",
          color: "#e8e6e3",
        }}
      >
        No workflows captured yet
      </h3>
      <p
        style={{
          fontSize: "0.875rem",
          color: "#9a9590",
          maxWidth: 480,
          margin: "0 auto",
          lineHeight: 1.6,
          marginBottom: "1.5rem",
        }}
      >
        Capture a Claude Code session to create your first workflow.
        The captured event stream becomes the canonical reference for replay
        and distillation.
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
        <span style={{ color: "#d97757" }}>$</span> bp capture
        ~/.claude/projects/my-app/session.jsonl --name "my-workflow"
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div
      style={{
        padding: "3rem",
        textAlign: "center",
        color: "#9a9590",
        fontSize: "0.875rem",
      }}
    >
      Loading workflows...
    </div>
  );
}

/* ── Component ──────────────────────────────────────────────────────── */

export function Workflows() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listWorkflows()
      .then((data) => {
        setWorkflows(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await apiDeleteWorkflow(id);
      setWorkflows((prev) => prev.filter((wf) => wf.id !== id));
    } catch {
      // Silently ignore delete errors in the UI
    }
  };

  return (
    <Layout>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
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
                color: "#e8e6e3",
              }}
            >
              Workflow Library
            </h1>
            <p style={{ fontSize: "0.875rem", color: "#9a9590" }}>
              {loading
                ? "Loading..."
                : error
                ? "Server unreachable"
                : `${workflows.length} workflows captured`}
            </p>
          </div>
        </div>

        {/* States */}
        {loading && <LoadingSkeleton />}
        {!loading && error && <ServerDownBanner />}
        {!loading && !error && workflows.length === 0 && <EmptyState />}

        {/* Table */}
        {!loading && !error && workflows.length > 0 && (
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
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Source Model</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Events</th>
                  <th style={thStyle}>Captured</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {workflows.map((wf, i) => (
                  <tr
                    key={wf.id}
                    style={{
                      transition: "background 0.1s",
                      borderLeft:
                        i === 0
                          ? "3px solid #d97757"
                          : "3px solid transparent",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#1a1a1b";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <td style={tdBase}>
                      <span style={{ fontWeight: 500 }}>{wf.name}</span>
                    </td>
                    <td style={tdBase}>
                      <span style={modelBadge(wf.source_model)}>
                        {wf.source_model}
                      </span>
                    </td>
                    <td
                      style={{
                        ...tdBase,
                        textAlign: "right",
                        ...mono,
                        fontSize: "0.8125rem",
                      }}
                    >
                      {wf.event_count}
                    </td>
                    <td
                      style={{
                        ...tdBase,
                        fontSize: "0.8125rem",
                        color: "#9a9590",
                      }}
                    >
                      {formatDate(wf.captured_at)}
                    </td>
                    <td style={{ ...tdBase, textAlign: "right" }}>
                      <div
                        style={{
                          display: "flex",
                          gap: "0.375rem",
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          style={smallBtn("primary")}
                          onClick={() => navigate(`/distill/${wf.id}`)}
                        >
                          Distill
                        </button>
                        <button
                          style={smallBtn("ghost")}
                          onClick={() => navigate(`/anatomy?workflow=${wf.id}`)}
                        >
                          View
                        </button>
                        <button
                          style={smallBtn("danger")}
                          onClick={() => handleDelete(wf.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Capture CLI hint */}
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
            Capture a new workflow
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
              lineHeight: 1.8,
            }}
          >
            <span style={{ color: "#d97757" }}>$</span> bp capture
            ~/.claude/projects/my-app/session.jsonl --name "my-workflow"
          </div>
        </div>
      </div>
    </Layout>
  );
}
