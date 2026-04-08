import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useEffect } from "react";
import { seedDemoData } from "../lib/demo-data";

const FEATURE_CARDS: { title: string; desc: string; icon: string; accent?: boolean }[] = [
  {
    title: "Capture",
    desc: "Record Claude Code sessions as canonical events. Every tool call, decision, file edit, and assertion — preserved as a replayable workflow.",
    icon: "\u25CF",
    accent: true,
  },
  {
    title: "Distill",
    desc: "Compress workflows 40\u201365% by eliminating redundant reasoning. Keep checkpoints and decisions. Slash replay costs.",
    icon: "\u25B2",
  },
  {
    title: "Judge",
    desc: "Enforce correctness during replay. Detect divergences, nudge the model back on track, escalate when confidence drops.",
    icon: "\u25C6",
  },
];

export function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    seedDemoData();
  }, []);

  return (
    <Layout>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "5rem 1.5rem 2rem",
          minHeight: "calc(100vh - 56px - 60px)",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 720, width: "100%" }}>
          {/* Hero */}
          <h1
            style={{
              fontSize: "3.5rem",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              marginBottom: "0.75rem",
            }}
          >
            bench
            <span style={{ color: "var(--accent)" }}>press</span>
          </h1>

          <p
            style={{
              fontSize: "1.375rem",
              fontWeight: 500,
              color: "var(--text-primary)",
              lineHeight: 1.4,
              marginBottom: "0.75rem",
            }}
          >
            Frontier workflows. Sonnet prices.
          </p>

          <p
            style={{
              fontSize: "1.0625rem",
              color: "var(--text-secondary)",
              lineHeight: 1.6,
              marginBottom: "2.5rem",
              maxWidth: 560,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            Capture powerful model workflows. Distill for cheaper replay.
            <br />
            Judge enforces correctness.
          </p>

          {/* CTA buttons */}
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              justifyContent: "center",
              marginBottom: "3rem",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => navigate("/workflows")}
              style={{
                padding: "0.875rem 2.25rem",
                borderRadius: "0.75rem",
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "opacity 0.15s, transform 0.1s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.9"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
            >
              Capture Workflow
            </button>
            <button
              onClick={() => navigate("/judge")}
              style={{
                padding: "0.875rem 2.25rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-primary)",
                fontSize: "1rem",
                fontWeight: 500,
                cursor: "pointer",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
            >
              View Judge
            </button>
          </div>

          {/* Feature cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "1rem",
              maxWidth: 680,
              marginLeft: "auto",
              marginRight: "auto",
              marginBottom: "3rem",
            }}
          >
            {FEATURE_CARDS.map((card) => (
              <div
                key={card.title}
                style={{
                  padding: "1.5rem 1.25rem",
                  borderRadius: "0.75rem",
                  border: card.accent
                    ? "1px solid rgba(217,119,87,0.25)"
                    : "1px solid var(--border)",
                  background: "var(--bg-surface)",
                  textAlign: "left",
                  transition: "border-color 0.15s",
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "0.5rem",
                    background: card.accent ? "rgba(217,119,87,0.12)" : "rgba(255,255,255,0.04)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.875rem",
                    color: card.accent ? "var(--accent)" : "var(--text-secondary)",
                    marginBottom: "0.875rem",
                  }}
                >
                  {card.icon}
                </div>
                <h3
                  style={{
                    fontSize: "0.9375rem",
                    fontWeight: 600,
                    marginBottom: "0.5rem",
                    color: card.accent ? "var(--accent)" : "var(--text-primary)",
                  }}
                >
                  {card.title}
                </h3>
                <p
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--text-secondary)",
                    lineHeight: 1.55,
                    margin: 0,
                  }}
                >
                  {card.desc}
                </p>
              </div>
            ))}
          </div>

          {/* Install snippet */}
          <div
            style={{
              padding: "1.25rem 1.5rem",
              borderRadius: "0.75rem",
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.8125rem",
              color: "var(--text-secondary)",
              textAlign: "left",
              maxWidth: 540,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            <div style={{ color: "var(--text-muted)", marginBottom: "0.375rem" }}>
              # Install
            </div>
            <div>
              <span style={{ color: "var(--accent)" }}>$</span> cargo install
              benchpress-cli
            </div>
            <div
              style={{ marginTop: "0.75rem", color: "var(--text-muted)" }}
            >
              # Capture a Claude Code session
            </div>
            <div>
              <span style={{ color: "var(--accent)" }}>$</span> bp capture
              ~/.claude/projects/my-app
            </div>
            <div
              style={{ marginTop: "0.75rem", color: "var(--text-muted)" }}
            >
              # Distill and replay at Sonnet prices
            </div>
            <div>
              <span style={{ color: "var(--accent)" }}>$</span> bp distill
              --target sonnet-4-6
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
