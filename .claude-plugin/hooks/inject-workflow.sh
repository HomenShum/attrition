#!/usr/bin/env bash
# InstructionsLoaded: dynamically inject workflow steps into instructions
set -euo pipefail
ATTRITION_DIR="${HOME}/.attrition"
WORKFLOW_FILE="$ATTRITION_DIR/active_workflow.json"

if [ ! -f "$WORKFLOW_FILE" ]; then
    exit 0
fi

python3 -c "
import json
with open('$WORKFLOW_FILE') as f:
    wf = json.load(f)
name = wf.get('name', 'Unknown')
steps = wf.get('required_steps', [])
if steps:
    print(f'[attrition] Active workflow: {name}')
    print('Required steps for this session:')
    for i, s in enumerate(steps, 1):
        print(f'  {i}. {s}')
    print('The Stop hook will block completion if required steps are missing.')
" 2>/dev/null || true

exit 0
