// Scheduled jobs for attrition.sh.
//
// Only one job today: Radar ingestion. Runs every 6 hours, pulls the
// GitHub-releases watchlist defined in convex/domains/daas/radarIngest.ts,
// and upserts normalized items into daasRadarItems. Idempotent — same
// release always collides with same itemId.
//
// If this file grows beyond a handful of jobs, promote each domain's
// crons into its own file and import + register from here.

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "radar-ingest-github-releases",
  { hours: 6 },
  internal.domains.daas.radarIngest.ingestAllInternal,
);

// HN tier3 weak-signal runs more often — new stories appear continuously.
crons.interval(
  "radar-ingest-hackernews",
  { hours: 2 },
  internal.domains.daas.radarHnIngest.ingestHnInternal,
);

export default crons;
