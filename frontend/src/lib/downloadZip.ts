/**
 * Client-side ZIP export. Uses `fflate` (~10KB gzipped) — tiny enough
 * that adding it doesn't meaningfully balloon the bundle.
 *
 * Takes an array of {path, content, language?} and produces a Blob the
 * browser downloads as a `.zip` file.
 *
 * Also injects `.attrition/provenance.json` into every bundle so the
 * scaffold can phone home (opt-in) from the user's laptop to tick the
 * 60-min NextSteps checklist.
 *
 * Usage:
 *   import { downloadBundleAsZip } from "@/lib/downloadZip";
 *   await downloadBundleAsZip("my-scaffold", files, { slug, runtime, model });
 */

import { zipSync, strToU8 } from "fflate";

export type ZipFile = {
  path: string;
  content: string;
  language?: string;
};

export type ProvenanceInput = {
  slug: string | null | undefined;
  runtimeLane?: string;
  worldModelLane?: string;
  intentLane?: string;
  driverRuntime?: string;
  driverModel?: string;
  pingEndpoint?: string; // default: production webhook
};

/** Build the provenance record embedded in the ZIP. */
export function buildProvenance(input: ProvenanceInput): Record<string, unknown> {
  return {
    schema: "attrition.provenance/v1",
    generated_at: new Date().toISOString(),
    generator: "attrition.sh Builder",
    session_slug: input.slug ?? null,
    runtime_lane: input.runtimeLane ?? null,
    world_model_lane: input.worldModelLane ?? null,
    intent_lane: input.intentLane ?? null,
    driver_runtime: input.driverRuntime ?? null,
    driver_model: input.driverModel ?? null,
    // Webhook endpoint scaffold can ping on milestones (opt-in via
    // ATTRITION_TELEMETRY=1 env var in the emitted run.sh).
    ping_endpoint:
      input.pingEndpoint ??
      "https://joyous-walrus-428.convex.cloud/http/attritionPing",
    // Events the scaffold should ping when they happen. Each is optional
    // and no-ops if the env var is unset. This lets the 60-min
    // NextSteps page tick off checkboxes in real time.
    events: [
      "downloaded", // marked by the Builder at download time
      "mock_exec_pass",
      "live_smoke_pass",
      "first_prod_request",
    ],
  };
}

/**
 * Shape of the post-download README snippet that tells the user about
 * the provenance file + how to opt in/out of telemetry. Returned so the
 * Builder can surface it in a confirmation modal and/or append it to
 * the emitted README.
 */
export const PROVENANCE_README_NOTE = `## .attrition/provenance.json

This scaffold ships with a provenance record at
\`.attrition/provenance.json\`. It contains:

- Which lane + driver runtime + model generated your scaffold
- A session slug that links back to your Builder session
- A webhook URL the scaffold **optionally** pings on milestones

To opt IN to telemetry (recommended — it ticks off the NextSteps
checklist in the browser so you can watch your scaffold go live):

    export ATTRITION_TELEMETRY=1
    ./run.sh --mock

To opt OUT (default):

    ./run.sh --mock   # no pings

The webhook only sees \`{event, provenance_id, timestamp}\` — no prompts,
no code, no credentials. You can audit the exact payload in
\`connectors/_telemetry.py\` before running.
`;

export function buildZipBlob(
  bundleName: string,
  files: ZipFile[],
  provenance?: ProvenanceInput,
): Blob {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    const normPath = f.path.replace(/^[/\\]+/, "");
    entries[`${bundleName}/${normPath}`] = strToU8(f.content);
  }
  if (provenance) {
    const prov = buildProvenance(provenance);
    entries[`${bundleName}/.attrition/provenance.json`] = strToU8(
      JSON.stringify(prov, null, 2),
    );
    entries[`${bundleName}/.attrition/README.md`] = strToU8(PROVENANCE_README_NOTE);
  }
  const zipped = zipSync(entries, { level: 6 });
  // TS 5.7+ narrows Uint8Array generics; Blob's constructor types still
  // expect ArrayBuffer-backed. fflate always returns ArrayBuffer-backed
  // arrays, so the cast is sound.
  return new Blob([zipped as unknown as BlobPart], {
    type: "application/zip",
  });
}

export async function downloadBundleAsZip(
  bundleName: string,
  files: ZipFile[],
  provenance?: ProvenanceInput,
): Promise<void> {
  const blob = buildZipBlob(bundleName, files, provenance);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bundleName}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Defer revocation so the browser finishes the download
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
