import type { CoreByteStream } from "./stream";
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

/** The protocol generation World speaks; core refuses any other in `hello`. */
export const CORE_PROTOCOL_GENERATION = 1;
/** Methods observation needs, built from typed verbs. */
const OBSERVATION_METHODS = [
  "server.status",
  "terminal.list",
  "terminal.get",
  "terminal.read",
  "events.subscribe",
] as const;
type ObservationMethod = (typeof OBSERVATION_METHODS)[number];
/**
 * The writes World makes, each built from a typed verb below: start a
 * program (`terminal.run`), end one (`terminal.kill`) and set labels (the
 * shared `herdr.seen`/`herdr.pinned`, and placement at launch). None is
 * required for observation: on a core without one, that action fails and
 * World keeps observing. World's own float shells (`float-shell.ts`) also
 * view theirs (`terminal.attach`). Native `terminal.send` delivers asks and Ranger prompts. Never `terminal.keys`, `machine.*`, `file.*`, `server.stop`/`restart` or
 * `terminal.put`.
 */
export type CoreWriteMethod =
  | "terminal.run"
  | "terminal.kill"
  | "terminal.label"
  | "terminal.send";
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
/** Required for observation; absence is an unsupported operation, not a pin. */
export const REQUIRED_CORE_METHODS: readonly string[] = OBSERVATION_METHODS;
export const REQUIRED_CORE_FEATURES = ["framed", "events"] as const;

const HELLO_LINE_LIMIT = 1 << 20;
/** Unclaimed stream bytes held while a subscribe reply is still in flight. */
const MAX_UNCLAIMED_BYTES = 8 << 20;

export type CoreHello = {
  generation: number;
  version: string;
  core: { id: string; name: string };
  methods: string[];
  features: string[];
};

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

export class CoreRpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly kind: string | null,
  ) {
    super(message);
    this.name = "CoreRpcError";
  }
}

export class CoreUnavailableError extends Error {
  readonly retryable = true;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CoreUnavailableError";
  }
}

/**
 * A write whose reply never came (timeout or a closed connection after it
 * was sent): core may or may not have done it. Shown as uncertain and never
 * retried automatically.
 */
export class CoreWriteUncertainError extends Error {
  readonly outcome = "uncertain";
  constructor(method: string, options?: ErrorOptions) {
    super(`herdr-core may have done ${method}; its reply never came`, options);
    this.name = "CoreWriteUncertainError";
  }
}

/** The connected core does not offer an operation World needs. */
export class CoreUnsupportedError extends Error {
  readonly retryable = false;
  constructor(version: string, method: string) {
    super(`herdr-core ${version} does not offer ${method}`);
    this.name = "CoreUnsupportedError";
  }
}

export class CoreIncompatibleError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "CoreIncompatibleError";
  }
}

/**
 * What World asks core to start. Every native parameter is set explicitly,
 * so a core whose defaults change (parent death, notes) behaves the same:
 * no `caller` (it would make World's terminal the parent), no parent, no
 * notes, and `keep` exactly as the launch chose it. `argv` is empty (the
 * host's configured shell) or starts with an absolute executable: a bare
 * program name would first load a core template of that name.
 */
export type CoreRunRequest = {
  argv: string[];
  /** Absent: the core's own folder. */
  cwd?: string;
  env?: Record<string, string>;
  labels?: Record<string, string>;
  keep: boolean;
  /** Unique among live terminals; core refuses a taken one (`name_taken`). */
  name?: string;
  size?: { cols: number; rows: number };
};

/**
 * Labels World may write: Herdr's shared ones, the app's `where` caption
 * (written once at launch) and World's own namespace.
 */
const WRITABLE_LABEL =
  /^(?:herdr\.(?:seen|pinned|space|tab)|where|herdr-world\.[a-z][a-z0-9-]{0,31})$/;
const MAX_LABEL_VALUE = 1024;
const MAX_ARG = 16 * 1024;

function checkLabels(labels: Record<string, string>) {
  const entries = Object.entries(labels);
  if (entries.length > 16) throw new CoreProtocolError("too many labels");
  for (const [key, value] of entries) {
    if (!WRITABLE_LABEL.test(key))
      throw new CoreProtocolError(`World does not write label ${key}`);
    if (typeof value !== "string" || value.length > MAX_LABEL_VALUE)
      throw new CoreProtocolError(`label ${key} is too long`);
  }
  return Object.fromEntries(entries);
}

/** An absolute path on a Unix host (`/…`) or a Windows one (`C:\\…`). */
const ABSOLUTE = /^(?:\/|[A-Za-z]:\\)[^\0]*$/;

/** Fresh native `terminal.run` parameters from a typed request. */
export function coreRunParams(request: CoreRunRequest) {
  const argv = request.argv.map(String);
  if (argv.length > 0 && !ABSOLUTE.test(argv[0]!))
    throw new CoreProtocolError("a program must be an absolute executable");
  if (argv.some((arg) => arg.length > MAX_ARG || arg.includes("\0")))
    throw new CoreProtocolError("a program argument is invalid");
  if (request.cwd !== undefined && !ABSOLUTE.test(request.cwd))
    throw new CoreProtocolError("the working folder must be absolute");
  const env = Object.fromEntries(
    Object.entries(request.env ?? {}).map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || /^HC_/.test(key))
        throw new CoreProtocolError(`World does not set ${key}`);
      return [key, String(value)];
    }),
  );
  if (request.name !== undefined && !/^[a-z0-9_.-]{1,32}$/.test(request.name))
    throw new CoreProtocolError("a terminal name is invalid");
  const size = request.size;
  if (
    size &&
    !(
      Number.isSafeInteger(size.cols) &&
      Number.isSafeInteger(size.rows) &&
      size.cols > 0 &&
      size.rows > 0 &&
      size.cols <= 1000 &&
      size.rows <= 1000
    )
  )
    throw new CoreProtocolError("a terminal size is invalid");
  return {
    argv,
    ...(request.cwd !== undefined ? { cwd: request.cwd } : {}),
    env,
    labels: checkLabels(request.labels ?? {}),
    keep: request.keep === true,
    ...(request.name !== undefined ? { name: request.name } : {}),
    no_parent: true,
    no_notify: true,
    outlive_parent: false,
    ...(size ? { size: { cols: size.cols, rows: size.rows } } : {}),
  };
}

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout> | null;
};

type ChannelSink = {
  data(bytes: Uint8Array): void;
  close(reason: string): void;
  /** The consumer returns credit itself (`CoreAttachment.credit`). */
  manualCredit?: boolean;
};

/** Size of a viewer in cells; core takes it from the latest typing viewer. */
export type CoreCellSize = { cols: number; rows: number };

/** One interactive viewer of a terminal World started (a float shell). */
export type CoreAttachment = {
  readonly channel: number;
  readonly terminal: CoreTerminalRecord;
  /** Keys typed by a person, sent as they are. */
  input(bytes: Uint8Array): void;
  resize(size: CoreCellSize): void;
  /** Return `bytes` of consumed stream window, once they were delivered on. */
  credit(bytes: number): void;
  /** Leave: the terminal keeps running and returns to its headless size. */
  detach(): void;
};

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

export type CoreClientOptions = {
  /** Called once when the stream ends or the protocol fails. */
  onClosed?(error: Error): void;
  /** Recording hook: every inbound byte slice, before decoding. */
  onInbound?(bytes: Uint8Array): void;
  onOutbound?(bytes: Uint8Array): void;
  maxEventLineBytes?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseHello(value: unknown): CoreHello {
  if (!isRecord(value))
    throw new CoreIncompatibleError("hello reply is invalid");
  const core = value.core;
  if (
    value.generation !== CORE_PROTOCOL_GENERATION ||
    value.framed !== true ||
    typeof value.version !== "string" ||
    !isRecord(core) ||
    typeof core.id !== "string" ||
    !core.id ||
    typeof core.name !== "string" ||
    !Array.isArray(value.methods) ||
    !Array.isArray(value.features)
  )
    throw new CoreIncompatibleError("hello reply is not framed generation 1");
  const methods = value.methods.filter(
    (m): m is string => typeof m === "string",
  );
  const features = value.features.filter(
    (f): f is string => typeof f === "string",
  );
  const missing = [
    ...REQUIRED_CORE_METHODS.filter((m) => !methods.includes(m)),
    ...REQUIRED_CORE_FEATURES.filter((f) => !features.includes(f)),
  ];
  if (missing.length > 0)
    throw new CoreIncompatibleError(
      `core ${value.version} lacks ${missing.join(", ")}`,
    );
  return {
    generation: value.generation,
    version: value.version,
    core: { id: core.id, name: core.name },
    methods,
    features,
  };
}

/**
 * One framed connection to an already-running core. It never starts a core
 * and never sends `caller`. Its mutating calls are the typed writes
 * (`run`, `kill`, `label`, `shareLabel`) and World's own float shells
 * (`runShell`, `attach`).
 */
export class CoreClient {
  private readonly decoder = new FrameDecoder();
  private readonly pending = new Map<number, Pending>();
  private readonly sinks = new Map<number, ChannelSink>();
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

  /** Core owns paste, Enter and harness-specific delivery. No caller or force. */
  sendText(address: string, text: string, timeoutMs = 15_000) {
    if (!text.trim() || text.length > 32_000 || text.includes("\0"))
      throw new CoreProtocolError("invalid message text");
    return this.write(
      "terminal.send",
      {
        terminal: localAddress(address),
        text,
        force: false,
        wait: false,
      },
      timeoutMs,
    ) as Promise<{
      status: string | null;
      turn: number;
      started: boolean | null;
    }>;
  }

  private async write(
    method: CoreWriteMethod,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    if (!this.offers(method))
      throw new CoreUnsupportedError(this.hello.version, method);
    if (this.closedError) throw this.closedError;
    try {
      return await this.call(method, params, timeoutMs);
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
    if (!/^t\d{1,9}$/.test(address) || !isSharedLabelChange(change))
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
   */
  async attach(
    address: string,
    size: CoreCellSize,
    handlers: CoreAttachHandlers,
    timeoutMs = 10_000,
  ): Promise<CoreAttachment> {
    const reply = await this.call(
      "terminal.attach",
      { terminal: localAddress(address), cols: size.cols, rows: size.rows },
      timeoutMs,
    );
    if (
      !isRecord(reply) ||
      typeof reply.channel !== "number" ||
      !Number.isSafeInteger(reply.channel) ||
      reply.channel <= 0 ||
      !isRecord(reply.terminal) ||
      reply.terminal.address !== address
    )
      throw new CoreProtocolError("attach reply is invalid");
    if (this.closedError) throw this.closedError;
    const channel = reply.channel;
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
    const cellSize = (next: CoreCellSize) => {
      const payload = new Uint8Array(4);
      const view = new DataView(payload.buffer);
      view.setUint16(0, next.cols, true);
      view.setUint16(2, next.rows, true);
      return payload;
    };
    return {
      channel,
      terminal: reply.terminal as CoreTerminalRecord,
      input: (bytes) => {
        if (!open || bytes.byteLength === 0) return;
        this.send(encodeFrame(channel, FrameKind.DATA, bytes));
      },
      resize: (next) => {
        if (open)
          this.send(encodeFrame(channel, FrameKind.RESIZE, cellSize(next)));
      },
      credit: (bytes) => {
        if (open && bytes > 0) this.send(creditFrame(channel, bytes));
      },
      detach: () => {
        if (!open) return;
        // Frames core wrote before it read our CLOSE are dropped, uncredited,
        // until its own CLOSE ends the channel; never held as unclaimed.
        if (this.sinks.has(channel))
          this.sinks.set(channel, {
            data: () => {},
            close: () => {},
            manualCredit: true,
          });
        this.send(encodeFrame(channel, FrameKind.CLOSE));
        finish("detached");
      },
    };
  }

  /** Whether this core offers World's float shells at all. */
  get offersFloatShells(): boolean {
    return (
      FLOAT_SHELL_METHODS.every((m) => this.hello.methods.includes(m)) &&
      this.hello.features.includes("attach")
    );
  }

  private call(
    method: CoreMethod,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CoreUnavailableError(`timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send(
        encodeFrame(
          0,
          FrameKind.DATA,
          new TextEncoder().encode(
            JSON.stringify({ jsonrpc: "2.0", id, method, params }),
          ),
        ),
      );
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
    if (!pending) return;
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
  if (!/^t[1-9][0-9]{0,9}$/.test(address))
    throw new CoreProtocolError(`not a local terminal address: ${address}`);
  return address;
}
