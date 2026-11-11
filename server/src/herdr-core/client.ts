import type { CoreByteStream } from "./stream";
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
/** Methods this client may call: observation only, built from typed verbs. */
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
 * program (`terminal.run`), end one (`terminal.kill`) and set labels.
 * Never `terminal.send`/`keys` (the delivery item), `machine.*`, `file.*`,
 * `server.stop`/`restart` or `terminal.put`.
 */
export type CoreWriteMethod =
  | "terminal.run"
  | "terminal.kill"
  | "terminal.label";
type CoreMethod = ObservationMethod | CoreWriteMethod;
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

/** Fresh native `terminal.run` parameters from a typed request. */
export function coreRunParams(request: CoreRunRequest) {
  const argv = request.argv.map(String);
  if (argv.length > 0 && !/^\/[^\0]*$/.test(argv[0]!))
    throw new CoreProtocolError("a program must be an absolute executable");
  if (argv.some((arg) => arg.length > MAX_ARG || arg.includes("\0")))
    throw new CoreProtocolError("a program argument is invalid");
  if (request.cwd !== undefined && !/^\/[^\0]*$/.test(request.cwd))
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
 * One framed connection to an already-running core. It never starts a core,
 * never calls a mutating method and never sends `caller`.
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
   * Ends a program. Core also ends every live child started with this
   * terminal as parent that does not outlive it (see kill-plan.ts).
   */
  kill(address: string, timeoutMs = 10_000) {
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
        if (frame.payload.byteLength > 0)
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
