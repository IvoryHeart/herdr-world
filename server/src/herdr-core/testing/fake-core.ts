import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CoreByteStream } from "../stream";
import { encodeFrame, FrameDecoder, FrameKind, STREAM_WINDOW } from "../wire";
import { fakeCoreAddress } from "./fake-address";

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

type FakeStream = {
  pending: Uint8Array[];
  bytes: number;
  credit: number;
  /** A grid announcement that goes out before the pending paint. */
  resize?: [number, number] | null;
};

type FakeConnection = {
  stream: CoreByteStream;
  framed: boolean;
  decoder: FrameDecoder;
  plain: string;
  nextChannel: number;
  /** Per stream channel: unsent bytes and remaining credit. */
  streams: Map<number, FakeStream>;
  heartbeat: ReturnType<typeof setInterval> | null;
};

/**
 * A viewer of one terminal, as core's `viewers.rs` keeps it. A synthetic
 * desktop pane has no connection. The most recently active non-observe
 * viewer sets the size; with none, the terminal runs headless. Typed input
 * is echoed as a shell would, like `sh` on a pty.
 */
type FakeViewer = {
  connection: FakeConnection | null;
  channel: number;
  observe: boolean;
  notify: boolean;
  size: [number, number];
  activeAt: number;
};

/** Core's default headless grid (`config.rs`). */
export const FAKE_HEADLESS: readonly [number, number] = [200, 120];
/** What a viewer sent on an attach channel, for assertions about World. */
export type FakeViewerFrame = {
  address: string;
  observe: boolean;
  kind: number;
  payload: Uint8Array;
};

export type FakeCoreOptions = {
  coreId?: string;
  name?: string;
  version?: string;
  heartbeatMs?: number;
  /** Splits every outbound write into pieces of at most this many bytes. */
  splitWritesAt?: number;
  /** A core that offers no writes (to test negotiation, not a version pin). */
  observeOnly?: boolean;
  /** Writes an attach's stream frames before its reply (a relay may). */
  attachFramesFirst?: boolean;
  /** Answers observe attaches without confirming resize notifications. */
  denyResizeNotifications?: boolean;
};

/** What an observe-only core leaves out of `hello`. */
const WRITE_METHODS = new Set([
  "terminal.send",
  "terminal.keys",
  "terminal.run",
  "terminal.kill",
  "terminal.label",
  "terminal.attach",
]);

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
  /** Keys each terminal received from viewers, for assertions. */
  readonly typed = new Map<string, string>();
  /** Runs as a request arrives, before core handles and answers it. */
  onCall: ((method: string, params: Record<string, unknown>) => void) | null =
    null;
  /** Methods to leave out of `hello`, as an older or trimmed core would. */
  withoutMethods = new Set<string>();
  private listener: { stop(closeActive?: boolean): void } | null = null;
  private running = false;
  private heldReads: Array<() => void> | null = null;
  /** Calls received on channel 0, for assertions about what World sends. */
  readonly calls: Array<{ method: string; params: unknown }> = [];
  /** Every frame a viewer sent on an attach channel. */
  readonly viewerFrames: FakeViewerFrame[] = [];
  private readonly viewers = new Map<string, FakeViewer[]>();
  /** Each terminal's synthetic screen: the latest output, repainted on attach. */
  private readonly screens = new Map<string, string>();
  private activity = 0;
  /**
   * What `terminal.send`/`terminal.keys` typed, and into which program: the
   * pid and argv occupying the terminal when the input went in.
   */
  readonly deliveredInput: Array<{
    address: string;
    input: string | string[];
    pid: unknown;
    argv: unknown;
    foreground: string | null;
  }> = [];
  /**
   * While set, sends wait as core holds them for a person's draft or quiet
   * (`input.rs` type_in). `releaseSends` then types each into whatever runs
   * there by then, as core does: it checks no recipient (upstream Q3).
   */
  holdSends = false;
  /** Runs after input goes in and before core's reply is written. */
  onTyped: (() => void) | null = null;
  private readonly heldSends: Array<{
    connection: FakeConnection;
    id: number;
    address: string;
    text: string;
    force: boolean;
    reply(result: unknown): void;
    error(code: number, message: string, kind: string): void;
  }> = [];

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
    // Interactive viewers die with their connections; a desktop pane stays.
    for (const [address, list] of this.viewers)
      this.viewers.set(
        address,
        list.filter((v) => v.connection === null),
      );
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
    const address = fakeCoreAddress(this.nextTerminal++);
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

  /** As core's `terminal.label`: a patch; an empty value removes the key. */
  label(address: string, labels: Record<string, string>): void {
    const record = this.require(address);
    const next = { ...record.labels };
    for (const [key, value] of Object.entries(labels))
      if (value) next[key] = value;
      else delete next[key];
    record.labels = next;
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

  /** Types every held send now, into whatever occupies its terminal. */
  releaseSends(): void {
    this.holdSends = false;
    for (const held of this.heldSends.splice(0)) {
      if (!this.connections.has(held.connection)) continue;
      this.typeText(held);
    }
  }

  /** How many sends core is holding right now. */
  get heldSendCount(): number {
    return this.heldSends.length;
  }

  private typeText(held: {
    address: string;
    text: string;
    force: boolean;
    reply(result: unknown): void;
    error(code: number, message: string, kind: string): void;
  }) {
    const record = this.terminals.get(held.address);
    if (!record) return held.error(-32000, "no terminal", "not_found");
    if (record.state !== "live")
      return held.error(-32000, `${held.address} has finished`, "finished");
    if (typeof record.pid !== "number")
      return held.error(
        -32000,
        `${held.address} is lost, waiting for its new shell`,
        "unavailable",
      );
    const word = (record.status as { state?: unknown } | null)?.state ?? null;
    if (word === "blocked" && !held.force)
      return held.error(-32000, `${held.address} is blocked`, "blocked");
    this.deliveredInput.push({
      address: held.address,
      input: held.text,
      pid: record.pid,
      argv: record.argv,
      foreground:
        (record.foreground as { name?: string } | undefined)?.name ?? null,
    });
    const typed = this.onTyped;
    this.onTyped = null;
    typed?.();
    held.reply({
      turn: typeof record.turn === "number" ? record.turn : 0,
      status: typeof word === "string" ? word : null,
      started: record.reported === true ? false : null,
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

  /**
   * A full OSC 7501 root report, applied as core does (`status.rs`): the
   * record replaces the last, and leaving `working` ends a turn, announced
   * after the status as a `turn` event.
   */
  report(address: string, status: Record<string, unknown> | null): void {
    const record = this.require(address);
    const wasWorking =
      (record.status as { state?: unknown } | null)?.state === "working";
    record.status = status;
    record.reported = true;
    this.emit("status", address, {
      status,
      records: {},
      reported: true,
    });
    if (wasWorking && status?.state !== "working") {
      record.turn = (typeof record.turn === "number" ? record.turn : 0) + 1;
      this.emit("turn", address, {
        turn: record.turn,
        state: status?.state ?? null,
      });
    }
  }

  /** What runs in the terminal now, as core reads it about twice a second. */
  foreground(
    address: string,
    foreground: Record<string, unknown> | null,
  ): void {
    const record = this.require(address);
    if (foreground) record.foreground = foreground;
    else delete record.foreground;
    this.emit("foreground", address, foreground);
  }

  /** A kept terminal whose program is lost gets a shell at the same address. */
  /** `reusePid`: the shell gets the lost program's pid, as an OS may give. */
  replaceWithShell(address: string, { reusePid = false } = {}): void {
    const record = this.require(address);
    const lostPid = record.pid;
    record.pid = null;
    delete record.foreground;
    // Loss ends every attach stream, even for a kept terminal.
    this.endViewers(address, { reason: "signaled", exit_code: null });
    this.emit("lost", address, {
      reason: "signaled",
      exit_code: null,
      signal: 9,
      finished_ms: null,
    });
    const shellPid =
      reusePid && typeof lostPid === "number" ? lostPid : 60_000 + this.seq;
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

  /** Holds the next `terminal.kill`/`terminal.run` reply (a lost reply). */
  dropNextWriteReply = false;

  remove(address: string): void {
    this.require(address);
    this.endViewers(address, { reason: "killed", exit_code: null });
    this.emit("removed", address, {});
    this.terminals.delete(address);
  }

  /**
   * The program ends (it exits, or its pane is closed in an app), as core's
   * `record_finish` does: `finished`, every viewer's stream closes with the
   * finish facts, then every live child that dies with it, depth first
   * (`notes.rs` Orphaned). `rm` terminals are removed at once.
   */
  finish(
    address: string,
    reason = "exited",
    exitCode: number | null = reason === "exited" ? 0 : null,
  ): void {
    const record = this.require(address);
    if (record.state !== "live") return;
    const facts = {
      exit_code: exitCode,
      finished_ms: Date.now(),
      reason,
      signal: reason === "killed" ? 1 : null,
    };
    Object.assign(record, {
      state: "finished",
      status: null,
      pid: null,
      ...facts,
    });
    delete record.foreground;
    this.emit("finished", address, facts);
    this.endViewers(address, facts);
    if (record.rm === true) this.remove(address);
    for (const child of [...this.terminals.values()])
      if (
        child.state === "live" &&
        child.die_with_parent === true &&
        child.parent === address
      )
        this.finish(child.address, "killed");
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

  // --- Viewers (core's viewers.rs) -------------------------------------------

  /** A desktop app pane attaches interactively at its own size. */
  desktopAttach(address: string, cols: number, rows: number): void {
    this.require(address);
    const list = this.viewers.get(address) ?? [];
    const pane = list.find((v) => v.connection === null);
    if (pane) {
      pane.size = [cols, rows];
      pane.activeAt = ++this.activity;
    } else
      list.push({
        connection: null,
        channel: 0,
        observe: false,
        notify: false,
        size: [cols, rows],
        activeAt: ++this.activity,
      });
    this.viewers.set(address, list);
    this.applySize(address);
  }

  /** The desktop pane resizes (or is clicked): it leads again at that size. */
  desktopResize(address: string, cols: number, rows: number): void {
    this.desktopAttach(address, cols, rows);
  }

  /** The desktop pane closes: without another typing viewer, headless. */
  desktopDetach(address: string): void {
    const list = this.viewers.get(address) ?? [];
    this.viewers.set(
      address,
      list.filter((v) => v.connection !== null),
    );
    this.applySize(address);
  }

  /** Viewers on attach channels (World's observers among them). */
  viewersOf(address: string): Array<{ observe: boolean; notify: boolean }> {
    return (this.viewers.get(address) ?? [])
      .filter((v) => v.connection !== null)
      .map(({ observe, notify }) => ({ observe, notify }));
  }

  /** The program prints: every viewer receives the bytes in order. */
  output(address: string, output: Uint8Array | string): void {
    this.require(address);
    const text =
      typeof output === "string" ? output : new TextDecoder().decode(output);
    const screen = `${this.screens.get(address) ?? ""}${text}`;
    this.screens.set(address, screen.slice(-16_384));
    const bytes =
      typeof output === "string" ? new TextEncoder().encode(output) : output;
    for (const v of this.viewers.get(address) ?? []) {
      if (!v.connection) continue;
      const stream = v.connection.streams.get(v.channel);
      if (!stream) continue;
      // Too far behind: a fresh repaint instead of the backlog (core's data()).
      if (stream.bytes + bytes.byteLength > MAX_PENDING) {
        stream.pending = [];
        stream.bytes = 0;
        this.queue(v.connection, v.channel, this.paint(address));
      } else this.queue(v.connection, v.channel, bytes);
    }
  }

  /** The first paint: cancel any unfinished sequence, then the screen. */
  private paint(address: string): Uint8Array {
    return new TextEncoder().encode(
      `\x18\x1b[H\x1b[2J${this.screens.get(address) ?? ""}\x1b[?9001l`,
    );
  }

  private applySize(address: string) {
    const record = this.terminals.get(address);
    if (!record || record.state !== "live") return;
    let leader: FakeViewer | null = null;
    for (const v of this.viewers.get(address) ?? [])
      if (!v.observe && (!leader || v.activeAt > leader.activeAt)) leader = v;
    const [cols, rows] = leader?.size ?? FAKE_HEADLESS;
    if ((record.cols === cols && record.rows === rows) || !cols || !rows)
      return;
    record.cols = cols;
    record.rows = rows;
    // Pending output is superseded by RESIZE and an authoritative repaint.
    for (const v of this.viewers.get(address) ?? []) {
      if (!v.connection || !v.notify) continue;
      const stream = v.connection.streams.get(v.channel);
      if (!stream) continue;
      stream.pending = [];
      stream.bytes = 0;
      stream.resize = [cols, rows];
      this.queue(v.connection, v.channel, this.paint(address));
    }
    this.emit("size", address, { cols, rows });
  }

  private attach(
    connection: FakeConnection,
    params: Record<string, unknown>,
    reply: (result: unknown) => void,
    error: (code: number, message: string, kind: string) => void,
  ) {
    const address = String(params.terminal);
    const record = this.terminals.get(address);
    if (!record) return error(-32000, `no terminal ${address}`, "not_found");
    if (record.state !== "live")
      return error(-32000, `${address} has finished`, "finished");
    const observe = params.observe === true;
    const notify =
      observe &&
      params.resize_notifications === true &&
      !this.options.denyResizeNotifications;
    const channel = connection.nextChannel++;
    const stream: FakeStream = {
      pending: [],
      bytes: 0,
      credit: 0,
      resize: null,
    };
    connection.streams.set(channel, stream);
    const viewers = this.viewers.get(address) ?? [];
    viewers.push({
      connection,
      channel,
      observe,
      notify,
      size: [Number(params.cols), Number(params.rows)],
      activeAt: params.resumed === true ? 0 : ++this.activity,
    });
    this.viewers.set(address, viewers);
    // Every attach re-applies the size rule: an observer alone goes headless.
    this.applySize(address);
    stream.pending = [];
    stream.bytes = 0;
    stream.resize = notify
      ? [record.cols as number, record.rows as number]
      : null;
    this.queue(connection, channel, this.paint(address));
    const result = {
      channel,
      terminal: { ...record },
      resize_notifications: notify,
      automatic_input: true,
    };
    // The reply precedes stream frames unless a fault says otherwise.
    if (!this.options.attachFramesFirst) reply(result);
    stream.credit = STREAM_WINDOW;
    this.flush(connection, channel);
    if (this.options.attachFramesFirst) reply(result);
  }

  /** What a viewer sends on its attach channel (core's viewer_* handlers). */
  private viewerFrame(
    connection: FakeConnection,
    channel: number,
    kind: number,
    payload: Uint8Array,
  ) {
    for (const [address, list] of this.viewers) {
      const v = list.find(
        (x) => x.connection === connection && x.channel === channel,
      );
      if (!v) continue;
      this.viewerFrames.push({
        address,
        observe: v.observe,
        kind,
        payload: payload.slice(),
      });
      if (kind === FrameKind.CLOSE) {
        this.viewers.set(
          address,
          list.filter((x) => x !== v),
        );
        connection.streams.delete(channel);
        this.write(connection, encodeFrame(channel, FrameKind.CLOSE));
        this.applySize(address);
        return;
      }
      // Observers never type, resize or take focus: core ignores them.
      if (v.observe) return;
      if (kind === FrameKind.RESIZE && payload.byteLength === 4) {
        const view = new DataView(payload.buffer, payload.byteOffset, 4);
        v.size = [view.getUint16(0, true), view.getUint16(2, true)];
      }
      if (kind !== FrameKind.AUTOMATIC_INPUT) v.activeAt = ++this.activity;
      this.applySize(address);
      if (kind === FrameKind.DATA) this.typedInput(address, payload);
      return;
    }
  }

  /** A shell's line discipline echoes keys; Enter on `exit` ends it. */
  private typedInput(address: string, payload: Uint8Array) {
    const text = new TextDecoder().decode(payload);
    const typed = (this.typed.get(address) ?? "") + text;
    this.typed.set(address, typed);
    this.output(address, text.replace(/\r/g, "\r\n"));
    const line = typed.split("\r");
    if (line.length > 1 && line[line.length - 2] === "exit")
      this.finish(address);
  }

  /** Loss or removal: core closes every attach stream with its reason. */
  private endViewers(address: string, reason: Record<string, unknown>) {
    const payload = new TextEncoder().encode(JSON.stringify(reason));
    for (const v of this.viewers.get(address) ?? []) {
      if (!v.connection) continue;
      v.connection.streams.delete(v.channel);
      this.write(
        v.connection,
        encodeFrame(v.channel, FrameKind.CLOSE, payload),
      );
    }
    this.viewers.set(
      address,
      (this.viewers.get(address) ?? []).filter((v) => v.connection === null),
    );
  }

  private queue(
    connection: FakeConnection,
    channel: number,
    bytes: Uint8Array,
  ) {
    const stream = connection.streams.get(channel);
    if (!stream) return;
    stream.pending.push(bytes);
    stream.bytes += bytes.byteLength;
    this.flush(connection, channel);
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
      } else if (frame.channel !== 0) {
        this.viewerFrame(connection, frame.channel, frame.kind, frame.payload);
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
        "terminal.run",
        "terminal.list",
        "terminal.get",
        "terminal.kill",
        "terminal.read",
        "terminal.attach",
        "terminal.label",
        "events.subscribe",
        "terminal.send",
        "terminal.keys",
      ].filter(
        (method) =>
          !this.withoutMethods.has(method) &&
          !(this.options.observeOnly && WRITE_METHODS.has(method)),
      ),
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
    this.onCall?.(request.method, request.params ?? {});
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
    if (request.method === "$/cancelRequest") {
      // Core drops a send it still holds; one already typed stays typed.
      const id = (request.params as { id?: unknown } | undefined)?.id;
      const at = this.heldSends.findIndex(
        (held) => held.connection === connection && held.id === id,
      );
      if (at >= 0) {
        const [held] = this.heldSends.splice(at, 1);
        held!.error(-32000, "send cancelled before typing", "cancelled");
      }
      return;
    }
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
      case "terminal.attach":
        return this.attach(connection, request.params ?? {}, reply, error);
      case "terminal.read": {
        const record = this.terminals.get(String(request.params?.terminal));
        if (!record) return error(-32000, "no terminal", "not_found");
        const send = () => reply({ complete: true, how: "screen", text: "$" });
        if (this.heldReads) this.heldReads.push(send);
        else send();
        return;
      }
      case "terminal.run": {
        if (this.options.observeOnly) break;
        const p = request.params ?? {};
        if (p.caller !== undefined || p.on !== undefined)
          return error(-32602, "fixture refuses caller/on", "invalid_params");
        const argv = Array.isArray(p.argv) ? (p.argv as string[]) : [];
        const parent = typeof p.parent === "string" ? p.parent : null;
        const name = typeof p.name === "string" ? p.name : null;
        if (
          name &&
          [...this.terminals.values()].some(
            (t) => t.state === "live" && t.name === name,
          )
        )
          return error(
            -32000,
            `a live terminal is already named "${name}"`,
            "name_taken",
          );
        const program = argv[0] ?? "/bin/sh";
        if (typeof p.cwd === "string" && p.cwd.startsWith("/nonexistent"))
          return error(
            -32000,
            `cannot start "${program}": No such file or directory (os error 2)`,
            "spawn_failed",
          );
        const cwd = typeof p.cwd === "string" ? p.cwd : "/tmp/example";
        const size = (p.size ?? {}) as { cols?: number; rows?: number };
        const pid = 70_000 + this.nextTerminal;
        const address = this.create({
          argv: argv.length ? argv : ["/bin/sh"],
          cwd,
          cols: size.cols ?? 200,
          rows: size.rows ?? 120,
          labels: Object.fromEntries(
            Object.entries((p.labels as Record<string, string>) ?? {}).filter(
              ([, v]) => v !== "",
            ),
          ),
          keep: p.keep === true,
          rm: p.rm === true,
          name,
          parent,
          die_with_parent: parent !== null && p.outlive_parent !== true,
          notify: p.no_notify !== true,
          pid,
          foreground: {
            pid,
            name: program.split("/").pop() ?? "sh",
            argv: argv.length ? argv : ["/bin/sh"],
            cwd,
          },
        });
        // The shell's prompt is its first screen.
        this.screens.set(address, "$ ");
        if (this.dropNextWriteReply) {
          this.dropNextWriteReply = false;
          return;
        }
        return reply({ ...this.terminals.get(address)! });
      }
      case "terminal.kill": {
        if (this.options.observeOnly) break;
        const address = String(request.params?.terminal);
        const record = this.terminals.get(address);
        if (!record)
          return error(-32000, `no terminal "${address}"`, "not_found");
        const removing = record.rm === true;
        this.finish(address, "killed");
        if (this.dropNextWriteReply) {
          this.dropNextWriteReply = false;
          return;
        }
        // With `rm`, core removes it before answering (verified on 0.1.20).
        return removing
          ? error(-32000, `${address} was removed`, "not_found")
          : reply({ ...record });
      }
      case "terminal.send": {
        if (this.options.observeOnly) break;
        const p = request.params ?? {};
        if (
          p.caller !== undefined ||
          (p.wait !== undefined && p.wait !== false) ||
          p.if !== undefined ||
          typeof p.text !== "string" ||
          typeof p.force !== "boolean"
        )
          return error(
            -32602,
            "fixture refuses these params",
            "invalid_params",
          );
        const held = {
          connection,
          id: request.id,
          address: String(p.terminal),
          text: p.text,
          force: p.force,
          reply: (result: unknown) => {
            if (this.dropNextWriteReply) {
              this.dropNextWriteReply = false;
              return;
            }
            reply(result);
          },
          error,
        };
        if (this.holdSends) this.heldSends.push(held);
        else this.typeText(held);
        return;
      }
      case "terminal.keys": {
        if (this.options.observeOnly) break;
        const p = request.params ?? {};
        const record = this.terminals.get(String(p.terminal));
        if (p.caller !== undefined || !Array.isArray(p.keys))
          return error(
            -32602,
            "fixture refuses these params",
            "invalid_params",
          );
        if (!record) return error(-32000, "no terminal", "not_found");
        if (record.state !== "live")
          return error(-32000, "finished", "finished");
        this.deliveredInput.push({
          address: record.address,
          input: p.keys as string[],
          pid: record.pid,
          argv: record.argv,
          foreground:
            (record.foreground as { name?: string } | undefined)?.name ?? null,
        });
        if (this.dropNextWriteReply) {
          this.dropNextWriteReply = false;
          return;
        }
        return reply({
          turn: typeof record.turn === "number" ? record.turn : 0,
          status: (record.status as { state?: string } | null)?.state ?? null,
        });
      }
      case "terminal.label": {
        if (this.options.observeOnly) break;
        const address = String(request.params?.terminal);
        const labels = request.params?.labels;
        if (!this.terminals.has(address))
          return error(-32000, `no terminal ${address}`, "not_found");
        if (
          !labels ||
          typeof labels !== "object" ||
          Object.values(labels).some((value) => typeof value !== "string")
        )
          return error(-32602, "invalid_params", "invalid_params");
        this.label(address, labels as Record<string, string>);
        return reply({ ...this.terminals.get(address)! });
      }
      default:
        return error(-32601, `method not found: ${request.method}`, "usage");
    }
    return error(-32601, `method not found: ${request.method}`, "usage");
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
    // RESIZE waits for DATA credit with its paint, but consumes none.
    if (stream.resize && stream.credit > 0) {
      const size = new Uint8Array(4);
      const view = new DataView(size.buffer);
      view.setUint16(0, stream.resize[0], true);
      view.setUint16(2, stream.resize[1], true);
      stream.resize = null;
      this.write(connection, encodeFrame(channel, FrameKind.RESIZE, size));
    }
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
    // Core cancels every send a closed connection left waiting.
    for (let i = this.heldSends.length - 1; i >= 0; i--)
      if (this.heldSends[i]!.connection === connection)
        this.heldSends.splice(i, 1);
    this.connections.delete(connection);
    for (let i = this.subscribers.length - 1; i >= 0; i--)
      if (this.subscribers[i]!.connection === connection)
        this.subscribers.splice(i, 1);
    // A connection that goes away detaches its viewers (core's detach(None)).
    for (const [address, list] of this.viewers) {
      const kept = list.filter((v) => v.connection !== connection);
      if (kept.length === list.length) continue;
      this.viewers.set(address, kept);
      if (this.running) this.applySize(address);
    }
  }
}
