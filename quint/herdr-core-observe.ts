import assert from "node:assert/strict";
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

/**
 * The observe family's replay: core's size rule and credit behaviour as the
 * design seam, World's production attach/reply rules and the page's
 * production grid adoption (`CoreWatchScreen`) as the subjects.
 */
export class CoreWatchReplay {
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
        assert(g !== s.lead);
        const led = g >= 0 ? g : 2;
        s.lead = g;
        s.changes++;
        if (led !== s.grid) {
          s.grid = led;
          this.wire(led);
        }
        return;
      }
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
