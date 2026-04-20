# attrition.sh Convex Backend (DaaS)

Convex TypeScript source for the Distillation-as-a-Service pipeline that belongs to attrition.sh.

This code previously lived in `nodebench-ai/convex/domains/daas/` while NodeBench's Convex deployment hosted the tables. Per the product decision that DaaS is **attrition-exclusive**, the source of truth now lives in this repo.

## Files

| Path | Purpose |
|------|---------|
| `domains/daas/schema.ts` | Table definitions: daasTraces, daasWorkflowSpecs, daasReplays, daasJudgments, daasRateBuckets, daasAuditLog, daasApiKeys |
| `domains/daas/mutations.ts` | ingestTrace, storeWorkflowSpec, storeReplay, storeJudgment, checkAndIncrementRateBucket, logAuditEvent, lookupApiKey, registerApiKey, setApiKeyEnabled |
| `domains/daas/queries.ts` | listRuns, getRun, getAggregateStats, listAuditLog, listRubrics |
| `domains/daas/actions.ts` | judgeReplay, distillTrace, replayTrace (server-side Gemini calls) |
| `domains/daas/admin.ts` | runAdminOp action: delete, register keys, toggle keys |
| `domains/daas/http.ts` | POST /api/daas/ingest with auth, rate limit, HMAC signing |
| `domains/daas/rubrics.ts` | Rubric registry (generic / retail_ops / coding) |
| `frontend/DaasPage.tsx` | React component for the /daas dashboard (Convex useQuery + useAction) |
| `DAAS_HTTP_API.md` | External HTTP API reference |

## Deployment plan

When attrition.sh gets its own Convex project, drop these files into that project's `convex/` directory and redeploy. Until then:

- Python pipeline under `daas/` in this repo remains operational (FloorAI-backed showcase in `daas/examples/`)
- Scenario tests in `daas/tests/test_scenarios.py` validate the HTTP surface once the new Convex deployment is live
- The tables + data currently live in NodeBench's dev deployment and will be dropped when NodeBench redeploys without the DaaS schema

## Why this lives in attrition, not NodeBench

DaaS (Distillation-as-a-Service) is a product surface for attrition.sh. NodeBench is a separate product (entity intelligence). Keeping them on separate deployments:

- Avoids shared-tenant risk (a DaaS rate-limit storm doesn't affect NodeBench)
- Keeps billing clean (attrition.sh customers' Gemini spend is separate from NodeBench's)
- Honors the rule "do not build parallel systems" by making attrition its own system, not a tenant of NodeBench
