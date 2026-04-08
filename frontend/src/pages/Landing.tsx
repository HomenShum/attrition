import { useState } from "react";
import { useNavigate } from "react-router-dom";

export function Landing() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleCheck = async () => {
    if (!url) return;
    setLoading(true);
    try {
      const resp = await fetch("/api/qa/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await resp.json();
      navigate(`/results/${data.id}`);
    } catch {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 640 }}>
        <h1
          style={{
            fontSize: "3rem",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginBottom: "1rem",
          }}
        >
          nodebench-
          <span style={{ color: "var(--accent)" }}>qa</span>
        </h1>

        <p
          style={{
            fontSize: "1.25rem",
            color: "var(--text-secondary)",
            marginBottom: "2.5rem",
            lineHeight: 1.6,
          }}
        >
          AI agents forget. nodebench-qa remembers.
          <br />
          QA your app in 60 seconds. 60-70% fewer tokens on reruns.
        </p>

        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            maxWidth: 500,
            margin: "0 auto 2rem",
          }}
        >
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-app.com"
            onKeyDown={(e) => e.key === "Enter" && handleCheck()}
            style={{
              flex: 1,
              padding: "0.875rem 1.25rem",
              borderRadius: "0.75rem",
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
              color: "var(--text-primary)",
              fontSize: "1rem",
              outline: "none",
            }}
          />
          <button
            onClick={handleCheck}
            disabled={loading || !url}
            style={{
              padding: "0.875rem 2rem",
              borderRadius: "0.75rem",
              border: "none",
              background: "var(--accent)",
              color: "white",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
              opacity: loading || !url ? 0.6 : 1,
            }}
          >
            {loading ? "Scanning..." : "QA Check"}
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: "2rem",
            justifyContent: "center",
            color: "var(--text-muted)",
            fontSize: "0.875rem",
          }}
        >
          <span>JS Errors</span>
          <span>Accessibility</span>
          <span>UX Audit</span>
          <span>Diff Crawl</span>
          <span>Workflow Replay</span>
        </div>

        <div
          style={{
            marginTop: "4rem",
            padding: "1.5rem",
            borderRadius: "1rem",
            border: "1px solid var(--border)",
            background: "var(--bg-surface)",
            fontFamily: "monospace",
            fontSize: "0.875rem",
            color: "var(--text-secondary)",
            textAlign: "left",
          }}
        >
          <div style={{ color: "var(--text-muted)", marginBottom: "0.5rem" }}>
            # Install
          </div>
          <div>
            <span style={{ color: "var(--accent)" }}>$</span> cargo install
            nodebench-qa-cli
          </div>
          <div style={{ marginTop: "0.75rem", color: "var(--text-muted)" }}>
            # Or use from Claude Code / Cursor / Windsurf
          </div>
          <div>
            <span style={{ color: "var(--accent)" }}>$</span> nbqa check
            http://localhost:3000
          </div>
        </div>
      </div>
    </div>
  );
}
