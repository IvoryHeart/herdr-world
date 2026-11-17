import assert from "node:assert/strict";
import type { CoreKeyboard } from "../server/src/herdr-core/client";
import type { CoreState, CoreSubjects } from "./herdr-core-runtime";

/** World's seat as the replay's core keeps it: its grid and whether typed in. */
type Seat = CoreKeyboard & {
  open: boolean;
  grid: number;
  touched: boolean;
  end(): void;
};

/** A core-to-World frame on the watch stream, tagged with its grid. */
export type Frame = { kind: string; grid: number; stream: number };

/**
 * The model's grid ids as cells: pane sizes, headless, and two sizes no pane
 * set (an unviewed terminal's creation size; the sizes World's view holds).
 */
const GRIDS: ReadonlyArray<readonly [number, number]> = [
  [96, 28],
  [132, 40],
  [200, 120],
  [100, 30],
  [120, 36],
];
const gridId = (cols: number, rows: number) =>
  GRIDS.findIndex(([c, r]) => c === cols && r === rows);
const cells = (g: number) => ({ cols: GRIDS[g]![0], rows: GRIDS[g]![1] });
/** World's fitted grid when a key opens a seat before any size was held. */
const WORLD = cells(3);
const KEY = new TextEncoder().encode("a");
const REPLY = new TextEncoder().encode("\x1b[1;1R");

/**
 * The observe family's replay: core's size rule and credit behaviour as the
 * design seam, World's production attach/reply rules and the page's
 * production grid adoption (`CoreWatchScreen`) as the subjects.
 */
export class CoreWatchReplay {
  /**
   * World's production seat session for the current watch, and the seats
   * core attached for it (design seam: core's size rule).
   */
  private session: InstanceType<CoreSubjects["CoreTypingSession"]> | null =
    null;
  private seats: Seat[] = [];
  /** The seat the session holds now (the last one core answered). */
  private current: Seat | null = null;
  /** The seat that last typed, focused or resized: core's touch. */
  private toucher: Seat | null = null;
  /** The grid id of the attach in flight, or -1. */
  private attaching = -1;
  /**
   * The page's production watch model for the current stream; its surface
   * records which grid each paint is drawn on.
   */
  private screen: InstanceType<CoreSubjects["CoreWatchScreen"]> | null = null;
  private surfaceGrid = -1;

  constructor(
    private readonly state: () => CoreState,
    private readonly subjects: CoreSubjects,
  ) {}

  /** Core's side of a grid change for World's watch (design seam: core). */
  private wire(g: number) {
    const s = this.state();
    if (!s.watching || !s.confirmed) return;
    if (s.credit) {
      s.backlog = false;
      s.frames.push(
        { kind: "resize", grid: g, stream: s.stream },
        { kind: "data", grid: g, stream: s.stream },
      );
    } else {
      s.pendingGrid = g;
      s.backlog = false;
    }
  }

  /**
   * Core's size rule (design seam): the viewer that last typed, resized or
   * focused leads; a resumed seat nobody touched ranks lowest, and among
   * those the last attached leads, so a seat leads alone once the pane closes.
   */
  private coreGrid(): number {
    const s = this.state();
    if (s.worldLeads && this.toucher?.open) return this.toucher.grid;
    if (s.lead >= 0) return s.lead;
    return this.seats.filter((seat) => seat.open).at(-1)?.grid ?? 2;
  }

  private regrid() {
    const s = this.state();
    const g = this.coreGrid();
    if (g === s.grid) return;
    s.grid = g;
    this.wire(g);
  }

  /** The watch ends with its stream (unwatch, disconnect or restart). */
  endWatch() {
    const s = this.state();
    if (!s.watching) return;
    s.watching = false;
    s.stream++;
    s.credit = true;
    s.pendingGrid = -1;
    s.backlog = false;
    this.screen = null;
    // World's seat goes with the watch (production session).
    const session = this.session;
    this.session = null;
    this.attaching = -1;
    session?.close();
    this.seats = [];
    this.current = null;
    this.toucher = null;
    s.held = -1;
    s.seated = false;
    s.lost = false;
    this.sync(null);
  }

  /** The model's view of the seat session. */
  private sync(
    session: InstanceType<CoreSubjects["CoreTypingSession"]> | null,
  ) {
    const s = this.state();
    const seat =
      session?.state === "yes" && this.current?.open ? this.current : null;
    s.seat = seat?.grid ?? -1;
    s.touched = seat?.touched ?? false;
    const opening = session?.attaching;
    s.opening = opening ? gridId(opening.cols, opening.rows) : -1;
    s.waiting = session?.waiting ?? 0;
  }

  /** Core's resumed interactive viewer for World's seat (design seam: core). */
  private attach(grid: number): Seat {
    const s = this.state();
    const touch = () => {
      this.toucher = seat;
      s.worldLeads = true;
      this.regrid();
    };
    const seat: Seat = {
      channel: 2 + this.seats.length,
      terminal: { address: "t0", labels: {}, argv: [], state: "running" },
      automatic: true,
      open: true,
      grid,
      touched: false,
      input: () => {
        s.sent++;
        if (!seat.open || s.replaced) s.stray = true;
        seat.touched = true;
        touch();
      },
      // Automatic input never touches the viewer.
      automaticInput: () => {
        if (!seat.open) s.stray = true;
        if (!seat.touched) s.echo = true;
      },
      resize: (size) => {
        seat.grid = gridId(size.cols, size.rows);
        touch();
      },
      focus: (focused: boolean) => {
        if (!focused) return;
        seat.touched = true;
        touch();
      },
      detach: () => seat.end(),
      end: () => {
        if (!seat.open) return;
        seat.open = false;
        if (this.toucher === seat) s.worldLeads = false;
        this.regrid();
      },
    } as Seat;
    this.seats.push(seat);
    return seat;
  }

  /** One batch the page sends, through World's production session. */
  private type(automatic: boolean) {
    const s = this.state();
    this.session!.input({
      kind: automatic ? "automatic" : "input",
      bytes: automatic ? REPLY : KEY,
      size: { ...WORLD },
      done: (sent) => {
        if (!automatic && !sent) s.refused++;
      },
    });
  }

  /** A watch frame reaching the page, through the production page model. */
  private present(f: Frame) {
    const s = this.state();
    // World's client drops frames of a stream it ended (retired channel or
    // dead connection): design seam, covered by the client's own tests.
    if (!s.watching || f.stream !== s.stream || !this.screen) return;
    const [cols, rows] = GRIDS[f.grid]!;
    const stream = `s${s.stream}`;
    if (f.kind === "resize") {
      this.screen.apply({ stream, grid: { cols, rows } });
      s.shown = this.surfaceGrid;
      return;
    }
    try {
      this.screen.apply({ stream, bytes: btoa(`paint for grid ${f.grid}`) });
    } catch {
      // Bytes before any grid: the page refuses to draw them at a guess.
    }
  }

  private watch(target: number) {
    const s = this.state();
    assert(s.ready && !s.watching && s.stream < 2);
    // World's production attach and reply rules decide what happens.
    const params = this.subjects.watchAttachParams("t1", {
      cols: GRIDS[s.grid]![0],
      rows: GRIDS[s.grid]![1],
    });
    const path = target === 1;
    s.confirmed = path;
    try {
      this.subjects.acceptWatchReply({
        channel: 1,
        terminal: {},
        resize_notifications: path,
      });
    } catch {
      return; // refused and closed: no watch, nothing drawn
    }
    // Core's size rule: an observer never leads; a typing attach does.
    const led = params.observe !== true ? 3 : s.lead >= 0 ? s.lead : 2;
    s.watching = true;
    s.grid = led;
    s.shown = -1;
    s.credit = true;
    s.pendingGrid = -1;
    s.backlog = false;
    this.surfaceGrid = -1;
    this.attaching = -1;
    this.seats = [];
    this.current = null;
    this.toucher = null;
    const session = new this.subjects.CoreTypingSession({
      open: (size) => {
        const grid = gridId(size.cols, size.rows);
        assert(grid === 3 || grid === 4, "World's seat opens at its size");
        assert(this.attaching < 0, "one seat attach at a time");
        this.attaching = grid;
      },
      fenced: () => {
        if (!this.state().replaced) return true;
        // World's fence ends the watch: the program is not the one typed for.
        if (this.session === session) this.endWatch();
        return false;
      },
      maxQueuedBytes: 256 * 1024,
      notSent: () => new Error("Not sent"),
    });
    this.session = session;
    this.screen = new this.subjects.CoreWatchScreen({
      resize: (cols: number, rows: number) => {
        this.surfaceGrid = gridId(cols, rows);
      },
      write: (bytes: Uint8Array) => {
        const drawnFor = Number(
          new TextDecoder().decode(bytes).split(" ").at(-1),
        );
        if (this.surfaceGrid !== drawnFor) s.misdrawn = true;
      },
    });
    if (path)
      s.frames.push(
        { kind: "resize", grid: led, stream: s.stream },
        { kind: "data", grid: led, stream: s.stream },
      );
    else s.frames.push({ kind: "data", grid: led, stream: s.stream });
  }

  /** One observe-family transition. */
  apply(op: string, target: number) {
    const s = this.state();
    switch (op) {
      case "pane": {
        // The desktop pane (core's typing viewer) opens, resizes or closes.
        assert(s.running && s.changes < 3);
        const g = target === 2 ? -1 : target;
        assert(g !== s.lead && !s.replaced);
        s.lead = g;
        s.changes++;
        // A pane that resizes was touched: it leads again.
        if (g >= 0) s.worldLeads = false;
        this.regrid();
        return;
      }
      case "paneTouch":
        assert(s.running && s.changes < 3 && s.lead >= 0 && s.worldLeads);
        assert(!s.replaced);
        s.changes++;
        s.worldLeads = false;
        this.regrid();
        return;
      case "hold": {
        assert(s.watching && s.holds < 2 && target !== s.held && !s.replaced);
        const session = this.session!;
        s.held = target;
        s.holds++;
        session.hold(cells(target));
        return this.sync(this.session === session ? session : null);
      }
      case "key": {
        assert(s.watching && s.pressed < 2);
        const session = this.session!;
        s.pressed++;
        this.type(false);
        return this.sync(this.session === session ? session : null);
      }
      case "attached": {
        assert(this.attaching >= 0 && this.session);
        const grid = this.attaching;
        this.attaching = -1;
        // A resumed attach applies core's rule but never leads by itself.
        const seat = this.attach(grid);
        this.regrid();
        this.session.opened(seat);
        if (seat.open && this.session.state === "yes") {
          this.current = seat;
          s.seated = true;
        }
        return this.sync(this.session);
      }
      case "attachRefused":
        assert(this.attaching >= 0 && this.session);
        this.attaching = -1;
        this.session.failed(new Error("refused"));
        if (this.session.state !== "yes") s.lost = true;
        return this.sync(this.session);
      case "reply":
        assert(this.session && s.watching && s.replies < 1 && !s.replaced);
        s.replies++;
        this.type(true);
        return this.sync(this.session);
      case "seatLost": {
        const seat = this.current;
        assert(this.session && seat?.open && s.seat >= 0 && !s.replaced);
        seat.end();
        this.session.ended(seat);
        s.lost = true;
        return this.sync(this.session);
      }
      case "reoccupy":
        assert(s.seat >= 0 && !s.replaced);
        s.replaced = true;
        return;
      case "output":
        assert(s.running && s.outputs < 2 && s.frames.length < 4);
        s.outputs++;
        if (s.watching && s.credit)
          s.frames.push({ kind: "data", grid: s.grid, stream: s.stream });
        s.backlog ||= s.watching && !s.credit && s.pendingGrid < 0;
        return;
      case "watch":
        return this.watch(target);
      case "unwatch":
        assert(s.watching);
        return this.endWatch();
      case "stall":
        assert(s.watching && s.credit);
        s.credit = false;
        return;
      case "drain":
        assert(s.watching && !s.credit);
        if (s.pendingGrid >= 0)
          s.frames.push(
            { kind: "resize", grid: s.pendingGrid, stream: s.stream },
            { kind: "data", grid: s.pendingGrid, stream: s.stream },
          );
        else if (s.backlog)
          s.frames.push({ kind: "data", grid: s.grid, stream: s.stream });
        s.credit = true;
        s.pendingGrid = -1;
        s.backlog = false;
        return;
      case "frame":
        assert(s.frames.length > 0);
        return this.present(s.frames.shift()!);
      case "viewport":
        // A rotation or keyboard: the page rescales; World sends core nothing.
        assert(s.watching && !s.typed);
        return;
      default:
        assert.fail(`not an observe transition: ${op}`);
    }
  }
}
