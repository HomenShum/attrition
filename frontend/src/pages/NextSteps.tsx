/**
 * NextSteps — the 60-min checkpoint.
 *
 * Route: /next-steps/:slug (linked from Builder's Download confirmation)
 *
 * Post-download checklist that ticks ✅ as the user's local scaffold pings
 * a webhook from each milestone. Falls back to a manual click-through if
 * the user declined telemetry (ATTRITION_TELEMETRY is unset).
 *
 * This page is the "are you actually live in prod?" surface — the whole
 * point of attrition.sh condenses into watching this checklist fill in.
 *
 * Five expected events:
 *   1. downloaded         (marked by Builder immediately on download click)
 *   2. mock_exec_pass     (pinged by emitted run.sh after ./run.sh --mock)
 *   3. live_smoke_pass    (pinged by emitted run.sh after ./run.sh --smoke live)
 *   4. first_prod_request (pinged by observability.py on first real request)
 *   5. deployed           (optional — manually ticked or detected via health check)
 */

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../_convex/api";
import { Nav } from "../components/Nav";

type Event =
  | "downloaded"
  | "mock_exec_pass"
  | "live_smoke_pass"
  | "first_prod_request"
  | "deployed";

type PingRow = {
  _id: string;
  event: string;
  clientTs: number;
  serverTs: number;
  runtimeLane: string | null;
  driverRuntime: string | null;
};

type Milestone = {
  id: Event;
  title: string;
  hint: string;
  command?: string;
};

const MILESTONES: Milestone[] = [
  {
    id: "downloaded",
    title: "Downloaded ZIP",
    hint: "You clicked Download on the Builder. Next: unzip and cd into it.",
    command: "unzip attrition-scaffold.zip -d my-project/agent/",
  },
  {
    id: "mock_exec_pass",
    title: "Mock exec passed",
    hint: "Run it once in mock mode to verify nothing broke in transit.",
    command: "cd my-project/agent && ./run.sh --mock",
  },
  {
    id: "live_smoke_pass",
    title: "Live smoke passed",
    hint: "Replace _live_*.py stubs with your real handlers, flip mode, run one real request.",
    command: "CONNECTOR_MODE=live ./run.sh --smoke",
  },
  {
    id: "first_prod_request",
    title: "First prod request responded",
    hint: "Deploy to your runtime of choice and wait for the first real user request.",
    command: "# lane-specific deploy recipe below",
  },
  {
    id: "deployed",
    title: "Live in production",
    hint: "Health check returns 200. You're shipped.",
  },
];

// Per-lane deploy recipes — small enough to maintain, wide enough to cover
// every runtime attrition emits. Missing lanes fall back to a docker recipe.
const DEPLOY_RECIPES: Record<string, { label: string; commands: string[] }> = {
  vercel_ai_sdk: {
    label: "Vercel (Edge + AI SDK)",
    commands: ["vercel link", "vercel env pull", "vercel deploy --prod"],
  },
  convex_functions: {
    label: "Convex",
    commands: ["npx convex login", "npx convex deploy"],
  },
  simple_chain: {
    label: "Docker + any runtime",
    commands: [
      "docker build -t my-agent .",
      "docker run -p 8080:8080 --env-file .env my-agent",
    ],
  },
  tool_first_chain: {
    label: "Docker + any runtime",
    commands: [
      "docker build -t my-agent .",
      "docker run -p 8080:8080 --env-file .env my-agent",
    ],
  },
  orchestrator_worker: {
    label: "Cloud Run (recommended — long-running)",
    commands: [
      "gcloud builds submit --tag gcr.io/$PROJECT/my-agent",
      "gcloud run deploy my-agent --image gcr.io/$PROJECT/my-agent --region us-central1 --allow-unauthenticated",
    ],
  },
  openai_agents_sdk: {
    label: "Docker (OpenAI-compatible)",
    commands: [
      "docker build -t my-agent .",
      "docker run -p 8080:8080 --env-file .env my-agent",
    ],
  },
  langgraph_python: {
    label: "Docker + LangGraph server",
    commands: [
      "docker build -t my-agent -f langgraph.Dockerfile .",
      "docker run -p 2024:2024 --env-file .env my-agent",
    ],
  },
  claude_agent_sdk: {
    label: "Cloud Run or container host",
    commands: [
      "gcloud builds submit --tag gcr.io/$PROJECT/my-agent",
      "gcloud run deploy my-agent --image gcr.io/$PROJECT/my-agent",
    ],
  },
  manus: {
    label: "Docker",
    commands: ["docker build -t my-agent .", "docker run --env-file .env my-agent"],
  },
  deerflow: {
    label: "Docker",
    commands: ["docker build -t my-agent .", "docker run --env-file .env my-agent"],
  },
  hermes: {
    label: "Docker",
    commands: ["docker build -t my-agent .", "docker run --env-file .env my-agent"],
  },
  gemini_deep_research: {
    label: "Cloud Run (long-running, polls Interactions API)",
    commands: [
      "gcloud builds submit --tag gcr.io/$PROJECT/my-agent",
      "gcloud run deploy my-agent --image gcr.io/$PROJECT/my-agent --timeout=3600",
    ],
  },
};

const DEFAULT_RECIPE = {
  label: "Docker (generic)",
  commands: ["docker build -t my-agent .", "docker run --env-file .env my-agent"],
};

export function NextSteps() {
  const { slug } = useParams<{ slug: string }>();

  // Subscribe to the pings table so ticks appear in real time as the
  // user's local scaffold calls our webhook.
  const pings = useQuery(
    api.domains.daas.nextSteps.listPingsForSession,
    slug ? { sessionSlug: slug } : "skip",
  );

  const session = useQuery(
    api.domains.daas.architect.getSessionBySlug,
    slug ? { sessionSlug: slug } : "skip",
  );

  // Manual ticks — for users who opted out of telemetry.
  const [manualTicks, setManualTicks] = useState<Set<Event>>(
    () => new Set<Event>(["downloaded"]),
  );
  const toggleManual = (id: Event) => {
    setManualTicks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const completedEvents = useMemo(() => {
    const set = new Set<Event>();
    (pings ?? []).forEach((p: PingRow) => {
      if (p.event) set.add(p.event as Event);
    });
    manualTicks.forEach((e) => set.add(e));
    return set;
  }, [pings, manualTicks]);

  const recipe =
    (session?.runtimeLane && DEPLOY_RECIPES[session.runtimeLane]) || DEFAULT_RECIPE;

  const allGreen = MILESTONES.every((m) => completedEvents.has(m.id));

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
      <main style={{ maxWidth: 840, margin: "0 auto", padding: "40px 32px 80px" }}>
        <header style={{ marginBottom: 28 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#d97757",
              marginBottom: 6,
            }}
          >
            60-min checkpoint · post-download
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
            {allGreen
              ? "🎉 You're live in production."
              : "Watch your scaffold go live."}
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "rgba(255,255,255,0.7)",
              margin: "10px 0 0",
              lineHeight: 1.55,
              maxWidth: 680,
            }}
          >
            {allGreen
              ? "All milestones passed. The scaffold is answering real requests. Come back if the workflow fundamentally changes."
              : "This checklist ticks in real time as your local scaffold pings the attrition webhook. Opted out of telemetry? Click the checkboxes manually below."}
          </p>
          {slug ? (
            <div
              style={{
                marginTop: 10,
                fontSize: 11,
                color: "rgba(255,255,255,0.5)",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              session · {slug}
            </div>
          ) : null}
        </header>

        {/* Milestones */}
        <ol
          style={{
            listStyle: "none",
            padding: 0,
            margin: "0 0 32px",
            display: "grid",
            gap: 10,
          }}
        >
          {MILESTONES.map((m, i) => {
            const done = completedEvents.has(m.id);
            const waiting = !done && i > 0 && completedEvents.has(MILESTONES[i - 1].id);
            return (
              <li
                key={m.id}
                style={{
                  padding: 14,
                  background: done
                    ? "rgba(34,197,94,0.06)"
                    : waiting
                      ? "rgba(245,158,11,0.05)"
                      : "rgba(255,255,255,0.02)",
                  border: done
                    ? "1px solid rgba(34,197,94,0.35)"
                    : waiting
                      ? "1px solid rgba(245,158,11,0.35)"
                      : "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleManual(m.id)}
                  aria-label={
                    done ? `Unmark ${m.title}` : `Mark ${m.title} as done`
                  }
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    flexShrink: 0,
                    marginTop: 2,
                    background: done
                      ? "rgba(34,197,94,0.25)"
                      : waiting
                        ? "rgba(245,158,11,0.2)"
                        : "rgba(255,255,255,0.05)",
                    border: done
                      ? "1px solid rgba(34,197,94,0.6)"
                      : waiting
                        ? "1px solid rgba(245,158,11,0.6)"
                        : "1px solid rgba(255,255,255,0.15)",
                    cursor: "pointer",
                    color: done ? "#22c55e" : waiting ? "#f59e0b" : "transparent",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  {done ? "✓" : waiting ? "⟳" : ""}
                </button>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: done
                        ? "rgba(255,255,255,0.95)"
                        : "rgba(255,255,255,0.85)",
                    }}
                  >
                    {m.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.55)",
                      marginTop: 3,
                      lineHeight: 1.5,
                    }}
                  >
                    {m.hint}
                  </div>
                  {m.command ? (
                    <pre
                      style={{
                        margin: "8px 0 0",
                        padding: "8px 10px",
                        background: "rgba(0,0,0,0.35)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        borderRadius: 6,
                        fontSize: 11,
                        color: "rgba(217,119,87,0.95)",
                        fontFamily: "'JetBrains Mono', monospace",
                        overflowX: "auto",
                      }}
                    >
                      {m.command}
                    </pre>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        {/* Lane-specific deploy recipe */}
        <section
          style={{
            padding: 16,
            background: "rgba(217,119,87,0.04)",
            border: "1px solid rgba(217,119,87,0.25)",
            borderRadius: 10,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#d97757",
              marginBottom: 8,
            }}
          >
            Deploy recipe · {recipe.label}
          </div>
          <pre
            style={{
              margin: 0,
              padding: "10px 12px",
              background: "rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 6,
              fontSize: 12,
              color: "rgba(255,255,255,0.88)",
              fontFamily: "'JetBrains Mono', monospace",
              overflowX: "auto",
              lineHeight: 1.7,
            }}
          >
            {recipe.commands.join("\n")}
          </pre>
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 11,
              color: "rgba(255,255,255,0.5)",
              lineHeight: 1.5,
            }}
          >
            Your lane:{" "}
            <code style={{ color: "#d97757" }}>
              {session?.runtimeLane ?? "(unknown)"}
            </code>
            . These commands are a starting point — every production deploy has
            its own conventions. Edit them before running.
          </p>
        </section>

        {/* Telemetry opt-in note */}
        <section
          style={{
            padding: 14,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.55)",
              marginBottom: 8,
            }}
          >
            How the ticks get filled in
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: "rgba(255,255,255,0.7)",
              lineHeight: 1.6,
            }}
          >
            Your scaffold ships with{" "}
            <code style={{ fontSize: 11, color: "#d97757" }}>.attrition/provenance.json</code>{" "}
            and an opt-in telemetry hook. To watch this page tick in real time:
          </p>
          <pre
            style={{
              margin: "10px 0 0",
              padding: "8px 10px",
              background: "rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 6,
              fontSize: 11,
              color: "rgba(217,119,87,0.95)",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            export ATTRITION_TELEMETRY=1
            {"\n"}./run.sh --mock
          </pre>
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 11,
              color: "rgba(255,255,255,0.5)",
              lineHeight: 1.55,
            }}
          >
            The webhook only sees{" "}
            <code>{"{event, provenance_id, timestamp}"}</code> — no prompts, no code,
            no credentials. Auditable in{" "}
            <code style={{ fontSize: 11 }}>connectors/_telemetry.py</code>.
          </p>
        </section>

        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            to={`/build/${slug ?? ""}`}
            style={{
              padding: "8px 14px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 8,
              color: "rgba(255,255,255,0.75)",
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            ← Back to Builder
          </Link>
          <Link
            to="/"
            style={{
              padding: "8px 14px",
              background: "rgba(217,119,87,0.18)",
              border: "1px solid rgba(217,119,87,0.4)",
              borderRadius: 8,
              color: "#fff",
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            Start a new scaffold →
          </Link>
        </div>
      </main>
    </div>
  );
}
