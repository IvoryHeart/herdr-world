import type { FeatureKernel } from "../features/contract";
import type { ConnectionProfileService } from "../connections/profile-service";
import type { ObservedSnapshots } from "../rpc/context";
import type { WorldRuntimeStatus } from "../world/runtime-registry";
import type { GuiSettingsStore } from "../config/gui-settings";
import type { ServerConfig } from "../config/server-config";
import type { SourcesService } from "../sources/service";
import type { OfficeObservabilityService } from "../world/observability";
import type { Clock, Scheduler } from "./ports";
import { WorldUsageService } from "../usage/service";
import { UsageActivity } from "../usage/activity";
import { WorldUsageAnalyticsService } from "../usage/analytics";
import { createCoreUsageRuntime } from "../usage/core";
import { createUsageProjects } from "../usage/projects";
import { createWorktreeGit } from "../agent/worktree-git";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";
import { STARTUP_DEFAULT_CONNECTION_ID } from "../connections/types";
import { join } from "node:path";

/** One shared read service for both runtime kinds; all host reads keep their lease. */
export function composeWorldUsage(args: {
  connectionManager: ReturnType<FeatureKernel["connections"]>;
  core: { manager: ReturnType<FeatureKernel["core"]> };
  coreRpc: { host: FeatureKernel["coreHost"]; git: FeatureKernel["coreGit"] };
  connectionProfiles: Pick<ConnectionProfileService, "list">;
  observedConnections: { list(): WorldRuntimeStatus[] };
  worldSnapshots: ObservedSnapshots;
  worldSources: SourcesService;
  settings: GuiSettingsStore;
  officeObservability: Pick<OfficeObservabilityService, "snapshot">;
  clock: Clock;
  scheduler: Scheduler;
  serviceIncarnation: string;
  config: Pick<ServerConfig, "sshHost">;
  dataRoot: string;
}) {
  const {
    connectionManager,
    core,
    coreRpc,
    connectionProfiles,
    observedConnections,
    worldSnapshots,
    worldSources,
    settings,
    officeObservability,
    clock,
    scheduler,
    serviceIncarnation,
    config,
  } = args;
  const usageActivity = new UsageActivity(
    join(args.dataRoot, "usage-activity.json"),
  );
  const coreUsage = new WeakMap<
    import("../herdr-core/runtime").CoreConnectionRuntime,
    ReturnType<typeof createCoreUsageRuntime>
  >();
  const usageConnections = {
    list: () => observedConnections.list(),
    readyRuntimeLease(id: string) {
      if (connectionManager.has(id))
        return connectionManager.readyRuntimeLease(id);
      if (!core.manager.has(id)) return null;
      const lease = core.manager.readyRuntimeLease(id);
      const host = coreRpc.host(id);
      if (!lease?.isCurrent() || !host || host.windows) return null;
      let runtime = coreUsage.get(lease.runtime);
      if (!runtime) {
        runtime = createCoreUsageRuntime(lease, host.destination);
        coreUsage.set(lease.runtime, runtime);
      }
      return { ...lease, runtime };
    },
  };
  const usageHostScope = (id: string) => {
    if (core.manager.has(id)) {
      const host = coreRpc.host(id);
      return host
        ? host.destination
          ? `ssh:${host.destination}`
          : "local"
        : id;
    }
    if (id === STARTUP_DEFAULT_CONNECTION_ID)
      return config.sshHost ? `ssh:${config.sshHost}` : "local";
    const profile = connectionProfiles.list().find((p) => p.id === id);
    return profile?.type === "local"
      ? "local"
      : profile?.type === "ssh"
        ? `ssh:${profile.ssh_destination}`
        : id;
  };
  const usageTopology = async () => {
    const topology = await worldSnapshots!.snapshot({});
    return {
      ...topology,
      connections: await Promise.all(
        topology.connections.map(async (host) => {
          if (host.runtime !== "herdr-core" || host.stale || !host.snapshot)
            return host;
          const lease = usageConnections.readyRuntimeLease(host.connection_id);
          if (!lease?.isCurrent() || lease.generation !== host.generation)
            return { ...host, stale: true, actionable: false };
          const result = await lease.runtime.operations
            .listAgents()
            .catch(() => null);
          if (!result || !lease.isCurrent())
            return { ...host, stale: true, actionable: false };
          return {
            ...host,
            snapshot: { ...host.snapshot, agents: result.agents ?? [] },
          };
        }),
      ),
    };
  };
  const worldUsage = new WorldUsageService({
    incarnation: serviceIncarnation,
    connections: usageConnections,
    hostScope: usageHostScope,
    topology: usageTopology,
    prices: async () => (await settings.read()).custom.world_usage_prices_v1,
    telemetry: () => officeObservability.snapshot(),
    now: () => clock.now(),
    scheduler,
  });
  const usageCurrent = (id: string, generation: number) => {
    const lease = usageConnections.readyRuntimeLease(id);
    return !!lease?.isCurrent() && lease.generation === generation;
  };
  const analytics = new WorldUsageAnalyticsService({
    usage: (params) => worldUsage!.get(params, false),
    topology: usageTopology,
    sources: () => worldSources.snapshot(),
    activity: usageActivity,
    current: usageCurrent,
    now: () => clock.now(),
    project: createUsageProjects({
      now: () => clock.now(),
      current: usageCurrent,
      git(id, generation) {
        if (!usageCurrent(id, generation)) return null;
        if (core.manager.has(id)) {
          const lease = core.manager.readyRuntimeLease(id);
          return lease ? coreRpc.git(lease) : null;
        }
        const lease = connectionManager.readyRuntimeLease(id);
        if (!lease || lease.generation !== generation) return null;
        const profile = connectionProfiles.list().find((p) => p.id === id);
        const destination =
          id === STARTUP_DEFAULT_CONNECTION_ID
            ? config.sshHost
            : profile?.type === "ssh"
              ? profile.ssh_destination
              : undefined;
        if (profile?.type === "ssh" && profile.remote_platform === "windows")
          return null;
        return createWorktreeGit({
          sshHost: () => destination,
          shQuote,
          runProcessWithCodeTimeout: async (...args) => {
            if (!lease.isCurrent()) throw new Error("Usage lease retired");
            const result = await runProcessWithCodeTimeout(...args);
            if (!lease.isCurrent()) throw new Error("Usage lease retired");
            return result;
          },
        });
      },
    }),
  });
  const closeUsage = worldUsage.close.bind(worldUsage);
  return Object.assign(worldUsage, {
    analytics,
    activity: usageActivity,
    close: async () => {
      usageActivity.close(clock.now());
      await closeUsage();
    },
  });
}
export type ComposedWorldUsage = ReturnType<typeof composeWorldUsage>;
