import { useParams, Link } from "react-router-dom";
import { useState, useCallback, useEffect } from "react";
import { ScoreRing } from "../components/ScoreRing";
import { DimensionBar } from "../components/DimensionBar";
import { getScanResult, saveScanResult, type ScanRecord } from "../lib/scanStorage";

/* ── Shared styles ─────────────────────────────────────────────── */

const glass: React.CSSProperties = {
  borderRadius: "0.625rem",
  border: "1px solid rgba(255,255,255,0.06)",
  background: "#141415",
};

const mono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

/* ── Component ────────────────────────────────────────────────── */

export function ScanResult() {
  const { id } = useParams<{ id: string }>();
  const [record, setRecord] = useState<ScanRecord | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dots, setDots] = useState("");

  useEffect(() => {
    if (id) {
      const found = getScanResult(id);
      setRecord(found);
    }
  }, [id]);

  // Animate dots during rescan
  useEffect(() => {
    if (!rescanning) return;
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 400);
    return () => clearInterval(interval);
  }, [rescanning]);

  const handleRescan = useCallback(async () => {
    if (!record) return;
    setRescanning(true);

    try {
      const res = await fetch("/api/qa/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: record.url }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const updated: ScanRecord = {
        id: record.id,
        url: data.url || record.url,
        score: data.score,
        issues: data.issues ?? [],
        dimensions: data.dimensions ?? {},
        durationMs: data.duration_ms ?? 0,
        timestamp: new Date().toISOString(),
      };
      saveScanResult(updated);
      setRecord(updated);
    } catch {
      // Keep existing record on error
    }

    setRescanning(false);
  }, [record]);

  const handleCopyLink = useCallback(() => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  // Not found state
  if (!record) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-primary)",
        padding: "2rem",
      }}>
        <Link to="/" style={{ textDecoration: "none", marginBottom: "2rem" }}>
          <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e8e6e3" }}>
            att<span style={{ color: "#d97757" }}>rition</span>
          </span>
        </Link>
        <p style={{ color: "#9a9590", fontSize: "1rem", marginBottom: "1.5rem" }}>
          Result not found. Run a new scan.
        </p>
        <Link to="/" style={{
          padding: "0.75rem 2rem",
          borderRadius: "0.5rem",
          background: "#d97757",
          color: "#fff",
          fontWeight: 600,
          fontSize: "0.9375rem",
          textDecoration: "none",
        }}>
          Scan a URL
        </Link>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg-primary)",
      padding: "2rem 1.5rem",
    }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <Link to="/" style={{ textDecoration: "none" }}>
            <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e8e6e3" }}>
              att<span style={{ color: "#d97757" }}>rition</span>
            </span>
          </Link>
        </div>

        {/* Result card */}
        <div style={{ ...glass, padding: "2rem" }}>
          {/* URL + timestamp */}
          <div style={{ marginBottom: "1.5rem" }}>
            <div style={{
              ...mono, fontSize: "0.875rem", color: "#e8e6e3",
              wordBreak: "break-all", marginBottom: "0.375rem",
            }}>
              {record.url}
            </div>
            <div style={{ ...mono, fontSize: "0.6875rem", color: "#6b6560" }}>
              Scanned {new Date(record.timestamp).toLocaleString()} in {(record.durationMs / 1000).toFixed(1)}s
            </div>
          </div>

          {/* Score ring */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}>
            <ScoreRing score={record.score} size={120} strokeWidth={8} label="score" />
          </div>

          {/* Dimensions */}
          {Object.keys(record.dimensions).length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <div style={{
                ...mono, fontSize: "0.6875rem", textTransform: "uppercase",
                letterSpacing: "0.15em", color: "#6b6560", marginBottom: "0.75rem",
              }}>
                Dimensions
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {Object.entries(record.dimensions).map(([key, val]) => (
                  <DimensionBar key={key} label={key} score={val} />
                ))}
              </div>
            </div>
          )}

          {/* Issues */}
          {record.issues.length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <div style={{
                ...mono, fontSize: "0.6875rem", textTransform: "uppercase",
                letterSpacing: "0.15em", color: "#6b6560", marginBottom: "0.75rem",
              }}>
                Issues ({record.issues.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {record.issues.map((iss, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: "0.5rem",
                    padding: "0.625rem 0.75rem", borderRadius: "0.375rem",
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
                      flexShrink: 0, marginTop: "0.1rem",
                    }}>
                      {iss.severity.toUpperCase()}
                    </span>
                    <div>
                      <div style={{ fontSize: "0.8125rem", color: "#c5c0bb" }}>{iss.title}</div>
                      {iss.description && (
                        <div style={{ fontSize: "0.75rem", color: "#6b6560", marginTop: "0.25rem" }}>
                          {iss.description}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {record.issues.length === 0 && (
            <div style={{
              padding: "1rem", borderRadius: "0.5rem",
              background: "rgba(34,197,94,0.04)",
              border: "1px solid rgba(34,197,94,0.15)",
              textAlign: "center", marginBottom: "1.5rem",
            }}>
              <span style={{ color: "#22c55e", fontSize: "0.9375rem", fontWeight: 600 }}>
                No issues found. Clean report.
              </span>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
            <button
              onClick={handleRescan}
              disabled={rescanning}
              style={{
                padding: "0.625rem 1.5rem",
                borderRadius: "0.5rem",
                border: "none",
                background: rescanning ? "#3a3530" : "#d97757",
                color: rescanning ? "#6b6560" : "#fff",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: rescanning ? "not-allowed" : "pointer",
              }}
            >
              {rescanning ? `Scanning${dots}` : "Run again"}
            </button>
            <button
              onClick={handleCopyLink}
              style={{
                padding: "0.625rem 1.5rem",
                borderRadius: "0.5rem",
                border: "1px solid rgba(255,255,255,0.06)",
                background: "transparent",
                color: copied ? "#22c55e" : "#e8e6e3",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
