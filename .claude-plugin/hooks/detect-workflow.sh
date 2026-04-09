#!/usr/bin/env bash
# UserPromptSubmit: detect workflow patterns, inject required steps
set -euo pipefail
ATTRITION_DIR="${HOME}/.attrition"
mkdir -p "$ATTRITION_DIR"

INPUT=$(cat)

# Detect workflow using keyword matching
python3 -c "
import sys, json

input_data = json.loads(sys.stdin.read())
prompt = input_data.get('prompt', input_data.get('content', ''))
prompt_lower = prompt.lower()

# Workflow patterns
WORKFLOWS = {
    'dev_flywheel': {
        'triggers': ['flywheel', 'full pass', 'ship properly', 'ship this', 'full workflow'],
        'steps': ['understand plan', 'search latest context', 'inspect surfaces', 'implement', 'run tests', 'preview/verify', 'commit'],
        'description': 'Development Flywheel'
    },
    'qa_audit': {
        'triggers': ['qa this', 'audit', 'test all surfaces', 'qa all', 'dogfood'],
        'steps': ['start dev server', 'navigate all pages', 'check console errors', 'test interactions', 'report findings'],
        'description': 'QA Surface Audit'
    },
    'research': {
        'triggers': ['research', 'search latest', 'investigate', 'deep dive', 'look into'],
        'steps': ['define scope', 'web search', 'read sources', 'synthesize findings'],
        'description': 'Research & Context Refresh'
    },
    'refactor': {
        'triggers': ['refactor', 'migrate', 'upgrade', 'convert'],
        'steps': ['search for patterns', 'read affected files', 'edit files', 'check for breaking changes', 'update types', 'run tests', 'run integration tests', 'build'],
        'description': 'Code Refactor'
    },
    'deploy': {
        'triggers': ['deploy', 'release', 'ship to prod', 'push to production'],
        'steps': ['run tests', 'build', 'bump version', 'tag release', 'push to staging', 'smoke test', 'promote to production'],
        'description': 'Deployment Pipeline'
    },
}

detected = None
for wf_id, wf in WORKFLOWS.items():
    for trigger in wf['triggers']:
        if trigger in prompt_lower:
            detected = (wf_id, wf)
            break
    if detected:
        break

if detected:
    wf_id, wf = detected
    # Save active workflow
    active = {
        'id': wf_id,
        'name': wf['description'],
        'required_steps': wf['steps'],
    }
    with open(f'${ATTRITION_DIR}/active_workflow.json', 'w') as f:
        json.dump(active, f)

    # Output context for Claude
    print(f'[attrition] Detected workflow: {wf[\"description\"]}')
    print(f'Required steps ({len(wf[\"steps\"])}):')
    for step in wf['steps']:
        print(f'  - {step}')
    print('All steps must have evidence (tool calls, file changes) to pass completion.')
" <<< "$INPUT" 2>/dev/null || true

exit 0
