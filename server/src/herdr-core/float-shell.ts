import { createHash } from "node:crypto";
import type { ReadyRuntimeLease } from "../connections/manager";
import {
  type CoreAttachment,
  type CoreCellSize,
  CoreRpcError,
  type CoreTerminalRecord,
} from "./client";
import { CoreFenceError, CoreOperationFence } from "./fence";
import type { CoreMirrorTerminal } from "./mirror";
import type { CoreConnectionRuntime } from "./runtime";
import { CORE_FLOAT_LABEL, coreRoomOf } from "./topology";

/**
 * World's float shell on herdr-core: the equivalent of the TUI's Herdr Float
 * popup (a plugin's session-modal shell), which core has no notion of.
 *
 * - One shell per room. Core's own rule (a name is unique among live
 *   terminals) keeps it one: a second start, from any browser or World,
 *   is refused `name_taken` and joins the first.
 * - It is that machine's own shell, unplaced, without parent or notes, in
 *   the folder of the agent it was opened from. Core keeps it running while
 *   it is hidden, and removes it when it ends.
 * - World attaches only to a live terminal carrying its own label for that
 *   room, and ends only that occupant.
 * - Each browser has its own interactive stream. Typing or resizing makes
 *   that browser's size count; hiding leaves, and core goes back to its
 *   headless size.
 */
export const FLOAT_SHELL_PREFIX = "world-float-";
/** Core names are 1-32 of `a-z 0-9 - _ .`. */
const NAME_HASH_HEX = 32 - FLOAT_SHELL_PREFIX.length;
/** Room ids are World workspace ids; longer is not one of ours. */
const MAX_ROOM_BYTES = 600;
export const MAX_FLOAT_INPUT_BYTES = 64 * 1024;
const MAX_STREAMS_PER_OWNER = 8;
/** Stop returning window while the browser is this far behind. */
const HIGH_WATER_BYTES = 1 << 20;
const CREDIT_RETRY_MS = 50;
/** How long a lost start race waits to see the winner's terminal. */
const JOIN_WAIT_MS = 3_000;
const OPEN_CANCELLED = "The float shell was closed while it opened";

export function floatShellName(room: string): string {
  const hash = createHash("sha256").update(room).digest("hex");
  return FLOAT_SHELL_PREFIX + hash.slice(0, NAME_HASH_HEX);
}

/** A browser socket, as the float service sees it. */
export type FloatShellOwner = {
  send(message: FloatShellPush): boolean;
  /** Bytes queued to the browser and not yet written. */
  buffered(): number;
};

export type FloatShellPush =
  | { type: "float_output"; stream: string; data: string }
  | {
      type: "float_closed";
      stream: string;
      reason: string;
      /** Set when the shell itself ended (it exited or was ended). */
      ended: boolean;
    };

export type FloatShellOpen = {
  connectionId: string;
  generation: number;
  /** The agent (`tN`) whose room and folder the shell belongs to. */
  terminal: string;
  /**
   * The room the browser means (the agent's World workspace). A reopen after
   * core reconnected names the new generation; an address core reused for
   * an agent in another room is refused rather than opening that room.
   */
  room?: string;
  size: CoreCellSize;
};

export type FloatShellOpened = {
  stream: string;
  address: string;
  name: string;
  room: string;
  /** False when the room's shell was already running. */
  created: boolean;
};

export class FloatShellRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FloatShellRefusal";
  }
}

type Session = {
  id: string;
  owner: FloatShellOwner;
  connectionId: string;
  generation: number;
  address: string;
  room: string;
  attachment: CoreAttachment | null;
  /** Window consumed but not yet returned (the browser is behind). */
  owed: number;
  creditTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
  /**
   * Pushes held until the browser has the open reply naming this stream
   * (`start`): the first paint follows core's reply, not World's.
   */
  held: FloatShellPush[] | null;
};

export type FloatShellServiceOptions = {
  lease(connectionId: string): ReadyRuntimeLease<CoreConnectionRuntime> | null;
  /** Waits until the core's mirror might have changed (tests step it). */
  settle?: (ms: number) => Promise<void>;
  now?: () => number;
};

function clampSize(size: CoreCellSize): CoreCellSize {
  const cell = (value: unknown, max: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(2, Math.floor(value)))
      : null;
  const cols = cell(size?.cols, 1000);
  const rows = cell(size?.rows, 500);
  if (cols === null || rows === null)
    throw new FloatShellRefusal("A float shell needs a size in cells");
  return { cols, rows };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** The folder a person is looking at: the foreground's, else the program's. */
function folderOf(record: CoreMirrorTerminal): string | null {
  const foreground = record.foreground as { cwd?: unknown } | null | undefined;
  return text(foreground?.cwd) ?? text(record.cwd);
}

function isOurs(record: CoreMirrorTerminal | CoreTerminalRecord, room: string) {
  return record.labels?.[CORE_FLOAT_LABEL] === room;
}

function refusalFor(error: unknown): Error {
  if (error instanceof FloatShellRefusal) return error;
  if (error instanceof CoreFenceError)
    return new FloatShellRefusal(
      error.reason === "lease" ||
        error.reason === "core-replaced" ||
        error.reason === "core-restarted"
        ? "herdr-core reconnected; open the float shell again"
        : error.reason === "not-actionable"
          ? "herdr-core is not current right now; try again"
          : "The float shell ended; open it again",
    );
  if (error instanceof CoreRpcError && error.kind === "spawn_failed")
    return new FloatShellRefusal(
      `herdr-core could not start a shell there: ${error.message}`,
    );
  return error instanceof Error ? error : new Error(String(error));
}

export class FloatShellService {
  private readonly sessions = new Map<string, Session>();
  /** One owner per browser socket (the key), made on its first call. */
  private readonly owners = new WeakMap<object, FloatShellOwner>();
  private nextStream = 1;
  private readonly settle: (ms: number) => Promise<void>;

  constructor(private readonly options: FloatShellServiceOptions) {
    this.settle =
      options.settle ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  }

  /** Opens the room's shell for `owner`, starting it if none runs. */
  async open(
    owner: FloatShellOwner,
    request: FloatShellOpen,
  ): Promise<FloatShellOpened> {
    const size = clampSize(request.size);
    const lease = this.leaseFor(request.connectionId, request.generation);
    const runtime = lease.runtime;
    if (!runtime.shells.offered)
      throw new FloatShellRefusal(
        "This herdr-core does not offer shells to World",
      );
    if (!runtime.core.actionable)
      throw new FloatShellRefusal(
        "herdr-core is not current right now; try again",
      );
    const terminals = runtime.core.mirror.terminals();
    const room = coreRoomOf(terminals, request.terminal);
    const agent = runtime.core.terminal(request.terminal);
    if (!room || !agent)
      throw new FloatShellRefusal("That agent is no longer running");
    if (request.room !== undefined && request.room !== room)
      throw new FloatShellRefusal(
        "That agent is in another room now; open its shell from its peek",
      );
    if (Buffer.byteLength(room) > MAX_ROOM_BYTES)
      throw new FloatShellRefusal(
        "That room's name is too long for a float shell",
      );
    if (this.ownedBy(owner).length >= MAX_STREAMS_PER_OWNER)
      throw new FloatShellRefusal(
        "Too many float shells are open in this window",
      );
    const name = floatShellName(room);
    // One stream per room per browser: reopening replaces the old view.
    for (const session of this.ownedBy(owner))
      if (
        session.connectionId === request.connectionId &&
        session.room === room
      )
        this.hide(owner, session.id);

    const session: Session = {
      id: `float-${this.nextStream++}`,
      owner,
      connectionId: request.connectionId,
      generation: lease.generation,
      address: "",
      room,
      attachment: null,
      owed: 0,
      creditTimer: null,
      closed: false,
      held: [],
    };
    // Registered before the first wait, so a browser that leaves meanwhile
    // (`release`) cancels this open too.
    this.sessions.set(session.id, session);
    const cancelled = () => this.sessions.get(session.id) !== session;
    try {
      let created = false;
      let fence: CoreOperationFence<CoreConnectionRuntime>;
      let existing = this.liveShell(runtime, name);
      if (!existing) {
        const cwd = folderOf(agent);
        if (!cwd) throw new FloatShellRefusal("That agent's folder is unknown");
        try {
          const record = await runtime.shells.run(
            CoreOperationFence.admit(lease),
            {
              name,
              cwd,
              labels: { [CORE_FLOAT_LABEL]: room },
              size,
            },
          );
          if (!isOurs(record, room) || record.name !== name)
            throw new FloatShellRefusal(
              "herdr-core started a different terminal",
            );
          created = true;
          session.address = record.address;
        } catch (error) {
          if (!(error instanceof CoreRpcError && error.kind === "name_taken"))
            throw error;
          // Another browser or World started it first: join that one.
          existing = await this.joinWinner(lease, name);
        }
      }
      if (existing) {
        if (!isOurs(existing, room))
          throw new FloatShellRefusal(
            `A terminal World didn't start holds the name ${name}`,
          );
        session.address = existing.address;
        fence = CoreOperationFence.admit(lease, existing.address, null, {
          foreground: false,
        });
      } else {
        // Our own start, on this core process: its address is new and never
        // reused, and a float shell is never kept, so nothing can replace it.
        fence = CoreOperationFence.admit(lease);
      }
      if (cancelled()) throw new FloatShellRefusal(OPEN_CANCELLED);
      const attachment = await runtime.shells.attach(
        fence,
        session.address,
        size,
        {
          data: (bytes) => this.forward(session, bytes),
          end: (reason) => this.ended(session, reason),
        },
      );
      if (cancelled()) {
        // Hidden or released while core attached: leave at once, or core
        // keeps an untracked viewer holding this shell's size.
        attachment.detach();
        throw new FloatShellRefusal(OPEN_CANCELLED);
      }
      // A shell that ended while attaching stays closed: `start` delivers
      // its close after the reply.
      if (!session.closed) session.attachment = attachment;
      return {
        stream: session.id,
        address: session.address,
        name,
        room,
        created,
      };
    } catch (error) {
      this.drop(session);
      throw refusalFor(error);
    }
  }

  /** The open reply is on its way: deliver what the stream held, in order. */
  start(owner: FloatShellOwner, stream: string): void {
    const session = this.sessions.get(stream);
    if (!session || session.owner !== owner || !session.held) return;
    const held = session.held;
    session.held = null;
    for (const push of held) {
      if (!owner.send(push)) {
        session.attachment?.detach();
        this.drop(session);
        return;
      }
    }
    if (session.closed) this.drop(session);
    else this.returnCredit(session);
  }

  input(owner: FloatShellOwner, stream: string, bytes: Uint8Array): void {
    if (bytes.byteLength > MAX_FLOAT_INPUT_BYTES)
      throw new FloatShellRefusal("Too much input at once");
    this.session(owner, stream).attachment?.input(bytes);
  }

  resize(owner: FloatShellOwner, stream: string, size: CoreCellSize): void {
    this.session(owner, stream).attachment?.resize(clampSize(size));
  }

  /** Leaves the shell running; only this browser's view closes. */
  hide(owner: FloatShellOwner, stream: string): void {
    const session = this.sessions.get(stream);
    if (!session || session.owner !== owner) return;
    session.attachment?.detach();
    this.drop(session);
  }

  /** Ends the room's shell, exactly the one this stream shows. */
  async stop(owner: FloatShellOwner, stream: string): Promise<void> {
    const session = this.session(owner, stream);
    const lease = this.leaseFor(session.connectionId, session.generation);
    const record = lease.runtime.core.terminal(session.address);
    if (!record || !isOurs(record, session.room)) return;
    try {
      await lease.runtime.shells.kill(
        CoreOperationFence.admit(lease, session.address, null, {
          foreground: false,
        }),
      );
    } catch (error) {
      // `rm` removes it as it ends: core can answer the kill `not_found`.
      if (error instanceof CoreRpcError && error.kind === "not_found") return;
      if (error instanceof CoreFenceError && error.reason === "occupant-gone")
        return;
      throw refusalFor(error);
    }
  }

  /** The browser went away: every view it had is left, shells keep running. */
  release(owner: FloatShellOwner): void {
    for (const session of this.ownedBy(owner)) this.hide(owner, session.id);
  }

  /** The owner standing for `key` (a browser socket), made once. */
  ownerFor(key: object, make: () => FloatShellOwner): FloatShellOwner {
    let owner = this.owners.get(key);
    if (!owner) {
      owner = make();
      this.owners.set(key, owner);
    }
    return owner;
  }

  /** `key`'s socket closed: release every view it had. */
  releaseFor(key: object): void {
    const owner = this.owners.get(key);
    if (owner) this.release(owner);
  }

  get openStreams(): number {
    return this.sessions.size;
  }

  private ownedBy(owner: FloatShellOwner): Session[] {
    return [...this.sessions.values()].filter((s) => s.owner === owner);
  }

  private session(owner: FloatShellOwner, stream: string): Session {
    const session = this.sessions.get(stream);
    if (!session || session.owner !== owner || session.closed)
      throw new FloatShellRefusal("That float shell is no longer open");
    return session;
  }

  private leaseFor(connectionId: string, generation: number) {
    let lease: ReadyRuntimeLease<CoreConnectionRuntime> | null;
    try {
      lease = this.options.lease(connectionId);
    } catch {
      lease = null;
    }
    if (!lease || lease.runtime.runtime !== "herdr-core")
      throw new FloatShellRefusal("That herdr-core connection is not ready");
    if (lease.generation !== generation)
      throw new FloatShellRefusal(
        "herdr-core reconnected; open the float shell again",
      );
    return lease;
  }

  private liveShell(runtime: CoreConnectionRuntime, name: string) {
    return runtime.core.mirror
      .terminals()
      .find(
        (record) =>
          !record.remote && record.state === "live" && record.name === name,
      );
  }

  /** The winner's `created` event follows its reply: wait to observe it. */
  private async joinWinner(
    lease: ReadyRuntimeLease<CoreConnectionRuntime>,
    name: string,
  ): Promise<CoreMirrorTerminal> {
    const now = this.options.now ?? Date.now;
    const deadline = now() + JOIN_WAIT_MS;
    for (;;) {
      if (!lease.isCurrent()) throw new CoreFenceError("dispatch", "lease");
      const found = this.liveShell(lease.runtime, name);
      if (found) return found;
      if (now() >= deadline)
        throw new FloatShellRefusal(
          "The room's float shell is starting; try again",
        );
      await this.settle(CREDIT_RETRY_MS);
    }
  }

  private forward(session: Session, bytes: Uint8Array) {
    if (session.closed) return;
    const push: FloatShellPush = {
      type: "float_output",
      stream: session.id,
      data: Buffer.from(bytes).toString("base64"),
    };
    session.owed += bytes.byteLength;
    if (session.held) {
      session.held.push(push);
      return;
    }
    if (!session.owner.send(push)) {
      // The socket is gone: its cleanup releases every view it had.
      session.attachment?.detach();
      this.drop(session);
      return;
    }
    this.returnCredit(session);
  }

  /** Core sends only as much as World returns: a slow browser holds it. */
  private returnCredit(session: Session) {
    if (
      session.closed ||
      session.held ||
      !session.attachment ||
      session.owed === 0 ||
      session.creditTimer
    )
      return;
    if (session.owner.buffered() < HIGH_WATER_BYTES) {
      const owed = session.owed;
      session.owed = 0;
      session.attachment?.credit(owed);
      return;
    }
    session.creditTimer = setTimeout(() => {
      session.creditTimer = null;
      this.returnCredit(session);
    }, CREDIT_RETRY_MS);
  }

  private ended(session: Session, reason: string) {
    if (session.closed) return;
    if (reason === "detached") {
      this.drop(session);
      return;
    }
    const facts = parseFinish(reason);
    const push: FloatShellPush = {
      type: "float_closed",
      stream: session.id,
      reason: facts
        ? facts.reason === "exited"
          ? "The shell exited"
          : "The shell was ended"
        : "The float shell's stream closed",
      ended: facts !== null,
    };
    if (session.held) {
      // Delivered by `start` after the reply; the session is over already.
      session.held.push(push);
      session.attachment = null;
      session.closed = true;
      if (session.creditTimer) clearTimeout(session.creditTimer);
      session.creditTimer = null;
      return;
    }
    session.owner.send(push);
    this.drop(session);
  }

  private drop(session: Session) {
    session.closed = true;
    if (session.creditTimer) clearTimeout(session.creditTimer);
    session.creditTimer = null;
    this.sessions.delete(session.id);
  }
}

/** Core's CLOSE carries the finish facts when the program itself ended. */
function parseFinish(reason: string): { reason: string } | null {
  if (!reason.startsWith("{")) return null;
  try {
    const value = JSON.parse(reason) as { reason?: unknown };
    return typeof value.reason === "string" ? { reason: value.reason } : null;
  } catch {
    return null;
  }
}
