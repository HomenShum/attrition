"""Runner: distill meta-workflows from selected Claude Code JSONL sessions.

Usage:
    python -m daas.compile_down.run_meta_distill \
        --out daas/results/meta_workflows.json \
        --human-out daas/results/meta_workflows.md \
        --sessions 17443bc7-fc7c-45f6-80ef-67a6df5cb62c ...
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from daas.compile_down.normalizers.claude_code import from_claude_code_jsonl
from daas.compile_down.meta_workflow import distill_meta_workflow, meta_workflow_to_dict


def _render_markdown(all_mw: list[dict[str, Any]]) -> str:
    out: list[str] = ["# Meta-Workflows — distilled from real Claude Code sessions\n"]
    out.append(
        "Each session below was compile-DOWN from a raw JSONL transcript. "
        "The distiller is deterministic (no LLM call) and produces phases "
        "that each answer: *what is this section doing, targeting which "
        "angles, because the user said what?*\n"
    )
    for mw in all_mw:
        out.append(f"\n## `{mw['session_id'][:8]}`  —  {mw['total_steps']} steps")
        out.append(
            f"**{mw['phase_count']} phases** · dominant tool classes: "
            f"`{', '.join(mw['dominant_tool_classes']) or '(none)'}`\n"
        )
        for p in mw["phases"][:8]:  # cap preview at first 8 phases
            out.append(f"### Phase {p['index'] + 1}: {p['name']}")
            if p["trigger"]:
                out.append(f"- **Trigger** (user): _{p['trigger'][:200]}_")
            if p["intent"]:
                out.append(f"- **Intent**: {p['intent']}")
            if p["angles"]:
                out.append(
                    "- **Angles**: "
                    + "; ".join(f"`{a}`" for a in p["angles"][:4])
                )
            if p["tool_classes"]:
                out.append(f"- **Tool classes**: {', '.join(p['tool_classes'])}")
            if p["tools_used"]:
                tools_preview = ", ".join(p["tools_used"][:6])
                more = f" (+{len(p['tools_used']) - 6} more)" if len(p["tools_used"]) > 6 else ""
                out.append(f"- **Tools**: {tools_preview}{more}")
            out.append(f"- **Steps**: {p['step_count']}\n")
        if mw["phase_count"] > 8:
            out.append(f"_... and {mw['phase_count'] - 8} more phases_\n")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--human-out", default=None)
    ap.add_argument("--sessions", nargs="+", required=True)
    ap.add_argument(
        "--projects-root", default=str(Path.home() / ".claude" / "projects")
    )
    ap.add_argument(
        "--project",
        default="D--VSCode-Projects-cafecorner-nodebench-nodebench-ai4-nodebench-ai",
    )
    args = ap.parse_args()

    project_dir = Path(args.projects_root) / args.project
    if not project_dir.exists():
        print(f"[ERR] project dir missing: {project_dir}", file=sys.stderr)
        return 2

    all_dicts: list[dict[str, Any]] = []
    for sid in args.sessions:
        jsonl = project_dir / f"{sid}.jsonl"
        if not jsonl.exists():
            print(f"[WARN] missing {sid}")
            continue
        trace = from_claude_code_jsonl(jsonl)
        mw = distill_meta_workflow(trace)
        d = meta_workflow_to_dict(mw)
        all_dicts.append(d)
        angles_total = sum(len(p["angles"]) for p in d["phases"])
        print(
            f"[OK] {sid[:8]}  "
            f"steps={mw.total_steps:>5}  "
            f"phases={mw.phase_count:>3}  "
            f"angles={angles_total:>3}  "
            f"dominant={','.join(mw.dominant_tool_classes[:3])}"
        )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"sessions": all_dicts}, indent=2), encoding="utf-8"
    )
    print(f"[DONE] wrote {out}  ({len(all_dicts)} sessions)")

    if args.human_out:
        md = _render_markdown(all_dicts)
        human = Path(args.human_out)
        human.parent.mkdir(parents=True, exist_ok=True)
        human.write_text(md, encoding="utf-8")
        print(f"[DONE] wrote human-readable -> {human}")

    # Aggregate headline stats
    total_phases = sum(d["phase_count"] for d in all_dicts)
    total_angles = sum(
        len(p["angles"]) for d in all_dicts for p in d["phases"]
    )
    total_triggers = sum(
        1 for d in all_dicts for p in d["phases"] if p["trigger"]
    )
    print("\n=== META-WORKFLOW AGGREGATE ===")
    print(f"  sessions        : {len(all_dicts)}")
    print(f"  total phases    : {total_phases}")
    print(f"  phases w/ user-trigger : {total_triggers}")
    print(f"  angles extracted       : {total_angles}")
    if total_phases:
        print(f"  avg phases/session     : {total_phases / len(all_dicts):.1f}")
        print(f"  angle-capture rate     : {total_angles / total_phases:.2f} angles/phase")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
