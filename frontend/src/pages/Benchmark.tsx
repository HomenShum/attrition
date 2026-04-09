import { useState, useEffect } from "react";
import { Layout } from "../components/Layout";
import {
  getBenchmarkResults,
  type BenchmarkResults,
  type BenchmarkTask,
  type BenchmarkSummary,
} from "../lib/api";

/* ── Fallback data (YAML estimates, shown when API returns no data) ── */

const FALLBACK_TASKS: BenchmarkTask[] = [
  { task_name: "add-dark-mode",           category: "feature",  complexity: "medium",  with_attrition: false, total_tokens: 32000, time_minutes: 12, corrections: 3, completion_score: 0.56, estimated_cost_usd: 0.23, model: "claude-sonnet-4-6", simulated: true },
  { task_name: "add-dark-mode",           category: "feature",  complexity: "medium",  with_attrition: true,  total_tokens: 21000, time_minutes: 8,  corrections: 0, completion_score: 0.94, estimated_cost_usd: 0.15, model: "claude-sonnet-4-6", simulated: true },
  { task_name: "fix-login-validation",    category: "bugfix",   complexity: "simple",  with_attrition: false, total_tokens: 18000, time_minutes: 6,  corrections: 1, completion_score: 0.63, estimated_cost_usd: 0.13, model: "claude-sonnet-4-6", simulated: true },
  { task_name: "fix-login-validation",    category: "bugfix",   complexity: "simple",  with_attrition: true,  total_tokens: 12000, time_minutes: 4,  corrections: 0, completion_score: 0.95, estimated_cost_usd: 0.09, model: "claude-sonnet-4-6", simulated: true },
  { task_name: "refactor-async-client",   category: "refactor", complexity: "complex", with_attrition: false, total_tokens: 52000, time_minutes: 20, corrections: 4, completion_score: 0.44, estimated_cost_usd: 0.37, model: "claude-sonnet-4-6", simulated: true },
  { task_name: "refactor-async-client",   category: "refactor", complexity: "complex", with_attrition: true,  total_tokens: 34000, time_minutes: 13, corrections: 1, completion_score: 0.88, estimated_cost_usd: 0.24, model: "claude-sonnet-4-6", simulated: true },
];

function computeFallbackSummary(): BenchmarkSummary {
  return {
    total_tasks: 3,
    token_savings_pct: 33.9,
    time_savings_pct: 33.2,
    completion_with: 92.3,
    completion_without: 54.3,
    first_pass_success_pct: 100,
    avg_corrections_with: 0.3,
    avg_corrections_without: 2.7,
  };
}

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

/* ── Helpers ─────────────────────────────────────────────────────── */

/** Pair tasks into rows: one without + one with attrition per task name */
function pairTasks(tasks: BenchmarkTask[]): Array<{ name: string; category: string; complexity: string; without: BenchmarkTask | null; with_: BenchmarkTask | null }> {
  const map = new Map<string, { without: BenchmarkTask | null; with_: BenchmarkTask | null; category: string; complexity: string }>();
  for (const t of tasks) {
    const entry = map.get(t.task_name) ?? { without: null, with_: null, category: t.category, complexity: t.complexity };
    if (t.with_attrition) entry.with_ = t;
    else entry.without = t;
    map.set(t.task_name, entry);
  }
  return [...map.entries()].map(([name, v]) => ({ name, ...v }));
}

/* ── Component ───────────────────────────────────────────────────── */

export function Benchmark() {
  const [results, setResults] = useState<BenchmarkResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBenchmarkResults()
      .then((data) => {
        setResults(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });
  }, []);

  // Use real data or fallback
  const isServerDown = !!error;
  const hasRealData = results !== null && results.tasks.length > 0;
  const tasks = hasRealData ? results.tasks : FALLBACK_TASKS;
  const summary = hasRealData ? results.summary : computeFallbackSummary();
  const source = hasRealData ? results.source : "projected";
  const paired = pairTasks(tasks);

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
          {summary.total_tasks} standardized tasks. Measured with and without
          attrition enforcement.
        </p>
        <p
          style={{
            fontSize: "0.8125rem",
            color: "var(--text-muted)",
            marginBottom: "2.5rem",
          }}
        >
          {isServerDown && (
            <span style={{ color: "#ef4444", marginRight: "0.5rem" }}>
              Server unreachable -- showing projected data.
            </span>
          )}
          {!isServerDown && source === "simulated" && (
            <span style={{ color: "#ecc94b", marginRight: "0.5rem" }}>
              Simulated data -- run real benchmarks to replace.
            </span>
          )}
          {!isServerDown && source === "no_data" && (
            <span style={{ color: "#ecc94b", marginRight: "0.5rem" }}>
              No benchmark results on disk -- showing projected data.
            </span>
          )}
          {!isServerDown && source === "benchmark_results" && (
            <span style={{ color: "#48bb78", marginRight: "0.5rem" }}>
              Live benchmark data.
            </span>
          )}
          <a
            href="#methodology"
            style={{ color: "var(--accent)", textDecoration: "none" }}
          >
            Methodology
          </a>
        </p>

        {loading && (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
            Loading benchmark data...
          </div>
        )}

        {/* Summary Cards */}
        {!loading && (
          <>
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
                <div style={statValue}>{summary.token_savings_pct}%</div>
              </div>
              <div style={glassCard}>
                <div style={statLabel}>Time Savings</div>
                <div style={statValue}>{summary.time_savings_pct}%</div>
              </div>
              <div style={glassCard}>
                <div style={statLabel}>Completion Rate</div>
                <div style={statValue}>{summary.completion_with}%</div>
              </div>
              <div style={glassCard}>
                <div style={statLabel}>First-Pass Success</div>
                <div style={statValue}>{summary.first_pass_success_pct}%</div>
              </div>
            </div>

            {/* Task-by-Task Table */}
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
                      <th style={{ ...thStyle, textAlign: "center" }}>Done (w/o)</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>Done (with)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paired.map((row, i) => {
                      const wo = row.without;
                      const wi = row.with_;
                      const tokenDelta =
                        wo && wi && wo.total_tokens > 0
                          ? Math.round(
                              (1 - wi.total_tokens / wo.total_tokens) * 1000,
                            ) / 10
                          : 0;
                      return (
                        <tr
                          key={row.name}
                          style={{
                            background:
                              i % 2 === 0
                                ? "var(--bg-surface)"
                                : "var(--bg-primary)",
                          }}
                        >
                          <td
                            style={{
                              ...tdStyle,
                              fontWeight: 500,
                              color: "var(--text-primary)",
                            }}
                          >
                            {row.name}
                          </td>
                          <td style={tdStyle}>{row.category}</td>
                          <td style={{ ...tdStyle, textAlign: "center" }}>
                            <span
                              style={{
                                padding: "0.125rem 0.5rem",
                                borderRadius: "2rem",
                                fontSize: "0.6875rem",
                                fontWeight: 600,
                                color: complexityColor(row.complexity),
                                background: `${complexityColor(row.complexity)}15`,
                                border: `1px solid ${complexityColor(row.complexity)}30`,
                              }}
                            >
                              {row.complexity}
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
                            {wo ? wo.total_tokens.toLocaleString() : "-"}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              textAlign: "right",
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: "0.75rem",
                            }}
                          >
                            {wi ? wi.total_tokens.toLocaleString() : "-"}
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
                            {tokenDelta > 0 ? `-${tokenDelta}%` : "-"}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              textAlign: "right",
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: "0.75rem",
                            }}
                          >
                            {wo ? `${wo.time_minutes}m` : "-"}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              textAlign: "right",
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: "0.75rem",
                            }}
                          >
                            {wi ? `${wi.time_minutes}m` : "-"}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              textAlign: "center",
                              color: "var(--text-muted)",
                            }}
                          >
                            {wo ? `${Math.round(wo.completion_score * 100)}%` : "-"}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              textAlign: "center",
                              fontWeight: 600,
                              color:
                                wi && wi.completion_score >= 0.9
                                  ? "#4ade80"
                                  : "var(--text-secondary)",
                            }}
                          >
                            {wi ? `${Math.round(wi.completion_score * 100)}%` : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Provider Comparison */}
            <div style={{ marginBottom: "3rem" }}>
              <h2 style={sectionHeading}>Provider Compatibility</h2>
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
                            i % 2 === 0
                              ? "var(--bg-surface)"
                              : "var(--bg-primary)",
                        }}
                      >
                        <td
                          style={{
                            ...tdStyle,
                            fontWeight: 500,
                            color: "var(--text-primary)",
                          }}
                        >
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

            {/* Methodology */}
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
                    Each task is defined as a YAML file specifying the prompt,
                    required workflow steps, and complexity level. Tasks are run
                    twice: once without attrition (baseline) and once with
                    enforcement hooks active.
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
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
