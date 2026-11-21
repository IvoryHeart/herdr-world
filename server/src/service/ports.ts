import type { DataPaths } from "../config/data-paths";
import type { ServerConfig } from "../config/server-config";
import type { OpenStorage } from "./storage";
import type { Clock, Scheduler } from "./clock";
import { productionAdapters } from "../adapters/registry";
import { discoverHost, type DiscoverHost } from "../connections/host-discovery";
import { testConnectionSockets } from "../connections/profile-probe";
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
