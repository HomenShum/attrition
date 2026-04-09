import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useEffect } from "react";
import { seedDemoData } from "../lib/demo-data";

/* -- Data --------------------------------------------------------- */

const PROVIDER_BADGES = [
  "Claude Code",
  "Cursor",
  "OpenAI",
  "LangChain",
  "CrewAI",
  "Anthropic",
  "PydanticAI",
];

/* -- Shared styles ------------------------------------------------ */

const glassCard: React.CSSProperties = {
  padding: "1rem 1.25rem",
  borderRadius: "0.625rem",
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
};

const sectionHeading: React.CSSProperties = {
  fontSize: "0.6875rem",
  textTransform: "uppercase",
  letterSpacing: "0.15em",
  color: "var(--text-muted)",
  marginBottom: "1rem",
  textAlign: "center",
};

/* -- Component ---------------------------------------------------- */

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
          padding: "3.5rem 1.5rem 2rem",
        }}
      >
        <div style={{ textAlign: "center", width: "100%", maxWidth: 820 }}>

          {/* ================================================================
              SECTION 1 -- Signature + Install (above the fold)
              ================================================================ */}

          <h1
            style={{
              fontSize: "3.5rem",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              marginBottom: "0.75rem",
            }}
          >
            att<span style={{ color: "var(--accent)" }}>rition</span>
          </h1>

          <p
            style={{
              fontSize: "1.375rem",
              fontWeight: 600,
              color: "var(--text-primary)",
              lineHeight: 1.4,
              marginBottom: "0.375rem",
            }}
          >
            Your agent says it's done too early.
          </p>
          <p
            style={{
              fontSize: "1.375rem",
              fontWeight: 600,
              color: "var(--text-secondary)",
              lineHeight: 1.4,
              marginBottom: "1.75rem",
            }}
          >
            We catch what it missed.
          </p>

          {/* Install snippet */}
          <div
            style={{
              padding: "1.25rem 2rem",
              borderRadius: "0.75rem",
              border: "1px solid rgba(217,119,87,0.3)",
              background: "rgba(217,119,87,0.04)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.9375rem",
              textAlign: "center",
              maxWidth: 460,
              marginLeft: "auto",
              marginRight: "auto",
              marginBottom: "0.625rem",
            }}
          >
            <span style={{ color: "var(--accent)" }}>$</span>{" "}
            <span style={{ color: "var(--text-primary)" }}>
              curl -sL attrition.sh/install | bash
            </span>
          </div>

          <p
            style={{
              fontSize: "0.8125rem",
              color: "var(--text-muted)",
              marginBottom: "2rem",
            }}
          >
            Free forever for solo devs. Runs locally.
          </p>

          {/* Two CTAs */}
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              justifyContent: "center",
              marginBottom: "4rem",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => {
                const el = document.getElementById("proof");
                if (el) el.scrollIntoView({ behavior: "smooth" });
              }}
              style={{
                padding: "0.875rem 2.25rem",
                borderRadius: "0.75rem",
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              See It In Action
            </button>
            <button
              onClick={() => navigate("/anatomy")}
              style={{
                padding: "0.875rem 2.25rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-primary)",
                fontSize: "1rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              View Anatomy
            </button>
          </div>

          {/* ================================================================
              SECTION 2 -- The Menu (3 cards)
              ================================================================ */}

          <div
            style={{
              marginBottom: "4rem",
              maxWidth: 820,
              width: "100%",
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            <h2 style={sectionHeading}>The Menu</h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "0.875rem",
              }}
            >
              {/* Card: Judge */}
              <div
                style={{
                  ...glassCard,
                  padding: "1.5rem 1.25rem",
                  textAlign: "left",
                  border: "1px solid rgba(217,119,87,0.25)",
                  background: "rgba(217,119,87,0.03)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <h3
                  style={{
                    fontSize: "1.125rem",
                    fontWeight: 700,
                    color: "var(--accent)",
                    marginBottom: "0.25rem",
                  }}
                >
                  Judge
                </h3>
                <p
                  style={{
                    fontSize: "0.9375rem",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    marginBottom: "0.75rem",
                    lineHeight: 1.3,
                  }}
                >
                  See what was missed
                </p>
                <p
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--text-secondary)",
                    lineHeight: 1.6,
                    flex: 1,
                  }}
                >
                  Always-on hooks detect skipped steps. Block incomplete work.
                  Learn from corrections. Verdicts: CORRECT / PARTIAL / FAILED.
                </p>
                <button
                  onClick={() => navigate("/judge")}
                  style={{
                    marginTop: "1rem",
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--accent)",
                    fontSize: "0.8125rem",
                    fontWeight: 500,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  View Judge Dashboard &rarr;
                </button>
              </div>

              {/* Card: Replay */}
              <div
                style={{
                  ...glassCard,
                  padding: "1.5rem 1.25rem",
                  textAlign: "left",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <h3
                  style={{
                    fontSize: "1.125rem",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    marginBottom: "0.25rem",
                  }}
                >
                  Replay
                </h3>
                <p
                  style={{
                    fontSize: "0.9375rem",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    marginBottom: "0.75rem",
                    lineHeight: 1.3,
                  }}
                >
                  Do it cheaper next time
                </p>
                <p
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--text-secondary)",
                    lineHeight: 1.6,
                    flex: 1,
                  }}
                >
                  Capture expensive workflows. Distill 45%. Replay on Sonnet at
                  half the cost. Judge verifies correctness during replay.
                </p>
                <button
                  onClick={() => navigate("/workflows")}
                  style={{
                    marginTop: "1rem",
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--accent)",
                    fontSize: "0.8125rem",
                    fontWeight: 500,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  View Workflows &rarr;
                </button>
              </div>

              {/* Card: Anatomy */}
              <div
                style={{
                  ...glassCard,
                  padding: "1.5rem 1.25rem",
                  textAlign: "left",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <h3
                  style={{
                    fontSize: "1.125rem",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    marginBottom: "0.25rem",
                  }}
                >
                  Anatomy
                </h3>
                <p
                  style={{
                    fontSize: "0.9375rem",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    marginBottom: "0.75rem",
                    lineHeight: 1.3,
                  }}
                >
                  See exactly what happened
                </p>
                <p
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--text-secondary)",
                    lineHeight: 1.6,
                    flex: 1,
                  }}
                >
                  560-event tool timeline. 8-step evidence grid. Cost breakdown.
                  Every tool call tracked, classified, and scored.
                </p>
                <button
                  onClick={() => navigate("/anatomy")}
                  style={{
                    marginTop: "1rem",
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--accent)",
                    fontSize: "0.8125rem",
                    fontWeight: 500,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  View Anatomy &rarr;
                </button>
              </div>
            </div>
          </div>

          {/* ================================================================
              SECTION 3 -- The Proof (real data)
              ================================================================ */}

          <div
            id="proof"
            style={{
              marginBottom: "3rem",
              maxWidth: 820,
              width: "100%",
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            <h2 style={sectionHeading}>The Proof</h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.875rem",
                marginBottom: "1.25rem",
              }}
            >
              {/* Left: Stats grid 2x2 */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "0.625rem",
                }}
              >
                {[
                  { value: "560", label: "tool calls" },
                  { value: "8/8", label: "steps" },
                  { value: "1", label: "correction" },
                  { value: "45%", label: "distilled" },
                ].map((card) => (
                  <div
                    key={card.label}
                    style={{
                      ...glassCard,
                      padding: "1.125rem 0.75rem",
                      textAlign: "center",
                      border: "1px solid rgba(217,119,87,0.2)",
                      background: "rgba(217,119,87,0.03)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "1.75rem",
                        fontWeight: 700,
                        color: "var(--accent)",
                        lineHeight: 1.1,
                        marginBottom: "0.25rem",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {card.value}
                    </div>
                    <div
                      style={{
                        fontSize: "0.6875rem",
                        color: "var(--text-secondary)",
                        fontWeight: 500,
                      }}
                    >
                      {card.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Right: Judge verdict card */}
              <div
                style={{
                  ...glassCard,
                  padding: "1.25rem 1.25rem",
                  textAlign: "left",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginBottom: "0.75rem",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.1875rem 0.625rem",
                      borderRadius: "0.25rem",
                      background: "rgba(34,197,94,0.15)",
                      color: "#22c55e",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                    }}
                  >
                    CORRECT
                  </span>
                </div>
                <p
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--text-secondary)",
                    lineHeight: 1.65,
                    margin: 0,
                    marginBottom: "0.5rem",
                  }}
                >
                  All 8 steps had evidence. Zero nudges needed.
                </p>
                <p
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--text-secondary)",
                    lineHeight: 1.65,
                    margin: 0,
                    marginBottom: "0.5rem",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  Replay saves{" "}
                  <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                    $1,965
                  </span>{" "}
                  (290M &rarr; 160M tokens)
                </p>
                <p
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    lineHeight: 1.5,
                    margin: 0,
                    fontStyle: "italic",
                  }}
                >
                  Real data from a 42-hour build. Not simulated.
                </p>
              </div>
            </div>

            {/* Provider badges */}
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                flexWrap: "wrap",
                justifyContent: "center",
                marginBottom: "0.625rem",
              }}
            >
              {PROVIDER_BADGES.map((name) => (
                <span
                  key={name}
                  style={{
                    padding: "0.3125rem 0.75rem",
                    borderRadius: "2rem",
                    border: "1px solid var(--border)",
                    background: "var(--bg-surface)",
                    fontSize: "0.6875rem",
                    color: "var(--text-secondary)",
                    fontWeight: 500,
                  }}
                >
                  {name}
                </span>
              ))}
            </div>
            <p
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                textAlign: "center",
                margin: 0,
              }}
            >
              One install. Every agent runtime.
            </p>
          </div>

          {/* ================================================================
              FOOTER -- Install snippet
              ================================================================ */}

          <div
            style={{
              padding: "1rem 1.75rem",
              borderRadius: "0.625rem",
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.8125rem",
              textAlign: "left",
              maxWidth: 520,
              marginLeft: "auto",
              marginRight: "auto",
              marginBottom: "1.5rem",
            }}
          >
            <div>
              <span style={{ color: "var(--accent)" }}>$</span>{" "}
              <span style={{ color: "var(--text-primary)" }}>
                curl -sL attrition.sh/install | bash
              </span>
            </div>
            <div style={{ color: "var(--text-muted)", marginTop: "0.375rem" }}>
              # Judge hooks activate automatically. Every session tracked.
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
