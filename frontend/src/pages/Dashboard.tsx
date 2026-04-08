import { useEffect, useState } from "react";

interface HealthData {
  status: string;
  version: string;
  uptime_secs: number;
  requests_served: number;
}

export function Dashboard() {
  const [health, setHealth] = useState<HealthData | null>(null);

  useEffect(() => {
    fetch("/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <div style={{ padding: "2rem", maxWidth: 960, margin: "0 auto" }}>
      <h1
        style={{
          fontSize: "2rem",
          fontWeight: 700,
          marginBottom: "2rem",
        }}
      >
        Dashboard
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <MetricCard
          label="Status"
          value={health?.status ?? "offline"}
          accent={health?.status === "ok"}
        />
        <MetricCard
          label="Version"
          value={health?.version ?? "-"}
        />
        <MetricCard
          label="Uptime"
          value={health ? `${health.uptime_secs}s` : "-"}
        />
        <MetricCard
          label="Requests"
          value={health?.requests_served?.toString() ?? "-"}
        />
      </div>

      <div
        style={{
          padding: "2rem",
          borderRadius: "1rem",
          border: "1px solid var(--border)",
          background: "var(--bg-surface)",
        }}
      >
        <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>
          Recent QA Runs
        </h2>
        <p style={{ color: "var(--text-muted)" }}>
          No runs yet. Use the CLI or MCP tools to start a QA check.
        </p>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        padding: "1.25rem",
        borderRadius: "0.75rem",
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
      }}
    >
      <div
        style={{
          fontSize: "0.75rem",
          textTransform: "uppercase" as const,
          letterSpacing: "0.1em",
          color: "var(--text-muted)",
          marginBottom: "0.5rem",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          color: accent ? "var(--accent)" : "var(--text-primary)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
