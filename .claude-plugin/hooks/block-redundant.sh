#!/usr/bin/env bash
# PreToolUse: block duplicate searches within the same session
set -euo pipefail
ATTRITION_DIR="${HOME}/.attrition"
SEARCH_LOG="$ATTRITION_DIR/search_log.jsonl"
mkdir -p "$ATTRITION_DIR"

INPUT=$(cat)

# Extract search query and check for duplicates
RESULT=$(python3 -c "
import sys, json, hashlib, pathlib

data = json.loads(sys.stdin.read())
tool_name = data.get('tool_name', '')
tool_input = data.get('tool_input', {})

# Extract the search query
query = ''
if tool_name in ('Grep', 'grep'):
    query = tool_input.get('pattern', '')
elif tool_name in ('Glob', 'glob'):
    query = tool_input.get('pattern', '')
elif tool_name in ('WebSearch', 'web_search'):
    query = tool_input.get('query', '')

if not query:
    print('ALLOW')
    sys.exit(0)

# Hash the query
qhash = hashlib.sha256(f'{tool_name}:{query}'.encode()).hexdigest()[:16]

# Check if already searched
log = pathlib.Path('$SEARCH_LOG')
if log.exists():
    for line in log.read_text().strip().split(chr(10)):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
            if entry.get('hash') == qhash:
                print(f'BLOCK:Already searched: {tool_name}(\"{query[:40]}\")')
                sys.exit(0)
        except:
            pass

# Log this search
with open('$SEARCH_LOG', 'a') as f:
    f.write(json.dumps({'hash': qhash, 'tool': tool_name, 'query': query[:100]}) + chr(10))

print('ALLOW')
" <<< "$INPUT" 2>/dev/null || echo "ALLOW")

if [[ "$RESULT" == BLOCK:* ]]; then
    MSG="${RESULT#BLOCK:}"
    # Return JSON to block with reason
    echo "{\"hookSpecificOutput\":{\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"[attrition] $MSG. Use a different query or check prior results.\"}}"
    exit 0
fi

exit 0
