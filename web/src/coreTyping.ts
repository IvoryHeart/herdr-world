/**
 * Typing into a watched herdr-core terminal. The watch stays the display;
 * typing goes to World's server as `world.core.input`, which opens core's
 * keyboard on the first real key and gives the size back on
 * `world.core.leave`. This page sends one request at a time, in the order
 * typed, so no key overtakes another and leaving never overtakes a key.
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
  leave(): Promise<unknown>;
};

export type CoreTypingTimers = {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

/** Below the server's 64 KiB per request. */
export const CORE_INPUT_CHUNK = 32 * 1024;
/** Focus left the view this long: the size goes back. */
export const CORE_LEAVE_AFTER_BLUR_MS = 3_000;
/** No key for this long: the size goes back, even with the view focused. */
export const CORE_LEAVE_AFTER_IDLE_MS = 60_000;

type Waiter = { resolve(): void; reject(error: Error): void };
type Item =
  | {
      kind: "input";
      automatic: boolean;
      bytes: Uint8Array;
      size: CoreGrid;
      waiters: Waiter[];
    }
  | { kind: "leave" };

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

export class CoreTyping {
  private queue: Item[] = [];
  private busy = false;
  private stopped = false;
  /** The grid typed keys last asked for; null until typing, again after leaving. */
  private held: CoreGrid | null = null;
  private idleTimer: unknown = null;
  private blurTimer: unknown = null;

  constructor(
    private readonly port: CoreTypingPort,
    private readonly options: {
      /** World's fitted grid for this view, read when a key is typed. */
      size(): CoreGrid;
      /** A key was not sent; the keys queued behind it are dropped too. */
      refused(message: string): void;
      /** The grid World asked core for while it holds the keyboard; null once left. */
      changed?(held: CoreGrid | null): void;
      timers?: CoreTypingTimers;
      idleMs?: number;
      blurMs?: number;
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

  get typing(): boolean {
    return this.held !== null;
  }

  /**
   * Queues bytes for core. Genuine keys open the keyboard and take the
   * size; automatic replies go only while it is open. Resolves once sent.
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
    if (!automatic) this.armIdle();
    void this.pump();
    return Promise.all(sent).then(() => undefined);
  }

  /** Focus moved into or out of the view. */
  focus(inside: boolean): void {
    if (this.blurTimer !== null) this.timers.clear(this.blurTimer);
    this.blurTimer = null;
    if (inside || this.stopped) return;
    this.blurTimer = this.timers.set(() => {
      this.blurTimer = null;
      this.leave();
    }, this.options.blurMs ?? CORE_LEAVE_AFTER_BLUR_MS);
  }

  /** Gives core's size back after everything typed so far. */
  leave(): void {
    if (this.stopped) return;
    if (this.idleTimer !== null) this.timers.clear(this.idleTimer);
    this.idleTimer = null;
    if (this.queue[this.queue.length - 1]?.kind !== "leave")
      this.queue.push({ kind: "leave" });
    void this.pump();
  }

  /** The watch is closing: the server drops the keyboard with it. */
  stop(): void {
    this.stopped = true;
    for (const handle of [this.idleTimer, this.blurTimer])
      if (handle !== null) this.timers.clear(handle);
    this.idleTimer = this.blurTimer = null;
    this.fail(new Error("The terminal closed"));
    this.set(null);
  }

  private armIdle() {
    if (this.idleTimer !== null) this.timers.clear(this.idleTimer);
    this.idleTimer = this.timers.set(() => {
      this.idleTimer = null;
      this.leave();
    }, this.options.idleMs ?? CORE_LEAVE_AFTER_IDLE_MS);
  }

  private set(held: CoreGrid | null) {
    if (this.held?.cols === held?.cols && this.held?.rows === held?.rows)
      return;
    this.held = held && { ...held };
    this.options.changed?.(this.held);
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
        if (item.kind === "leave") {
          if (!this.held) continue;
          this.set(null);
          await this.port.leave().catch(() => undefined);
          continue;
        }
        // A reply with no keyboard open has nowhere to go: core answers it.
        if (item.automatic && !this.held) {
          for (const waiter of item.waiters) waiter.resolve();
          continue;
        }
        if (!item.automatic) this.set(item.size);
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
