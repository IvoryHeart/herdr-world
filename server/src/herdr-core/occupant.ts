import { createHash } from "node:crypto";

/**
 * The observed program at one core address: native identity plus the mirror's
 * occupancy token. A restarted event retires it even with identical pid/argv.
 * This evidence belongs to one connection generation; reconnects do not prove
 * asker continuity and therefore leave saved answers available through ask get.
 */
export function coreOccupantFingerprint(
  coreId: string,
  record: {
    address: string;
    pid?: unknown;
    argv?: unknown;
    template?: unknown;
  },
  occupancy = 1,
): string | null {
  if (typeof record.pid !== "number" || !Number.isSafeInteger(record.pid))
    return null;
  return createHash("sha256")
    .update(
      JSON.stringify([
        "herdr-core-occupant-v1",
        coreId,
        occupancy,
        record.address,
        record.pid,
        Array.isArray(record.argv) ? record.argv : [],
        typeof record.template === "string" ? record.template : null,
      ]),
    )
    .digest("hex");
}
