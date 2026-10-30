/**
 * A simulated World service for focused-store tests. The real Bridge and store
 * run against it through a fake WebSocket, on a manual clock, so a test sees
 * exactly which requests the browser makes and when.
 */
import type { Pane, PaneLayout, Tab, Workspace } from "../../types";

type TimerEntry = {
  due: number;
  delay: number;
  repeat: boolean;
  fn: () => void;
};

const nativeTimers = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
};

/** Flush pending promise reactions without letting real time pass. */
export async function microtasks(turns = 20): Promise<void> {
  for (let turn = 0; turn < turns; turn++) await Promise.resolve();
}

/**
 * Await a completion signal. A microtask budget stands in for a hang guard, so
 * a signal that never comes fails at once and deterministically.
 */
export function settles<T>(
  signal: Promise<T>,
  what: string,
  turns = 2_000,
): Promise<T> {
  return Promise.race([
    signal,
    microtasks(turns).then(() => {
      throw new Error(`never happened: ${what}`);
    }),
  ]);
}

/**
 * Timers run only when the test runs them. `advance` moves time and fires
 * everything due, intervals included; `flushTimeouts` runs short one-shot
 * timers (debounces) without reaching any periodic timer.
 */
export class ManualClock {
  now = 0;
  private nextId = 1;
  private readonly timers = new Map<number, TimerEntry>();

  install() {
    const add = (fn: () => void, delay: unknown, repeat: boolean) => {
      const id = this.nextId++;
      const ms = typeof delay === "number" && delay > 0 ? delay : 0;
      this.timers.set(id, { due: this.now + ms, delay: ms, repeat, fn });
      return id;
    };
    const remove = (id: unknown) => {
      if (typeof id === "number") this.timers.delete(id);
    };
    globalThis.setTimeout = ((fn: () => void, delay?: number) =>
      add(fn, delay, false)) as unknown as typeof setTimeout;
    globalThis.clearTimeout = remove as typeof clearTimeout;
    globalThis.setInterval = ((fn: () => void, delay?: number) =>
      add(fn, delay, true)) as unknown as typeof setInterval;
    globalThis.clearInterval = remove as typeof clearInterval;
  }

  uninstall() {
    Object.assign(globalThis, nativeTimers);
    this.timers.clear();
  }

  async advance(ms: number) {
    const target = this.now + ms;
    for (;;) {
      const next = this.earliest((timer) => timer.due <= target);
      if (!next) break;
      await this.fire(next);
    }
    this.now = target;
    await microtasks();
  }

  async flushTimeouts(maxDelay = 100) {
    for (let round = 0; round < 100; round++) {
      const next = this.earliest(
        (timer) => !timer.repeat && timer.delay <= maxDelay,
      );
      if (!next) return;
      await this.fire(next);
    }
    throw new Error("short timeouts kept rescheduling themselves");
  }

  private earliest(include: (timer: TimerEntry) => boolean) {
    let found: [number, TimerEntry] | null = null;
    for (const entry of this.timers) {
      if (include(entry[1]) && (!found || entry[1].due < found[1].due))
        found = entry;
    }
    return found;
  }

  private async fire([id, timer]: [number, TimerEntry]) {
    this.now = Math.max(this.now, timer.due);
    if (timer.repeat) timer.due += Math.max(timer.delay, 1);
    else this.timers.delete(id);
    timer.fn();
    await microtasks();
  }
}

export type SimulatedHost = {
  id: string;
  generation: number;
  workspaces: Workspace[];
  tabs: Tab[];
  panes: Pane[];
  layouts: Map<string, PaneLayout>;
  /** Session-file activity by pane, as World's activity reading reports it. */
  activity: Map<string, number>;
  endpointAvailability: Record<string, unknown>;
};

export type RecordedCall = {
  method: string;
  connectionId: string | null;
  generation: number | null;
  params: Record<string, unknown>;
};

type Frame = Record<string, unknown>;

/** The requests a browser makes to observe a host or the catalogue. */
export const OBSERVATION_METHODS = new Set([
  "workspace.list",
  "tab.list",
  "pane.list",
  "agent.list",
  "pane.layout",
  "bridge.status",
  "connections.list",
]);

/** Advertised by a service that observes focused hosts for its browsers. */
export const FOCUSED_OBSERVATION_CAPABILITY = "world_focused_observation";

export class SimulatedWorld {
  readonly hosts = new Map<string, SimulatedHost>();
  readonly calls: RecordedCall[] = [];
  /** Every `world.focused.observe` declaration, in arrival order. */
  readonly declarations: Frame[] = [];
  clients = 1;
  readonly defaultConnectionId: string;
  private readonly sockets = new Set<SimulatedSocket>();
  private readonly held = new Map<SimulatedSocket, Frame[]>();
  private readonly failures = new Map<string, number>();
  private readonly waiters: {
    method: string;
    resolve(call: RecordedCall): void;
  }[] = [];
  private revision = 0;

  private capabilities: Record<string, boolean> = {
    [FOCUSED_OBSERVATION_CAPABILITY]: true,
  };

  constructor(hosts: SimulatedHost[]) {
    for (const host of hosts) this.hosts.set(host.id, host);
    this.defaultConnectionId = hosts[0]!.id;
  }

  /**
   * Close every socket, as a service restart does, and greet reconnecting
   * browsers with `capabilities`. Browsers reconnect on their own timer.
   */
  restart(capabilities: Record<string, boolean>) {
    this.capabilities = capabilities;
    for (const socket of [...this.sockets]) socket.close();
  }

  host(id: string): SimulatedHost {
    const host = this.hosts.get(id);
    if (!host) throw new Error(`no simulated host ${id}`);
    return host;
  }

  /** A WebSocket class whose instances talk to this service. */
  socketClass(): typeof WebSocket {
    return socketClassFor(this);
  }

  attach(socket: SimulatedSocket) {
    this.sockets.add(socket);
    queueMicrotask(() =>
      socket.deliver({
        hello: true,
        bridge_protocol_version: 2,
        default_connection_id: this.defaultConnectionId,
        capabilities: {
          connection_id: true,
          connection_scoped_http: true,
          connection_runtime_generation: true,
          ...this.capabilities,
        },
      }),
    );
  }

  detach(socket: SimulatedSocket) {
    this.sockets.delete(socket);
    this.held.delete(socket);
  }

  catalogue() {
    return [...this.hosts.values()].map((host) => ({
      id: host.id,
      label: `Synthetic ${host.id}`,
      source: "test",
      is_default: host.id === this.defaultConnectionId,
      state: "ready",
      generation: host.generation,
    }));
  }

  /** Make the next `times` calls of one method on one owner fail. */
  failNext(connectionId: string, method: string, times = 1) {
    this.failures.set(`${connectionId} ${method}`, times);
  }

  /** Calls recorded after `since`, optionally for one owner only. */
  callsSince(since: number, connectionId?: string): RecordedCall[] {
    return this.calls
      .slice(since)
      .filter(
        (call) =>
          connectionId === undefined || call.connectionId === connectionId,
      );
  }

  /** Resolves on the next call of `method`; register it before the trigger. */
  nextCall(method: string): Promise<RecordedCall> {
    return new Promise((resolve) => this.waiters.push({ method, resolve }));
  }

  /** A Herdr event as the service forwards it, qualified by owner. */
  event(connectionId: string, event: string, data: Frame, generation?: number) {
    const host = this.host(connectionId);
    this.broadcast({
      event,
      data,
      connection_id: connectionId,
      connection_generation: generation ?? host.generation,
    });
  }

  /** A control every socket receives, such as a catalogue change. */
  control(control: Frame) {
    this.broadcast({ control });
  }

  /** The observer found a change: notify the sockets that hold the owner. */
  notifyFocused(connectionId: string, generation?: number) {
    const owner = this.owner(connectionId, generation);
    this.toHolders(owner, {
      type: "world_focused_changed",
      connection_id: owner.connection_id,
      connection_generation: owner.connection_generation,
    });
  }

  /** The owner's whole recency map, as `world_agent_activity` carries it. */
  activity(connectionId: string, generation?: number): Frame {
    const host = this.host(connectionId);
    return {
      type: "world_agent_activity",
      connection_id: connectionId,
      connection_generation: generation ?? host.generation,
      agents: host.panes
        .filter((pane) => host.activity.has(pane.pane_id))
        .map((pane) => ({
          pane_id: pane.pane_id,
          terminal_id: pane.terminal_id,
          agent: pane.agent,
          session: pane.agent_session?.value ?? null,
          last_activity_at: host.activity.get(pane.pane_id),
        })),
    };
  }

  /** The observer read new activity: push it to the owner's holders. */
  pushActivity(connectionId: string, generation?: number) {
    this.toHolders(
      this.owner(connectionId, generation),
      this.activity(connectionId, generation),
    );
  }

  /** A frame already in flight to every socket, whatever it now holds. */
  deliverToAll(control: Frame) {
    this.broadcast({ control });
  }

  nextRevision() {
    return ++this.revision;
  }

  private owner(connectionId: string, generation?: number) {
    return {
      connection_id: connectionId,
      connection_generation: generation ?? this.host(connectionId).generation,
    };
  }

  private toHolders(
    owner: { connection_id: string; connection_generation: number },
    control: Frame,
  ) {
    for (const [socket, owners] of this.held) {
      if (
        owners.some(
          (held) =>
            held.connection_id === owner.connection_id &&
            held.connection_generation === owner.connection_generation,
        )
      )
        socket.deliver({ control });
    }
  }

  private broadcast(frame: Frame) {
    for (const socket of this.sockets) socket.deliver(frame);
  }

  receive(socket: SimulatedSocket, frame: Frame) {
    const id = frame.id;
    if (typeof id !== "string" || typeof frame.method !== "string") return;
    const connectionId =
      typeof frame.connection_id === "string" ? frame.connection_id : null;
    const generation =
      typeof frame.connection_generation === "number"
        ? frame.connection_generation
        : null;
    const params = (frame.params ?? {}) as Frame;
    const call = { method: frame.method, connectionId, generation, params };
    this.calls.push(call);
    const identity =
      connectionId === null
        ? {}
        : { connection_id: connectionId, connection_generation: generation };
    let reply: Frame;
    try {
      const result =
        connectionId === null
          ? this.global(socket, frame.method, params)
          : this.scoped(connectionId, generation, frame.method, params);
      reply = { id, ...identity, result };
    } catch (error) {
      reply = {
        id,
        ...identity,
        error: { message: (error as Error).message },
      };
    }
    queueMicrotask(() => socket.deliver(reply));
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.method === call.method) waiter.resolve(call);
      else this.waiters.push(waiter);
    }
  }

  private global(
    socket: SimulatedSocket,
    method: string,
    params: Frame,
  ): unknown {
    if (method === "connections.list")
      return {
        default_connection_id: this.defaultConnectionId,
        connections: this.catalogue(),
      };
    if (method === "bridge.status")
      return {
        clients: this.clients,
        terminals: [],
        default_connection_id: this.defaultConnectionId,
        connections: this.catalogue(),
      };
    if (method === "bridge.ping") return { ok: true };
    if (method === "world.focused.observe") {
      if (!Array.isArray(params.owners))
        throw new Error("owners must be an array");
      // A declaration replaces this socket's previous one. Recency arrives
      // only once the observer has read it; there is no placeholder map.
      this.declarations.push(params);
      this.held.set(socket, params.owners as Frame[]);
      return { ok: true };
    }
    throw new Error(`unknown bridge-global method: ${method}`);
  }

  private scoped(
    connectionId: string,
    generation: number | null,
    method: string,
    params: Frame,
  ): unknown {
    const host = this.host(connectionId);
    if (generation !== host.generation)
      throw new Error("connection runtime generation is unavailable");
    const failure = `${connectionId} ${method}`;
    const failures = this.failures.get(failure) ?? 0;
    if (failures > 0) {
      this.failures.set(failure, failures - 1);
      throw new Error(`simulated ${method} failure`);
    }
    if (method === "workspace.list")
      return {
        workspaces: structuredClone(host.workspaces),
        navigation_mode: "shared",
        tab_move_supported: true,
        endpoint_availability: structuredClone(host.endpointAvailability),
      };
    if (method === "tab.list")
      return { tabs: structuredClone(host.tabs), tab_move_supported: true };
    if (method === "pane.list") return { panes: structuredClone(host.panes) };
    if (method === "agent.list")
      return {
        agents: host.panes
          .filter((pane) => pane.agent)
          .map((pane) => ({
            pane_id: pane.pane_id,
            terminal_id: pane.terminal_id,
            agent: pane.agent,
            agent_status: pane.agent_status,
            agent_session: pane.agent_session,
            ...(host.activity.has(pane.pane_id)
              ? { last_activity_at: host.activity.get(pane.pane_id) }
              : {}),
          })),
      };
    if (method === "pane.layout") {
      const pane = host.panes.find((item) => item.pane_id === params.pane_id);
      const layout = pane ? host.layouts.get(pane.tab_id) : undefined;
      if (!layout) throw new Error("pane not found");
      return { layout: structuredClone(layout) };
    }
    if (method === "terminal.watch_popup") return { popup: null };
    throw new Error(`unknown method: ${method}`);
  }
}

export class SimulatedSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = SimulatedSocket.OPEN;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event?: Pick<CloseEvent, "code">) => void) | null = null;

  constructor(private readonly world: SimulatedWorld) {
    world.attach(this);
  }

  send(raw = "") {
    if (this.readyState !== SimulatedSocket.OPEN) return;
    this.world.receive(this, JSON.parse(raw) as Frame);
  }

  /** Delivery is synchronous: once it returns, the browser has handled it. */
  deliver(frame: Frame) {
    if (this.readyState !== SimulatedSocket.OPEN) return;
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }

  close() {
    if (this.readyState === SimulatedSocket.CLOSED) return;
    this.readyState = SimulatedSocket.CLOSED;
    this.world.detach(this);
    this.onclose?.({ code: 1000 });
  }
}

function socketClassFor(world: SimulatedWorld): typeof WebSocket {
  class Socket extends SimulatedSocket {
    constructor() {
      super(world);
    }
  }
  return Socket as unknown as typeof WebSocket;
}

/** A minimal page whose visibility the test controls. */
export class SimulatedDocument {
  visibilityState: DocumentVisibilityState = "visible";
  private readonly listeners = new Map<string, Set<() => void>>();

  get hidden() {
    return this.visibilityState === "hidden";
  }

  addEventListener(type: string, listener: () => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  setVisibility(state: DocumentVisibilityState) {
    this.visibilityState = state;
    for (const listener of this.listeners.get("visibilitychange") ?? [])
      listener();
  }
}

type SavedGlobals = {
  WebSocket: typeof WebSocket;
  fetch: typeof fetch;
  location?: PropertyDescriptor;
  document?: PropertyDescriptor;
};

/**
 * Point the browser globals the store uses at the simulated service and page.
 * Returns a function that restores them.
 */
export function installSimulatedBrowser(
  world: SimulatedWorld,
  page: SimulatedDocument,
): () => void {
  const saved: SavedGlobals = {
    WebSocket: globalThis.WebSocket,
    fetch: globalThis.fetch,
    location: Object.getOwnPropertyDescriptor(globalThis, "location"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
  };
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: {
      protocol: "http:",
      host: "localhost:5173",
      origin: "http://localhost:5173",
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: page,
  });
  globalThis.WebSocket = world.socketClass();
  globalThis.fetch = (async () =>
    new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  return () => {
    globalThis.WebSocket = saved.WebSocket;
    globalThis.fetch = saved.fetch;
    for (const key of ["location", "document"] as const) {
      const descriptor = saved[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };
}
