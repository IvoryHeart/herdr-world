import type { CoreMirror, CoreRetirement } from "./mirror";

/** At most this many terminals are listed in a connection's status. */
const LISTED_TERMINALS = 50;

export type CoreObservedTerminal = {
  address: string;
  name: string | null;
  state: string;
  /** The program's own OSC 7501 word, if it reported one. */
  status: string | null;
  program: string | null;
  remote: boolean;
};

/**
 * What the Connections page shows for one herdr-core connection. A stale
 * observation keeps the last facts but is never actionable.
 */
export type CoreObservation = {
  state: "live" | "stale";
  reason: CoreRetirement | null;
  core: { id: string; name: string; version: string; pid: number } | null;
  observed_ms: number;
  cursor: number;
  terminals: CoreObservedTerminal[];
  counts: { live: number; finished: number; remote: number };
  /** Event types this World does not model yet (protocol drift). */
  unknown_events: string[];
  /**
   * Present when core says the host ends its programs once the last login
   * closes (`keeps_running_after_logout: false`, core 0.1.21+): systemd
   * lingering is off. `linger_user` is the account for
   * `loginctl enable-linger`, when core names a usable one. Null means kept,
   * unknown, not applicable, or an older core: nothing to say.
   */
  stops_at_logout: { linger_user: string | null } | null;
};

/** Longest account name World passes on; longer is treated as unnamed. */
const LINGER_USER_LIMIT = 256;

/**
 * Reads core's logout facts from `server.status` (or `hello`). Only an
 * explicit `false` warns; a name with control or format characters (which
 * could hide what a pasted command does) is dropped rather than shown.
 */
export function logoutStop(
  status: unknown,
): CoreObservation["stops_at_logout"] {
  if (
    !status ||
    typeof status !== "object" ||
    (status as { keeps_running_after_logout?: unknown })
      .keeps_running_after_logout !== false
  )
    return null;
  const user = (status as { logout_linger_user?: unknown }).logout_linger_user;
  const usable =
    typeof user === "string" &&
    user.length > 0 &&
    user.length <= LINGER_USER_LIMIT &&
    !/[\p{Cc}\p{Cf}]/u.test(user);
  return { linger_user: usable ? user : null };
}

function word(value: unknown): string | null {
  return value &&
    typeof value === "object" &&
    typeof (value as { state?: unknown }).state === "string"
    ? (value as { state: string }).state
    : null;
}

export function summarizeMirror(
  mirror: CoreMirror,
  core: CoreObservation["core"],
  observedMs: number,
  stopsAtLogout: CoreObservation["stops_at_logout"] = null,
): CoreObservation {
  const terminals = mirror
    .terminals()
    .slice()
    .sort((a, b) => {
      if (a.remote !== b.remote) return a.remote ? 1 : -1;
      const n = (address: string) => Number(address.split("t").pop());
      return a.address === b.address ? 0 : n(a.address) - n(b.address);
    });
  const counts = { live: 0, finished: 0, remote: 0 };
  for (const terminal of terminals) {
    if (terminal.remote) counts.remote += 1;
    else if (terminal.state === "live") counts.live += 1;
    else counts.finished += 1;
  }
  return {
    state: mirror.actionable ? "live" : "stale",
    reason: mirror.retired,
    core,
    observed_ms: observedMs,
    cursor: mirror.cursor,
    terminals: terminals.slice(0, LISTED_TERMINALS).map((terminal) => {
      const argv = Array.isArray(terminal.argv) ? terminal.argv : [];
      const program =
        typeof argv[0] === "string" ? (argv[0].split("/").pop() ?? null) : null;
      return {
        address: terminal.address,
        name: typeof terminal.name === "string" ? terminal.name : null,
        state: terminal.state,
        status: word(terminal.status),
        program,
        remote: terminal.remote,
      };
    }),
    counts,
    unknown_events: [...mirror.unknownEvents.keys()].sort(),
    stops_at_logout: stopsAtLogout,
  };
}

/**
 * Last observation per connection. It outlives each runtime generation, so a
 * core that went away stays visible as stale, and a reconnect shows whether
 * the same terminals came back at the same addresses.
 */
export class CoreObservationStore {
  private readonly entries = new Map<string, CoreObservation>();

  constructor(
    private readonly changed: (connectionId: string) => void = () => {},
  ) {}

  get(connectionId: string): CoreObservation | null {
    return this.entries.get(connectionId) ?? null;
  }

  publish(connectionId: string, observation: CoreObservation): void {
    this.entries.set(connectionId, observation);
    this.changed(connectionId);
  }

  /** Keeps the facts, withdraws actionability. */
  markStale(connectionId: string, reason: CoreObservation["reason"]): void {
    const current = this.entries.get(connectionId);
    if (!current || current.state === "stale") return;
    this.entries.set(connectionId, { ...current, state: "stale", reason });
    this.changed(connectionId);
  }

  forget(connectionId: string): void {
    if (this.entries.delete(connectionId)) this.changed(connectionId);
  }
}
