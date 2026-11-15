/**
 * Typing into a watched herdr-core terminal and holding its size. While the
 * view is open it asks World's server to hold the grid that fits it
 * (`world.core.hold`): core gives World that size when no Herdr app leads,
 * and never takes it from one. Typing goes as `world.core.input`. This page
 * sends one request at a time, in order, so no key overtakes another or a
 * size. Nothing is given back on blur or idle; closing the view does that.
 */

import type { CoreGrid } from "./coreWatch";

export type CoreInputBatch = {
  /** Base64 of the bytes. */
  data: string;
  cols: number;
  rows: number;
  /** A terminal reply (a cursor report, say), not a key: never takes the size. */
  automatic?: true;
};

export type CoreTypingPort = {
  input(batch: CoreInputBatch): Promise<unknown>;
  hold(size: CoreGrid): Promise<unknown>;
};

export type CoreTypingTimers = {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

/** Below the server's 64 KiB per request. */
export const CORE_INPUT_CHUNK = 32 * 1024;
/** A resize settles this long before World asks core for the new size. */
export const CORE_HOLD_SETTLE_MS = 150;

type Waiter = { resolve(): void; reject(error: Error): void };
type Item =
  | {
      kind: "input";
      automatic: boolean;
      bytes: Uint8Array;
      size: CoreGrid;
      waiters: Waiter[];
    }
  | { kind: "hold"; size: CoreGrid };

const encoder = new TextEncoder();

function base64(bytes: Uint8Array): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(raw);
}

function joined(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const sameGrid = (a: CoreGrid | null, b: CoreGrid | null) =>
  a?.cols === b?.cols && a?.rows === b?.rows;

export class CoreTyping {
  private queue: Item[] = [];
  private busy = false;
  private stopped = false;
  /** The grid last sent to hold; null before the first. */
  private sentHold: CoreGrid | null = null;
  /** The grid the view fits now, waiting out the settle time. */
  private pending: CoreGrid | null = null;
  private settle: unknown = null;

  constructor(
    private readonly port: CoreTypingPort,
    private readonly options: {
      /** World's fitted grid for this view, read when a key is typed. */
      size(): CoreGrid;
      /** A key was not sent; the keys queued behind it are dropped too. */
      refused(message: string): void;
      /** The grid World asked core to hold for this view. */
      changed?(held: CoreGrid | null): void;
      timers?: CoreTypingTimers;
      settleMs?: number;
    },
  ) {}

  private get timers(): CoreTypingTimers {
    return (
      this.options.timers ?? {
        set: (run, ms) => setTimeout(run, ms),
        clear: (handle) => clearTimeout(handle as number),
      }
    );
  }

  /**
   * The view fits `size` now. The first size goes at once; later ones once
   * the view stops changing, so a drag asks core for one size, not dozens.
   */
  hold(size: CoreGrid): void {
    if (this.stopped || size.cols <= 0 || size.rows <= 0) return;
    this.pending = { ...size };
    if (this.settle !== null) this.timers.clear(this.settle);
    this.settle = null;
    if (this.sentHold === null) {
      this.flushHold();
      return;
    }
    this.settle = this.timers.set(() => {
      this.settle = null;
      this.flushHold();
    }, this.options.settleMs ?? CORE_HOLD_SETTLE_MS);
  }

  /**
   * Queues bytes for core. Genuine keys open World's seat if it has none
   * (and take the size); automatic replies go only on a seat a person typed
   * into. Resolves once sent.
   */
  type(data: string | Uint8Array, automatic = false): Promise<void> {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    if (this.stopped || bytes.length === 0) return Promise.resolve();
    const size = this.options.size();
    const sent: Promise<void>[] = [];
    for (let at = 0; at < bytes.length; at += CORE_INPUT_CHUNK) {
      const chunk = bytes.subarray(at, at + CORE_INPUT_CHUNK);
      sent.push(
        new Promise<void>((resolve, reject) => {
          const last = this.queue[this.queue.length - 1];
          const waiter = { resolve, reject };
          if (
            last?.kind === "input" &&
            last.automatic === automatic &&
            last.bytes.length + chunk.length <= CORE_INPUT_CHUNK
          ) {
            last.bytes = joined([last.bytes, chunk]);
            last.size = size;
            last.waiters.push(waiter);
          } else
            this.queue.push({
              kind: "input",
              automatic,
              bytes: chunk,
              size,
              waiters: [waiter],
            });
        }),
      );
    }
    void this.pump();
    return Promise.all(sent).then(() => undefined);
  }

  /** The watch is closing: the server lets the seat go with it. */
  stop(): void {
    this.stopped = true;
    if (this.settle !== null) this.timers.clear(this.settle);
    this.settle = null;
    this.fail(new Error("The terminal closed"));
    this.options.changed?.(null);
  }

  private flushHold() {
    const size = this.pending;
    this.pending = null;
    if (!size || this.stopped) return;
    const last = this.queue[this.queue.length - 1];
    if (last?.kind === "hold") last.size = size;
    else this.queue.push({ kind: "hold", size });
    void this.pump();
  }

  private fail(error: Error) {
    for (const item of this.queue.splice(0))
      if (item.kind === "input")
        for (const waiter of item.waiters) waiter.reject(error);
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (!this.stopped && this.queue.length > 0) {
        const item = this.queue.shift()!;
        if (item.kind === "hold") {
          if (sameGrid(item.size, this.sentHold)) continue;
          this.sentHold = { ...item.size };
          this.options.changed?.(this.sentHold);
          // A watch that ended answers `held: false`; the stream says why.
          await this.port.hold(item.size).catch(() => undefined);
          continue;
        }
        try {
          await this.port.input({
            data: base64(item.bytes),
            cols: item.size.cols,
            rows: item.size.rows,
            ...(item.automatic ? { automatic: true as const } : {}),
          });
          for (const waiter of item.waiters) waiter.resolve();
        } catch (error) {
          const failure =
            error instanceof Error ? error : new Error(String(error));
          for (const waiter of item.waiters) waiter.reject(failure);
          // Later keys would land without the ones that failed.
          this.fail(failure);
          if (!this.stopped) this.options.refused(failure.message);
        }
      }
    } finally {
      this.busy = false;
    }
  }
}

/** xterm's own focus reports: core sends its own when the keyboard focuses. */
export function isFocusReport(data: string): boolean {
  return data === "\x1b[I" || data === "\x1b[O";
}

/**
 * The grid that fits the view at actual size, from the drawn size of the
 * grid core holds now. Falls back to that grid before anything is drawn.
 */
export function fittedGrid(
  grid: CoreGrid,
  drawn: { width: number; height: number },
  view: { width: number; height: number },
): CoreGrid {
  if (drawn.width <= 0 || drawn.height <= 0) return { ...grid };
  const cellWidth = drawn.width / grid.cols;
  const cellHeight = drawn.height / grid.rows;
  const clamp = (n: number) => Math.min(0xffff, Math.max(2, Math.floor(n)));
  return {
    cols: clamp(view.width / cellWidth),
    rows: clamp(view.height / cellHeight),
  };
}

/**
 * Tells typed keys from xterm's own replies. xterm's internal user-input
 * event fires just before `onData` for keys, pastes and composition, never
 * for query replies or focus reports. Null when this xterm lacks it: the
 * view then stays watch-only rather than guess.
 */
export function userInputSignal(terminal: unknown): {
  take(): boolean;
  dispose(): void;
} | null {
  const service = (
    terminal as {
      _core?: {
        coreService?: {
          onUserInput?: (listener: () => void) => { dispose(): void };
        };
      };
    }
  )._core?.coreService;
  if (typeof service?.onUserInput !== "function") return null;
  let flagged = false;
  const subscription = service.onUserInput(() => {
    flagged = true;
  });
  return {
    take() {
      const was = flagged;
      flagged = false;
      return was;
    },
    dispose: () => subscription.dispose(),
  };
}
