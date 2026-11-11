import type {
  ConnectionRuntime,
  ConnectionRuntimeContext,
  ReadyRuntimeLease,
} from "../connections/manager";
import type { ConnectionIdentity } from "../connections/types";
import {
  type CoreEventLine,
  CoreClient,
  CoreIncompatibleError,
  type CoreServerStatus,
  CoreUnavailableError,
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
import { CoreFirstSight, coreRuntimeReader, coreTopology } from "./topology";
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
  const readModelChanged = () => {
    if (!options.context.isCurrent() || !mirror.baselined) return;
    const key = JSON.stringify(
      coreTopology(
        mirror.terminals(),
        coreSummary?.name ?? "herdr-core",
        firstSight,
      ),
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

  function stop() {
    if (stopTask) return stopTask;
    stopped = true;
    abort.abort(new Error("connection runtime retired"));
    if (liveness) clearInterval(liveness);
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
    core: view,
    operations: coreRuntimeReader({
      mirror,
      get actionable() {
        return view.actionable;
      },
      coreName: () => coreSummary?.name ?? "herdr-core",
      firstSight,
    }),
    readScreen,
    shareLabel,
    startTransport,
    startBackground,
    stop,
  };
  return self;
}
