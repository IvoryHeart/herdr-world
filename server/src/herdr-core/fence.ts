import type {
  ConnectionRuntime,
  ReadyRuntimeLease,
} from "../connections/manager";
import type { CoreMirrorTerminal } from "./mirror";

/** The process incarnation of one durable core: `seq` restarts with it. */
export type CoreEpoch = { coreId: string; pid: number; startedMs: number };

/**
 * Who occupied an address when an operation was admitted: the program
 * (`core.id`, `tN`, pid) plus the foreground process and any verified
 * session evidence. A kept replacement keeps the address and labels, and may
 * even reuse the pid; it changes the occupancy token, argv or foreground.
 */
export type CoreOccupant = {
  coreId: string;
  address: string;
  pid: number;
  occupancy: number;
  foreground: { pid: number; name: string } | null;
  session: string | null;
};

/** What a core runtime exposes to fences: its current, immutable identity. */
export type CoreFenceView = {
  readonly epoch: CoreEpoch | null;
  readonly actionable: boolean;
  terminal(address: string): CoreMirrorTerminal | undefined;
  occupancy(address: string): number | null;
};

export type CoreFenceStage = "admission" | "dispatch" | "publication";

export class CoreFenceError extends Error {
  constructor(
    readonly stage: CoreFenceStage,
    readonly reason:
      | "lease"
      | "not-actionable"
      | "core-replaced"
      | "core-restarted"
      | "occupant-gone"
      | "occupant-replaced"
      | "foreground-changed",
  ) {
    super(`herdr-core operation refused at ${stage}: ${reason}`);
    this.name = "CoreFenceError";
  }
}

function foregroundOf(record: CoreMirrorTerminal) {
  const value = record.foreground as
    | { pid?: unknown; name?: unknown }
    | null
    | undefined;
  return value &&
    typeof value.pid === "number" &&
    typeof value.name === "string"
    ? { pid: value.pid, name: value.name }
    : null;
}

/** Records the current occupant of `address`, or null if none is live. */
export function captureOccupant(
  view: CoreFenceView,
  address: string,
  session: string | null = null,
): CoreOccupant | null {
  const record = view.terminal(address);
  const occupancy = view.occupancy(address);
  const epoch = view.epoch;
  if (
    !epoch ||
    !record ||
    record.remote ||
    record.state !== "live" ||
    typeof record.pid !== "number" ||
    occupancy === null
  )
    return null;
  return {
    coreId: epoch.coreId,
    address,
    pid: record.pid,
    occupancy,
    foreground: foregroundOf(record),
    session,
  };
}

/**
 * The authority one operation captured at admission. It is never refreshed:
 * the same lease, core process and occupant must still hold at dispatch and
 * at publication. A replacement lease or another profile reaching the same
 * core and address is a different authority.
 */
export type CoreFencedRuntime = ConnectionRuntime & { core: CoreFenceView };

export class CoreOperationFence<R extends CoreFencedRuntime> {
  readonly connectionId: string;
  readonly generation: number;
  private readonly epoch: CoreEpoch;

  private constructor(
    readonly lease: ReadyRuntimeLease<R>,
    epoch: CoreEpoch,
    readonly occupant: CoreOccupant | null,
  ) {
    this.connectionId = lease.connectionId;
    this.generation = lease.generation;
    this.epoch = epoch;
  }

  static admit<R extends CoreFencedRuntime>(
    lease: ReadyRuntimeLease<R>,
    address?: string,
    session: string | null = null,
  ): CoreOperationFence<R> {
    if (!lease.isCurrent()) throw new CoreFenceError("admission", "lease");
    const view = lease.runtime.core;
    if (!view.actionable || !view.epoch)
      throw new CoreFenceError("admission", "not-actionable");
    const occupant =
      address === undefined ? null : captureOccupant(view, address, session);
    if (address !== undefined && !occupant)
      throw new CoreFenceError("admission", "occupant-gone");
    return new CoreOperationFence<R>(lease, { ...view.epoch }, occupant);
  }

  /** Throws unless the captured authority still holds exactly. */
  check(stage: CoreFenceStage): void {
    if (!this.lease.isCurrent()) throw new CoreFenceError(stage, "lease");
    const view = this.lease.runtime.core;
    const epoch = view.epoch;
    if (!view.actionable || !epoch)
      throw new CoreFenceError(stage, "not-actionable");
    if (epoch.coreId !== this.epoch.coreId)
      throw new CoreFenceError(stage, "core-replaced");
    if (
      epoch.pid !== this.epoch.pid ||
      epoch.startedMs !== this.epoch.startedMs
    )
      throw new CoreFenceError(stage, "core-restarted");
    const occupant = this.occupant;
    if (!occupant) return;
    const record = view.terminal(occupant.address);
    if (!record || record.state !== "live" || typeof record.pid !== "number")
      throw new CoreFenceError(stage, "occupant-gone");
    if (
      record.pid !== occupant.pid ||
      view.occupancy(occupant.address) !== occupant.occupancy
    )
      throw new CoreFenceError(stage, "occupant-replaced");
    const foreground = foregroundOf(record);
    if (
      occupant.foreground &&
      (foreground?.pid !== occupant.foreground.pid ||
        foreground.name !== occupant.foreground.name)
    )
      throw new CoreFenceError(stage, "foreground-changed");
  }
}
