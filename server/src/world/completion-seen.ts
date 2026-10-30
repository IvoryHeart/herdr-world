const MAX_SEEN = 4_096;
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
 */
export class WorldCompletionSeenRegistry {
  private revision = 0;
  private records = new Map<string, CompletionSeenRecord>();

  list(): CompletionSeen {
    return { revision: this.revision, records: [...this.records.values()] };
  }

  mark(identity: CompletionSeenIdentity): {
    changed: boolean;
    revision: number;
  } {
    const normalized = normalize(identity);
    const key = completionSeenKey(normalized);
    if (this.records.has(key))
      return { changed: false, revision: this.revision };
    this.revision += 1;
    this.records.set(key, { ...normalized, revision: this.revision });
    while (this.records.size > MAX_SEEN)
      this.records.delete(this.records.keys().next().value!);
    return { changed: true, revision: this.revision };
  }

  /**
   * The agent has new work to check. Only marks the caller had already seen
   * (at or below `seenRevision`) are cleared, so a browser that noticed the new
   * work late cannot erase a newer mark another browser just made.
   */
  clear(
    identity: CompletionSeenIdentity,
    seenRevision: number,
  ): { changed: boolean; revision: number } {
    if (!Number.isSafeInteger(seenRevision) || seenRevision < 0)
      throw new Error("invalid completion seen revision");
    const key = completionSeenKey(normalize(identity));
    const record = this.records.get(key);
    if (!record || record.revision > seenRevision)
      return { changed: false, revision: this.revision };
    this.records.delete(key);
    this.revision += 1;
    return { changed: true, revision: this.revision };
  }

  retireConnectionGeneration(
    connectionId: string,
    generation: number,
  ): { changed: boolean; revision: number } {
    let changed = false;
    for (const [key, record] of this.records) {
      if (
        record.connection_id === connectionId &&
        record.connection_generation !== generation
      ) {
        this.records.delete(key);
        changed = true;
      }
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
