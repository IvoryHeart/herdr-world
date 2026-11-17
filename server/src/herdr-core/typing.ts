import type { CoreCellSize, CoreKeyboard } from "./client";

/** One batch from the page: keys a person typed, or a terminal's reply. */
export type CoreTyped = {
  kind: "input" | "automatic";
  bytes: Uint8Array;
  /** The page's grid when it sent this; used only to open a first seat. */
  size: CoreCellSize;
  done(sent: boolean, error?: Error): void;
};

const sameSize = (a: CoreCellSize | null, b: CoreCellSize | null) =>
  Boolean(a && b && a.cols === b.cols && a.rows === b.rows);

/**
 * World's seat on one watched terminal: an interactive viewer attached
 * `resumed` at the page's fitted grid for as long as its view is open.
 * Core's size rule decides who leads: a resumed viewer that never typed
 * ranks below every other interactive viewer, so the seat sets the size only
 * when no Herdr app pane has the terminal, and a person typing here (input
 * or FOCUS 1 touch the viewer) leads until the app pane is used again. World
 * never sends RESIZE: a new page size swaps the seat (attach a new resumed
 * seat, then leave the old one), so a size change never takes the terminal
 * from an app pane. Nothing is given back on blur or idle; closing the view
 * (or the watch ending) leaves.
 *
 * Keys typed before a seat exists wait, in order, and are sent once after
 * core's reply, or reported not sent if the attach fails; never replayed.
 * Synchronous: the caller starts the attach (`open`) and reports how it
 * ended.
 */
export class CoreTypingSession {
  private seat: CoreKeyboard | null = null;
  private seatSize: CoreCellSize | null = null;
  /** A person typed on this seat: FOCUS 1 went, replies may follow. */
  private touched = false;
  /** The size the attach in flight asked for. */
  private opening: CoreCellSize | null = null;
  /** The page's newest fitted grid. */
  private held: CoreCellSize | null = null;
  /** Keys typed while no seat is open, waiting for the one opening. */
  private queue: CoreTyped[] = [];
  private queuedBytes = 0;
  /** The watch ended: nothing more is sent. */
  private closed = false;

  constructor(
    private readonly deps: {
      /** Start core's resumed attach at this size; answer with `opened` or `failed`. */
      open(size: CoreCellSize): void;
      /** The watch's authority (lease, core, occupant) still holds. */
      fenced(): boolean;
      /** What may wait for the attach before more is refused. */
      maxQueuedBytes: number;
      /** The error a batch that was not sent reports. */
      notSent(): Error;
    },
  ) {}

  /** A seat is open ("yes"), only opening ("opening"), or neither. */
  get state(): "no" | "opening" | "yes" {
    return this.seat ? "yes" : this.opening ? "opening" : "no";
  }

  /** The size of the attach in flight (a first seat or a swap), if any. */
  get attaching(): CoreCellSize | null {
    return this.opening ? { ...this.opening } : null;
  }

  /** Keys waiting for a seat. */
  get waiting(): number {
    return this.queue.length;
  }

  /** The page's view is open at this fitted grid: hold a seat there. */
  hold(size: CoreCellSize): void {
    if (this.closed) return;
    this.held = { ...size };
    // A seat opening re-checks the newest size when core answers.
    if (this.opening || sameSize(this.seatSize, size)) return;
    this.start(size);
  }

  /**
   * Typed bytes go on the open seat; with none they wait for one (opening it
   * at the held size). Automatic replies go only on a seat a person typed
   * into, so a view nobody typed into never answers for the app's pane.
   */
  input(typed: CoreTyped): void {
    if (this.closed) {
      typed.done(false, this.deps.notSent());
      return;
    }
    if (this.seat) {
      this.type(typed);
      return;
    }
    if (typed.kind === "automatic") {
      typed.done(false);
      return;
    }
    if (this.queuedBytes + typed.bytes.byteLength > this.deps.maxQueuedBytes) {
      typed.done(false, this.deps.notSent());
      return;
    }
    this.queue.push(typed);
    this.queuedBytes += typed.bytes.byteLength;
    if (!this.opening) this.start(this.held ?? typed.size);
  }

  /** Core answered the attach: it becomes the seat; the old one leaves. */
  opened(keys: CoreKeyboard): void {
    const size = this.opening;
    this.opening = null;
    if (this.closed || !keys.open || !size) {
      keys.detach();
      if (!this.seat) this.refuse(this.deps.notSent());
      return;
    }
    const old = this.seat;
    const typed = this.touched;
    this.seat = keys;
    this.seatSize = { ...size };
    this.touched = false;
    if (old) this.leave(old, typed);
    const queue = this.queue;
    this.queue = [];
    this.queuedBytes = 0;
    for (const waiting of queue) this.input(waiting);
    if (this.held && !sameSize(this.held, this.seatSize)) this.start(this.held);
  }

  /** The attach failed: an open seat stays; keys waiting for none are refused. */
  failed(error: Error): void {
    this.opening = null;
    if (!this.seat) this.refuse(error);
  }

  /** Core ended this seat: the next key or size opens another. */
  ended(keys: CoreKeyboard): void {
    if (this.seat !== keys) return;
    this.seat = null;
    this.seatSize = null;
    this.touched = false;
  }

  /** The watch ends: nothing waiting is sent and the seat leaves. */
  close(): void {
    this.closed = true;
    this.refuse(this.deps.notSent());
    const seat = this.seat;
    this.seat = null;
    this.seatSize = null;
    if (seat) this.leave(seat, this.touched);
    this.touched = false;
  }

  private start(size: CoreCellSize) {
    if (!this.deps.fenced()) {
      this.refuse(this.deps.notSent());
      return;
    }
    this.opening = { ...size };
    this.deps.open(size);
  }

  private refuse(error: Error) {
    const queue = this.queue;
    this.queue = [];
    this.queuedBytes = 0;
    for (const typed of queue) typed.done(false, error);
  }

  /** Sends one batch on the open seat, re-fenced first. */
  private type(typed: CoreTyped) {
    const seat = this.seat;
    if (!seat || !seat.open || !this.deps.fenced()) {
      typed.done(false, this.deps.notSent());
      return;
    }
    if (typed.kind === "automatic") {
      if (!this.touched || !seat.automatic) {
        typed.done(false);
        return;
      }
      seat.automaticInput(typed.bytes);
      typed.done(seat.open);
      return;
    }
    if (!this.touched) {
      // Typing in World's view focuses it: a program that asked to hear
      // focus changes hears this one (core sends nothing otherwise).
      seat.focus(true);
      this.touched = true;
    }
    seat.input(typed.bytes);
    if (seat.open) typed.done(true);
    else typed.done(false, this.deps.notSent());
  }

  /** A seat leaves: focus back if it was typed in, then CLOSE. */
  private leave(seat: CoreKeyboard, typed: boolean) {
    if (typed && seat.open) seat.focus(false);
    seat.detach();
  }
}
