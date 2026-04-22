// attrition.sh HTTP routes.
//
// POST /api/daas/ingest    — public CanonicalTrace ingest (auth, rate
//                            limit, HMAC — see domains/daas/http.ts).
// POST /http/attritionPing — opt-in telemetry from downloaded scaffolds
//                            phoning home for the 60-min NextSteps page.

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { ingestHttp as daasIngestHttp } from "./domains/daas/http";
import { healthHandler } from "./domains/daas/health";

const http = httpRouter();

http.route({
  path: "/api/daas/ingest",
  method: "POST",
  handler: daasIngestHttp,
});

http.route({
  path: "/api/daas/ingest",
  method: "OPTIONS",
  handler: daasIngestHttp,
});

// Liveness + shallow ingest-health probe. Used by external monitoring
// and by the deploy verifier.
http.route({ path: "/health", method: "GET", handler: healthHandler });
http.route({ path: "/health", method: "OPTIONS", handler: healthHandler });

// --- NextSteps webhook ---------------------------------------------------
// Accepts: {session_slug, event, client_ts, runtime_lane?, driver_runtime?}
// Writes to scaffoldPings; NextSteps UI subscribes per session.
// Idempotent per (session_slug, event) — re-pings overwrite.
// CORS-permissive so localhost scaffolds can POST without a preflight dance.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const attritionPingHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return new Response("method not allowed", {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  let body: unknown;
  try {
    // BOUND_READ: cap payload read at 8KB before parse
    const text = await request.text();
    if (text.length > 8 * 1024) {
      return new Response("payload too large", {
        status: 413,
        headers: CORS_HEADERS,
      });
    }
    body = JSON.parse(text);
  } catch {
    return new Response("invalid JSON", { status: 400, headers: CORS_HEADERS });
  }

  if (typeof body !== "object" || body === null) {
    return new Response("body must be JSON object", {
      status: 400,
      headers: CORS_HEADERS,
    });
  }
  const b = body as Record<string, unknown>;
  const sessionSlug = typeof b.session_slug === "string" ? b.session_slug : null;
  const event = typeof b.event === "string" ? b.event : null;
  const clientTs =
    typeof b.client_ts === "number" ? b.client_ts : Date.now();
  const runtimeLane =
    typeof b.runtime_lane === "string" ? b.runtime_lane : undefined;
  const driverRuntime =
    typeof b.driver_runtime === "string" ? b.driver_runtime : undefined;

  if (!sessionSlug || !event) {
    return new Response("missing session_slug or event", {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  try {
    const result = await ctx.runMutation(api.domains.daas.nextSteps.recordPing, {
      sessionSlug,
      event,
      clientTs,
      runtimeLane,
      driverRuntime,
      raw: JSON.stringify(body).slice(0, 4000),
    });
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});

http.route({
  path: "/http/attritionPing",
  method: "POST",
  handler: attritionPingHandler,
});
http.route({
  path: "/http/attritionPing",
  method: "OPTIONS",
  handler: attritionPingHandler,
});

export default http;
