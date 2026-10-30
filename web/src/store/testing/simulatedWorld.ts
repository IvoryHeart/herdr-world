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

  /** Periods of the intervals currently armed. */
  intervals(): number[] {
    return [...this.timers.values()]
      .filter((timer) => timer.repeat)
      .map((timer) => timer.delay);
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

export class SimulatedWorld {
  readonly hosts = new Map<string, SimulatedHost>();
  readonly calls: RecordedCall[] = [];
  readonly declarations: Frame[] = [];
  clients = 1;
  readonly defaultConnectionId: string;
  private readonly sockets = new Set<SimulatedSocket>();
  private readonly failures = new Map<string, number>();
  private revision = 0;

  constructor(hosts: SimulatedHost[]) {
    for (const host of hosts) this.hosts.set(host.id, host);
    this.defaultConnectionId = hosts[0]!.id;
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
        },
      }),
    );
  }

  detach(socket: SimulatedSocket) {
    this.sockets.delete(socket);
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

  control(control: Frame) {
    this.broadcast({ control });
  }

  /** The owner's whole recency map, as `world_agent_activity` carries it. */
  activity(connectionId: string, generation?: number): Frame {
    const host = this.host(connectionId);
    return {
      type: "world_agent_activity",
      connection_id: connectionId,
      connection_generation: generation ?? host.generation,
      revision: ++this.revision,
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

  /** Push recency to every browser, as the observer does after a change. */
  pushActivity(connectionId: string, generation?: number) {
    this.control(this.activity(connectionId, generation));
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
    this.calls.push({ method: frame.method, connectionId, generation, params });
    const identity =
      connectionId === null
        ? {}
        : { connection_id: connectionId, connection_generation: generation };
    let reply: Frame;
    try {
      const result =
        connectionId === null
          ? this.global(frame.method, params)
          : this.scoped(connectionId, generation, frame.method, params);
      reply = { id, ...identity, result };
    } catch (error) {
      reply = {
        id,
        ...identity,
        error: { message: (error as Error).message },
      };
    }
    queueMicrotask(() => {
      socket.deliver(reply);
      // Declaring an owner sends its current recency (shared-acquisition D2).
      if (frame.method === "world.focused.observe" && "result" in reply)
        for (const owner of this.declaredOwners(params))
          socket.deliver({ control: this.activity(owner) });
    });
  }

  private declaredOwners(params: Frame): string[] {
    const owners = Array.isArray(params.owners) ? params.owners : [];
    return owners.flatMap((owner: Frame) => {
      const host = this.hosts.get(String(owner?.connection_id));
      return host && owner.connection_generation === host.generation
        ? [host.id]
        : [];
    });
  }

  private global(method: string, params: Frame): unknown {
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
      this.declarations.push(params);
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
