import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import {
  seedDemoData,
  getWorkflows,
  getDistilledWorkflow,
  deleteWorkflow,
  type Workflow,
} from "../lib/demo-data";

// --------------------------------------------------------------------------
// Shared styles
// --------------------------------------------------------------------------

const headerRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "1.5rem",
  flexWrap: "wrap",
  gap: "1rem",
};

const tableContainer: React.CSSProperties = {
  borderRadius: "0.75rem",
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
  overflow: "hidden",
};

const thStyle: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "var(--text-muted)",
  textAlign: "left",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-elevated)",
};

const tdStyle: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontSize: "0.875rem",
  color: "var(--text-primary)",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "middle",
};

const modelBadge = (model: string): React.CSSProperties => ({
  display: "inline-block",
  padding: "0.1875rem 0.625rem",
  borderRadius: "9999px",
  fontSize: "0.75rem",
  fontWeight: 600,
  fontFamily: "'JetBrains Mono', monospace",
  background: model.includes("opus")
    ? "rgba(217,119,87,0.12)"
    : model.includes("sonnet")
    ? "rgba(99,179,237,0.12)"
    : "rgba(168,130,255,0.12)",
  color: model.includes("opus")
    ? "var(--accent)"
    : model.includes("sonnet")
    ? "#63b3ed"
    : "#a882ff",
  border: `1px solid ${
    model.includes("opus")
      ? "rgba(217,119,87,0.2)"
      : model.includes("sonnet")
      ? "rgba(99,179,237,0.2)"
      : "rgba(168,130,255,0.2)"
  }`,
});

const smallBtn = (variant: "primary" | "ghost" | "danger"): React.CSSProperties => ({
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
      : "1px solid var(--border)",
  background:
    variant === "primary"
      ? "var(--accent)"
      : variant === "danger"
      ? "rgba(239,68,68,0.08)"
      : "transparent",
  color:
    variant === "primary"
      ? "#fff"
      : variant === "danger"
      ? "#ef4444"
      : "var(--text-secondary)",
  transition: "opacity 0.15s",
});

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export function Workflows() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    seedDemoData();
    setWorkflows(getWorkflows());
    setLoading(false);
  }, []);

  const handleDelete = (id: string) => {
    deleteWorkflow(id);
    setWorkflows(getWorkflows());
  };

  const handleDistill = (id: string) => {
    navigate(`/distill/${id}`);
  };

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
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
        {/* Header */}
        <div style={headerRow}>
          <div>
            <h1
              style={{
                fontSize: "1.75rem",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                marginBottom: "0.25rem",
              }}
            >
              Workflow Library
            </h1>
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
              {workflows.length} workflow{workflows.length !== 1 ? "s" : ""} captured
            </p>
          </div>
          <button
            style={{
              padding: "0.625rem 1.25rem",
              borderRadius: "0.625rem",
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.9"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
          >
            Capture New
          </button>
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

        {/* Empty state */}
        {!loading && workflows.length === 0 && (
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
              {"\u2205"}
            </div>
            <h3
              style={{
                fontSize: "1.125rem",
                fontWeight: 600,
                marginBottom: "0.5rem",
              }}
            >
              No workflows captured yet
            </h3>
            <p
              style={{
                fontSize: "0.875rem",
                color: "var(--text-secondary)",
                marginBottom: "1rem",
              }}
            >
              Run{" "}
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
                bp capture
              </code>{" "}
              to get started.
            </p>
          </div>
        )}

        {/* Table */}
        {!loading && workflows.length > 0 && (
          <div style={tableContainer}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Source Model</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Events</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Compression</th>
                  <th style={thStyle}>Captured</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {workflows.map((wf) => {
                  const distilled = getDistilledWorkflow(wf.id);
                  const compression = distilled?.compression;
                  return (
                    <tr
                      key={wf.id}
                      style={{ transition: "background 0.1s" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--bg-elevated)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 500 }}>{wf.name}</span>
                      </td>
                      <td style={tdStyle}>
                        <span style={modelBadge(wf.sourceModel)}>
                          {wf.sourceModel}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.8125rem" }}>
                        {wf.events.length}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.8125rem" }}>
                        {compression != null ? (
                          <span style={{ color: "#48bb78" }}>
                            {Math.round(compression * 100)}%
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>{"\u2014"}</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                        {formatDate(wf.capturedAt)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <div style={{ display: "flex", gap: "0.375rem", justifyContent: "flex-end" }}>
                          <button
                            style={smallBtn("primary")}
                            onClick={() => handleDistill(wf.id)}
                          >
                            Distill
                          </button>
                          <button
                            style={smallBtn("ghost")}
                            onClick={() => handleDistill(wf.id)}
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
