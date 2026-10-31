import {
  deskReadKey,
  type DeskReadKind,
  type DeskReadNotice,
  type DeskReadTarget,
} from "../../../shared/deskAcquisition";
import {
  validateConnectionGeneration,
  validateConnectionId,
} from "../connections/protocol";
import { sanitizeConnectionError } from "../connections/manager";
import type { Scheduler } from "../service/ports";
import { DeskReadQueues } from "./desk-read-queues";

type Target = DeskReadTarget & { trigger?: string };
type Holder = {
  token: object;
  trigger: string | null;
  signature?: string;
  failures: number;
  failureTrigger?: string | null;
};
type Captured = Map<unknown, { token: object; trigger: string | null }>;
type Outcome = { result?: unknown; error?: string; captured: Captured };
export type DeskReadResult = { result: unknown } | { retired: true };
type Lease = {
  isCurrent(): boolean;
  read(kind: DeskReadKind, target: DeskReadTarget): Promise<DeskReadResult>;
};
type Watch<Socket> = {
  key: string;
  kind: DeskReadKind;
  target: DeskReadTarget;
  holders: Map<Socket, Holder>;
  epoch: number;
  running: boolean;
  queued: boolean;
  due: boolean;
  timer?: ReturnType<Scheduler["schedule"]>;
  latest?: Outcome;
};
const laneOf = (watch: { kind: DeskReadKind; target: DeskReadTarget }) =>
  JSON.stringify([watch.kind, watch.target.connection_id]);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function targets(value: unknown, limit: number, receipts: boolean): Target[] {
  if (!Array.isArray(value) || value.length > limit)
    throw new Error("Invalid bounded Desk targets");
  return value.map((row) => {
    if (
      !record(row) ||
      typeof row.pane_id !== "string" ||
      !row.pane_id ||
      row.pane_id.length > 512 ||
      !(
        row.session === null ||
        (typeof row.session === "string" && /^[a-f0-9]{64}$/.test(row.session))
      )
    )
      throw new Error("Invalid Desk target identity");
    if (
      receipts &&
      (typeof row.trigger !== "string" || row.trigger.length > 4096)
    )
      throw new Error("Invalid Desk receipt trigger");
    return {
      connection_id: validateConnectionId(row.connection_id),
      connection_generation: validateConnectionGeneration(
        row.connection_generation,
      ),
      pane_id: row.pane_id,
      session: row.session,
      ...(receipts ? { trigger: row.trigger as string } : {}),
    };
  });
}

/** Shared screen/receipt watches. Triggers belong to holders, never to physical read keys. */
export class DeskWatches<Socket> {
  private readonly watches = new Map<string, Watch<Socket>>();
  private readonly declarations = new Map<Socket, Set<string>>();
  private readonly queues = new DeskReadQueues();
  private stopped = false;
  constructor(
    private readonly deps: {
      scheduler: Scheduler;
      lease(target: DeskReadTarget): Lease | null;
      send(socket: Socket, frame: DeskReadNotice): boolean;
    },
  ) {}

  declare(socket: Socket, params: unknown): void {
    if (this.stopped) throw new Error("Desk watches stopped");
    if (!record(params)) throw new Error("Invalid Desk declaration");
    const next = new Map<string, { kind: DeskReadKind; target: Target }>();
    for (const kind of ["screen", "receipt"] as const) {
      for (const target of targets(
        params[kind === "screen" ? "screens" : "receipts"],
        kind === "screen" ? 16 : 40,
        kind === "receipt",
      )) {
        const key = deskReadKey(kind, target),
          duplicate = next.get(key);
        if (duplicate && duplicate.target.trigger !== target.trigger)
          throw new Error("Conflicting duplicate Desk trigger");
        next.set(key, { kind, target });
      }
    }
    this.reconcile();
    for (const [key, value] of next)
      if (!this.deps.lease(value.target)?.isCurrent()) next.delete(key);
    for (const key of this.declarations.get(socket) ?? [])
      if (!next.has(key)) this.remove(socket, key);
    if (next.size) this.declarations.set(socket, new Set(next.keys()));
    else this.declarations.delete(socket);
    const cached: { watch: Watch<Socket>; outcome: Outcome }[] = [];
    for (const [key, { kind, target }] of next) {
      let watch = this.watches.get(key);
      if (!watch) {
        watch = {
          key,
          kind,
          target,
          holders: new Map(),
          epoch: 0,
          running: false,
          queued: false,
          due: false,
        };
        this.watches.set(key, watch);
      }
      const existing = watch.holders.get(socket),
        trigger = target.trigger ?? null;
      if (existing) {
        if (existing.trigger !== trigger) {
          existing.trigger = trigger;
          this.arm(watch, 0);
        }
      } else {
        watch.holders.set(socket, { token: {}, trigger, failures: 0 });
        if (watch.latest) cached.push({ watch, outcome: watch.latest });
        if (kind === "receipt" || !watch.latest) this.arm(watch, 0);
      }
    }
    // Sending can synchronously close the socket and release its declaration.
    // Install all holders first so cleanup can find every resource; subsequent
    // cached deliveries become no-ops once that socket has been released.
    for (const { watch, outcome } of cached)
      this.deliver(watch, socket, outcome);
  }

  release(socket: Socket): void {
    for (const key of this.declarations.get(socket) ?? [])
      this.remove(socket, key);
    this.declarations.delete(socket);
  }

  reconcile(): void {
    for (const watch of this.watches.values()) {
      if (!this.deps.lease(watch.target)?.isCurrent()) this.retire(watch);
    }
  }

  stop(): void {
    this.stopped = true;
    // The watch map owns scheduling, even if declaration bookkeeping is lost.
    for (const watch of this.watches.values()) this.retire(watch);
    this.declarations.clear();
  }

  private retire(watch: Watch<Socket>): void {
    for (const socket of [...watch.holders.keys()]) {
      this.remove(socket, watch.key);
      const keys = this.declarations.get(socket);
      keys?.delete(watch.key);
      if (!keys?.size) this.declarations.delete(socket);
    }
  }

  private remove(socket: Socket, key: string): void {
    const watch = this.watches.get(key);
    if (!watch) return;
    watch.holders.delete(socket);
    if (watch.holders.size) return;
    watch.epoch++;
    watch.latest = undefined;
    watch.timer?.cancel();
    watch.timer = undefined;
    this.queues.cancel(laneOf(watch), key);
    watch.queued = false;
    if (!watch.running) this.watches.delete(key);
  }

  private arm(watch: Watch<Socket>, ms: number): void {
    if (this.stopped || !watch.holders.size) return;
    if (watch.running || watch.queued) {
      watch.due = true;
      return;
    }
    watch.timer?.cancel();
    watch.timer = this.deps.scheduler.schedule(() => {
      watch.timer = undefined;
      watch.queued = true;
      return this.queues.enqueue(laneOf(watch), watch.key, () =>
        this.read(watch),
      );
    }, ms);
  }

  private async read(watch: Watch<Socket>): Promise<void> {
    watch.queued = false;
    if (this.stopped || !watch.holders.size) return;
    const lease = this.deps.lease(watch.target);
    if (!lease?.isCurrent()) {
      this.retire(watch);
      return;
    }
    watch.running = true;
    watch.due = false;
    const epoch = watch.epoch;
    const captured: Captured = new Map(
      [...watch.holders].map(([socket, holder]) => [
        socket,
        { token: holder.token, trigger: holder.trigger },
      ]),
    );
    try {
      let outcome: Outcome;
      try {
        const read = await lease.read(watch.kind, watch.target);
        if ("retired" in read) {
          if (watch.epoch === epoch) this.retire(watch);
          return;
        }
        outcome = { result: read.result, captured };
      } catch (error) {
        outcome = {
          error: sanitizeConnectionError(error) || "Desk read failed",
          captured,
        };
      }
      if (
        !this.stopped &&
        lease.isCurrent() &&
        watch.epoch === epoch &&
        watch.holders.size
      ) {
        watch.latest = outcome;
        for (const socket of [...watch.holders.keys()])
          this.deliver(watch, socket, outcome);
      }
    } finally {
      watch.running = false;
      if (!watch.holders.size) this.watches.delete(watch.key);
      else if (!lease.isCurrent()) this.retire(watch);
      else
        this.arm(watch, watch.due ? 0 : watch.kind === "screen" ? 4000 : 20000);
    }
  }

  private deliver(
    watch: Watch<Socket>,
    socket: Socket,
    outcome: Outcome,
  ): void {
    const holder = watch.holders.get(socket);
    if (!holder) return;
    const previous = outcome.captured.get(socket);
    const trigger = previous?.token === holder.token ? previous.trigger : null;
    const frame: DeskReadNotice = {
      type: "world_desk_reads",
      kind: watch.kind,
      ...watch.target,
      trigger,
    };
    if (outcome.error !== undefined) {
      holder.failures =
        holder.failureTrigger === trigger ? holder.failures + 1 : 1;
      holder.failureTrigger = trigger;
      frame.error = outcome.error;
      frame.failures = holder.failures;
    } else {
      frame.result = outcome.result;
      holder.failures = 0;
      holder.failureTrigger = undefined;
    }
    const signature = JSON.stringify(frame);
    if (outcome.error === undefined && holder.signature === signature) return;
    if (this.deps.send(socket, frame) && watch.holders.get(socket) === holder)
      holder.signature = signature;
  }
}
