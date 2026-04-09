#!/usr/bin/env bash
# SessionStart: check for prior incomplete workflows, persist env vars
set -euo pipefail
ATTRITION_DIR="${HOME}/.attrition"
mkdir -p "$ATTRITION_DIR"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('session_id','unknown'))" 2>/dev/null || echo "unknown")

# Check for prior incomplete sessions
if [ -f "$ATTRITION_DIR/active_workflow.json" ]; then
  WORKFLOW=$(cat "$ATTRITION_DIR/active_workflow.json")
  WORKFLOW_NAME=$(echo "$WORKFLOW" | python3 -c "import sys,json;print(json.load(sys.stdin).get('name',''))" 2>/dev/null || echo "")
  if [ -n "$WORKFLOW_NAME" ]; then
    # Output context that Claude will see
    echo "[attrition] Resuming prior incomplete workflow: $WORKFLOW_NAME"
    echo "Required steps from prior session:"
    python3 -c "
import sys,json
w=json.load(open('$ATTRITION_DIR/active_workflow.json'))
for s in w.get('required_steps',[]):
    print(f'  - {s}')
" 2>/dev/null || true
  fi
fi

# Persist environment variables for other hooks
echo "$SESSION_ID" > "$ATTRITION_DIR/current_session_id"

# Output JSON with environment variables to persist
python3 -c "
import json
print(json.dumps({
    'environmentVariables': {
        'ATTRITION_SESSION_ID': '$SESSION_ID',
        'ATTRITION_DIR': '$ATTRITION_DIR'
    }
}))
" 2>/dev/null || true

exit 0
