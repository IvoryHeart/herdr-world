import { createHash } from "node:crypto";
import {
  validateConnectionGeneration,
  validateConnectionId,
} from "../connections/protocol";
import type { Scheduler } from "../service/ports";

export type FocusedOwner = {
  connection_id: string;
  connection_generation: number;
};
export const FOCUSED_METHODS = [
  "workspace.list",
  "tab.list",
  "pane.list",
  "agent.list",
] as const;
export type FocusedMethod = (typeof FOCUSED_METHODS)[number];
export type FocusedLists = Record<FocusedMethod, unknown>;
type Notice = FocusedOwner & { type: "world_focused_changed" };
type Lease = { isCurrent(): boolean; read(): Promise<FocusedLists> };
type Timer = ReturnType<Scheduler["schedule"]>;
type Held<Socket> = {
  owner: FocusedOwner;
  holders: Set<Socket>;
  notified: Map<Socket, string>;
  epoch: number;
  running: boolean;
  timer?: Timer;
};
type RecordOfLists = { generation: number; lists: Map<string, string> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

/** Ignore only fields whose changes have a separate source or no consumer. */
function digest(method: string, value: unknown): string {
  if (isRecord(value)) {
    const field =
      method === "pane.list"
        ? "panes"
        : method === "agent.list"
          ? "agents"
          : undefined;
    if (field && Array.isArray(value[field])) {
      value = {
        ...value,
        [field]: value[field].map((entry) => {
          if (!isRecord(entry)) return entry;
          const copy = { ...entry };
          delete copy[field === "panes" ? "scroll" : "last_activity_at"];
          return copy;
        }),
      };
    }
  }
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)) ?? "null")
    .digest("hex");
}

const ownerKey = (owner: FocusedOwner) =>
  `${owner.connection_id}\0${owner.connection_generation}`;

/** One non-overlapping observation per held runtime, shared by every socket. */
export class FocusedAcquisition<Socket extends object | string> {
  private readonly held = new Map<string, Held<Socket>>();
  private readonly declarations = new Map<Socket, Set<string>>();
  private readonly records = new Map<Socket, Map<string, RecordOfLists>>();
  private stopped = false;

  constructor(
    private readonly deps: {
      scheduler: Scheduler;
      lease(owner: FocusedOwner): Lease | null;
      send(socket: Socket, notice: Notice): boolean;
    },
  ) {}

  declare(socket: Socket, params: unknown): void {
    if (this.stopped) throw new Error("Focused acquisition is stopped");
    if (
      !isRecord(params) ||
      !Array.isArray(params.owners) ||
      params.owners.length > 64
    )
      throw new Error("world.focused.observe requires at most 64 owners");
    // Validate the whole declaration before changing any interest.
    const owners = params.owners.map((value): FocusedOwner => {
      if (!isRecord(value)) throw new Error("Invalid focused owner");
      return {
        connection_id: validateConnectionId(value.connection_id),
        connection_generation: validateConnectionGeneration(
          value.connection_generation,
        ),
      };
    });
    this.reconcile();
    const next = new Map(
      owners
        .filter((owner) => this.deps.lease(owner)?.isCurrent())
        .map((owner) => [ownerKey(owner), owner]),
    );
    for (const key of this.declarations.get(socket) ?? []) {
      if (!next.has(key)) this.removeHolder(socket, key);
    }
    if (next.size) this.declarations.set(socket, new Set(next.keys()));
    else this.declarations.delete(socket);
    for (const [key, owner] of next) {
      let state = this.held.get(key);
      if (!state) {
        state = {
          owner,
          holders: new Set(),
          notified: new Map(),
          epoch: 0,
          running: false,
        };
        this.held.set(key, state);
      }
      state.holders.add(socket);
      this.schedule(state);
    }
  }

  /** Called only after the actual reply was successfully sent on its lease. */
  recordReply(
    socket: Socket,
    owner: FocusedOwner,
    method: string,
    result: unknown,
    marked: boolean,
  ): void {
    if (
      this.stopped ||
      !marked ||
      !FOCUSED_METHODS.includes(method as FocusedMethod) ||
      !this.deps.lease(owner)?.isCurrent()
    )
      return;
    let records = this.records.get(socket);
    if (!records) this.records.set(socket, (records = new Map()));
    let record = records.get(owner.connection_id);
    if (record?.generation !== owner.connection_generation) {
      record = { generation: owner.connection_generation, lists: new Map() };
      records.set(owner.connection_id, record);
    }
    record!.lists.set(method, digest(method, result));
    // A re-list can observe an intervening state; it consumes the prior notice.
    this.held.get(ownerKey(owner))?.notified.delete(socket);
  }

  release(socket: Socket): void {
    for (const key of this.declarations.get(socket) ?? [])
      this.removeHolder(socket, key);
    this.declarations.delete(socket);
    this.records.delete(socket);
  }

  /** Retired generations lapse; declaring interest never starts a runtime. */
  reconcile(): void {
    for (const [key, state] of this.held) {
      if (this.deps.lease(state.owner)?.isCurrent()) continue;
      for (const socket of [...state.holders]) {
        this.removeHolder(socket, key);
        const declaration = this.declarations.get(socket);
        declaration?.delete(key);
        if (!declaration?.size) this.declarations.delete(socket);
        this.records.get(socket)?.delete(state.owner.connection_id);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    for (const socket of [...this.declarations.keys()]) this.release(socket);
    this.records.clear();
  }

  private removeHolder(socket: Socket, key: string): void {
    const state = this.held.get(key);
    if (!state) return;
    state.holders.delete(socket);
    state.notified.delete(socket);
    if (state.holders.size) return;
    state.epoch++;
    state.timer?.cancel();
    state.timer = undefined;
    // Keep the in-flight slot until settlement, including release/reacquire.
    if (!state.running) this.held.delete(key);
  }

  private schedule(state: Held<Socket>): void {
    if (this.stopped || !state.holders.size || state.running || state.timer)
      return;
    state.timer = this.deps.scheduler.schedule(() => this.observe(state), 5000);
  }

  private async observe(state: Held<Socket>): Promise<void> {
    state.timer = undefined;
    const epoch = state.epoch;
    const lease = this.deps.lease(state.owner);
    if (!lease?.isCurrent()) {
      this.reconcile();
      return;
    }
    state.running = true;
    try {
      const lists = await lease.read();
      if (
        this.stopped ||
        !lease.isCurrent() ||
        state.epoch !== epoch ||
        !state.holders.size
      )
        return;
      const digests = FOCUSED_METHODS.map(
        (method) => [method, digest(method, lists[method])] as const,
      );
      const fingerprint = digests.map(([, value]) => value).join(":");
      for (const socket of [...state.holders]) {
        const record = this.records.get(socket)?.get(state.owner.connection_id);
        const differs =
          record?.generation !== state.owner.connection_generation ||
          digests.some(([method, value]) => record.lists.get(method) !== value);
        if (!differs) {
          state.notified.delete(socket);
          continue;
        }
        if (state.notified.get(socket) === fingerprint) continue;
        if (
          this.deps.send(socket, {
            type: "world_focused_changed",
            ...state.owner,
          }) &&
          state.holders.has(socket)
        )
          state.notified.set(socket, fingerprint);
      }
    } catch {
      // Optional repair observations retry after one period, independently per host.
    } finally {
      state.running = false;
      if (!state.holders.size) this.held.delete(ownerKey(state.owner));
      else if (!lease.isCurrent()) this.reconcile();
      else this.schedule(state);
    }
  }
}
