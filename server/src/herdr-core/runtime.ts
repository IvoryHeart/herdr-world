import { coreOccupantFingerprint } from "./occupant";
import type {
  ConnectionRuntime,
  ConnectionRuntimeContext,
  ReadyRuntimeLease,
} from "../connections/manager";
import type { ConnectionIdentity } from "../connections/types";
import {
  type CoreAttachHandlers,
  type CoreAttachment,
  type CoreCellSize,
  type CoreEventLine,
  type CoreRunParams,
  type CoreTerminalRecord,
  CoreClient,
  CoreIncompatibleError,
  type CoreRunRequest,
  type CoreServerStatus,
  CoreUnavailableError,
  type CoreWriteMethod,
} from "./client";
import {
  type CoreEpoch,
  CoreFenceError,
  type CoreFenceView,
  CoreOperationFence,
} from "./fence";
import {
  type CoreMirrorLimits,
  CoreMirror,
  type CoreMirrorTerminal,
  DEFAULT_CORE_MIRROR_LIMITS,
} from "./mirror";
import {
  type CoreObservation,
  type CoreObservationStore,
  summarizeMirror,
} from "./observations";
import { connectUnixStream, type CoreStreamConnector } from "./stream";
import {
  CoreFirstSight,
  coreRuntimeReader,
  coreTopology,
  nextCoreSummaryExpiry,
} from "./topology";
import type { CoreTopologyDocument } from "./layout";
import {
  type CoreAlert,
  CoreAttention,
  type SharedLabelChange,
} from "./shared-state";
import type { RuntimeReader } from "../adapters/runtime-ports";

/** How World reaches a core: never by starting one. */
export type CoreTransport = {
  /** Re-reads the endpoint (core.lock) and returns a local socket path. */
  open(signal: AbortSignal): Promise<string>;
  close(): Promise<void>;
};

export type CoreRuntimeOptions = {
  identity: ConnectionIdentity;
  context: ConnectionRuntimeContext;
  transport: CoreTransport;
  observations: CoreObservationStore;
  /** Reports a failure of a ready runtime (EOF, liveness, lost ordering). */
  onFailure(error: Error): void;
  connect?: CoreStreamConnector;
  limits?: CoreMirrorLimits;
  /** World's own seen baseline, kept across this connection's reconnects. */
  firstSight?: CoreFirstSight;
  /** What World's views are built from changed (not every event does). */
  onReadModel?(): void;
  /** World's own layout of a core (M1), by its durable ID. */
  layout?(coreId: string): CoreTopologyDocument | null;
  /** Push decisions, kept across this connection's reconnects. */
  attention?: CoreAttention;
  /** An agent finished or needs you (Herdr's attention rule). */
  onAlerts?(
    alerts: CoreAlert[],
    terminals: CoreMirrorTerminal[],
    coreName: string,
  ): void;
  livenessIntervalMs?: number;
  livenessTimeoutMs?: number;
  publishDelayMs?: number;
  now?: () => number;
};

export type CoreConnectionRuntime = ConnectionRuntime & {
  readonly runtime: "herdr-core";
  readonly signal: AbortSignal;
  readonly core: CoreFenceView & {
    readonly version: string | null;
    readonly mirror: CoreMirror;
  };
  /** World's read model: the TUI runtime's lists, from the mirror. */
  readonly operations: RuntimeReader;
  /**
   * Screen only (`lines: 0`). The fence's original lease, core process and
   * occupant must hold when the read is sent and again when its reply is
   * published; a reply that outlives them is refused, never returned.
   */
  readScreen(
    fence: CoreOperationFence<CoreConnectionRuntime>,
  ): Promise<Record<string, unknown>>;
  /** World's layout of this core (M1), or null before a core is known. */
  layout(): CoreTopologyDocument | null;
  /** World's layout of this core changed: re-read the read model. */
  layoutChanged(): void;
  /**
   * Writes, each under the authority its fence captured: the original lease,
   * core process and (for kill and label) occupant are checked right before
   * the request is sent and again when its reply is published. A refusal
   * before sending sends nothing; a refusal after it means core acted but
   * World no longer publishes or follows up (`CoreFenceError` at
   * `publication`). A lost reply is `CoreWriteUncertainError`.
   */
  offers(method: CoreWriteMethod): boolean;
  /** Not checked at publication: the caller checks before following up. */
  run(
    fence: CoreOperationFence<CoreConnectionRuntime>,
    request: CoreRunRequest,
  ): Promise<CoreTerminalRecord>;
  kill(fence: CoreOperationFence<CoreConnectionRuntime>): Promise<void>;
  /** Native answer/prompt delivery; fresh get and foreground check before send. */
  send(
    fence: CoreOperationFence<CoreConnectionRuntime>,
    text: string,
    beforeSubmit: () => Promise<boolean>,
    timeoutMs?: number,
    authorized?: () => boolean,
  ): Promise<{ status: string | null; turn: number; started: boolean | null }>;
  label(
    fence: CoreOperationFence<CoreConnectionRuntime>,
    labels: Record<string, string>,
  ): Promise<void>;
  /**
   * Shares seen or favourite with Herdr's apps (`herdr.seen`,
   * `herdr.pinned`). `decide` reads the occupant's current record right
   * before the write and returns the change, or null to write nothing.
   * The fence must hold at dispatch; the write is never retried.
   */
  shareLabel(
    fence: CoreOperationFence<CoreConnectionRuntime>,
    decide: (
      record: CoreMirrorTerminal | undefined,
    ) => SharedLabelChange | null,
  ): Promise<"written" | "unchanged">;
  /** World's own float shells (`float-shell.ts`), each call fenced. */
  readonly shells: CoreShellControl;
};

/**
 * Start, view and end World's own shells. Every call holds its fence's lease
 * and core process at dispatch and publication; a reply that outlives them
 * is refused (an attach that outlived them is left again at once).
 */
export type CoreShellControl = {
  /** Whether the connected core offers run, attach and kill. */
  readonly offered: boolean;
  run(
    fence: CoreOperationFence<CoreConnectionRuntime>,
    params: CoreRunParams,
  ): Promise<CoreTerminalRecord>;
  attach(
    fence: CoreOperationFence<CoreConnectionRuntime>,
    address: string,
    size: CoreCellSize,
    handlers: CoreAttachHandlers,
  ): Promise<CoreAttachment>;
  /** Ends exactly the fenced occupant. */
  kill(
    fence: CoreOperationFence<CoreConnectionRuntime>,
  ): Promise<CoreTerminalRecord>;
};

/** Admits a screen read of `address` under `lease` and runs it fenced. */
export function readCoreScreen(
  lease: ReadyRuntimeLease<CoreConnectionRuntime>,
  address: string,
): Promise<Record<string, unknown>> {
  try {
    return lease.runtime.readScreen(CoreOperationFence.admit(lease, address));
  } catch (error) {
    return Promise.reject(error);
  }
}

export class CoreMirrorRetiredError extends CoreUnavailableError {
  constructor(reason: string) {
    super(`herdr-core observation lost ordering (${reason}); reacquiring`);
    this.name = "CoreMirrorRetiredError";
  }
}

export function createCoreConnectionRuntime(
  options: CoreRuntimeOptions,
): CoreConnectionRuntime {
  const now = options.now ?? Date.now;
  const connect = options.connect ?? connectUnixStream;
  const identity = { ...options.identity };
  const mirror = new CoreMirror(options.limits ?? DEFAULT_CORE_MIRROR_LIMITS);
  const firstSight = options.firstSight ?? new CoreFirstSight();
  const attention = options.attention ?? new CoreAttention();
  /** Alerts go out only from the current generation's ordered mirror. */
  const alert = (alerts: CoreAlert[]) => {
    if (!alerts.length || !options.context.isCurrent()) return;
    options.onAlerts?.(
      alerts,
      mirror.terminals(),
      coreSummary?.name ?? "herdr-core",
    );
  };
  /**
   * Every terminal World sees, as it first sees it (World's own seen rule),
   * and every change of a program's word (push), after the mirror applied it.
   */
  const sight = (
    line: CoreEventLine | null,
    terminals?: readonly unknown[],
  ) => {
    const coreId = epoch?.coreId;
    if (!coreId) return;
    if (terminals || line?.method === "missed") {
      firstSight.observe(
        coreId,
        terminals ??
          (line as { params: { terminals: unknown[] } }).params.terminals,
      );
      return alert(attention.cut(coreId, mirror.terminals()));
    }
    if (line?.method !== "event") return;
    const { type, terminal, data } = line.params;
    if (type === "created" || type === "restarted")
      firstSight.observe(coreId, [data]);
    else if (type === "removed" && typeof terminal === "string")
      firstSight.forget(terminal);
    if (typeof terminal === "string" && !line.params.machine)
      alert(attention.event(coreId, type, terminal, mirror.terminal(terminal)));
  };
  const abort = new AbortController();
  let client: CoreClient | null = null;
  let epoch: CoreEpoch | null = null;
  let version: string | null = null;
  let coreSummary: CoreObservation["core"] = null;
  let ready = false;
  let failed = false;
  let stopped = false;
  let liveness: ReturnType<typeof setInterval> | null = null;
  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPublished = "";
  let stopTask: Promise<void> | null = null;

  const publish = (force = false) => {
    if (!options.context.isCurrent() && !force) return;
    const observation = summarizeMirror(mirror, coreSummary, now());
    // Time and cursor move on every event; publish only what a person sees.
    const key = JSON.stringify({ ...observation, observed_ms: 0, cursor: 0 });
    if (!force && key === lastPublished) return;
    lastPublished = key;
    options.observations.publish(identity.id, observation);
  };
  // Labels, turns and folders shape Town and Needs you but not the
  // Connections page: World re-reads whenever its own rows would differ.
  let lastReadModel = "";
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  const layout = () =>
    epoch ? (options.layout?.(epoch.coreId) ?? null) : null;
  const readModelChanged = () => {
    if (!options.context.isCurrent() || !mirror.baselined) return;
    const at = now();
    const terminals = mirror.terminals();
    const key = JSON.stringify(
      coreTopology(terminals, coreSummary?.name ?? "herdr-core", {
        firstSight,
        world: layout(),
        coreId: epoch?.coreId,
        now: at,
      }),
    );
    // A summary disappears when it expires, with no event to say so.
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = null;
    const expiry = epoch
      ? nextCoreSummaryExpiry(epoch.coreId, terminals, at)
      : null;
    if (expiry !== null && !failed && !stopped)
      expiryTimer = setTimeout(
        readModelChanged,
        Math.min(Math.max(expiry - at + 1, 1), 2 ** 31 - 1),
      );
    if (key === lastReadModel) return;
    lastReadModel = key;
    options.onReadModel?.();
  };
  const schedulePublish = () => {
    if (publishTimer) return;
    publishTimer = setTimeout(() => {
      publishTimer = null;
      if (failed || stopped) return;
      publish();
      readModelChanged();
    }, options.publishDelayMs ?? 200);
  };

  /** The last facts stay visible as stale; the newest generation owns them. */
  const withdraw = () => {
    mirror.retire("disconnected");
    if (publishTimer) clearTimeout(publishTimer);
    publishTimer = null;
    if (mirror.baselined) publish(true);
    else options.observations.markStale(identity.id, "disconnected");
  };

  const fail = (error: Error) => {
    if (failed || stopped) return;
    failed = true;
    abort.abort(error);
    withdraw();
    client?.close(error.message);
    if (ready && options.context.isCurrent()) options.onFailure(error);
  };

  const checkStatus = (status: CoreServerStatus) => {
    if (!epoch || status?.core?.id !== epoch.coreId || status.pid !== epoch.pid)
      throw new CoreUnavailableError("herdr-core was replaced");
  };

  async function startTransport() {
    if (stopped) throw new Error("connection runtime is disposed");
    const socket = await options.transport.open(abort.signal);
    abort.signal.throwIfAborted();
    const stream = await connect(socket, abort.signal).catch((error) => {
      throw new CoreUnavailableError("herdr-core is not running", {
        cause: error,
      });
    });
    const opened = await CoreClient.open(stream, {
      onClosed: (error) => fail(error),
    });
    client = opened;
    if (stopped) {
      opened.close();
      throw new Error("connection runtime is disposed");
    }
    const status = await opened.status();
    if (status?.core?.id !== opened.hello.core.id)
      throw new CoreIncompatibleError("core identity differs between calls");
    epoch = {
      coreId: opened.hello.core.id,
      pid: status.pid,
      startedMs: now() - status.uptime_ms,
    };
    version = opened.hello.version;
    coreSummary = {
      id: opened.hello.core.id,
      name: opened.hello.core.name,
      version: opened.hello.version,
      pid: status.pid,
    };
  }

  async function startBackground() {
    const current = client;
    if (!current || stopped) throw new Error("connection runtime is disposed");
    await current.subscribe({
      baseline: (seq, terminals) => {
        if (!mirror.baseline(seq, terminals))
          throw new CoreMirrorRetiredError(mirror.retired ?? "baseline");
        sight(null, terminals);
      },
      line: (line) => {
        const outcome = mirror.apply(line);
        if (outcome === "applied") sight(line);
        if (outcome === "retired") {
          // Ordering is lost: stop acting, keep facts, reacquire afresh.
          fail(new CoreMirrorRetiredError(mirror.retired ?? "gap"));
          return;
        }
        if (outcome === "applied") schedulePublish();
      },
      end: (error) => fail(error),
    });
    if (failed) throw new CoreMirrorRetiredError(mirror.retired ?? "closed");
    ready = true;
    publish(true);
    readModelChanged();
    const interval = options.livenessIntervalMs ?? 10_000;
    liveness = setInterval(() => {
      if (failed || stopped) return;
      current
        .status(options.livenessTimeoutMs ?? 5_000)
        .then(checkStatus)
        .catch((error: Error) =>
          fail(
            new CoreUnavailableError(
              `herdr-core stopped answering: ${error.message}`,
            ),
          ),
        );
    }, interval);
  }

  async function readScreen(fence: CoreOperationFence<CoreConnectionRuntime>) {
    // Another runtime's authority never dispatches through this one.
    if (fence.lease.runtime !== self || !fence.occupant)
      throw new CoreFenceError("dispatch", "lease");
    const current = client;
    if (!current) throw new CoreFenceError("dispatch", "not-actionable");
    fence.check("dispatch");
    const screen = await current.readScreen(fence.occupant.address);
    fence.check("publication");
    return screen;
  }

  async function write<T>(
    fence: CoreOperationFence<CoreConnectionRuntime>,
    needsOccupant: boolean,
    send: (client: CoreClient) => Promise<T>,
    publish = true,
  ): Promise<T> {
    if (fence.lease.runtime !== self || (needsOccupant && !fence.occupant))
      throw new CoreFenceError("dispatch", "lease");
    const current = client;
    if (!current) throw new CoreFenceError("dispatch", "not-actionable");
    fence.check("dispatch");
    const result = await send(current);
    if (publish) fence.check("publication");
    return result;
  }

  async function shareLabel(
    fence: CoreOperationFence<CoreConnectionRuntime>,
    decide: (
      record: CoreMirrorTerminal | undefined,
    ) => SharedLabelChange | null,
  ): Promise<"written" | "unchanged"> {
    if (fence.lease.runtime !== self || !fence.occupant)
      throw new CoreFenceError("dispatch", "lease");
    const current = client;
    if (!current) throw new CoreFenceError("dispatch", "not-actionable");
    fence.check("dispatch");
    // Re-read: the mirror is current up to the last event core sent.
    const address = fence.occupant.address;
    const change = decide(mirror.terminal(address));
    if (!change) return "unchanged";
    await current.shareLabel(address, change);
    return "written";
  }

  /** The current client, under a fence that belongs to this runtime. */
  const dispatchThrough = (
    fence: CoreOperationFence<CoreConnectionRuntime>,
  ): CoreClient => {
    if (fence.lease.runtime !== self)
      throw new CoreFenceError("dispatch", "lease");
    const current = client;
    if (!current || !current.offersFloatShells)
      throw new CoreFenceError("dispatch", "not-actionable");
    fence.check("dispatch");
    return current;
  };
  const shells: CoreShellControl = {
    get offered() {
      return client?.offersFloatShells === true;
    },
    async run(fence, params) {
      const record = await dispatchThrough(fence).runShell(params);
      fence.check("publication");
      return record;
    },
    async attach(fence, address, size, handlers) {
      const attachment = await dispatchThrough(fence).attach(
        address,
        size,
        handlers,
      );
      try {
        fence.check("publication");
      } catch (error) {
        attachment.detach();
        throw error;
      }
      return attachment;
    },
    async kill(fence) {
      if (!fence.occupant)
        throw new CoreFenceError("dispatch", "occupant-gone");
      const record = await dispatchThrough(fence).kill(fence.occupant.address);
      return record;
    },
  };

  function stop() {
    if (stopTask) return stopTask;
    stopped = true;
    abort.abort(new Error("connection runtime retired"));
    if (liveness) clearInterval(liveness);
    if (expiryTimer) clearTimeout(expiryTimer);
    if (!failed) withdraw();
    client?.close("connection runtime retired");
    stopTask = options.transport.close().catch(() => undefined);
    return stopTask;
  }

  const view = {
    get epoch() {
      return epoch;
    },
    get actionable() {
      return ready && !failed && !stopped && mirror.actionable;
    },
    get version() {
      return version;
    },
    mirror,
    terminal: (address: string) => mirror.terminal(address),
    occupancy: (address: string) => mirror.occupancy(address),
  };
  const self: CoreConnectionRuntime = {
    identity,
    runtime: "herdr-core",
    signal: abort.signal,
    core: view,
    operations: coreRuntimeReader({
      mirror,
      get actionable() {
        return view.actionable;
      },
      coreName: () => coreSummary?.name ?? "herdr-core",
      firstSight,
      world: layout,
      coreId: () => epoch?.coreId ?? null,
      now,
    }),
    readScreen,
    layout,
    layoutChanged: () => readModelChanged(),
    offers: (method) => client?.offers(method) ?? false,
    // A started program exists whatever happens next: its record is returned
    // and the caller decides what it may still publish.
    run: (fence, request) =>
      write(fence, false, (current) => current.run(request), false),
    kill: (fence) =>
      write(fence, true, async (current) => {
        await current.kill(fence.occupant!.address);
      }),
    send: async (fence, text, beforeSubmit, timeoutMs, authorized) => {
      if (fence.lease.runtime !== self || !fence.occupant)
        throw new CoreFenceError("dispatch", "lease");
      fence.check("dispatch");
      if (!fence.occupant.foreground)
        throw new CoreFenceError("dispatch", "foreground-changed");
      const current = client;
      if (!current) throw new CoreFenceError("dispatch", "not-actionable");
      const expected = coreOccupantFingerprint(
        fence.occupant.coreId,
        view.terminal(fence.occupant.address)!,
      );
      if (!(await beforeSubmit()))
        throw new CoreFenceError("dispatch", "lease");
      // Core resolves current OS foreground in get. Never use a history read,
      // forced send, caller, or a harness side channel. The queue race after
      // this check belongs to core (Q3).
      const record = await current.getTerminal(fence.occupant.address);
      fence.check("dispatch");
      if (
        coreOccupantFingerprint(fence.occupant.coreId, record) !== expected ||
        record.state !== "live"
      )
        throw new CoreFenceError("dispatch", "occupant-replaced");
      const foreground = record.foreground as
        | { pid?: number; name?: string }
        | undefined;
      if (
        foreground?.pid !== fence.occupant.foreground.pid ||
        foreground.name !== fence.occupant.foreground.name
      )
        throw new CoreFenceError("dispatch", "foreground-changed");
      if (authorized && !authorized())
        throw new CoreFenceError("dispatch", "lease");
      const result = await current.sendText(
        fence.occupant.address,
        text,
        timeoutMs,
      );
      fence.check("publication");
      return result;
    },
    label: (fence, labels) =>
      write(fence, true, async (current) => {
        await current.label(fence.occupant!.address, labels);
      }),
    shareLabel,
    shells,
    startTransport,
    startBackground,
    stop,
  };
  return self;
}
