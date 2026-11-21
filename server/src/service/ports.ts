import type { DataPaths } from "../config/data-paths";
import type { ServerConfig } from "../config/server-config";
import type { OpenStorage } from "./storage";
import { productionAdapters } from "../adapters/registry";
import { discoverHost, type DiscoverHost } from "../connections/host-discovery";
import { testConnectionSockets } from "../connections/profile-probe";
import type {
  createLegacyConnectionRuntime,
  LegacyConnectionRuntime,
} from "../connections/runtime";

/** Time for everything the composition root constructs. */
export type Clock = {
  /** Milliseconds since the epoch: timestamps and persisted deadlines. */
  now(): number;
  /** Milliseconds from an arbitrary origin: durations and in-process waits. */
  monotonic(): number;
};

/**
 * Deferred work. A durable deadline is persisted wall time: schedule
 * `min(60_000, max(0, deadline - clock.now()))` and re-arm on each wake until
 * `clock.now() >= deadline`. Timers stop while the machine sleeps; the cap
 * bounds lateness to 60 s.
 */
export type Scheduler = {
  schedule(callback: () => void, delayMs: number): { cancel(): void };
};

export const systemClock: Clock = {
  now: () => Date.now(),
  monotonic: () => performance.now(),
};

export const systemScheduler: Scheduler = {
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(timer) };
  },
};

export type HerdrRuntimeOptions = Parameters<
  typeof createLegacyConnectionRuntime
>[0];

/** Herdr, the one runtime: a connection runtime per connection generation. */
export type HerdrAdapter = {
  createRuntime(options: HerdrRuntimeOptions): LegacyConnectionRuntime;
  discoverHost?: DiscoverHost;
};

/** Adapters by kind, registered once by the composition root. */
export type WorldAdapters = { herdr: HerdrAdapter };

/** The registry's Herdr adapter; its runtimes check both sockets once started. */
export const herdrAdapter: HerdrAdapter = {
  discoverHost: (host, existing) => discoverHost(host, existing),
  createRuntime(options) {
    const runtime = productionAdapters.herdr.createRuntime(options);
    return {
      ...runtime,
      async startTransport() {
        await runtime.startTransport();
        await testConnectionSockets(
          options.config.socketPath,
          options.config.clientSocketPath,
        );
      },
    };
  },
};

/** Everything a World service takes from its process; nothing else is global. */
export type WorldServiceDeps = {
  config: ServerConfig;
  /** The data folder this service owns from creation until stop. */
  paths: DataPaths;
  clock: Clock;
  scheduler: Scheduler;
  storage: OpenStorage;
  adapters: WorldAdapters;
  /** After an installed update: end the process so its supervisor restarts it. */
  scheduleProcessExit(): void;
};
