#!/usr/bin/env bash
# PostToolUse: track every tool call for workflow evidence
set -euo pipefail
ATTRITION_DIR="${HOME}/.attrition"
ACTIVITY_LOG="$ATTRITION_DIR/activity.jsonl"
mkdir -p "$ATTRITION_DIR"

INPUT=$(cat)

python3 -c "
import sys, json, time, pathlib

data = json.loads(sys.stdin.read())
tool_name = data.get('tool_name', '')
tool_input = data.get('tool_input', {})

# Scrub sensitive values
scrubbed = {}
sensitive = {'password','secret','key','token','credential','api_key'}
if isinstance(tool_input, dict):
    for k, v in tool_input.items():
        if any(s in k.lower() for s in sensitive):
            scrubbed[k] = '[REDACTED]'
        elif k in ('file_path','path'):
            import pathlib as pl
            scrubbed[k] = '*' + pl.PurePosixPath(str(v)).suffix
        elif len(str(v)) <= 30:
            scrubbed[k] = str(v)
        else:
            scrubbed[k] = f'[{len(str(v))}c]'

entry = {
    'ts': time.strftime('%Y-%m-%dT%H:%M:%S'),
    'tool': tool_name,
    'keys': sorted(scrubbed.keys()),
    'scrubbed': scrubbed,
    'source': 'attrition-plugin',
}

pathlib.Path('$ACTIVITY_LOG').parent.mkdir(parents=True, exist_ok=True)
with open('$ACTIVITY_LOG', 'a') as f:
    f.write(json.dumps(entry) + chr(10))
" <<< "$INPUT" 2>/dev/null || true

exit 0
