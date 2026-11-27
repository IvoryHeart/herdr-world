/**
 * World commands (openspec world-one-object, task 4.1): a change a view asks
 * World to make. Each names the entity, the field and the value the caller
 * saw; World checks that value, sends the change on the entity's own
 * connection and runtime generation, and settles it only with a read that
 * began after the acknowledgement (the host epoch fence in snapshot.ts).
 * The outcome is published with the revision that carries its value, so a
 * browser holding the pending value never shows the old one again.
 *
 * Commands in progress and recently settled ones are published from memory.
 * Each accepted command is recorded in the World ledger's existing change
 * history before it is sent, and the same record is updated with its final
 * outcome, whatever it is. After a restart, a recorded command that never
 * settled is settled as uncertain (recover()).
 */

import type { AdmittedRead } from "./snapshot";

type WorldCommandEntity = {
  kind: "room";
  connection_id: string;
  generation: number;
  room_id: string;
};

export type WorldCommandInput = {
  id: string;
  entity: WorldCommandEntity;
  field: "name";
  /** The value the caller saw; World refuses if it changed since. */
  expected: string;
  value: string;
};

type WorldCommandState =
  | "accepted"
  | "sent"
  | "stored"
  | "observed"
  | "refused"
  | "failed"
  | "uncertain";

export type PublishedCommand = WorldCommandInput & {
  state: WorldCommandState;
  /** The value World observed when the command settled; null if the entity is gone. */
  observed?: string | null;
  detail?: string;
  at: number;
};

/** World refused before sending, or the runtime refused: nothing changed. */
export class WorldCommandRefused extends Error {}

export type WorldCommandPorts = {
  now(): number;
  /** The entity's runtime, or null when World does not manage the host. */
  runtime(connectionId: string): "herdr" | "herdr-core" | null;
  /** Rooms from the newest admitted read of this generation. */
  rooms(
    connectionId: string,
    generation: number,
  ): readonly Record<string, unknown>[] | null;
  /**
   * Send on the entity's own connection and generation; resolves at the
   * acknowledgement. Throws WorldCommandRefused when nothing was sent.
   */
  send(command: WorldCommandInput): Promise<void>;
  /** Advance the host epoch after the acknowledgement and read again. */
  acknowledged(connectionId: string, generation: number): number;
  /** Publish a command change under a new revision to every browser. */
  publish(): void;
  /**
   * Record the command, with its identity and current state, in World's
   * history: once when accepted (awaited before sending) and again, in
   * place, when it settles.
   */
  record(command: PublishedCommand): Promise<void>;
  after(ms: number, run: () => void): () => void;
};

/** @internal */
export const WORLD_COMMAND_LIMITS = {
  /** Commands published at once, in progress and settled. */
  published: 64,
  /** How long a settled outcome stays published. */
  settledMs: 60_000,
  /** A command World has not seen settle by then is uncertain. */
  settleMs: 30_000,
  value: 128,
  id: 64,
};

type Entry = PublishedCommand & {
  runtime: "herdr" | "herdr-core";
  /** The host epoch after the acknowledgement; reads from before it never settle. */
  ackEpoch?: number;
  sendError?: string;
  cancel?: () => void;
};

const SETTLED = new Set<WorldCommandState>([
  "stored",
  "observed",
  "refused",
  "failed",
  "uncertain",
]);

/** True once a command has its final outcome. */
export const commandSettled = (command: Pick<PublishedCommand, "state">) =>
  SETTLED.has(command.state);

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;

/** Parse a world.command request; throws on a malformed one. */
export function parseWorldCommand(params: unknown): WorldCommandInput {
  const input = (params ?? {}) as Record<string, unknown>;
  const entity = (input.entity ?? {}) as Record<string, unknown>;
  const id = text(input.id, WORLD_COMMAND_LIMITS.id);
  const connectionId = text(entity.connection_id, 256);
  const roomId = text(entity.room_id, 256);
  if (
    !id ||
    entity.kind !== "room" ||
    !connectionId ||
    !roomId ||
    !Number.isSafeInteger(entity.generation) ||
    (entity.generation as number) < 0 ||
    input.field !== "name" ||
    typeof input.expected !== "string" ||
    typeof input.value !== "string"
  )
    throw new Error("invalid World command");
  const value = input.value.trim();
  if (!value) throw new WorldCommandRefused("A room needs a name.");
  if (value.length > WORLD_COMMAND_LIMITS.value)
    throw new WorldCommandRefused(
      `A room name has at most ${WORLD_COMMAND_LIMITS.value} characters.`,
    );
  return {
    id,
    entity: {
      kind: "room",
      connection_id: connectionId,
      generation: entity.generation as number,
      room_id: roomId,
    },
    field: "name",
    expected: input.expected,
    value,
  };
}

const roomLabel = (
  rooms: readonly Record<string, unknown>[],
  roomId: string,
): string | null | undefined => {
  const room = rooms.find((r) => r.workspace_id === roomId);
  if (!room) return undefined;
  return typeof room.label === "string" ? room.label : null;
};

const sameEntity = (a: WorldCommandEntity, b: WorldCommandEntity) =>
  a.connection_id === b.connection_id &&
  a.generation === b.generation &&
  a.room_id === b.room_id;

export class WorldCommands {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly ports: WorldCommandPorts) {}

  /** Commands in progress and recently settled, for the publication. */
  published(): PublishedCommand[] {
    this.prune();
    return [...this.entries.values()].map((entry) => this.view(entry));
  }

  /**
   * Admit, check and send one command. Answers with its state at the
   * acknowledgement (or its refusal); the final outcome is published.
   */
  async submit(input: WorldCommandInput): Promise<PublishedCommand> {
    const existing = this.entries.get(input.id);
    if (existing) return this.view(existing);
    const { connection_id: connectionId, generation } = input.entity;
    const runtime = this.ports.runtime(connectionId);
    if (!runtime)
      throw new WorldCommandRefused("World does not manage that host.");
    const rooms = this.ports.rooms(connectionId, generation);
    if (!rooms)
      throw new WorldCommandRefused(
        "The host reconnected or has not been seen yet; look again and retry.",
      );
    const label = roomLabel(rooms, input.entity.room_id);
    if (label === undefined)
      throw new WorldCommandRefused("That room no longer exists.");
    // Compare-and-set against the newest value World knows: a command still
    // in progress on the same room, else what World observed.
    const inFlight = [...this.entries.values()]
      .filter(
        (entry) =>
          !SETTLED.has(entry.state) && sameEntity(entry.entity, input.entity),
      )
      .at(-1);
    const current = inFlight ? inFlight.value : (label ?? "");
    if (input.expected !== current)
      throw new WorldCommandRefused(
        "The room's name changed since you looked; look again and retry.",
      );
    const entry: Entry = {
      ...input,
      runtime,
      state: "accepted",
      at: this.ports.now(),
    };
    this.entries.set(entry.id, entry);
    this.bound();
    try {
      await this.ports.record(this.view(entry));
    } catch {
      this.entries.delete(entry.id);
      throw new WorldCommandRefused(
        "World could not record the change, so it did not send it; try again.",
      );
    }
    try {
      await this.ports.send(input);
    } catch (error) {
      if (error instanceof WorldCommandRefused) {
        this.settle(entry, "refused", { detail: error.message });
        this.ports.publish();
        return this.view(entry);
      }
      // A reconcilable change: the read that follows decides what happened.
      entry.sendError = error instanceof Error ? error.message : String(error);
    }
    entry.state = "sent";
    entry.cancel = this.ports.after(WORLD_COMMAND_LIMITS.settleMs, () => {
      if (SETTLED.has(entry.state)) return;
      this.settle(entry, "uncertain", {
        detail: "World did not see the result in time.",
      });
      this.ports.publish();
    });
    // The epoch advance publishes the command with the next revision.
    entry.ackEpoch = this.ports.acknowledged(connectionId, generation);
    return this.view(entry);
  }

  /**
   * Settle commands with an admitted read of their host; true when a
   * published command changed (the read is then published).
   */
  admittedRead(read: AdmittedRead): boolean {
    let changed = false;
    for (const entry of this.entries.values()) {
      if (
        SETTLED.has(entry.state) ||
        entry.entity.connection_id !== read.connectionId
      )
        continue;
      if (entry.entity.generation !== read.generation) {
        this.settle(entry, "uncertain", {
          detail: "The host reconnected before World saw the result.",
        });
        changed = true;
        continue;
      }
      if (entry.ackEpoch === undefined || read.epoch < entry.ackEpoch) continue;
      const observed = roomLabel(read.rooms, entry.entity.room_id) ?? null;
      const applied = observed === entry.value;
      this.settle(
        entry,
        applied
          ? entry.runtime === "herdr-core"
            ? "stored"
            : "observed"
          : entry.sendError
            ? "failed"
            : "observed",
        {
          observed,
          ...(applied
            ? {}
            : {
                detail:
                  entry.sendError ??
                  (observed === null
                    ? "The room no longer exists."
                    : "The room shows another name."),
              }),
        },
      );
      changed = true;
    }
    return changed;
  }

  private settle(
    entry: Entry,
    state: WorldCommandState,
    outcome: { observed?: string | null; detail?: string },
  ) {
    entry.state = state;
    entry.at = this.ports.now();
    if (outcome.observed !== undefined) entry.observed = outcome.observed;
    if (outcome.detail) entry.detail = outcome.detail;
    entry.cancel?.();
    entry.cancel = undefined;
    // Every outcome of an accepted command is recorded, not only success.
    const settled = this.view(entry);
    try {
      void this.ports.record(settled).catch(() => undefined);
    } catch {
      // The port reports its own failures.
    }
  }

  /**
   * After a restart: commands recorded as accepted that never settled are
   * settled as uncertain (the change may or may not have landed), recorded
   * and published for a while like any other outcome.
   */
  recover(recorded: readonly PublishedCommand[]) {
    for (const command of recorded) {
      if (commandSettled(command) || this.entries.has(command.id)) continue;
      const entry: Entry = { ...command, runtime: "herdr" };
      this.entries.set(entry.id, entry);
      this.settle(entry, "uncertain", {
        detail: "World restarted before it saw the result.",
      });
    }
    this.prune();
  }

  private view(entry: Entry): PublishedCommand {
    const command: PublishedCommand & Partial<Entry> = { ...entry };
    delete command.runtime;
    delete command.ackEpoch;
    delete command.sendError;
    delete command.cancel;
    return command;
  }

  /** Settled outcomes leave after a while; in-progress ones stay. */
  private prune() {
    const now = this.ports.now();
    for (const [id, entry] of this.entries)
      if (
        SETTLED.has(entry.state) &&
        now - entry.at >= WORLD_COMMAND_LIMITS.settledMs
      )
        this.entries.delete(id);
  }

  /** At most WORLD_COMMAND_LIMITS.published: the oldest settled leave first. */
  private bound() {
    this.prune();
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= WORLD_COMMAND_LIMITS.published) return;
      if (SETTLED.has(entry.state)) this.entries.delete(id);
    }
    if (this.entries.size > WORLD_COMMAND_LIMITS.published) {
      const newest = [...this.entries.keys()].at(-1)!;
      this.entries.delete(newest);
      throw new WorldCommandRefused(
        "World has too many changes in progress; try again in a moment.",
      );
    }
  }
}
