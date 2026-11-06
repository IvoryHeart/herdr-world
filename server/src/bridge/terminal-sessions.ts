import type { ServerWebSocket } from "bun";
import type { EndpointTerminalSession } from "./endpoint-terminal-session";
import type { Popup } from "./endpoint-surface";
import { frameToAnsi } from "./frame-to-ansi";
import type { ThinClient } from "./thin-client";

/**
 * The terminal bridge's shared sessions: their shapes, the frame message a
 * viewer receives, the warm streams kept for quick returns and the browser
 * that owns a terminal's clipboard writes.
 */
export type TerminalSession = {
  terminalId: string | null;
  cols: number;
  rows: number;
};

export type SharedTerminalSession = {
  thin: ThinClient | EndpointTerminalSession;
  connecting: Promise<void> | null;
  firstFrame: Promise<boolean>;
  resolveFirstFrame: ((seen: boolean) => void) | null;
  terminalId: string;
  cols: number;
  rows: number;
  viewers: Set<ServerWebSocket<unknown>>;
  frames: number;
  bytes: number;
  firstFrameLogged: boolean;
  lastFrameLogAt: number;
  /** Last error Herdr reported on the stream, e.g. a takeover notice. */
  lastError: string | null;
  /** Latest full endpoint frame, replayed to a viewer returning to a warm stream. */
  lastFrame: TerminalFrame | null;
  /** The stream has no viewers and is kept warm for a quick return. */
  idle: boolean;
  /** Closes the warm stream once nobody has come back to it for a while. */
  idleTimer: ReturnType<typeof setTimeout> | null;
};

export type TerminalFrame = Parameters<
  Parameters<EndpointTerminalSession["on"]>[1]
>[0];

export type ClipboardTarget = {
  ws: ServerWebSocket<unknown>;
  terminalId: string;
  inputAt: number;
  session: SharedTerminalSession;
};

export type PopupIdentity = Pick<
  Popup,
  "terminalId" | "title" | "width" | "height"
>;

const CLIPBOARD_INPUT_WINDOW_MS = 30_000;
// Switching back to a recently viewed pane reuses its endpoint stream instead
// of reconnecting and waiting for Herdr's first snapshot. The least recently
// viewed streams beyond this count close, and so does any stream nobody has
// returned to within the TTL: a warm stream keeps receiving every surface
// Herdr sends, over SSH too, so it should not outlive its usefulness.
const IDLE_TERMINAL_MAX = 20;
const IDLE_TERMINAL_TTL_MS = 10 * 60_000;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MiB`;
}

/**
 * One frame cropped to a viewer's viewport. Viewers of the same size share
 * one serialized payload, so `key` names the size and `message` builds it.
 */
export function terminalFrameMessage(
  terminalId: string,
  t: TerminalFrame,
  viewport: { cols: number; rows: number },
) {
  const width = t.frame ? Math.min(t.width, viewport.cols) : t.width;
  const height = t.frame ? Math.min(t.height, viewport.rows) : t.height;
  return {
    key: `${width}x${height}`,
    message: () => {
      const bytes =
        t.frame && (width !== t.width || height !== t.height)
          ? frameToAnsi(t.frame, viewport)
          : t.bytes;
      return {
        terminal: {
          terminal_id: terminalId,
          width,
          height,
          full: t.full,
          ...(t.linkFrame ? { link_frame: t.linkFrame } : {}),
          ...(typeof t.mouseReporting === "boolean"
            ? { mouse_reporting: t.mouseReporting }
            : {}),
          ...(t.history && width === t.history.cols && height === t.history.rows
            ? { history: t.history }
            : {}),
          bytes: Buffer.from(bytes).toString("base64"),
        },
      };
    },
  };
}

/** One runtime's viewerless streams, kept warm until evicted or expired. */
export function createWarmTerminals(
  close: (shared: SharedTerminalSession) => void,
) {
  const idle = new Map<string, SharedTerminalSession>();
  function wake(shared: SharedTerminalSession) {
    shared.idle = false;
    if (shared.idleTimer) clearTimeout(shared.idleTimer);
    shared.idleTimer = null;
    if (idle.get(shared.terminalId) === shared) idle.delete(shared.terminalId);
  }
  function keep(shared: SharedTerminalSession) {
    wake(shared);
    shared.idle = true;
    shared.idleTimer = setTimeout(() => {
      if (shared.idle) close(shared);
    }, IDLE_TERMINAL_TTL_MS);
    idle.set(shared.terminalId, shared);
    for (const oldest of idle.values()) {
      if (idle.size <= IDLE_TERMINAL_MAX) break;
      close(oldest);
    }
  }
  return { wake, keep };
}

/**
 * Input a browser sent to one of its terminals another way than
 * terminal.input (the composer types through Herdr's pane API): a clipboard
 * write the command makes goes back to that browser while it still views
 * the terminal.
 */
export function clipboardInputTarget(
  ws: ServerWebSocket<unknown>,
  terminalId: string,
  sharedTerminals: ReadonlyMap<string, SharedTerminalSession>,
  terminalViewers: ReadonlyMap<
    ServerWebSocket<unknown>,
    ReadonlyMap<string, unknown>
  >,
): ClipboardTarget | null {
  const session = sharedTerminals.get(terminalId);
  return session && terminalViewers.get(ws)?.has(terminalId)
    ? { ws, terminalId, inputAt: Date.now(), session }
    : null;
}

/**
 * The browser a clipboard write goes to: the one that recently typed into
 * this terminal, while it still views the same live session.
 */
export function recentClipboardTarget(
  target: ClipboardTarget | null,
  terminalId: string | undefined,
  sharedTerminals: ReadonlyMap<string, SharedTerminalSession>,
  terminalViewers: ReadonlyMap<
    ServerWebSocket<unknown>,
    ReadonlyMap<string, unknown>
  >,
): ClipboardTarget | null {
  return target &&
    Date.now() - target.inputAt <= CLIPBOARD_INPUT_WINDOW_MS &&
    !target.session.thin.isClosed &&
    sharedTerminals.get(target.terminalId) === target.session &&
    terminalViewers.get(target.ws)?.has(target.terminalId) &&
    (!terminalId || target.terminalId === terminalId)
    ? target
    : null;
}
