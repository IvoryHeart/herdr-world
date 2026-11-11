import { createHash } from "node:crypto";

/**
 * World's own labels on core terminals (`herdr-world.` namespace). Labels
 * are display data, never provenance: each is checked against what core
 * says about the terminal now before World shows it.
 *
 * - `herdr-world.summary`: a task summary (M6), written by the standalone
 *   `herdr-world task-summary` inside the terminal, bound to the program
 *   occupying it and to an absolute expiry.
 * - `herdr-world.spawned-by`: a spawn stamp (M7), the address of the
 *   terminal whose agent started this one. A display relation only: it
 *   never makes a native parent, so a kill never follows it.
 */
export const CORE_SUMMARY_LABEL = "herdr-world.summary";
export const CORE_SPAWNED_BY_LABEL = "herdr-world.spawned-by";

const ADDRESS = /^t[1-9][0-9]{0,9}$/;

type Occupied = { address: string; pid?: unknown; argv?: unknown };

/**
 * The program in a terminal: core's identity, the address, its pid and its
 * command line. A kept terminal whose program is lost gets a shell at the
 * same address with a new pid and the shell's argv, so the print changes.
 */
export function coreOccupantFingerprint(
  coreId: string,
  record: Occupied,
): string | null {
  if (typeof record.pid !== "number" || !Array.isArray(record.argv))
    return null;
  return createHash("sha256")
    .update(JSON.stringify([coreId, record.address, record.pid, record.argv]))
    .digest("hex");
}

export function encodeCoreSummary(summary: {
  text: string;
  fingerprint: string;
  expiresMs: number;
}): string {
  return JSON.stringify({
    v: 1,
    text: summary.text,
    fp: summary.fingerprint,
    exp: summary.expiresMs,
  });
}

/**
 * The summary a terminal's current program reported, or null when it was
 * written for another program, has expired or is malformed.
 */
export function coreSummaryOf(
  coreId: string,
  record: Occupied & { labels?: Record<string, string> },
  now: number,
): { text: string; expiresMs: number } | null {
  const raw = record.labels?.[CORE_SUMMARY_LABEL];
  if (typeof raw !== "string" || raw.length > 1024) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { v, text, fp, exp } = value as Record<string, unknown>;
  if (
    v !== 1 ||
    typeof text !== "string" ||
    !text.trim() ||
    typeof fp !== "string" ||
    typeof exp !== "number" ||
    !Number.isSafeInteger(exp) ||
    exp <= now
  )
    return null;
  if (fp !== coreOccupantFingerprint(coreId, record)) return null;
  return { text: text.trim().slice(0, 160), expiresMs: exp };
}

/** The terminal a spawn stamp names, if it is a local address. */
export function coreSpawnedBy(record: {
  labels?: Record<string, string>;
}): string | null {
  const value = record.labels?.[CORE_SPAWNED_BY_LABEL];
  return typeof value === "string" && ADDRESS.test(value) ? value : null;
}
