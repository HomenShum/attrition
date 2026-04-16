# Advisor Mode Setup

Set up the Sonnet executor + Opus advisor pattern in any codebase. Model-agnostic — works with any LLM provider.

## Trigger
User says "set up advisor mode", "add advisor pattern", "implement advisor", "optimize my LLM costs", or "attrition advisor"

## Protocol

### Phase 1: Scan the codebase (automatic)
Run the attrition codebase scanner to detect:
- Which LLM providers are used (OpenAI, Anthropic, Google, LangChain, etc.)
- Where LLM calls happen (file + line)
- Which models are referenced
- Current architecture patterns (single model, multi-model, subagent, routing)

```bash
python -m attrition.scanner . --json scan-report.json
```

If the SDK isn't installed:
```bash
pip install attrition
```

### Phase 2: Present findings to user
Show the scan report as a concise summary:
- "Found N LLM call sites across M files"
- "Providers: Anthropic (Sonnet 4.6), OpenAI (GPT-4o)"
- "Architecture: single-model with tool use"
- "Recommended: add Haiku as executor, keep Sonnet as advisor"

### Phase 3: Propose integration plan
Based on the scan, generate a specific plan:

**For single-model codebases:**
1. Add a cheaper model (executor) for routine tasks
2. Keep existing model as advisor for complex reasoning
3. Add escalation triggers (failure detection, confidence threshold)
4. Wire up attrition tracking

**For multi-model codebases:**
1. Identify which model is executor (cheaper) and which is advisor (expensive)
2. Add attrition.advisor.AdvisorTracker to the main LLM call file
3. Tag existing calls: executor vs advisor
4. Add escalation detection at existing failure/retry points

**For Claude Code / Cursor users:**
1. Install the attrition Claude plugin
2. The SubagentStop hook auto-detects Opus advisor calls
3. Session tracking is automatic via plugin hooks
4. View results at attrition.sh/advisor

### Phase 4: Implement (with user approval)
For each recommended integration point:
1. Show the exact code change
2. Explain what it tracks
3. Apply after user confirms

Example for Anthropic:
```python
from attrition.advisor import AdvisorTracker

tracker = AdvisorTracker(
    executor_model="claude-sonnet-4-6",
    advisor_model="claude-opus-4-6",
)

# In your executor path:
response = client.messages.create(model="claude-sonnet-4-6", ...)
tracker.log_executor_call(
    input_tokens=response.usage.input_tokens,
    output_tokens=response.usage.output_tokens,
    tool=current_tool_name,
)

# In your advisor/escalation path:
response = client.messages.create(model="claude-opus-4-6", ...)
tracker.log_advisor_call(
    trigger="executor_failure",
    input_tokens=response.usage.input_tokens,
    output_tokens=response.usage.output_tokens,
    advice_type="diagnosis",
    advice_summary=response.content[0].text[:200],
)

# At session end:
tracker.end_session(task_completed=True, user_corrections=0)
```

Example for OpenAI:
```python
from attrition.advisor import AdvisorTracker

tracker = AdvisorTracker(
    executor_model="gpt-4o-mini",
    advisor_model="gpt-4o",
)

# In your executor path:
response = client.chat.completions.create(model="gpt-4o-mini", ...)
tracker.log_executor_call(
    input_tokens=response.usage.prompt_tokens,
    output_tokens=response.usage.completion_tokens,
)

# In your escalation path:
response = client.chat.completions.create(model="gpt-4o", ...)
tracker.log_advisor_call(
    trigger="complexity_threshold",
    input_tokens=response.usage.prompt_tokens,
    output_tokens=response.usage.completion_tokens,
    advice_type="architecture",
)
```

Example for LangChain:
```python
from attrition.advisor import AdvisorTracker

tracker = AdvisorTracker(
    executor_model="claude-sonnet-4-6",
    advisor_model="claude-opus-4-6",
)

# Wrap your chain callbacks
class AdvisorCallback(BaseCallbackHandler):
    def on_llm_end(self, response, **kwargs):
        model = kwargs.get("invocation_params", {}).get("model", "")
        usage = response.llm_output.get("usage", {})
        if "opus" in model:
            tracker.log_advisor_call(
                trigger="chain_step",
                input_tokens=usage.get("input_tokens", 0),
                output_tokens=usage.get("output_tokens", 0),
            )
        else:
            tracker.log_executor_call(
                input_tokens=usage.get("input_tokens", 0),
                output_tokens=usage.get("output_tokens", 0),
            )
```

### Phase 5: Verify
After integration:
1. Run a test query through the user's system
2. Check attrition.sh/advisor for real cost data
3. Verify executor vs advisor split appears correctly
4. Show the user their first measured cost breakdown

## Key Principle
The scanner does the context gathering. Claude Code does the implementation. The user approves each change. attrition.sh shows the results. Zero manual configuration.
