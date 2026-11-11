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
};

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
