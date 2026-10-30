import { productionAdapters } from "../adapters/registry";
import { testConnectionSockets } from "../connections/profile-service";
import {
  createLegacyConnectionRuntime,
  type LegacyConnectionRuntime,
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
};

/** Adapters by kind, registered once by the composition root. */
export type WorldAdapters = { herdr: HerdrAdapter };

export const herdrAdapter: HerdrAdapter = {
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
