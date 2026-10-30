const MAX_SEEN = 4_096;
const MAX_OBSERVED = 8_192;
const MAX_ID_LENGTH = 512;

/** One terminal's checked completion, in the generation that ran it. */
export type CompletionSeenIdentity = {
  connection_id: string;
  connection_generation: number;
  terminal_id: string;
};

export type CompletionSeenRecord = CompletionSeenIdentity & {
  /** The registry revision that made this mark. */
  revision: number;
};

export type CompletionSeen = {
  revision: number;
  records: readonly CompletionSeenRecord[];
};

/**
 * Which finished agents a person has checked, shared by every browser of this
 * World. Process memory only: a restart forgets every mark, and a new runtime
 * generation retires its connection's marks, because terminal IDs are not
 * durable identities.
 *
 * A check covers one completion. The service, not a browser, decides when it
 * ends: the host reads that every browser's view comes from show the agent
 * working or asking again. A browser's late view of the same completion
 * therefore cannot erase a newer check from another browser.
 */
export class WorldCompletionSeenRegistry {
  private revision = 0;
  private records = new Map<string, CompletionSeenRecord>();
  /** Terminals last observed working or blocked. */
  private busy = new Set<string>();

  list(): CompletionSeen {
    return { revision: this.revision, records: [...this.records.values()] };
  }

  /** Check the terminal's current completion; ignored while it is busy. */
  mark(identity: CompletionSeenIdentity): {
    changed: boolean;
    revision: number;
  } {
    const normalized = normalize(identity);
    const key = completionSeenKey(normalized);
    if (this.records.has(key) || this.busy.has(key))
      return { changed: false, revision: this.revision };
    this.revision += 1;
    this.records.set(key, { ...normalized, revision: this.revision });
    while (this.records.size > MAX_SEEN)
      this.records.delete(this.records.keys().next().value!);
    return { changed: true, revision: this.revision };
  }

  /** A fresh host read saw this terminal's agent busy or not. */
  observe(
    identity: CompletionSeenIdentity,
    busy: boolean,
  ): { changed: boolean; revision: number } {
    const key = completionSeenKey(normalize(identity));
    this.busy.delete(key);
    if (!busy) return { changed: false, revision: this.revision };
    this.busy.add(key);
    while (this.busy.size > MAX_OBSERVED)
      this.busy.delete(this.busy.keys().next().value!);
    if (!this.records.delete(key))
      return { changed: false, revision: this.revision };
    this.revision += 1;
    return { changed: true, revision: this.revision };
  }

  retireConnectionGeneration(
    connectionId: string,
    generation: number,
  ): { changed: boolean; revision: number } {
    const retired = (key: string) => {
      const [connection, keyGeneration] = JSON.parse(key) as [string, number];
      return connection === connectionId && keyGeneration !== generation;
    };
    for (const key of this.busy) if (retired(key)) this.busy.delete(key);
    let changed = false;
    for (const key of this.records.keys())
      if (retired(key)) {
        this.records.delete(key);
        changed = true;
      }
    if (changed) this.revision += 1;
    return { changed, revision: this.revision };
  }
}

export function completionSeenKey(identity: CompletionSeenIdentity) {
  return JSON.stringify([
    identity.connection_id,
    identity.connection_generation,
    identity.terminal_id,
  ]);
}

export function validCompletionSeenIdentity(
  value: unknown,
): value is CompletionSeenIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  return (
    validId(identity.connection_id) &&
    validId(identity.terminal_id) &&
    Number.isSafeInteger(identity.connection_generation) &&
    (identity.connection_generation as number) >= 0
  );
}

function normalize(identity: CompletionSeenIdentity): CompletionSeenIdentity {
  if (!validCompletionSeenIdentity(identity))
    throw new Error("invalid completion seen identity");
  return {
    connection_id: identity.connection_id,
    connection_generation: identity.connection_generation,
    terminal_id: identity.terminal_id,
  };
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}
