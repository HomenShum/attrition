#!/usr/bin/env bash
# PreCompact: save workflow progress before context is pruned
set -euo pipefail
ATTRITION_DIR="${HOME}/.attrition"
ACTIVITY_LOG="$ATTRITION_DIR/activity.jsonl"
STATE_FILE="$ATTRITION_DIR/compact_state.json"

python3 -c "
import json, pathlib, time

log = pathlib.Path('$ACTIVITY_LOG')
tools = []
if log.exists():
    for line in log.read_text().strip().split(chr(10)):
        if not line.strip():
            continue
        try:
            tools.append(json.loads(line))
        except:
            pass

state = {
    'saved_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
    'tool_count': len(tools),
    'tools_summary': {},
}
for t in tools:
    name = t.get('tool', 'unknown')
    state['tools_summary'][name] = state['tools_summary'].get(name, 0) + 1

# Save workflow file if active
wf_path = pathlib.Path('$ATTRITION_DIR/active_workflow.json')
if wf_path.exists():
    state['active_workflow'] = json.loads(wf_path.read_text())

with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
" 2>/dev/null || true

exit 0
