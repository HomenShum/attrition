"""Trace normalizers — source-agnostic -> CanonicalTrace.

Each normalizer reads a specific agent runtime's session format and
produces a CanonicalTrace (see daas/schemas.py). Downstream, the
distiller converts CanonicalTrace -> WorkflowSpec, and the emitters
convert WorkflowSpec -> runnable code.

Supported inputs:
  claude_code    — ~/.claude/projects/*.jsonl session files
  cursor         — exported Cursor session JSON
  langgraph      — LangGraph graph JSON (structural import; no trace)

Each normalizer is a pure function with no side effects.
"""

from daas.compile_down.normalizers.claude_code import from_claude_code_jsonl
from daas.compile_down.normalizers.cursor import from_cursor_session
from daas.compile_down.normalizers.langgraph_import import from_langgraph_graph

__all__ = [
    "from_claude_code_jsonl",
    "from_cursor_session",
    "from_langgraph_graph",
]
