/**
 * Evaluators — list of Arize-AX-style LLM-as-judge templates at
 * /evaluators.
 *
 * Each evaluator runs automatically after every live run completes
 * (see convex/domains/daas/liveAgent.ts::runAllActive). Results land
 * in the Evaluations panel on /runs/:runId.
 *
 * MVP is read-only: shipped evaluators are seeded via
 * convex/domains/daas/evaluatorSeed.ts. A future cycle will add the
 * "create new evaluator" flow with a prompt editor + live preview.
 */

import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../_convex/api";
import { Nav } from "../components/Nav";

export function Evaluators() {
  const evaluators = useQuery(
    api.domains.daas.agentEvaluator.listEvaluators,
    { activeOnly: false },
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0b0a09",
        color: "rgba(255,255,255,0.92)",
        fontFamily: "'Manrope', -apple-system, sans-serif",
      }}
    >
      <Nav />
      <main
        style={{
          maxWidth: 1040,
          margin: "0 auto",
          padding: "40px 28px 80px",
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#8b5cf6",
            marginBottom: 6,
            fontWeight: 600,
          }}
        >
          Evaluators · LLM-as-judge · every live run is scored
        </div>
        <h1
          style={{
            fontSize: 30,
            fontWeight: 600,
            margin: 0,
            letterSpacing: "-0.015em",
            lineHeight: 1.15,
          }}
        >
          Automated evaluators for every agent run.
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.7)",
            margin: "10px 0 0",
            lineHeight: 1.6,
            maxWidth: 700,
          }}
        >
          Every time a user clicks{" "}
          <strong style={{ color: "#fff" }}>Run live</strong>, these
          evaluators score the trace. Scores land on{" "}
          <code style={{ fontSize: 12 }}>/runs/:runId</code> as they
          finish. Borrowed straight from Arize AX's evaluator pattern —
          reusable LLM-as-judge templates you apply to any agent run.
        </p>

        <section style={{ marginTop: 28 }}>
          {evaluators === undefined ? (
            <div
              style={{
                padding: 20,
                background: "rgba(255,255,255,0.02)",
                border: "1px dashed rgba(255,255,255,0.08)",
                borderRadius: 8,
                fontSize: 13,
                color: "rgba(255,255,255,0.55)",
              }}
            >
              Loading evaluators…
            </div>
          ) : evaluators.length === 0 ? (
            <div
              style={{
                padding: 20,
                background: "rgba(245,158,11,0.05)",
                border: "1px solid rgba(245,158,11,0.3)",
                borderRadius: 8,
                fontSize: 13,
                color: "rgba(255,255,255,0.75)",
              }}
            >
              No evaluators yet. Run the seed mutation:{" "}
              <code>
                npx convex run domains/daas/evaluatorSeed:seedBuiltinEvaluators
              </code>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: 12,
              }}
            >
              {evaluators.map((e) => (
                <article
                  key={e.name}
                  style={{
                    padding: 16,
                    background: "rgba(255,255,255,0.02)",
                    border: `1px solid ${e.active ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.08)"}`,
                    borderLeft: `3px solid ${e.active ? "#8b5cf6" : "rgba(255,255,255,0.2)"}`,
                    borderRadius: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        color: e.active
                          ? "#8b5cf6"
                          : "rgba(255,255,255,0.45)",
                        fontWeight: 600,
                      }}
                    >
                      {e.active ? "ACTIVE" : "INACTIVE"}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: "rgba(255,255,255,0.45)",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      priority {e.priority}
                    </span>
                  </div>
                  <h2
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      margin: "0 0 4px",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {e.label}
                  </h2>
                  <code
                    style={{
                      fontSize: 11,
                      color: "rgba(255,255,255,0.45)",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {e.name}
                  </code>
                  <p
                    style={{
                      margin: "10px 0 10px",
                      fontSize: 12,
                      color: "rgba(255,255,255,0.72)",
                      lineHeight: 1.55,
                    }}
                  >
                    {e.description}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      fontSize: 10,
                      color: "rgba(255,255,255,0.5)",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    <span>kind: {e.kind}</span>
                    <span>·</span>
                    <span>judge: {e.judgeModel}</span>
                    {e.seeded ? (
                      <>
                        <span>·</span>
                        <span>builtin</span>
                      </>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <p
          style={{
            marginTop: 28,
            fontSize: 11,
            color: "rgba(255,255,255,0.45)",
            lineHeight: 1.6,
            maxWidth: 720,
          }}
        >
          Each evaluator receives the run's input, final output, and a
          compact span summary, then returns strict JSON:{" "}
          <code>
            {'{"score": 0..1, "verdict": "pass|warn|fail|skip", "rationale": "one sentence"}'}
          </code>
          . Scores are averaged over time to surface systematic
          regressions — watch the{" "}
          <Link to="/" style={{ color: "#8b5cf6" }}>
            telemetry report
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
