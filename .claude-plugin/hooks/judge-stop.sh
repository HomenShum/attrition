#!/usr/bin/env bash
# Stop + SubagentStop: HARD-BLOCK if required steps are missing
# EXIT CODE 2 = BLOCK the stop
set -euo pipefail
ATTRITION_DIR="${HOME}/.attrition"
ACTIVITY_LOG="$ATTRITION_DIR/activity.jsonl"
WORKFLOW_FILE="$ATTRITION_DIR/active_workflow.json"

# If no active workflow, allow stop
if [ ! -f "$WORKFLOW_FILE" ]; then
    exit 0
fi

# Judge completion
RESULT=$(python3 -c "
import sys, json, os, pathlib

# Load workflow
with open('$WORKFLOW_FILE') as f:
    workflow = json.load(f)

required = workflow.get('required_steps', [])
if not required:
    print('ALLOW')
    sys.exit(0)

# Load activity log
log_path = pathlib.Path('$ACTIVITY_LOG')
tools = []
if log_path.exists():
    for line in log_path.read_text().strip().split(chr(10)):
        if not line.strip():
            continue
        try:
            tools.append(json.loads(line))
        except:
            pass

# Check evidence for each step
STEP_TOOLS = {
    'understand plan': ['Read', 'Grep'],
    'search latest context': ['WebSearch', 'WebFetch', 'Grep'],
    'search for patterns': ['Grep', 'Glob'],
    'read affected files': ['Read'],
    'read sources': ['Read', 'WebFetch'],
    'inspect surfaces': ['preview_screenshot', 'Claude_in_Chrome'],
    'navigate all pages': ['Claude_in_Chrome', 'preview_start'],
    'check console errors': ['read_console', 'preview_console'],
    'test interactions': ['Claude_in_Chrome', 'preview_click'],
    'implement': ['Edit', 'Write'],
    'edit files': ['Edit', 'Write'],
    'define scope': ['Read', 'Grep'],
    'web search': ['WebSearch', 'WebFetch'],
    'synthesize findings': ['Write', 'Edit'],
    'run tests': ['vitest', 'jest', 'pytest', 'cargo test', 'npm test'],
    'run integration tests': ['vitest', 'jest', 'pytest'],
    'build': ['tsc', 'cargo build', 'vite build', 'npm run build'],
    'preview/verify': ['preview_screenshot', 'Claude_in_Chrome'],
    'check for breaking changes': ['WebSearch', 'Grep'],
    'update types': ['Edit', 'Write'],
    'commit': ['git commit', 'git add'],
    'report findings': ['Write', 'Edit'],
    'bump version': ['npm version', 'Edit'],
    'tag release': ['git tag'],
    'push to staging': ['git push'],
    'smoke test': ['curl', 'fetch', 'WebFetch'],
    'promote to production': ['git push'],
    'start dev server': ['preview_start', 'npm run dev'],
}

tool_names = [t.get('tool','') for t in tools]
tool_args = ' '.join([json.dumps(t.get('scrubbed',{})) for t in tools])
combined = ' '.join(tool_names) + ' ' + tool_args

completed = []
missing = []
for step in required:
    found = False
    keywords = STEP_TOOLS.get(step, [step])
    for kw in keywords:
        if kw.lower() in combined.lower():
            found = True
            break
    if found:
        completed.append(step)
    else:
        missing.append(step)

total = len(required)
done = len(completed)
score = done / total if total > 0 else 1.0

if score >= 1.0:
    # Clean up active workflow
    os.remove('$WORKFLOW_FILE')
    print('ALLOW')
elif score >= 0.85:
    os.remove('$WORKFLOW_FILE')
    print(f'ALLOW_WARN:{done}/{total} steps done. Minor gaps: {\", \".join(missing)}')
elif score >= 0.5:
    print(f'ESCALATE:{done}/{total} steps. Missing: {\", \".join(missing)}')
else:
    print(f'BLOCK:{done}/{total} steps. Missing: {\", \".join(missing)}')
" 2>/dev/null || echo "ALLOW")

case "$RESULT" in
    ALLOW)
        exit 0
        ;;
    ALLOW_WARN:*)
        MSG="${RESULT#ALLOW_WARN:}"
        echo "[attrition] Workflow completed with minor gaps: $MSG" >&2
        exit 0
        ;;
    ESCALATE:*)
        MSG="${RESULT#ESCALATE:}"
        echo "[attrition] WARNING: Workflow incomplete. $MSG. Consider completing missing steps before stopping." >&2
        exit 0
        ;;
    BLOCK:*)
        MSG="${RESULT#BLOCK:}"
        echo "[attrition] BLOCKED: Workflow incomplete. $MSG" >&2
        # EXIT CODE 2 = HARD BLOCK. Claude cannot stop.
        exit 2
        ;;
    *)
        exit 0
        ;;
esac
