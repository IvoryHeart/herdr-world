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

const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The value of `--flag value` or `--flag=value`, when it names a session. */
function flagValue(argv: readonly string[], flags: readonly string[]) {
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!;
    for (const flag of flags) {
      const value =
        word === flag
          ? argv[i + 1]
          : word.startsWith(`${flag}=`)
            ? word.slice(flag.length + 1)
            : undefined;
      if (value !== undefined && SESSION_ID.test(value))
        return value.toLowerCase();
    }
  }
  return null;
}

/**
 * The harness session a core foreground program names on its command line:
 * Claude's `--session-id`/`--resume`/`-r <uuid>` (not `--fork-session`, which
 * starts a new one) or Codex's `resume <uuid>`. Anything else names none.
 */
function harnessSession(name: string, argv: readonly string[]) {
  if (name === "claude")
    return argv.includes("--fork-session")
      ? null
      : flagValue(argv, ["--session-id", "--resume", "-r"]);
  if (name === "codex") {
    if (argv.includes("fork")) return null;
    const at = argv.indexOf("resume");
    const value = at >= 0 ? argv[at + 1] : undefined;
    return value && SESSION_ID.test(value) ? value.toLowerCase() : null;
  }
  return null;
}

/**
 * Durable evidence of the harness session at one core terminal, for saved
 * answers that outlive a World run: core, address, the terminal's creation
 * time, the harness and the session id it was started or resumed with. Core
 * keeps all of it across World restarts; PIDs, names and the mirror's
 * occupancy counter are not session evidence. Null when the program names no
 * session, so such answers stay with ask get after a restart.
 */
export function coreSessionProof(
  coreId: string,
  record: { address: string; created_ms?: unknown },
  foreground: { name?: unknown; argv?: unknown } | null | undefined,
): string | null {
  if (
    typeof foreground?.name !== "string" ||
    !Array.isArray(foreground.argv) ||
    !foreground.argv.every((word) => typeof word === "string")
  )
    return null;
  const session = harnessSession(foreground.name, foreground.argv as string[]);
  if (!session) return null;
  return createHash("sha256")
    .update(
      JSON.stringify([
        "herdr-core-session-v1",
        coreId,
        record.address,
        Number.isSafeInteger(record.created_ms) ? record.created_ms : null,
        foreground.name,
        session,
      ]),
    )
    .digest("hex");
}
