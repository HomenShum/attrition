import { Layout } from "../components/Layout";

const sectionStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "3rem 1.5rem",
};

const headingStyle: React.CSSProperties = {
  fontSize: "2rem",
  fontWeight: 700,
  letterSpacing: "-0.03em",
  marginBottom: "0.5rem",
};

const subheadStyle: React.CSSProperties = {
  fontSize: "1rem",
  color: "var(--text-secondary)",
  marginBottom: "2.5rem",
  lineHeight: 1.6,
};

const stepCardStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: "0.75rem",
  padding: "1.5rem",
  marginBottom: "1.25rem",
};

const stepNumberStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: "50%",
  background: "rgba(217,119,87,0.12)",
  color: "var(--accent)",
  fontSize: "0.8125rem",
  fontWeight: 700,
  marginRight: "0.75rem",
};

const stepTitleStyle: React.CSSProperties = {
  fontSize: "1.125rem",
  fontWeight: 600,
  marginBottom: "0.75rem",
  display: "flex",
  alignItems: "center",
};

const codeBlockStyle: React.CSSProperties = {
  background: "var(--bg-primary)",
  border: "1px solid var(--border)",
  borderRadius: "0.5rem",
  padding: "1rem 1.25rem",
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: "0.8125rem",
  lineHeight: 1.7,
  color: "var(--text-primary)",
  overflowX: "auto",
  whiteSpace: "pre",
  marginTop: "0.75rem",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "var(--text-muted)",
  marginBottom: "0.375rem",
};

const paragraphStyle: React.CSSProperties = {
  fontSize: "0.9375rem",
  color: "var(--text-secondary)",
  lineHeight: 1.6,
};

const MCP_CONFIG = `{
  "mcpServers": {
    "attrition": {
      "command": "npx",
      "args": ["-y", "attrition@latest"],
      "env": {
        "ATTRITION_API_KEY": "<your-key>"
      }
    }
  }
}`;

export function GetStarted() {
  return (
    <Layout>
      <section style={sectionStyle}>
        <h1 style={headingStyle}>Get Started</h1>
        <p style={subheadStyle}>
          Three ways to use attrition. Local is free and needs no key.
          The hosted API and MCP integration require an API key.
        </p>

        {/* Step 1: Local install */}
        <div style={stepCardStyle}>
          <div style={stepTitleStyle}>
            <span style={stepNumberStyle}>1</span>
            Install locally (free, no key needed)
          </div>
          <p style={paragraphStyle}>
            Run the install script to get the CLI on your machine. Works on
            macOS and Linux. All data stays local.
          </p>
          <div style={codeBlockStyle}>
            curl -sL attrition.sh/install | bash
          </div>
          <div style={{ ...codeBlockStyle, marginTop: "0.5rem" }}>
            bp serve{"\n"}# API on :8100, MCP on :8101
          </div>
        </div>

        {/* Step 2: Hosted API */}
        <div style={stepCardStyle}>
          <div style={stepTitleStyle}>
            <span style={stepNumberStyle}>2</span>
            Use the hosted API (requires key)
          </div>
          <p style={paragraphStyle}>
            Skip local setup. Point your requests at attrition.sh and
            authenticate with a bearer token.
          </p>
          <div style={{ marginTop: "0.75rem" }}>
            <div style={labelStyle}>Request a key</div>
            <p style={paragraphStyle}>
              Email{" "}
              <a
                href="mailto:hello@attrition.sh"
                style={{ color: "var(--accent)", textDecoration: "none" }}
              >
                hello@attrition.sh
              </a>{" "}
              with your name and use case. Keys are free during early access.
            </p>
          </div>
          <div style={{ marginTop: "0.75rem" }}>
            <div style={labelStyle}>Example request</div>
            <div style={codeBlockStyle}>
{`curl -s https://attrition.sh/api/stats \\
  -H "Authorization: Bearer <your-key>"`}
            </div>
          </div>
        </div>

        {/* Step 3: MCP / Claude Code / Codex */}
        <div style={stepCardStyle}>
          <div style={stepTitleStyle}>
            <span style={stepNumberStyle}>3</span>
            Claude Code / Cursor / Codex
          </div>
          <p style={paragraphStyle}>
            Add attrition as an MCP server in your editor. The agent gets
            access to workflow capture, distillation, and judge hooks.
          </p>
          <div style={{ marginTop: "0.75rem" }}>
            <div style={labelStyle}>Add to .mcp.json</div>
            <div style={codeBlockStyle}>{MCP_CONFIG}</div>
          </div>
          <p
            style={{
              ...paragraphStyle,
              marginTop: "0.75rem",
              fontSize: "0.8125rem",
              color: "var(--text-muted)",
            }}
          >
            Without ATTRITION_API_KEY, the MCP server runs locally against your
            own bp serve instance. With a key, it proxies to the hosted API.
          </p>
        </div>

        {/* Footer note */}
        <div
          style={{
            marginTop: "2rem",
            padding: "1.25rem",
            background: "rgba(217,119,87,0.04)",
            border: "1px solid rgba(217,119,87,0.15)",
            borderRadius: "0.75rem",
          }}
        >
          <p
            style={{
              fontSize: "0.875rem",
              color: "var(--text-secondary)",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: "var(--accent)" }}>Early access.</strong>{" "}
            Attrition is in active development. The API is stable but the
            feature set is growing weekly. If something breaks, file an issue on{" "}
            <a
              href="https://github.com/HomenShum/attrition/issues"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent)", textDecoration: "none" }}
            >
              GitHub
            </a>{" "}
            or email hello@attrition.sh.
          </p>
        </div>
      </section>
    </Layout>
  );
}
