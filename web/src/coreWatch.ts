/**
 * Watching a herdr-core terminal. Core decides its grid (the desktop app's
 * pane, or headless when no app shows it) and announces it before every
 * paint. The page adopts that grid exactly and sends nothing back: no input,
 * no size, no focus. Fitting only scales the drawing.
 */

export type CoreGrid = { cols: number; rows: number };

export type CoreTerminalPush =
  | { stream: string; grid: CoreGrid }
  | { stream: string; bytes: string }
  | { stream: string; closed: string };

/** Core's default headless grid (`config.rs`): no typing viewer leads. */
export const CORE_HEADLESS_GRID: CoreGrid = { cols: 200, rows: 120 };

const MAX_GRID = 0xffff;

function isGrid(value: unknown): value is CoreGrid {
  const grid = value as Partial<CoreGrid> | null;
  return (
    Boolean(grid) &&
    typeof grid === "object" &&
    Number.isInteger(grid!.cols) &&
    Number.isInteger(grid!.rows) &&
    grid!.cols! > 0 &&
    grid!.rows! > 0 &&
    grid!.cols! <= MAX_GRID &&
    grid!.rows! <= MAX_GRID
  );
}

/** Exactly one of grid, bytes or closed, for a well-formed stream key. */
export function parseCoreTerminalPush(value: unknown): CoreTerminalPush | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const push = value as Record<string, unknown>;
  if (typeof push.stream !== "string" || !push.stream) return null;
  const fields = ["grid", "bytes", "closed"].filter((key) =>
    Object.prototype.hasOwnProperty.call(push, key),
  );
  if (fields.length !== 1) return null;
  if (fields[0] === "grid")
    return isGrid(push.grid)
      ? {
          stream: push.stream,
          grid: { cols: push.grid.cols, rows: push.grid.rows },
        }
      : null;
  if (fields[0] === "bytes")
    return typeof push.bytes === "string"
      ? { stream: push.stream, bytes: push.bytes }
      : null;
  return typeof push.closed === "string"
    ? { stream: push.stream, closed: push.closed }
    : null;
}

/** The drawing surface: xterm in the page, a recorder in tests and replays. */
export type CoreWatchSurface = {
  resize(cols: number, rows: number): void;
  write(bytes: Uint8Array): void;
};

/** What World's attach did to an unviewed terminal: core moved it from one grid to another. */
export type CoreGridMove = { from: CoreGrid; to: CoreGrid };

/** The watch reply's grid facts (`world.core.watch`). */
export type CoreWatchReply = {
  grid?: unknown;
  moved_from?: unknown;
} | null;

function sameGrid(a: CoreGrid, b: CoreGrid): boolean {
  return a.cols === b.cols && a.rows === b.rows;
}

export class CoreWatchOrderError extends Error {
  constructor() {
    super("core sent terminal output before its size");
    this.name = "CoreWatchOrderError";
  }
}

function decodeBase64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Applies one stream's pushes in arrival order: each grid resizes the
 * surface before any later bytes are written, so every paint lands on the
 * grid core drew it for. Bytes before the first grid are refused: a stream
 * whose size is unknown is never painted at a guessed size. Multi-byte
 * characters split across pushes reach the surface as raw bytes, which
 * xterm decodes across writes.
 */
export class CoreWatchScreen {
  private current: CoreGrid | null = null;
  private first: CoreGrid | null = null;
  private replaced = false;
  private move: CoreGridMove | null = null;
  private ended: string | null = null;

  constructor(private readonly surface: CoreWatchSurface) {}

  get grid(): CoreGrid | null {
    return this.current;
  }

  get closed(): string | null {
    return this.ended;
  }

  /**
   * The move World's attach caused, while core still holds the grid it moved
   * to. Any later grid (a Herdr app's pane opening, say) was set by someone
   * else, so the move stops describing the terminal and is dropped for good.
   */
  get moved(): CoreGridMove | null {
    return this.move;
  }

  /** Core's reply to the watch, which may arrive before or after its first grid. */
  opened(reply: CoreWatchReply): void {
    const to = reply?.grid;
    const from = reply?.moved_from;
    if (!isGrid(from) || !isGrid(to) || this.replaced) return;
    if (this.first && !sameGrid(this.first, to)) return;
    this.move = { from: { ...from }, to: { ...to } };
  }

  apply(push: CoreTerminalPush): void {
    if (this.ended !== null) return;
    if ("grid" in push) {
      const { cols, rows } = push.grid;
      if (this.current?.cols !== cols || this.current?.rows !== rows)
        this.surface.resize(cols, rows);
      this.current = { cols, rows };
      if (!this.first) this.first = { cols, rows };
      else if (!sameGrid(this.first, this.current)) this.replaced = true;
      if (this.move && !sameGrid(this.move.to, this.current)) this.move = null;
      return;
    }
    if ("closed" in push) {
      this.ended = push.closed;
      return;
    }
    if (!this.current) throw new CoreWatchOrderError();
    this.surface.write(decodeBase64(push.bytes));
  }
}

/** Smallest drawing scale before the view scrolls instead of shrinking. */
export const MIN_WATCH_SCALE = 0.45;

/**
 * How much to scale a drawn grid so it fits the view, never above actual
 * size. Below the minimum the drawing keeps that scale and the view scrolls:
 * the grid itself never changes to fit a phone.
 */
export function watchScale(
  drawn: { width: number; height: number },
  view: { width: number; height: number },
): number {
  if (drawn.width <= 0 || drawn.height <= 0) return 1;
  const fit = Math.min(1, view.width / drawn.width, view.height / drawn.height);
  return Math.max(MIN_WATCH_SCALE, Number.isFinite(fit) ? fit : 1);
}

/** Why a watch ended, in words for the person watching. */
export function watchEndedText(reason: string): string {
  switch (reason) {
    case "exited":
    case "killed":
    case "signaled":
    case "server_stop":
    case "host_shutdown":
    case "holder_lost":
    case "stopped_by_restart":
      return "Its program ended";
    default:
      return reason.includes("not-actionable") ||
        reason.includes("connection") ||
        reason.includes("core")
        ? "Lost the herdr-core connection"
        : reason.includes("occupant")
          ? "Another program took its place"
          : "Stopped watching";
  }
}

/**
 * The grid line under the title. A watched grid is the size core holds: the
 * size a Herdr app's pane set, or core's headless size when no app shows the
 * terminal. World says which. While core still holds the grid World's own
 * attach moved an unviewed terminal to (core's observer rule), it says that
 * too; once another grid replaces it, the line describes only the current one.
 */
export function watchGridText(
  grid: CoreGrid | null,
  moved: CoreGridMove | null,
): string {
  if (!grid) return "Waiting for its size…";
  const size = `${grid.cols}×${grid.rows}`;
  const headless = sameGrid(grid, CORE_HEADLESS_GRID);
  if (moved && sameGrid(moved.to, grid))
    return `${size}: herdr-core moved it from ${moved.from.cols}×${moved.from.rows} to its headless size when World started watching, because no Herdr app has it open`;
  if (headless)
    return `${size}: herdr-core's headless size, used while no Herdr app has it open`;
  return `${size}: the size of the Herdr app or terminal that has it open`;
}
