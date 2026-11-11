import type { CoreCellSize, CoreKeyboard } from "./client";

/** One keystroke batch from the page, or its leave, in arrival order. */
export type CoreTyped =
  | {
      kind: "input" | "automatic";
      bytes: Uint8Array;
      size: CoreCellSize;
      done(sent: boolean, error?: Error): void;
    }
  | { kind: "leave" };

type Typed = Exclude<CoreTyped, { kind: "leave" }>;

/**
 * World typing into one watched terminal: an interactive viewer opened by
 * the first key a person types and left when they stop. Input that arrives
 * while it opens waits, in order, and is sent once after core's reply, or
 * reported not sent if the attach fails; it is never replayed. Synchronous:
 * the caller starts the attach (`open`) and reports how it ended.
 */
export class CoreTypingSession {
  private keys: CoreKeyboard | null = null;
  /** The attach is in flight: everything typed waits here. */
  private queue: CoreTyped[] | null = null;
  private queuedBytes = 0;
  /** The last size World sent core for this viewer. */
  private size: CoreCellSize | null = null;
  /** The size the attach in flight asked for. */
  private opening: CoreCellSize | null = null;
  /** FOCUS 1 was sent and not yet taken back. */
  private focused = false;
  /** The watch ended: nothing more is sent. */
  private closed = false;

  constructor(
    private readonly deps: {
      /** Start core's attach at this size; answer with `opened` or `failed`. */
      open(size: CoreCellSize): void;
      /** The watch's authority (lease, core, occupant) still holds. */
      fenced(): boolean;
      /** What may wait for the attach before more is refused. */
      maxQueuedBytes: number;
      /** The error a batch that was not sent reports. */
      notSent(): Error;
    },
  ) {}

  get state(): "no" | "opening" | "yes" {
    return this.queue ? "opening" : this.keys ? "yes" : "no";
  }

  /** Keys waiting for the attach, and whether a leave waits behind them. */
  get waiting(): { keys: number; leave: boolean } {
    const queue = this.queue ?? [];
    return {
      keys: queue.filter((typed) => typed.kind === "input").length,
      leave: queue.some((typed) => typed.kind === "leave"),
    };
  }

  /**
   * Typed bytes open the keyboard on first use (core then takes World's
   * size) and are sent once, in order. Automatic replies are sent only
   * while the keyboard is open or opening; otherwise they are dropped
   * (`sent: false`), so a view nobody types into never sends core anything.
   */
  input(typed: Typed): void {
    if (this.closed) {
      typed.done(false, this.deps.notSent());
      return;
    }
    if (typed.kind === "automatic" && !this.keys && !this.queue) {
      typed.done(false);
      return;
    }
    if (this.queue) {
      if (
        this.queuedBytes + typed.bytes.byteLength >
        this.deps.maxQueuedBytes
      ) {
        typed.done(false, this.deps.notSent());
        return;
      }
      this.queuedBytes += typed.bytes.byteLength;
      this.queue.push(typed);
      return;
    }
    if (this.keys) {
      this.type(typed);
      return;
    }
    this.start([typed]);
  }

  /**
   * The page stopped typing (it lost focus or went idle): leave, so core
   * gives the size back to the Herdr app's pane, or to headless. Anything
   * typed before it is sent first.
   */
  leave(): void {
    if (this.closed) return;
    if (this.queue) this.queue.push({ kind: "leave" });
    else this.drop();
  }

  /** Core answered the attach: send what waited, in order. */
  opened(keys: CoreKeyboard): void {
    const size = this.opening;
    this.opening = null;
    if (this.closed || !keys.open || !size) {
      keys.detach();
      this.failed(this.deps.notSent());
      return;
    }
    this.keys = keys;
    this.size = { ...size };
    // Typing in World's view focuses it: a program that asked to hear
    // focus changes hears this one (core sends nothing otherwise).
    keys.focus(true);
    this.focused = true;
    const queue = this.queue ?? [];
    this.queue = null;
    this.queuedBytes = 0;
    this.drain(queue);
  }

  /** The attach failed: nothing that waited for it is sent. */
  failed(error: Error): void {
    this.opening = null;
    const queue = this.queue ?? [];
    this.queue = null;
    this.queuedBytes = 0;
    for (const typed of queue)
      if (typed.kind !== "leave") typed.done(false, error);
  }

  /** Core ended this keyboard: the next key opens another. */
  ended(keys: CoreKeyboard): void {
    if (this.keys !== keys) return;
    this.keys = null;
    this.focused = false;
    this.size = null;
  }

  /** The watch ends: nothing waiting is sent and the keyboard leaves. */
  close(): void {
    this.closed = true;
    this.failed(this.deps.notSent());
    this.drop();
  }

  private start(queue: CoreTyped[]) {
    const first = queue[0] as Typed;
    this.queue = queue;
    this.queuedBytes = queue.reduce(
      (n, t) => n + (t.kind === "leave" ? 0 : t.bytes.byteLength),
      0,
    );
    if (!this.deps.fenced()) {
      this.failed(this.deps.notSent());
      return;
    }
    this.opening = { ...first.size };
    this.deps.open(first.size);
  }

  /** A leave among the queue leaves; a key after it opens a new keyboard. */
  private drain(queue: CoreTyped[]) {
    while (queue.length > 0) {
      const typed = queue.shift()!;
      if (this.closed) {
        if (typed.kind !== "leave") typed.done(false, this.deps.notSent());
        continue;
      }
      if (typed.kind === "leave") {
        this.drop();
        continue;
      }
      if (this.keys) {
        this.type(typed);
        continue;
      }
      if (typed.kind === "automatic") {
        typed.done(false);
        continue;
      }
      this.start([typed, ...queue]);
      return;
    }
  }

  /** Sends one batch on the open keyboard, re-fenced first. */
  private type(typed: Typed) {
    const keys = this.keys;
    if (!keys || !keys.open || !this.deps.fenced()) {
      typed.done(false, this.deps.notSent());
      return;
    }
    if (typed.kind === "automatic") {
      if (!keys.automatic) {
        typed.done(false);
        return;
      }
      keys.automaticInput(typed.bytes);
      typed.done(keys.open);
      return;
    }
    const size = typed.size;
    if (
      !this.size ||
      this.size.cols !== size.cols ||
      this.size.rows !== size.rows
    ) {
      keys.resize(size);
      this.size = { ...size };
    }
    keys.input(typed.bytes);
    if (keys.open) typed.done(true);
    else typed.done(false, this.deps.notSent());
  }

  /** Leaves the keyboard: focus back, then CLOSE, so core re-applies its size rule. */
  private drop() {
    const keys = this.keys;
    this.keys = null;
    this.size = null;
    if (!keys) return;
    if (this.focused && keys.open) keys.focus(false);
    this.focused = false;
    keys.detach();
  }
}
