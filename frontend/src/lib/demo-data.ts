// --------------------------------------------------------------------------
// Demo data for attrition workflow distillation UI
// Auto-seeds into localStorage on first visit if empty.
// --------------------------------------------------------------------------

export type EventType = "Think" | "ToolCall" | "FileEdit" | "Search" | "Decision" | "Assert";

export interface CanonicalEvent {
  id: string;
  type: EventType;
  summary: string;
  tokens: number;
  durationMs: number;
  /** true if this event is a checkpoint boundary */
  checkpoint?: boolean;
  /** true if this event was eliminated during distillation */
  eliminated?: boolean;
  /** copy block content (for FileEdit / ToolCall) */
  content?: string;
}

export interface Workflow {
  id: string;
  name: string;
  sourceModel: string;
  events: CanonicalEvent[];
  capturedAt: string;
  compression?: number;
  distilledEvents?: CanonicalEvent[];
}

export type Verdict = "Correct" | "Partial" | "Escalate" | "Failed";
export type DivergenceSeverity = "Minor" | "Major" | "Critical";

export interface Divergence {
  id: string;
  eventIndex: number;
  severity: DivergenceSeverity;
  expected: string;
  actual: string;
  suggestion: string;
}

export interface Nudge {
  id: string;
  divergenceId: string;
  message: string;
  status: "sent" | "accepted" | "rejected";
  timestamp: string;
}

export interface JudgeSession {
  id: string;
  workflowId: string;
  workflowName: string;
  replayModel: string;
  progress: number;
  totalEvents: number;
  verdict: Verdict;
  divergences: Divergence[];
  nudges: Nudge[];
  startedAt: string;
  /** per-event status for attention heatmap */
  eventStatuses: Array<"Followed" | "Skipped" | "Diverged">;
}

export interface ModelComparison {
  id: string;
  workflowName: string;
  modelA: { name: string; tokens: number; cost: number; durationMs: number; judgeScore: number; events: CanonicalEvent[] };
  modelB: { name: string; tokens: number; cost: number; durationMs: number; judgeScore: number; events: CanonicalEvent[] };
  createdAt: string;
}

// --------------------------------------------------------------------------
// Storage keys
// --------------------------------------------------------------------------

const KEYS = {
  workflows: "bp_workflows",
  distilled: "bp_distilled",
  judge: "bp_judge_sessions",
  comparisons: "bp_comparisons",
  seeded: "bp_demo_seeded",
} as const;

// --------------------------------------------------------------------------
// Event generators
// --------------------------------------------------------------------------

let _eid = 0;
function eid(): string {
  return `evt_${++_eid}_${Date.now().toString(36)}`;
}

function makeEvent(type: EventType, summary: string, tokens: number, durationMs: number, extra?: Partial<CanonicalEvent>): CanonicalEvent {
  return { id: eid(), type, summary, tokens, durationMs, ...extra };
}

// --------------------------------------------------------------------------
// Demo workflow: Opus refactoring session
// --------------------------------------------------------------------------

function opusRefactorWorkflow(): Workflow {
  const events: CanonicalEvent[] = [
    makeEvent("Think", "Analyze codebase structure and identify refactoring targets", 1200, 3400),
    makeEvent("Search", "Grep for deprecated API usage across src/", 180, 820),
    makeEvent("Think", "Plan migration strategy: batch rename + update imports", 890, 2100),
    makeEvent("ToolCall", "Read src/lib/legacy-client.ts", 340, 450, { content: "const client = new LegacyClient({...})" }),
    makeEvent("Decision", "Replace LegacyClient with HttpClient - breaking change acceptable", 420, 1800),
    makeEvent("FileEdit", "Rewrite src/lib/legacy-client.ts -> src/lib/http-client.ts", 1650, 4200, { checkpoint: true, content: "export class HttpClient {\n  constructor(private config: ClientConfig) {}\n  async request<T>(path: string): Promise<T> {...}\n}" }),
    makeEvent("Search", "Find all imports of legacy-client across 14 files", 220, 670),
    makeEvent("Think", "Batch update strategy: sed-style replacement with validation", 560, 1400),
    makeEvent("FileEdit", "Update 14 import statements to use http-client", 2800, 5600, { content: "import { HttpClient } from '../lib/http-client'" }),
    makeEvent("ToolCall", "Run TypeScript compiler: npx tsc --noEmit", 90, 12000),
    makeEvent("Think", "Compiler found 3 type errors in test files - fix signatures", 340, 900),
    makeEvent("FileEdit", "Fix test mocks to use HttpClient interface", 780, 2200, { checkpoint: true }),
    makeEvent("ToolCall", "Run test suite: npx vitest run", 120, 8400),
    makeEvent("Assert", "All 47 tests pass. No regressions.", 60, 200),
    makeEvent("Think", "Refactoring complete. Summary: 15 files changed, 0 regressions.", 280, 600),
    makeEvent("FileEdit", "Update CHANGELOG.md with migration notes", 420, 1100),
    makeEvent("ToolCall", "git add -A && git commit -m 'refactor: migrate to HttpClient'", 80, 3200, { checkpoint: true }),
  ];
  return {
    id: "wf_opus_refactor_01",
    name: "Legacy Client Refactor",
    sourceModel: "opus-4-6",
    events,
    capturedAt: "2026-04-05T14:23:00Z",
  };
}

// --------------------------------------------------------------------------
// Demo workflow: Sonnet feature build
// --------------------------------------------------------------------------

function sonnetFeatureWorkflow(): Workflow {
  const events: CanonicalEvent[] = [
    makeEvent("Think", "Parse user request: add dark mode toggle to settings page", 680, 1800),
    makeEvent("Search", "Find existing theme configuration and CSS variables", 150, 540),
    makeEvent("ToolCall", "Read src/styles/theme.css", 200, 380, { content: ":root { --bg-primary: #fff; }" }),
    makeEvent("Think", "Design approach: CSS custom properties + localStorage persistence", 440, 1200),
    makeEvent("FileEdit", "Add dark theme variables to theme.css", 920, 2800, { checkpoint: true, content: "[data-theme='dark'] {\n  --bg-primary: #0a0a0b;\n  --text-primary: #e8e6e3;\n}" }),
    makeEvent("FileEdit", "Create ThemeToggle component", 1100, 3400, { content: "export function ThemeToggle() {\n  const [dark, setDark] = useState(false);\n  ...toggle logic...\n}" }),
    makeEvent("FileEdit", "Wire ThemeToggle into Settings page", 580, 1600),
    makeEvent("ToolCall", "Run dev server and verify visually", 60, 4200),
    makeEvent("Think", "Looks correct. Check accessibility contrast ratios.", 320, 800),
    makeEvent("Search", "Verify WCAG AA contrast for dark mode text colors", 180, 620),
    makeEvent("FileEdit", "Adjust --text-secondary for better contrast in dark mode", 340, 900, { checkpoint: true }),
    makeEvent("ToolCall", "Run tests: npx vitest run", 90, 6800),
    makeEvent("Assert", "22 tests pass. Visual regression test added.", 50, 180),
    makeEvent("ToolCall", "git commit -m 'feat: add dark mode toggle'", 70, 2400, { checkpoint: true }),
  ];
  return {
    id: "wf_sonnet_darkmode_01",
    name: "Dark Mode Toggle",
    sourceModel: "sonnet-4-6",
    events,
    capturedAt: "2026-04-06T09:41:00Z",
  };
}

// --------------------------------------------------------------------------
// Demo workflow: Mythos research session
// --------------------------------------------------------------------------

function mythosResearchWorkflow(): Workflow {
  const events: CanonicalEvent[] = [
    makeEvent("Think", "Analyze research question: competitive landscape for AI code review tools", 1400, 4200),
    makeEvent("Search", "Web search: AI code review tools 2026 comparison", 280, 2800),
    makeEvent("Think", "Identify 8 competitors from search results. Categorize by approach.", 960, 2600),
    makeEvent("Search", "Search for pricing pages: CodeRabbit, Sourcery, Codium, Qodo", 320, 3400),
    makeEvent("Think", "Extract pricing tiers and feature matrices", 780, 2000),
    makeEvent("Decision", "Focus deep-dive on top 3 by market share: CodeRabbit, Sourcery, Qodo", 540, 1800, { checkpoint: true }),
    makeEvent("Search", "G2/Capterra reviews for CodeRabbit", 240, 2200),
    makeEvent("Search", "G2/Capterra reviews for Sourcery", 220, 2100),
    makeEvent("Search", "G2/Capterra reviews for Qodo", 230, 2000),
    makeEvent("Think", "Synthesize: common complaints are false positives, slow PR review, poor monorepo support", 1100, 3200),
    makeEvent("FileEdit", "Write competitive-analysis.md with findings", 2400, 5800, { checkpoint: true, content: "# Competitive Analysis: AI Code Review\n\n## Market Map\n..." }),
    makeEvent("Think", "Identify differentiation opportunity: workflow-aware review (not just file-level)", 680, 1600),
    makeEvent("FileEdit", "Add positioning recommendations to analysis", 1200, 3000),
    makeEvent("Assert", "Analysis covers 8 competitors, 3 deep-dives, pricing, positioning recs", 120, 400),
    makeEvent("ToolCall", "git commit -m 'docs: competitive analysis for AI code review'", 80, 2600, { checkpoint: true }),
    makeEvent("Think", "Research complete. Key insight: no tool does workflow-level review yet.", 320, 700),
  ];
  return {
    id: "wf_mythos_research_01",
    name: "Competitive Analysis Research",
    sourceModel: "mythos-preview",
    events,
    capturedAt: "2026-04-04T16:08:00Z",
  };
}

// --------------------------------------------------------------------------
// Distilled version of the opus workflow
// --------------------------------------------------------------------------

function distilledOpusWorkflow(): { workflow: Workflow; distilled: Workflow } {
  const original = opusRefactorWorkflow();
  const distilledEvents = original.events.map((e, i) => {
    // Eliminate redundant Think steps and verbose Search steps
    const eliminated = [0, 2, 7, 10, 14].includes(i);
    return { ...e, eliminated };
  });
  const kept = distilledEvents.filter(e => !e.eliminated);
  const originalTokens = original.events.reduce((s, e) => s + e.tokens, 0);
  const keptTokens = kept.reduce((s, e) => s + e.tokens, 0);

  return {
    workflow: original,
    distilled: {
      ...original,
      id: "wf_opus_refactor_01_distilled",
      compression: Math.round((1 - keptTokens / originalTokens) * 100) / 100,
      distilledEvents,
    },
  };
}

// --------------------------------------------------------------------------
// Demo judge session
// --------------------------------------------------------------------------

function demoJudgeSession(): JudgeSession {
  const wf = opusRefactorWorkflow();
  const eventStatuses: JudgeSession["eventStatuses"] = wf.events.map((_, i) => {
    if (i === 4) return "Diverged";   // Decision step diverged
    if (i === 10) return "Diverged";  // Think step diverged
    if (i === 7) return "Skipped";    // Batch strategy skipped
    return "Followed";
  });

  return {
    id: "js_opus_replay_01",
    workflowId: wf.id,
    workflowName: wf.name,
    replayModel: "sonnet-4-6",
    progress: 15,
    totalEvents: wf.events.length,
    verdict: "Partial",
    divergences: [
      {
        id: "div_01",
        eventIndex: 4,
        severity: "Major",
        expected: "Replace LegacyClient with HttpClient - breaking change acceptable",
        actual: "Wrapped LegacyClient with adapter pattern instead of replacing",
        suggestion: "The canonical workflow chose direct replacement for cleaner code. Consider: is the adapter adding unnecessary complexity?",
      },
      {
        id: "div_02",
        eventIndex: 10,
        severity: "Minor",
        expected: "Compiler found 3 type errors in test files - fix signatures",
        actual: "Compiler found 2 type errors - one was already fixed by adapter approach",
        suggestion: "Fewer type errors is acceptable. The adapter approach avoided one breakage.",
      },
    ],
    nudges: [
      {
        id: "nudge_01",
        divergenceId: "div_01",
        message: "The canonical workflow recommends direct replacement over adapter pattern. This reduces long-term maintenance. Would you like to switch approach?",
        status: "sent",
        timestamp: "2026-04-06T11:22:00Z",
      },
      {
        id: "nudge_02",
        divergenceId: "div_02",
        message: "Minor divergence noted. The adapter approach is valid but differs from canonical path.",
        status: "accepted",
        timestamp: "2026-04-06T11:24:00Z",
      },
    ],
    eventStatuses,
    startedAt: "2026-04-06T11:15:00Z",
  };
}

// --------------------------------------------------------------------------
// Demo model comparison
// --------------------------------------------------------------------------

function demoComparison(): ModelComparison {
  const wf = opusRefactorWorkflow();
  // Sonnet version: same workflow but fewer Think tokens, slight divergences
  const sonnetEvents: CanonicalEvent[] = wf.events.map((e) => {
    if (e.type === "Think") {
      return { ...e, id: eid(), tokens: Math.round(e.tokens * 0.6), durationMs: Math.round(e.durationMs * 0.7) };
    }
    if (e.type === "Search") {
      return { ...e, id: eid(), tokens: Math.round(e.tokens * 0.8), durationMs: Math.round(e.durationMs * 0.9) };
    }
    return { ...e, id: eid() };
  });

  const opusTokens = wf.events.reduce((s, e) => s + e.tokens, 0);
  const sonnetTokens = sonnetEvents.reduce((s, e) => s + e.tokens, 0);

  return {
    id: "cmp_opus_vs_sonnet_01",
    workflowName: wf.name,
    modelA: {
      name: "opus-4-6",
      tokens: opusTokens,
      cost: Math.round(opusTokens * 0.015) / 100,
      durationMs: wf.events.reduce((s, e) => s + e.durationMs, 0),
      judgeScore: 98,
      events: wf.events,
    },
    modelB: {
      name: "sonnet-4-6",
      tokens: sonnetTokens,
      cost: Math.round(sonnetTokens * 0.003) / 100,
      durationMs: sonnetEvents.reduce((s, e) => s + e.durationMs, 0),
      judgeScore: 91,
      events: sonnetEvents,
    },
    createdAt: "2026-04-06T15:30:00Z",
  };
}

// --------------------------------------------------------------------------
// Seed into localStorage
// --------------------------------------------------------------------------

export function seedDemoData(): void {
  if (localStorage.getItem(KEYS.seeded)) return;

  const workflows = [opusRefactorWorkflow(), sonnetFeatureWorkflow(), mythosResearchWorkflow()];
  localStorage.setItem(KEYS.workflows, JSON.stringify(workflows));

  const { distilled } = distilledOpusWorkflow();
  localStorage.setItem(`${KEYS.distilled}_${distilled.id.replace("_distilled", "")}`, JSON.stringify(distilled));

  const judgeSession = demoJudgeSession();
  localStorage.setItem(KEYS.judge, JSON.stringify([judgeSession]));

  const comparison = demoComparison();
  localStorage.setItem(KEYS.comparisons, JSON.stringify([comparison]));

  localStorage.setItem(KEYS.seeded, "true");
}

// --------------------------------------------------------------------------
// Readers
// --------------------------------------------------------------------------

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getWorkflows(): Workflow[] {
  return readJSON<Workflow[]>(KEYS.workflows, []);
}

export function getWorkflow(id: string): Workflow | null {
  return getWorkflows().find(w => w.id === id) ?? null;
}

export function getDistilledWorkflow(workflowId: string): Workflow | null {
  return readJSON<Workflow | null>(`${KEYS.distilled}_${workflowId}`, null);
}

export function getJudgeSessions(): JudgeSession[] {
  return readJSON<JudgeSession[]>(KEYS.judge, []);
}

export function getJudgeSession(id: string): JudgeSession | null {
  return getJudgeSessions().find(s => s.id === id) ?? null;
}

export function getComparisons(): ModelComparison[] {
  return readJSON<ModelComparison[]>(KEYS.comparisons, []);
}

export function getComparison(id: string): ModelComparison | null {
  return getComparisons().find(c => c.id === id) ?? null;
}

export function deleteWorkflow(id: string): void {
  const workflows = getWorkflows().filter(w => w.id !== id);
  localStorage.setItem(KEYS.workflows, JSON.stringify(workflows));
}
