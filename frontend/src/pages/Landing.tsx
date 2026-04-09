import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useEffect } from "react";
import { seedDemoData } from "../lib/demo-data";

/* ── Shared styles ─────────────────────────────────────────────── */

const glass: React.CSSProperties = {
  borderRadius: "0.625rem",
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
};

const mono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

const muted: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--text-secondary)",
  lineHeight: 1.6,
};

const sectionLabel: React.CSSProperties = {
  fontSize: "0.6875rem",
  textTransform: "uppercase",
  letterSpacing: "0.15em",
  color: "var(--text-muted)",
  marginBottom: "1.25rem",
};

/* ── Component ─────────────────────────────────────────────────── */

export function Landing() {
  const navigate = useNavigate();
  useEffect(() => { seedDemoData(); }, []);

  return (
    <Layout>
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "3rem 1.5rem 2rem" }}>

        {/* ════════════════════════════════════════════════════════
            SECTION 1 — Hero: pain + visible miss + CTA
            ════════════════════════════════════════════════════════ */}

        <div style={{ textAlign: "center", marginBottom: "3rem" }}>
          <h1 style={{ fontSize: "2.75rem", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.15, marginBottom: "0.5rem" }}>
            Your agent says it's done too early.
          </h1>
          <h2 style={{ fontSize: "2.75rem", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.15, marginBottom: "1.5rem", color: "var(--accent)" }}>
            Attrition shows what it skipped.
          </h2>
          <p style={{ ...muted, maxWidth: 560, margin: "0 auto 2.5rem", fontSize: "1.0625rem" }}>
            Watch tool calls, file edits, searches, and artifacts.
            Judge every recurring workflow against your actual standard.
            Replay the next run cheaper.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => { document.getElementById("example")?.scrollIntoView({ behavior: "smooth" }); }}
              style={{ padding: "0.875rem 2rem", borderRadius: "0.75rem", border: "none", background: "var(--accent)", color: "#fff", fontSize: "1rem", fontWeight: 600, cursor: "pointer" }}
            >
              Watch a real run
            </button>
            <button
              onClick={() => navigate("/anatomy")}
              style={{ padding: "0.875rem 2rem", borderRadius: "0.75rem", border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)", fontSize: "1rem", fontWeight: 500, cursor: "pointer" }}
            >
              See what got missed
            </button>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════
            SECTION 2 — The visible "aha": a real agent miss
            This IS the product. Show it, don't describe it.
            ════════════════════════════════════════════════════════ */}

        <div id="example" style={{ marginBottom: "3.5rem" }}>
          <h3 style={{ ...sectionLabel, textAlign: "center" }}>Real Example</h3>

          <div style={{ ...glass, padding: "1.5rem", marginBottom: "0.75rem" }}>
            <div style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
              Cross-stack refactor &mdash; agent changed UI + backend
            </div>

            {/* The miss */}
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>Agent reported:</div>
                <div style={{ ...glass, padding: "0.75rem 1rem", background: "rgba(255,255,255,0.02)" }}>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-primary)", marginBottom: "0.25rem" }}>
                    &ldquo;Done! Refactored the API client and updated all imports.&rdquo;
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>12 files changed, tests pass, build clean</div>
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: "0.75rem", color: "#ef4444", marginBottom: "0.5rem", fontWeight: 600 }}>Attrition caught:</div>
                <div style={{ ...glass, padding: "0.75rem 1rem", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.04)" }}>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#ef4444", marginBottom: "0.5rem" }}>Missing required steps:</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                    {["Latest industry/context search", "Interactive surface audit (5 pages)", "Generated types update"].map((step) => (
                      <div key={step} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem" }}>
                        <span style={{ color: "#ef4444", ...mono, fontSize: "0.75rem" }}>MISSING</span>
                        <span style={{ color: "var(--text-primary)" }}>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Verdict + corrected replay */}
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ ...glass, padding: "0.75rem 1rem", flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: "0.375rem" }}>Judge Verdict</div>
                <span style={{ display: "inline-block", padding: "0.125rem 0.5rem", borderRadius: "0.25rem", background: "rgba(234,179,8,0.15)", color: "#eab308", fontSize: "0.75rem", fontWeight: 600, ...mono }}>
                  REPLAY SHOULD HAVE ESCALATED
                </span>
              </div>
              <div style={{ ...glass, padding: "0.75rem 1rem", flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: "0.375rem" }}>After correction</div>
                <span style={{ display: "inline-block", padding: "0.125rem 0.5rem", borderRadius: "0.25rem", background: "rgba(34,197,94,0.15)", color: "#22c55e", fontSize: "0.75rem", fontWeight: 600, ...mono }}>
                  ACCEPTED
                </span>
                <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "var(--text-secondary)" }}>63% cheaper replay</span>
              </div>
            </div>
          </div>

          <p style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Real workflow. Real miss. Real catch. &mdash;{" "}
            <a href="/anatomy" style={{ color: "var(--accent)", textDecoration: "none" }}>See the full 560-step trace &rarr;</a>
          </p>
        </div>

        {/* ════════════════════════════════════════════════════════
            SECTION 3 — How it works (3 plain-English steps)
            ════════════════════════════════════════════════════════ */}

        <div style={{ marginBottom: "3.5rem" }}>
          <h3 style={{ ...sectionLabel, textAlign: "center" }}>How it works</h3>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.875rem" }}>
            {[
              {
                num: "1",
                title: "Capture",
                desc: "Watch prompts, tool calls, file edits, searches, and outputs. Every action becomes a canonical event.",
              },
              {
                num: "2",
                title: "Judge",
                desc: "Compare what happened against your recurring workflow standard. Flag missing steps. Block incomplete work.",
              },
              {
                num: "3",
                title: "Replay",
                desc: "Reuse the valid path with a cheaper model. Judge verifies the replay is correct before accepting.",
              },
            ].map((step) => (
              <div key={step.num} style={{ ...glass, padding: "1.25rem", textAlign: "left" }}>
                <div style={{ ...mono, fontSize: "1.5rem", fontWeight: 700, color: "var(--accent)", marginBottom: "0.375rem" }}>{step.num}</div>
                <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>{step.title}</div>
                <p style={{ ...muted, fontSize: "0.8125rem", margin: 0 }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════
            SECTION 4 — Who it's for
            ════════════════════════════════════════════════════════ */}

        <div style={{ marginBottom: "3.5rem" }}>
          <h3 style={{ ...sectionLabel, textAlign: "center" }}>Who it's for</h3>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.875rem" }}>
            {[
              { who: "Claude Code users", line: "Stop re-explaining the same workflow every session." },
              { who: "AI engineers", line: "See exactly what the model did, what it missed, and when replay is safe." },
              { who: "Teams", line: "Track workflow savings, replay quality, and escalation across repeated runs." },
            ].map((card) => (
              <div key={card.who} style={{ ...glass, padding: "1.25rem", textAlign: "left" }}>
                <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.375rem" }}>{card.who}</div>
                <p style={{ ...muted, fontSize: "0.8125rem", margin: 0 }}>{card.line}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════
            SECTION 5 — Proof (legible, not weird internal metrics)
            ════════════════════════════════════════════════════════ */}

        <div style={{ marginBottom: "3.5rem" }}>
          <h3 style={{ ...sectionLabel, textAlign: "center" }}>Proof</h3>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.875rem", marginBottom: "1rem" }}>
            {[
              { stat: "14/15", label: "acceptable replays on a cross-stack benchmark" },
              { stat: "60–70%", label: "lower replay cost vs frontier run" },
              { stat: "8/8", label: "required workflow steps verified with tool-call evidence" },
              { stat: "45%", label: "of workflow distilled into reusable replay path" },
            ].map((item) => (
              <div key={item.label} style={{ ...glass, padding: "1rem 1.25rem", display: "flex", alignItems: "baseline", gap: "0.75rem" }}>
                <span style={{ ...mono, fontSize: "1.5rem", fontWeight: 700, color: "var(--accent)", flexShrink: 0 }}>{item.stat}</span>
                <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>{item.label}</span>
              </div>
            ))}
          </div>

          <p style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
            Trace, verdict, and missing-step evidence shown for every run. Not simulated.{" "}
            <a href="/benchmark" style={{ color: "var(--accent)", textDecoration: "none" }}>See benchmark report &rarr;</a>
          </p>
        </div>

        {/* ════════════════════════════════════════════════════════
            SECTION 6 — Install (NOW it makes sense)
            ════════════════════════════════════════════════════════ */}

        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <h3 style={{ ...sectionLabel }}>Try it</h3>

          <div style={{ ...glass, padding: "1.25rem 2rem", ...mono, fontSize: "0.875rem", maxWidth: 460, margin: "0 auto 0.625rem", border: "1px solid rgba(217,119,87,0.25)", background: "rgba(217,119,87,0.03)" }}>
            <span style={{ color: "var(--accent)" }}>$</span>{" "}
            <span style={{ color: "var(--text-primary)" }}>curl -sL attrition.sh/install | bash</span>
          </div>

          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "1.5rem" }}>
            Free forever. Runs locally. Hooks activate automatically.
          </p>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center", marginBottom: "1rem" }}>
            {["Claude Code", "Cursor", "OpenAI", "LangChain", "CrewAI", "Anthropic", "PydanticAI"].map((name) => (
              <span key={name} style={{ padding: "0.25rem 0.625rem", borderRadius: "2rem", border: "1px solid var(--border)", background: "var(--bg-surface)", fontSize: "0.6875rem", color: "var(--text-muted)" }}>
                {name}
              </span>
            ))}
          </div>

          <p style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>One install. Every agent runtime.</p>
        </div>

      </div>
    </Layout>
  );
}
