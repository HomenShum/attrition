#!/usr/bin/env bash
# SessionEnd: automatically capture the session as a workflow
set -euo pipefail
ATTRITION_DIR="${HOME}/.attrition"
ACTIVITY_LOG="$ATTRITION_DIR/activity.jsonl"

INPUT=$(cat)

# Count tool calls — only capture sessions with 5+ tool calls
TOOL_COUNT=0
if [ -f "$ACTIVITY_LOG" ]; then
    TOOL_COUNT=$(wc -l < "$ACTIVITY_LOG" 2>/dev/null || echo "0")
    # Trim whitespace from wc output
    TOOL_COUNT=$(echo "$TOOL_COUNT" | tr -d '[:space:]')
fi

if [ "$TOOL_COUNT" -lt 5 ] 2>/dev/null; then
    # Too short to be a meaningful workflow
    rm -f "$ATTRITION_DIR/active_workflow.json" "$ATTRITION_DIR/search_log.jsonl" 2>/dev/null
    exit 0
fi

python3 -c "
import json, pathlib, time, uuid

log = pathlib.Path('$ACTIVITY_LOG')
tools = []
for line in log.read_text().strip().split(chr(10)):
    if not line.strip():
        continue
    try:
        tools.append(json.loads(line))
    except:
        pass

# Build canonical events from tool log
events = []
for t in tools:
    events.append({
        'type': 'tool_call',
        'tool': t.get('tool', ''),
        'keys': t.get('keys', []),
        'timestamp': t.get('ts', ''),
    })

workflow = {
    'id': str(uuid.uuid4()),
    'name': f'auto-captured-{time.strftime(\"%Y%m%d-%H%M%S\")}',
    'source_model': 'unknown',
    'captured_at': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
    'event_count': len(events),
    'tool_count': len(tools),
    'auto_captured': True,
}

# Save to auto-captures directory
auto_dir = pathlib.Path('$ATTRITION_DIR/auto_captures')
auto_dir.mkdir(parents=True, exist_ok=True)
out_path = auto_dir / f'{workflow[\"id\"]}.json'
with open(out_path, 'w') as f:
    json.dump({'workflow': workflow, 'events': events}, f, indent=2)

print(f'[attrition] Auto-captured workflow: {workflow[\"name\"]} ({len(events)} events)')
" 2>/dev/null || true

# Clean up session-specific files
rm -f "$ATTRITION_DIR/active_workflow.json" "$ATTRITION_DIR/search_log.jsonl" 2>/dev/null
# Keep activity log for analysis

exit 0
