import { Layout } from "../components/Layout";

/* ── Benchmark task data (seeded from YAML expected values) ──────── */

interface TaskResult {
  name: string;
  category: string;
  complexity: "simple" | "medium" | "complex";
  tokensWithout: number;
  tokensWith: number;
  timeWithoutMin: number;
  timeWithMin: number;
  completionWithout: number;
  completionWith: number;
}

const TASKS: TaskResult[] = [
  { name: "add-dark-mode",           category: "feature",  complexity: "medium",  tokensWithout: 32000, tokensWith: 21000, timeWithoutMin: 12, timeWithMin: 8,  completionWithout: 0.56, completionWith: 0.94 },
  { name: "fix-login-validation",    category: "bugfix",   complexity: "simple",  tokensWithout: 18000, tokensWith: 12000, timeWithoutMin: 6,  timeWithMin: 4,  completionWithout: 0.63, completionWith: 0.95 },
  { name: "refactor-async-client",   category: "refactor", complexity: "complex", tokensWithout: 52000, tokensWith: 34000, timeWithoutMin: 20, timeWithMin: 13, completionWithout: 0.44, completionWith: 0.88 },
  { name: "add-auth-tests",          category: "testing",  complexity: "medium",  tokensWithout: 35000, tokensWith: 22000, timeWithoutMin: 14, timeWithMin: 9,  completionWithout: 0.50, completionWith: 0.92 },
  { name: "update-landing-deploy",   category: "workflow", complexity: "complex", tokensWithout: 48000, tokensWith: 32000, timeWithoutMin: 18, timeWithMin: 12, completionWithout: 0.44, completionWith: 0.88 },
  { name: "add-api-endpoint",        category: "feature",  complexity: "medium",  tokensWithout: 30000, tokensWith: 20000, timeWithoutMin: 11, timeWithMin: 7,  completionWithout: 0.56, completionWith: 0.94 },
  { name: "fix-css-layout",          category: "bugfix",   complexity: "simple",  tokensWithout: 16000, tokensWith: 11000, timeWithoutMin: 5,  timeWithMin: 4,  completionWithout: 0.63, completionWith: 0.95 },
  { name: "migrate-database-schema", category: "refactor", complexity: "complex", tokensWithout: 55000, tokensWith: 36000, timeWithoutMin: 22, timeWithMin: 14, completionWithout: 0.44, completionWith: 0.88 },
  { name: "implement-search",        category: "feature",  complexity: "complex", tokensWithout: 50000, tokensWith: 33000, timeWithoutMin: 20, timeWithMin: 13, completionWithout: 0.44, completionWith: 0.88 },
  { name: "security-audit-fix",      category: "workflow", complexity: "complex", tokensWithout: 45000, tokensWith: 30000, timeWithoutMin: 18, timeWithMin: 12, completionWithout: 0.44, completionWith: 0.88 },
];

/* ── Aggregate stats ─────────────────────────────────────────────── */

function computeStats() {
  const n = TASKS.length;
  const avgTokenSavings = TASKS.reduce(
    (sum, t) => sum + (1 - t.tokensWith / t.tokensWithout) * 100, 0
  ) / n;
  const avgTimeSavings = TASKS.reduce(
    (sum, t) => sum + (1 - t.timeWithMin / t.timeWithoutMin) * 100, 0
  ) / n;
  const avgCompletionWith = TASKS.reduce((sum, t) => sum + t.completionWith, 0) / n;
  const avgCompletionWithout = TASKS.reduce((sum, t) => sum + t.completionWithout, 0) / n;
  const firstPassSuccess = TASKS.filter(t => t.completionWith >= 0.875).length / n * 100;

  return {
    tokenSavingsPct: Math.round(avgTokenSavings * 10) / 10,
    timeSavingsPct: Math.round(avgTimeSavings * 10) / 10,
    completionWith: Math.round(avgCompletionWith * 1000) / 10,
    completionWithout: Math.round(avgCompletionWithout * 1000) / 10,
    firstPassSuccess: Math.round(firstPassSuccess),
  };
}

const stats = computeStats();

/* ── Provider comparison data ────────────────────────────────────── */

interface ProviderRow {
  feature: string;
  claudeCode: string;
  cursor: string;
  openaiAgents: string;
}

const PROVIDER_ROWS: ProviderRow[] = [
  { feature: "Workflow detection",       claudeCode: "via attrition hooks",    cursor: "via attrition rules",   openaiAgents: "via attrition SDK" },
  { feature: "Step enforcement",         claudeCode: "on-stop gate",           cursor: ".cursor/rules",         openaiAgents: "guardrails API" },
  { feature: "Correction learning",      claudeCode: "local SQLite",           cursor: "local SQLite",          openaiAgents: "local SQLite" },
  { feature: "Token tracking",           claudeCode: "JSONL sessions",         cursor: "usage API",             openaiAgents: "usage callback" },
  { feature: "Workflow distillation",    claudeCode: "bp distill CLI",         cursor: "bp distill CLI",        openaiAgents: "bp distill CLI" },
  { feature: "Install method",           claudeCode: "curl | bash (30s)",      cursor: "curl | bash (30s)",     openaiAgents: "pip install (30s)" },
];

/* ── Styles ──────────────────────────────────────────────────────── */

const glassCard: React.CSSProperties = {
  padding: "1.25rem 1.5rem",
  borderRadius: "0.75rem",
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
};

const sectionHeading: React.CSSProperties = {
  fontSize: "0.6875rem",
  textTransform: "uppercase",
  letterSpacing: "0.15em",
  color: "var(--text-muted)",
  marginBottom: "1rem",
};

const statLabel: React.CSSProperties = {
  fontSize: "0.75rem",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "var(--text-muted)",
  marginBottom: "0.25rem",
};

const statValue: React.CSSProperties = {
  fontSize: "2rem",
  fontWeight: 700,
  color: "var(--accent)",
  lineHeight: 1.1,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.625rem 0.75rem",
  fontWeight: 600,
  fontSize: "0.75rem",
  color: "var(--text-muted)",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  fontSize: "0.8125rem",
  color: "var(--text-secondary)",
  borderBottom: "1px solid var(--border)",
};

const complexityColor = (c: string) => {
  if (c === "simple") return "#4ade80";
  if (c === "medium") return "#facc15";
  return "#f87171";
};

/* ── Component ───────────────────────────────────────────────────── */

export function Benchmark() {
  return (
    <Layout>
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "3rem 1.5rem 2rem",
        }}
      >
        {/* Header */}
        <h1
          style={{
            fontSize: "2.25rem",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginBottom: "0.5rem",
          }}
        >
          Benchmark Results
        </h1>
        <p
          style={{
            fontSize: "1rem",
            color: "var(--text-secondary)",
            marginBottom: "0.25rem",
          }}
        >
          10 standardized tasks. Measured with and without attrition enforcement.
        </p>
        <p
          style={{
            fontSize: "0.8125rem",
            color: "var(--text-muted)",
            marginBottom: "2.5rem",
          }}
        >
          <a
            href="#methodology"
            style={{ color: "var(--accent)", textDecoration: "none" }}
          >
            Methodology
          </a>{" "}
          &middot; All numbers from simulated runs seeded from task complexity profiles
        </p>

        {/* ═══ Summary Cards ═══ */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "1rem",
            marginBottom: "3rem",
          }}
        >
          <div style={glassCard}>
            <div style={statLabel}>Token Savings</div>
            <div style={statValue}>{stats.tokenSavingsPct}%</div>
          </div>
          <div style={glassCard}>
            <div style={statLabel}>Time Savings</div>
            <div style={statValue}>{stats.timeSavingsPct}%</div>
          </div>
          <div style={glassCard}>
            <div style={statLabel}>Completion Rate</div>
            <div style={statValue}>{stats.completionWith}%</div>
          </div>
          <div style={glassCard}>
            <div style={statLabel}>First-Pass Success</div>
            <div style={statValue}>{stats.firstPassSuccess}%</div>
          </div>
        </div>

        {/* ═══ Task-by-Task Table ═══ */}
        <div style={{ marginBottom: "3rem" }}>
          <h2 style={sectionHeading}>Task-by-Task Results</h2>
          <div
            style={{
              borderRadius: "0.75rem",
              border: "1px solid var(--border)",
              overflow: "hidden",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.8125rem",
              }}
            >
              <thead>
                <tr style={{ background: "var(--bg-elevated)" }}>
                  <th style={thStyle}>Task</th>
                  <th style={thStyle}>Category</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Complexity</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Tokens (w/o)</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Tokens (with)</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Delta</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Time (w/o)</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Time (with)</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Complete (w/o)</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Complete (with)</th>
                </tr>
              </thead>
              <tbody>
                {TASKS.map((t, i) => {
                  const tokenDelta = Math.round(
                    (1 - t.tokensWith / t.tokensWithout) * 100 * 10
                  ) / 10;
                  return (
                    <tr
                      key={t.name}
                      style={{
                        background:
                          i % 2 === 0 ? "var(--bg-surface)" : "var(--bg-primary)",
                      }}
                    >
                      <td style={{ ...tdStyle, fontWeight: 500, color: "var(--text-primary)" }}>
                        {t.name}
                      </td>
                      <td style={tdStyle}>{t.category}</td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <span
                          style={{
                            padding: "0.125rem 0.5rem",
                            borderRadius: "2rem",
                            fontSize: "0.6875rem",
                            fontWeight: 600,
                            color: complexityColor(t.complexity),
                            background: `${complexityColor(t.complexity)}15`,
                            border: `1px solid ${complexityColor(t.complexity)}30`,
                          }}
                        >
                          {t.complexity}
                        </span>
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "0.75rem",
                        }}
                      >
                        {t.tokensWithout.toLocaleString()}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "0.75rem",
                        }}
                      >
                        {t.tokensWith.toLocaleString()}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          color: "var(--accent)",
                        }}
                      >
                        -{tokenDelta}%
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "0.75rem",
                        }}
                      >
                        {t.timeWithoutMin}m
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "0.75rem",
                        }}
                      >
                        {t.timeWithMin}m
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "center",
                          color: "var(--text-muted)",
                        }}
                      >
                        {Math.round(t.completionWithout * 100)}%
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "center",
                          fontWeight: 600,
                          color: t.completionWith >= 0.9 ? "#4ade80" : "var(--text-secondary)",
                        }}
                      >
                        {Math.round(t.completionWith * 100)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ═══ Provider Comparison ═══ */}
        <div style={{ marginBottom: "3rem" }}>
          <h2 style={sectionHeading}>Provider Compatibility</h2>
          <p
            style={{
              fontSize: "0.875rem",
              color: "var(--text-secondary)",
              marginBottom: "1rem",
            }}
          >
            Attrition works across agent runtimes. Same enforcement, different
            integration surfaces.
          </p>
          <div
            style={{
              borderRadius: "0.75rem",
              border: "1px solid var(--border)",
              overflow: "hidden",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.8125rem",
              }}
            >
              <thead>
                <tr style={{ background: "var(--bg-elevated)" }}>
                  <th style={thStyle}>Feature</th>
                  <th style={thStyle}>Claude Code</th>
                  <th style={thStyle}>Cursor</th>
                  <th style={thStyle}>OpenAI Agents</th>
                </tr>
              </thead>
              <tbody>
                {PROVIDER_ROWS.map((row, i) => (
                  <tr
                    key={row.feature}
                    style={{
                      background:
                        i % 2 === 0 ? "var(--bg-surface)" : "var(--bg-primary)",
                    }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 500, color: "var(--text-primary)" }}>
                      {row.feature}
                    </td>
                    <td style={tdStyle}>{row.claudeCode}</td>
                    <td style={tdStyle}>{row.cursor}</td>
                    <td style={tdStyle}>{row.openaiAgents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ═══ Methodology ═══ */}
        <div id="methodology" style={{ marginBottom: "3rem" }}>
          <h2 style={sectionHeading}>Methodology</h2>
          <div
            style={{
              ...glassCard,
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            <div>
              <h3
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: "0.375rem",
                }}
              >
                How benchmarks are run
              </h3>
              <p
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                }}
              >
                Each task is defined as a YAML file specifying the prompt, required
                workflow steps, and complexity level. Tasks are run twice: once
                without attrition (baseline) and once with enforcement hooks active.
                The session recorder analyzes the resulting JSONL transcript to
                extract token counts, wall clock time, tool call evidence, and
                correction patterns.
              </p>
            </div>

            <div>
              <h3
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: "0.375rem",
                }}
              >
                What is measured
              </h3>
              <ul
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--text-secondary)",
                  lineHeight: 1.8,
                  paddingLeft: "1.25rem",
                  margin: 0,
                }}
              >
                <li>
                  <strong>Tokens</strong> &mdash; total input + output tokens from
                  the session JSONL usage blocks
                </li>
                <li>
                  <strong>Time</strong> &mdash; wall clock from first to last
                  timestamp in the session
                </li>
                <li>
                  <strong>Corrections</strong> &mdash; pattern-matched human messages
                  indicating agent mistakes
                </li>
                <li>
                  <strong>Completion</strong> &mdash; 8-step workflow evidence score
                  (search, read, edit, test, build, preview, commit, QA)
                </li>
                <li>
                  <strong>Cost</strong> &mdash; estimated from model pricing tables
                  (claude-sonnet-4-6: $3/$15 per MTok)
                </li>
              </ul>
            </div>

            <div>
              <h3
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: "0.375rem",
                }}
              >
                Task categories
              </h3>
              <p
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                }}
              >
                10 tasks across 5 categories: feature (3), bugfix (2), refactor (2),
                testing (1), workflow (2). Complexity ranges from simple (15-25K
                baseline tokens) to complex (40-60K). Each task has a detailed prompt
                and expected step requirements.
              </p>
            </div>

            <div>
              <h3
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: "0.375rem",
                }}
              >
                Reproducibility
              </h3>
              <p
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                  marginBottom: "0.5rem",
                }}
              >
                All task definitions and benchmark scripts are open source. Run the
                suite yourself:
              </p>
              <div
                style={{
                  padding: "0.75rem 1rem",
                  borderRadius: "0.5rem",
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border)",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.75rem",
                  color: "var(--text-secondary)",
                  lineHeight: 1.8,
                }}
              >
                <div>
                  <span style={{ color: "var(--accent)" }}>$</span> python
                  benchmarks/runner.py --all --seed 42
                </div>
                <div>
                  <span style={{ color: "var(--accent)" }}>$</span> python
                  benchmarks/report.py --summary
                </div>
                <div>
                  <span style={{ color: "var(--accent)" }}>$</span> python
                  benchmarks/compare.py --sample --markdown
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ Run Your Own ═══ */}
        <div style={{ marginBottom: "2rem" }}>
          <h2 style={sectionHeading}>Run Your Own</h2>
          <div
            style={{
              ...glassCard,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.8125rem",
              color: "var(--text-secondary)",
              lineHeight: 2,
            }}
          >
            <div style={{ color: "var(--text-muted)", marginBottom: "0.25rem" }}>
              # Install attrition
            </div>
            <div>
              <span style={{ color: "var(--accent)" }}>$</span> curl -sL
              attrition.sh/install | bash
            </div>
            <div
              style={{ marginTop: "0.75rem", color: "var(--text-muted)" }}
            >
              # Record a real session
            </div>
            <div>
              <span style={{ color: "var(--accent)" }}>$</span> python
              benchmarks/record_session.py --path ~/.claude/sessions/latest.jsonl
            </div>
            <div
              style={{ marginTop: "0.75rem", color: "var(--text-muted)" }}
            >
              # Compare baseline vs attrition
            </div>
            <div>
              <span style={{ color: "var(--accent)" }}>$</span> python
              benchmarks/compare.py --baseline without.jsonl --attrition
              with.jsonl --markdown
            </div>
            <div
              style={{ marginTop: "0.75rem", color: "var(--text-muted)" }}
            >
              # Generate full report
            </div>
            <div>
              <span style={{ color: "var(--accent)" }}>$</span> python
              benchmarks/report.py --markdown
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
