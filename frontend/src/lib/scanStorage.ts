// --------------------------------------------------------------------------
// Scan result storage — shareable URLs + history + correction learning
// --------------------------------------------------------------------------

const STORAGE_KEY = "bp_scan_history";
const MAX_SCANS = 20;

export interface ScanRecord {
  id: string;
  url: string;
  score: number;
  issues: { severity: string; title: string; description: string }[];
  dimensions: Record<string, number>;
  durationMs: number;
  timestamp: string;
}

function readAll(): ScanRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ScanRecord[];
  } catch {
    return [];
  }
}

function writeAll(records: ScanRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

/** Save a scan result. Caps history at MAX_SCANS. */
export function saveScanResult(record: ScanRecord): void {
  const all = readAll();
  const idx = all.findIndex((r) => r.id === record.id);
  if (idx >= 0) {
    all[idx] = record;
  } else {
    all.unshift(record);
  }
  writeAll(all.slice(0, MAX_SCANS));
}

/** Get a single scan result by ID. */
export function getScanResult(id: string): ScanRecord | null {
  return readAll().find((r) => r.id === id) ?? null;
}

/** List all scan history, sorted by date descending. */
export function listScanHistory(): ScanRecord[] {
  return readAll().sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

/** Check if a URL was previously scanned. Returns most recent scan or null. */
export function getScanByUrl(url: string): ScanRecord | null {
  const normalized = url.replace(/\/+$/, "").toLowerCase();
  return (
    readAll().find(
      (r) => r.url.replace(/\/+$/, "").toLowerCase() === normalized,
    ) ?? null
  );
}
