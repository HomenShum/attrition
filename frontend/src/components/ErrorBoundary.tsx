/**
 * Error boundary wrapper — catches React-render errors anywhere in the
 * subtree and renders a visible fallback instead of a blank screen.
 *
 * The three public pages wrap their content in this. Internal views
 * reuse it too.
 */

import React from "react";

type Props = { children: React.ReactNode; label?: string };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Visible in the browser console; devs can copy-paste into a bug report.
    // eslint-disable-next-line no-console
    console.error("[attrition] render error:", error, info);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          style={{
            minHeight: "100vh",
            background: "#0b0a09",
            color: "rgba(255,255,255,0.92)",
            fontFamily: "'Manrope', sans-serif",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
          }}
        >
          <div
            style={{
              maxWidth: 520,
              padding: 24,
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 10,
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "#ef4444",
                marginBottom: 8,
              }}
            >
              Render error — {this.props.label || "page"}
            </div>
            <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>
              Something broke while rendering this page.
            </h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, margin: 0 }}>
              The error has been logged to the browser console. Refresh the
              page, or click below to start a new Architect session.
            </p>
            <pre
              style={{
                marginTop: 14,
                padding: 10,
                background: "rgba(0,0,0,0.3)",
                borderRadius: 6,
                fontSize: 11,
                color: "rgba(255,255,255,0.75)",
                overflow: "auto",
                maxHeight: 120,
              }}
            >
              {this.state.error.message}
            </pre>
            <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  this.setState({ error: null });
                  if (typeof window !== "undefined") window.location.reload();
                }}
                style={{
                  padding: "8px 14px",
                  background: "#d97757",
                  border: "none",
                  borderRadius: 6,
                  color: "#fff",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Reload
              </button>
              <a
                href="/"
                style={{
                  padding: "8px 14px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 6,
                  color: "rgba(255,255,255,0.85)",
                  fontSize: 13,
                  textDecoration: "none",
                }}
              >
                Back to Architect
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
