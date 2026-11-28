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

/**
 * Durable evidence of the harness session at one core terminal, for saved
 * answers that outlive a World run: core, address, the terminal's creation
 * time, the harness and the session it runs now. The session comes from the
 * harness's own live process record (Claude rewrites it on `/clear` and
 * `/resume`), never from the launch command, which still names the first
 * session after an in-process switch. PIDs, names and the mirror's
 * occupancy counter are not session evidence. Null without a session.
 */
export function coreSessionProof(
  coreId: string,
  record: { address: string; created_ms?: unknown },
  harness: string,
  session: string | null | undefined,
): string | null {
  if (!session) return null;
  return createHash("sha256")
    .update(
      JSON.stringify([
        "herdr-core-session-v1",
        coreId,
        record.address,
        Number.isSafeInteger(record.created_ms) ? record.created_ms : null,
        harness,
        session.toLowerCase(),
      ]),
    )
    .digest("hex");
}
