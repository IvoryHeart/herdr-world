import { isCoreAddress } from "../../../shared/coreAddress";
import type { CoreEventLine, CoreTerminalRecord } from "./client";

export type CoreMirrorLimits = {
  /** Terminals in one snapshot or mirror, linked machines included. */
  maxTerminals: number;
  /** Serialized bytes of one terminal record. */
  maxRecordBytes: number;
  /** Serialized bytes of one terminal's labels. */
  maxLabelBytes: number;
  /** Serialized bytes of the whole mirror. */
  maxMirrorBytes: number;
};

export const DEFAULT_CORE_MIRROR_LIMITS: CoreMirrorLimits = {
  maxTerminals: 4_096,
  maxRecordBytes: 256 * 1024,
  maxLabelBytes: 64 * 1024,
  maxMirrorBytes: 32 << 20,
};

/** Why observation stopped being actionable. The facts stay, marked stale. */
export type CoreRetirement =
  | "disconnected"
  | "gap"
  | "heartbeat-jump"
  | "limit"
  | "divergence"
  | "protocol";

export type CoreMirrorTerminal = Readonly<CoreTerminalRecord> & {
  /** Linked-machine terminals (`m/tN`) are discovery only. */
  readonly remote: boolean;
};

type Entry = {
  record: CoreMirrorTerminal;
  bytes: number;
  /** Increments whenever the program occupying the address may have changed. */
  occupancy: number;
};

export type ApplyOutcome =
  | "applied"
  | "stale"
  | "alive"
  | "retired"
  | "ignored";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

class AdmissionRefused extends Error {}

/**
 * The ordered observation of one core subscription. `seq` is core's global
 * event counter: an unfiltered subscriber sees every value, so any jump is a
 * lost event. Heartbeats prove liveness and expose suppressed loss; they never
 * advance the cursor. A missed snapshot replaces everything at its cut.
 */
export class CoreMirror {
  private entries = new Map<string, Entry>();
  private totalBytes = 0;
  private cursorValue = -1;
  private retiredReason: CoreRetirement | null = null;
  private occupancyCounter = 0;
  /** Event types this World does not model, by name: drift for the smoke test. */
  readonly unknownEvents = new Map<string, number>();

  constructor(
    private readonly limits: CoreMirrorLimits = DEFAULT_CORE_MIRROR_LIMITS,
  ) {}

  get cursor(): number {
    return this.cursorValue;
  }

  get baselined(): boolean {
    return this.cursorValue >= 0;
  }

  get actionable(): boolean {
    return this.baselined && this.retiredReason === null;
  }

  get retired(): CoreRetirement | null {
    return this.retiredReason;
  }

  get size(): number {
    return this.entries.size;
  }

  terminal(address: string): CoreMirrorTerminal | undefined {
    return this.entries.get(address)?.record;
  }

  terminals(): CoreMirrorTerminal[] {
    return [...this.entries.values()].map((entry) => entry.record);
  }

  /** A token that changes when the address may hold a different program. */
  occupancy(address: string): number | null {
    return this.entries.get(address)?.occupancy ?? null;
  }

  /** Atomically accepts a subscribe snapshot (any seq: a new process restarts it). */
  baseline(seq: number, terminals: readonly unknown[]): boolean {
    return this.replace(seq, terminals, null);
  }

  apply(line: CoreEventLine): ApplyOutcome {
    const seq = (line.params as { seq?: unknown }).seq;
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) {
      this.retire("protocol");
      return "retired";
    }
    // A missed snapshot is complete: it is a valid baseline on its own.
    if (line.method === "missed" && !this.baselined)
      return this.replace(seq, line.params.terminals, null)
        ? "applied"
        : "retired";
    if (!this.baselined) {
      this.retire("protocol");
      return "retired";
    }
    if (line.method === "missed") {
      if (seq < this.cursorValue) {
        this.retire("protocol");
        return "retired";
      }
      return this.replace(seq, line.params.terminals, this.retiredReason)
        ? "applied"
        : "retired";
    }
    if (this.retiredReason) return "ignored";
    if (line.method === "heartbeat") {
      if (seq === this.cursorValue) return "alive";
      // Above: core dropped events silently (an oversized `missed`).
      this.retire(seq > this.cursorValue ? "heartbeat-jump" : "protocol");
      return "retired";
    }
    if (line.method !== "event") return "ignored";
    if (seq <= this.cursorValue) return "stale";
    if (seq !== this.cursorValue + 1) {
      this.retire("gap");
      return "retired";
    }
    try {
      this.event(line.params);
    } catch (error) {
      this.retire(error instanceof AdmissionRefused ? "limit" : "divergence");
      return "retired";
    }
    this.cursorValue = seq;
    return "applied";
  }

  /** Stops actionability; the facts remain as the last (stale) observation. */
  retire(reason: CoreRetirement): void {
    this.retiredReason ??= reason;
  }

  private replace(
    seq: number,
    terminals: unknown,
    retained: CoreRetirement | null,
  ): boolean {
    if (!Number.isSafeInteger(seq) || seq < 0 || !Array.isArray(terminals)) {
      this.retire("protocol");
      return false;
    }
    if (terminals.length > this.limits.maxTerminals) {
      this.retire("limit");
      return false;
    }
    const previous = this.entries;
    const next = new Map<string, Entry>();
    let total = 0;
    try {
      for (const value of terminals) {
        const record = this.admit(value);
        if (next.has(record.address)) throw new Error("duplicate address");
        const before = previous.get(record.address);
        const entry = {
          record,
          bytes: bytesOf(record),
          occupancy: this.nextOccupancy(before, record),
        };
        total += entry.bytes;
        if (total > this.limits.maxMirrorBytes) throw new AdmissionRefused();
        next.set(record.address, entry);
      }
    } catch (error) {
      this.retire(error instanceof AdmissionRefused ? "limit" : "protocol");
      return false;
    }
    this.entries = next;
    this.totalBytes = total;
    this.cursorValue = seq;
    // A missed snapshot is a fresh cut of the same stream: it heals a retired
    // gap only if that retirement was detected on this same subscription.
    this.retiredReason =
      retained === "limit" || retained === "protocol" ? retained : null;
    return this.retiredReason === null;
  }

  private nextOccupancy(before: Entry | undefined, after: CoreMirrorTerminal) {
    if (before && !occupantChanged(before.record, after))
      return before.occupancy;
    return ++this.occupancyCounter;
  }

  private admit(value: unknown): CoreMirrorTerminal {
    if (
      !isRecord(value) ||
      typeof value.address !== "string" ||
      !isCoreAddress(value.address) ||
      !isRecord(value.labels) ||
      !Array.isArray(value.argv) ||
      typeof value.state !== "string"
    )
      throw new Error("terminal record is invalid");
    if (bytesOf(value.labels) > this.limits.maxLabelBytes)
      throw new AdmissionRefused();
    if (bytesOf(value) > this.limits.maxRecordBytes)
      throw new AdmissionRefused();
    return Object.freeze({
      ...(structuredClone(value) as CoreTerminalRecord),
      remote: value.address.includes("/"),
    });
  }

  private event(params: Record<string, unknown>) {
    const type = params.type;
    const address = params.terminal;
    if (type === "doc") return;
    if (typeof type !== "string" || typeof address !== "string")
      throw new Error("event is invalid");
    const data = isRecord(params.data) ? params.data : null;
    const entry = this.entries.get(address);
    const put = (record: CoreMirrorTerminal) => {
      const bytes = bytesOf(record);
      const total = this.totalBytes - (entry?.bytes ?? 0) + bytes;
      if (total > this.limits.maxMirrorBytes) throw new AdmissionRefused();
      if (!entry && this.entries.size >= this.limits.maxTerminals)
        throw new AdmissionRefused();
      this.entries.set(address, {
        record,
        bytes,
        occupancy: this.nextOccupancy(entry, record),
      });
      this.totalBytes = total;
    };
    const patch = (fields: Record<string, unknown>, drop: string[] = []) => {
      if (!entry) throw new Error(`event for unknown terminal ${address}`);
      const next: Record<string, unknown> = { ...entry.record, ...fields };
      for (const key of drop) delete next[key];
      put(this.admit(next));
    };
    switch (type) {
      case "created":
      case "restarted": {
        const record = this.admit(params.data);
        if (record.address !== address) throw new Error("address mismatch");
        put(record);
        if (type === "restarted" && entry) this.bump(address);
        return;
      }
      case "removed":
        if (!entry) throw new Error(`removed unknown terminal ${address}`);
        this.entries.delete(address);
        this.totalBytes -= entry.bytes;
        return;
      case "lost":
        return patch(
          {
            reason: data?.reason ?? null,
            exit_code: data?.exit_code ?? null,
            signal: data?.signal ?? null,
            finished_ms: data?.finished_ms ?? null,
            pid: null,
          },
          ["foreground"],
        );
      case "finished":
        return patch(
          {
            state: "finished",
            reason: data?.reason ?? null,
            exit_code: data?.exit_code ?? null,
            signal: data?.signal ?? null,
            finished_ms: data?.finished_ms ?? null,
          },
          ["foreground"],
        );
      case "keep":
        return patch({ keep: data?.keep === true });
      case "status":
        return patch({
          status: data?.status ?? null,
          records: isRecord(data?.records) ? data.records : {},
          reported: data?.reported === true,
        });
      case "turn":
        return patch({ turn: data?.turn ?? 0 });
      case "title":
        return patch({ title: data?.title ?? "" });
      case "size":
        return patch({ cols: data?.cols, rows: data?.rows });
      case "foreground":
        return patch({ foreground: data ?? null });
      case "labels": {
        if (!data || !isRecord(data.labels)) throw new Error("labels invalid");
        if (isRecord(data.record)) {
          const record = this.admit({ ...data.record, labels: data.labels });
          if (record.address !== address) throw new Error("address mismatch");
          return put(record);
        }
        return patch({ labels: data.labels });
      }
      default:
        // Additive protocol growth: keep ordering, report the drift.
        this.unknownEvents.set(type, (this.unknownEvents.get(type) ?? 0) + 1);
    }
  }

  private bump(address: string) {
    const entry = this.entries.get(address);
    if (entry) entry.occupancy = ++this.occupancyCounter;
  }
}

/**
 * Evidence that a different program may now hold the address: a new pid,
 * argv or template, or a program that stopped reporting status. Labels,
 * addresses and names survive a kept replacement and prove nothing.
 */
export function occupantChanged(
  before: CoreTerminalRecord,
  after: CoreTerminalRecord,
): boolean {
  return (
    before.pid !== after.pid ||
    JSON.stringify(before.argv) !== JSON.stringify(after.argv) ||
    (before.template ?? null) !== (after.template ?? null) ||
    (before.reported === true && after.reported !== true) ||
    (before.state === "live") !== (after.state === "live")
  );
}
