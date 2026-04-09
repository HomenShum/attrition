#!/usr/bin/env bash
# FileChanged: track which files were modified
set -euo pipefail
ATTRITION_DIR="${HOME}/.attrition"
FILE_LOG="$ATTRITION_DIR/file_changes.jsonl"
mkdir -p "$ATTRITION_DIR"

INPUT=$(cat)

python3 -c "
import sys, json, time, pathlib

data = json.loads(sys.stdin.read())
file_path = data.get('file_path', data.get('path', ''))
if file_path:
    entry = {
        'ts': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'file': file_path,
        'event': 'changed',
    }
    with open('$FILE_LOG', 'a') as f:
        f.write(json.dumps(entry) + chr(10))
" <<< "$INPUT" 2>/dev/null || true

exit 0
