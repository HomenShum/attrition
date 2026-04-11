import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import {
  listScanHistory,
  getScanByUrl,
  saveScanResult,
} from "../lib/scanStorage";

/* ── Types ────────────────────────────────────────────────────── */

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "tool";
  content: string;
  timestamp: string;
  toolName?: string;
  toolStatus?: "running" | "complete" | "error";
}

interface ChatState {
  messages: ChatMessage[];
  isOpen: boolean;
  isProcessing: boolean;
}

interface ChatContextValue extends ChatState {
  sendMessage: (text: string) => Promise<void> | void;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  /** Inject a pre-built conversation (for "Open in chat" flows) */
  injectConversation: (msgs: ChatMessage[]) => void;
}

/* ── Helpers ───────────────────────────────────────────────────── */

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `msg_${Date.now()}_${_idCounter}`;
}

function now(): string {
  return new Date().toISOString();
}

/* ── Real API scan (zero artificial delays) ──────────────────── */

async function realScan(url: string): Promise<ChatMessage[]> {
  const msgs: ChatMessage[] = [];

  // Check if previously scanned
  const previous = getScanByUrl(url);
  if (previous) {
    msgs.push({
      id: nextId(), role: "agent",
      content: `Previously scanned: score ${previous.score}. Running again...`,
      timestamp: now(),
    });
  }

  // Show scanning tool card immediately
  const scanningMsg: ChatMessage = {
    id: nextId(), role: "tool", content: `Scanning ${url}...`,
    timestamp: now(), toolName: "bp.check", toolStatus: "running",
  };
  msgs.push(scanningMsg);

  try {
    // Set up a 2s slow warning
    let slowResolved = false;
    const slowMsgs: ChatMessage[] = [];
    const slowTimer = setTimeout(() => {
      if (!slowResolved) {
        slowMsgs.push({
          id: nextId(), role: "tool",
          content: "Still working...",
          timestamp: now(), toolName: "bp.check", toolStatus: "running",
        });
      }
    }, 2000);

    const resp = await fetch("/api/qa/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    slowResolved = true;
    clearTimeout(slowTimer);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    const score = data.score ?? 0;
    const issues = data.issues ?? [];
    const ms = data.duration_ms ?? 0;
    const dims = data.dimensions ?? {};

    // Save to scan history
    const id = data.id || crypto.randomUUID();
    saveScanResult({
      id,
      url: data.url || url,
      score,
      issues,
      dimensions: dims,
      durationMs: ms,
      timestamp: data.timestamp || now(),
    });

    const findingsLines = [`Score: **${score}/100** in ${ms}ms`];
    if (issues.length > 0) {
      findingsLines.push("", "Findings:");
      for (const iss of issues) {
        findingsLines.push(`  [${iss.severity}] ${iss.title}`);
      }
    } else {
      findingsLines.push("", "No issues found. Clean report.");
    }

    const dimEntries = Object.entries(dims);
    if (dimEntries.length > 0) {
      findingsLines.push("", "Dimensions:");
      for (const [k, v] of dimEntries) {
        const label = k.replace(/_/g, " ");
        findingsLines.push(`  ${label}: ${v}/100`);
      }
    }

    // Add any slow warning messages that may have been created
    msgs.push(...slowMsgs);

    msgs.push({
      id: nextId(), role: "tool",
      content: findingsLines.join("\n"),
      timestamp: now(), toolName: "bp.check", toolStatus: "complete",
    });

    // Agent summary
    const summaryLines = [`Scan complete for **${url}**.`, ""];
    if (issues.length === 0) {
      summaryLines.push(`Score: **${score}/100** — no issues found. The site passes all checks.`);
    } else {
      summaryLines.push(`Score: **${score}/100** — found ${issues.length} issue${issues.length > 1 ? "s" : ""}:`);
      for (const iss of issues) {
        summaryLines.push(`- **${iss.severity}**: ${iss.title}${iss.description ? " — " + iss.description : ""}`);
      }
    }
    summaryLines.push("", `Share this result: /scan/${id}`);

    msgs.push({ id: nextId(), role: "agent", content: summaryLines.join("\n"), timestamp: now() });
    return msgs;
  } catch {
    msgs.push({
      id: nextId(), role: "tool",
      content: "API call failed — server may be starting up.",
      timestamp: now(), toolName: "bp.check", toolStatus: "error",
    });
    msgs.push({
      id: nextId(), role: "agent",
      content: `Could not reach the attrition API for ${url}. The server may be cold-starting (takes ~5s on first request). Try again, or run locally with \`bp serve\`.`,
      timestamp: now(),
    });
    return msgs;
  }
}

async function realStatus(): Promise<ChatMessage[]> {
  try {
    const resp = await fetch("/health");
    const data = await resp.json();
    return [
      {
        id: nextId(), role: "tool",
        content: [
          `Server: ${data.status} (v${data.version})`,
          `Uptime: ${data.uptime_secs}s`,
          `Requests served: ${data.requests_served}`,
          `6 MCP tools registered (bp.check, bp.capture, bp.distill, bp.judge.start, bp.judge.event, bp.judge.verdict)`,
        ].join("\n"),
        timestamp: now(), toolName: "bp.status", toolStatus: "complete",
      },
      {
        id: nextId(), role: "agent",
        content: "Server is online. Visit /live for the real-time dashboard.",
        timestamp: now(),
      },
    ];
  } catch {
    return [
      { id: nextId(), role: "agent", content: "Cannot reach the attrition server. Run `bp serve` locally or check /live for status.", timestamp: now() },
    ];
  }
}

function historyResponse(): ChatMessage[] {
  const scans = listScanHistory();
  if (scans.length === 0) {
    return [{
      id: nextId(), role: "agent", timestamp: now(),
      content: "No scan history yet. Try: `scan https://example.com`",
    }];
  }

  const lines = [`**Scan history** (${scans.length} scan${scans.length !== 1 ? "s" : ""}):`, ""];
  for (const s of scans.slice(0, 10)) {
    const date = new Date(s.timestamp).toLocaleDateString();
    lines.push(`- **${s.url}** — score ${s.score} (${date})`);
  }
  if (scans.length > 10) {
    lines.push(``, `...and ${scans.length - 10} more`);
  }

  return [{
    id: nextId(), role: "agent", timestamp: now(),
    content: lines.join("\n"),
  }];
}

function staticMissedSteps(): ChatMessage[] {
  return [
    {
      id: nextId(), role: "tool",
      content: [
        `Workflow: API Client Refactor (from proof page)`,
        `Steps: 8 total, 5 completed`,
        ``,
        `Missing steps:`,
        `  x Search for breaking changes in dependent packages`,
        `  x Update generated types`,
        `  x Run integration tests (only unit tests ran)`,
      ].join("\n"),
      timestamp: now(), toolName: "bp.judge", toolStatus: "complete",
    },
    {
      id: nextId(), role: "agent",
      content: "The agent missed 3 of 8 required steps. This triggers an **ESCALATE** verdict — the agent should not have stopped. See /proof for the full pain -> fix breakdown.",
      timestamp: now(),
    },
  ];
}

function helpResponse(): ChatMessage[] {
  return [{
    id: nextId(), role: "agent", timestamp: now(),
    content: [
      "**Commands:**",
      "",
      "`scan <url>` — Run a real QA check via the live API",
      "`check <url>` — Same as scan",
      "`history` — Show all past scans",
      "`show status` — Check server health",
      "`what did the agent miss?` — Show missing workflow steps",
      "`help` — This message",
      "",
      "Example: `scan nodebenchai.com`",
    ].join("\n"),
  }];
}

function genericResponse(): ChatMessage[] {
  return [{
    id: nextId(), role: "agent", timestamp: now(),
    content: 'I can scan URLs, show what agents missed, or check hook status. Try: `scan https://example.com` or `history`',
  }];
}

/* ── Command router (async — calls real API, ZERO delays) ────── */

async function routeCommand(text: string): Promise<ChatMessage[]> {
  const lower = text.toLowerCase().trim();

  const scanMatch = lower.match(/^(?:scan|check)\s+(.+)/);
  if (scanMatch) {
    let url = scanMatch[1].trim();
    if (!url.startsWith("http")) url = `https://${url}`;
    return realScan(url);
  }

  if (lower === "history") return historyResponse();
  if (lower.includes("status")) return realStatus();
  if (lower.includes("miss") || lower.includes("skip")) return staticMissedSteps();
  if (lower === "help" || lower === "?") return helpResponse();

  return genericResponse();
}

/* ── Context ──────────────────────────────────────────────────── */

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    isOpen: false,
    isProcessing: false,
  });

  // On first open, show scan history context if available
  const [historyShown, setHistoryShown] = useState(false);

  useEffect(() => {
    if (state.isOpen && !historyShown) {
      setHistoryShown(true);
      const scans = listScanHistory();
      if (scans.length > 0) {
        const most = scans[0];
        const systemMsg: ChatMessage = {
          id: nextId(),
          role: "agent",
          content: `You've scanned ${scans.length} site${scans.length !== 1 ? "s" : ""}. Most recent: ${most.url} (score: ${most.score}).`,
          timestamp: now(),
        };
        setState((s) => ({
          ...s,
          messages: [...s.messages, systemMsg],
        }));
      }
    }
  }, [state.isOpen, historyShown]);

  const togglePanel = useCallback(() => {
    setState((s) => ({ ...s, isOpen: !s.isOpen }));
  }, []);

  const openPanel = useCallback(() => {
    setState((s) => ({ ...s, isOpen: true }));
  }, []);

  const closePanel = useCallback(() => {
    setState((s) => ({ ...s, isOpen: false }));
  }, []);

  const injectConversation = useCallback((msgs: ChatMessage[]) => {
    setState((s) => ({
      ...s,
      messages: [...s.messages, ...msgs],
      isOpen: true,
    }));
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: ChatMessage = {
      id: nextId(),
      role: "user",
      content: text,
      timestamp: now(),
    };

    // Show user message immediately
    setState((s) => ({
      ...s,
      messages: [...s.messages, userMsg],
      isProcessing: true,
    }));

    // Await real API response — zero artificial delays
    const responses = await routeCommand(text);

    // Show all responses immediately
    setState((s) => ({
      ...s,
      messages: [...s.messages, ...responses],
      isProcessing: false,
    }));
  }, []);

  return (
    <ChatContext.Provider
      value={{
        ...state,
        sendMessage,
        togglePanel,
        openPanel,
        closePanel,
        injectConversation,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
