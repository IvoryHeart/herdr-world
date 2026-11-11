import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CoreByteStream } from "../stream";
import { encodeFrame, FrameDecoder, FrameKind, STREAM_WINDOW } from "../wire";

/**
 * An in-process herdr-core that speaks the same wire protocol as the real
 * one (verified by replaying recorded traffic through both). It runs no
 * programs: terminals are synthetic records. Faults are injected on purpose.
 */
export type FakeTerminal = Record<string, unknown> & {
  address: string;
  labels: Record<string, string>;
  argv: string[];
  state: string;
};

const CHUNK = 16 * 1024;
const MAX_PENDING = 4 << 20;

type Subscriber = {
  connection: FakeConnection;
  channel: number;
};

type FakeConnection = {
  stream: CoreByteStream;
  framed: boolean;
  decoder: FrameDecoder;
  plain: string;
  nextChannel: number;
  /** Per stream channel: unsent bytes and remaining credit. */
  streams: Map<
    number,
    { pending: Uint8Array[]; bytes: number; credit: number }
  >;
  heartbeat: ReturnType<typeof setInterval> | null;
};

export type FakeCoreOptions = {
  coreId?: string;
  name?: string;
  version?: string;
  heartbeatMs?: number;
  /** Splits every outbound write into pieces of at most this many bytes. */
  splitWritesAt?: number;
};

export class FakeCore {
  readonly coreId: string;
  readonly name: string;
  readonly version: string;
  pid = 41_000;
  private startedAt = Date.now();
  private seq = 0;
  private nextTerminal = 1;
  private readonly terminals = new Map<string, FakeTerminal>();
  private readonly connections = new Set<FakeConnection>();
  private readonly subscribers: Subscriber[] = [];
  private listener: { stop(closeActive?: boolean): void } | null = null;
  private running = false;
  private heldReads: Array<() => void> | null = null;
  /** Calls received on channel 0, for assertions about what World sends. */
  readonly calls: Array<{ method: string; params: unknown }> = [];

  constructor(private readonly options: FakeCoreOptions = {}) {
    this.coreId = options.coreId ?? "c0ffee0000000001";
    this.name = options.name ?? "example-host";
    this.version = options.version ?? "0.1.20";
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentSeq(): number {
    return this.seq;
  }

  terminal(address: string): FakeTerminal | undefined {
    return this.terminals.get(address);
  }

  /** Serves an in-memory stream, as a socket accept would. */
  accept(stream: CoreByteStream): void {
    if (!this.running) {
      stream.close();
      return;
    }
    const connection: FakeConnection = {
      stream,
      framed: false,
      decoder: new FrameDecoder(),
      plain: "",
      nextChannel: 1,
      streams: new Map(),
      heartbeat: null,
    };
    this.connections.add(connection);
    stream.onData((bytes) => this.receive(connection, bytes));
    stream.onClose(() => this.drop(connection));
  }

  /** Starts serving on a Unix socket and writes `core.lock` like core does. */
  async listen(
    stateDir: string,
    socketDir: string,
    socketName = "default.sock",
  ) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    chmodSync(socketDir, 0o700);
    const socket = join(socketDir, socketName);
    rmSync(socket, { force: true });
    this.running = true;
    const accept = (stream: CoreByteStream) => this.accept(stream);
    const streams = new Map<
      unknown,
      { data: (b: Uint8Array) => void; close: () => void }
    >();
    this.listener = Bun.listen({
      unix: socket,
      socket: {
        open(sock) {
          const data: Array<(bytes: Uint8Array) => void> = [];
          const close: Array<() => void> = [];
          let closed = false;
          const queue: Uint8Array[] = [];
          streams.set(sock, {
            data: (bytes) => {
              for (const listener of data) listener(bytes);
            },
            close: () => {
              if (closed) return;
              closed = true;
              for (const listener of close) listener();
            },
          });
          (sock as unknown as { queue: Uint8Array[] }).queue = queue;
          accept({
            write(bytes) {
              if (closed) return;
              if (queue.length > 0) {
                queue.push(bytes);
                return;
              }
              const written = sock.write(bytes);
              if (written < bytes.byteLength)
                queue.push(bytes.subarray(Math.max(0, written)));
            },
            close() {
              sock.end();
            },
            onData(listener) {
              data.push(listener);
            },
            onClose(listener) {
              if (closed) listener();
              else close.push(listener);
            },
          });
        },
        data(sock, bytes) {
          streams.get(sock)?.data(new Uint8Array(bytes));
        },
        drain(sock) {
          const queue = (sock as unknown as { queue: Uint8Array[] }).queue;
          while (queue.length > 0) {
            const next = queue[0]!;
            const written = sock.write(next);
            if (written === next.byteLength) queue.shift();
            else {
              queue[0] = next.subarray(Math.max(0, written));
              return;
            }
          }
        },
        close(sock) {
          streams.get(sock)?.close();
          streams.delete(sock);
        },
        error(sock) {
          streams.get(sock)?.close();
          streams.delete(sock);
        },
      },
    });
    writeFileSync(join(stateDir, "core.lock"), socket, { mode: 0o600 });
    return socket;
  }

  /** Like `kill -9` of core: every connection ends, the socket goes, the lock stays. */
  kill(socketPath?: string): void {
    this.running = false;
    for (const connection of [...this.connections]) connection.stream.close();
    this.connections.clear();
    this.subscribers.length = 0;
    this.listener?.stop(true);
    this.listener = null;
    if (socketPath) rmSync(socketPath, { force: true });
  }

  /**
   * A new core process on the same state: holders kept every terminal at its
   * address with its program, and `seq` starts again.
   */
  revive(): void {
    this.running = true;
    this.pid += 1;
    this.seq = 0;
    this.startedAt = Date.now();
  }

  // --- Synthetic programs ---------------------------------------------------

  create(fields: Partial<FakeTerminal> = {}): string {
    const address = `t${this.nextTerminal++}`;
    const record: FakeTerminal = {
      address,
      name: null,
      labels: {},
      argv: ["/bin/sh"],
      cwd: "/tmp/example",
      state: "live",
      created_ms: Date.now(),
      screen: "exact",
      cols: 200,
      rows: 120,
      pid: 50_000 + this.nextTerminal,
      keep: false,
      reported: false,
      status: null,
      turn: 0,
      title: "",
      template: null,
      foreground: {
        pid: 50_000 + this.nextTerminal,
        name: "sh",
        argv: ["/bin/sh"],
        cwd: "/tmp/example",
      },
      ...fields,
    };
    this.terminals.set(address, record);
    this.emit("created", address, record);
    return address;
  }

  label(address: string, labels: Record<string, string>): void {
    const record = this.require(address);
    record.labels = { ...record.labels, ...labels };
    this.emit("labels", address, { labels: record.labels });
  }

  status(address: string, state: string | null): void {
    const record = this.require(address);
    record.status = state ? { state } : null;
    record.reported = record.reported === true || state !== null;
    this.emit("status", address, {
      status: record.status,
      records: {},
      reported: record.reported,
    });
  }

  /** Holds `terminal.read` replies until the returned release sends them. */
  holdReads(): () => void {
    const held: Array<() => void> = [];
    this.heldReads = held;
    return () => {
      if (this.heldReads === held) this.heldReads = null;
      for (const send of held.splice(0)) send();
    };
  }

  /** A kept terminal whose program is lost gets a shell at the same address. */
  replaceWithShell(address: string): void {
    const record = this.require(address);
    record.pid = null;
    delete record.foreground;
    this.emit("lost", address, {
      reason: "signaled",
      exit_code: null,
      signal: 9,
      finished_ms: null,
    });
    const shellPid = 60_000 + this.seq;
    Object.assign(record, {
      pid: shellPid,
      argv: ["/bin/sh"],
      template: null,
      reported: false,
      status: null,
      title: "",
      foreground: {
        pid: shellPid,
        name: "sh",
        argv: ["/bin/sh"],
        cwd: "/tmp/example",
      },
    });
    this.emit("restarted", address, { ...record });
  }

  remove(address: string): void {
    this.require(address);
    this.emit("removed", address, {});
    this.terminals.delete(address);
  }

  /** Loses events silently, as core does when a `missed` exceeds 4 MiB. */
  suppressEvents(count: number): void {
    this.seq += count;
  }

  heartbeatNow(): void {
    for (const sub of this.subscribers)
      if (this.queued(sub) === 0)
        this.enqueue(sub, this.line("heartbeat", { seq: this.seq }));
  }

  /** Writes raw bytes on every event channel (garbled tails, bad UTF-8). */
  injectEventBytes(bytes: Uint8Array): void {
    for (const sub of this.subscribers) this.enqueue(sub, bytes);
  }

  // --- Protocol ---------------------------------------------------------------

  private require(address: string): FakeTerminal {
    const record = this.terminals.get(address);
    if (!record) throw new Error(`no terminal ${address}`);
    return record;
  }

  private emit(type: string, address: string, data: unknown) {
    this.seq += 1;
    const line = this.line("event", {
      seq: this.seq,
      type,
      terminal: address,
      data,
    });
    for (const sub of this.subscribers) {
      if (!this.enqueueLines(sub, line))
        this.enqueue(sub, this.line("missed", this.snapshot()));
    }
  }

  private snapshot() {
    return {
      seq: this.seq,
      terminals: [...this.terminals.values()].map((t) => ({ ...t })),
    };
  }

  private line(method: string, params: unknown): Uint8Array {
    return new TextEncoder().encode(
      `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
    );
  }

  private write(connection: FakeConnection, bytes: Uint8Array) {
    const at = this.options.splitWritesAt;
    if (!at) {
      connection.stream.write(bytes);
      return;
    }
    for (let i = 0; i < bytes.byteLength; i += at)
      connection.stream.write(bytes.subarray(i, i + at));
  }

  private receive(connection: FakeConnection, bytes: Uint8Array) {
    if (!connection.framed) {
      connection.plain += new TextDecoder().decode(bytes);
      const newline = connection.plain.indexOf("\n");
      if (newline === -1) return;
      const request = JSON.parse(connection.plain.slice(0, newline));
      const rest = new TextEncoder().encode(
        connection.plain.slice(newline + 1),
      );
      connection.plain = "";
      this.calls.push({ method: request.method, params: request.params });
      const framed = request.params?.framed === true;
      const reply =
        request.method === "hello"
          ? { jsonrpc: "2.0", id: request.id, result: this.hello(framed) }
          : {
              jsonrpc: "2.0",
              id: request.id,
              error: {
                code: -32601,
                message: "fixture speaks framed mode only",
              },
            };
      this.write(
        connection,
        new TextEncoder().encode(`${JSON.stringify(reply)}\n`),
      );
      connection.framed = framed;
      if (rest.byteLength > 0) this.receive(connection, rest);
      return;
    }
    for (const frame of connection.decoder.push(bytes)) {
      if (frame.channel === 0 && frame.kind === FrameKind.DATA) {
        this.call(
          connection,
          JSON.parse(new TextDecoder().decode(frame.payload)),
        );
      } else if (
        frame.kind === FrameKind.CREDIT &&
        frame.payload.byteLength === 4
      ) {
        const stream = connection.streams.get(frame.channel);
        if (stream) {
          stream.credit += new DataView(
            frame.payload.buffer,
            frame.payload.byteOffset,
            4,
          ).getUint32(0, true);
          this.flush(connection, frame.channel);
        }
      }
    }
  }

  private hello(framed: boolean) {
    return {
      generation: 1,
      version: this.version,
      core: { id: this.coreId, name: this.name },
      framed,
      methods: [
        "hello",
        "server.status",
        "terminal.list",
        "terminal.get",
        "terminal.read",
        "events.subscribe",
      ],
      features: [
        "framed",
        "attach",
        "events",
        "status",
        "shell",
        "resize_notifications",
        "automatic_input",
      ],
    };
  }

  private call(
    connection: FakeConnection,
    request: { id: number; method: string; params: Record<string, unknown> },
  ) {
    this.calls.push({ method: request.method, params: request.params });
    const reply = (result: unknown) =>
      this.write(
        connection,
        encodeFrame(
          0,
          FrameKind.DATA,
          new TextEncoder().encode(
            JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
          ),
        ),
      );
    const error = (code: number, message: string, kind: string) =>
      this.write(
        connection,
        encodeFrame(
          0,
          FrameKind.DATA,
          new TextEncoder().encode(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              error: { code, message, data: { kind, hint: "" } },
            }),
          ),
        ),
      );
    switch (request.method) {
      case "server.status": {
        const live = [...this.terminals.values()].filter(
          (t) => t.state === "live",
        ).length;
        return reply({
          core: { id: this.coreId, name: this.name },
          version: this.version,
          pid: this.pid,
          uptime_ms: Date.now() - this.startedAt,
          holder: null,
          holders: [],
          live,
          finished: this.terminals.size - live,
          installed_by: null,
        });
      }
      case "events.subscribe": {
        const channel = connection.nextChannel++;
        connection.streams.set(channel, {
          pending: [],
          bytes: 0,
          credit: STREAM_WINDOW,
        });
        const sub = { connection, channel };
        this.subscribers.push(sub);
        const snapshot = this.snapshot();
        connection.heartbeat ??= setInterval(
          () => this.heartbeatNow(),
          this.options.heartbeatMs ?? 15_000,
        );
        return reply({ ...snapshot, channel });
      }
      case "terminal.list":
        return reply({
          terminals: [...this.terminals.values()],
          hidden_finished: 0,
        });
      case "terminal.get": {
        const record = this.terminals.get(String(request.params?.terminal));
        return record
          ? reply(record)
          : error(
              -32000,
              `no terminal ${request.params?.terminal}`,
              "not_found",
            );
      }
      case "terminal.read": {
        const record = this.terminals.get(String(request.params?.terminal));
        if (!record) return error(-32000, "no terminal", "not_found");
        const send = () => reply({ complete: true, how: "screen", text: "$" });
        if (this.heldReads) this.heldReads.push(send);
        else send();
        return;
      }
      default:
        return error(-32601, `method not found: ${request.method}`, "usage");
    }
  }

  private queued(sub: Subscriber): number {
    return sub.connection.streams.get(sub.channel)?.bytes ?? 0;
  }

  /** Like core's `data_lines`: false (backlog cut at a line) when too far behind. */
  private enqueueLines(sub: Subscriber, bytes: Uint8Array): boolean {
    const stream = sub.connection.streams.get(sub.channel);
    if (!stream) return true;
    if (stream.bytes + bytes.byteLength > MAX_PENDING) {
      // Keep the rest of a line whose start may already be out.
      const all = Buffer.concat(stream.pending);
      const newline = all.indexOf(0x0a);
      const rest = newline === -1 ? all : all.subarray(0, newline + 1);
      stream.pending = rest.byteLength > 0 ? [new Uint8Array(rest)] : [];
      stream.bytes = rest.byteLength;
      return false;
    }
    return this.enqueue(sub, bytes);
  }

  /** Like core's `data`: a payload that cannot fit is dropped silently. */
  private enqueue(sub: Subscriber, bytes: Uint8Array): boolean {
    const stream = sub.connection.streams.get(sub.channel);
    if (!stream) return true;
    if (stream.bytes + bytes.byteLength > MAX_PENDING) {
      stream.pending = [];
      stream.bytes = 0;
      return false;
    }
    stream.pending.push(bytes);
    stream.bytes += bytes.byteLength;
    this.flush(sub.connection, sub.channel);
    return true;
  }

  private flush(connection: FakeConnection, channel: number) {
    const stream = connection.streams.get(channel);
    if (!stream) return;
    while (stream.bytes > 0 && stream.credit > 0) {
      const first = stream.pending[0]!;
      const n = Math.min(first.byteLength, stream.credit, CHUNK);
      const chunk = first.subarray(0, n);
      if (n === first.byteLength) stream.pending.shift();
      else stream.pending[0] = first.subarray(n);
      stream.bytes -= n;
      stream.credit -= n;
      this.write(connection, encodeFrame(channel, FrameKind.DATA, chunk));
    }
  }

  private drop(connection: FakeConnection) {
    if (connection.heartbeat) clearInterval(connection.heartbeat);
    this.connections.delete(connection);
    for (let i = this.subscribers.length - 1; i >= 0; i--)
      if (this.subscribers[i]!.connection === connection)
        this.subscribers.splice(i, 1);
  }
}
