import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";

const sectionStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "3rem 1.5rem",
};

const linkCardStyle: React.CSSProperties = {
  display: "block",
  padding: "1rem 1.25rem",
  borderRadius: "0.75rem",
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
  textDecoration: "none",
  marginBottom: "0.75rem",
  transition: "border-color 0.15s",
};

const PAGES = [
  { to: "/proof", title: "Proof", desc: "The full pain-to-fix breakdown with real agent miss data." },
  { to: "/improvements", title: "How It Works", desc: "Capture, Judge, Replay — the three-step loop explained." },
  { to: "/benchmark", title: "Benchmark", desc: "Token savings, completion rates, and cost comparisons." },
  { to: "/get-started", title: "Get Started", desc: "Install locally, use the hosted API, or add as MCP server." },
  { to: "/live", title: "Live Dashboard", desc: "Real-time server health, hook status, and request log." },
  { to: "/workflows", title: "Workflows", desc: "Browse captured workflows with event counts and fingerprints." },
  { to: "/judge", title: "Judge Sessions", desc: "Review judge verdicts, divergences, and correction nudges." },
  { to: "/anatomy", title: "Run Anatomy", desc: "Step-by-step trace of a QA check — every tool call visualized." },
] as const;

export function Docs() {
  return (
    <Layout>
      <section style={sectionStyle}>
        <h1 style={{
          fontSize: "2rem",
          fontWeight: 700,
          letterSpacing: "-0.03em",
          marginBottom: "0.5rem",
        }}>
          Docs
        </h1>
        <p style={{
          fontSize: "1rem",
          color: "var(--text-secondary)",
          marginBottom: "2rem",
          lineHeight: 1.6,
        }}>
          Everything about attrition — proof, benchmarks, workflows, and how to get started.
        </p>

        {PAGES.map(({ to, title, desc }) => (
          <Link key={to} to={to} style={linkCardStyle}>
            <div style={{
              fontSize: "1rem",
              fontWeight: 600,
              color: "var(--text-primary)",
              marginBottom: "0.25rem",
            }}>
              {title}
            </div>
            <div style={{
              fontSize: "0.875rem",
              color: "var(--text-secondary)",
              lineHeight: 1.5,
            }}>
              {desc}
            </div>
          </Link>
        ))}
      </section>
    </Layout>
  );
}
