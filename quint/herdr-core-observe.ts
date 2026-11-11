import assert from "node:assert/strict";
import type { CoreKeyboard } from "../server/src/herdr-core/client";
import type { CoreState, CoreSubjects } from "./herdr-core-runtime";

/** A core-to-World frame on the watch stream, tagged with its grid. */
export type Frame = { kind: string; grid: number; stream: number };

/** The model's grid ids as cells: pane sizes, headless, a size no pane set. */
const GRIDS: ReadonlyArray<readonly [number, number]> = [
  [96, 28],
  [132, 40],
  [200, 120],
  [100, 30],
];
const gridId = (cols: number, rows: number) =>
  GRIDS.findIndex(([c, r]) => c === cols && r === rows);
/** World's fitted grid for its view: grid id 3. */
const WORLD = { cols: GRIDS[3]![0], rows: GRIDS[3]![1] };
const KEY = new TextEncoder().encode("a");
const REPLY = new TextEncoder().encode("\x1b[1;1R");

/**
 * The observe family's replay: core's size rule and credit behaviour as the
 * design seam, World's production attach/reply rules and the page's
 * production grid adoption (`CoreWatchScreen`) as the subjects.
 */
export class CoreWatchReplay {
  /**
   * World's production typing session for the current watch, and the
   * keyboard core attached for it (design seam: core's size rule).
   */
  private session: InstanceType<CoreSubjects["CoreTypingSession"]> | null =
    null;
  private keyboard: (CoreKeyboard & { end(): void }) | null = null;
  private attaching = false;
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
   * focused leads; World's keyboard leads alone once the pane closes.
   */
  private coreGrid(): number {
    const s = this.state();
    if (this.keyboard?.open && (s.worldLeads || s.lead < 0)) return 3;
    return s.lead >= 0 ? s.lead : 2;
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
    // World's keyboard goes with the watch (production session).
    const session = this.session;
    this.session = null;
    this.attaching = false;
    session?.close();
    this.keyboard = null;
    this.sync(null);
  }

  /** The model's view of the typing session. */
  private sync(
    session: InstanceType<CoreSubjects["CoreTypingSession"]> | null,
  ) {
    const s = this.state();
    const state = session?.state ?? "no";
    s.keys = state === "yes" ? 2 : state === "opening" ? 1 : 0;
    const waiting = session?.waiting ?? { keys: 0, leave: false };
    s.waiting = waiting.keys;
    s.left = waiting.leave;
    s.asked = s.keys > 0;
    if (s.keys === 0) s.worldLeads = false;
  }

  /** Core's interactive viewer for World (design seam: core). */
  private attach(): CoreKeyboard & { end(): void } {
    const s = this.state();
    const lead = () => {
      s.worldLeads = true;
      this.regrid();
    };
    const keyboard = {
      channel: 2,
      terminal: { address: "t0", labels: {}, argv: [], state: "running" },
      automatic: true,
      open: true,
      input: () => {
        s.sent++;
        if (!keyboard.open || s.replaced) s.stray = true;
        lead();
      },
      // Automatic input never touches the viewer.
      automaticInput: () => {
        if (!keyboard.open) s.stray = true;
      },
      resize: lead,
      focus: (focused: boolean) => {
        if (focused) lead();
      },
      detach: () => keyboard.end(),
      end: () => {
        if (!keyboard.open) return;
        keyboard.open = false;
        s.worldLeads = false;
        this.regrid();
      },
    };
    return keyboard;
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
    this.attaching = false;
    this.keyboard = null;
    const session = new this.subjects.CoreTypingSession({
      open: (size) => {
        assert.deepEqual(size, WORLD, "World's keyboard opens at its size");
        this.attaching = true;
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
      case "key": {
        assert(s.watching && s.pressed < 2 && !s.left);
        const session = this.session!;
        s.pressed++;
        this.type(false);
        return this.sync(this.session === session ? session : null);
      }
      case "attached": {
        assert(this.attaching && this.session);
        this.attaching = false;
        // A fresh (not resumed) attach leads at once.
        this.keyboard = this.attach();
        s.worldLeads = true;
        this.regrid();
        this.session.opened(this.keyboard);
        return this.sync(this.session);
      }
      case "attachRefused":
        assert(this.attaching && this.session);
        this.attaching = false;
        this.session.failed(new Error("refused"));
        return this.sync(this.session);
      case "leave":
        assert(this.session && s.keys > 0 && !s.left && !s.replaced);
        this.session.leave();
        return this.sync(this.session);
      case "reply":
        assert(this.session && s.watching && s.replies < 1 && !s.replaced);
        s.replies++;
        this.type(true);
        return this.sync(this.session);
      case "keyboardLost": {
        const keyboard = this.keyboard;
        assert(this.session && keyboard?.open && s.keys === 2 && !s.replaced);
        keyboard.end();
        this.session.ended(keyboard);
        return this.sync(this.session);
      }
      case "reoccupy":
        assert(s.keys === 2 && !s.replaced);
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
