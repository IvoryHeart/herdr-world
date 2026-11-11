import type {
  ConnectionRuntime,
  ConnectionRuntimeContext,
} from "../connections/manager";
import type { ConnectionIdentity } from "../connections/types";
import {
  CoreClient,
  CoreIncompatibleError,
  type CoreServerStatus,
  CoreUnavailableError,
} from "./client";
import type { CoreEpoch, CoreFenceView } from "./fence";
import {
  type CoreMirrorLimits,
  CoreMirror,
  DEFAULT_CORE_MIRROR_LIMITS,
} from "./mirror";
import {
  type CoreObservation,
  type CoreObservationStore,
  summarizeMirror,
} from "./observations";
import { connectUnixStream, type CoreStreamConnector } from "./stream";

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
  /** Screen only (`lines: 0`), fenced by this runtime's current authority. */
  readScreen(address: string): Promise<Record<string, unknown>>;
};

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
  const schedulePublish = () => {
    if (publishTimer) return;
    publishTimer = setTimeout(() => {
      publishTimer = null;
      if (!failed && !stopped) publish();
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
      },
      line: (line) => {
        const outcome = mirror.apply(line);
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

  async function readScreen(address: string) {
    const current = client;
    if (!current || failed || !mirror.actionable)
      throw new CoreUnavailableError("herdr-core is not connected");
    return current.readScreen(address);
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

  return {
    identity,
    runtime: "herdr-core",
    core: {
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
      terminal: (address) => mirror.terminal(address),
      occupancy: (address) => mirror.occupancy(address),
    },
    readScreen,
    startTransport,
    startBackground,
    stop,
  };
}
