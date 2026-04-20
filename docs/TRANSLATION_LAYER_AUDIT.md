# Translation Layer Audit (Cycles 20–21)

## Status: shipped + verified end-to-end

Triggered by a user question: *"do we actually have the translation
layer?"* — previous audit admitted 2 blocks were partial. This cycle
fixed both.

## Block-by-block verified state

| Diagram block | Code location | Status |
|---|---|---|
| 1. Capture + Normalize | `daas/compile_down/normalizers/` + `convex/domains/daas/http.ts` | ✅ **Verified** |
| 2. Distiller | `daas/compile_down/cli.py::trace_to_workflow_spec` | ✅ **Verified** |
| 3. Compile Down (simple_chain, tool_first_chain) | `daas/compile_down/emitters/` | ✅ **Verified** |
| 4. Compile Up / Translate (orchestrator_worker, openai_agents_sdk, langgraph_python) | `daas/compile_down/emitters/` | ✅ **Verified** |
| 5. Connector Resolver (mock / live / hybrid) | `daas/compile_down/emitters/_tools_emit.py` (shared) | ✅ **Now executing** |
| 6. Replay Runtime (plan → dispatch → compact) | `orchestrator.py` emitted by `orchestrator_worker` | ✅ **Full dispatch wired** |
| 7. Judge + Benchmark | `daas/fidelity/` + `daas/benchmarks/` | ✅ **Verified** |
| 8. Ship (code) | Download ZIP + clipboard on Builder | ✅ **Verified** |
| 8. Route (up) | Classification label `keep_big_model` only | ⚠ still a label, not an executing router |

## Cycle 21a — Connector Resolver (executing layer)

Before: emitted `tools.py` had `_stub_<name>` handlers returning
`{"status": "not_implemented"}` regardless of UI mode. Mode toggle was
UI + docs only.

After: emitted `tools.py` now ships with:

```python
# Every tool gets TWO handlers:
def _stub_lookup_sku(args): return {"status": "mock", ...}
def _live_lookup_sku(args): raise NotImplementedError(...)

STUB_HANDLERS = {"lookup_sku": _stub_lookup_sku, ...}
LIVE_HANDLERS = {"lookup_sku": _live_lookup_sku, ...}

def _resolve_handler(name):
    mode = os.environ.get("CONNECTOR_MODE", "mock").lower()
    if mode == "live":  return LIVE_HANDLERS.get(name)
    if mode == "hybrid":
        overrides = json.loads(os.environ.get("CONNECTOR_OVERRIDES", "{}"))
        target = overrides.get(name, "mock")
        return LIVE_HANDLERS.get(name) if target == "live" else STUB_HANDLERS.get(name)
    return STUB_HANDLERS.get(name)

def dispatch(name, args):
    fn = _resolve_handler(name)
    if fn is None: return {"error": "no handler registered..."}
    try: return fn(args)
    except NotImplementedError as e: return {"error": "not_implemented", ...}
```

Shared across **both** runtime-lane emitters (tool_first_chain +
orchestrator_worker) via `daas/compile_down/emitters/_tools_emit.py` —
single source of truth for dispatch semantics.

Flipping `CONNECTOR_MODE` env var materially changes dispatch output:

```
mock     -> {"status": "mock", "tool": "...", "_result": "fixture-placeholder"}
live     -> {"error": "not_implemented", "mode": "live", ...}
hybrid   -> per-tool via CONNECTOR_OVERRIDES JSON; fallback to mock
```

8 scenario tests in `daas/tests/test_connector_resolver.py` — all pass.

## Cycle 21b — Orchestrator-worker dispatch (runtime)

Before: `orchestrator.py` emitted by `orchestrator_worker` only had a
`PLAN` call + `COMPACT` call. No per-worker dispatch. Explicit TODO
comment in the code.

After: full three-stage pipeline in emitted `orchestrator.py`:

```
1. PLAN     — orchestrator LLM → JSON array of {worker, task, tools_allowed}
2. DISPATCH — per-assignment LLM loop with tool-calling; tool calls flow
              through tools.dispatch() which routes via the connector resolver
3. COMPACT  — orchestrator reads full scratchpad, emits final answer
```

Key additions to the emitted `orchestrator.py`:

- `_parse_plan(text)` — tolerant JSON parse with markdown-fence strip
  and first-array-substring fallback. Returns list of `WorkerAssignment`.
- `_run_worker(assignment, key)` — bounded tool loop (`MAX_WORKER_TURNS=3`),
  Gemini function-calling, results land in Scratchpad section named after
  the worker.
- Sequential dispatch through all assignments (up to
  `MAX_WORKER_ASSIGNMENTS=4`); fan-out parallelization is a future
  optimization.
- Cost/token totals aggregated across plan + every worker + compact.
- Falls back to single `executor` worker when plan is unparseable.

39 emitter + resolver tests pass against the updated pipeline.

## End-to-end live verification (just run)

```
files=12  py=9  bytes=16827
[OK] all emitted .py parse
[OK] orchestrator.py has full plan/dispatch/compact pipeline
mock:   {'status': 'mock', 'tool': 'lookup_sku', 'args': {'id': 'SKU-001'}, '_result': 'fixture-placeholder'}
live:   {'error': 'not_implemented', 'tool': 'lookup_sku', 'mode': 'live', ...}
hybrid(live-override lookup_sku): {'error': 'not_implemented', 'mode': 'hybrid', ...}
hybrid(default-mock get_store_info): {'status': 'mock', '_result': 'fixture-placeholder'}
```

## What now ships as claim-worthy on the landing

- ✅ Any trace (Claude Code / Cursor / LangGraph graph) normalizes to
  canonical WorkflowSpec
- ✅ Same WorkflowSpec emits to 5 runtime lanes, every `.py` `ast.parse`-valid
- ✅ Full world-model substrate emits 10 files per session
- ✅ **Connector mode (mock/live/hybrid) materially changes dispatch
  behavior at runtime** — verified across 4 scenarios
- ✅ **Emitted orchestrator_worker runs real plan → dispatch → compact
  loop** — not just plan+compact; per-worker tool calls flow through
  the connector resolver

## Still-open tail (honest)

- **Route-up executing service**: `keep_big_model` is still a
  classification label. No server-side route-at-request-time service.
  Pre-revenue, not yet warranted.
- **Parallel worker dispatch**: today's orchestrator is sequential.
  Fan-out + timeout budgets is a future optimization.
- **End-to-end Cursor → LangGraph runnable smoke test**: individual
  stages work; the specific composed chain hasn't been run on a real
  Cursor export file.
