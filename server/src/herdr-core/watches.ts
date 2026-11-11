import type { ReadyRuntimeLease } from "../connections/manager";
import {
  type CoreCellSize,
  type CoreKeyboard,
  type CoreWatch,
  CoreWatchRefusedError,
  localAddress,
} from "./client";
import { CoreFenceError, CoreOperationFence } from "./fence";
import type { CoreConnectionRuntime } from "./runtime";
import { CoreTypingSession } from "./typing";

/**
 * What a browser receives for one watched terminal, in core's order: the
 * grid each paint is drawn for, the bytes, and finally why the stream ended.
 * A `grid` always precedes the DATA painted for it.
 */
export type CoreTerminalPush =
  | { stream: string; grid: { cols: number; rows: number } }
  | { stream: string; bytes: string }
  | { stream: string; closed: string };

/** A page's socket, as far as its watches need it. */
export type CorePage = { getBufferedAmount(): number };

export type CoreWatchLimits = {
  /** Streams one browser page may hold (one per visible terminal view). */
  perSocket: number;
  /** Streams this World service holds across all pages. */
  total: number;
  /**
   * Bytes a page may have waiting in its socket before World stops crediting
   * core. Core then holds the stream and, beyond 4 MiB, repaints instead of
   * replaying the backlog, so a slow phone never grows World's buffers.
   */
  bufferedBytes: number;
};

export const DEFAULT_CORE_WATCH_LIMITS: CoreWatchLimits = {
  perSocket: 4,
  total: 32,
  bufferedBytes: 512 * 1024,
};

const STREAM_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const NOT_SENT = "Not sent: World could not type into this terminal";

export type CoreWatchRequest = {
  connection_id: string;
  generation: number;
  address: string;
  stream: string;
};

export type CoreWatchOpened = {
  stream: string;
  /** The grid core holds after this attach. */
  grid: { cols: number; rows: number };
  /**
   * The grid World last observed before attaching, when the attach changed
   * it: core's observer-alone rule moved an unviewed terminal to headless.
   */
  moved_from: { cols: number; rows: number } | null;
};

type Active<Socket> = {
  ws: Socket;
  stream: string;
  watch: CoreWatch | null;
  /** Bytes passed on but not yet credited (the page's socket is behind). */
  owed: number;
  ended: boolean;
  /** The watch's authority (lease, core, occupant): typing re-checks it. */
  fence: CoreOperationFence<CoreConnectionRuntime>;
  lease: ReadyRuntimeLease<CoreConnectionRuntime>;
  typing: CoreTypingSession;
};

/** One `world.core.input` message's bytes: a paste or a burst of keys. */
export const MAX_CORE_INPUT_BYTES = 64 * 1024;
/** What may wait for the keyboard's attach before more is refused. */
export const MAX_CORE_QUEUED_INPUT_BYTES = 256 * 1024;
const MAX_CELLS = 0xffff;

export type CoreInputRequest = {
  stream: string;
  bytes: Uint8Array;
  /** A terminal's own reply (a query answer), not a person typing. */
  automatic: boolean;
  /** World's fitted grid for this view, sent to core with typed keys. */
  size: CoreCellSize;
};

export type CoreInputResult = { sent: boolean };

function parseInput(params: unknown): CoreInputRequest {
  const p = (params ?? {}) as Record<string, unknown>;
  if (typeof p.stream !== "string" || !STREAM_KEY.test(p.stream))
    throw new CoreWatchError("typing needs a stream key");
  if (typeof p.data !== "string" || !BASE64.test(p.data))
    throw new CoreWatchError("typing needs base64 data");
  const bytes = new Uint8Array(Buffer.from(p.data, "base64"));
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CORE_INPUT_BYTES)
    throw new CoreWatchError(
      `typing sends 1 to ${MAX_CORE_INPUT_BYTES} bytes at a time`,
    );
  const cell = (value: unknown) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_CELLS;
  if (!cell(p.cols) || !cell(p.rows))
    throw new CoreWatchError("typing needs the view's size in cells");
  if (p.automatic !== undefined && typeof p.automatic !== "boolean")
    throw new CoreWatchError("automatic is true or false");
  return {
    stream: p.stream,
    bytes,
    automatic: p.automatic === true,
    size: { cols: p.cols as number, rows: p.rows as number },
  };
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export class CoreWatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoreWatchError";
  }
}

function parseRequest(params: unknown): CoreWatchRequest {
  const p = (params ?? {}) as Record<string, unknown>;
  if (typeof p.connection_id !== "string" || !p.connection_id)
    throw new CoreWatchError("a watch needs its herdr-core connection");
  if (
    typeof p.generation !== "number" ||
    !Number.isSafeInteger(p.generation) ||
    p.generation < 0
  )
    throw new CoreWatchError("a watch needs its connection generation");
  if (typeof p.address !== "string")
    throw new CoreWatchError("a watch needs a terminal address");
  if (typeof p.stream !== "string" || !STREAM_KEY.test(p.stream))
    throw new CoreWatchError("a watch needs a stream key");
  return {
    connection_id: p.connection_id,
    generation: p.generation,
    address: localAddress(p.address),
    stream: p.stream,
  };
}

/** Core's CLOSE carries `{"reason": …}`; World's own closes are plain text. */
function closeReason(text: string): string {
  try {
    const parsed = JSON.parse(text) as { reason?: unknown };
    if (parsed && typeof parsed.reason === "string") return parsed.reason;
  } catch {
    // Not JSON: World's reason, or core's empty answer to a detach.
  }
  return text || "closed";
}

function gridOf(record: Record<string, unknown> | undefined) {
  const cols = record?.cols;
  const rows = record?.rows;
  return typeof cols === "number" && typeof rows === "number"
    ? { cols, rows }
    : null;
}

/**
 * Browser watches of herdr-core terminals. Each is one observe stream on the
 * connection's framed link: core announces the grid before every paint and
 * World sends it nothing but CREDIT and CLOSE, so watching never types,
 * resizes or takes focus. Every frame is re-fenced (lease, core process,
 * program) before it reaches the page.
 */
export class CoreTerminalWatches<Socket extends object> {
  private readonly active = new Map<Socket, Map<string, Active<Socket>>>();
  private count = 0;
  private readonly limits: CoreWatchLimits;

  constructor(
    private readonly deps: {
      lease(
        connectionId: string,
      ): ReadyRuntimeLease<CoreConnectionRuntime> | null;
      send(ws: Socket, push: CoreTerminalPush): boolean;
      buffered(ws: Socket): number;
      limits?: Partial<CoreWatchLimits>;
    },
  ) {
    this.limits = { ...DEFAULT_CORE_WATCH_LIMITS, ...deps.limits };
  }

  get size(): number {
    return this.count;
  }

  async open(ws: Socket, params: unknown): Promise<CoreWatchOpened> {
    const request = parseRequest(params);
    const streams = this.active.get(ws) ?? new Map<string, Active<Socket>>();
    if (streams.has(request.stream))
      throw new CoreWatchError("that stream key is already watching");
    if (streams.size >= this.limits.perSocket)
      throw new CoreWatchError(
        `a page can watch ${this.limits.perSocket} core terminals at once`,
      );
    if (this.count >= this.limits.total)
      throw new CoreWatchError("World is watching too many core terminals");
    const lease = this.deps.lease(request.connection_id);
    if (!lease || lease.generation !== request.generation || !lease.isCurrent())
      throw new CoreWatchError(
        "This herdr-core connection changed; open the terminal again",
      );
    const fence = CoreOperationFence.admit(lease, request.address);
    const before = gridOf(lease.runtime.core.terminal(request.address));
    const entry: Active<Socket> = {
      ws,
      stream: request.stream,
      watch: null,
      owed: 0,
      ended: false,
      fence,
      lease,
      typing: new CoreTypingSession({
        open: (size) => void this.openKeyboard(entry, size),
        fenced: () => this.fenced(entry),
        maxQueuedBytes: MAX_CORE_QUEUED_INPUT_BYTES,
        notSent: () => new CoreWatchError(NOT_SENT),
      }),
    };
    streams.set(request.stream, entry);
    this.active.set(ws, streams);
    this.count++;
    const push = (message: CoreTerminalPush) => {
      if (!this.deps.send(ws, message)) {
        this.end(entry, null);
        return false;
      }
      return true;
    };
    /** A frame passes only while the original authority still holds. */
    const fenced = () => {
      try {
        fence.check("publication", "program");
        return true;
      } catch (error) {
        this.end(entry, (error as Error).message);
        return false;
      }
    };
    let watch: CoreWatch;
    try {
      watch = await lease.runtime.watchTerminal(fence, {
        resize: (cols, rows) => {
          if (entry.ended || !fenced()) return;
          push({ stream: entry.stream, grid: { cols, rows } });
        },
        data: (bytes) => {
          if (entry.ended || !fenced()) return;
          if (!push({ stream: entry.stream, bytes: toBase64(bytes) })) return;
          this.pay(entry, bytes.byteLength);
        },
        close: (reason) => {
          if (entry.ended) return;
          // Core ended it: nothing to detach.
          entry.watch = null;
          this.end(entry, closeReason(reason));
        },
      });
    } catch (error) {
      this.forget(entry);
      if (
        error instanceof CoreFenceError ||
        error instanceof CoreWatchRefusedError
      )
        throw error;
      throw new CoreWatchError(
        `World could not watch ${request.address}: ${(error as Error).message}`,
      );
    }
    if (entry.ended) {
      // The page left, or the stream ended, while the attach was in flight.
      watch.detach();
      throw new CoreWatchError("the watch ended before it opened");
    }
    entry.watch = watch;
    // Bytes that arrived with the reply were passed on before the handle existed.
    this.pay(entry, 0);
    const grid = gridOf(watch.terminal) ?? before ?? { cols: 0, rows: 0 };
    return {
      stream: request.stream,
      grid,
      moved_from:
        before && (before.cols !== grid.cols || before.rows !== grid.rows)
          ? before
          : null,
    };
  }

  /**
   * Bytes for the watched terminal. Typed bytes open World's keyboard on
   * first use (core then takes World's size) and are sent once, in order.
   * Automatic replies are sent only while the keyboard is open or opening
   * and core tells them apart; otherwise they are dropped (`sent: false`),
   * so a watch that nobody types into never sends core anything.
   */
  input(ws: Socket, params: unknown): Promise<CoreInputResult> {
    let request: CoreInputRequest;
    try {
      request = parseInput(params);
    } catch (error) {
      return Promise.reject(error);
    }
    const entry = this.active.get(ws)?.get(request.stream);
    if (!entry || entry.ended || !entry.watch)
      return Promise.reject(
        new CoreWatchError("that terminal is not being watched"),
      );
    return new Promise<CoreInputResult>((resolve, reject) =>
      entry.typing.input({
        kind: request.automatic ? "automatic" : "input",
        bytes: request.bytes,
        size: request.size,
        done: (sent, error) => (error ? reject(error) : resolve({ sent })),
      }),
    );
  }

  /**
   * The page stopped typing (it lost focus or went idle): leave the
   * keyboard so core gives the size back to the Herdr app's pane, or to
   * headless. The watch goes on. Anything typed before it is sent first.
   */
  leave(ws: Socket, stream: unknown): boolean {
    const entry =
      typeof stream === "string" ? this.active.get(ws)?.get(stream) : undefined;
    if (!entry || entry.ended) return false;
    entry.typing.leave();
    return true;
  }

  /** Whether the page's watch of `stream` holds a keyboard (for tests). */
  typing(ws: Socket, stream: string): "no" | "opening" | "yes" {
    return this.active.get(ws)?.get(stream)?.typing.state ?? "no";
  }

  /** Core's attach for the session's first key; the session sends what waited. */
  private async openKeyboard(entry: Active<Socket>, size: CoreCellSize) {
    const typing = entry.typing;
    let keys: CoreKeyboard | null = null;
    try {
      keys = await entry.lease.runtime.keyboard(entry.fence, size, () => {
        if (keys) typing.ended(keys);
      });
      typing.opened(keys);
    } catch (error) {
      typing.failed(
        error instanceof CoreWatchRefusedError
          ? new CoreWatchError(`${NOT_SENT}: ${error.message}`)
          : new CoreWatchError(NOT_SENT),
      );
    }
  }

  /** The watch's authority still holds; otherwise the watch ends with why. */
  private fenced(entry: Active<Socket>): boolean {
    try {
      entry.fence.check("dispatch", "program");
      return true;
    } catch (error) {
      this.end(entry, (error as Error).message);
      return false;
    }
  }

  /** The page stops watching (it closed the view). */
  close(ws: Socket, stream: unknown): boolean {
    const entry =
      typeof stream === "string" ? this.active.get(ws)?.get(stream) : undefined;
    if (!entry) return false;
    this.end(entry, null);
    return true;
  }

  /** The page's socket closed: detach every stream it held. */
  release(ws: Socket): void {
    for (const entry of [...(this.active.get(ws)?.values() ?? [])])
      this.end(entry, null);
  }

  /** The page's socket drained: credit what it has now taken. */
  drained(ws: Socket): void {
    for (const entry of this.active.get(ws)?.values() ?? []) this.pay(entry, 0);
  }

  /** Detaches every stream (service stopping). */
  stop(): void {
    for (const ws of [...this.active.keys()]) this.release(ws);
  }

  private pay(entry: Active<Socket>, bytes: number) {
    entry.owed += bytes;
    if (
      entry.ended ||
      !entry.watch ||
      entry.owed === 0 ||
      this.deps.buffered(entry.ws) > this.limits.bufferedBytes
    )
      return;
    const owed = entry.owed;
    entry.owed = 0;
    entry.watch.credit(owed);
  }

  /** Ends a stream once: detach it at core and tell the page why, if it may hear. */
  private end(entry: Active<Socket>, reason: string | null) {
    if (entry.ended) return;
    entry.ended = true;
    entry.typing.close();
    entry.watch?.detach();
    entry.watch = null;
    this.forget(entry);
    if (reason !== null)
      this.deps.send(entry.ws, { stream: entry.stream, closed: reason });
  }

  private forget(entry: Active<Socket>) {
    entry.ended = true;
    const streams = this.active.get(entry.ws);
    if (streams?.get(entry.stream) !== entry) return;
    streams.delete(entry.stream);
    this.count--;
    if (streams.size === 0) this.active.delete(entry.ws);
  }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "base64",
  );
}
