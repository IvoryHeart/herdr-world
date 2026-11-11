import { createHash } from "node:crypto";

/**
 * The occupant fingerprint of a herdr-core terminal (P4, M5): the durable,
 * public evidence of which program holds an address on one core: core ID,
 * address, pid, argv and template. A kept terminal's replacement shell
 * changes argv (and usually pid); a reused pid with a different program
 * changes argv. It survives World reconnects and core restarts that keep
 * the program (holders keep pids), unlike the mirror's occupancy token.
 */
export function coreOccupantFingerprint(
  coreId: string,
  record: {
    address: string;
    pid?: unknown;
    argv?: unknown;
    template?: unknown;
  },
): string | null {
  if (typeof record.pid !== "number" || !Number.isSafeInteger(record.pid))
    return null;
  return createHash("sha256")
    .update(
      JSON.stringify([
        "herdr-core-occupant-v1",
        coreId,
        record.address,
        record.pid,
        Array.isArray(record.argv) ? record.argv : [],
        typeof record.template === "string" ? record.template : null,
      ]),
    )
    .digest("hex");
}
