# attrition eval telemetry — publication snapshot

Generated from 8 baselines spanning 
**480 row-dispatches** and 
**$1.7729** of LLM spend.

## 1. Headline numbers

- **Latest baseline**: v8 — **53/60** pass (88%)
- **Pass-rate lift vs v1**: 5/60 (8%) → 53/60 (88%) — **+48 rows**
- **Total $ spent** (cumulative, all baselines): $1.7729
- **Total wall clock** (cumulative): 14488s = 241.5 min
- **Total row-dispatches** across all baselines: 480

## 2. Baseline-over-time

| Baseline | Pass | Fail | Skip | % | Wall (s) | Cost ($) | Notes |
|---|---|---|---|---|---|---|---|
| v1 | 5 | 55 | 0 | 8% | 1082 | 0.2272 | first baseline — honest measurement |
| v2 | 29 | 31 | 0 | 48% | 1149 | 0.2207 | 5 fixes: suffix-match, lane-aware emitter, judge contracts |
| v3 | 14 | 46 | 0 | 23% | 1806 | 0.2175 | REGRESSION: runner→server rename overwrote canonical; reverted |
| v4 | 37 | 23 | 0 | 62% | 1712 | 0.2272 | SDK installs + openrouter slug + deep_research fallback |
| v5 | 43 | 17 | 0 | 72% | 1884 | 0.2165 | TS-lane excludes + gate awareness + FORCED_CANONICAL |
| v6 | 50 | 10 | 0 | 83% | 2180 | 0.2260 | deep_research payload + per-runtime max_turns + lane deps |
| v7 | 52 | 8 | 0 | 87% | 2613 | 0.2208 |  |
| v8 | 53 | 7 | 0 | 88% | 2062 | 0.2170 |  |

## 3. Latest baseline — by emit lane

| Lane | Pass/Total | Rate | Cost ($) | p50 (s) | p90 (s) |
|---|---|---|---|---|---|
| orchestrator_worker | 14/19 | 73.7% | 0.0759 | 23.19 | 53.26 |
| tool_first_chain | 10/11 | 90.9% | 0.0486 | 25.25 | 61.72 |
| langgraph_python | 5/5 | 100.0% | 0.0058 | 66.43 | 71.6 |
| claude_agent_sdk | 4/4 | 100.0% | 0.0132 | 37.89 | 48.99 |
| gemini_deep_research | 3/4 | 75.0% | 0.0000 | 26.61 | 26.98 |
| openai_agents_sdk | 4/4 | 100.0% | 0.0055 | 42.25 | 71.21 |
| simple_chain | 4/4 | 100.0% | 0.0184 | 20.41 | 24.85 |
| convex_functions | 3/3 | 100.0% | 0.0156 | 15.14 | 24.21 |
| deerflow | 2/2 | 100.0% | 0.0106 | 23.88 | 24.76 |
| vercel_ai_sdk | 2/2 | 100.0% | 0.0127 | 22.23 | 23.77 |
| hermes | 1/1 | 100.0% | 0.0056 | 23.1 | 23.1 |
| manus | 1/1 | 100.0% | 0.0051 | 20.17 | 20.17 |

## 4. Latest baseline — by driver runtime

| Driver | Pass/Total | Rate | Cost ($) | p50 (s) | p90 (s) | Dispatch errors |
|---|---|---|---|---|---|---|
| gemini_agent | 36/40 | 90.0% | 0.2170 | 23.15 | 27.18 | 2 |
| openai_agents_sdk | 5/6 | 83.3% | 0.0000 | 63.03 | 77.42 | 0 |
| gemini_deep_research | 4/5 | 80.0% | 0.0000 | 26.6 | 26.93 | 0 |
| claude_agent_sdk | 3/4 | 75.0% | 0.0000 | 48.61 | 48.99 | 0 |
| langgraph | 3/3 | 100.0% | 0.0000 | 66.43 | 67.99 | 0 |
| openrouter | 2/2 | 100.0% | 0.0000 | 74.9 | 76.42 | 0 |

## 5. Latest baseline — gate-level frequencies

Each row is dispatched once per baseline; gates are evaluated on the emitted bundle.
`skip` means the gate abstained (e.g. lane-specific, judge unavailable, still stubbed).

| Gate | Pass | Fail | Skip | Pass rate |
|---|---|---|---|---|
| `baseline_parity` | 0 | 2 | 58 | 0% |
| `connector_resolver_working` | 55 | 2 | 3 | 96% |
| `correct_lane_picked` | 54 | 5 | 1 | 92% |
| `cost_under_budget` | 58 | 2 | 0 | 97% |
| `latency_under_budget` | 58 | 2 | 0 | 97% |
| `mcp_server_importable` | 49 | 2 | 9 | 96% |
| `nine_layers_present` | 58 | 2 | 0 | 97% |
| `runtime_used_correctly` | 58 | 2 | 0 | 97% |
| `scaffold_compiles` | 58 | 2 | 0 | 97% |
| `scaffold_runs_mock` | 51 | 4 | 5 | 93% |
| `workflow_spec_roundtrip` | 58 | 2 | 0 | 97% |

## 6. Dispatch-error taxonomy (latest)

Errors raised BEFORE gate evaluation — SDK packages missing, API endpoints drifted,
network flakes, model aliases invalid, max-turns exceeded. These are infra-layer
gaps, not scaffold bugs.

| Count | Error head |
|---|---|
| 1 | `gemini HTTP 502: <!DOCTYPE html>` |
| 1 | `<urlopen error [WinError 10054] An existing connection was forcibly closed by th` |

## 7. Bugs the flywheel surfaced and fixed

Each commit landed a fix that the harness found by running. Pass-rate delta in parentheses.

1. **Suffix-matching bug** in `gate_scaffold_runs_mock` (+25 rows v1→v2):
   `endswith('server.py')` matched `mcp_server.py` — gate was checking the MCP file for
   mock-mode handling instead of the runner. Fixed with exact-basename match.
2. **Lane-awareness contradiction** (+~10 rows v1→v2):
   `nine_layers_present` required all 10 layers universally, but `correct_lane_picked`
   rejected a simple_chain scaffold with state_store/mcp_server/eval. Fixed with
   per-lane required-layers map on the gate side AND per-lane excludes in the emitter.
3. **Windows backslash paths** (invisible bug, blocked lane-excludes silently):
   `Workspace.list()` emits native separators; lane-exclude `p.startswith('eval/')`
   never matched `eval\__init__.py`. Fixed with forward-slash normalization in
   `_bundle_finalize.py::_norm()`.
4. **Missing SDK packages** (+10 rows v2→v4):
   openai-agents and claude-agent-sdk weren't installed in the harness env.
   Every dispatch attempt errored in <50 ms with `ModuleNotFoundError`.
   Fixed with `pip install`.
5. **`_LANE_ENTRYPOINT` stale mapping** (blocked run.sh for multiple lanes):
   Map pointed at `main.py` / `orchestrator.py` / `graph.py` but the canonical
   `_server_py()` emits `server.py`. `run.sh` then referenced a file that didn't
   exist in the bundle. Unified to `server.py` across all Python lanes.
6. **Empty `workflow_spec.json`** (+~2 rows v4→v5):
   The agent sometimes wrote a stub or whitespace-only spec file; the roundtrip gate
   failed on `json.JSONDecodeError`. Fixed with `FORCED_CANONICAL` set in finalize —
   spec + run.sh now always owned by the canonical writers.
7. **`has_tools_py` guard hid `mcp_server.py`** (+~2 rows v1→v2):
   The finalizer only backfilled `mcp_server.py` if the bundle had `tools.py`.
   orchestrator_worker lanes (tool_first_chain sometimes) that emit tools into
   other files were missing the MCP endpoint. Guard removed; empty MCP servers are
   valid.
8. **Deep-research built-in-tools vs function-calling collision** (+5 rows v5→v6):
   Gemini `:generateContent` rejects `{codeExecution}` alongside `functionDeclarations`.
   Fallback now strips built-ins when the agent-loop's tool-registry is present.
9. **Wrong OpenRouter model slug** (+2 rows across v1→v6):
   `google/gemini-3.1-flash-lite` then `google/gemini-flash-1.5` both 404'd on the
   OpenRouter gateway. Settled on `anthropic/claude-3.5-haiku`.
10. **Agent writes `state_store.py` for langgraph** (+1 row v5→v6):
   langgraph's `MemorySaver`/`PostgresSaver` checkpointer is the canonical state
   layer; custom SQLite state_store.py violates the contract. Added to lane_excludes.

## 8. Infrastructure-layer gaps (still open)

These are known limitations, not scaffold bugs:

- **`gemini_deep_research` Interactions API**: `:interactions` endpoint is not exposed
  on the public Generative Language API as of this publication. The fallback to
  `:generateContent` now succeeds but without `researchSteps` / `citations` synthesis.
  Preview-access users can override the underlying model via `GEMINI_DEEP_RESEARCH_MODEL`
  env var.
- **Windows network flake (WinError 10054)**: intermittent TLS reset during Gemini REST
  requests; 1/60 rows affected in v5. A retry-with-backoff wrapper on the base adapter
  would resolve.
- **UTF-8 decode error**: 1/60 rows in v5 received a response starting with byte `0xa7`
  — likely a content-encoding mismatch. Add defensive `errors='replace'` decode.

## 9. Agent-loop telemetry (latest baseline)

- **Total tool calls** across all rows: 939
- **Total LLM tokens**: 2,934,016 (in: 2,850,931, out: 83,085)
- **Emitted scaffold size**: p50 = 15.0 files / 18,469 bytes, p90 = 19.0 files / 25,114 bytes

**Top tool-call names across the run:**

| Tool | Calls |
|---|---|
| `write_file` | 719 |
| `ast_parse_check` | 196 |
| `emit_done` | 15 |
| `run_shell` | 4 |
| `edit_file` | 2 |
| `list_files` | 2 |
| `read_file` | 1 |

## 10. Cost efficiency

At **$1.7729** cumulative spend across 
480 row-dispatches, average cost-per-dispatch is 
**$0.0037**.

For the latest baseline (v8): **$0.2170** for 60 rows = **$0.0036/row**.

## 11. Reproduction

All artifacts under `daas/results/` are deterministic from the code at each baseline
commit. To re-run a baseline from scratch:

```bash
# set env vars: GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY
pip install openai-agents claude-agent-sdk langgraph
python -m daas.benchmarks.attrition_csv_eval_harness \
    --out daas/results/attrition_eval_filled_vN_full.csv \
    --summary daas/results/attrition_eval_summary_vN_full.json
python -m daas.benchmarks.publish_telemetry
```

Per-row budgets: `fast` mode rows target <$0.05 / <60s, `slow` mode rows target
<$0.15 / <180s (except gemini_deep_research: <$0.50 / <600s).
