import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useState, useCallback, useEffect } from "react";
import { ScoreRing } from "../components/ScoreRing";
import { DimensionBar } from "../components/DimensionBar";
import { saveScanResult, type ScanRecord } from "../lib/scanStorage";

/* ── Shared styles ─────────────────────────────────────────────── */

const glass: React.CSSProperties = {
  borderRadius: "0.625rem",
  border: "1px solid rgba(255,255,255,0.06)",
  background: "#141415",
};

const mono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

const muted: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "#9a9590",
  lineHeight: 1.6,
};

const wrap: React.CSSProperties = {
  maxWidth: 900,
  margin: "0 auto",
  padding: "3rem 1.5rem 2rem",
};

const sectionGap: React.CSSProperties = { marginBottom: "5rem" };

const MCP_CONFIG = `{
  "mcpServers": {
    "attrition": {
      "command": "npx",
      "args": ["-y", "attrition@latest"]
    }
  }
}`;

/* ── Types ─────────────────────────────────────────────────────── */

interface ScanApiResult {
  id: string;
  score: number;
  duration_ms: number;
  dimensions: Record<string, number>;
  issues: { severity: string; title: string; description: string }[];
  url: string;
  timestamp: string;
}

/* ── Component ────────────────────────────────────────────────── */

export function Landing() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dots, setDots] = useState("");
  const [slowWarning, setSlowWarning] = useState(false);

  // Animate dots during scanning
  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 400);
    return () => clearInterval(interval);
  }, [scanning]);

  const handleScan = useCallback(async () => {
    let scanUrl = url.trim();
    if (!scanUrl) return;
    if (!scanUrl.startsWith("http")) scanUrl = `https://${scanUrl}`;

    setScanning(true);
    setResult(null);
    setError(null);
    setSlowWarning(false);

    // Show slow warning after 2s
    const slowTimer = setTimeout(() => setSlowWarning(true), 2000);

    try {
      const res = await fetch("/api/qa/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: scanUrl }),
      });

      clearTimeout(slowTimer);

      if (!res.ok) {
        setError("Server warming up, try again in 5s");
        setScanning(false);
        return;
      }

      const data: ScanApiResult = await res.json();
      setResult(data);
      setScanning(false);

      // Save to scan history and navigate to shareable URL
      const id = data.id || crypto.randomUUID();
      const record: ScanRecord = {
        id,
        url: data.url || scanUrl,
        score: data.score,
        issues: data.issues,
        dimensions: data.dimensions,
        durationMs: data.duration_ms,
        timestamp: data.timestamp || new Date().toISOString(),
      };
      saveScanResult(record);
      navigate(`/scan/${id}`);
    } catch {
      clearTimeout(slowTimer);
      setError("Server warming up, try again in 5s");
      setScanning(false);
    }
  }, [url, navigate]);

  return (
    <Layout>
      <div style={wrap}>

        {/* ═══════════════════════════════════════════════════════
            ABOVE THE FOLD: name, one line, input, button
            ═══════════════════════════════════════════════════════ */}
        <section style={{ textAlign: "center", marginBottom: "3rem", paddingTop: "4rem" }}>
          <h1 style={{
            fontSize: "2.75rem",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.15,
            marginBottom: "1rem",
            color: "#e8e6e3",
          }}>
            att<span style={{ color: "#d97757" }}>rition</span>
          </h1>

          <p style={{
            ...muted,
            fontSize: "1.125rem",
            maxWidth: 500,
            margin: "0 auto 2.5rem",
          }}>
            Your agent skipped 3 steps.<br />
            We caught them.
          </p>

          {/* Scanner input */}
          <div style={{
            ...glass,
            padding: "1.25rem",
            maxWidth: 600,
            margin: "0 auto",
          }}>
            <form
              onSubmit={(e) => { e.preventDefault(); handleScan(); }}
              style={{ display: "flex", gap: "0.5rem" }}
            >
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-app.com"
                disabled={scanning}
                style={{
                  flex: 1,
                  padding: "0.75rem 1rem",
                  borderRadius: "0.5rem",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  color: "#e8e6e3",
                  fontSize: "0.9375rem",
                  outline: "none",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              />
              <button
                type="submit"
                disabled={scanning || !url.trim()}
                style={{
                  padding: "0.75rem 2rem",
                  borderRadius: "0.5rem",
                  border: "none",
                  background: scanning || !url.trim() ? "#3a3530" : "#d97757",
                  color: scanning || !url.trim() ? "#6b6560" : "#fff",
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                  cursor: scanning || !url.trim() ? "not-allowed" : "pointer",
                  transition: "background 0.15s",
                  flexShrink: 0,
                }}
              >
                {scanning ? `Scanning${dots}` : "Scan"}
              </button>
            </form>
          </div>

          {/* Scanning state */}
          {scanning && (
            <div style={{ marginTop: "1rem", ...mono, fontSize: "0.8125rem", color: "#9a9590" }}>
              Scanning{dots}
              {slowWarning && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#6b6560" }}>
                  Still working...
                </div>
              )}
            </div>
          )}

          {/* Error state */}
          {error && !scanning && (
            <div style={{
              marginTop: "1rem",
              padding: "0.75rem 1rem",
              borderRadius: "0.5rem",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              color: "#ef4444",
              fontSize: "0.875rem",
              maxWidth: 600,
              margin: "1rem auto 0",
            }}>
              {error}
            </div>
          )}

          {/* Inline result (shown briefly before redirect) */}
          {result && !scanning && (
            <div style={{
              ...glass,
              padding: "1.5rem",
              maxWidth: 600,
              margin: "1.5rem auto 0",
              textAlign: "left",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", marginBottom: "1rem" }}>
                <ScoreRing score={result.score} size={72} strokeWidth={6} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#e8e6e3" }}>
                    {result.issues.length} issue{result.issues.length !== 1 ? "s" : ""} found
                  </div>
                  <div style={{ ...mono, fontSize: "0.6875rem", color: "#6b6560" }}>
                    Scanned in {(result.duration_ms / 1000).toFixed(1)}s
                  </div>
                </div>
              </div>

              {/* Dimension bars */}
              {Object.entries(result.dimensions).length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", marginBottom: "1rem" }}>
                  {Object.entries(result.dimensions).map(([key, val]) => (
                    <DimensionBar key={key} label={key} score={val as number} />
                  ))}
                </div>
              )}

              {/* Issues */}
              {result.issues.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                  {result.issues.slice(0, 5).map((iss, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: "0.5rem",
                      padding: "0.5rem 0.625rem", borderRadius: "0.375rem",
                      background: iss.severity === "critical" || iss.severity === "high"
                        ? "rgba(239,68,68,0.04)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${iss.severity === "critical" || iss.severity === "high"
                        ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.04)"}`,
                    }}>
                      <span style={{
                        ...mono, fontSize: "0.625rem", fontWeight: 600,
                        padding: "0.1rem 0.375rem", borderRadius: "0.2rem",
                        background: iss.severity === "critical" || iss.severity === "high"
                          ? "rgba(239,68,68,0.15)" : "rgba(234,179,8,0.15)",
                        color: iss.severity === "critical" || iss.severity === "high"
                          ? "#ef4444" : "#eab308",
                        flexShrink: 0,
                      }}>
                        {iss.severity.toUpperCase()}
                      </span>
                      <span style={{ fontSize: "0.8125rem", color: "#c5c0bb" }}>{iss.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Arrow hint */}
          {!result && !scanning && !error && (
            <p style={{ ...muted, marginTop: "2rem", fontSize: "0.8125rem" }}>
              Results appear here after scan
            </p>
          )}
        </section>


        {/* ═══════════════════════════════════════════════════════
            BELOW THE FOLD: 3 sections max
            ═══════════════════════════════════════════════════════ */}

        {/* Section 1: How it works */}
        <section style={sectionGap}>
          <h2 style={{
            fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.025em",
            lineHeight: 1.2, color: "#e8e6e3", marginBottom: "1.5rem", textAlign: "center",
          }}>
            How it works
          </h2>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "1rem",
          }}>
            {[
              {
                title: "Capture",
                desc: "Record every tool call, file edit, and search your agent makes during a coding session.",
                icon: "1",
              },
              {
                title: "Judge",
                desc: "Compare the replay against the original workflow. Flag missing steps, divergences, regressions.",
                icon: "2",
              },
              {
                title: "Replay",
                desc: "Distill the workflow for a cheaper model. 60-70% token savings on reruns with the same quality.",
                icon: "3",
              },
            ].map((card) => (
              <div key={card.title} style={{
                ...glass,
                padding: "1.5rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: "rgba(217,119,87,0.12)", color: "#d97757",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "0.875rem", fontWeight: 700,
                }}>
                  {card.icon}
                </div>
                <div style={{ fontSize: "1rem", fontWeight: 600, color: "#e8e6e3" }}>
                  {card.title}
                </div>
                <p style={muted}>{card.desc}</p>
              </div>
            ))}
          </div>
        </section>


        {/* Section 2: Real example */}
        <section style={sectionGap}>
          <h2 style={{
            fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.025em",
            lineHeight: 1.2, color: "#e8e6e3", marginBottom: "0.5rem", textAlign: "center",
          }}>
            Real example
          </h2>
          <p style={{ ...muted, marginBottom: "1.5rem", textAlign: "center" }}>
            Task: Refactor API client to async/await
          </p>

          <div style={{ ...glass, padding: "1.5rem" }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "1rem",
              marginBottom: "1.25rem",
            }}>
              {/* Left: agent reported */}
              <div>
                <div style={{
                  ...mono, fontSize: "0.6875rem", textTransform: "uppercase",
                  letterSpacing: "0.15em", color: "#6b6560", marginBottom: "0.5rem",
                }}>
                  Agent reported
                </div>
                <div style={{
                  padding: "0.75rem 1rem", borderRadius: "0.5rem",
                  background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.15)",
                }}>
                  <span style={{ ...mono, fontSize: "1.5rem", fontWeight: 700, color: "#22c55e" }}>
                    5/5
                  </span>
                  <span style={{ ...muted, marginLeft: "0.5rem" }}>steps complete</span>
                </div>
              </div>

              {/* Right: attrition found */}
              <div>
                <div style={{
                  ...mono, fontSize: "0.6875rem", textTransform: "uppercase",
                  letterSpacing: "0.15em", color: "#6b6560", marginBottom: "0.5rem",
                }}>
                  Attrition found
                </div>
                <div style={{
                  padding: "0.75rem 1rem", borderRadius: "0.5rem",
                  background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.15)",
                }}>
                  <span style={{ ...mono, fontSize: "1.5rem", fontWeight: 700, color: "#ef4444" }}>
                    5/8
                  </span>
                  <span style={{ ...muted, marginLeft: "0.5rem" }}>steps actually done</span>
                </div>
              </div>
            </div>

            {/* Missing steps */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              {[
                "Search for breaking changes in dependent packages",
                "Update generated types",
                "Run integration tests (only unit tests ran)",
              ].map((step, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.5rem 0.75rem", borderRadius: "0.375rem",
                  background: "rgba(239,68,68,0.04)",
                  border: "1px solid rgba(239,68,68,0.1)",
                }}>
                  <span style={{ color: "#ef4444", fontSize: "0.875rem", flexShrink: 0 }}>&#10007;</span>
                  <span style={{ fontSize: "0.8125rem", color: "#c5c0bb" }}>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </section>


        {/* Section 3: Get started */}
        <section style={{ marginBottom: "3rem" }}>
          <h2 style={{
            fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.025em",
            lineHeight: 1.2, color: "#e8e6e3", marginBottom: "1.5rem", textAlign: "center",
          }}>
            Get started
          </h2>

          <div style={{ ...glass, padding: "1.5rem", maxWidth: 600, margin: "0 auto" }}>
            <div style={{ marginBottom: "1.25rem" }}>
              <div style={{
                ...mono, fontSize: "0.6875rem", textTransform: "uppercase",
                letterSpacing: "0.15em", color: "#6b6560", marginBottom: "0.5rem",
              }}>
                Install
              </div>
              <div style={{
                padding: "0.75rem 1rem", borderRadius: "0.5rem",
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
                fontFamily: "'JetBrains Mono', monospace", fontSize: "0.8125rem",
                color: "#e8e6e3", lineHeight: 1.7, whiteSpace: "pre",
              }}>
                curl -sL attrition.sh/install | bash
              </div>
            </div>

            <div>
              <div style={{
                ...mono, fontSize: "0.6875rem", textTransform: "uppercase",
                letterSpacing: "0.15em", color: "#6b6560", marginBottom: "0.5rem",
              }}>
                MCP config (.mcp.json)
              </div>
              <div style={{
                padding: "0.75rem 1rem", borderRadius: "0.5rem",
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
                fontFamily: "'JetBrains Mono', monospace", fontSize: "0.8125rem",
                color: "#e8e6e3", lineHeight: 1.7, whiteSpace: "pre", overflowX: "auto",
              }}>
                {MCP_CONFIG}
              </div>
            </div>
          </div>
        </section>

      </div>
    </Layout>
  );
}
