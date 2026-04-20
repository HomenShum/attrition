"""Generate an inspectable HTML viewer from showcase.json.

Renders, per query:
  - Query + context
  - Expert (Pro) response
  - Distilled WorkflowSpec (orchestrator prompt + worker definitions)
  - Replay (Flash Lite) response
  - Boolean rubric checks with ✓/✗ + reason
  - Real cost delta

Output: daas/examples/results/showcase.html — standalone file, no deps.
"""

import html
import json
import re
from pathlib import Path

RESULTS = Path(__file__).parent / "results"


def md2html(text: str) -> str:
    s = html.escape(text)
    s = re.sub(r"^### (.+)$", r"<h4>\1</h4>", s, flags=re.M)
    s = re.sub(r"^## (.+)$", r"<h3>\1</h3>", s, flags=re.M)
    s = re.sub(r"^# (.+)$", r"<h3>\1</h3>", s, flags=re.M)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"^(\d+)\.\s+(.+)$", r"<div class='li'><span class='num'>\1.</span> \2</div>", s, flags=re.M)
    s = re.sub(r"^[-\*]\s+(.+)$", r"<div class='bl'>• \1</div>", s, flags=re.M)
    s = s.replace("\n\n", "</p><p>")
    return f"<p>{s}</p>"


def fmt_cost(x):
    if x is None: return "—"
    try: x = float(x)
    except: return str(x)
    if x == 0: return "$0"
    if x < 0.01: return f"${x:.6f}"
    if x < 1: return f"${x:.4f}"
    return f"${x:.2f}"


def fmt_tokens(n):
    if n is None: return "—"
    try: n = int(n)
    except: return str(n)
    if n >= 1_000_000: return f"{n/1_000_000:.1f}M"
    if n >= 1_000: return f"{n/1_000:.1f}K"
    return str(n)


CSS = """
*{box-sizing:border-box}body{font-family:-apple-system,'Inter',sans-serif;background:#0a0a0a;color:#e8e6e3;margin:0;padding:2rem;line-height:1.55}
.wrap{max-width:1280px;margin:0 auto}
h1{font-size:2rem;margin:0 0 .25rem;letter-spacing:-.02em;font-weight:800}
h2{font-size:1.35rem;margin:2rem 0 .75rem;color:#f5f5f4;letter-spacing:-.01em}
h3{font-size:1rem;color:#d97757;margin:1rem 0 .5rem}
h4{font-size:.9rem;margin:.5rem 0;color:#e8e6e3}
.sub{color:#9a9590;font-size:.8125rem}
.card{background:#151413;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:1.25rem;margin-bottom:1rem}
.hero{background:linear-gradient(135deg,rgba(34,197,94,.04),rgba(96,165,250,.04));border:2px solid #22c55e33;padding:2rem;text-align:center}
.hero-label{font-size:2rem;font-weight:800;letter-spacing:-.03em;color:#22c55e}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:.75rem;margin-top:1.5rem}
.metric{background:rgba(255,255,255,.03);padding:1rem;border-radius:8px}
.mlabel{font-size:.625rem;text-transform:uppercase;letter-spacing:.12em;color:#9a9590;margin-bottom:.25rem}
.mval{font-size:1.6rem;font-weight:700;font-family:'JetBrains Mono',monospace;line-height:1}
.msub{color:#5d5854;font-size:.6875rem;margin-top:2px}
.query-card{border-left:3px solid #d97757;margin-bottom:2rem}
.query-head{font-size:1.125rem;font-weight:700;color:#e8e6e3;margin-bottom:.5rem}
.pipeline{display:grid;grid-template-columns:repeat(6,1fr);gap:.5rem;margin:1rem 0;font-size:.75rem}
.stage{background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.3);border-radius:6px;padding:.5rem;text-align:center}
.stage .n{font-size:1.25rem;font-weight:700;font-family:'JetBrains Mono',monospace;color:#22c55e}
.stage .l{color:#9a9590;font-size:.625rem;margin-top:.25rem}
.row3{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem}
.col{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:.875rem;min-width:0}
.col.orig{border-left:3px solid #f59e0b}
.col.repl{border-left:3px solid #22c55e}
.resp{background:#0a0a0a;border:1px solid rgba(255,255,255,.04);border-radius:6px;padding:.75rem;font-size:.75rem;max-height:360px;overflow-y:auto;line-height:1.55;white-space:pre-wrap;font-family:'Inter',sans-serif}
.resp .li{margin:.15rem 0;padding-left:.5rem}
.resp .li .num{color:#d97757;font-weight:600;margin-right:.3rem}
.resp code{background:rgba(255,255,255,.06);padding:1px 5px;border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:.6875rem}
.ctitle{font-weight:600;font-size:.8125rem;display:flex;justify-content:space-between;margin-bottom:.5rem}
.ccost{font-family:'JetBrains Mono',monospace;font-size:.75rem;color:#9a9590}
.spec{background:rgba(96,165,250,.03);border:1px solid rgba(96,165,250,.2);border-radius:8px;padding:1rem;margin:1rem 0}
.spec-hdr{color:#60a5fa;font-weight:600;font-size:.9rem;margin-bottom:.5rem;font-family:'JetBrains Mono',monospace}
.spec-row{display:grid;grid-template-columns:160px 1fr;gap:.75rem;padding:.4rem 0;border-bottom:1px dashed rgba(96,165,250,.08);font-size:.75rem}
.spec-row:last-child{border:none}
.spec-k{color:#9a9590;font-family:'JetBrains Mono',monospace;font-size:.6875rem}
.spec-v{color:#e8e6e3;line-height:1.5}
.worker-chip{display:inline-block;padding:2px 8px;border-radius:4px;background:rgba(96,165,250,.12);color:#60a5fa;font-family:'JetBrains Mono',monospace;font-size:.6875rem;margin:.125rem .25rem .125rem 0;border:1px solid rgba(96,165,250,.3)}
.tool-chip{display:inline-block;padding:2px 8px;border-radius:4px;background:rgba(217,119,87,.1);color:#d97757;font-family:'JetBrains Mono',monospace;font-size:.6875rem;margin:.125rem .25rem .125rem 0;border:1px solid rgba(217,119,87,.25)}
.rule-item{padding:.25rem 0;color:#9a9590;font-size:.75rem;line-height:1.5}
.rule-item::before{content:"▸ ";color:#60a5fa}
.checks{display:grid;gap:.35rem;margin-top:.75rem}
.check{display:grid;grid-template-columns:20px 240px 1fr;gap:.75rem;align-items:start;padding:.5rem .75rem;border-radius:4px;font-size:.8125rem;line-height:1.5}
.check.pass{background:rgba(34,197,94,.05);border-left:2px solid #22c55e}
.check.fail{background:rgba(239,68,68,.05);border-left:2px solid #ef4444}
.check-mark{font-family:'JetBrains Mono',monospace;font-weight:700}
.check-name{font-family:'JetBrains Mono',monospace;color:#e8e6e3;font-size:.75rem}
.check-reason{color:#9a9590}
.verdict-badge{padding:3px 10px;border-radius:4px;font-size:.6875rem;font-weight:700;font-family:'JetBrains Mono',monospace;border:1px solid}
.v-pass{background:rgba(34,197,94,.15);color:#22c55e;border-color:rgba(34,197,94,.4)}
.v-partial{background:rgba(245,158,11,.15);color:#f59e0b;border-color:rgba(245,158,11,.4)}
.v-fail{background:rgba(239,68,68,.15);color:#ef4444;border-color:rgba(239,68,68,.4)}
.ctx-json{background:rgba(255,255,255,.02);border:1px dashed rgba(255,255,255,.1);border-radius:6px;padding:.5rem .75rem;font-family:'JetBrains Mono',monospace;font-size:.6875rem;color:#9a9590;max-height:100px;overflow-y:auto;margin:.5rem 0}
.foot{text-align:center;color:#5d5854;font-size:.6875rem;margin-top:3rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,.04)}
"""


def verdict_class(v):
    return {"pass": "v-pass", "partial": "v-partial"}.get(v or "", "v-fail")


def build_query_section(art: dict) -> str:
    query = art["query"]
    session_id = art["session_id"]
    repo_context = art["repo_context"]
    expert = art["expert"]
    distilled = art["distilled"]
    replay = art["replay"]
    judgment = art["judgment"]
    full_run = art.get("full_run") or {}
    spec_json_str = (full_run.get("spec") or {}).get("specJson") or "{}"
    try:
        spec_obj = json.loads(spec_json_str)
    except Exception:
        spec_obj = {}

    # Load latest replay's judgment checks
    latest_replay = (full_run.get("replays") or [{}])[0]
    judgment_detail = latest_replay.get("judgment") or {}
    checks_json = judgment_detail.get("checksJson") or "[]"
    try:
        checks = json.loads(checks_json)
    except Exception:
        checks = []

    # Build sections
    out = []
    out.append(f'<div class="card query-card">')
    out.append(f'<div class="query-head">{html.escape(query)}</div>')
    out.append(f'<div class="sub">session: <code style="font-family:JetBrains Mono,monospace">{html.escape(session_id)}</code></div>')

    out.append(f'<div class="ctx-json">{html.escape(json.dumps(repo_context, indent=2))}</div>')

    # Pipeline indicator
    out.append('<div class="pipeline">')
    for n, lbl in [(1, "INGEST"), (2, "NORMALIZE"), (3, "DISTILL"), (4, "REPLAY"), (5, "JUDGE"), (6, "AUDIT")]:
        out.append(f'<div class="stage"><div class="n">{n}</div><div class="l">{lbl}</div></div>')
    out.append('</div>')

    # Per-stage metrics row
    out.append('<div class="grid4" style="margin-top:1rem">')
    out.append(f'<div class="metric"><div class="mlabel">Expert Cost</div><div class="mval" style="color:#f59e0b">{fmt_cost(expert["cost_usd"])}</div><div class="msub">Pro, {fmt_tokens(expert["total_tokens"])} tok</div></div>')
    out.append(f'<div class="metric"><div class="mlabel">Distill Cost</div><div class="mval" style="color:#60a5fa">{fmt_cost(distilled["distillCostUsd"])}</div><div class="msub">one-time / trace</div></div>')
    out.append(f'<div class="metric"><div class="mlabel">Replay Cost</div><div class="mval" style="color:#22c55e">{fmt_cost(replay["replayCostUsd"])}</div><div class="msub">Flash Lite, {fmt_tokens(replay["replayTokens"])} tok</div></div>')
    cost_delta = ((replay["replayCostUsd"] - expert["cost_usd"]) / expert["cost_usd"] * 100) if expert["cost_usd"] else 0
    cd_color = "#22c55e" if cost_delta < 0 else "#ef4444"
    out.append(f'<div class="metric"><div class="mlabel">Cost Delta</div><div class="mval" style="color:{cd_color}">{cost_delta:+.1f}%</div><div class="msub">replay vs expert</div></div>')
    out.append('</div>')

    # ─── Distilled scaffold (the "real example" the user asked for) ───
    out.append('<div class="spec">')
    out.append('<div class="spec-hdr">Distilled WorkflowSpec (the scaffold)</div>')

    out.append('<div class="spec-row"><div class="spec-k">orchestrator_system_prompt</div>')
    out.append(f'<div class="spec-v">{html.escape((spec_obj.get("orchestrator_system_prompt") or "")[:600])}</div></div>')

    out.append('<div class="spec-row"><div class="spec-k">orchestrator_plan_prompt</div>')
    out.append(f'<div class="spec-v">{html.escape((spec_obj.get("orchestrator_plan_prompt") or "")[:600])}</div></div>')

    out.append('<div class="spec-row"><div class="spec-k">workers</div><div class="spec-v">')
    for w in (spec_obj.get("workers") or [])[:10]:
        name = html.escape(w.get("name", "?"))
        role = html.escape(w.get("role", "?"))
        sys_p = html.escape((w.get("system_prompt") or "")[:180])
        tools = " ".join(f'<span class="tool-chip">{html.escape(t)}</span>' for t in (w.get("tools") or [])[:6])
        out.append(f'<div style="margin:.35rem 0;padding-left:.5rem;border-left:1px solid rgba(96,165,250,.2)">')
        out.append(f'<div><span class="worker-chip">{name}</span><span style="color:#9a9590;font-size:.6875rem"> · {role}</span></div>')
        out.append(f'<div style="font-size:.75rem;color:#9a9590;margin-top:.25rem">{sys_p}</div>')
        if tools:
            out.append(f'<div style="margin-top:.25rem">{tools}</div>')
        out.append('</div>')
    out.append('</div></div>')

    tools_list = spec_obj.get("tools") or []
    if tools_list:
        out.append('<div class="spec-row"><div class="spec-k">tools</div><div class="spec-v">')
        for t in tools_list[:10]:
            tname = html.escape(t.get("name", "?"))
            purp = html.escape((t.get("purpose") or "")[:120])
            out.append(f'<div style="margin:.25rem 0"><span class="tool-chip">{tname}</span> <span style="color:#9a9590;font-size:.6875rem">{purp}</span></div>')
        out.append('</div></div>')

    rules = spec_obj.get("domain_rules") or []
    if rules:
        out.append('<div class="spec-row"><div class="spec-k">domain_rules</div><div class="spec-v">')
        for r in rules[:8]:
            out.append(f'<div class="rule-item">{html.escape(str(r))}</div>')
        out.append('</div></div>')

    criteria = spec_obj.get("success_criteria") or []
    if criteria:
        out.append('<div class="spec-row"><div class="spec-k">success_criteria</div><div class="spec-v">')
        for c in criteria[:8]:
            out.append(f'<div class="rule-item">{html.escape(str(c))}</div>')
        out.append('</div></div>')

    out.append(f'<div class="spec-row"><div class="spec-k">workers dispatched</div><div class="spec-v">')
    for w in replay.get("workersDispatched") or []:
        out.append(f'<span class="worker-chip">{html.escape(str(w))}</span>')
    out.append('</div></div>')

    out.append('</div>')  # close spec

    # ─── Original vs replay side-by-side ───
    out.append('<div class="row3">')
    out.append('<div class="col orig">')
    out.append(f'<div class="ctitle"><span>Original (Pro)</span><span class="ccost">{fmt_cost(expert["cost_usd"])}</span></div>')
    out.append(f'<div class="sub" style="font-size:.625rem;margin-bottom:.35rem">gemini-3.1-pro-preview · {fmt_tokens(expert["total_tokens"])} tok</div>')
    out.append(f'<div class="resp">{md2html(expert["text"])}</div>')
    out.append('</div>')

    out.append('<div class="col repl">')
    out.append(f'<div class="ctitle"><span>Replay (Flash Lite + scaffold)</span><span class="ccost">{fmt_cost(replay["replayCostUsd"])}</span></div>')
    workers_disp = ", ".join(replay.get("workersDispatched") or [])
    out.append(f'<div class="sub" style="font-size:.625rem;margin-bottom:.35rem">gemini-3.1-flash-lite-preview · {fmt_tokens(replay["replayTokens"])} tok · workers: {html.escape(workers_disp)}</div>')
    out.append(f'<div class="resp">{md2html(latest_replay.get("replayAnswer", ""))}</div>')
    out.append('</div>')
    out.append('</div>')

    # ─── Judgment: boolean checks with reasons ───
    verdict = judgment_detail.get("verdict") or judgment.get("verdict") or "?"
    passed = judgment_detail.get("passedCount", judgment.get("passedCount", 0))
    total = judgment_detail.get("totalCount", judgment.get("totalCount", 0))
    rubric_id = judgment_detail.get("rubricId") or "?"
    rubric_version = judgment_detail.get("rubricVersion") or "?"

    out.append(f'<div style="margin-top:1rem;display:flex;justify-content:space-between;align-items:center">')
    out.append(f'<h3 style="margin:0">Judge verdict <span class="verdict-badge {verdict_class(verdict)}">{html.escape(str(verdict).upper())}</span></h3>')
    out.append(f'<div class="sub" style="font-family:JetBrains Mono,monospace">passed <strong style="color:#22c55e">{passed}</strong>/<strong>{total}</strong> · rubric <code>{html.escape(rubric_id)}</code> @ {html.escape(rubric_version)}</div>')
    out.append('</div>')

    out.append('<div class="checks">')
    for c in checks:
        cls = "pass" if c.get("passed") else "fail"
        mark = "✓" if c.get("passed") else "✗"
        color = "#22c55e" if c.get("passed") else "#ef4444"
        out.append(f'<div class="check {cls}">')
        out.append(f'<span class="check-mark" style="color:{color}">{mark}</span>')
        out.append(f'<span class="check-name">{html.escape(c.get("name",""))}</span>')
        out.append(f'<span class="check-reason">{html.escape(c.get("reason",""))}</span>')
        out.append('</div>')
    out.append('</div>')

    out.append('</div>')  # close query-card
    return "".join(out)


def main():
    data_path = RESULTS / "showcase.json"
    if not data_path.exists():
        print(f"Missing {data_path} — run run_showcase.py first", file=__import__('sys').stderr)
        return 1

    arts = json.loads(data_path.read_text(encoding="utf-8"))

    # Aggregate metrics
    expert_total = sum(a["expert"]["cost_usd"] for a in arts)
    replay_total = sum(a["replay"]["replayCostUsd"] for a in arts)
    distill_total = sum(a["distilled"]["distillCostUsd"] for a in arts)
    checks_passed = sum(a["judgment"]["passedCount"] for a in arts)
    checks_total = sum(a["judgment"]["totalCount"] for a in arts)
    cost_delta = ((replay_total - expert_total) / expert_total * 100) if expert_total else 0

    passed_count = sum(1 for a in arts if a["judgment"]["verdict"] == "pass")

    out = [f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>DaaS Showcase — 3 fresh queries, end to end</title>
<style>{CSS}</style></head><body><div class="wrap">

<h1>DaaS Showcase</h1>
<p class="sub">3 diverse queries run through the live NodeBench prod Convex pipeline.
Every scaffold is extracted by a Pro distiller; every replay runs Flash Lite against
the distilled WorkflowSpec; every judgment is an LLM-applied boolean rubric with
explanations. All costs measured from real Gemini API <code style="font-family:JetBrains Mono,monospace">usageMetadata</code>.</p>

<div class="card hero">
  <div class="hero-label">END-TO-END LIVE</div>
  <p class="sub" style="margin-top:.5rem">Ingest -> distill -> replay -> judge, all server-side in Convex prod</p>
  <div class="grid4">
    <div class="metric"><div class="mlabel">Queries</div><div class="mval" style="color:#e8e6e3">{len(arts)}</div><div class="msub">diverse domains</div></div>
    <div class="metric"><div class="mlabel">Verdicts</div><div class="mval" style="color:#22c55e">{passed_count}/{len(arts)}</div><div class="msub">pass</div></div>
    <div class="metric"><div class="mlabel">Checks passed</div><div class="mval" style="color:#d97757">{checks_passed}/{checks_total}</div><div class="msub">boolean rubric</div></div>
    <div class="metric"><div class="mlabel">Cost delta</div><div class="mval" style="color:{'#22c55e' if cost_delta < 0 else '#ef4444'}">{cost_delta:+.1f}%</div><div class="msub">replay vs expert</div></div>
  </div>
</div>

<div class="card">
  <h2>Total cost breakdown</h2>
  <div class="grid4">
    <div class="metric"><div class="mlabel">Expert (Pro)</div><div class="mval" style="color:#f59e0b">{fmt_cost(expert_total)}</div><div class="msub">3 runs</div></div>
    <div class="metric"><div class="mlabel">Distill (one-time)</div><div class="mval" style="color:#60a5fa">{fmt_cost(distill_total)}</div><div class="msub">reusable</div></div>
    <div class="metric"><div class="mlabel">Replay (Flash Lite)</div><div class="mval" style="color:#22c55e">{fmt_cost(replay_total)}</div><div class="msub">3 runs</div></div>
    <div class="metric"><div class="mlabel">Replay savings</div><div class="mval" style="color:#22c55e">{fmt_cost(expert_total - replay_total)}</div><div class="msub">per 3 queries</div></div>
  </div>
</div>

<h2>Per-query breakdown</h2>
"""]

    for a in arts:
        out.append(build_query_section(a))

    out.append("""
<div class="foot">
  DaaS showcase - agile-caribou-964.convex.cloud - all data measured from real API tokens
</div>
</div></body></html>""")

    out_path = RESULTS / "showcase.html"
    out_path.write_text("".join(out), encoding="utf-8")
    print(f"Wrote {out_path}")
    print(f"Open: file:///{out_path.as_posix()}")


if __name__ == "__main__":
    main()
