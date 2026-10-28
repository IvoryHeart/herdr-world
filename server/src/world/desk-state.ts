import {
  DESK_RECORD_LIMIT,
  DESK_OPENS_LIMIT,
  DESK_OBSERVATION_LIMIT,
  DESK_IDLE_WINDOW_MS,
  deskKey,
  validDeskIdentity,
  type DeskIdentity,
  type DeskRecord,
  type DeskState,
} from "../../../shared/deskState";

const terminalKey = (identity: DeskIdentity) =>
  JSON.stringify([
    identity.connection_id,
    identity.connection_generation,
    identity.terminal_id,
  ]);

const copyIdentity = (identity: DeskIdentity): DeskIdentity => ({
  connection_id: identity.connection_id,
  connection_generation: identity.connection_generation,
  terminal_id: identity.terminal_id,
  agent_session_fingerprint: identity.agent_session_fingerprint,
});

/** Browser-independent, process-local state. No transcript text is retained. */
export class WorldDeskRegistry {
  private revision = 0;
  private ownershipRevision = 0;
  private records = new Map<string, DeskRecord>();
  private recordByTerminal = new Map<string, string>();
  private previous = new Map<
    string,
    {
      identity: DeskIdentity;
      status: string;
      at: number;
      mutation?: boolean;
      session: object;
    }
  >();

  list(): DeskState {
    return {
      revision: this.revision,
      records: [...this.records.values()].map((record) => ({ ...record })),
    };
  }

  /** Fence a native admission against replacement or retirement while it waits. */
  captureMutation(identity: DeskIdentity) {
    const key = terminalKey(identity);
    const session = this.previous.get(key)?.session;
    const revision = this.ownershipRevision;
    return () =>
      this.previous.get(key)?.session === session &&
      (session !== undefined || this.ownershipRevision === revision);
  }

  mark(identity: DeskIdentity, stop: string, reviewed: boolean, now: number) {
    this.validate(identity);
    if (typeof stop !== "string" || !stop || stop.length > 8192)
      throw new Error("invalid Desk stop identity");
    const existing = this.records.get(deskKey(identity));
    // Undo can remove only the exact mark it offered, never another browser's newer mark.
    if (!reviewed && existing?.reviewed_stop !== stop) return;
    if (reviewed && existing?.reviewed_stop === stop) return;
    this.noteMutation(identity, now);
    const record = this.record(identity);
    record.reviewed_stop = reviewed ? stop : null;
    this.save(record);
  }

  open(identity: DeskIdentity, now: number) {
    this.validate(identity);
    this.noteMutation(identity, now);
    const record = this.record(identity);
    if (record.opened_at === now) return;
    record.opened_at = now;
    this.save(record);
    const opens = [...this.records.values()]
      .reverse()
      .filter((entry) => entry.opened_at !== null)
      .sort((a, b) => b.opened_at! - a.opened_at!);
    for (const entry of opens.slice(DESK_OPENS_LIMIT)) {
      entry.opened_at = null;
      this.removeEmpty(entry);
    }
  }

  observeAgent(identity: DeskIdentity, status: string, at: number) {
    this.validate(identity);
    const terminal = terminalKey(identity);
    const previous = this.previous.get(terminal);
    if (
      previous &&
      (previous.at > at || (previous.mutation && previous.at === at))
    )
      return;
    const same = previous && deskKey(previous.identity) === deskKey(identity);
    if (!same) this.retireSession(identity);
    const existing = this.records.get(deskKey(identity));
    if (same && !["working", "idle", "done", "blocked"].includes(status)) {
      previous.at = at;
      return;
    }
    if (
      same &&
      previous.status === "working" &&
      status !== "working" &&
      status !== "unknown"
    ) {
      const record = this.record(identity);
      record.stopped_at = at;
      this.save(record);
    } else if (
      status === "working" &&
      existing?.stopped_at !== null &&
      existing?.stopped_at !== undefined
    ) {
      existing.stopped_at = null;
      this.removeEmpty(existing);
      this.revision++;
    }
    this.previous.delete(terminal);
    this.previous.set(terminal, {
      identity: copyIdentity(identity),
      status,
      at,
      session: same ? previous.session : { revision: ++this.ownershipRevision },
    });
    while (this.previous.size > DESK_OBSERVATION_LIMIT)
      this.previous.delete(this.previous.keys().next().value!);
  }

  expire(now: number) {
    let changed = false;
    for (const record of this.records.values()) {
      if (
        record.stopped_at !== null &&
        now - record.stopped_at > DESK_IDLE_WINDOW_MS
      ) {
        record.stopped_at = null;
        this.removeEmpty(record);
        changed = true;
      }
    }
    for (const [key, previous] of this.previous)
      if (now - previous.at > DESK_IDLE_WINDOW_MS) this.previous.delete(key);
    if (changed) this.revision++;
  }

  retireConnectionGeneration(connectionId: string, generation: number) {
    let changed = false;
    for (const [key, record] of this.records) {
      if (
        record.connection_id === connectionId &&
        record.connection_generation !== generation
      ) {
        this.remove(key);
        changed = true;
      }
    }
    for (const [key, record] of this.previous)
      if (
        record.identity.connection_id === connectionId &&
        record.identity.connection_generation !== generation
      )
        this.previous.delete(key);
    if (changed) this.revision++;
  }

  private retireSession(identity: DeskIdentity) {
    const key = this.recordByTerminal.get(terminalKey(identity));
    if (key && key !== deskKey(identity)) {
      this.remove(key);
      this.revision++;
    }
  }

  private remove(key: string) {
    const record = this.records.get(key);
    if (record) this.recordByTerminal.delete(terminalKey(record));
    this.records.delete(key);
  }

  private noteMutation(identity: DeskIdentity, at: number) {
    const key = terminalKey(identity);
    const previous = this.previous.get(key);
    this.previous.delete(key);
    this.previous.set(key, {
      identity: copyIdentity(identity),
      status:
        previous && deskKey(previous.identity) === deskKey(identity)
          ? previous.status
          : "unknown",
      at,
      mutation: true,
      session:
        previous && deskKey(previous.identity) === deskKey(identity)
          ? previous.session
          : { revision: ++this.ownershipRevision },
    });
    while (this.previous.size > DESK_OBSERVATION_LIMIT)
      this.previous.delete(this.previous.keys().next().value!);
  }

  private validate(identity: DeskIdentity) {
    if (!validDeskIdentity(identity))
      throw new Error("invalid Desk agent identity");
  }
  private record(identity: DeskIdentity): DeskRecord {
    this.retireSession(identity);
    return (
      this.records.get(deskKey(identity)) ?? {
        ...copyIdentity(identity),
        reviewed_stop: null,
        stopped_at: null,
        opened_at: null,
      }
    );
  }
  private save(record: DeskRecord) {
    const key = deskKey(record);
    this.records.delete(key);
    this.records.set(key, record);
    this.recordByTerminal.set(terminalKey(record), key);
    this.removeEmpty(record);
    while (this.records.size > DESK_RECORD_LIMIT)
      this.remove(this.records.keys().next().value!);
    this.revision++;
  }
  private removeEmpty(record: DeskRecord) {
    if (
      record.reviewed_stop === null &&
      record.stopped_at === null &&
      record.opened_at === null
    )
      this.remove(deskKey(record));
  }
}
