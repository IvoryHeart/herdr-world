import { isLocalCoreAddress } from "../../../shared/coreAddress";
import {
  CoreRpcError,
  CoreUnavailableError,
  CoreWriteUncertainError,
  CoreUnsupportedError,
  CoreIncompatibleError,
} from "./errors";
export {
  CoreRpcError,
  CoreUnavailableError,
  CoreWriteUncertainError,
  CoreUnsupportedError,
  CoreIncompatibleError,
} from "./errors";
import type { CoreByteStream } from "./stream";
import {
  coreCancelFrame,
  coreSendRequest,
  coreKeysRequest,
  type CoreSendResult,
  type CoreKeysResult,
} from "./delivery-params";
import { isSharedLabelChange, type SharedLabelChange } from "./shared-state";
import {
  CoreProtocolError,
  creditFrame,
  encodeFrame,
  type Frame,
  FrameDecoder,
  FrameKind,
  LineAssembler,
} from "./wire";
import { checkLabels, coreRunParams, type CoreRunRequest } from "./run-params";

export type { CoreRunRequest } from "./run-params";
import {
  CORE_PROTOCOL_GENERATION,
  type CoreHello,
  isRecord,
  type ObservationMethod,
  parseHello,
} from "./hello";
export {
  CORE_PROTOCOL_GENERATION,
  type CoreHello,
  REQUIRED_CORE_FEATURES,
  REQUIRED_CORE_METHODS,
} from "./hello";
/**
 * The writes World makes, each built from a typed verb below: start a
 * program (`terminal.run`), end one (`terminal.kill`) and set labels (the
 * shared `herdr.seen`/`herdr.pinned`, and placement at launch). None is
 * required for observation: on a core without one, that action fails and
 * World keeps observing. World's own float shells (`float-shell.ts`) also
 * view theirs (`terminal.attach`). Agent input uses native send/keys
 * (delivery.ts). Never `machine.*`, `file.*`, `server.stop`/`restart` or
 * `terminal.put`.
 */
export type CoreWriteMethod =
  | "terminal.run"
  | "terminal.kill"
  | "terminal.label"
  | "terminal.send"
  | "terminal.keys";
/** Optional for float shells: a core without them refuses only that. */
const FLOAT_SHELL_METHODS = [
  "terminal.run",
  "terminal.attach",
  "terminal.kill",
] as const;
type CoreMethod =
  | ObservationMethod
  | CoreWriteMethod
  | (typeof FLOAT_SHELL_METHODS)[number];
/** Watching a terminal: `terminal.attach` as an observer, nothing else. */
const WATCH_METHOD = "terminal.attach";
const WATCH_FEATURES = ["attach", "resize_notifications"] as const;
/** Scrollback lines a watch asks for with its first paint (main screen only). */
export const WATCH_HISTORY_LINES = 500;

const HELLO_LINE_LIMIT = 1 << 20;
/** Unclaimed stream bytes held while a subscribe reply is still in flight. */
const MAX_UNCLAIMED_BYTES = 8 << 20;

export type CoreServerStatus = {
  core: { id: string; name: string };
  version: string;
  pid: number;
  uptime_ms: number;
  live: number;
  finished: number;
};

export type CoreTerminalRecord = Record<string, unknown> & {
  address: string;
  labels: Record<string, string>;
  argv: string[];
  state: string;
};

export type CoreEventLine =
  | {
      method: "event";
      params: {
        seq: number;
        type: string;
        terminal?: string;
        machine?: string;
        data: unknown;
      };
    }
  | { method: "heartbeat"; params: { seq: number } }
  | {
      method: "missed";
      params: { seq: number; terminals: CoreTerminalRecord[] };
    };

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout> | null;
};

type ChannelSink = {
  data(bytes: Uint8Array): void;
  close(reason: string): void;
  /** Core-to-viewer RESIZE: the grid the DATA after it is painted for. */
  resize?(cols: number, rows: number): void;
  /** The consumer returns credit itself (`CoreAttachment.credit`). */
  manualCredit?: boolean;
};

/** Size of a viewer in cells; core takes it from the latest typing viewer. */
export type CoreCellSize = { cols: number; rows: number };

/**
 * One interactive viewer: a float shell World started, or World's keyboard
 * on a terminal it watches. Every call is a no-op once the channel closed.
 */
export type CoreAttachment = {
  readonly channel: number;
  readonly terminal: CoreTerminalRecord;
  /** Core tells automatic replies from typing on this channel. */
  readonly automatic: boolean;
  readonly open: boolean;
  /** Keys typed by a person, sent as they are: this viewer leads the size. */
  input(bytes: Uint8Array): void;
  /** A terminal's own answer (a query reply); dropped unless `automatic`. */
  automaticInput(bytes: Uint8Array): void;
  resize(size: CoreCellSize): void;
  focus(focused: boolean): void;
  /** Return `bytes` of consumed stream window, once they were delivered on. */
  credit(bytes: number): void;
  /** Leave: core gives the size back to the next typing viewer, or headless. */
  detach(): void;
};

/** World typing into a terminal it watches (`keyboard`): input only. */
export type CoreKeyboard = Omit<CoreAttachment, "credit">;

/** A RESIZE payload: cols and rows as u16 LE. */
function cellSizePayload(size: CoreCellSize): Uint8Array {
  const payload = new Uint8Array(4);
  const view = new DataView(payload.buffer);
  view.setUint16(0, size.cols, true);
  view.setUint16(2, size.rows, true);
  return payload;
}

export type CoreAttachHandlers = {
  /** First paint, then live output, in order. */
  data(bytes: Uint8Array): void;
  /** The stream ended: detached, finished, lost or the connection closed. */
  end(reason: string): void;
};

export type CoreRunParams = {
  name: string;
  cwd: string;
  labels: Record<string, string>;
  size: CoreCellSize;
};

/** What a watched terminal's stream delivers, in core's order. */
export type CoreWatchSink = {
  /** Apply before consuming any DATA that follows. */
  resize(cols: number, rows: number): void;
  data(bytes: Uint8Array): void;
  /** The stream is over: core's reason (`exited`, …) or World's. */
  close(reason: string): void;
};

export type CoreWatch = {
  readonly channel: number;
  /** The terminal as core recorded it after this attach (its grid included). */
  readonly terminal: CoreTerminalRecord;
  /** Returns consumed DATA bytes to core's window for this stream only. */
  credit(bytes: number): void;
  /** Ends the stream (CLOSE); core answers with an empty CLOSE. */
  detach(): void;
};

/** A watch core cannot serve as an observer that announces its grid. */
export class CoreWatchRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoreWatchRefusedError";
  }
}

/**
 * The only attach World sends: an observer that never types, resizes or
 * takes focus, asking core to announce its grid before every paint. `cols`
 * and `rows` are required by core and ignored for observers; World passes
 * the grid it last saw so nothing it sends names a size of its own.
 */
export function watchAttachParams(
  address: string,
  grid: { cols: number; rows: number },
) {
  return {
    terminal: localAddress(address),
    observe: true,
    resize_notifications: true,
    cols: grid.cols,
    rows: grid.rows,
    history: WATCH_HISTORY_LINES,
  };
}

/**
 * Accepts an attach reply only when core confirmed resize notifications for
 * the whole path: without them the first paint could arrive for a grid World
 * does not know, so the watch is refused rather than guessed.
 */
export function acceptWatchReply(reply: unknown): {
  channel: number;
  terminal: CoreTerminalRecord;
} {
  if (
    !isRecord(reply) ||
    typeof reply.channel !== "number" ||
    !Number.isSafeInteger(reply.channel) ||
    reply.channel <= 0 ||
    !isRecord(reply.terminal)
  )
    throw new CoreProtocolError("attach reply is invalid");
  if (reply.resize_notifications !== true)
    throw new CoreWatchRefusedError(
      "this core cannot tell World the terminal's size, so World does not show it",
    );
  return {
    channel: reply.channel,
    terminal: reply.terminal as CoreTerminalRecord,
  };
}

export type CoreClientOptions = {
  /** Called once when the stream ends or the protocol fails. */
  onClosed?(error: Error): void;
  /** Recording hook: every inbound byte slice, before decoding. */
  onInbound?(bytes: Uint8Array): void;
  onOutbound?(bytes: Uint8Array): void;
  maxEventLineBytes?: number;
};

/**
 * One framed connection to an already-running core. It never starts a core
 * and never sends `caller`. Its mutating calls are the typed writes
 * (`run`, `kill`, `label`, `shareLabel`, `sendText`, `keys`) and World's own float shells
 * (`runShell`, `attach`).
 */
export class CoreClient {
  private readonly decoder = new FrameDecoder();
  private readonly pending = new Map<number, Pending>();
  private readonly sinks = new Map<number, ChannelSink>();
  /** Channels World closed: their in-flight frames are dropped until core's CLOSE. */
  private readonly retired = new Set<number>();
  /** Watch calls that timed out: a late reply's channel is closed at once. */
  private readonly abandoned = new Set<number>();
  private readonly unclaimed = new Map<number, Frame[]>();
  private unclaimedBytes = 0;
  private nextId = 1;
  private closedError: Error | null = null;
  private readonly closeWaiters: Array<(error: Error) => void> = [];

  private constructor(
    private readonly stream: CoreByteStream,
    readonly hello: CoreHello,
    private readonly options: CoreClientOptions,
  ) {}

  /** Plain-mode `hello {framed:true}`, then framed mode on the same stream. */
  static open(
    stream: CoreByteStream,
    options: CoreClientOptions & { timeoutMs?: number } = {},
  ): Promise<CoreClient> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let client: CoreClient | null = null;
      let line: Uint8Array[] = [];
      let lineBytes = 0;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stream.close();
        reject(error);
      };
      const timer = setTimeout(
        () => fail(new CoreUnavailableError("core did not answer hello")),
        options.timeoutMs ?? 5_000,
      );
      stream.onClose((error) => {
        if (client)
          client.terminate(
            error ?? new CoreUnavailableError("core closed the connection"),
          );
        else
          fail(
            new CoreUnavailableError(
              "core closed the connection during hello",
              {
                cause: error,
              },
            ),
          );
      });
      stream.onData((bytes) => {
        options.onInbound?.(bytes);
        if (client) {
          client.receive(bytes);
          return;
        }
        if (settled) return;
        const newline = bytes.indexOf(0x0a);
        const head = newline === -1 ? bytes : bytes.subarray(0, newline);
        line.push(head);
        lineBytes += head.byteLength;
        if (lineBytes > HELLO_LINE_LIMIT)
          return fail(new CoreIncompatibleError("hello reply is too long"));
        if (newline === -1) return;
        let reply: unknown;
        try {
          reply = JSON.parse(Buffer.concat(line).toString("utf8"));
        } catch {
          return fail(new CoreIncompatibleError("hello reply is not JSON"));
        }
        line = [];
        if (isRecord(reply) && isRecord(reply.error)) {
          const error = reply.error;
          return fail(
            new CoreIncompatibleError(
              `core refused hello: ${String(error.message ?? "error")}`,
            ),
          );
        }
        let hello: CoreHello;
        try {
          hello = parseHello(isRecord(reply) ? reply.result : null);
        } catch (error) {
          return fail(error as Error);
        }
        settled = true;
        clearTimeout(timer);
        client = new CoreClient(stream, hello, options);
        resolve(client);
        const rest = bytes.subarray(newline + 1);
        if (rest.byteLength > 0) client.receive(rest);
      });
      const helloLine = `${JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "hello",
        params: { framed: true, generation: CORE_PROTOCOL_GENERATION },
      })}\n`;
      const bytes = new TextEncoder().encode(helloLine);
      options.onOutbound?.(bytes);
      stream.write(bytes);
    });
  }

  get closed(): boolean {
    return this.closedError !== null;
  }

  /** Resolves with the reason once this connection is over. */
  whenClosed(): Promise<Error> {
    if (this.closedError) return Promise.resolve(this.closedError);
    return new Promise((resolve) => this.closeWaiters.push(resolve));
  }

  close(reason = "closed by World"): void {
    this.terminate(new CoreUnavailableError(reason));
  }

  status(timeoutMs = 5_000): Promise<CoreServerStatus> {
    return this.call(
      "server.status",
      {},
      timeoutMs,
    ) as Promise<CoreServerStatus>;
  }

  getTerminal(address: string, timeoutMs = 5_000) {
    return this.call(
      "terminal.get",
      { terminal: localAddress(address) },
      timeoutMs,
    ) as Promise<CoreTerminalRecord>;
  }

  /**
   * Background reads never stitch: `lines: 0` returns the screen only. A read
   * with history on an alternate screen holds keys and injects wheel input.
   */
  readScreen(address: string, timeoutMs = 5_000) {
    return this.call(
      "terminal.read",
      { terminal: localAddress(address), lines: 0 },
      timeoutMs,
    ) as Promise<Record<string, unknown>>;
  }

  /** Whether the connected core offers `method` (negotiated, never pinned). */
  offers(method: CoreWriteMethod): boolean {
    return this.hello.methods.includes(method);
  }

  /** Starts a program; the reply is core's record of the new terminal. */
  run(request: CoreRunRequest, timeoutMs = 15_000) {
    return this.write(
      "terminal.run",
      coreRunParams(request),
      timeoutMs,
    ) as Promise<CoreTerminalRecord>;
  }

  /**
   * Ends a program: hangup, then terminate, then kill; core reports what it
   * observed. Core also ends every live child started with this terminal as
   * parent that does not outlive it (see kill-plan.ts).
   */
  kill(address: string, timeoutMs = 15_000) {
    return this.write(
      "terminal.kill",
      { terminal: localAddress(address) },
      timeoutMs,
    ) as Promise<CoreTerminalRecord>;
  }

  /** Sets labels (an empty value removes one); core sends the whole map. */
  label(address: string, labels: Record<string, string>, timeoutMs = 5_000) {
    return this.write(
      "terminal.label",
      { terminal: localAddress(address), labels: checkLabels(labels) },
      timeoutMs,
    ) as Promise<CoreTerminalRecord>;
  }

  /** Native scheduling and best-effort cancellation; lost replies stay uncertain. */
  sendText(
    address: string,
    text: string,
    options:
      | { force: boolean; cancel?: AbortSignal; timeoutMs?: number }
      | number = 15_000,
  ) {
    if (typeof options === "number") {
      if (!text.trim() || text.length > 32_000 || text.includes("\0"))
        throw new CoreProtocolError("invalid message text");
      return this.write(
        "terminal.send",
        { terminal: localAddress(address), text, force: false, wait: false },
        options,
      ) as Promise<CoreSendResult>;
    }
    return this.write(
      ...coreSendRequest(address, text, options),
    ) as Promise<CoreSendResult>;
  }

  /**
   * Presses named keys after ~3 s of a person's quiet. Core cannot cancel
   * keys once asked (only sends), so World checks before asking.
   */
  keys(address: string, keys: readonly string[], timeoutMs = 15_000) {
    return this.write(
      ...coreKeysRequest(address, keys, timeoutMs),
    ) as Promise<CoreKeysResult>;
  }

  private async write(
    method: CoreWriteMethod,
    params: Record<string, unknown>,
    timeoutMs: number,
    cancel?: AbortSignal,
  ): Promise<unknown> {
    if (!this.offers(method))
      throw new CoreUnsupportedError(this.hello.version, method);
    if (this.closedError) throw this.closedError;
    try {
      return await this.call(method, params, timeoutMs, cancel);
    } catch (error) {
      // Sent: only core's own refusal proves nothing happened.
      if (error instanceof CoreRpcError) throw error;
      throw new CoreWriteUncertainError(method, { cause: error });
    }
  }

  /**
   * Sets one shared label on a local terminal by its address (never a name,
   * which another terminal could take). Nothing else is ever labelled.
   */
  shareLabel(address: string, change: SharedLabelChange, timeoutMs = 5_000) {
    if (!isLocalCoreAddress(address) || !isSharedLabelChange(change))
      return Promise.reject(new Error("not a shared label change"));
    return this.call(
      "terminal.label",
      { terminal: address, labels: { ...change } },
      timeoutMs,
    ) as Promise<CoreTerminalRecord>;
  }

  /**
   * Unfiltered subscription. Core registers the snapshot atomically but may
   * write stream frames before the reply: those are held, then delivered in
   * order right after `baseline` has applied the snapshot.
   */
  async subscribe(
    handlers: {
      baseline(seq: number, terminals: CoreTerminalRecord[]): void;
      line(line: CoreEventLine): void;
      end(error: Error): void;
    },
    timeoutMs = 10_000,
  ): Promise<{ channel: number }> {
    const reply = await this.call("events.subscribe", {}, timeoutMs);
    if (
      !isRecord(reply) ||
      typeof reply.seq !== "number" ||
      !Number.isSafeInteger(reply.seq) ||
      reply.seq < 0 ||
      !Array.isArray(reply.terminals) ||
      typeof reply.channel !== "number"
    )
      throw new CoreProtocolError("subscribe reply is invalid");
    if (this.closedError) throw this.closedError;
    const channel = reply.channel;
    const lines = new LineAssembler(this.options.maxEventLineBytes ?? 8 << 20);
    handlers.baseline(reply.seq, reply.terminals as CoreTerminalRecord[]);
    this.claim(channel, {
      data: (bytes) => {
        for (const text of lines.push(bytes)) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            // Core drops a backlog's tail when a reader falls too far behind.
            throw new CoreProtocolError("event stream lost line framing");
          }
          if (
            !isRecord(parsed) ||
            typeof parsed.method !== "string" ||
            !isRecord(parsed.params)
          )
            throw new CoreProtocolError("event line is not a notification");
          handlers.line(parsed as CoreEventLine);
        }
      },
      close: (reason) =>
        handlers.end(
          new CoreUnavailableError(`event stream closed: ${reason}`),
        ),
    });
    return { channel };
  }

  /**
   * Watches one terminal: an observe attach with resize notifications. Its
   * only outbound frames are CREDIT (paid by the caller as it passes bytes
   * on) and CLOSE. Frames may precede the reply; they are held and delivered
   * in order once the reply is accepted, or dropped if it is refused.
   */
  async watch(
    address: string,
    grid: { cols: number; rows: number },
    sink: CoreWatchSink,
    timeoutMs = 10_000,
  ): Promise<CoreWatch> {
    const missing = [
      ...(this.hello.methods.includes(WATCH_METHOD) ? [] : [WATCH_METHOD]),
      ...WATCH_FEATURES.filter((f) => !this.hello.features.includes(f)),
    ];
    if (missing.length > 0)
      throw new CoreWatchRefusedError(
        `core ${this.hello.version} lacks ${missing.join(", ")}`,
      );
    const reply = await this.call(
      WATCH_METHOD,
      watchAttachParams(address, grid),
      timeoutMs,
    );
    let accepted: ReturnType<typeof acceptWatchReply>;
    try {
      accepted = acceptWatchReply(reply);
    } catch (error) {
      const channel =
        isRecord(reply) && typeof reply.channel === "number"
          ? reply.channel
          : null;
      if (channel !== null) this.release(channel);
      throw error;
    }
    if (this.closedError) throw this.closedError;
    const { channel } = accepted;
    let open = true;
    this.claim(channel, {
      manualCredit: true,
      resize: (cols, rows) => sink.resize(cols, rows),
      data: (bytes) => sink.data(bytes),
      close: (reason) => {
        open = false;
        sink.close(reason);
      },
    });
    return {
      channel,
      terminal: accepted.terminal,
      credit: (bytes) => {
        if (open && bytes > 0 && this.sinks.has(channel))
          this.send(creditFrame(channel, bytes));
      },
      detach: () => {
        if (!open) return;
        open = false;
        this.release(channel);
      },
    };
  }

  /**
   * Starts that machine's own shell (no argv) in a new, unplaced terminal:
   * no parent, no notes, removed when it ends. A taken `name` is core's
   * refusal (`name_taken`), which is what keeps one shell per name.
   */
  runShell(params: CoreRunParams, timeoutMs = 15_000) {
    return this.call(
      "terminal.run",
      {
        name: params.name,
        cwd: params.cwd,
        labels: params.labels,
        size: params.size,
        no_parent: true,
        no_notify: true,
        rm: true,
      },
      timeoutMs,
    ) as Promise<CoreTerminalRecord>;
  }

  /**
   * An interactive viewer. Core opens the stream paused and resumes it after
   * its reply, so the first paint always follows the reply; the stream's
   * window is returned only as the consumer reports bytes delivered.
   * Automatic replies go only where hello and the attach reply allow them.
   */
  async attach(
    address: string,
    size: CoreCellSize,
    handlers: CoreAttachHandlers,
    timeoutMs = 10_000,
    options: { history?: number } = {},
  ): Promise<CoreAttachment> {
    const reply = await this.call(
      "terminal.attach",
      {
        terminal: localAddress(address),
        cols: size.cols,
        rows: size.rows,
        ...(options.history === undefined ? {} : { history: options.history }),
      },
      timeoutMs,
    );
    if (
      !isRecord(reply) ||
      typeof reply.channel !== "number" ||
      !Number.isSafeInteger(reply.channel) ||
      reply.channel <= 0 ||
      !isRecord(reply.terminal) ||
      reply.terminal.address !== address
    ) {
      if (isRecord(reply) && typeof reply.channel === "number")
        this.release(reply.channel);
      throw new CoreProtocolError("attach reply is invalid");
    }
    if (this.closedError) throw this.closedError;
    const channel = reply.channel;
    const automatic =
      this.hello.features.includes("automatic_input") &&
      reply.automatic_input === true;
    let open = true;
    const finish = (reason: string) => {
      if (!open) return;
      open = false;
      handlers.end(reason);
    };
    this.claim(channel, {
      data: (bytes) => {
        if (open) handlers.data(bytes);
      },
      close: finish,
      manualCredit: true,
    });
    const frame = (kind: number, payload: Uint8Array) => {
      if (open && this.sinks.has(channel))
        this.send(encodeFrame(channel, kind, payload));
    };
    return {
      channel,
      terminal: reply.terminal as CoreTerminalRecord,
      automatic,
      get open() {
        return open;
      },
      input: (bytes) => {
        if (bytes.byteLength > 0) frame(FrameKind.DATA, bytes);
      },
      automaticInput: (bytes) => {
        if (automatic && bytes.byteLength > 0)
          frame(FrameKind.AUTOMATIC_INPUT, bytes);
      },
      resize: (next) => frame(FrameKind.RESIZE, cellSizePayload(next)),
      focus: (focused) =>
        frame(FrameKind.FOCUS, new Uint8Array([focused ? 1 : 0])),
      credit: (bytes) => {
        if (open && bytes > 0) this.send(creditFrame(channel, bytes));
      },
      detach: () => {
        if (!open) return;
        // Frames core wrote before it read our CLOSE are dropped, uncredited,
        // until its own CLOSE ends the channel; never held as unclaimed.
        this.release(channel);
        finish("detached");
      },
    };
  }

  /**
   * World's keyboard on a terminal someone watches: an interactive viewer
   * whose only job is input. It never displays (the watch does, from its
   * observe stream), so its stream is dropped and never credited: core then
   * bounds it at its own pending limit and repaints instead of replaying,
   * and program output is never held back. Core makes it the size leader
   * the moment it attaches (not `resumed`), so it is opened only for a key
   * a person typed.
   */
  keyboard(
    address: string,
    size: CoreCellSize,
    ended: (reason: string) => void,
    timeoutMs = 10_000,
  ): Promise<CoreKeyboard> {
    return this.attach(
      address,
      size,
      { data: () => {}, end: ended },
      timeoutMs,
      { history: 0 },
    );
  }

  /** World ends a stream: CLOSE once, then drop its frames until core's CLOSE. */
  private release(channel: number) {
    this.sinks.delete(channel);
    for (const frame of this.unclaimed.get(channel) ?? [])
      this.unclaimedBytes -= frame.payload.byteLength;
    this.unclaimed.delete(channel);
    if (this.closedError) return;
    this.retired.add(channel);
    this.send(encodeFrame(channel, FrameKind.CLOSE));
  }

  /** Whether this core takes typing from an interactive viewer. */
  get offersKeyboard(): boolean {
    return (
      this.hello.methods.includes(WATCH_METHOD) &&
      this.hello.features.includes("attach")
    );
  }

  /** Whether this core offers World's float shells at all. */
  get offersFloatShells(): boolean {
    return (
      FLOAT_SHELL_METHODS.every((m) => this.hello.methods.includes(m)) &&
      this.hello.features.includes("attach")
    );
  }

  private call(
    method: CoreMethod | typeof WATCH_METHOD,
    params: Record<string, unknown>,
    timeoutMs: number,
    cancel?: AbortSignal,
  ): Promise<unknown> {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const askCancel = () => this.send(coreCancelFrame(id));
      const settle = () => cancel?.removeEventListener("abort", askCancel);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (method === WATCH_METHOD) this.abandoned.add(id);
        settle();
        // World gives up on it: core drops it too if it is still held.
        if (cancel) askCancel();
        reject(new CoreUnavailableError(`timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          settle();
          resolve(value);
        },
        reject: (error) => {
          settle();
          reject(error);
        },
        timer,
      });
      this.send(
        encodeFrame(
          0,
          FrameKind.DATA,
          new TextEncoder().encode(
            JSON.stringify({ jsonrpc: "2.0", id, method, params }),
          ),
        ),
      );
      if (cancel?.aborted) askCancel();
      else cancel?.addEventListener("abort", askCancel, { once: true });
    });
  }

  private send(bytes: Uint8Array) {
    if (this.closedError) return;
    this.options.onOutbound?.(bytes);
    this.stream.write(bytes);
  }

  private claim(channel: number, sink: ChannelSink) {
    if (this.closedError) return;
    this.sinks.set(channel, sink);
    const held = this.unclaimed.get(channel) ?? [];
    this.unclaimed.delete(channel);
    for (const frame of held) {
      this.unclaimedBytes -= frame.payload.byteLength;
      if (!this.deliver(frame)) return;
    }
  }

  private receive(bytes: Uint8Array) {
    if (this.closedError) return;
    let frames: Frame[];
    try {
      frames = this.decoder.push(bytes);
    } catch (error) {
      this.terminate(error as Error);
      return;
    }
    for (const frame of frames) {
      if (this.closedError) return;
      if (frame.channel === 0) {
        if (frame.kind === FrameKind.DATA) this.reply(frame.payload);
        continue;
      }
      if (this.retired.has(frame.channel)) {
        if (frame.kind === FrameKind.CLOSE) this.retired.delete(frame.channel);
        continue;
      }
      if (!this.sinks.has(frame.channel)) {
        // A subscribe opens its stream before the reply is written.
        const held = this.unclaimed.get(frame.channel) ?? [];
        held.push(frame);
        this.unclaimed.set(frame.channel, held);
        this.unclaimedBytes += frame.payload.byteLength;
        if (this.unclaimedBytes > MAX_UNCLAIMED_BYTES) {
          this.terminate(
            new CoreProtocolError("too much data on unclaimed channels"),
          );
          return;
        }
        continue;
      }
      this.deliver(frame);
    }
  }

  /** Returns false when delivery ended the connection. */
  private deliver(frame: Frame): boolean {
    const sink = this.sinks.get(frame.channel);
    if (!sink) return true;
    try {
      if (frame.kind === FrameKind.DATA) {
        sink.data(frame.payload);
        // Credit what was consumed, so core keeps the stream flowing.
        if (frame.payload.byteLength > 0 && !sink.manualCredit)
          this.send(creditFrame(frame.channel, frame.payload.byteLength));
      } else if (frame.kind === FrameKind.RESIZE) {
        if (!sink.resize) return true;
        if (frame.payload.byteLength !== 4)
          throw new CoreProtocolError("RESIZE payload is not two u16 values");
        const view = new DataView(
          frame.payload.buffer,
          frame.payload.byteOffset,
          4,
        );
        sink.resize(view.getUint16(0, true), view.getUint16(2, true));
      } else if (frame.kind === FrameKind.CLOSE) {
        this.sinks.delete(frame.channel);
        sink.close(new TextDecoder().decode(frame.payload) || "closed");
      }
    } catch (error) {
      this.terminate(error as Error);
      return false;
    }
    return true;
  }

  private reply(payload: Uint8Array) {
    let message: unknown;
    try {
      message = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      this.terminate(new CoreProtocolError("control reply is not JSON"));
      return;
    }
    if (!isRecord(message) || typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) {
      // A watch nobody waits for any more must not hold a stream open.
      if (this.abandoned.delete(message.id)) {
        const result = message.result;
        if (isRecord(result) && typeof result.channel === "number")
          this.release(result.channel);
      }
      return;
    }
    this.pending.delete(message.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (isRecord(message.error)) {
      const data = isRecord(message.error.data) ? message.error.data : {};
      pending.reject(
        new CoreRpcError(
          String(message.error.message ?? "core error"),
          typeof message.error.code === "number" ? message.error.code : 0,
          typeof data.kind === "string" ? data.kind : null,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private terminate(error: Error) {
    if (this.closedError) return;
    this.closedError = error;
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    const sinks = [...this.sinks.values()];
    this.sinks.clear();
    this.retired.clear();
    this.abandoned.clear();
    this.unclaimed.clear();
    this.stream.close();
    for (const sink of sinks) {
      try {
        sink.close(error.message);
      } catch {
        // A closing consumer cannot keep the connection alive.
      }
    }
    this.options.onClosed?.(error);
    for (const waiter of this.closeWaiters.splice(0)) waiter(error);
  }
}

/**
 * Direct connections address only this core's own terminals (`tN`). Linked
 * machine (`m/tN`), parent and child forms route elsewhere and are refused.
 */
export function localAddress(address: string): string {
  if (!isLocalCoreAddress(address))
    throw new CoreProtocolError(`not a local terminal address: ${address}`);
  return address;
}
