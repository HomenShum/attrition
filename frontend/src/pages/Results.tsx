import { useParams } from "react-router-dom";

export function Results() {
  const { id } = useParams<{ id: string }>();

  return (
    <div style={{ padding: "2rem", maxWidth: 960, margin: "0 auto" }}>
      <h1
        style={{
          fontSize: "2rem",
          fontWeight: 700,
          marginBottom: "0.5rem",
        }}
      >
        QA Results
      </h1>
      <p style={{ color: "var(--text-muted)", marginBottom: "2rem" }}>
        Run ID: {id}
      </p>

      <div
        style={{
          padding: "2rem",
          borderRadius: "1rem",
          border: "1px solid var(--border)",
          background: "var(--bg-surface)",
          textAlign: "center",
        }}
      >
        <p style={{ color: "var(--text-secondary)" }}>
          Results will appear here once the QA check completes.
        </p>
      </div>
    </div>
  );
}
