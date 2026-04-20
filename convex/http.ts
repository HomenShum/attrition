// attrition.sh HTTP routes.
//
// POST /api/daas/ingest — public CanonicalTrace ingest
//                         (auth, rate limit, HMAC signing — see
//                         domains/daas/http.ts for details).

import { httpRouter } from "convex/server";
import { ingestHttp as daasIngestHttp } from "./domains/daas/http";

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

export default http;
