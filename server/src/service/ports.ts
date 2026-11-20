import { productionAdapters } from "../adapters/registry";
import { testConnectionSockets } from "../connections/profile-service";
import type {
  createLegacyConnectionRuntime,
  LegacyConnectionRuntime,
} from "../connections/runtime";

export {
  systemClock,
  systemScheduler,
  type Clock,
  type Scheduler,
} from "./clock";

export type HerdrRuntimeOptions = Parameters<
  typeof createLegacyConnectionRuntime
>[0];

/** Herdr, the one runtime: a connection runtime per connection generation. */
export type HerdrAdapter = {
  createRuntime(options: HerdrRuntimeOptions): LegacyConnectionRuntime;
};

/** Adapters by kind, registered once by the composition root. */
export type WorldAdapters = { herdr: HerdrAdapter };

/** The registry's Herdr adapter; its runtimes check both sockets once started. */
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
